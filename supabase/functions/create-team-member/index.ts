import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "contact.decerne@gmail.com";

// Origini da cui il sito chiama questa funzione dal browser. Nessun jolly (né "*" né
// "*.vercel.app": chiunque può registrare un sottodominio vercel.app).
const ALLOWED_ORIGINS = [
  "https://decerne.vercel.app",
  "https://www.decerne.it",
  "https://decerne.it",
];
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Escape HTML per i valori dinamici inseriti nell'email (store.name, role).
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function generateSecurePassword(length = 24) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

const MAX_TEAM_MEMBERS_PER_STORE = 15;

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Limite di frequenza condiviso (tabella api_rate_limits). Se il controllo fallisce si blocca la
  // richiesta: gli inviti sono pochi e un'email di invito non deve partire senza limite.
  async function allowed(scope: string, key: string, max: number, windowSec: number): Promise<boolean> {
    const { data, error } = await admin.rpc("check_api_rate_limit", {
      p_scope: scope, p_key: key, p_max_attempts: max, p_window_seconds: windowSec, p_block_seconds: windowSec, p_cost: 1,
    });
    if (error) {
      console.error("Errore check_api_rate_limit (" + scope + "):", error);
      return false;
    }
    return !!data?.allowed;
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Non autorizzato." }), { status: 401, headers: corsHeaders });
    }

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData.user) {
      return new Response(JSON.stringify({ error: "Sessione non valida." }), { status: 401, headers: corsHeaders });
    }

    const { store_id, email, role } = await req.json();
    if (!store_id || !email || !role || !["Admin", "Manager"].includes(role)) {
      return new Response(JSON.stringify({ error: "Dati mancanti o non validi." }), { status: 400, headers: corsHeaders });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (cleanEmail.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(cleanEmail)) {
      return new Response(JSON.stringify({ error: "Email non valida." }), { status: 400, headers: corsHeaders });
    }

    const { data: store, error: storeErr } = await admin
      .from("stores")
      .select("id, name, plan, auth_user_id, subscription_status")
      .eq("id", store_id)
      .single();
    if (storeErr || !store) {
      return new Response(JSON.stringify({ error: "Negozio non trovato." }), { status: 404, headers: corsHeaders });
    }

    const isOwner = store.auth_user_id === callerData.user.id;
    let isAdminCollaborator = false;
    if (!isOwner) {
      const { data: callerTeamRow } = await admin
        .from("team_members")
        .select("role, status")
        .eq("store_id", store_id)
        .eq("auth_user_id", callerData.user.id)
        .maybeSingle();
      isAdminCollaborator = !!callerTeamRow && callerTeamRow.role === "Admin" && callerTeamRow.status === "active";
    }
    if (!isOwner && !isAdminCollaborator) {
      return new Response(JSON.stringify({ error: "Non autorizzato a gestire il team di questo negozio." }), { status: 403, headers: corsHeaders });
    }
    if (store.plan !== "Enterprise") {
      return new Response(JSON.stringify({ error: "Funzione riservata al piano Enterprise." }), { status: 403, headers: corsHeaders });
    }
    // L'abbonamento deve essere attivo (o in prova): un negozio scaduto/sospeso non invia email a nome di DECERNE.
    if (!["trial", "active"].includes(String(store.subscription_status || ""))) {
      return new Response(JSON.stringify({ error: "L'abbonamento del negozio non è attivo." }), { status: 403, headers: corsHeaders });
    }

    // Limiti: per chi invita, per negozio, per destinatario (un indirizzo non può ricevere
    // decine di email di invito) e complessivo su tutta la piattaforma.
    if (
      !(await allowed("team-invite-global", "all", 300, 86400)) ||
      !(await allowed("team-invite-user", callerData.user.id, 20, 3600)) ||
      !(await allowed("team-invite-store", String(store.id), 10, 3600)) ||
      !(await allowed("team-invite-email", cleanEmail, 3, 86400))
    ) {
      return new Response(JSON.stringify({ error: "Troppi inviti in poco tempo. Riprova più tardi." }), { status: 429, headers: corsHeaders });
    }

    const { data: existingRow } = await admin
      .from("team_members")
      .select("id")
      .eq("store_id", store_id)
      .eq("email", cleanEmail)
      .maybeSingle();
    if (existingRow) {
      return new Response(JSON.stringify({ error: "Questo collaboratore fa già parte del team." }), { status: 409, headers: corsHeaders });
    }

    const { count: teamCount, error: countErr } = await admin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store_id);
    if (countErr) {
      return new Response(JSON.stringify({ error: "Errore tecnico." }), { status: 500, headers: corsHeaders });
    }
    if ((teamCount ?? 0) >= MAX_TEAM_MEMBERS_PER_STORE) {
      return new Response(JSON.stringify({ error: `Hai raggiunto il numero massimo di ${MAX_TEAM_MEMBERS_PER_STORE} collaboratori per questo negozio.` }), { status: 429, headers: corsHeaders });
    }

    const generatedPassword = generateSecurePassword(24);

    // Non tocchiamo mai un account già esistente: se l'email risulta già registrata
    // su Supabase Auth (cliente, altro partner, admin...), rifiutiamo la richiesta
    // invece di forzarne il reset della password.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: generatedPassword,
      email_confirm: true,
    });

    if (createErr) {
      return new Response(JSON.stringify({
        error: "Questo indirizzo email è già associato a un account DECERNE esistente. Non è possibile invitarlo automaticamente: contattaci per un'associazione manuale, oppure chiedi alla persona di usare un altro indirizzo."
      }), { status: 409, headers: corsHeaders });
    }
    const collaboratorAuthId = created.user!.id;

    const { error: insertErr } = await admin.from("team_members").insert({
      store_id, email: cleanEmail, role,
      auth_user_id: collaboratorAuthId,
      status: "invited",
      must_reset_password: true,
    });
    if (insertErr) {
      // Rollback: non lasciamo un utente Auth orfano senza riga in team_members.
      await admin.auth.admin.deleteUser(collaboratorAuthId);
      return new Response(JSON.stringify({ error: "Errore nel salvataggio del collaboratore." }), { status: 500, headers: corsHeaders });
    }

    if (BREVO_API_KEY) {
      try {
        // Oggetto fisso: il nome del negozio (scelto da chi invita) non compare nell'oggetto,
        // così non si può usare per scrivere frasi arbitrarie con il mittente DECERNE.
        const safeStoreName = String(store.name ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 60);
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "DECERNE", email: BREVO_SENDER_EMAIL },
            to: [{ email: cleanEmail }],
            subject: "Sei stato invitato su DECERNE",
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
                <h2 style="color:#0f62fe;">Benvenuto su DECERNE</h2>
                <p>Un negozio che si presenta come <strong>${escapeHtml(safeStoreName)}</strong> ti ha aggiunto come <strong>Collaboratore (${escapeHtml(role)})</strong> nel Pannello Partner.</p>
                <p>Le tue credenziali di primo accesso:</p>
                <p style="background:#f8fafc;padding:12px 16px;border-radius:8px;">
                  Email: <strong>${escapeHtml(cleanEmail)}</strong><br>
                  Password provvisoria: <strong>${escapeHtml(generatedPassword)}</strong>
                </p>
                <p>Al primo accesso ti verrà chiesto un codice a 6 cifre di verifica e di scegliere una password personale.</p>
                <p style="color:#64748b;font-size:13px;">Per sicurezza la password provvisoria vale 7 giorni: se non accedi entro questo termine l'invito viene annullato e chi ti ha invitato dovrà inviartelo di nuovo. Se non ti aspettavi questo invito, ignora questa email.</p>
                <p style="color:#64748b;font-size:13px;">DECERNE non verifica l'identità di chi invia gli inviti: il nome del negozio è indicato da chi ti ha invitato.</p>
              </div>`,
          }),
        });
      } catch (fetchErr) {
        console.error("Errore invio email Brevo (create-team-member):", fetchErr);
      }
    } else {
      console.error("create-team-member: BREVO_API_KEY non impostata, email non inviata a", cleanEmail);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("Errore create-team-member:", e);
    return new Response(JSON.stringify({ error: "Errore tecnico." }), { status: 500, headers: corsHeaders });
  }
});
