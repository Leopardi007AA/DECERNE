// backend/src/index.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "https://www.decerne.it" }));
app.use(express.json({ limit: "2mb" })); // aumentato per import massivi via API partner

// Client "pubblico": rispetta le regole RLS come un utente vero.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
);

// Client con privilegi di servizio: SOLO lato server, mai esposto al browser.
// Bypassa le RLS — serve per operazioni admin come la cancellazione utenti.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// --- Endpoint di controllo: il server è vivo? ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend Decerne attivo" });
});

// --- Endpoint: cancellazione definitiva account utente ---
app.post("/api/delete-account", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Token mancante." });
    }

    // 1. Verifica che il token sia valido e recupera l'utente reale
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: "Sessione non valida." });
    }
    const userId = userData.user.id;

    // 2. Elimina i dati applicativi collegati (profilo, ecc.)
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // 3. Elimina davvero l'utente da auth.users
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return res.json({ success: true });
  } catch (err) {
    console.error("Errore eliminazione account:", err);
    return res.status(500).json({ error: "Errore durante l'eliminazione dell'account." });
  }
});

// ==========================================================================
// API PARTNER (/v1/...) — integrazione gestionali supermercati
// Autenticazione via header "x-api-key". Nessuna sessione utente coinvolta:
// per questo si usa sempre supabaseAdmin, ma OGNI query è filtrata a mano
// per store_id ricavato dalla api_key, quindi un partner non può mai
// leggere o modificare dati di un altro store.
// ==========================================================================

const PLAN_WEIGHT = { Starter: 1, Standard: 2, Professional: 3, Enterprise: 4 };

// --- Middleware 1: valida la api_key e recupera lo store proprietario ---
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Header x-api-key mancante." });
  }

  const { data: store, error } = await supabaseAdmin
    .from("stores")
    .select("id, plan, subscription_status")
    .eq("api_key", apiKey)
    .maybeSingle();

  if (error || !store) {
    return res.status(401).json({ error: "API Key non valida." });
  }
  if (!["trial", "active"].includes(store.subscription_status)) {
    return res.status(403).json({ error: "Abbonamento non attivo: integrazione sospesa." });
  }

  req.store = store; // { id, plan, subscription_status }
  next();
}

// --- Middleware 2: rate limiting per store (riusa la tabella rate_limits già esistente) ---
async function checkRateLimit(req, res, next) {
  const MAX_REQUESTS = 120;   // richieste massime per finestra
  const WINDOW_MS = 60 * 1000; // finestra di 60 secondi
  const BLOCK_MS = 5 * 60 * 1000; // blocco di 5 minuti se superato

  try {
    const storeId = req.store.id;
    const now = new Date();

    const { data: rl } = await supabaseAdmin
      .from("rate_limits")
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();

    if (rl?.blocked_until && new Date(rl.blocked_until) > now) {
      return res.status(429).json({ error: "Troppe richieste. Riprova più tardi." });
    }

    if (!rl || (now - new Date(rl.window_start)) > WINDOW_MS) {
      await supabaseAdmin.from("rate_limits").upsert({
        store_id: storeId, attempts: 1, window_start: now.toISOString(), blocked_until: null
      });
      return next();
    }

    const attempts = rl.attempts + 1;
    if (attempts > MAX_REQUESTS) {
      const blockedUntil = new Date(now.getTime() + BLOCK_MS);
      await supabaseAdmin.from("rate_limits").upsert({
        store_id: storeId, attempts, window_start: rl.window_start, blocked_until: blockedUntil.toISOString()
      });
      return res.status(429).json({ error: "Limite richieste superato. Riprova tra 5 minuti." });
    }

    await supabaseAdmin.from("rate_limits").upsert({
      store_id: storeId, attempts, window_start: rl.window_start
    });
    next();
  } catch (err) {
    console.error("Errore rate limiting:", err);
    next(); // non blocchiamo il servizio per un errore del contatore
  }
}

// --- Middleware 3: richiede un piano minimo (Enterprise per scrittura, ecc.) ---
function requirePlan(minPlan) {
  return (req, res, next) => {
    const weight = PLAN_WEIGHT[req.store.plan] || 0;
    if (weight < PLAN_WEIGHT[minPlan]) {
      return res.status(403).json({ error: `Funzionalità riservata al piano ${minPlan} o superiore.` });
    }
    next();
  };
}

