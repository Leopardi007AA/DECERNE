import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Registra la scelta del banner cookie (Accetta / Solo essenziali / Rifiuta / Chiuso con X).
// Pubblica e senza autenticazione: la chiama il footer/banner per ogni visitatore.
// L'IP viene troncato (ultimo ottetto azzerato per IPv4) prima di essere salvato:
// resta utile per statistiche aggregate, non identifica più il singolo visitatore.

// Origini da cui il sito chiama questa funzione dal browser (nessun jolly).
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

const VALID_CHOICES = ["accept_all", "essential_only", "reject", "dismissed"];
const MAX_PER_IP_PER_HOUR = 20;
// Tetto complessivo (tutti gli IP) per ora: impedisce di riempire la tabella con IP diversi.
const MAX_GLOBAL_PER_HOUR = 3000;

// L'IP si legge solo dagli header impostati dall'edge di Supabase.
// x-forwarded-for NON va usato: lo può scrivere il client e annullerebbe il limite per IP.
function getClientIp(req: Request): string | null {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  return ip ? ip.slice(0, 64) : null;
}

function truncateIp(ip: string | null): string | null {
  if (!ip) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return ip.replace(/\.\d+$/, ".0");
  }
  if (ip.includes(":")) {
    // IPv6: teniamo solo i primi 4 gruppi (analogo a un /64), azzeriamo il resto.
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":") + "::";
  }
  return null;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo non consentito." }, 405);
  }

  const body = await req.json().catch(() => null);
  const choice = body?.choice;
  if (!VALID_CHOICES.includes(choice)) {
    return json({ error: "Valore 'choice' non valido." }, 400);
  }

  const truncatedIp = truncateIp(getClientIp(req));

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Limite di frequenza per IP (troncato): evita che lo stesso visitatore riempia
  // la tabella richiamando l'endpoint in loop.
  if (truncatedIp) {
    const { count } = await supabaseAdmin
      .from("cookie_consents")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", truncatedIp)
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return json({ error: "Troppe richieste, riprova più tardi." }, 429);
    }
  }

  const { count: globalCount } = await supabaseAdmin
    .from("cookie_consents")
    .select("id", { count: "exact", head: true })
    .gte("created_at", oneHourAgo);
  if ((globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
    return json({ error: "Troppe richieste, riprova più tardi." }, 429);
  }

  const { error } = await supabaseAdmin.from("cookie_consents").insert({
    choice,
    ip_address: truncatedIp,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
    page: typeof body?.page === "string" ? body.page.slice(0, 200) : null
  });

  if (error) {
    console.error("Errore log-cookie-consent:", error);
    return json({ error: "Errore nel salvataggio del consenso." }, 500);
  }

  return json({ success: true }, 201);
});
