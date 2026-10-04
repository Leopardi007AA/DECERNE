import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// API Sincronizzazione Magazzino (/functions/v1/inventory-sync) — riservata a store Enterprise.
// Riceve dal gestionale/POS del negozio lo stato di uno o più prodotti (quantità, prezzo) e:
//  - aggiorna (o crea) la riga corrispondente in "products"
//  - se è un prodotto NUOVO con scorta > 0, crea automaticamente un'offerta in bozza (status
//    'draft') collegata, che il partner deve approvare/completare dal Pannello Partner prima
//    che diventi visibile ai clienti — mai pubblicazione diretta senza controllo umano
//  - se il prodotto esiste già ed è collegato a un'offerta, un nuovo prezzo/prezzo originale
//    aggiorna anche l'offerta collegata (bozza/pausa restano tali, non vengono pubblicate)
//  - se la quantità arriva a 0 e il prodotto ha un'offerta collegata attiva, la mette in pausa
//  - registra ogni evento in "inventory_sync_log" (storico + idempotenza)
// Autenticazione via header "x-api-key" (stessa chiave usata da /offers), NON un JWT Supabase:
// per questo la funzione è deployata con verify_jwt disabilitato e fa da sé tutti i controlli.
// La chiave nel database è salvata come hash SHA-256 (mai in chiaro): confrontiamo l'hash.
//
// Campi obbligatori per un prodotto NUOVO: sku, name, price, category, quantity.
// Per un aggiornamento bastano sku e quantity. Tutti i campi presenti vengono validati in modo
// rigoroso; un elemento non valido viene scartato con l'elenco dei motivi, senza bloccare gli altri.

const PLAN_WEIGHT = { Starter: 1, Standard: 2, Professional: 3, Enterprise: 4 };
const VALID_UNITS = new Set(["pezzo", "kg", "hg", "g", "litro", "confezione"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRODUCT_LEN = 150;
const MAX_PRICE = 99999.99;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// Hash SHA-256 esadecimale della chiave ricevuta, da confrontare con stores.api_key (solo hash).
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Autentica la api_key (via hash) e ritorna lo store proprietario (stessa logica di /offers) ---
async function authenticateApiKey(supabaseAdmin, req) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return { error: json({ error: "Header x-api-key mancante." }, 401) };

  const keyHash = await sha256Hex(apiKey);
  const { data: store, error } = await supabaseAdmin
    .from("stores")
    .select("id, plan, subscription_status")
    .eq("api_key", keyHash)
    .maybeSingle();

  if (error || !store) return { error: json({ error: "API Key non valida." }, 401) };
  if (!["trial", "active"].includes(store.subscription_status)) {
    return { error: json({ error: "Abbonamento non attivo: integrazione sospesa." }, 403) };
  }
  return { store };
}

// --- Rate limiting atomico (stessa RPC condivisa con /offers, tabella separata dal pannello) ---
// "cost" permette di contare gli elementi elaborati e non solo le richieste.
async function checkRateLimit(supabaseAdmin, scope, key, maxAttempts, windowSeconds, blockSeconds, cost = 1) {
  const { data, error } = await supabaseAdmin.rpc("check_api_rate_limit", {
    p_scope: scope, p_key: key, p_max_attempts: maxAttempts, p_window_seconds: windowSeconds, p_block_seconds: blockSeconds, p_cost: cost
  });
  if (error) {
    console.error("Errore RPC check_api_rate_limit:", error);
    return json({ error: "Servizio temporaneamente non disponibile." }, 503);
  }
  if (!data?.allowed) {
    return json({ error: "Troppe richieste. Riprova più tardi." }, 429);
  }
  return null;
}

// L'IP si legge solo dagli header impostati dall'edge di Supabase: x-forwarded-for
// lo scrive il client e permetterebbe di aggirare il limite cambiando valore a ogni richiesta.
function getClientIp(req) {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  return ip ? ip.slice(0, 64) : "sconosciuto";
}

function requirePlan(store, minPlan) {
  const weight = PLAN_WEIGHT[store.plan] || 0;
  if (weight < PLAN_WEIGHT[minPlan]) {
    return json({ error: `Funzionalità riservata al piano ${minPlan} o superiore.` }, 403);
  }
  return null;
}

// --- Categorie ufficiali (tabella offer_categories, stessa lista del form nel pannello) ---
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

// --- Helper di validazione ---
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const isMissing = (v) => v === undefined || v === null;

// Numero JSON oppure stringa numerica con il punto decimale ("1.19"). Tutto il resto è NaN.
function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

// Prezzo valido: > 0, massimo 99999.99, al massimo 2 decimali. Ritorna il numero oppure null (e aggiunge l'errore).
function checkPrice(value, label, errors) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n <= 0) { errors.push(`'${label}' deve essere un numero maggiore di 0`); return null; }
  if (n > MAX_PRICE) { errors.push(`'${label}' troppo alto (massimo ${MAX_PRICE})`); return null; }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) { errors.push(`'${label}' ammette al massimo 2 decimali`); return null; }
  return Math.round(n * 100) / 100;
}

