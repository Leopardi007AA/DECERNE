import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sincronizzazione "pull" per negozi E-commerce (/functions/v1/ecommerce-pull-sync).
// Invocata ogni ora da pg_cron (public.run_ecommerce_pull_sync), autenticata con un segreto
// condiviso (header x-cron-secret) verificato via RPC verify_cron_secret: per questo ha
// verify_jwt disabilitato. Non è chiamata dal browser, quindi niente CORS.
//
// Hardening (sec_14): redirect non seguiti e timeout sulle richieste verso i siti dei partner
// (anti-SSRF), nessuna chiave API dentro gli URL salvati, URL validati (solo https), errori
// interni mai restituiti né scritti in last_error (solo messaggi nostri o generici).
// Hardening (sec_16): prima di ogni richiesta l'indirizzo del negozio viene risolto via DNS e
// rifiutato se punta a una rete interna (un nome pubblico può puntare a 127.0.0.1 o 169.254.x.x);
// risposte limitate a 5 MB.

const PLAN_WEIGHT = { Starter: 1, Standard: 2, Professional: 3, Enterprise: 4 };
const MAX_PRODUCT_LEN = 150;
const MAX_PRICE = 99999.99;
const MAX_PRODUCTS_PER_STORE = 500;
const DEFAULT_UNIT = "pezzo";
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

class SyncError extends Error {}

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Indirizzi che non devono mai essere raggiunti da questa funzione (rete interna, loopback, ecc.)
function isPrivateIp(ip) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("::ffff:");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = p[0];
  const b = p[1];
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
}

let dnsWarned = false;

// Verifica che l'indirizzo del negozio sia https, senza IP numerici e che i suoi record DNS
// non puntino a reti interne.
async function assertPublicHost(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new SyncError("URL del negozio non valido."); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || (u.port && u.port !== "443")) {
    throw new SyncError("L'URL del negozio deve usare https sulla porta standard.");
  }
  if (!host.includes(".") || /^[0-9.]+$/.test(host) || host.includes(":") || host === "localhost" ||
      /\.(local|localhost|internal|lan|home|corp|localdomain)$/.test(host)) {
    throw new SyncError("L'indirizzo del negozio non è consentito.");
  }

  let addrs = [];
  let dnsUnavailable = false;
  for (const type of ["A", "AAAA"]) {
    try {
      addrs = addrs.concat(await Deno.resolveDns(host, type));
    } catch (e) {
      if (e && e.name === "NotFound") continue; // nessun record di quel tipo
      dnsUnavailable = true;
    }
  }

  if (!addrs.length) {
    if (dnsUnavailable) {
      // La risoluzione DNS non è disponibile in questo ambiente: restano i controlli sul nome.
      if (!dnsWarned) { dnsWarned = true; console.warn("Deno.resolveDns non disponibile: controllo IP saltato."); }
      return;
    }
    throw new SyncError("Impossibile raggiungere l'indirizzo del negozio.");
  }
  if (addrs.some((ip) => isPrivateIp(String(ip)))) {
    throw new SyncError("L'indirizzo del negozio non è consentito.");
  }
}

// fetch verso i siti dei partner: indirizzo controllato, niente redirect (potrebbero puntare a
// indirizzi interni) e timeout.
async function safeFetch(url, init = {}) {
  await assertPublicHost(url);
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status >= 300 && res.status < 400) throw new SyncError("Il sito ha risposto con un reindirizzamento: usa l'URL definitivo del negozio.");
  return res;
}

// Legge il JSON della risposta fermandosi oltre 5 MB.
async function readJsonLimited(res) {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new SyncError("La risposta del negozio è troppo grande.");
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) throw new SyncError("Risposta del negozio vuota.");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SyncError("La risposta del negozio è troppo grande.");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new SyncError("Risposta del negozio non valida.");
  }
}

// Solo https, senza caratteri che escono da un attributo HTML, lunghezza massima come il vincolo DB.
function cleanUrl(u) {
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  if (!/^https:\/\/[^"'<>\s]{1,2000}$/.test(t)) return null;
  try { new URL(t); } catch { return null; }
  return t;
}

function roundPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n * 100) / 100, MAX_PRICE);
}

