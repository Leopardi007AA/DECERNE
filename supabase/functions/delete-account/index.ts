import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Token mancante." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Sessione non valida." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const userId = userData.user.id;
    const userEmail = (userData.user.email ?? "").trim().toLowerCase();

    // Richiede una sessione recente (login avvenuto negli ultimi 10 minuti): il frontend
    // deve far reinserire la password (o rifare l'OTP) subito prima di chiamare questa
    // funzione, così un token rimasto aperto su un dispositivo non basta da solo a
    // cancellare l'account.
    const lastSignIn = userData.user.last_sign_in_at ? new Date(userData.user.last_sign_in_at).getTime() : 0;
    if (!lastSignIn || Date.now() - lastSignIn > 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: "reauth_required", message: "Per sicurezza, effettua di nuovo l'accesso prima di eliminare l'account." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Non conserviamo più nome/cognome/città/CAP/email in chiaro: solo un'impronta dell'email,
    // utile esclusivamente per rilevare pattern di abuso (re-iscrizioni fraudolente ripetute),
    // con scadenza automatica a 90 giorni (vedi purge_old_deleted_accounts).
    // L'impronta è un HMAC con un segreto che sta solo nel Vault del database (funzione hmac_key):
    // un SHA-256 semplice di un'email si ricostruisce provando indirizzi noti.
    let emailHash: string | null = null;
    if (userEmail) {
      const { data: h, error: hmacError } = await supabaseAdmin.rpc("hmac_key", { p_value: "email:" + userEmail });
      if (hmacError || typeof h !== "string" || !h) {
        // Meglio nessuna impronta che bloccare l'eliminazione dell'account
        console.error("Errore calcolo HMAC email:", hmacError);
      } else {
        emailHash = h;
      }
    }

    const { error: archiveError } = await supabaseAdmin.from("deleted_accounts").insert({
      original_user_id: userId,
      email_hash: emailHash
    });
    if (archiveError) {
      console.error("Errore archiviazione account eliminato:", archiveError);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Errore eliminazione account:", err);
    return new Response(JSON.stringify({ error: "Errore durante l'eliminazione dell'account." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