// Categoria: se presente deve essere una di quelle ufficiali (senza distinguere maiuscole/minuscole).
function checkCategory(value, categories, required, errors) {
  if (isMissing(value) || value === "") {
    if (required) errors.push("campo 'category' mancante (obbligatorio: elenco valido con GET /offers/categories)");
    return null;
  }
  const canonical = typeof value === "string" ? categories.byLower.get(value.trim().toLowerCase()) : undefined;
  if (!canonical) {
    errors.push(`'category' non valida (${JSON.stringify(value)}): usa una delle categorie DECERNE, elenco con GET /offers/categories`);
    return null;
  }
  return canonical;
}

function checkLocationFormat(value, errors) {
  if (isMissing(value) || value === "") return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) { errors.push("'location_id' non è un UUID valido"); return null; }
  return value;
}

// --- Valida un singolo evento in arrivo dal gestionale ---
function validateSyncItem(item, categories) {
  if (!isPlainObject(item)) return { errors: ["elemento non valido: atteso un oggetto JSON"] };
  const errors = [];

  const sku = typeof item.sku === "string" ? item.sku.trim() : "";
  if (!sku || sku.length > 64) errors.push("campo 'sku' mancante o non valido (testo di 1-64 caratteri)");

  let quantity = NaN;
  if (typeof item.quantity === "number") quantity = item.quantity;
  else if (typeof item.quantity === "string" && /^\d+$/.test(item.quantity.trim())) quantity = Number(item.quantity.trim());
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) {
    errors.push("campo 'quantity' mancante o non valido (numero intero da 0 a 1000000)");
  }

  let name = "";
  if (!isMissing(item.name)) {
    if (typeof item.name !== "string" || !item.name.trim()) errors.push("'name' deve essere un testo non vuoto");
    else if (item.name.trim().length > MAX_PRODUCT_LEN) errors.push(`'name' troppo lungo (massimo ${MAX_PRODUCT_LEN} caratteri)`);
    else name = item.name.trim();
  }

  const price = isMissing(item.price) ? null : checkPrice(item.price, "price", errors);
  let originalPrice = null;
  if (!isMissing(item.original_price)) {
    originalPrice = checkPrice(item.original_price, "original_price", errors);
    if (isMissing(item.price)) errors.push("'original_price' richiede anche 'price'");
    else if (originalPrice !== null && price !== null && originalPrice < price) errors.push("'original_price' non può essere inferiore a 'price'");
  }

  const locationId = checkLocationFormat(item.location_id, errors);
  if (!isMissing(item.unit_of_measure) && !VALID_UNITS.has(item.unit_of_measure)) {
    errors.push(`'unit_of_measure' non valido (ammessi: ${[...VALID_UNITS].join(", ")})`);
  }
  const category = checkCategory(item.category, categories, false, errors);

  let externalEventId = null;
  if (!isMissing(item.external_event_id) && item.external_event_id !== "") {
    const s = String(item.external_event_id);
    if (typeof item.external_event_id === "object" || s.length > 100) errors.push("'external_event_id' deve essere un testo di massimo 100 caratteri");
    else externalEventId = s;
  }

  if (errors.length) return { errors };

  return {
    sku, name, quantity, price, originalPrice, category, locationId,
    unitOfMeasure: isMissing(item.unit_of_measure) ? null : item.unit_of_measure,
    externalEventId
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo non consentito." }, 405);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Limite per IP PRIMA di interrogare il DB per validare la api_key.
  const clientIp = getClientIp(req);
  const preAuthLimit = await checkRateLimit(supabaseAdmin, "inventory_preauth_ip", clientIp, 30, 60, 300);
  if (preAuthLimit) return preAuthLimit;

  const authResult = await authenticateApiKey(supabaseAdmin, req);
  if (authResult.error) return authResult.error;
  const store = authResult.store;

  // Riservata a Enterprise, come da richiesta originale.
  const planError = requirePlan(store, "Enterprise");
  if (planError) return planError;

  const rateLimitError = await checkRateLimit(supabaseAdmin, "inventory_api", store.id, 120, 60, 300);
  if (rateLimitError) return rateLimitError;

  const body = await req.json().catch(() => null);
  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];

  if (!items.length || !items[0]) return json({ error: "Nessun prodotto ricevuto." }, 400);
  if (items.length > 100) return json({ error: "Massimo 100 prodotti per singola richiesta (per richieste più grandi, dividi in più chiamate)." }, 400);

  // Limite sul LAVORO reale: ogni prodotto costa diverse query, quindi contiamo gli elementi
  // (massimo 500 prodotti/minuto per store).
  const itemsLimit = await checkRateLimit(supabaseAdmin, "inventory_items", store.id, 500, 60, 300, items.length);
  if (itemsLimit) return itemsLimit;

  let categories;
  try {
    categories = await loadCategories(supabaseAdmin);
  } catch (e) {
    console.error("Errore caricamento categorie:", e);
    return json({ error: "Elenco categorie non disponibile, riprova." }, 503);
  }

  // Sedi valide per questo store, per assegnare la sede alla bozza d'offerta (stessa logica di /offers).
  const { data: locations } = await supabaseAdmin
    .from("store_locations")
    .select("id")
    .eq("store_id", store.id);
  const validLocationIds = new Set((locations || []).map((l) => l.id));
  const defaultLocationId = validLocationIds.size === 1 ? [...validLocationIds][0] : null;

  const results = { updated: 0, created: 0, drafts_created: 0, offers_price_synced: 0, deactivated: 0, skipped: 0, errors: [] };

  try {
    for (let i = 0; i < items.length; i++) {
      const parsed = validateSyncItem(items[i], categories);
      if (parsed.errors) {
        results.errors.push({ index: i, sku: isPlainObject(items[i]) ? (items[i].sku ?? null) : null, reasons: parsed.errors });
        continue;
      }

      // Una sede indicata deve appartenere a questo store (vale anche per i semplici aggiornamenti).
      if (parsed.locationId && !validLocationIds.has(parsed.locationId)) {
        results.errors.push({ index: i, sku: parsed.sku, reasons: ["'location_id' non appartiene a questo store"] });
        continue;
      }

      // Idempotenza: se questo evento (store + external_event_id) è già stato loggato, saltalo.
      if (parsed.externalEventId) {
        const { data: existingLog } = await supabaseAdmin
          .from("inventory_sync_log")
          .select("id")
          .eq("store_id", store.id)
          .eq("external_event_id", parsed.externalEventId)
          .maybeSingle();
        if (existingLog) {
          results.skipped++;
          continue;
        }
      }

      const { data: existingProduct } = await supabaseAdmin
        .from("products")
        .select("id, linked_offer_id, price, original_price, name")
        .eq("store_id", store.id)
        .eq("sku", parsed.sku)
        .maybeSingle();

      const row = {
        store_id: store.id,
        sku: parsed.sku,
        quantity: parsed.quantity,
        source: "sync",
        updated_at: new Date().toISOString()
      };
      if (parsed.locationId) row.location_id = parsed.locationId;
      if (parsed.unitOfMeasure) row.unit_of_measure = parsed.unitOfMeasure;
      if (parsed.category) row.category = parsed.category;

      let productId = existingProduct?.id ?? null;
      let isNewProduct = false;
      const priceChanged = existingProduct && (
        (parsed.price !== null && parsed.price !== existingProduct.price) ||
        (parsed.originalPrice !== null && parsed.originalPrice !== existingProduct.original_price)
      );

      if (existingProduct) {
        row.name = parsed.name || existingProduct.name;
        row.price = parsed.price ?? existingProduct.price;
        row.original_price = parsed.originalPrice ?? existingProduct.original_price ?? row.price;

        const { error: updErr } = await supabaseAdmin.from("products").update(row).eq("id", existingProduct.id);
        if (updErr) {
          console.error("Errore UPDATE /inventory-sync products (index " + i + "):", updErr);
          results.errors.push({ index: i, sku: parsed.sku, reasons: ["Errore interno durante l'aggiornamento del prodotto (codice DB_UPDATE_ERR). Riprova o contatta l'assistenza se persiste."] });
          continue;
        }
        results.updated++;
      } else {
        const missing = [];
        if (!parsed.name) missing.push("campo 'name' obbligatorio per un prodotto nuovo");
        if (parsed.price === null) missing.push("campo 'price' obbligatorio per un prodotto nuovo");
        if (!parsed.category) missing.push("campo 'category' obbligatorio per un prodotto nuovo (elenco valido con GET /offers/categories)");
        if (missing.length) {
          results.errors.push({ index: i, sku: parsed.sku, reasons: missing });
          continue;
        }
        row.name = parsed.name;
        row.price = parsed.price;
        row.original_price = parsed.originalPrice ?? parsed.price;

        const { data: inserted, error: insErr } = await supabaseAdmin.from("products").insert(row).select("id").maybeSingle();
        if (insErr) {
          console.error("Errore INSERT /inventory-sync products (index " + i + "):", insErr);
          results.errors.push({ index: i, sku: parsed.sku, reasons: ["Errore interno durante la creazione del prodotto (codice DB_INSERT_ERR). Riprova o contatta l'assistenza se persiste."] });
          continue;
        }
        results.created++;
        productId = inserted?.id ?? null;
        isNewProduct = true;
      }

      // Prodotto nuovo con scorta disponibile -> creiamo una BOZZA d'offerta collegata.
      // Resta invisibile ai clienti (status 'draft') finché il partner non la rivede e pubblica
      // dal Pannello Partner (dove può completare descrizione, immagine, tessera ecc.
      // — campi che il gestionale non manda e che qui restiamo senza toccare).
      let action = "updated";
      if (isNewProduct && productId && parsed.quantity > 0) {
        const locationId = parsed.locationId || defaultLocationId;
        if (locationId && validLocationIds.has(locationId)) {
          const today = new Date().toISOString().slice(0, 10);
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + 30);

          const { data: draftOffer, error: draftErr } = await supabaseAdmin
            .from("offers")
            .insert({
              store_id: store.id,
              location_id: locationId,
              product: row.name,
              price: row.price,
              original_price: row.original_price,
              category: parsed.category,
              start_date: today,
              end_date: endDate.toISOString().slice(0, 10),
              status: "draft",
              product_id: productId,
              ...(parsed.unitOfMeasure ? { unit_of_measure: parsed.unitOfMeasure } : {})
            })
            .select("id")
            .maybeSingle();

          if (!draftErr && draftOffer) {
            await supabaseAdmin.from("products").update({ linked_offer_id: draftOffer.id }).eq("id", productId);
            results.drafts_created++;
            action = "draft_created";
          } else if (draftErr) {
            console.error("Errore creazione bozza offerta /inventory-sync (index " + i + "):", draftErr);
            results.errors.push({ index: i, sku: parsed.sku, reasons: ["Prodotto creato ma creazione automatica della bozza offerta fallita (codice DB_DRAFT_ERR). Puoi crearla manualmente dal Pannello Partner."] });
          }
        } else {
          results.errors.push({ index: i, sku: parsed.sku, reasons: ["prodotto creato ma nessuna bozza offerta: 'location_id' mancante o non valido e lo store ha più sedi"] });
        }
      }

      // Prodotto già esistente, collegato a un'offerta, con un prezzo diverso dal precedente ->
      // aggiorniamo anche l'offerta collegata (mai lo stato: bozza/pausa restano tali).
      if (!isNewProduct && priceChanged && existingProduct?.linked_offer_id) {
        const { error: offerPriceErr } = await supabaseAdmin
          .from("offers")
          .update({ price: row.price, original_price: row.original_price, updated_at: new Date().toISOString() })
          .eq("id", existingProduct.linked_offer_id)
          .eq("store_id", store.id);
        if (!offerPriceErr) {
          results.offers_price_synced++;
          if (action === "updated") action = "offer_price_synced";
        }
      }

      // Scorta esaurita + offerta collegata attiva -> la mettiamo in pausa (non la cancelliamo:
      // se il prodotto torna disponibile, il partner può riattivarla dal Pannello Partner).
      if (parsed.quantity === 0 && existingProduct?.linked_offer_id) {
        const { error: offerErr } = await supabaseAdmin
          .from("offers")
          .update({ status: "paused", updated_at: new Date().toISOString() })
          .eq("id", existingProduct.linked_offer_id)
          .eq("store_id", store.id)
          .eq("status", "active");
        if (!offerErr) {
          results.deactivated++;
          action = "offer_deactivated";
        }
      }

      const { error: logErr } = await supabaseAdmin.from("inventory_sync_log").insert({
        store_id: store.id,
        product_sku: parsed.sku,
        product_name: parsed.name || existingProduct?.name || null,
        quantity: parsed.quantity,
        action,
        external_event_id: parsed.externalEventId
      });
      if (logErr) console.error("Errore scrittura inventory_sync_log:", logErr.message);
    }

    const { data: updatedIntegration } = await supabaseAdmin
      .from("store_integrations")
      .update({ last_sync_at: new Date().toISOString(), status: "active" })
      .eq("store_id", store.id)
      .select("id");

    if (!updatedIntegration || updatedIntegration.length === 0) {
      // Prima sincronizzazione in assoluto per questo store: la riga di config non esiste ancora.
      await supabaseAdmin.from("store_integrations").insert({
        store_id: store.id,
        provider: "non specificato",
        status: "active",
        last_sync_at: new Date().toISOString()
      });
    }

    const totalOk = results.created + results.updated + results.skipped;
    const status = totalOk === 0 ? 400 : (results.errors.length > 0 ? 207 : 200);
    return json(results, status);
  } catch (e) {
    console.error("Errore /inventory-sync:", e);
    return json({ error: "Errore interno del server." }, 500);
  }
});
