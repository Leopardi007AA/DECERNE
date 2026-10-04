import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Proxy di geocoding con cache server-side su Postgres.
// Riduce le chiamate dirette a Nominatim da ogni browser (rischio rate-limit/IP ban
// con traffico reale) centralizzandole in un unico punto, con cache di 30 giorni.
// Richiede un JWT valido (verify_jwt attivo): può essere anche la chiave anon pubblica, quindi
// il limite di frequenza è per utente se c'è una sessione, altrimenti per IP.

// Origini da cui il sito chiama questa funzione dal browser. Nessun jolly: con "*" o con
// "*.vercel.app" qualunque pagina esterna potrebbe leggere le risposte.
const ALLOWED_ORIGINS = [
  "https://decerne.vercel.app",
  "https://www.decerne.it",
  "https://decerne.it"
];

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// IP del visitatore: lo impostano i server di Supabase (Cloudflare) e il client non può
// sovrascriverlo. x-forwarded-for NON si usa: chi chiama può scriverci quello che vuole
// e così aggirerebbe ogni limite per IP.
function getClientIp(req: Request): string {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  return ip || "sconosciuto";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  // Ogni risposta (anche errori e POST) porta gli header CORS: prima le risposte POST ne erano
  // prive e il browser le scartava, quindi la geocodifica dal frontend falliva in silenzio.
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });

  if (req.method === "OPTIONS") { return new Response("ok", { headers: cors }); }
  try {
    if (req.method !== "POST") {
      return json({ error: "Metodo non consentito" }, 405);
    }

    const body = await req.json().catch(() => null);
    const query = body?.query;
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return json({ error: "Query non valida" }, 400);
    }
    if (query.trim().length > 200) {
      return json({ error: "Query troppo lunga (massimo 200 caratteri)" }, 400);
    }

    const normalizedQuery = query.trim().toLowerCase();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Identifica il chiamante dal token. Con la chiave anon (nessun utente) il limite va per IP:
    // prima tutti i chiamanti anonimi condividevano la stessa chiave e uno solo esauriva il limite
    // per tutti gli altri.
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    const rateKey = userData?.user?.id || ("ip:" + getClientIp(req));

    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "geocode", p_key: rateKey, p_max_attempts: 20, p_window_seconds: 60, p_block_seconds: 300
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (geocode):", rlError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!rl?.allowed) {
      return json({ error: "Troppe richieste. Riprova più tardi." }, 429);
    }

    // 1. Cache hit? (valida 30 giorni)
    const { data: cached } = await supabaseAdmin
      .from("geocode_cache")
      .select("lat, lng, cached_at")
      .eq("query", normalizedQuery)
      .maybeSingle();

    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (cached && new Date(cached.cached_at).getTime() > thirtyDaysAgoMs) {
      return json({ lat: cached.lat, lng: cached.lng, cached: true });
    }

    // Tetto globale sulle sole richieste che arrivano davvero a Nominatim (cache miss): la sua
    // policy consente al massimo 1 richiesta al secondo in totale.
    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "geocode-global", p_key: "all", p_max_attempts: 50, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (geocode-global):", glError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!gl?.allowed) {
      return json({ error: "Servizio occupato. Riprova tra qualche secondo." }, 429);
    }

    // 2. Cache miss: interroga Nominatim (User-Agent obbligatorio per la sua usage policy)
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(normalizedQuery)}`,
      { headers: { "User-Agent": "DecerneApp/1.0 (support@decerne.it)", "Accept-Language": "it" }, signal: AbortSignal.timeout(6000) }
    );

    if (!nomRes.ok) {
      return json({ lat: null, lng: null });
    }

    const results = await nomRes.json();
    if (!results || !results[0]) {
      return json({ lat: null, lng: null });
    }

    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ lat: null, lng: null });
    }

    // 3. Salva in cache per le prossime richieste sulla stessa query
    await supabaseAdmin
      .from("geocode_cache")
      .upsert({ query: normalizedQuery, lat, lng, cached_at: new Date().toISOString() });

    return json({ lat, lng, cached: false });
  } catch (e) {
    console.error("Errore geocode:", e);
    return json({ error: "Errore interno" }, 500);
  }
});
