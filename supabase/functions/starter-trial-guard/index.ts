import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Impedisce di riattivare più di una volta la prova gratuita mensile di Starter,
// verificando IP (sempre) e account Google (quando disponibile, in previsione
// dell'aggiunta del login Google anche lato partner). Pubblica e senza autenticazione:
// 'check' viene chiamata prima ancora che esista un account partner (step 1
// dell'onboarding), 'claim' subito dopo la creazione dello store (step 4).

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

// L'IP si legge solo dagli header impostati dall'edge di Supabase (cf-connecting-ip, x-real-ip).
// x-forwarded-for NON va usato: lo può scrivere il client e permetterebbe di aggirare il controllo.
function getClientIp(req: Request): string | null {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  return ip ? ip.slice(0, 64) : null;
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
  const mode = body?.mode;
  if (mode !== "check" && mode !== "claim") {
    return json({ error: "Parametro 'mode' non valido." }, 400);
  }

  const clientIp = getClientIp(req);
  if (!clientIp) {
    // Senza IP non possiamo verificare nulla: fail-open (non bloccare una registrazione
    // legittima per un problema di rete), ma senza registrare nessun claim.
    return json({ eligible: true, claimed: false, reason: "ip_unavailable" });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // L'IP non viene salvato né hashato con SHA-256 semplice (spazio IPv4 piccolo, invertibile):
  // si usa un HMAC con un segreto che sta solo nel Vault del database (funzione hmac_key).
  const { data: ipHash, error: hmacError } = await supabaseAdmin.rpc("hmac_key", { p_value: clientIp });
  if (hmacError || typeof ipHash !== "string" || !ipHash) {
    console.error("Errore calcolo HMAC IP:", hmacError);
    return json({ eligible: true, claimed: false, reason: "check_failed" });
  }

  const googleIdentifier = typeof body?.google_identifier === "string" && body.google_identifier
    ? body.google_identifier.slice(0, 200)
    : null;

  let existingQuery = supabaseAdmin
    .from("starter_trial_claims")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash);
  const { count: ipMatchCount, error: ipCheckError } = await existingQuery;

  let googleMatchCount = 0;
  if (googleIdentifier) {
    const { count, error: googleCheckError } = await supabaseAdmin
      .from("starter_trial_claims")
      .select("id", { count: "exact", head: true })
      .eq("google_identifier", googleIdentifier);
    if (googleCheckError) console.error("Errore verifica google_identifier:", googleCheckError);
    googleMatchCount = count || 0;
  }

  if (ipCheckError) {
    console.error("Errore verifica ip_hash:", ipCheckError);
    return json({ eligible: true, claimed: false, reason: "check_failed" });
  }

  const alreadyUsed = (ipMatchCount || 0) > 0 || googleMatchCount > 0;

  if (mode === "check") {
    return json({ eligible: !alreadyUsed });
  }

  // mode === 'claim'
  if (alreadyUsed) {
    return json({ eligible: false, claimed: false });
  }

  const storeId = typeof body?.store_id === "string" ? body.store_id : null;
  const { error: insertError } = await supabaseAdmin.from("starter_trial_claims").insert({
    ip_hash: ipHash,
    google_identifier: googleIdentifier,
    store_id: storeId
  });

  if (insertError) {
    console.error("Errore registrazione starter_trial_claims:", insertError);
    return json({ eligible: true, claimed: false, reason: "insert_failed" });
  }

  return json({ eligible: true, claimed: true });
});