function cleanName(s) {
  if (!s) return null;
  const t = String(s).replace(/[<>]/g, "").trim();
  if (!t) return null;
  return t.length > MAX_PRODUCT_LEN ? t.slice(0, MAX_PRODUCT_LEN) : t;
}

function cleanSku(s, fallback) {
  const t = (s ? String(s) : "").trim();
  const v = t || fallback;
  return v.length > 64 ? v.slice(0, 64) : v;
}

function pickCategory(raw, categories) {
  if (raw) {
    const canonical = categories.byLower.get(String(raw).trim().toLowerCase());
    if (canonical) return canonical;
  }
  return categories.byLower.get("altro") || categories.list[0];
}

async function loadCategories(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from("offer_categories")
    .select("name")
    .order("sort_order", { ascending: true });
  if (error || !data || !data.length) throw new Error("categorie non disponibili");
  return {
    list: data.map((c) => c.name),
    byLower: new Map(data.map((c) => [c.name.toLowerCase(), c.name]))
  };
}

// --- WooCommerce: credenziali { consumer_key, consumer_secret } ---
async function fetchWooCommerceProducts(shopUrl, creds) {
  if (!creds?.consumer_key || !creds?.consumer_secret) throw new SyncError("credenziali WooCommerce incomplete");
  const base = shopUrl.replace(/\/+$/, "");
  const auth = "Basic " + btoa(`${creds.consumer_key}:${creds.consumer_secret}`);
  const res = await safeFetch(`${base}/wp-json/wc/v3/products?per_page=100&status=publish`, {
    headers: { Authorization: auth }
  });
  if (!res.ok) throw new SyncError(`WooCommerce ha risposto ${res.status}`);
  const products = await readJsonLimited(res);
  if (!Array.isArray(products)) throw new SyncError("risposta WooCommerce inattesa");

  return products.map((p) => ({
    sku: cleanSku(p.sku, `wc-${p.id}`),
    name: cleanName(p.name),
    price: roundPrice(parseFloat(p.price || p.regular_price)),
    originalPrice: roundPrice(parseFloat(p.regular_price || p.price)),
    quantity: p.manage_stock ? Math.max(0, parseInt(p.stock_quantity, 10) || 0) : (p.stock_status === "instock" ? 1 : 0),
    productUrl: cleanUrl(p.permalink),
    imageUrl: cleanUrl(p.images?.[0]?.src),
    categoryRaw: p.categories?.[0]?.name || null
  }));
}

// --- PrestaShop: credenziali { api_key }. L'URL immagine dell'API contiene la chiave (ws_key):
// non va MAI salvato in offers.img_url (pubblico), quindi per PrestaShop l'immagine resta vuota. ---
async function fetchPrestaShopProducts(shopUrl, creds) {
  if (!creds?.api_key) throw new SyncError("credenziali PrestaShop incomplete");
  const base = shopUrl.replace(/\/+$/, "");
  const auth = "Basic " + btoa(`${creds.api_key}:`);

  const [prodRes, stockRes] = await Promise.all([
    safeFetch(`${base}/api/products?output_format=JSON&display=full&filter[active]=1&limit=0,${MAX_PRODUCTS_PER_STORE}`, { headers: { Authorization: auth } }),
    safeFetch(`${base}/api/stock_availables?output_format=JSON&display=full&filter[id_product_attribute]=0&limit=0,2000`, { headers: { Authorization: auth } })
  ]);
  if (!prodRes.ok) throw new SyncError(`PrestaShop ha risposto ${prodRes.status} sui prodotti`);
  const prodBody = await readJsonLimited(prodRes);
  const products = prodBody?.products || [];

  const stockMap = new Map();
  if (stockRes.ok) {
    const stockBody = await readJsonLimited(stockRes);
    for (const s of stockBody?.stock_availables || []) {
      stockMap.set(String(s.id_product), Math.max(0, parseInt(s.quantity, 10) || 0));
    }
  }

  const nameOf = (v) => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v[0]?.value || null;
    return v?.value || null;
  };

  return products.map((p) => ({
    sku: cleanSku(p.reference, `ps-${p.id}`),
    name: cleanName(nameOf(p.name)),
    price: roundPrice(parseFloat(p.price)),
    originalPrice: roundPrice(parseFloat(p.price)),
    quantity: stockMap.get(String(p.id)) ?? 0,
    productUrl: cleanUrl(`${base}/index.php?id_product=${p.id}&controller=product`),
    imageUrl: null,
    categoryRaw: null
  }));
}