// --- Valida e normalizza un singolo prodotto in ingresso ---
// Cuore della logica "filtro automatico": qui si decide se un prodotto
// diventa un'OFFERTA (con sconto, original_price > price) o un ANNUNCIO
// normale (original_price = price, nessun badge sconto in UI).
function validateAndNormalizeOffer(item, storeId, validLocationIds, defaultLocationId) {
  const errors = [];

  const product = typeof item?.product === "string" ? item.product.trim() : "";
  if (!product) errors.push("campo 'product' mancante o non valido");

  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("campo 'price' mancante o non valido");

  let originalPrice = item?.original_price !== undefined && item?.original_price !== null
    ? Number(item.original_price)
    : price;
  if (!Number.isFinite(originalPrice) || originalPrice < price) {
    originalPrice = price; // fallback di sicurezza: diventa un annuncio normale, mai un errore
  }

  const locationId = item?.location_id || defaultLocationId;
  if (!locationId) {
    errors.push("campo 'location_id' mancante (e lo store ha più di una sede, serve specificarla)");
  } else if (!validLocationIds.has(locationId)) {
    errors.push("'location_id' non appartiene a questo store");
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = item?.start_date || today;
  let endDate = item?.end_date;
  if (!endDate) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    endDate = d.toISOString().slice(0, 10);
  }
  if (new Date(endDate) < new Date(startDate)) {
    errors.push("'end_date' precedente a 'start_date'");
  }

  if (errors.length) return { errors };

  const row = {
    store_id: storeId,
    location_id: locationId,
    product,
    price,
    original_price: originalPrice,
    start_date: startDate,
    end_date: endDate,
    status: "active",
    limited_quantity: !!item?.limited_quantity
  };
  if (item?.category) row.category = String(item.category);
  if (item?.description) row.description = String(item.description).trim();
  if (item?.img_url) row.img_url = String(item.img_url).trim();

  return { row, isOffer: originalPrice > price };
}

const apiV1 = express.Router();
apiV1.use(authenticateApiKey, checkRateLimit);

// GET /v1/offers — lista le offerte/annunci attivi del partner (Professional+)
apiV1.get("/offers", requirePlan("Professional"), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("offers")
    .select("*")
    .eq("store_id", req.store.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Errore GET /v1/offers:", error);
    return res.status(500).json({ error: "Errore nel recupero delle offerte." });
  }
  res.json({ data });
});

// POST /v1/offers — crea/aggiorna prodotti in massa (Enterprise)
// Body: singolo oggetto, oppure { "items": [ {...}, {...} ] }
apiV1.post("/offers", requirePlan("Enterprise"), async (req, res) => {
  const items = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.items)
      ? req.body.items
      : [req.body];

  if (!items.length) {
    return res.status(400).json({ error: "Nessun prodotto ricevuto." });
  }
  if (items.length > 500) {
    return res.status(400).json({ error: "Massimo 500 prodotti per singola richiesta." });
  }

  const { data: locations } = await supabaseAdmin
    .from("store_locations")
    .select("id")
    .eq("store_id", req.store.id);

  const validLocationIds = new Set((locations || []).map(l => l.id));
  const defaultLocationId = validLocationIds.size === 1 ? [...validLocationIds][0] : null;

  const results = { created: 0, updated: 0, offers: 0, annunci: 0, errors: [] };

  for (let i = 0; i < items.length; i++) {
    const parsed = validateAndNormalizeOffer(items[i], req.store.id, validLocationIds, defaultLocationId);
    if (parsed.errors) {
      results.errors.push({ index: i, product: items[i]?.product ?? null, reasons: parsed.errors });
      continue;
    }

    const { row, isOffer } = parsed;

    // Filtro/dedup: stesso prodotto nella stessa sede già attivo -> aggiorna invece di duplicare
    const { data: existing } = await supabaseAdmin
      .from("offers")
      .select("id")
      .eq("store_id", req.store.id)
      .eq("location_id", row.location_id)
      .ilike("product", row.product)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("offers")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) results.errors.push({ index: i, product: row.product, reasons: [error.message] });
      else { results.updated++; isOffer ? results.offers++ : results.annunci++; }
    } else {
      const { error } = await supabaseAdmin.from("offers").insert(row);
      if (error) results.errors.push({ index: i, product: row.product, reasons: [error.message] });
      else { results.created++; isOffer ? results.offers++ : results.annunci++; }
    }
  }

  const totalOk = results.created + results.updated;
  const status = totalOk === 0 ? 400 : (results.errors.length > 0 ? 207 : 201);
  res.status(status).json(results);
});

// DELETE /v1/offers/:id — cancellazione, coerente col resto dell'app (soft delete) (Enterprise)
apiV1.delete("/offers/:id", requirePlan("Enterprise"), async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("offers")
    .update({ deleted_at: new Date().toISOString(), status: "expired" })
    .eq("id", id)
    .eq("store_id", req.store.id) // un partner può cancellare SOLO le proprie offerte
    .select()
    .maybeSingle();

  if (error) {
    console.error("Errore DELETE /v1/offers:", error);
    return res.status(500).json({ error: "Errore durante la cancellazione." });
  }
  if (!data) {
    return res.status(404).json({ error: "Offerta non trovata o non appartenente a questo store." });
  }
  res.json({ success: true });
});

app.use("/v1", apiV1);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Decerne backend in ascolto su http://localhost:${PORT}`);
});
