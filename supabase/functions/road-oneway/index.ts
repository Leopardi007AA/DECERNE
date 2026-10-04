import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Dice se la strada in cui si trova l'utente è a senso unico (dati OpenStreetMap via Overpass).
// Il browser non invia più la posizione GPS a Overpass: la richiesta parte dal server.
// Risposta: { oneway: true | false | null } (null = servizio non disponibile o nessuna strada trovata).

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

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

    const body = await req.json().catch(() => null);
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35 || lat > 48 || lng < 6 || lng > 19) {
      return json({ error: "Coordinate non valide" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const ip = getClientIp(req);
    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "road-oneway", p_key: ip, p_max_attempts: 20, p_window_seconds: 60, p_block_seconds: 120, p_cost: 1
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (road-oneway):", rlError);
      return json({ oneway: null });
    }
    if (!rl?.allowed) return json({ oneway: null }, 429);

    // Tetto globale: il servizio Overpass pubblico va usato con moderazione. Se lo superiamo
    // rischiamo il blocco dell'IP del server per tutti, quindi oltre soglia si risponde "non so".
    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "road-oneway-global", p_key: "all", p_max_attempts: 60, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (road-oneway-global):", glError);
      return json({ oneway: null });
    }
    if (!gl?.allowed) return json({ oneway: null }, 429);

    const query = `[out:json][timeout:4];way(around:15,${lat.toFixed(6)},${lng.toFixed(6)})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out tags;`;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "DecerneApp/1.0 (support@decerne.it)"
      },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) {
      console.error("Overpass non ok:", res.status);
      return json({ oneway: null });
    }

    const data = await res.json();
    const ways = (data.elements || []).map((e: { tags?: Record<string, string> }) => e.tags || {});
    if (!ways.length) return json({ oneway: null });

    const oneway = ways.every((t: Record<string, string>) => {
      if (t.oneway === "no") return false;
      return ["yes", "true", "1", "-1"].includes(t.oneway) ||
        t.junction === "roundabout" ||
        String(t.highway || "").startsWith("motorway");
    });
    return json({ oneway });
  } catch (e) {
    console.error("Errore road-oneway:", String(e));
    return json({ oneway: null });
  }
});