// --- Shopify: credenziali { access_token } ---
async function fetchShopifyProducts(shopUrl, creds) {
  if (!creds?.access_token) throw new SyncError("credenziali Shopify incomplete");
  const domain = shopUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const res = await safeFetch(`https://${domain}/admin/api/2024-10/products.json?limit=100&status=active`, {
    headers: { "X-Shopify-Access-Token": creds.access_token }
  });
  if (!res.ok) throw new SyncError(`Shopify ha risposto ${res.status}`);
  const body = await readJsonLimited(res);
  const products = body?.products || [];

  return products.map((p) => {
    const v = p.variants?.[0] || {};
    return {
      sku: cleanSku(v.sku, `shopify-${p.id}`),
      name: cleanName(p.title),
      price: roundPrice(parseFloat(v.price)),
      originalPrice: roundPrice(parseFloat(v.compare_at_price || v.price)),
      quantity: Math.max(0, parseInt(v.inventory_quantity, 10) || 0),
      productUrl: p.handle ? cleanUrl(`https://${domain}/products/${p.handle}`) : null,
      imageUrl: cleanUrl(p.image?.src || p.images?.[0]?.src),
      categoryRaw: p.product_type || null
    };
  });
}

const ADAPTERS = {
  woocommerce: fetchWooCommerceProducts,
  prestashop: fetchPrestaShopProducts,
  shopify: fetchShopifyProducts
};

