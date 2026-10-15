import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Reverse geocoding (coordinate GPS -> via, CAP, città) fatto dal server.
// Il browser non contatta più i servizi di mappe con la posizione dell'utente: il fornitore vede
// solo l'IP del server. Funzione pubblica (verify_jwt disattivo) perché la usano anche i visitatori
// non registrati; il limite di frequenza è per IP e la risposta contiene solo i tre campi utili.
//
// MapMap (GET /geocode/reverse, chiave nel secret MAPMAP_API_KEY) è il primo tentativo.
// Il reverse non restituisce il CAP: lo si ricava con una seconda chiamata a GET /geocode. Se
// MapMap non risponde si passa a Photon (Komoot, basato su OpenStreetMap) e, per ultimo, a
// Nominatim, che però di solito risponde 403 agli IP dei server cloud condivisi. I log dicono
// quale provider ha risposto.

const ALLOWED_ORIGINS = [
  "https://decerne.vercel.app",
  "https://www.decerne.it",
  "https://decerne.it"
];

const UA = "DecerneApp/1.0 (support@decerne.it)";

type Addr = { road: string; postcode: string; city: string; number?: string };

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

async function viaNominatim(lat: number, lon: number): Promise<Addr | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=18&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
    { headers: { "User-Agent": UA, "Accept-Language": "it" }, signal: AbortSignal.timeout(6000) }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("Nominatim non ok:", res.status, t.slice(0, 120));
    return null;
  }
  const a = (await res.json())?.address;
  if (!a) { console.error("Nominatim senza address"); return null; }
  return {
    road: String(a.road || ""),
    postcode: String(a.postcode || ""),
    city: String(a.city || a.town || a.village || a.suburb || "")
  };
}

async function viaMapMap(lat: number, lon: number): Promise<Addr | null> {
  const key = Deno.env.get("MAPMAP_API_KEY");
  if (!key) return null; // senza chiave si salta e si passa ai provider pubblici
  const res = await fetch(
    `https://api.mapmap.ai/geocode/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
    { headers: { "User-Agent": UA, "Authorization": `Bearer ${key}` }, signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("MapMap non ok:", res.status, t.slice(0, 120));
    return null;
  }
  const p = (await res.json())?.features?.[0]?.properties;
  if (!p) { console.error("MapMap senza risultati"); return null; }
  return {
    road: String(p.street || ""),
    postcode: String(p.postcode || ""),
    city: String(p.city || p.locality || p.district || ""),
    number: String(p.housenumber || "")
  };
}

// Il reverse di MapMap non dà il CAP, il geocoding diretto sì: si cerca lo stesso indirizzo e si
// accetta il risultato solo se cade a poche centinaia di metri dal punto di partenza.
async function capViaMapMap(a: Addr, lat: number, lon: number): Promise<string> {
  const key = Deno.env.get("MAPMAP_API_KEY");
  if (!key || !a.road || !a.city) return "";
  const q = encodeURIComponent(`${a.number ? a.number + " " : ""}${a.road}, ${a.city}`);
  const res = await fetch(`https://api.mapmap.ai/geocode?q=${q}&limit=5`, {
    headers: { "User-Agent": UA, "Authorization": `Bearer ${key}` },
    signal: AbortSignal.timeout(3000)
  });
  if (!res.ok) {
    console.error("MapMap geocode non ok:", res.status);
    return "";
  }
  const features = (await res.json())?.features ?? [];
  for (const f of features) {
    const [fLon, fLat] = f?.geometry?.coordinates ?? [];
    const cap = String(f?.properties?.postcode || "");
    if (cap && Math.abs(fLat - lat) < 0.01 && Math.abs(fLon - lon) < 0.012) return cap;
  }
  return "";
}

async function viaPhoton(lat: number, lon: number, timeoutMs = 6000): Promise<Addr | null> {
  const res = await fetch(
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&limit=1`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("Photon non ok:", res.status, t.slice(0, 120));
    return null;
  }
  const p = (await res.json())?.features?.[0]?.properties;
  if (!p) { console.error("Photon senza risultati"); return null; }
  return {
    road: String(p.street || ""),
    postcode: String(p.postcode || ""),
    city: String(p.city || p.locality || p.district || p.name || "")
  };
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
    const lon = Number(body?.lon);
    // Solo coordinate plausibili per l'Italia
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 35 || lat > 48 || lon < 6 || lon > 19) {
      return json({ error: "Coordinate non valide" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const ip = getClientIp(req);
    const { data: rl, error: rlError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "reverse-geocode", p_key: ip, p_max_attempts: 10, p_window_seconds: 60, p_block_seconds: 300
    });
    if (rlError) {
      console.error("Errore RPC check_api_rate_limit (reverse-geocode):", rlError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!rl?.allowed) return json({ error: "Troppe richieste. Riprova più tardi." }, 429);

    // Tetto globale: la policy di Nominatim consente al massimo 1 richiesta al secondo in totale.
    // Oltre soglia rischiamo il blocco dell'IP del server per tutti.
    const { data: gl, error: glError } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_scope: "reverse-geocode-global", p_key: "all", p_max_attempts: 50, p_window_seconds: 60, p_block_seconds: 15, p_cost: 1
    });
    if (glError) {
      console.error("Errore RPC check_api_rate_limit (reverse-geocode-global):", glError);
      return json({ error: "Servizio temporaneamente non disponibile." }, 503);
    }
    if (!gl?.allowed) return json({ error: "Servizio occupato. Riprova tra qualche secondo." }, 429);

    let addr: Addr | null = null;
    let source = "mapmap";
    try { addr = await viaMapMap(lat, lon); } catch (e) { console.error("MapMap errore:", String(e)); }
    // Il reverse di MapMap non dà il CAP, che serve a filtrare le offerte: lo ricaviamo con una
    // seconda chiamata di geocoding diretto. Se manca teniamo la sola città.
    if (addr && addr.city && !addr.postcode) {
      try {
        const cap = await capViaMapMap(addr, lat, lon);
        if (cap) { addr.postcode = cap; source = "mapmap+cap"; }
      } catch (e) { console.error("MapMap (solo CAP) errore:", String(e)); }
    }
    if (!addr || (!addr.postcode && !addr.city)) {
      source = "photon";
      try { addr = await viaPhoton(lat, lon); } catch (e) { console.error("Photon errore:", String(e)); addr = null; }
    }
    if (!addr || (!addr.postcode && !addr.city)) {
      source = "nominatim";
      try { addr = await viaNominatim(lat, lon); } catch (e) { console.error("Nominatim errore:", String(e)); addr = null; }
    }
    if (!addr || (!addr.postcode && !addr.city)) {
      console.error("Reverse geocode: nessun provider ha risposto");
      return json({ address: null });
    }
    console.log("Reverse geocode ok via", source);

    return json({
      address: {
        road: addr.road.slice(0, 120),
        postcode: addr.postcode.slice(0, 10),
        city: addr.city.slice(0, 100)
      }
    });
  } catch (e) {
    console.error("Errore reverse-geocode:", e);
    return json({ error: "Errore interno" }, 500);
  }
});
