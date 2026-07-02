// backend/src/index.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

// Client "pubblico": rispetta le regole RLS come un utente vero.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
);

// Client con privilegi di servizio: SOLO lato server, mai esposto al browser.
// Bypassa le RLS — serve per operazioni admin come la cancellazione utenti.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// --- Endpoint di controllo: il server è vivo? ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend Decerne attivo" });
});

// --- Endpoint di test: legge le offerte pubbliche da Supabase ---
app.get("/api/test-offers", async (req, res) => {
  const { data, error } = await supabase
    .from("offers")
    .select("id, product, price, original_price, status")
    .limit(5);

  if (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  res.json({ ok: true, count: data.length, offers: data });
});

// --- Endpoint: cancellazione definitiva account utente ---
app.post("/api/delete-account", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Token mancante." });
    }

    // 1. Verifica che il token sia valido e recupera l'utente reale
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: "Sessione non valida." });
    }
    const userId = userData.user.id;

    // 2. Elimina i dati applicativi collegati (profilo, ecc.)
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // 3. Elimina davvero l'utente da auth.users
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return res.json({ success: true });
  } catch (err) {
    console.error("Errore eliminazione account:", err);
    return res.status(500).json({ error: "Errore durante l'eliminazione dell'account." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Decerne backend in ascolto su http://localhost:${PORT}`);
});