async function applyProduct(supabaseAdmin, store, categories, item, log) {
  if (!item.sku || !item.name || item.price === null) {
    log.errors.push({ sku: item.sku || null, reason: "sku, nome o prezzo mancanti/non validi" });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from("products")
    .select("id, linked_offer_id, price, original_price, quantity")
    .eq("store_id", store.id)
    .eq("sku", item.sku)
    .maybeSingle();

  const row = {
    store_id: store.id,
    sku: item.sku,
    name: item.name,
    price: item.price,
    original_price: item.originalPrice ?? item.price,
    quantity: item.quantity,
    unit_of_measure: DEFAULT_UNIT,
    source: "ecommerce_pull",
    updated_at: new Date().toISOString()
  };
  if (!existing) row.category = pickCategory(item.categoryRaw, categories);

  let productId = existing?.id ?? null;
  let isNew = false;
  const priceChanged = existing && (item.price !== existing.price || (item.originalPrice ?? item.price) !== existing.original_price);
  const qtyChanged = existing && item.quantity !== existing.quantity;

  if (existing) {
    const { error } = await supabaseAdmin.from("products").update(row).eq("id", existing.id);
    if (error) { console.error("products update:", error.message); log.errors.push({ sku: item.sku, reason: "DB_UPDATE_ERR" }); return; }
  } else {
    const { data: inserted, error } = await supabaseAdmin.from("products").insert(row).select("id").maybeSingle();
    if (error) { console.error("products insert:", error.message); log.errors.push({ sku: item.sku, reason: "DB_INSERT_ERR" }); return; }
    productId = inserted?.id ?? null;
    isNew = true;
    log.created++;
  }

  let action = null;

  if (isNew && productId && item.quantity > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const { data: draft, error: draftErr } = await supabaseAdmin
      .from("offers")
      .insert({
        store_id: store.id,
        product: item.name,
        price: row.price,
        original_price: row.original_price,
        category: row.category,
        start_date: today,
        end_date: endDate.toISOString().slice(0, 10),
        status: "draft",
        product_id: productId,
        product_url: item.productUrl,
        img_url: item.imageUrl,
        unit_of_measure: DEFAULT_UNIT
      })
      .select("id")
      .maybeSingle();

    if (!draftErr && draft) {
      await supabaseAdmin.from("products").update({ linked_offer_id: draft.id }).eq("id", productId);
      action = "draft_created";
    } else if (draftErr) {
      console.error("offers draft insert:", draftErr.message);
      log.errors.push({ sku: item.sku, reason: "DRAFT_ERR" });
    }
  }

  if (!isNew && priceChanged && existing?.linked_offer_id) {
    const { error } = await supabaseAdmin
      .from("offers")
      .update({ price: row.price, original_price: row.original_price, product_url: item.productUrl, updated_at: new Date().toISOString() })
      .eq("id", existing.linked_offer_id)
      .eq("store_id", store.id);
    if (!error) action = action || "offer_price_synced";
  }

  if (item.quantity === 0 && existing?.linked_offer_id) {
    const { error } = await supabaseAdmin
      .from("offers")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", existing.linked_offer_id)
      .eq("store_id", store.id)
      .eq("status", "active");
    if (!error) action = "offer_deactivated";
  }

  if (!isNew) {
    if (qtyChanged) action = action || "updated";
    log.updated++;
  }

  if (action) {
    await supabaseAdmin.from("inventory_sync_log").insert({
      store_id: store.id,
      product_sku: item.sku,
      product_name: item.name,
      quantity: item.quantity,
      action
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const cronSecret = req.headers.get("x-cron-secret");
  const { data: secretOk } = await supabaseAdmin.rpc("verify_cron_secret", { p_secret: cronSecret });
  if (!secretOk) return json({ error: "Non autorizzato." }, 401);

  let categories;
  try {
    categories = await loadCategories(supabaseAdmin);
  } catch (e) {
    console.error("Errore caricamento categorie:", e);
    return json({ error: "Elenco categorie non disponibile." }, 503);
  }

  const { data: integrations, error: intErr } = await supabaseAdmin
    .from("store_integrations")
    .select("id, store_id, platform, shop_url, secret_id, stores!inner(id, plan, subscription_status)")
    .eq("sync_mode", "pull");

  if (intErr) {
    console.error("Errore lettura store_integrations:", intErr);
    return json({ error: "Errore interno." }, 500);
  }

  const summary = { processed: 0, skipped: 0, results: [] };

  for (const integ of integrations || []) {
    summary.processed++;
    const store = integ.stores;
    const label = { store_id: integ.store_id, platform: integ.platform };

    const adapter = ADAPTERS[integ.platform];
    if (!adapter) {
      await supabaseAdmin.from("store_integrations").update({
        status: "inactive", last_error: "Connettore non ancora disponibile per questa piattaforma."
      }).eq("id", integ.id);
      summary.skipped++;
      summary.results.push({ ...label, outcome: "connettore non disponibile" });
      continue;
    }

    const planOk = (PLAN_WEIGHT[store.plan] || 0) >= PLAN_WEIGHT.Enterprise && ["trial", "active"].includes(store.subscription_status);
    if (!planOk) {
      await supabaseAdmin.from("store_integrations").update({
        status: "error", last_error: "Sincronizzazione riservata al piano Enterprise attivo."
      }).eq("id", integ.id);
      summary.skipped++;
      summary.results.push({ ...label, outcome: "piano non idoneo" });
      continue;
    }

    try {
      const { data: credsRaw } = await supabaseAdmin.rpc("get_integration_secret", { p_secret_id: integ.secret_id });
      if (!credsRaw) throw new SyncError("credenziali non trovate");
      const creds = JSON.parse(credsRaw);

      const items = (await adapter(integ.shop_url, creds)).slice(0, MAX_PRODUCTS_PER_STORE);
      const log = { created: 0, updated: 0, errors: [] };

      for (const item of items) {
        await applyProduct(supabaseAdmin, store, categories, item, log);
      }

      await supabaseAdmin.from("store_integrations").update({
        status: "active", last_sync_at: new Date().toISOString(), last_error: null
      }).eq("id", integ.id);

      summary.results.push({ ...label, outcome: "ok", ...log, total: items.length });
    } catch (e) {
      console.error(`Errore sync ${integ.platform} per store ${integ.store_id}:`, e);
      // Solo i messaggi scritti da noi (SyncError) arrivano a last_error: un errore di rete o di
      // parsing potrebbe rivelare indirizzi interni raggiunti dalla richiesta.
      const safeMsg = e instanceof SyncError ? e.message : "Sincronizzazione non riuscita. Controlla URL e credenziali del negozio.";
      await supabaseAdmin.from("store_integrations").update({
        status: "error", last_error: safeMsg.slice(0, 300)
      }).eq("id", integ.id);
      summary.results.push({ ...label, outcome: "errore", message: safeMsg });
    }
  }

  return json(summary, 200);
});
