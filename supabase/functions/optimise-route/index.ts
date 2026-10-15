import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Ordine delle tappe sui tempi di guida reali (MapMap POST /optimise, chiave nel secret
// MAPMAP_API_KEY). Un solo veicolo parte dalla posizione dell'utente e non deve tornare
// indietro. Risponde sempre { order } con gli indici delle tappe già in ordine, oppure
// { order: null } se MapMap non è disponibile: il sito allora usa il calcolo in linea d'aria.
// Funzione pubblica (verify_jwt disattivo) perché la mappa si usa anche senza account.
// Una richiesta a /optimise vale 10 chiamate, quindi i limiti di frequenza sono bassi.

const ALLOWED_ORIGINS = [
  "https://decerne.vercel.app",
  "https://www.decerne.it",
  "https://decerne.it"
];

const MAX_STOPS = 12;
const UA = "DecerneApp/1.0 (support@decerne.it)";

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

function validPoint(p: unknown): { lat: number; lng: number } | null {
  const lat = Number((p as { lat?: unknown })?.lat);
  const lng = Number((p as { lng?: unknown })?.lng);
  // Solo coordinate plausibili per l'Italia
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35 || lat > 48 || lng < 6 || lng > 19) return null;
  return { lat, lng };
}

// Legge gli id dei lavori nell'ordine di visita e li riporta a indici 0..n-1.
// Restituisce null se la risposta non contiene tutte le tappe, una sola volta ciascuna.
function extractOrder(data: any, n: number): number[] | null {
  if (!Array.isArray(data?.unassigned) || data.unassigned.length > 0) return null;
  const steps = data?.routes?.[0]?.steps;
  if (!Array.isArray(steps)) return null;
  const order = steps.filter((s: any) => s?.type === "job").map((s: any) => Number(s.id) - 1);
  if (order.length !== n) return null;
  if (new Set(order).size !== n) return null;
  if (!order.every((i: number) => Number.isInteger(i) && i >= 0 && i < n)) return null;
  return order;
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
    const start = validPoint(body?.start);
    const rawStops = body?.stops;
    if (!start || !Array.isArray(rawStops) || rawStops.length < 2 || rawStops.length > MAX_STOPS) {
      return json({ error: "Dati non validi" }, 400);
    }
    const stops: { lat: number; lng: number }[] = [];
    for (const s of rawStops) {
      const p = validPoint(s);
      if (!p) return json({ error: "Coordinate non valide" }, 400);
      stops.push(p);
    }

    const key = Deno.env.get("MAPMAP_API_KEY");
    if (!key) return json({ order: null });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Ogni richiesta vale 10 chiamate a MapMap: pochi tentativi al minuto per IP e un tetto globale.
    const ip = getClientIp(req);
    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "optimise", p_key: ip, p_max_attempts: 6, p_window_seconds: 60, p_block_seconds: 120, p_cost: 1
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (optimise):", rlError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!rl?.allowed) return json({ error: "Troppe richieste. Riprova più tardi." }, 429);

    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "optimise-global", p_key: "all", p_max_attempts: 30, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (optimise-global):", glError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!gl?.allowed) return json({ error: "Servizio occupato. Riprova tra qualche secondo." }, 429);

    const payload = {
      vehicles: [{ id: 1, start: { lat: start.lat, lon: start.lng } }],
      jobs: stops.map((s, i) => ({ id: i + 1, location: { lat: s.lat, lon: s.lng } }))
    };

    let res: Response;
    try {
      res = await fetch("https://api.mapmap.ai/optimise", {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(7000)
      });
    } catch (e) {
      console.error("MapMap optimise non raggiungibile:", String(e));
      return json({ order: null });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("MapMap optimise non ok:", res.status, t.slice(0, 160));
      return json({ order: null });
    }

    const order = extractOrder(await res.json().catch(() => null), stops.length);
    if (!order) {
      console.error("MapMap optimise: risposta senza un ordine valido");
      return json({ order: null });
    }
    console.log("Ordine tappe ottimizzato via MapMap per", stops.length, "tappe");
    return json({ order });
  } catch (e) {
    console.error("Errore optimise-route:", e);
    return json({ error: "Errore interno" }, 500);
  }
});