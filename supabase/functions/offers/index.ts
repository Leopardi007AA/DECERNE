import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// API Partner (/functions/v1/offers) — integrazione gestionali supermercati.
// Autenticazione via header "x-api-key" (NON un JWT Supabase): per questo la
// funzione è deployata con verify_jwt disabilitato e fa da sé tutti i controlli.
// La chiave nel database è salvata come hash SHA-256 (mai in chiaro): confrontiamo
// l'hash di quella ricevuta, non il testo. Ogni query è filtrata a mano per store_id
// ricavato dalla chiave, quindi un partner non può mai leggere o modificare dati di un altro store.
//
// Campi obbligatori del POST: product, price, category (+ location_id se lo store ha più sedi).
// Tutti i campi presenti vengono validati in modo rigoroso; una riga non valida viene scartata
// con l'elenco dei motivi, senza bloccare le altre righe della stessa richiesta.

const PLAN_WEIGHT = { Starter: 1, Standard: 2, Professional: 3, Enterprise: 4 };
const VALID_UNITS = new Set(["pezzo", "kg", "hg", "g", "litro", "confezione"]);
const VALID_CARD_REQUIREMENTS = new Set(["required", "not_required"]);
const VALID_STATUSES = new Set(["active", "draft", "paused", "expired"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PRODUCT_LEN = 150;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_URL_LEN = 2000;
const MAX_PRICE = 99999.99;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// Hash SHA-256 esadecimale della chiave ricevuta: è questo che confrontiamo con
// la colonna stores.api_key, che dal momento della messa in sicurezza contiene
// solo hash e mai più il testo in chiaro della chiave.
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Escapa i caratteri jolly di LIKE/ILIKE (%, _ e \) così il nome prodotto
// viene confrontato alla lettera (es. "Succo 100% frutta").
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

// --- Autentica la api_key (via hash) e ritorna lo store proprietario ---
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

// --- Rate limiting atomico (RPC dedicata, tabella separata da quella del pannello) ---
// A differenza della versione precedente (select + upsert separati, con corsa critica e
// fail-open in caso d'errore), qui un solo statement atomico decide tutto, e un errore
// del contatore blocca la richiesta invece di lasciarla passare senza limite.
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

// Limite leggero PER IP, prima ancora di interrogare il DB per validare la api_key:
// blunt le scansioni a forza bruta di chiavi API, che oggi costavano comunque una query.
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

function isRealDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function isHttpsUrl(s) {
  try { return new URL(s).protocol === "https:"; } catch { return false; }
}

// Categoria: obbligatoria quando required=true, sempre una di quelle ufficiali (senza distinguere maiuscole/minuscole).
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

// --- Valida/normalizza un prodotto: qui si decide OFFERTA (con sconto) vs ANNUNCIO normale ---
function validateAndNormalizeOffer(item, storeId, validLocationIds, defaultLocationId, categories) {
  if (!isPlainObject(item)) return { errors: ["elemento non valido: atteso un oggetto JSON"] };
  const errors = [];

  // Obbligatori: product, price, category (e location_id se lo store ha più sedi)
  let product = "";
  if (typeof item.product !== "string" || !item.product.trim()) errors.push("campo 'product' mancante o non valido");
  else {
    product = item.product.trim();
    if (product.length > MAX_PRODUCT_LEN) errors.push(`'product' troppo lungo (massimo ${MAX_PRODUCT_LEN} caratteri)`);
  }

  const price = isMissing(item.price) ? (errors.push("campo 'price' mancante"), null) : checkPrice(item.price, "price", errors);

  let originalPrice = price;
  if (!isMissing(item.original_price)) {
    const op = checkPrice(item.original_price, "original_price", errors);
    if (op !== null && price !== null && op < price) errors.push("'original_price' non può essere inferiore a 'price'");
    if (op !== null) originalPrice = op;
  }

  const category = checkCategory(item.category, categories, true, errors);

  const givenLocation = checkLocationFormat(item.location_id, errors);
  const locationId = givenLocation || defaultLocationId;
  if (!locationId) {
    if (isMissing(item.location_id) || item.location_id === "") errors.push("campo 'location_id' mancante (e lo store ha più di una sede, serve specificarla)");
  } else if (!validLocationIds.has(locationId)) {
    errors.push("'location_id' non appartiene a questo store");
  }

  if (!isMissing(item.unit_of_measure) && !VALID_UNITS.has(item.unit_of_measure)) {
    errors.push(`'unit_of_measure' non valido (ammessi: ${[...VALID_UNITS].join(", ")})`);
  }
  if (!isMissing(item.card_requirement) && !VALID_CARD_REQUIREMENTS.has(item.card_requirement)) {
    errors.push(`'card_requirement' non valido (ammessi: ${[...VALID_CARD_REQUIREMENTS].join(", ")})`);
  }
  if (!isMissing(item.limited_quantity) && typeof item.limited_quantity !== "boolean") {
    errors.push("'limited_quantity' deve essere true o false");
  }
  if (!isMissing(item.description)) {
    if (typeof item.description !== "string") errors.push("'description' deve essere un testo");
    else if (item.description.trim().length > MAX_DESCRIPTION_LEN) errors.push(`'description' troppo lunga (massimo ${MAX_DESCRIPTION_LEN} caratteri)`);
  }
  if (!isMissing(item.img_url) && item.img_url !== "") {
    if (typeof item.img_url !== "string" || item.img_url.length > MAX_URL_LEN || !isHttpsUrl(item.img_url.trim())) {
      errors.push("'img_url' deve essere un URL https valido");
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let startDate = today;
  if (!isMissing(item.start_date)) {
    if (!isRealDate(item.start_date)) errors.push("'start_date' non valida (formato AAAA-MM-GG)");
    else startDate = item.start_date;
  }
  let endDate = null;
  if (!isMissing(item.end_date)) {
    if (!isRealDate(item.end_date)) errors.push("'end_date' non valida (formato AAAA-MM-GG)");
    else endDate = item.end_date;
  } else {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    endDate = d.toISOString().slice(0, 10);
  }
  if (endDate) {
    if (endDate < startDate) errors.push("'end_date' precedente a 'start_date'");
    else if (endDate < today) errors.push("'end_date' è già passata");
  }

  if (errors.length) return { errors };

  const row = {
    store_id: storeId,
    location_id: locationId,
    product,
    price,
    original_price: originalPrice,
    category,
    start_date: startDate,
    end_date: endDate,
    status: "active",
    limited_quantity: item.limited_quantity === true
  };
  if (!isMissing(item.description) && item.description.trim()) row.description = item.description.trim();
  if (!isMissing(item.img_url) && item.img_url !== "") row.img_url = item.img_url.trim();
  if (!isMissing(item.unit_of_measure)) row.unit_of_measure = item.unit_of_measure;
  if (!isMissing(item.card_requirement)) row.card_requirement = item.card_requirement;

  return { row, isOffer: originalPrice > price };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Limite per IP PRIMA di interrogare il DB per validare la api_key: 30 tentativi/minuto,
  // blocco di 5 minuti se superato. Ferma le scansioni a forza bruta di chiavi API.
  const clientIp = getClientIp(req);
  const preAuthLimit = await checkRateLimit(supabaseAdmin, "offers_preauth_ip", clientIp, 30, 60, 300);
  if (preAuthLimit) return preAuthLimit;

  const authResult = await authenticateApiKey(supabaseAdmin, req);
  if (authResult.error) return authResult.error;
  const store = authResult.store;

  // Limite per store dopo l'autenticazione: 120 richieste/minuto, blocco di 5 minuti.
  const rateLimitError = await checkRateLimit(supabaseAdmin, "offers_api", store.id, 120, 60, 300);
  if (rateLimitError) return rateLimitError;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  const offerId = lastSegment && lastSegment !== "offers" ? lastSegment : null;

  try {
    // --- GET /offers/categories e GET /offers — Professional+ ---
    if (req.method === "GET") {
      const planError = requirePlan(store, "Professional");
      if (planError) return planError;

      // Elenco delle categorie valide per il campo "category"
      if (offerId === "categories") {
        try {
          const categories = await loadCategories(supabaseAdmin);
          return json({ data: categories.list, count: categories.list.length });
        } catch (e) {
          console.error("Errore GET /offers/categories:", e);
          return json({ error: "Elenco categorie non disponibile, riprova." }, 503);
        }
      }

      // Filtro opzionale ?status=active|draft|paused|expired (senza filtro: tutte le non eliminate)
      const statusFilter = url.searchParams.get("status");
      if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
        return json({ error: `'status' non valido (ammessi: ${[...VALID_STATUSES].join(", ")})` }, 400);
      }

      let query = supabaseAdmin
        .from("offers")
        .select("*")
        .eq("store_id", store.id)
        .is("deleted_at", null);
      if (statusFilter) query = query.eq("status", statusFilter);

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error("Errore GET /offers:", error);
        return json({ error: "Errore nel recupero delle offerte." }, 500);
      }
      return json({ data, count: data.length });
    }

    // --- POST /offers — Enterprise ---
    if (req.method === "POST") {
      const planError = requirePlan(store, "Enterprise");
      if (planError) return planError;

      const body = await req.json().catch(() => null);
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];

      if (!items.length || !items[0]) return json({ error: "Nessun prodotto ricevuto." }, 400);
      if (items.length > 100) return json({ error: "Massimo 100 prodotti per singola richiesta (per richieste più grandi, dividi in più chiamate)." }, 400);

      // Limite sul LAVORO reale, non solo sul numero di richieste: ogni prodotto costa
      // diverse query, quindi contiamo gli elementi (massimo 500 prodotti/minuto per store).
      const itemsLimit = await checkRateLimit(supabaseAdmin, "offers_items", store.id, 500, 60, 300, items.length);
      if (itemsLimit) return itemsLimit;

      let categories;
      try {
        categories = await loadCategories(supabaseAdmin);
      } catch (e) {
        console.error("Errore caricamento categorie:", e);
        return json({ error: "Elenco categorie non disponibile, riprova." }, 503);
      }

      const { data: locations } = await supabaseAdmin
        .from("store_locations")
        .select("id")
        .eq("store_id", store.id);

      const validLocationIds = new Set((locations || []).map((l) => l.id));
      const defaultLocationId = validLocationIds.size === 1 ? [...validLocationIds][0] : null;

      const results = { created: 0, updated: 0, offers: 0, annunci: 0, status_preserved: 0, errors: [] };

      for (let i = 0; i < items.length; i++) {
        const parsed = validateAndNormalizeOffer(items[i], store.id, validLocationIds, defaultLocationId, categories);
        if (parsed.errors) {
          results.errors.push({ index: i, product: isPlainObject(items[i]) ? (items[i].product ?? null) : null, reasons: parsed.errors });
          continue;
        }

        const { row, isOffer } = parsed;

        // Confronto alla lettera (case-insensitive) sul nome prodotto; se per qualche
        // motivo esistono più righe uguali si aggiorna la più recente invece di duplicare.
        const { data: existingRows } = await supabaseAdmin
          .from("offers")
          .select("id, status")
          .eq("store_id", store.id)
          .eq("location_id", row.location_id)
          .ilike("product", escapeLike(row.product))
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1);
        const existing = existingRows?.[0] ?? null;

        if (existing) {
          // Una bozza (es. creata da /inventory-sync) o un'offerta messa in pausa non
          // vengono pubblicate dall'API: aggiorniamo i dati ma manteniamo lo stato,
          // la pubblicazione resta una scelta del partner dal Pannello.
          const updateRow = { ...row, updated_at: new Date().toISOString() };
          const keepStatus = existing.status === "draft" || existing.status === "paused";
          if (keepStatus) delete updateRow.status;

          const { error } = await supabaseAdmin
            .from("offers")
            .update(updateRow)
            .eq("id", existing.id);
          if (error) {
            console.error("Errore UPDATE /offers (index " + i + "):", error);
            results.errors.push({ index: i, product: row.product, reasons: ["Errore interno durante il salvataggio (codice DB_UPDATE_ERR). Riprova o contatta l'assistenza se persiste."] });
          }
          else {
            results.updated++;
            isOffer ? results.offers++ : results.annunci++;
            if (keepStatus) results.status_preserved++;
          }
        } else {
          const { error } = await supabaseAdmin.from("offers").insert(row);
          if (error) {
            console.error("Errore INSERT /offers (index " + i + "):", error);
            results.errors.push({ index: i, product: row.product, reasons: ["Errore interno durante il salvataggio (codice DB_INSERT_ERR). Riprova o contatta l'assistenza se persiste."] });
          }
          else { results.created++; isOffer ? results.offers++ : results.annunci++; }
        }
      }

      const totalOk = results.created + results.updated;
      const status = totalOk === 0 ? 400 : (results.errors.length > 0 ? 207 : 201);
      return json(results, status);
    }

    // --- DELETE /offers/:id — Enterprise ---
    if (req.method === "DELETE") {
      const planError = requirePlan(store, "Enterprise");
      if (planError) return planError;

      if (!offerId) return json({ error: "ID offerta mancante nell'URL." }, 400);
      if (!UUID_RE.test(offerId)) return json({ error: "ID offerta non valido." }, 400);

      const { data, error } = await supabaseAdmin
        .from("offers")
        .update({ deleted_at: new Date().toISOString(), status: "expired" })
        .eq("id", offerId)
        .eq("store_id", store.id)
        .is("deleted_at", null)
        .select()
        .maybeSingle();

      if (error) {
        console.error("Errore DELETE /offers:", error);
        return json({ error: "Errore durante la cancellazione." }, 500);
      }
      if (!data) return json({ error: "Offerta non trovata o non appartenente a questo store." }, 404);
      return json({ success: true });
    }

    return json({ error: "Metodo non consentito." }, 405);
  } catch (e) {
    console.error("Errore /offers:", e);
    return json({ error: "Errore interno del server." }, 500);
  }
});
