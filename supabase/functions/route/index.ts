import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Proxy per il calcolo dei percorsi (OSRM). Il browser non contatta più il server OSRM:
// il fornitore vede solo l'IP del server, non quello dell'utente. Funzione pubblica
// (verify_jwt disattivo) perché il percorso si usa anche senza account.
// Per passare a un provider con contratto o a un OSRM proprio basta impostare il secret
// OSRM_BASE_URL (es. https://mio-osrm.example.com), senza toccare il sito.
// NB: il server demo router.project-osrm.org non è pensato per un uso in produzione.

const ALLOWED_ORIGINS = [
  "https://decerne.vercel.app",
  "https://www.decerne.it",
  "https://decerne.it"
];

const MAX_POINTS = 12;

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
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
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

    const body = await req.json().catch(() => null);
    const points = body?.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) {
      return json({ error: "Punti non validi" }, 400);
    }
    const clean: { lat: number; lng: number }[] = [];
    for (const p of points) {
      const lat = Number(p?.lat);
      const lng = Number(p?.lng);
      // Solo coordinate plausibili per l'Italia
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35 || lat > 48 || lng < 6 || lng > 19) {
        return json({ error: "Coordinate non valide" }, 400);
      }
      clean.push({ lat, lng });
    }
    const steps = body?.steps === true;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Il ricalcolo in navigazione parte ogni 20 s (ogni 3 s dopo una deviazione):
    // 40 richieste al minuto per IP bastano con margine, ma fermano un uso abusivo.
    const ip = getClientIp(req);
    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "route", p_key: ip, p_max_attempts: 40, p_window_seconds: 60, p_block_seconds: 120, p_cost: 1
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (route):", rlError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!rl?.allowed) return json({ error: "Troppe richieste. Riprova più tardi." }, 429);

    // Tetto globale sul servizio esterno: oltre soglia rischiamo il blocco dell'IP del server
    // da parte del fornitore, che toglierebbe i percorsi a tutti gli utenti.
    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "route-global", p_key: "all", p_max_attempts: 120, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (route-global):", glError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!gl?.allowed) return json({ error: "Servizio occupato. Riprova tra qualche secondo." }, 429);

    const base = (Deno.env.get("OSRM_BASE_URL") || "https://router.project-osrm.org").replace(/\/+$/, "");
    const coords = clean.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson${steps ? "&steps=true" : ""}`;

    const upstream = await fetch(url, {
      headers: { "User-Agent": "DecerneApp/1.0 (support@decerne.it)", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) {
      console.error("OSRM non ok:", upstream.status);
      return json({ error: "Routing non disponibile" }, 502);
    }

    const data = await upstream.json();
    if (data?.code !== "Ok" || !Array.isArray(data.routes)) {
      return json({ routes: [] });
    }
    return json({ routes: data.routes });
  } catch (e) {
    console.error("Errore route:", e);
    return json({ error: "Errore interno" }, 500);
  }
});
