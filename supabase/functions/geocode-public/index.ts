import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Centro indicativo di un CAP o di una città, per la mappa demo del tour guidato.
// Pubblica (verify_jwt disattivo) perché il tour lo vedono anche i visitatori senza account.
// Non salva nulla e non accetta indirizzi completi: serve solo un punto approssimativo.
// Usa Photon (Komoot, basato su OpenStreetMap): Nominatim rifiuta gli IP dei server cloud.
// Risposta: { lat, lng } oppure { lat: null, lng: null }.

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
  const empty = { lat: null, lng: null };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

    const body = await req.json().catch(() => null);
    const q = typeof body?.query === "string" ? body.query.trim() : "";
    if (q.length < 2 || q.length > 80) return json({ error: "Ricerca non valida" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const ip = getClientIp(req);
    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "geocode-public", p_key: ip, p_max_attempts: 10, p_window_seconds: 60, p_block_seconds: 300, p_cost: 1
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (geocode-public):", rlError);
      return json(empty, 503);
    }
    if (!rl?.allowed) return json(empty, 429);

    // Tetto globale sul servizio esterno (Photon): oltre soglia si risponde "nessun punto",
    // il tour mostra la mappa senza marcatore invece di rischiare il blocco per tutti.
    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "geocode-public-global", p_key: "all", p_max_attempts: 60, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (geocode-public-global):", glError);
      return json(empty, 503);
    }
    if (!gl?.allowed) return json(empty, 429);

    // bbox = riquadro dell'Italia (ovest,sud,est,nord)
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=it&bbox=6.6,35.4,18.6,47.2`;
    const res = await fetch(url, {
      headers: { "User-Agent": "DecerneApp/1.0 (support@decerne.it)" },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) {
      console.error("Photon non ok:", res.status);
      return json(empty);
    }

    const coords = (await res.json())?.features?.[0]?.geometry?.coordinates;
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json(empty);
    return json({ lat, lng });
  } catch (e) {
    console.error("Errore geocode-public:", String(e));
    return json(empty);
  }
});
