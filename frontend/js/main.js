const SESSION_KEY = "decerne_active_session"; // Sessione login (solo per pulizia legacy admin, Punto 5)
const SESSION_PARTNER = "decerne_partner_active"; // Sessione del supermercato loggato
// ============================================================
// CONNESSIONE A SUPABASE (Fase 2.1)
// Le stesse due chiavi che hai già usato nel backend (.env) — qui invece
// vanno scritte direttamente nel codice, perché questa è la chiave "Publishable",
// pensata apposta per essere visibile pubblicamente nel browser.
// ============================================================
const SUPABASE_URL = "https://noqdpjlbmyjqzlmstfvx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ER6yqBMYCoQ561qXao-sBg_CrEv7BQ6";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY); 

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const DEV_MODE = false;

const PARTNER_AUTH_KEY = "decerne_partner_auth"; // Per il "Remember Me"

const STORAGE_RATE_LIMIT = "decerne_rate_limits";

const LOCK_TTL_MS = 5000; // Il lock scade automaticamente dopo 5 secondi

const PLACEHOLDER_IMG = "data:image/svg+xml;charset=UTF-8,%3Csvg width='150' height='150' viewBox='0 0 150 150' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='150' height='150' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%2364748b' text-anchor='middle' dy='.3em'%3EFoto non disponibile%3C/text%3E%3C/svg%3E";

const TEXT = {
  roles: {
    customer: "Cliente",
    store: "Esercente",
    admin: "Amministratore"
  },
  common: {
    save: "Salva",
    cancel: "Annulla",
    confirm: "Conferma",
    delete: "Elimina",
    loading: "Caricamento...",
    error: "Errore",
    success: "Successo",
    undo: "ANNULLA",
    close: "Chiudi"
  },
  auth: {
    loginTitle: "Accesso Utente",
    registerTitle: "Crea un account",
    loginBtn: "Accedi",
    registerBtn: "Registrati",
    logoutBtn: "Esci dall'account",
    deleteAccount: "Elimina Account",
    errorLogin: "Email o password errati.",
    emailExists: "Email già registrata.",
    welcome: "Bentornato su Decerne",
    profileTitle: "Il Tuo Profilo"
  },
  offers: {
    title: "Offerte vicine",
    empty: "Nessuna offerta trovata.",
    loadMore: "Carica altre offerte",
    addToList: "Aggiungi alla lista",
    removeFromList: "Rimuovi",
    added: "Prodotto aggiunto alla lista!",
    alreadyIn: "Questo prodotto è già nella tua lista.",
    limitReached: "Limite raggiunto",
    historyTitle: "Cronologia Modifiche",
    featured: "Offerta in evidenza",
    expired: "Scaduta"
  },
  store: {
    pricingTitle: "Scegli il piano perfetto",
    onboardingTitle: "Configura l'Account",
    dashboardTitle: "Performance Overview",
    myOffers: "Le tue Offerte",
    subscription: "Il tuo Abbonamento",
    profile: "Profilo Supermercato",
    apiTitle: "Integrazione API",
    teamTitle: "Utenti Aziendali",
    importTitle: "Importazione Massiva",
    trialExpired: "Il tuo periodo di prova è terminato."
  },
  location: {
    placeholder: "Posizione non impostata",
    detecting: "Localizzazione in corso...",
    error: "Errore nel recupero indirizzo",
    denied: "Accesso posizione negato",
    banner: "Decerne vorrebbe usare la tua posizione per mostrarti le offerte vicine. Vuoi consentire?"
  }
};

// Gerarchia Piani (Valore numerico per confronti rapidi)
const PLAN_LEVELS = {
  'Starter': 2,
  'Standard': 3,
  'Professional': 4,
  'Enterprise': 5
};

/**
 * Sistema di controllo centralizzato per i permessi.
 * @param {string} requiredPlan - Il piano minimo richiesto (es: 'Professional')
 * @param {boolean} showAlert - Se mostrare un toast/conferma in caso di blocco
 * @returns {boolean} - true se l'utente ha il permesso
 */
function checkPermission(requiredPlan, showAlert = true) {
  const partner = getCurrentPartner();
  
  // Se non c'è un partner loggato, neghiamo tutto
  if (!partner || !partner.subscription) {
    if (showAlert) toast.error("Sessione non valida o scaduta.");
    return false;
  }

  const currentPlan = partner.plan || partner.subscription.plan || 'Starter';
  const currentLevel = PLAN_LEVELS[currentPlan] || 2;
  const requiredLevel = PLAN_LEVELS[requiredPlan];

  if (currentLevel >= requiredLevel) {
    return true;
  }

  // Se il permesso è negato
  if (showAlert) {
    showConfirm(
      `🔒 Funzione Premium: Questa operazione richiede il piano ${requiredPlan}. Vuoi passare alla pagina degli abbonamenti?`,
      () => { switchStoreTab('sub'); }
    );
  }
  return false;
}

// Costanti di validazione
const VALIDATION_RULES = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  minPassword: 8,
  maxProductName: 100
};

/**
 * Mostra un errore in un contenitore specifico o tramite toast
 */
function showFormError(containerId, message) {
  const errorBox = document.getElementById(containerId);
  if (errorBox) {
    errorBox.textContent = message; // Sicuro (no innerHTML)
    errorBox.classList.remove("hidden");
    // Nascondi automaticamente dopo 5 secondi
    setTimeout(() => errorBox.classList.add("hidden"), 5000);
  } else {
    toast.error(message);
  }
}

// Estrae il CAP (5 cifre) dall'input posizione utente
function getCleanUserCap() {
  const locValue = $("#locationInput")?.value || "";
  const match = locValue.match(/\d{5}/); // Cerca 5 numeri consecutivi
  return match ? match[0].trim() : null;
}

// Estrae la Città dall'input posizione utente
function getCleanUserCity() {
  const locValue = $("#locationInput")?.value || "";
  if (!locValue || locValue.includes("non impostata")) return null;
  
  // Rimuove il CAP e pulisce tutto il resto
  let cleanCity = locValue.replace(/\d{5}/g, "").replace(/[,.-]/g, "").trim().toLowerCase();
  return cleanCity;
}

// Funzione per gestire le immagini in modo sicuro in ogni vista
function getSafeImageUrl(url) {
  if (!url) return PLACEHOLDER_IMG;
  const trimmedUrl = url.trim();
  
  // Se è un link valido (anche http) o un'immagine in base64
  if (trimmedUrl.toLowerCase().startsWith("http") || trimmedUrl.startsWith("data:image")) {
    // Trasformiamo http in https se possibile per evitare blocchi del browser
    return trimmedUrl.replace("http://", "https://");
  }
  
  return PLACEHOLDER_IMG;
}

// Funzione Debounce: ritarda l'esecuzione della funzione fn
function debounce(fn, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

function maskStoreData(storeObj) {
  if (!storeObj) return null;
  return {
    id: storeObj.id,
    name: storeObj.name || "Supermercato",
    logo: storeObj.logo || "",
    addressShort: storeObj.address || "Indirizzo non disponibile",
    hours: storeObj.hours || "Orari non specificati",
    type: storeObj.type || "Retailer"
  };
}

const clean = (str) => {
  if (typeof str !== 'string') return str;
  if (window.DOMPurify) {
    return DOMPurify.sanitize(str);
  }
  // Fallback base se il CDN fallisce
  return str.replace(/<\/?[^>]+(>|$)/g, ""); 
};

/**
 * Tenta di acquisire un lock per una specifica offerta
 * @returns {boolean} true se il lock è acquisito, false se è occupato
 */
function acquireOfferLock(offerId) {
  const lockKey = `lock_offer_${offerId}`;
  const now = Date.now();
  const existingLock = localStorage.getItem(lockKey);

  if (existingLock) {
    const lockTime = parseInt(existingLock, 10);
    // Verifica se il lock esistente è ancora valido (non scaduto)
    if (now - lockTime < LOCK_TTL_MS) {
      return false; // Lock occupato e valido
    }
  }

  // Scrivi il lock con il timestamp corrente
  localStorage.setItem(lockKey, now.toString());
  
  // Opzionale: Log in DEV_MODE
  if (DEV_MODE) console.log(`[Lock] Acquisito per ${offerId}`);
  return true;
}

/**
 * Rilascia il lock
 */
function releaseOfferLock(offerId) {
  localStorage.removeItem(`lock_offer_${offerId}`);
  if (DEV_MODE) console.log(`[Lock] Rilasciato per ${offerId}`);
}

function getStringSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().replace(/\s+/g, '');
  const s2 = str2.toLowerCase().replace(/\s+/g, '');
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) bigrams1.add(s1.substring(i, i + 2));
  
  const bigrams2 = new Set();
  for (let i = 0; i < s2.length - 1; i++) bigrams2.add(s2.substring(i, i + 2));

  let intersection = 0;
  for (const b of bigrams1) if (bigrams2.has(b)) intersection++;

  return (2.0 * intersection) / (bigrams1.size + bigrams2.size);
}

function showDuplicateDialog(existingProduct) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px);";
    
    const box = document.createElement("div");
    box.style.cssText = "background:white; padding:30px; border-radius:24px; width:100%; max-width:450px; box-shadow:0 20px 40px rgba(0,0,0,0.3); text-align:center; animation:slideUp 0.3s ease-out;";
    
    box.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 15px;">⚠️</div>
      <h3 style="margin-bottom:10px; color:#1e293b;">Possibile Duplicato</h3>
      <p style="color:#64748b; margin-bottom:20px; line-height:1.5;">
        Hai già un'offerta per <strong>${existingProduct}</strong> allo stesso prezzo.<br>Cosa vuoi fare?
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button id="dupUpdate" class="btn" style="background:var(--primary);">Aggiorna offerta esistente</button>
        <button id="dupCreate" class="btn outline">Crea comunque come nuova</button>
        <button id="dupCancel" class="btn" style="background:transparent; color:#94a3b8; border:none;">Annulla</button>
      </div>
    `;
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector("#dupUpdate").onclick = () => { overlay.remove(); resolve('update'); };
    box.querySelector("#dupCreate").onclick = () => { overlay.remove(); resolve('create'); };
    box.querySelector("#dupCancel").onclick = () => { overlay.remove(); resolve('cancel'); };
  });
}

async function logOfferChange(offerId, field, oldValue, newValue, modifiedBy) {
  // Evitiamo di loggare se il valore non è realmente cambiato
  if (oldValue == newValue) return;

  const note = `${field}::${oldValue || "vuoto"}::${newValue || "vuoto"}::${modifiedBy}`;

  const { error } = await supabaseClient
    .from('offer_history')
    .insert({ offer_id: offerId, change_note: note });

  if (error) console.error("Errore salvataggio cronologia:", error);
}

/**
 * Recupera lo storico di una specifica offerta
 */
async function getOfferHistory(offerId) {
  const { data, error } = await supabaseClient
    .from('offer_history')
    .select('change_note, changed_at')
    .eq('offer_id', offerId)
    .order('changed_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error("Errore recupero cronologia:", error);
    return [];
  }

  return (data || []).map(row => {
    const [field, oldValue, newValue, modifiedBy] = row.change_note.split('::');
    return { field, oldValue, newValue, modifiedBy, timestamp: row.changed_at };
  });
}

/**
 * Renderizza lo storico nel modal
 */
async function renderOfferHistoryUI(offerId) {
  const history = await getOfferHistory(offerId);
  const container = $("#historyList");
  const section = $("#historySection");

  if (history.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = history.map(h => `
    <div style="background: #f8fafc; padding: 10px; border-radius: 8px; border-left: 3px solid #cbd5e1;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <strong style="color: var(--primary); text-transform: uppercase; font-size: 0.7rem;">${h.field}</strong>
        <span style="color: #94a3b8; font-size: 0.7rem;">${new Date(h.timestamp).toLocaleString()}</span>
      </div>
      <div style="color: #475569;">
        <span style="text-decoration: line-through; opacity: 0.6;">${h.oldValue}</span> 
        <span style="margin: 0 5px;">➔</span> 
        <span style="font-weight: 600;">${h.newValue}</span>
      </div>
      <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">Modificato da: ${h.modifiedBy}</div>
    </div>
  `).join('');
}

// Configurazione Limiti
const RL_CONFIG = {
  maxActions: 10,       // Numero massimo di salvataggi
  windowMs: 60000,      // In 1 minuto (60s)
  cooldownMs: 300000    // Blocco di 5 minuti (300s)
};

/**
 * Sistema Rate Limiting Hard
 */
async function checkRateLimit(partnerId) {
  try {
    const { data, error } = await supabaseClient.rpc('check_rate_limit', {
      p_store_id: partnerId
    });

    if (error) throw error;

    if (data.status === 'blocked') {
      showToast(`Accesso limitato. Riprova tra ${data.minutes_left} minuti.`, "error");
      return false;
    }

    if (data.status === 'limited') {
      showConfirm(
        `⚠️ ATTIVITÀ SOSPETTA: Hai eseguito troppe modifiche in poco tempo. L'account è sospeso per 5 minuti per motivi di sicurezza.`,
        () => { location.reload(); }
      );
      return false;
    }

    return true; // status === 'ok'
  } catch (e) {
    console.error("Errore rate-limit:", e);
    return true; // In caso di errore imprevisto, non blocchiamo l'utente
  }
}

/**
 * Sistema di Audit Log per Admin (Supabase, via RPC security-definer
 * perché va scritto anche quando l'utente è già stato disconnesso,
 * es. nel blocco LOGIN_BLOCKED)
 */
async function logAuditAction(partnerId, type, details) {
  const { error } = await supabaseClient.rpc('log_audit_action', {
    p_actor: String(partnerId),
    p_action: type,
    p_target: details
  });

  if (error) console.error("Errore salvataggio audit log:", error);
}

// --- GESTORE SESSIONE PARTNER ---
function getCurrentPartner() {
  try {
    const temp = sessionStorage.getItem(SESSION_PARTNER);
    const perm = localStorage.getItem(PARTNER_AUTH_KEY);
    
    // Se non c'è nulla in sessione ma c'è nel locale (refresh), ripristina
    if (perm && !temp) {
      sessionStorage.setItem(SESSION_PARTNER, perm);
    }
    
    const data = temp || perm;
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error("Errore recupero sessione partner:", e);
    return null;
  }
}

// --- LOGIN PARTNER (ora collegato a Supabase Auth) ---
window.loginPartnerAction = async (email, pass) => {
  try {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Verifica email+password vere tramite Supabase (un solo controllo, sicuro)
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: cleanEmail,
      password: pass
    });
    if (authError || !authData.user) {
      return { success: false, reason: 'credentials' };
    }

    // 2. Recupera la riga del negozio collegata a questo utente
    const { data: storeRow, error: storeError } = await supabaseClient
      .from('stores')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .single();
    if (storeError || !storeRow) {
      await supabaseClient.auth.signOut();
      return { success: false, reason: 'no-store' };
    }

    // 3. Blocco se l'abbonamento è scaduto (stessa logica di prima)
    if (storeRow.subscription_status === 'expired') {
      await supabaseClient.auth.signOut();
      logAuditAction(storeRow.id, "LOGIN_BLOCKED", "Tentativo di accesso con account scaduto.");
      return { success: false, reason: 'expired' };
    }

    // 4. Recupera le sedi collegate
    const { data: locationsRows } = await supabaseClient
      .from('store_locations')
      .select('*')
      .eq('store_id', storeRow.id);

    // Stesso formato di sempre, per compatibilità col resto della dashboard
    const newStore = {
      id: storeRow.id,
      email: storeRow.email,
      name: storeRow.name,
      address: storeRow.address,
      city: storeRow.city,
      cap: storeRow.cap,
      logo: storeRow.logo_url || "",
      phone: storeRow.phone || "",
      hours: storeRow.hours || "",
      internalNotes: storeRow.internal_notes || "",
      apiKey: storeRow.api_key || "",
      locations: (locationsRows || []).map(l => ({ id: l.id, name: l.name, address: l.address })),
      plan: storeRow.plan,
      subscription: {
        plan: storeRow.plan,
        status: storeRow.subscription_status,
        startedAt: storeRow.trial_started_at,
        daysLeft: storeRow.trial_started_at 
          ? Math.max(0, 30 - Math.floor((Date.now() - Date.parse(storeRow.trial_started_at)) / (24*60*60*1000)))
          : 30
      }
    };

    const sessionData = JSON.stringify(newStore);
    localStorage.setItem(PARTNER_AUTH_KEY, sessionData);
    sessionStorage.setItem(SESSION_PARTNER, sessionData);

    state.currentStore = newStore;
    return { success: true, store: newStore };
  } catch (e) {
    console.error("Errore critico in loginPartnerAction:", e);
    return { success: false, reason: 'technical' };
  }
};

// --- SALVATAGGIO PROFILO PARTNER ---
window.saveStoreProfile = async (e) => {
  e.preventDefault();
  
  try {
    const currentPartner = getCurrentPartner();
    if (!currentPartner) return toast.error("Sessione non valida.");

    // Recupero dati dal form (Impostazioni). L'email resta sola lettura: cambiarla
    // davvero richiederebbe il flusso di verifica di Supabase Auth, non lo facciamo qui.
    const nameInput = document.getElementById("profName");
    const telInput = document.getElementById("profTel");
    const logoInput = document.getElementById("profLogo");
    const hoursInput = document.getElementById("profHours");
    const notesInput = document.getElementById("profNotes");

    const newName = clean(nameInput?.value || "");
    const newLogo = clean(logoInput?.value || "");

    const { data: storeRow, error } = await supabaseClient
      .from('stores')
      .update({
        name: newName,
        phone: clean(telInput?.value || ""),
        hours: clean(hoursInput?.value || ""),
        logo_url: newLogo,
        internal_notes: clean(notesInput?.value || "")
      })
      .eq('id', currentPartner.id)
      .select()
      .single();

    if (error) {
      console.error("Errore salvataggio profilo:", error);
      return toast.error("Errore tecnico durante il salvataggio.");
    }

    // Aggiorna la sessione locale. Non serve più toccare le offerte: nome e logo
    // si leggono sempre dal negozio con una JOIN, niente più copie da sincronizzare.
    const updatedStore = {
      ...currentPartner,
      name: storeRow.name,
      phone: storeRow.phone || "",
      hours: storeRow.hours || "",
      internalNotes: storeRow.internal_notes || "",
      logo: storeRow.logo_url || ""
    };

    const dataString = JSON.stringify(updatedStore);
    sessionStorage.setItem(SESSION_PARTNER, dataString);
    localStorage.setItem(PARTNER_AUTH_KEY, dataString);
    state.currentStore = updatedStore;

    toast.success("Profilo salvato!");
    
    updateDrawerUI();      // Cambia il nome nel menu
    await refreshMyOffers(); // Rinfresca la dashboard del negozio
    renderOffers();        // Rinfresca la griglia pubblica con nome/logo aggiornati
    renderStoreView();

  } catch (err) {
    console.error("Errore salvataggio profilo:", err);
    toast.error("Errore tecnico durante il salvataggio.");
  }
};

window.logoutPartner = () => {
  showConfirm("Vuoi uscire dall'area partner?", () => {
    // PULIZIA TOTALE
    sessionStorage.removeItem(SESSION_PARTNER);
    localStorage.removeItem(PARTNER_AUTH_KEY); // FONDAMENTALE
    
    state.currentStore = null;
    storeData.step = 'pricing';
    storeData.activeTab = 'home';
    
    renderStoreView();
    updateDrawerUI();
    toast.info("Logout partner effettuato.");
  });
};

/**
 * Policy di Scadenza: Imposta tutte le offerte attive di uno store su 'paused'.
 * Le offerte rimangono nel database ma non saranno più visibili agli utenti
 * finché il partner non rinnova l'abbonamento.
 */
async function expireStoreOffers(storeId) {
  const { error } = await supabaseClient
    .from('offers')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('store_id', storeId)
    .eq('status', 'active');

  if (error) {
    console.error("Errore nella sospensione delle offerte:", error);
    return;
  }

  await refreshMyOffers();
}

function renderStoreDashboard() {
  const container = $("#store-app-container");
  if (container && storeData.step === 'dashboard') {
    if (DEV_MODE) console.log("Esecuzione specifica renderStoreDashboard...");
    renderDashboard(container);
  }
}

// 4. Funzione di Refresh Idempotente: garantisce che la UI sia ricostruita correttamente
function refreshUI() {
  syncShoppingList(); // Pulisce il carrello se le offerte sono cambiate
  
  if (typeof renderOffers === 'function') renderOffers();
  
  if (state.mode === 'store' && typeof renderStoreView === 'function') {
    const currentPartner = JSON.parse(sessionStorage.getItem(SESSION_PARTNER));
    if (currentPartner) {
        getMyOffers(); 
        renderStoreView();
    }
  }
}

// Cache sincrona delle offerte del negozio loggato.
// getMyOffers() resta sincrona (la usano tante altre funzioni), legge solo
// questa cache; refreshMyOffers() la riempie davvero parlando con Supabase.
let myOffersCache = [];

function getMyOffers() {
  storeData.offers = myOffersCache;
  return myOffersCache;
}

async function refreshMyOffers() {
  const partner = getCurrentPartner();
  if (!partner) {
    myOffersCache = [];
    return;
  }

  const { data: rows, error } = await supabaseClient
    .from('offers')
    .select('*')
    .eq('store_id', partner.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Errore caricamento offerte del negozio:", error);
    return;
  }

  myOffersCache = (rows || []).map(r => ({
    id: r.id,
    product: r.product,
    price: r.price,
    originalPrice: r.original_price,
    category: r.category,
    startDate: r.start_date,
    endDate: r.end_date,
    description: r.description,
    img: r.img_url,
    status: r.status,
    views: r.views,
    opens: r.opens
  }));

  storeData.offers = myOffersCache;

  if (state.mode === 'store') renderStoreView();
}

// Cache sincrona del cestino del negozio loggato (solo le sue offerte eliminate)
let myTrashCache = [];

async function refreshMyTrash() {
  const partner = getCurrentPartner();
  if (!partner) {
    myTrashCache = [];
    return;
  }

  const { data: rows, error } = await supabaseClient
    .from('offers')
    .select('*')
    .eq('store_id', partner.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error("Errore caricamento cestino:", error);
    return;
  }

  myTrashCache = (rows || []).map(r => ({
    id: r.id,
    product: r.product,
    deletedAt: r.deleted_at
  }));

  if (state.mode === 'store') renderStoreView();
}

let myTeamCache = [];

async function refreshMyTeam() {
  const partner = getCurrentPartner();
  if (!partner) {
    myTeamCache = [];
    return;
  }

  const { data: rows, error } = await supabaseClient
    .from('team_members')
    .select('*')
    .eq('store_id', partner.id)
    .order('added_at', { ascending: true });

  if (error) {
    console.error("Errore caricamento team:", error);
    return;
  }

  myTeamCache = (rows || []).map(r => ({
    id: r.id,
    email: r.email,
    role: r.role,
    addedAt: r.added_at
  }));

  if (state.mode === 'store') renderStoreView();
}

// 2. Funzione per verificare i limiti del piano prima di creare un'offerta
function canCreateOffer(plan, currentCount) {
  // Rimuovi ogni vincolo per i piani premium
  if (plan === 'Standard' || plan === 'Professional') {
    return true;
  }

  // Per il piano Starter o altri, usa la configurazione in PLANS (10 offerte)
  const p = PLANS[plan] || PLANS['Starter'];
  return currentCount < p.maxOffers;
}

// Stato esteso per il Supermercato
let storeData = {
  step: 'pricing', // DEVE ESSERE PRICING
  activeTab: 'home', 
  onboardingStep: 1,
  subscription: {
    plan: 'Starter', // Questo è solo il default di sicurezza
    status: 'trial', 
    daysLeft: 30
  },
  profile: {
    name: "Il mio Supermercato",
    type: "Supermercato",
    address: "Via Roma 1, Milano",
    phone: "02 1234567",
    email: "info@supermercato.it",
    logo: "",
    hours: "08:00 - 20:00",
    web: "www.supermercato.it"
  },
  offers: [] 
};

const PLANS = {
  Starter: { 
    maxOffers: 10, 
    stats: 'basic', 
    features: ['Mappa'], 
    price: 19.99, 
    trialDays: 30 
  },
  Standard: { 
    maxOffers: Infinity, 
    stats: 'advanced', 
    features: ['Illimitate', 'Priority', 'Programmazione'], 
    price: 49.99 
  },
  Professional: { 
    maxOffers: Infinity, 
    stats: 'full', 
    features: ['Featured', 'Multi-negozio', 'API', 'Verificato'], 
    price: 149.99 
  },
  Enterprise: { 
    maxOffers: Infinity, 
    stats: 'full', 
    features: ['Featured', 'Multi-negozio', 'API', 'Verificato', 'Team', 'Export CSV', 'Account manager dedicato'], 
    price: null // prezzo "su misura", gestito a contratto (vedi pulsante "Contattaci" in pricing)
  }
};

const PLAN_LIMITS = PLANS;
// ---------- Utility Funzionali ----------
function nowISODate() { return new Date().toISOString().split("T")[0]; }
function formatPrice(p) { return `€${Number(p).toFixed(2)}`; }

function uid(prefix = "id") {
  try {
    // Prova a usare l'API moderna se disponibile (HTTPS)
    if (window.crypto && window.crypto.randomUUID) {
      return prefix + "_" + crypto.randomUUID();
    }
  } catch (e) {}
  // Fallback robusto per HTTP o browser vecchi
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

/**
 * Genera una stringa casuale alfanumerica per la chiave API.
 */
function generateRandomApiKey(length = 32) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues); // generatore crittograficamente sicuro, non Math.random()
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset.charAt(randomValues[i] % charset.length);
  }
  return "dec_live_" + result;
}

function defaultStoreData() {
  return {
    step: 'pricing', 
    activeTab: 'home', 
    onboardingStep: 1,
    subscription: {
      plan: 'Starter', 
      status: 'trial', 
      daysLeft: 30
    },
    offers: []
  };
}

// ---------- Stato dell'App ----------
let state = {
  mode: "user",
  currentStore: null,
  userLocation: null,
  currentUser: null, // Popolato da restoreUserSession() all'avvio (Supabase Auth)
  currentPage: 1, 
  pageSize: 20    
};

function setMode(mode) {
  try {
    
    state.mode = mode;

    // Elementi UI
    const userView = $("#user-view");
    const storeView = $("#store-view");
    const adminView = $("#admin-view");
    const controls = $("#controls");

    if(userView) userView.classList.toggle("hidden", mode !== "user");
    if(storeView) storeView.classList.toggle("hidden", mode !== "store");
    if(adminView) adminView.classList.toggle("hidden", mode !== "admin");
    if(controls) controls.classList.toggle("hidden", mode !== "user");

    // Aggiorna menu laterale
    $$(".nav-menu li").forEach(li => li.classList.remove("active"));
    if(mode === 'user' && $("#navModeUser")) $("#navModeUser").classList.add("active");
    if(mode === 'store' && $("#navModeStore")) $("#navModeStore").classList.add("active");
    if(mode === 'admin' && $("#navModeAdmin")) $("#navModeAdmin").classList.add("active");
    
    if(mode === 'store') renderStoreView();

    closeDrawer();
    window.scrollTo(0,0);
  } catch (e) {
    console.error("Errore nel cambio modalità:", e);
  }
}

// ---------- Rendering Offerte con Filtri e Ordinamento ----------
// Recupera i dati pubblici dei negozi (name, city, cap, address, plan) per una lista
// di store_id, passando da "public_stores": "stores" ha la RLS bloccata per chi
// non è il proprietario. Ritorna una mappa { storeId: {...} }.
async function fetchPublicStoresMap(storeIds) {
  const uniqueIds = [...new Set(storeIds)].filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabaseClient
    .from('public_stores')
    .select('id, name, city, cap, address, plan')
    .in('id', uniqueIds);

  if (error) console.error("Errore caricamento dati negozi pubblici:", error);
  return Object.fromEntries((data || []).map(s => [s.id, s]));
}

async function renderOffers(page = state.currentPage, pageSize = state.pageSize) {
  try {
    const grid = $("#offersGrid");
    if(!grid) return;

    const today = new Date().toISOString().split("T")[0];
    const query = ($("#searchInput")?.value || "").toLowerCase().trim();
    const sortMode = $("#categorySelect")?.value || "";
    const userCity = getCleanUserCity();
    const userCap = getCleanUserCap();

    // Chiediamo a Supabase solo le offerte attive e non scadute, unite ai dati
    // del negozio collegato (nome, città, ecc. — non più duplicati nella riga offerta).
    const { data: rows, error } = await supabaseClient
      .from('offers')
      .select('*')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today);

    if (error) {
      console.error("Errore caricamento offerte pubbliche:", error);
      grid.innerHTML = "";
      return;
    }

    const storesById = await fetchPublicStoresMap((rows || []).map(r => r.store_id));

    // Riportiamo ogni riga nello stesso formato "appiattito" che il resto del
    // codice si aspetta già (storeName, storeCity, ecc. invece di stores.name)
    const allOffers = (rows || []).map(r => {
      const store = storesById[r.store_id] || {};
      return {
        id: r.id,
        product: r.product,
        price: r.price,
        originalPrice: r.original_price,
        category: r.category,
        startDate: r.start_date,
        endDate: r.end_date,
        description: r.description,
        img: r.img_url,
        status: r.status,
        storeName: store.name || "",
        storeCity: store.city ? store.city.toLowerCase() : "",
        storeCap: store.cap || "",
        storeAddress: store.address || "",
        plan: store.plan || "Starter"
      };
    });

    // Da qui in poi: stessa identica logica di filtro/ordinamento di sempre.
    let filtered = allOffers.filter(o => {
      const matchesSearch = !query || 
                            o.product.toLowerCase().includes(query) || 
                            o.storeName.toLowerCase().includes(query);
      const matchesCity = !userCity || (o.storeCity === userCity);
      const matchesCap = !userCap || (o.storeCap === userCap);
      return matchesSearch && matchesCity && matchesCap;
    });

    if (sortMode === "price-asc") {
      filtered.sort((a, b) => a.price - b.price);
    } 
    else if (sortMode === "price-desc") {
      filtered.sort((a, b) => b.price - a.price);
    } 
    else if (sortMode === "best") {
      filtered.sort((a, b) => {
        const discA = a.originalPrice > 0 ? (a.originalPrice - a.price) / a.originalPrice : 0;
        const discB = b.originalPrice > 0 ? (b.originalPrice - b.price) / b.originalPrice : 0;
        return discB - discA;
      });
    } 
    else {
      const planWeight = { Enterprise: 4, Professional: 3, Standard: 2, Starter: 1 };
      filtered.sort((a, b) => (planWeight[b.plan] || 0) - (planWeight[a.plan] || 0));
    }

    const emptyMsg = $("#emptyMsg");
    if (filtered.length === 0) {
      grid.innerHTML = "";
      if (emptyMsg) {
        emptyMsg.style.display = "block";
        let msg = "Nessuna offerta disponibile.";
        if (userCity) {
          msg = `Nessuna offerta trovata a ${userCity.toUpperCase()}`;
          if (userCap) msg += ` (CAP: ${userCap})`;
          msg += ".";
        }
        emptyMsg.innerText = msg;
      }
      $("#paginationContainer").style.display = "none";
      return;
    }

    if(emptyMsg) emptyMsg.style.display = "none";

    const start = 0;
    const end = page * pageSize;
    const paginatedItems = filtered.slice(start, end);

    grid.innerHTML = "";
    paginatedItems.forEach(o => {
      grid.appendChild(createOfferCardElement(o));
    });

    const pagContainer = $("#paginationContainer");
    if (pagContainer) {
      pagContainer.style.display = filtered.length > end ? "block" : "none";
    }

  } catch (err) {
    console.error("Errore durante il rendering delle offerte:", err);
  }
}

/**
 * Helper: Crea l'elemento DOM della card prodotto (usato da renderOffers)
 */
function createOfferCardElement(o) {
  supabaseClient.rpc('increment_offer_stat', { p_offer_id: o.id, p_field: 'views' })
    .then(({ error }) => { if (error) console.warn("Errore views:", error); });
  const card = document.createElement("div");
  
  const isEnterprise = o.plan === 'Enterprise';
  const isProfessional = o.plan === 'Professional';
  const isStandard = o.plan === 'Standard';
  
  // Applichiamo le classi di bordo (Viola per Professional, Blu per Standard)
  card.className = `offer-row ${isEnterprise ? 'offer-enterprise' : ''} ${isProfessional ? 'offer-featured' : ''} ${isStandard ? 'offer-highlight' : ''}`;
  card.onclick = () => openProductDetail(o.id);

  // 1. CONTENITORE IMMAGINE
  const imgCont = document.createElement("div");
  imgCont.className = "product-image-container";
  
  const img = document.createElement("img");
  img.src = getSafeImageUrl(o.img);
  img.className = "product-img";
  img.alt = o.product;
  img.loading = "lazy";
  imgCont.appendChild(img);

  // Badge Sconto
  if (o.originalPrice > o.price) {
    const badge = document.createElement("span");
    badge.className = "perc-badge";
    badge.textContent = `-${Math.round(((o.originalPrice - o.price) / o.originalPrice) * 100)}%`;
    imgCont.appendChild(badge);
  }

  // 2. CONTENITORE INFO
  const info = document.createElement("div");
  info.className = "product-info";
  
  const details = document.createElement("div");
  details.className = "product-details";
  
  // Nome Negozio + Eventuale Distintivo Verificato
  const storeRow = document.createElement("div");
  storeRow.className = "store-name";
  storeRow.style.display = "flex";
  storeRow.style.alignItems = "center";
  storeRow.style.gap = "5px";
  storeRow.style.marginBottom = "5px";
  storeRow.textContent = o.storeName || 'Supermercato';
  
  if (isProfessional) {
    const verBadge = document.createElement("span");
    verBadge.className = "store-verified-blue";
    verBadge.style.color = "#0f62fe";
    verBadge.style.fontWeight = "800";
    verBadge.style.fontSize = "0.7rem";
    verBadge.style.textTransform = "uppercase";
    verBadge.textContent = "✓ Negozio Verificato";
    storeRow.appendChild(verBadge);
  }

  const title = document.createElement("h3");
  title.style.margin = "0 0 10px 0";
  title.textContent = o.product;

  const priceCont = document.createElement("div");
  priceCont.className = "price-container";
  const price = document.createElement("span");
  price.className = "price-tag";
  price.style.color = "#0f62fe";
  price.style.fontWeight = "800";
  price.style.fontSize = "1.5rem";
  price.textContent = formatPrice(o.price);
  priceCont.appendChild(price);

  details.appendChild(storeRow);
  details.appendChild(title);
  details.appendChild(priceCont);

  // 3. TASTO AGGIUNGI
  const actions = document.createElement("div");
  actions.className = "product-actions";
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = "Aggiungi";
  addBtn.onclick = (e) => { e.stopPropagation(); saveToShoppingList(o.id); };
  actions.appendChild(addBtn);

  info.appendChild(details);
  info.appendChild(actions);
  
  card.appendChild(imgCont);
  card.appendChild(info);
  return card;
}

// --- TAB: GESTIONE OFFERTE ---
function renderOffersTab() {
  const partner = getCurrentPartner();
  const planName = partner?.plan || 'Starter';
  const limit = PLANS[planName].maxOffers;
  const current = storeData.offers.length;
  
  // Logica per testo dinamico
  let limitInfo = "";
  if (planName === 'Standard' || planName === 'Professional') {
    limitInfo = `Piano <strong>${planName}</strong>: Offerte illimitate sbloccate (${current} create)`;
  } else {
    limitInfo = `Stato del piano: <strong>${current}</strong> / ${limit} offerte attive`;
  }

  const isLimitReached = planName === 'Starter' && current >= limit;

  return `
    <header class="tab-header">
      <div>
        <h2>Le tue Offerte</h2>
        <div style="margin-top: 5px;">
            <span style="font-size: 0.85rem; color: #64748b;">${limitInfo}</span>
            ${isLimitReached ? '<br><small style="color: #ef4444; font-weight: 700;">⚠️ Limite raggiunto!</small>' : ''}
        </div>
      </div>
      <button class="btn ${isLimitReached ? 'disabled' : ''}" 
              ${isLimitReached ? 'disabled' : ''} 
              onclick="handleNewOfferClick()">
        ${isLimitReached ? 'Limite raggiunto' : '+ Crea Nuova'}
      </button>
    </header>
    <div class="card">
      ${renderOffersTable()}
    </div>
  `;
}

function renderOffersTable(limit = 999) {
  
  const myOffers = getMyOffers(); // Filtra per storeId

  if (myOffers.length === 0) {
    return `<div class="empty-state">Nessuna offerta creata.</div>`;
  }

  let rows = myOffers.slice(0, limit).map(o => {
    const isExpired = new Date(o.endDate) < new Date();
    const statusClass = isExpired ? 'status-expired' : `status-${o.status}`;
    const statusLabel = isExpired ? 'SCADUTA' : o.status.toUpperCase();

    return `
      <tr>
        <td>
          <img src="${getSafeImageUrl(o.img)}" 
               style="width:40px; height:40px; border-radius:4px; object-fit:cover; border:1px solid #eee;">
        </td>
        <td>
          <div style="font-weight:700;">${o.product}</div>
          <div style="font-size:0.75rem; color:#64748b;">${o.category}</div>
        </td>
        <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
        <td><strong style="color:var(--primary);">${formatPrice(o.price)}</strong></td>
        <td style="font-size:0.8rem;">${o.endDate}</td>
        <td>
          <button class="btn outline" style="padding:5px 10px" onclick="editOffer('${o.id}')">✏️</button>
          <button class="btn danger" style="padding:5px 10px" onclick="deleteOffer('${o.id}')">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="offer-table">
      <thead>
        <tr><th>Foto</th><th>Prodotto</th><th>Stato</th><th>Prezzo</th><th>Scadenza</th><th>Azioni</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// --- TAB: ABBONAMENTO ---
function renderSubTab() {
  const partner = getCurrentPartner();
  const sub = partner?.subscription || storeData.subscription;
  const plan = partner?.plan || sub.plan;
  const status = sub.status || 'trial';
  
  let statusContent = '';
  let actionButtons = '';

  // --- 1. LOGICA PIANO PROFESSIONAL ---
  if (plan === 'Professional' && status === 'active') {
    const renewalDate = new Date(sub.renewalDate);
    const now = new Date();
    const diffTime = renewalDate - now;
    const daysToRenewal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Banner rosso di allerta per Professional (Negli ultimi 5 giorni)
    let urgencyBanner = "";
    if (daysToRenewal <= 5) {
      urgencyBanner = `
        <div style="background: #fee2e2; border: 1px solid #ef4444; color: #b91c1c; padding: 15px; border-radius: 12px; margin-bottom: 20px; font-size: 0.95rem; font-weight: 700; display: flex; align-items: center; gap: 12px; animation: pulse 2s infinite;">
          <span style="font-size: 1.2rem;">🚨</span> Il tuo piano Professional sta per scadere – rinnova ora per mantenere la priorità assoluta e le sedi extra.
        </div>`;
    }

    statusContent = `
      <div class="card plan-active" style="border-left: 5px solid #6929c4;">
        ${urgencyBanner}
        <span class="status-badge" style="background: #f3e8ff; color: #6929c4;">PIANO PROFESSIONAL</span>
        <h3 style="margin-top: 10px;">Stato: Abbonamento Attivo</h3>
        <p>Data di rinnovo: <strong>${renewalDate.toLocaleDateString()}</strong></p>
        <p>Giorni rimanenti: <strong style="font-size: 1.2rem; ${daysToRenewal <= 5 ? 'color: #ef4444;' : 'color: #6929c4;'}">${daysToRenewal}</strong></p>
        <ul style="font-size: 0.8rem; color: #64748b; margin-top: 10px; padding-left: 20px;">
          <li>Priorità massima nelle ricerche</li>
          <li>Gestione multi-sede attiva</li>
          <li>Accesso API sbloccato</li>
        </ul>
      </div>`;

    actionButtons = `
      <button class="btn" style="background: #6929c4;" onclick="activatePlan('Professional')">Rinnova Professional</button>
      <button class="btn outline" onclick="storeData.step='pricing'; renderStoreView();">Gestisci Piani</button>`;
  }

  // --- 2. LOGICA PIANO STANDARD (Esistente) ---
  else if (plan === 'Standard' && status === 'active') {
    const renewalDate = new Date(sub.renewalDate);
    const diffTime = renewalDate - new Date();
    const daysToRenewal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let warningBanner = daysToRenewal <= 5 ? `
      <div style="background: #fff7ed; border: 1px solid #f97316; color: #9a3412; padding: 12px; border-radius: 8px; margin-bottom: 15px; font-size: 0.9rem; font-weight: 600; display: flex; align-items: center; gap: 10px;">
        <span>⚠️</span> Il tuo piano sta per scadere – rinnova ora.
      </div>` : "";

    statusContent = `
      <div class="card plan-active">
        ${warningBanner}
        <span class="status-badge status-active">ABBONAMENTO ATTIVO</span>
        <h3>Piano: Standard</h3>
        <p>Prossimo rinnovo: <strong>${renewalDate.toLocaleDateString()}</strong></p>
        <p>Giorni al rinnovo: <strong style="${daysToRenewal <= 5 ? 'color: #f97316;' : ''}">${daysToRenewal}</strong></p>
      </div>`;
    actionButtons = `<button class="btn" onclick="activatePlan('Standard')">Rinnova Ora</button>`;
  }

  // --- 3. LOGICA TRIAL O EXPIRED (Esistente) ---
  else if (status === 'trial' || status === 'expired') {
    const isExpired = status === 'expired';
    statusContent = `
      <div class="card ${isExpired ? 'trial-expired' : 'trial-active'}" style="${isExpired ? 'border-color: #ef4444; background: #fff5f5;' : ''}">
        <span class="status-badge ${isExpired ? 'status-expired' : 'status-trial'}">${isExpired ? 'SCADUTO' : 'PROVA GRATUITA'}</span>
        <h3>Piano: ${plan}</h3>
        <p>${isExpired ? 'Le tue offerte sono state messe in pausa.' : `Hai ancora <strong>${sub.daysLeft} giorni</strong> di prova.`}</p>
      </div>`;
    actionButtons = `<button class="btn" onclick="storeData.step='pricing'; renderStoreView();">${isExpired ? 'Riattiva ora' : 'Upgrade a Standard'}</button>`;
  }

  // --- 4. LOGICA STARTER ---
  else {
    statusContent = `
      <div class="card plan-active">
        <span class="status-badge status-active">ATTIVO</span>
        <h3>Piano: Starter</h3>
        <p>Limiti: 10 offerte attive. Nessuna funzione avanzata.</p>
      </div>`;
    actionButtons = `<button class="btn outline" onclick="storeData.step='pricing'; renderStoreView();">Passa a Standard</button>`;
  }

  return `
    <div class="subscription-tab">
      ${getSubscriptionBanner()}
      <header class="tab-header">
        <h2>Il tuo Abbonamento</h2>
      </header>
      ${statusContent}
      <div style="margin-top: 25px; display: flex; gap: 10px;">
        ${actionButtons}
      </div>
    </div>
  `;
}

// --- TAB: PROFILO ---
function renderProfileTab() {
  const partner = getCurrentPartner();
  if (!partner) return '';

  return `
    <header class="tab-header">
      <h2>⚙️ Impostazioni Account</h2>
    </header>
    
    <div class="card-saas">
      <form class="auth-form" id="storeSettingsForm" onsubmit="saveStoreProfile(event)">
        
        <div style="margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;">
          <h4 style="color: #64748b; font-size: 0.8rem; text-transform: uppercase;">Dati Societari (Sola Lettura)</h4>
          <div class="input-group">
            <label>Email Account / Login</label>
            <input type="text" id="profEmail" value="${partner.email}" disabled style="background: #f8fafc; cursor: not-allowed; color: #94a3b8;">
            <small>L'email principale non può essere modificata autonomamente.</small>
          </div>
        </div>

        <h4 style="color: #64748b; font-size: 0.8rem; text-transform: uppercase;">Informazioni Pubbliche</h4>
        
        <div class="form-row">
          <div class="input-group">
            <label>Nome Insegna</label>
            <input type="text" id="profName" value="${partner.name}" required>
          </div>
          <div class="input-group">
            <label>Telefono Contatto</label>
            <input type="tel" id="profTel" value="${partner.phone || ''}">
          </div>
        </div>

        <div class="input-group">
          <label>URL Logo Supermercato</label>
          <input type="url" id="profLogo" value="${partner.logo || ''}" placeholder="https://link-immagine.png">
        </div>

        <div class="input-group">
          <label>Orari di Apertura Generali</label>
          <input type="text" id="profHours" value="${partner.hours || ''}" placeholder="Es: Lun-Sab 08:30-20:00">
        </div>

        <div class="input-group">
          <label>Note Interne / Memo</label>
          <textarea id="profNotes" rows="3" placeholder="Inserisci note visibili solo a te...">${partner.internalNotes || ''}</textarea>
        </div>

        <button type="submit" class="btn" style="margin-top: 20px; width: 100%;">Salva Impostazioni Account</button>
      </form>
    </div>
  `;
}

// Funzione helper per aggiungere campi nel DOM
window.addNewLocationField = () => {
  if (!checkPermission('Professional')) return;
  const container = document.getElementById("locationsContainer");
  const div = document.createElement("div");
  div.className = "card";
  div.style.cssText = "display: flex; gap: 10px; padding: 15px; background: #f8fafc; margin-top: 10px;";
  div.innerHTML = `
    <div style="flex: 1;">
      <input type="text" class="loc-name" placeholder="Nome sede" style="margin-bottom:5px; font-weight:700;">
      <input type="text" class="loc-addr" placeholder="Indirizzo completo">
    </div>
    <button type="button" class="btn danger" onclick="this.parentElement.remove()" style="padding: 5px 10px;">&times;</button>
  `;
  container.appendChild(div);
};

// --- GESTIONE MODALE OFFERTE (NUOVA/EDIT) ---
window.openOfferModal = (offer = null) => {
  try {
  const modal = $("#offerModal");
  const partner = getCurrentPartner();
  modal.style.display = "flex";

  document.body.style.overflow = 'hidden';

  // Gestione dinamica del Dropdown Sedi
  const locSelect = $("#offLocation");
  const locContainer = locSelect.closest('.input-group'); // Prende il contenitore per nasconderlo/mostrarlo
  const locations = partner.locations || [];

  if (locations.length > 1) {
    // Mostra il selettore solo se ci sono più sedi
    locContainer.classList.remove("hidden");
    locSelect.innerHTML = locations.map((loc, idx) => `
      <option value="${idx}" ${offer && offer.locationIdx == idx ? 'selected' : ''}>
        ${loc.name} (${loc.address})
      </option>
    `).join('');
  } else {
    // Nascondi se c'è solo una sede (quella predefinita)
    locContainer.classList.add("hidden");
    locSelect.innerHTML = `<option value="0">Sede Principale</option>`;
  }

  if (offer) {
    $("#offerModalTitle").innerText = "Modifica Offerta";
    $("#offerId").value = offer.id;
    $("#offNome").value = offer.product || "";
    $("#offPrezzoSconto").value = offer.price || "";
    $("#offPrezzoOrig").value = offer.originalPrice || "";
    $("#offCat").value = offer.category || "Ortofrutta";
    $("#offStartDate").value = offer.startDate || ""; 
    $("#offEndDate").value = offer.endDate || "";
    $("#offImg").value = offer.img || ""; 
    $("#offDesc").value = offer.description || "";
    $("#offStatus").value = offer.status || "active";
    renderOfferHistoryUI(offer.id);
  } else {
    $("#offerModalTitle").innerText = "Nuova Offerta";
    $("#offerForm").reset();
    $("#offerId").value = "";
    $("#historySection").classList.add("hidden");
  }
} catch (e) { console.error(e); }
};

window.closeOfferModal = () => {
  try {
    $("#offerModal").style.display = "none";
    // RIPRISTINA SCORRIMENTO
    document.body.style.overflow = '';
  } catch (e) { console.error(e); }
};

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = $("#closeOfferModal");
  if (closeBtn) {
      closeBtn.onclick = () => $("#offerModal").style.display = "none";
  }
});

async function validateImageUrl(url) {
  if (!url) return { valid: false };
  
  const trimmedUrl = url.trim();

  // Controllo di sicurezza: blocca protocolli pericolosi come javascript: o data: non immagine
  if (trimmedUrl.toLowerCase().startsWith('javascript:') || 
      (trimmedUrl.toLowerCase().startsWith('data:') && !trimmedUrl.toLowerCase().startsWith('data:image/'))) {
    return { valid: false };
  }

  // Regex per verificare se è un URL ben formato
  const pattern = new RegExp('^(https?:\\/\\/)?'+ // protocollo
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // nome dominio
    '((\\d{1,3}\\.){3}\\d{1,3}))'+ // o ip
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // porta e percorso
    '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
    '(\\#[-a-z\\d_]*)?$','i'); // anchor
    
  return { valid: !!pattern.test(trimmedUrl) };
}

$("#offerForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  
  try {
    const partner = getCurrentPartner();
    if (!partner) return toast.error("Sessione scaduta, effettua nuovamente il login.");

    // Rate-limit: max 10 salvataggi/minuto per negozio
    const allowed = await checkRateLimit(partner.id);
    if (!allowed) return;

    // 1. Recupero dati dai campi
    const existingId = $("#offerId").value;
    const oldOffer = existingId ? (getMyOffers().find(o => o.id === existingId) || {}) : null;
    const nome = $("#offNome").value.trim();
    const prezzoSconto = parseFloat($("#offPrezzoSconto").value);
    const prezzoOrig = parseFloat($("#offPrezzoOrig").value);
    const dataInizio = $("#offStartDate").value;
    const dataFine = $("#offEndDate").value;
    const imgUrl = $("#offImg").value.trim();

    // 2. Validazione rapida
    if (prezzoSconto >= prezzoOrig) {
      return toast.error("Il prezzo scontato deve essere inferiore a quello originale.");
    }
    if (new Date(dataFine) < new Date(dataInizio)) {
      return toast.error("La data di fine non può essere precedente alla data di inizio.");
    }
    if (imgUrl) {
      const imgCheck = await validateImageUrl(imgUrl);
      if (!imgCheck.valid) {
        return toast.error("L'URL immagine inserito non è valido o non è sicuro.");
      }
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Salvataggio in corso...";

    // Recupera location_id dal select
    const locationSelect = $("#offLocation");
    const locationIdx = locationSelect ? parseInt(locationSelect.value) : 0;
    const locationId = partner.locations && partner.locations[locationIdx] 
      ? partner.locations[locationIdx].id 
      : null;

    const offerFields = {
      product: nome,
      price: prezzoSconto,
      original_price: prezzoOrig,
      start_date: dataInizio,
      end_date: dataFine,
      category: $("#offCat").value,
      description: $("#offDesc").value.trim(),
      status: $("#offStatus").value || 'active',
      img_url: imgUrl || PLACEHOLDER_IMG,
      location_id: locationId,  // FIX: aggiunto campo location_id
      limited_quantity: $("#offLimited") ? $("#offLimited").checked : false,
      updated_at: new Date().toISOString()
    };

    let savedOffer, saveError;

    if (existingId) {
      // MODIFICA: aggiorna la riga esistente
      ({ data: savedOffer, error: saveError } = await supabaseClient
        .from('offers')
        .update(offerFields)
        .eq('id', existingId)
        .select()
        .single());
    } else {
      // CREAZIONE: nuova riga, collegata al negozio loggato.
      // Il database stesso blocca chi supera il limite offerte del proprio piano (Starter = 10).
      ({ data: savedOffer, error: saveError } = await supabaseClient
        .from('offers')
        .insert({ ...offerFields, store_id: partner.id })
        .select()
        .single());
    }

    if (saveError) throw new Error(saveError.message);

    if (existingId && oldOffer) {
      const fieldsToTrack = [
        ['Prodotto', oldOffer.product, offerFields.product],
        ['Prezzo Scontato', oldOffer.price, offerFields.price],
        ['Prezzo Originale', oldOffer.originalPrice, offerFields.original_price],
        ['Categoria', oldOffer.category, offerFields.category],
        ['Data Inizio', oldOffer.startDate, offerFields.start_date],
        ['Data Fine', oldOffer.endDate, offerFields.end_date],
        ['Descrizione', oldOffer.description, offerFields.description],
        ['Stato', oldOffer.status, offerFields.status],
        ['Immagine', oldOffer.img, offerFields.img_url]
      ];
      for (const [label, oldVal, newVal] of fieldsToTrack) {
        await logOfferChange(existingId, label, oldVal, newVal, partner.name);
      }
    }

    toast.success(existingId ? "Offerta aggiornata!" : "Nuova offerta pubblicata!");
    
    // 4. Chiusura e Refresh UI
    closeOfferModal();
    await refreshMyOffers(); // Rinfresca la dashboard del partner con i dati veri
    renderOffers();          // Rinfresca la griglia pubblica se visibile

  } catch (err) {
    console.error("Errore salvataggio offerta:", err);
    toast.error("Si è verificato un errore durante il salvataggio: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "Salva Offerta";
  }
};

window.editOffer = (id) => {
  const offer = storeData.offers.find(o => o.id === id);
  openOfferModal(offer);
};

window.deleteOffer = (id) => {
  showConfirm("Spostare questa offerta nel cestino?", async () => {
    const { error } = await supabaseClient
      .from('offers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error("Errore eliminazione offerta:", error);
      return toast.error("Errore durante l'eliminazione.");
    }

    toast.info("Offerta spostata nel cestino.");
    await refreshMyOffers();
    renderOffers();
  });
};


// ---------- Gestione Utenti e Sessione ----------
async function registerUser(userData) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: userData.email,
      password: userData.pass,
      options: {
        data: {
          name: userData.nome,
          surname: userData.cognome,
          city: userData.citta,
          cap: userData.cap
        }
      }
    });

    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        return { success: false, msg: TEXT.auth.emailExists };
      }
      return { success: false, msg: error.message };
    }

    return { success: true };
  } catch (e) {
    console.error("Errore registrazione utente:", e);
    return { success: false, msg: "Errore durante la registrazione." };
  }
}

async function loginUser(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error || !data.user) {
      const notConfirmed = error?.message?.includes("Email not confirmed");
      const msg = notConfirmed
        ? "Devi confermare l'email prima di accedere."
        : "Email o password errati.";
      return { success: false, msg, needsVerification: notConfirmed };
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('name, surname, city, cap')
      .eq('id', data.user.id)
      .single();

    if (profileError) console.error("Errore recupero profilo:", profileError);

    state.currentUser = {
      id: data.user.id,
      email: data.user.email,
      nome: profile?.name || '',
      cognome: profile?.surname || '',
      citta: profile?.city || '',
      cap: profile?.cap || ''
    };

    updateLocationUI(`${state.currentUser.cap} ${state.currentUser.citta}`.trim());
    updateDrawerUI();
    renderOffers();

    return { success: true };
  } catch (e) {
    console.error("Errore login:", e);
    return { success: false, msg: "Errore tecnico durante l'accesso." };
  }
}

async function logoutUser() {
  try {
    await supabaseClient.auth.signOut();
  } catch (e) {
    console.error("Errore signOut Supabase:", e);
  }
  state.currentUser = null;
  localStorage.removeItem(SESSION_KEY); // pulisce anche il fallback admin "legacy"

  closeFullPageModal();
  updateDrawerUI();
  updateLocationUI("Posizione non impostata");
  renderOffers();
  toast.info(TEXT.auth.logoutBtn);
}

function deleteAccount() {
  showConfirm("ATTENZIONE: Sei sicuro di voler eliminare definitivamente il tuo account?", async () => {
    try {
      const userId = state.currentUser?.id;
      if (!userId) throw new Error("Sessione non valida.");

      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Sessione non valida.");

      const response = await fetch("https://noqdpjlbmyjqzlmstfvx.supabase.co/functions/v1/delete-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        }
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Errore eliminazione account.");

      await supabaseClient.auth.signOut();
      state.currentUser = null;
      localStorage.removeItem(SESSION_KEY);
      closeFullPageModal();
      updateDrawerUI();
      showToast("Account eliminato definitivamente.", "error");
    } catch (e) {
      console.error("Errore eliminazione account:", e);
      toast.error("Errore durante l'eliminazione dell'account.");
    }
  });
}

// Funzione helper per aggiornare la barra della posizione ovunque
function updateLocationUI(text) {
  const locInput = $("#locationInput");
  if (locInput) locInput.value = text;
}

// MODIFICA: updateProfile per rinfrescare i risultati
async function updateProfile(updatedData) {
  try {
    const userId = state.currentUser?.id;
    if (!userId) return false;

    const { error } = await supabaseClient
      .from('profiles')
      .update({
        name: updatedData.nome,
        surname: updatedData.cognome,
        city: updatedData.citta,
        cap: updatedData.cap
      })
      .eq('id', userId);

    if (error) throw error;

    state.currentUser = { ...state.currentUser, ...updatedData };
    updateLocationUI(`${updatedData.cap} ${updatedData.citta}`);
    updateDrawerUI();
    renderOffers();

    return true;
  } catch (e) {
    console.error("Errore aggiornamento profilo:", e);
    return false;
  }
}

// Ripristina la sessione (cliente o admin) da Supabase Auth al caricamento pagina.
// Non esiste più nessun fallback locale: ora tutto passa da Supabase Auth.
async function restoreUserSession() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session || !session.user) {
      state.currentUser = null;
      return;
    }

    const [{ data: profile, error: profileError }, { data: adminRow }] = await Promise.all([
      supabaseClient.from('profiles').select('name, surname, city, cap').eq('id', session.user.id).single(),
      supabaseClient.from('admins').select('auth_user_id').eq('auth_user_id', session.user.id).maybeSingle()
    ]);

    if (profileError) console.error("Errore recupero profilo:", profileError);

    state.currentUser = {
      id: session.user.id,
      email: session.user.email,
      nome: profile?.name || '',
      cognome: profile?.surname || '',
      citta: profile?.city || '',
      cap: profile?.cap || '',
      role: adminRow ? 'admin' : 'customer'
    };
  } catch (e) {
    console.error("Errore ripristino sessione utente:", e);
    state.currentUser = null;
  }
}

// ============ VERIFICA EMAIL CON CODICE OTP ============
let pendingVerification = null; // { type: 'customer' } oppure { type: 'store', storeInsertData: {...} }

function renderOtpVerificationScreen(email) {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Verifica la tua email";
  content.innerHTML = `
    <div class="auth-container" style="text-align:center;">
      <h3>Controlla la tua posta</h3>
      <p style="margin-bottom: 15px; color:#64748b;">Abbiamo inviato un codice a 6 cifre a<br><strong>${email}</strong></p>
      <div id="otpError" class="error-msg hidden"></div>
      <input type="text" id="otpCodeInput" maxlength="6" inputmode="numeric" pattern="[0-9]*"
        placeholder="000000" style="font-size:1.5rem; letter-spacing:8px; text-align:center; width:180px; padding:10px; margin:10px 0;">
      <br>
      <button class="btn" id="verifyOtpBtn" style="width:180px;">Verifica</button>
      <p style="margin-top:20px; font-size:0.9rem;">
        Non hai ricevuto il codice? <a href="javascript:void(0)" id="resendOtpLink">Invialo di nuovo</a>
      </p>
    </div>
  `;

  $("#verifyOtpBtn").onclick = async () => {
    const token = $("#otpCodeInput").value.trim();
    const err = $("#otpError");
    if (token.length !== 6) {
      err.innerText = "Inserisci il codice a 6 cifre.";
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    await completeEmailVerification(email, token);
  };

  $("#resendOtpLink").onclick = async (e) => {
    e.preventDefault();
    const { error } = await supabaseClient.auth.resend({ type: 'signup', email });
    if (error) toast.error("Errore nell'invio. Riprova tra qualche minuto.");
    else toast.success("Codice reinviato!");
  };
}

async function completeEmailVerification(email, token) {
  if (!pendingVerification) {
    toast.error("Sessione di verifica scaduta. Ricomincia la registrazione.");
    return;
  }

  const { data, error } = await supabaseClient.auth.verifyOtp({ email, token, type: 'signup' });
  if (error || !data.user) {
    const err = $("#otpError");
    err.innerText = "Codice non valido o scaduto. Riprova o richiedine uno nuovo.";
    err.classList.remove("hidden");
    return;
  }

  if (pendingVerification.type === 'customer') {
    pendingVerification = null;
    await restoreUserSession();
    updateDrawerUI();
    renderOffers();
    toast.success("Email verificata! Benvenuto su Decerne.");
    closeFullPageModal();
  } else if (pendingVerification.type === 'store') {
    await finalizeStoreRegistration(data.user.id);
  }
}

async function finalizeStoreRegistration(authUserId) {
  const d = pendingVerification.storeInsertData;
  try {
    const { data: storeRow, error: storeError } = await supabaseClient
      .from('stores')
      .insert({
        auth_user_id: authUserId,
        email: d.emailClean,
        name: d.name,
        address: d.fullAddress,
        city: d.city,
        cap: d.cap,
        logo_url: d.logoUrl,
        phone: d.phone,
        plan: d.planChoice,
        internal_notes: d.referralNotes
      })
      .select()
      .single();
    if (storeError) throw new Error("Errore creazione negozio: " + storeError.message);

    const { data: locationRow } = await supabaseClient
      .from('store_locations')
      .insert({
        store_id: storeRow.id,
        name: "Sede Principale",
        address: d.fullAddress
      })
      .select()
      .single();

    const newStore = {
      id: storeRow.id,
      email: storeRow.email,
      name: storeRow.name,
      address: storeRow.address,
      city: storeRow.city,
      cap: storeRow.cap,
      logo: storeRow.logo_url || "",
      phone: storeRow.phone || "",
      hours: "",
      internalNotes: storeRow.internal_notes || "",
      locations: [{ id: locationRow.id, name: "Sede Principale", address: d.fullAddress }],
      plan: storeRow.plan,
      subscription: {
        plan: storeRow.plan,
        status: 'trial',
        startedAt: new Date().toISOString().split("T")[0],
        daysLeft: 30
      }
    };

    const sessionData = JSON.stringify(newStore);
    localStorage.setItem(PARTNER_AUTH_KEY, sessionData);
    sessionStorage.setItem(SESSION_PARTNER, sessionData);

    state.currentStore = newStore;
    storeData.step = 'dashboard';
    storeData.activeTab = 'home';
    storeData.tempReg = null;
    pendingVerification = null;

    toast.success("Email verificata! Benvenuto nel tuo pannello.");
    renderStoreView();
    updateDrawerUI();
  } catch (e) {
    console.error("Errore finalizzazione registrazione negozio:", e);
    toast.error("Errore tecnico: " + e.message);
  }
}

async function refreshCartBadge() {
  const badge = $("#cartBadge");
  if (!badge) return;

  const userId = state.currentUser?.id;
  if (!userId) {
    badge.classList.add("hidden");
    return;
  }

  const { count, error } = await supabaseClient
    .from('shopping_list_items')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    console.error("Errore conteggio lista spesa:", error);
    return;
  }

  badge.classList.toggle("hidden", !count);
}

// 2. Funzione per aggiungere alla lista (Supabase)
window.saveToShoppingList = async (id) => {
  const userId = state.currentUser?.id;
  if (!userId) {
    toast.info("Devi accedere per salvare un'offerta nella tua lista.");
    return openFullPageModal('profile');
  }

  const { error } = await supabaseClient
    .from('shopping_list_items')
    .insert({ user_id: userId, offer_id: id });

  if (error) {
    if (error.code === '23505') { // violazione unique(user_id, offer_id)
      return toast.info("Il prodotto è già nella tua lista.");
    }
    console.error("Errore salvataggio lista spesa:", error);
    return toast.error("Errore durante il salvataggio.");
  }

  await refreshCartBadge();
  toast.success("Aggiunto alla lista!");
};

// --- TAB: HOME ---
// (La dashboard vera e propria è definita più sotto, vedi renderHomeTab)

// Funzione interna per generare un grafico a barre in puro HTML/CSS
function renderSimpleChart(offers) {
    // Trova l'offerta con più views per scalare il grafico
    const maxViews = Math.max(...offers.map(o => o.views || 0), 1);
    
    return offers.map(o => {
        const percentage = ((o.views || 0) / maxViews) * 100;
        return `
            <div style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 5px;">
                    <span>${o.product}</span>
                    <span style="font-weight: bold;">${o.views || 0} views</span>
                </div>
                <div style="height: 12px; background: #f0f4f8; border-radius: 6px; overflow: hidden;">
                    <div style="width: ${percentage}%; height: 100%; background: var(--primary); border-radius: 6px; transition: width 0.5s ease;"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Utility per calcolare i dati (da implementare nel JS)
function calculateTotalViews(offers) {
    return offers.reduce((acc, curr) => acc + (curr.views || 0), 0);
}

function calculateTotalClicks(offers) {
  return offers.reduce((acc, curr) => acc + (curr.clicks || 0), 0);
}

// 4. Rendering dinamico del carrello (Supabase)
async function renderCartContent() {
  const content = $("#modalContent");
  content.innerHTML = `<div style="padding:50px; text-align:center; color:#64748b;">Caricamento lista...</div>`;

  const userId = state.currentUser?.id;
  if (!userId) {
    content.innerHTML = `<div style="padding:50px; color:#64748b;"><h3>Accedi per vedere la tua lista</h3><p>Effettua il login per salvare e ritrovare le offerte che ti interessano.</p></div>`;
    return;
  }

  const { data: items, error } = await supabaseClient
    .from('shopping_list_items')
    .select('offer_id, offers(id, store_id, product, price, img_url, status)')
    .eq('user_id', userId);

  if (error) {
    console.error("Errore caricamento lista spesa:", error);
    content.innerHTML = `<div style="padding:50px; color:#64748b;">Errore nel caricamento della lista.</div>`;
    return;
  }

  // Filtra le offerte non più attive (cestinate/scadute dal negozio)
  const cart = (items || []).map(i => i.offers).filter(o => o && o.status === 'active');

  if (cart.length === 0) {
    content.innerHTML = `<div style="padding:50px; color:#64748b;"><h3>La tua lista è vuota</h3><p>Aggiungi le offerte che ti interessano per trovarle facilmente in negozio.</p></div>`;
    return;
  }

  const storesById = await fetchPublicStoresMap(cart.map(o => o.store_id));

  content.innerHTML = `
    <div class="offers-list-container">
      ${cart.map(o => `
        <div class="offer-row">
          <img src="${getSafeImageUrl(o.img_url)}" style="width:60px; height:60px; object-fit:cover; margin:10px; border-radius:8px;">
          <div class="product-info" style="padding:10px;">
            <div class="product-details">
              <div class="store-name">${storesById[o.store_id]?.name || ""}</div>
              <h3 style="font-size:0.95rem;">${o.product}</h3>
              <div class="price-tag" style="font-size:1rem;">${formatPrice(o.price)}</div>
            </div>
            <button class="btn danger" onclick="removeFromCart('${o.id}')" style="padding:5px 10px; font-size:0.8rem;">Rimuovi</button>
          </div>
        </div>
      `).join('')}
      <button class="btn full-width" onclick="openCartMapView()" style="margin-top:20px; background:#2563eb; color:white; font-weight:600;">📍 Segui nella mappa fino ai negozi</button>
    </div>
  `;
}

async function tryGeocodeQuery(query) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
    headers: { 'Accept-Language': 'it' }
  });
  const data = await res.json();
  return (data && data[0]) ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
}

async function geocodeStoreAddress(store) {
  try {
    // Tentativo 1: indirizzo completo così com'è salvato (già include CAP e città)
    let coords = await tryGeocodeQuery(`${store.address}, Italia`);

    // Tentativo 2 (ripiego): solo città, se l'indirizzo preciso non è nel database di OpenStreetMap
    if (!coords) {
      console.warn(`Indirizzo esatto non trovato per "${store.name}", provo solo con la città.`);
      coords = await tryGeocodeQuery(`${store.city}, Italia`);
    }

    if (coords) {
      await supabaseClient.rpc('cache_store_coordinates', { p_store_id: store.id, p_lat: coords.lat, p_lng: coords.lng });
      return coords;
    }
  } catch (e) {
    console.warn("Geocoding fallito per negozio:", store.id, e);
  }
  return null;
}

async function fetchRouteCoords(fromLat, fromLng, toLat, toLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      const r = data.routes[0];
      return {
        coords: r.geometry.coordinates.map(c => [c[1], c[0]]),
        distanceKm: r.distance / 1000,
        durationMin: r.duration / 60
      };
    }
  } catch (e) {
    console.warn("Routing fallito:", e);
  }
  return null;
}

function formatEta(minutesFromNow) {
  const eta = new Date(Date.now() + minutesFromNow * 60000);
  return eta.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}min`;
}

async function openCartMapView() {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const content = $("#modalContent");
  content.innerHTML = `<div style="padding:50px; text-align:center; color:#64748b;">Preparazione mappa...</div>`;

  const { data: items, error } = await supabaseClient
    .from('shopping_list_items')
    .select('offer_id, offers(id, store_id, product, price, img_url, status)')
    .eq('user_id', userId);

  if (error || !items) {
    content.innerHTML = `<div style="padding:50px; color:#64748b;">Errore nel caricamento della lista.</div>`;
    return;
  }

  const cart = items.map(i => i.offers).filter(o => o && o.status === 'active');
  if (cart.length === 0) {
    content.innerHTML = `<div style="padding:50px; color:#64748b;"><h3>La tua lista è vuota</h3></div>`;
    return;
  }

  const cartItemsByStore = {};
  cart.forEach(o => {
    if (!cartItemsByStore[o.store_id]) cartItemsByStore[o.store_id] = [];
    cartItemsByStore[o.store_id].push({ product: o.product, price: o.price, offerId: o.id });
  });

  const storeIds = Object.keys(cartItemsByStore);
  const storesById = await fetchPublicStoresMap(storeIds);

  let userPos = null;
  try {
    userPos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => reject(err),
        { timeout: 15000, maximumAge: 30000, enableHighAccuracy: true }
      );
    });
  } catch (e) {
    let title = "Posizione non disponibile";
    let msg = "Consenti l'accesso alla posizione dal browser e riprova.";
    if (e.code === 3) {
      title = "Segnale GPS debole";
      msg = "Non siamo riusciti a rilevare la tua posizione in tempo. Riprova, magari all'aperto o vicino a una finestra.";
    } else if (e.code === 2) {
      title = "Posizione non rilevabile";
      msg = "Il dispositivo non riesce a determinare la tua posizione al momento. Riprova tra poco.";
    }
    content.innerHTML = `<div style="padding:50px; text-align:center; color:#64748b;">
      <h3>${title}</h3>
      <p>${msg}</p>
      <button class="btn" onclick="openCartMapView()">Riprova</button>
      <button class="btn outline" onclick="renderCartContent()">Torna alla lista</button>
    </div>`;
    return;
  }

  for (const id of storeIds) {
    const store = storesById[id];
    if (store && (store.latitude == null || store.longitude == null)) {
      const coords = await geocodeStoreAddress(store);
      if (coords) {
        store.latitude = coords.lat;
        store.longitude = coords.lng;
      }
    }
  }

  const allSelectedStores = storeIds.map(id => storesById[id]).filter(Boolean);
  const validStores = allSelectedStores.filter(s => s.latitude != null && s.longitude != null);
  const unlocatableStores = allSelectedStores.filter(s => s.latitude == null || s.longitude == null);

  content.innerHTML = `
    <div style="padding:10px;">
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button class="btn outline" onclick="stopCartMapTracking()">← Torna alla lista</button>
        <button class="btn outline" id="followMeBtn" onclick="toggleFollowMe()" style="margin-left:auto;">🎯 Seguimi</button>
      </div>
      <p style="font-size:0.8rem; color:#94a3b8; margin-bottom:8px;">Tocca un negozio sulla mappa per tracciare subito il percorso.</p>
      ${unlocatableStores.length > 0 ? `
        <div style="background:#fef3c7; border:1px solid #fde68a; border-radius:8px; padding:8px 12px; margin-bottom:10px; font-size:0.8rem; color:#92400e;">
          ⚠️ Non siamo riusciti a individuare l'indirizzo di: ${unlocatableStores.map(s => s.name).join(', ')}. Verifica che l'indirizzo del negozio sia corretto e completo.
        </div>
      ` : ''}
      <div id="cartMapContainer" style="width:100%; height:52vh; border-radius:12px; overflow:hidden;"></div>
      <div id="cartRouteInfoBar" style="display:none; margin-top:10px; padding:12px; background:#161616; color:white; border-radius:10px; text-align:center; font-size:0.95rem;"></div>

      <div style="margin-top:14px; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
        <p style="font-size:0.85rem; color:#475569; margin-bottom:8px;">💡 Facoltativo: quanto ti costa il carburante per ogni chilometro? Ti diciamo se conviene un prezzo più alto ma più vicino.</p>
        <div style="display:flex; gap:8px;">
          <input type="number" id="costPerKmInput" placeholder="Es: 0.15" step="0.01" min="0" style="flex:1; padding:8px; border-radius:8px; border:1px solid #cbd5e1;">
          <button class="btn" onclick="evaluateSmartSavings()">Valuta risparmio</button>
        </div>
        <div id="smartSavingsPanel" style="margin-top:10px;"></div>
      </div>
    </div>
  `;

  setTimeout(() => {
    cartMap = L.map('cartMapContainer').setView([userPos.lat, userPos.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(cartMap);

    const carIcon = L.divIcon({
      html: `<div id="carIconInner" style="font-size:26px; transform-origin:center; transition:transform 0.3s linear;">🚗</div>`,
      className: '', iconSize: [30, 30], iconAnchor: [15, 15]
    });
    cartUserMarker = L.marker([userPos.lat, userPos.lng], { icon: carIcon }).addTo(cartMap).bindPopup("<strong>La tua posizione</strong>");

    const bounds = [[userPos.lat, userPos.lng]];
    cartStoreMarkers = {};
    cartItemsByStoreGlobal = cartItemsByStore;
    cartUserPos = userPos;

    (async () => {
      // Ordina le tappe dalla più vicina alla più lontana, partendo dalla tua posizione
      const visitOrder = computeVisitOrder(userPos.lat, userPos.lng, validStores);
      cartVisitOrder = visitOrder;

      const routePoints = [{ lat: userPos.lat, lng: userPos.lng }, ...visitOrder.map(s => ({ lat: s.latitude, lng: s.longitude }))];
      const multiRoute = await fetchMultiStopRoute(routePoints);

      if (multiRoute) {
        cartMultiRoute = multiRoute;
        L.polyline(multiRoute.coords, { color: '#2563eb', weight: 5, opacity: 0.8 }).addTo(cartMap);
      }

      visitOrder.forEach((store, idx) => {
        const productList = cartItemsByStore[store.id].map(p => `• ${p.product} (${formatPrice(p.price)})`).join('<br>');
        const marker = L.marker([store.latitude, store.longitude], { icon: makeNumberedIcon(idx + 1) }).addTo(cartMap);
        cartStoreMarkers[store.id] = marker;
        bounds.push([store.latitude, store.longitude]);

        const legInfo = multiRoute?.legs?.[idx];
        marker.bindPopup(`
          <strong>Tappa ${idx + 1}: ${store.name}</strong><br>${productList}
          ${legInfo ? `<div style="margin-top:8px; font-size:0.85rem; color:#475569;">📏 ${legInfo.distanceKm.toFixed(1)} km da qui &nbsp;·&nbsp; 🕒 ${formatDuration(legInfo.durationMin)}</div>` : ''}
        `);
      });

      updateTripInfoBar();
      cartMap.fitBounds(bounds, { padding: [40, 40] });
      setTimeout(() => cartMap.invalidateSize(), 100);
    })();

    cartMap.on('dragstart', () => { cartFollowMe = false; updateFollowBtnLabel(); });

    startLiveTracking();
  }, 50);
}

// ============ TRACCIAMENTO POSIZIONE IN TEMPO REALE (stile navigatore) ============
let cartMap = null;
let cartUserMarker = null;
let cartWatchId = null;
let cartFollowMe = true;
let cartLastPos = null;
let cartStoreMarkers = {};
let cartLastRouteRecalc = 0;
let cartItemsByStoreGlobal = {};
let cartUserPos = null;
let cartVisitOrder = [];
let cartMultiRoute = null;

function computeVisitOrder(startLat, startLng, stores) {
  const remaining = [...stores];
  const ordered = [];
  let curLat = startLat, curLng = startLng;
  while (remaining.length) {
    let nearestIdx = 0, nearestDist = Infinity;
    remaining.forEach((s, i) => {
      const d = Math.hypot(s.latitude - curLat, s.longitude - curLng);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });
    const next = remaining.splice(nearestIdx, 1)[0];
    ordered.push(next);
    curLat = next.latitude; curLng = next.longitude;
  }
  return ordered;
}

async function fetchMultiStopRoute(points) {
  try {
    const coordsStr = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      const r = data.routes[0];
      return {
        coords: r.geometry.coordinates.map(c => [c[1], c[0]]),
        totalDistanceKm: r.distance / 1000,
        totalDurationMin: r.duration / 60,
        legs: r.legs.map(l => ({ distanceKm: l.distance / 1000, durationMin: l.duration / 60 }))
      };
    }
  } catch (e) {
    console.warn("Routing multi-tappa fallito:", e);
  }
  return null;
}

function makeNumberedIcon(number) {
  return L.divIcon({
    html: `<div style="width:28px; height:28px; border-radius:50%; background:#2563eb; color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; box-shadow:0 2px 6px rgba(0,0,0,0.35);">${number}</div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

function updateTripInfoBar() {
  const bar = document.getElementById('cartRouteInfoBar');
  if (!bar || !cartMultiRoute || !cartVisitOrder.length) return;
  bar.style.display = 'block';
  const stopsList = cartVisitOrder.map((s, i) => `${i + 1}. ${s.name}`).join(' → ');
  bar.innerHTML = `
    <div style="font-size:0.8rem; color:#cbd5e1; margin-bottom:4px;">${stopsList}</div>
    <strong>Percorso completo</strong>: 📏 ${cartMultiRoute.totalDistanceKm.toFixed(1)} km &nbsp;·&nbsp;
    🕒 ${formatDuration(cartMultiRoute.totalDurationMin)} &nbsp;·&nbsp;
    Arrivo all'ultima tappa: ${formatEta(cartMultiRoute.totalDurationMin)}
  `;
}

async function recalculateTrip(currentLat, currentLng) {
  if (!cartVisitOrder.length) return;
  const routePoints = [{ lat: currentLat, lng: currentLng }, ...cartVisitOrder.map(s => ({ lat: s.latitude, lng: s.longitude }))];
  const multiRoute = await fetchMultiStopRoute(routePoints);
  if (multiRoute) {
    cartMultiRoute = multiRoute;
    updateTripInfoBar();
  }
}

async function evaluateSmartSavings() {
  const panel = document.getElementById('smartSavingsPanel');
  const costPerKm = parseFloat(document.getElementById('costPerKmInput')?.value);

  if (!costPerKm || costPerKm <= 0) {
    panel.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">Inserisci un costo per km valido (es: 0.15).</p>`;
    return;
  }
  if (!cartUserPos) {
    panel.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">Posizione non disponibile, riprova tra poco.</p>`;
    return;
  }

  panel.innerHTML = `<p style="color:#64748b; font-size:0.85rem;">Confronto in corso...</p>`;

  // Prendiamo tutte le offerte attive per cercare lo stesso prodotto in altri negozi
  const { data: allActiveOffers, error } = await supabaseClient
    .from('offers')
    .select('id, product, price, store_id')
    .eq('status', 'active');

  if (error || !allActiveOffers) {
    panel.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">Errore nel confronto. Riprova.</p>`;
    return;
  }

  const storesInItineraryIds = new Set(Object.keys(cartStoreRoutes));
  const results = [];

  for (const [storeId, items] of Object.entries(cartItemsByStoreGlobal)) {
    for (const item of items) {
      const alternatives = allActiveOffers.filter(o =>
        o.store_id !== storeId &&
        o.product.trim().toLowerCase() === item.product.trim().toLowerCase()
      );
      if (alternatives.length === 0) continue;

      // Il negozio attuale lo stai già visitando per altri prodotti: nessun costo di viaggio aggiuntivo
      const currentTotalCost = item.price;

      let best = null;
      for (const alt of alternatives) {
        let extraTravelCost = 0;
        let extraKm = 0;

        if (!storesInItineraryIds.has(alt.store_id)) {
          // Negozio NON già nel percorso: serve un viaggio a parte (andata e ritorno)
          let altStore = (await fetchPublicStoresMap([alt.store_id]))[alt.store_id];
          if (altStore && (altStore.latitude == null || altStore.longitude == null)) {
            const coords = await geocodeStoreAddress(altStore);
            if (coords) { altStore.latitude = coords.lat; altStore.longitude = coords.lng; }
          }
          if (altStore?.latitude != null) {
            const route = await fetchRouteCoords(cartUserPos.lat, cartUserPos.lng, altStore.latitude, altStore.longitude);
            if (route) {
              extraKm = route.distanceKm * 2; // andata e ritorno
              extraTravelCost = extraKm * costPerKm;
            }
          }
        }
        // Se il negozio alternativo è GIÀ nel percorso, costo di viaggio extra = 0

        const altTotalCost = alt.price + extraTravelCost;
        if (!best || altTotalCost < best.altTotalCost) {
          best = { ...alt, altTotalCost, extraKm, extraTravelCost, alreadyInRoute: storesInItineraryIds.has(alt.store_id) };
        }
      }

      if (best && best.altTotalCost < currentTotalCost - 0.01) {
        results.push({
          product: item.product,
          currentPrice: currentTotalCost,
          betterOption: best,
          savings: currentTotalCost - best.altTotalCost
        });
      } else if (best) {
        results.push({
          product: item.product,
          currentPrice: currentTotalCost,
          worseOption: best,
          extraCostIfSwitch: best.altTotalCost - currentTotalCost
        });
      }
    }
  }

  if (results.length === 0) {
    panel.innerHTML = `<p style="color:#16a34a; font-size:0.85rem;">✅ Stai già facendo le scelte migliori: nessun'altra combinazione conviene di più.</p>`;
    return;
  }

  let totalSavings = 0;
  const cards = results.map(r => {
    if (r.betterOption) {
      totalSavings += r.savings;
      const travelNote = r.betterOption.alreadyInRoute
        ? "già nel tuo percorso, nessun costo extra"
        : `+${r.betterOption.extraKm.toFixed(1)} km extra (~${formatPrice(r.betterOption.extraTravelCost)})`;
      return `
        <div style="padding:8px; border-left:3px solid #16a34a; background:#f0fdf4; margin-bottom:6px; border-radius:6px; font-size:0.85rem;">
          <strong>${r.product}</strong>: conviene cambiare — risparmi ${formatPrice(r.savings)}<br>
          <span style="color:#64748b;">Qui: ${formatPrice(r.currentPrice)} · Altrove: ${formatPrice(r.betterOption.price)} (${travelNote})</span>
        </div>`;
    } else {
      return `
        <div style="padding:8px; border-left:3px solid #2563eb; background:#eff6ff; margin-bottom:6px; border-radius:6px; font-size:0.85rem;">
          <strong>${r.product}</strong>: conviene restare qui — l'alternativa ti costerebbe ${formatPrice(r.extraCostIfSwitch)} in più tra prezzo e viaggio
        </div>`;
    }
  }).join('');

  panel.innerHTML = `
    ${cards}
    ${totalSavings > 0 ? `<p style="font-weight:600; margin-top:8px;">💰 Risparmio totale possibile: ${formatPrice(totalSavings)}</p>` : ''}
    <p style="font-size:0.75rem; color:#94a3b8; margin-top:6px;">Assumiamo che tu visiti comunque i negozi già presenti nel tuo percorso attuale.</p>
  `;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function startLiveTracking() {
  if (!navigator.geolocation) return;
  cartWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const newLat = pos.coords.latitude;
      const newLng = pos.coords.longitude;

      let heading = pos.coords.heading;
      if ((heading === null || isNaN(heading)) && cartLastPos) {
        heading = calculateBearing(cartLastPos.lat, cartLastPos.lng, newLat, newLng);
      }
      cartLastPos = { lat: newLat, lng: newLng };

      if (cartUserMarker) {
        cartUserMarker.setLatLng([newLat, newLng]);
        const iconEl = document.getElementById('carIconInner');
        if (iconEl && heading !== null && !isNaN(heading)) {
          iconEl.style.transform = `rotate(${heading}deg)`;
        }
      }
      if (cartMap && cartFollowMe) cartMap.panTo([newLat, newLng]);

      const now = Date.now();
      if (cartVisitOrder.length && now - cartLastRouteRecalc > 20000) {
        cartLastRouteRecalc = now;
        recalculateTrip(newLat, newLng);
      }
    },
    (err) => console.warn("Errore tracciamento posizione:", err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function toggleFollowMe() {
  cartFollowMe = !cartFollowMe;
  updateFollowBtnLabel();
  if (cartFollowMe && cartUserMarker && cartMap) cartMap.panTo(cartUserMarker.getLatLng());
}

function updateFollowBtnLabel() {
  const btn = document.getElementById('followMeBtn');
  if (btn) btn.innerText = cartFollowMe ? "🎯 Seguimi (attivo)" : "🎯 Seguimi";
}

function stopCartMapTracking() {
  if (cartWatchId !== null) {
    navigator.geolocation.clearWatch(cartWatchId);
    cartWatchId = null;
  }
  cartMap = null;
  cartUserMarker = null;
  cartLastPos = null;
  cartStoreMarkers = {};
  cartLastRouteRecalc = 0;
  cartItemsByStoreGlobal = {};
  cartUserPos = null;
  cartVisitOrder = [];
  cartMultiRoute = null;
  renderCartContent();
}

window.removeFromCart = async (id) => {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const { error } = await supabaseClient
    .from('shopping_list_items')
    .delete()
    .eq('user_id', userId)
    .eq('offer_id', id);

  if (error) {
    console.error("Errore rimozione dalla lista:", error);
    return toast.error("Errore durante la rimozione.");
  }

  await refreshCartBadge();
  renderCartContent();
};

// ---------- Gestione Popup e Drawer ----------
// --- FUNZIONI DI SUPPORTO MODAL (PORTATE ALL'ESTERNO) ---

function renderLoginForm() {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Accesso Utente";
  content.innerHTML = `
    <div class="auth-container">
      <h3>Bentornato su Decerne</h3>
      <div id="loginError" class="error-msg hidden"></div>
      <form id="loginForm" class="auth-form">
        <input type="email" id="loginEmail" placeholder="Email" required>
        <input type="password" id="loginPass" placeholder="Password" required>
        <button type="submit" class="btn">Accedi</button>
      </form>
      <p style="text-align:center; margin-top:10px;">
        <a href="javascript:void(0)" onclick="renderForgotPasswordForm()" style="font-size:0.85rem; color:#64748b;">Password dimenticata?</a>
      </p>
      <p class="auth-switch">Non sei registrato? <a href="javascript:void(0)" onclick="showRegisterForm()">Registrati</a></p>
    </div>
  `;
  
  $("#loginForm").onsubmit = (e) => {
    e.preventDefault();
    showLoading(); // ATTIVA SPINNER

    const email = $("#loginEmail").value;
    const pass = $("#loginPass").value;

    setTimeout(async () => {
      const result = await loginUser(email, pass);
      if (result.success) {
        renderProfileInfo();
      } else if (result.needsVerification) {
        pendingVerification = { type: 'customer' };
        renderOtpVerificationScreen(email.trim().toLowerCase());
      } else {
        const err = $("#loginError");
        err.innerText = result.msg;
        err.classList.remove("hidden");
      }
      hideLoading();
    }, 300);
  };
}

function renderForgotPasswordForm() {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Recupera password";
  content.innerHTML = `
    <div class="auth-container">
      <h3>Recupera la tua password</h3>
      <p style="color:#64748b; margin-bottom:15px; font-size:0.9rem;">Inserisci l'email con cui ti sei registrato: ti invieremo un link per reimpostarla.</p>
      <div id="forgotError" class="error-msg hidden"></div>
      <form id="forgotForm" class="auth-form">
        <input type="email" id="forgotEmail" placeholder="Email" required>
        <button type="submit" class="btn">Invia link di recupero</button>
      </form>
      <p class="auth-switch"><a href="javascript:void(0)" onclick="renderLoginForm()">Torna al login</a></p>
    </div>
  `;

  $("#forgotForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#forgotEmail").value.trim().toLowerCase();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}?reset=1`
    });
    if (error) {
      const err = $("#forgotError");
      err.innerText = "Errore nell'invio. Controlla l'email e riprova.";
      err.classList.remove("hidden");
      return;
    }
    toast.success("Se l'email è registrata, riceverai un link per reimpostare la password.");
    renderLoginForm();
  };
}

function renderResetPasswordForm() {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Imposta nuova password";
  content.innerHTML = `
    <div class="auth-container">
      <h3>Imposta la nuova password</h3>
      <div id="resetError" class="error-msg hidden"></div>
      <form id="resetForm" class="auth-form">
        <input type="password" id="resetPass" placeholder="Nuova password (min. 8)" required>
        <input type="password" id="resetPassConfirm" placeholder="Conferma nuova password" required>
        <button type="submit" class="btn">Salva nuova password</button>
      </form>
    </div>
  `;

  $("#resetForm").onsubmit = async (e) => {
    e.preventDefault();
    const pass = $("#resetPass").value;
    const confirm = $("#resetPassConfirm").value;
    const err = $("#resetError");
    if (pass.length < 8) {
      err.innerText = "La password deve essere di almeno 8 caratteri.";
      err.classList.remove("hidden");
      return;
    }
    if (pass !== confirm) {
      err.innerText = "Le password non coincidono.";
      err.classList.remove("hidden");
      return;
    }
    const { error } = await supabaseClient.auth.updateUser({ password: pass });
    if (error) {
      if (error.message?.toLowerCase().includes("different from the old password")) {
        err.innerText = "La nuova password deve essere diversa da quella attuale. Scegline una diversa.";
      } else {
        err.innerText = "Errore durante il salvataggio. Il link potrebbe essere scaduto: richiedine uno nuovo.";
      }
      err.classList.remove("hidden");
      return;
    }
    toast.success("Password aggiornata! Effettua il login.");
    history.replaceState(null, "", window.location.pathname); // pulisce ?reset=1 dall'URL
    renderLoginForm();
  };
}

function showRegisterForm() {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Crea un account";
  content.innerHTML = `
    <div class="auth-container">
      <div id="authError" class="error-msg hidden"></div>
      <form id="registerForm" class="auth-form">
        <div class="form-row">
          <input type="text" id="regNome" placeholder="Nome" required>
          <input type="text" id="regCognome" placeholder="Cognome" required>
        </div>
        <input type="email" id="regEmail" placeholder="Email" required>
        <input type="password" id="regPass" placeholder="Password (min. 8)" required>
        <input type="password" id="regPassConfirm" placeholder="Conferma Password" required>
        <div class="form-row">
          <input type="text" id="regCap" placeholder="CAP" maxlength="5" required>
          <input type="text" id="regCitta" placeholder="Città" required>
        </div>
        <button type="submit" class="btn">Registrati</button>
      </form>
      <p class="auth-switch">Hai già un account? <a href="javascript:void(0)" onclick="renderLoginForm()">Accedi</a></p>
    </div>
  `;

  $("#registerForm").onsubmit = (e) => {
    e.preventDefault();
    validateRegistration();
  };
}

function renderProfileInfo() {
  const user = state.currentUser;
  if (!user) return renderLoginForm();
  
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Il Tuo Profilo";
  content.innerHTML = `
    <div class="auth-container">
      <div class="profile-avatar">${user.nome[0]}${user.cognome[0]}</div>
      <form id="profileUpdateForm" class="auth-form">
        <div class="form-row">
          <div class="input-group"><label>Nome</label><input type="text" id="upNome" value="${user.nome}" required></div>
          <div class="input-group"><label>Cognome</label><input type="text" id="upCognome" value="${user.cognome}" required></div>
        </div>
        <div class="input-group"><label>Email</label><input type="email" value="${user.email}" disabled style="background:#f0f0f0"></div>
        <div class="form-row">
          <div class="input-group"><label>Città</label><input type="text" id="upCitta" value="${user.citta}" required></div>
          <div class="input-group"><label>CAP</label><input type="text" id="upCap" value="${user.cap}" maxlength="5" required></div>
        </div>
        <button type="submit" class="btn">Salva Modifiche</button>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button type="button" class="btn outline" onclick="logoutUser()" style="flex: 1;">Esci dall'account</button>
        <button type="button" class="btn danger" onclick="deleteAccount()" style="flex: 1;">Elimina Account</button>
        </div>
      </form>
    </div>
  `;
  
  $("#profileUpdateForm").onsubmit = async (e) => {
    e.preventDefault();
    const updated = { 
      nome: $("#upNome").value, 
      cognome: $("#upCognome").value, 
      citta: $("#upCitta").value, 
      cap: $("#upCap").value 
    };
    if (await updateProfile(updated)) {
      toast.success("Profilo aggiornato!");
      setTimeout(closeFullPageModal, 1000);
    }
  };
}

function renderSearchModal() {
  const title = $("#modalTitle");
  const content = $("#modalContent");
  title.innerText = "Cerca un'offerta";
  content.innerHTML = `
    <div class="modal-search-container">
      <input type="text" id="modalSearchInput" placeholder="Cosa stai cercando? (es: Mele, Pasta...)" autofocus>
      <div id="searchStatus" class="search-status-hint"></div>
      <div id="modalResults" class="offers-list-container" style="margin-top: 20px; text-align: left;"></div>
    </div>
  `;

  const input = $("#modalSearchInput");
  const resultsDiv = $("#modalResults");
  
  // Debounce per non sovraccaricare il browser mentre si scrive
  const performModalSearch = debounce(async () => {
    const query = input.value.toLowerCase().trim();
    if (query.length < 2) {
      resultsDiv.innerHTML = "";
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const userCity = getCleanUserCity();

    const { data: rows, error } = await supabaseClient
      .from('offers')
      .select('*')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today);

    if (error) {
      console.error("Errore ricerca:", error);
      return;
    }

    const storesById = await fetchPublicStoresMap((rows || []).map(r => r.store_id));

    const allOffers = (rows || []).map(r => {
      const store = storesById[r.store_id] || {};
      return {
        id: r.id,
        product: r.product,
        price: r.price,
        img: r.img_url,
        storeName: store.name || "",
        storeCity: store.city ? store.city.toLowerCase() : ""
      };
    });

    const filtered = allOffers.filter(o => {
      const matchesQuery = o.product.toLowerCase().includes(query) || o.storeName.toLowerCase().includes(query);
      const matchesLoc = !userCity || (o.storeCity === userCity);
      return matchesQuery && matchesLoc;
    });

    if (filtered.length === 0) {
      resultsDiv.innerHTML = `<p style="text-align:center; padding:20px; color:#64748b;">Nessun risultato trovato per "${query}"${userCity ? ' nella tua zona' : ''}.</p>`;
    } else {
      resultsDiv.innerHTML = filtered.map(o => `
        <div class="offer-row modal-row" onclick="closeFullPageModal(); openProductDetail('${o.id}')">
          <div class="product-image-container" style="width:70px; height:70px; min-width:70px;">
            <img src="${getSafeImageUrl(o.img)}" class="product-img">
          </div>
          <div class="product-info">
            <div class="product-details">
              <div class="store-name">${o.storeName}</div>
              <h3 style="font-size:1rem;">${o.product}</h3>
              <div class="price-tag" style="font-size:1rem;">${formatPrice(o.price)}</div>
            </div>
          </div>
        </div>
      `).join('');
    }
  }, 300);

  input.oninput = performModalSearch;
}

// NUOVA FUNZIONE openFullPageModal SEMPLIFICATA
function openFullPageModal(type) {
  const modal = $("#fullPagePopup");
  if(!modal) return;
  
  modal.style.display = "flex";
  document.body.style.overflow = 'hidden';

  if (type === 'profile') {
    if (state.currentUser) renderProfileInfo();
    else renderLoginForm();
  } else if (type === 'search') {
    renderSearchModal(); // La sistemeremo nel prossimo punto
  } else if (type === 'cart') {
    renderCartContent();
  }
}

async function validateRegistration() {
  const email = document.getElementById("regEmail").value.trim();
  const pass = document.getElementById("regPass").value;
  const passConf = document.getElementById("regPassConfirm").value;
  const nome = document.getElementById("regNome").value.trim();

  // Validazioni base
  if (!VALIDATION_RULES.email.test(email)) return toast.error("Inserisci un'email valida.");
  if (pass.length < VALIDATION_RULES.minPassword) return toast.error("La password deve essere di almeno 8 caratteri.");
  if (pass !== passConf) return toast.error("Le password non coincidono.");

  const newUser = {
    nome: nome,
    cognome: document.getElementById("regCognome").value.trim(),
    email: email.toLowerCase(),
    pass: pass,
    cap: document.getElementById("regCap").value.trim(),
    citta: document.getElementById("regCitta").value.trim()
  };

  const result = await registerUser(newUser);

  if (result.success) {
    pendingVerification = { type: 'customer' };
    renderOtpVerificationScreen(newUser.email.trim().toLowerCase());
  } else {
    toast.error(result.msg);
  }
}

function closeFullPageModal() {
  try {
    $("#fullPagePopup").style.display = "none";
    // RIPRISTINA SCORRIMENTO
    document.body.style.overflow = '';
  } catch (e) { console.error(e); }
}

function openDrawer() {
  try {
    $("#drawer").style.right = "0";
    $("#overlay").style.display = "block";
    $("#menuBtn").classList.add("open");
    // BLOCCA SCORRIMENTO
    document.body.style.overflow = 'hidden';
  } catch (e) { console.error(e); }
}

function closeDrawer() {
  try {
    $("#drawer").style.right = "-320px";
    $("#overlay").style.display = "none";
    $("#menuBtn").classList.remove("open");
    // RIPRISTINA SCORRIMENTO
    document.body.style.overflow = '';
  } catch (e) { console.error(e); }
}

// UNICA funzione per gestire il tasto Hamburger/X
function toggleMenu() {
  const isOpen = $("#menuBtn").classList.contains("open");
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

// Nel tuo init() o a fine file, imposta i listener così:
function setupEventListeners() {
  // GESTIONE LOGIN AMMINISTRATORE
 // Gestione Login Admin corretta
 const adminLoginBtn = $("#adminLoginBtn");
 if (adminLoginBtn) {
   adminLoginBtn.onclick = async () => {
     const emailField = $("#adminEmail");
     const passField = $("#adminPassword");
     if (!emailField || !passField) return;
 
     const email = emailField.value.trim().toLowerCase();
     const pass = passField.value;
 
     const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
 
     if (error || !data.user) {
       return toast.error("Credenziali amministratore errate.");
     }
 
     const { data: adminRow } = await supabaseClient
       .from('admins')
       .select('auth_user_id')
       .eq('auth_user_id', data.user.id)
       .maybeSingle();
 
     if (!adminRow) {
       await supabaseClient.auth.signOut();
       return toast.error("Questo account non ha i permessi di amministratore.");
     }
 
     state.currentUser = {
       id: data.user.id,
       email: data.user.email,
       nome: 'Admin',
       cognome: '',
       role: 'admin'
     };
 
     $("#admin-login").classList.add("hidden");
     $("#admin-panel").classList.remove("hidden");
     updateDrawerUI();
     toast.success("Modalità Amministratore Attiva");
   };
 }

  // Menu Hamburger
  const menuBtn = $("#menuBtn");
  if (menuBtn) {
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menuBtn.classList.contains("open");
      isOpen ? closeDrawer() : openDrawer();
    };
  }

  // Overlay e chiusure
  if($("#overlay")) $("#overlay").onclick = closeDrawer;
  if($("#closeModal")) $("#closeModal").onclick = closeFullPageModal;
  
  // Icone Navbar
  if($("#searchBtn")) $("#searchBtn").onclick = () => openFullPageModal('search');
  if($("#profileBtn")) $("#profileBtn").onclick = () => openFullPageModal('profile');
  if($("#cartBtn")) $("#cartBtn").onclick = () => openFullPageModal('cart');
  
  // Voce Anteprima nel form offerta
  const prevBtn = $("#previewBtn");
  if(prevBtn) prevBtn.onclick = showOfferPreview;

  const allowBtn = $("#allowLoc");
const denyBtn = $("#denyLoc");

if (allowBtn) {
  allowBtn.onclick = () => {
    localStorage.setItem("decerne_loc_consent", "allowed");
    $("#locationBanner").classList.add("hidden");
    getGeoLocation();
  };
}

if (denyBtn) {
  denyBtn.onclick = () => {
    localStorage.setItem("decerne_loc_consent", "denied");
    $("#locationBanner").classList.add("hidden");
    $("#locationInput").value = "Posizione non impostata";
    renderOffers(); // Ricarica per mostrare tutto
  };
}

const adminLogoutBtn = $("#adminLogoutBtn");
if (adminLogoutBtn) {
  adminLogoutBtn.onclick = () => {
    try {
      logoutUser(); // Riutilizza la funzione esistente che pulisce localStorage
      $("#admin-panel").classList.add("hidden");
      $("#admin-login").classList.remove("hidden");
      setMode('user'); // Riporta l'admin alla home utenti
    } catch (e) {
      console.error(e);
    }
  };
}

// Anteprima dinamica immagine nel modulo offerta
const offImgInput = $("#offImg");
if (offImgInput) {
  offImgInput.oninput = () => {
    const url = offImgInput.value.trim();
    const hint = $("#imgHint");
    if (url.startsWith('http')) {
      hint.innerHTML = `<img src="${url}" style="width:50px; height:50px; object-fit:cover; border-radius:4px; margin-top:5px; border:1px solid #ddd;">`;
    } else {
      hint.innerText = "Inserisci un URL valido (es. https://...)";
    }
  };
}

}

// Lancio unico all'avvio
document.addEventListener("DOMContentLoaded", init);


async function updateLocation() {
  const locInput = $("#locationInput");
  
  if (!navigator.geolocation) {
    locInput.value = "Geolocalizzazione non supportata";
    return;
  }

  locInput.value = TEXT.location.detecting;

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;

    try {
      // Utilizziamo il servizio gratuito Nominatim per il Reverse Geocoding
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`);
      const data = await response.json();
      
      const addr = data.address;
      const street = addr.road || "";
      const cap = addr.postcode || "";
      const city = addr.city || addr.town || addr.village || "";
      
      // Formattiamo la stringa: Via, CAP Città
      locInput.value = `${street}${street ? ',' : ''} ${cap} ${city}`.trim();
    } catch (error) {
      locInput.value = "Errore nel recupero indirizzo";
    }
  }, () => {
    locInput.value = "Accesso posizione negato";
  });
}

async function syncShoppingList() {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const { data: items, error } = await supabaseClient
    .from('shopping_list_items')
    .select('offer_id, offers(status)')
    .eq('user_id', userId);

  if (error) {
    console.error("Errore sincronizzazione lista spesa:", error);
    return;
  }

  const staleIds = (items || [])
    .filter(i => !i.offers || i.offers.status !== 'active')
    .map(i => i.offer_id);

  if (staleIds.length > 0) {
    await supabaseClient
      .from('shopping_list_items')
      .delete()
      .eq('user_id', userId)
      .in('offer_id', staleIds);

    if (DEV_MODE) console.log("System: Lista spesa ripulita da prodotti non più disponibili.");
  }

  await refreshCartBadge();
}

// Funzione per generare l'Anteprima
const originalShowOfferPreview = window.showOfferPreview;
window.showOfferPreview = () => {
  try {
    
  // Imposta desktop come default ogni volta che si apre
  setPreviewDevice('desktop');
  
  // Chiama la funzione originale che popola i dati
  const container = $("#previewCardContainer");
  const partner = getCurrentPartner();
  
  const nome = $("#offNome").value || "Nome Prodotto";
  const prezzoSconto = parseFloat($("#offPrezzoSconto").value) || 0;
  const prezzoOrig = parseFloat($("#offPrezzoOrig").value) || 0;
  const imgUrl = $("#offImg").value || "";
  
  const percSconto = prezzoOrig > prezzoSconto ? Math.round(((prezzoOrig - prezzoSconto) / prezzoOrig) * 100) : 0;
  const imageSrc = (imgUrl && imgUrl.startsWith('http')) ? imgUrl : PLACEHOLDER_IMG;
  

  // Iniezione HTML Card
  container.innerHTML = `
    <div class="offer-row" style="width: 100%; max-width: 600px;">
      <div class="product-image-container">
        <img src="${imageSrc}" class="product-img">
        ${percSconto > 0 ? `<span class="perc-badge">-${percSconto}%</span>` : ''}
      </div>
      <div class="product-info">
        <div class="product-details">
          <div class="store-name">${partner ? partner.name : 'Supermercato'}</div>
          <h3>${nome}</h3>
          <div class="price-container">
            <span class="price-tag">${formatPrice(prezzoSconto)}</span>
            ${prezzoOrig > prezzoSconto ? `<span class="old-price-small">${formatPrice(prezzoOrig)}</span>` : ''}
          </div>
        </div>
        <div class="product-actions">
          <button class="btn" style="pointer-events: none;">Aggiungi</button>
        </div>
      </div>
    </div>
  `;

  $("#previewOverlay").classList.remove("hidden");
  document.body.style.overflow = 'hidden';
  } catch (e) { console.error(e); }
};

window.closePreview = () => {
  try {
    $("#previewOverlay").classList.add("hidden");
    // RIPRISTINA SCORRIMENTO
    document.body.style.overflow = '';
  } catch (e) { console.error(e); }
};

// Listener per il pulsante anteprima (da mettere dentro setupEventListeners)
const originalSetup = setupEventListeners;
setupEventListeners = function() {
  originalSetup();
  const prevBtn = $("#previewBtn");
  if(prevBtn) prevBtn.onclick = showOfferPreview;
};

// Rinfresca i dati del negozio da Supabase ad ogni caricamento pagina,
// invece di usare solo quello che era stato salvato al login (poteva diventare
// vecchio: piano, abbonamento, indirizzo, ecc. cambiati altrove non si vedevano).
async function refreshPartnerSession(storeId) {
  const { data: storeRow, error } = await supabaseClient
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();

  if (error || !storeRow) {
    console.error("Errore aggiornamento sessione negozio:", error);
    return null;
  }

  const { data: locationsRows } = await supabaseClient
    .from('store_locations')
    .select('*')
    .eq('store_id', storeRow.id);

  const freshStore = {
    id: storeRow.id,
    email: storeRow.email,
    name: storeRow.name,
    address: storeRow.address,
    city: storeRow.city,
    cap: storeRow.cap,
    logo: storeRow.logo_url || "",
    phone: storeRow.phone || "",
    hours: storeRow.hours || "",
    internalNotes: storeRow.internal_notes || "",
    apiKey: storeRow.api_key || "",
    locations: (locationsRows || []).map(l => ({ id: l.id, name: l.name, address: l.address })),
    plan: storeRow.plan,
    subscription: {
      plan: storeRow.plan,
      status: storeRow.subscription_status,
      startedAt: storeRow.trial_started_at,
      daysLeft: storeRow.trial_started_at
        ? Math.max(0, 30 - Math.floor((Date.now() - Date.parse(storeRow.trial_started_at)) / (24*60*60*1000)))
        : 30
    }
  };

  const sessionData = JSON.stringify(freshStore);
  sessionStorage.setItem(SESSION_PARTNER, sessionData);
  if (localStorage.getItem(PARTNER_AUTH_KEY)) {
    localStorage.setItem(PARTNER_AUTH_KEY, sessionData);
  }

  return freshStore;
}

// ---------- Init ----------
async function init() {
  try {
  console.log("Sistema Decerne in fase di avvio...");

  setupEventListeners();

 // Se l'utente arriva dal link email di recupero password, mostra il form dedicato
 const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1') {
    // Leggiamo NOI i token dal frammento URL (#access_token=...&refresh_token=...),
    // invece di fidarci del rilevamento automatico: evita che venga usata per sbaglio
    // una sessione diversa già presente nel browser.
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const linkType = hashParams.get('type');

    if (accessToken && refreshToken && linkType === 'recovery') {
      const { error: sessionError } = await supabaseClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (sessionError) {
        toast.error("Il link di recupero non è valido o è scaduto. Richiedine uno nuovo.");
      } else {
        if (urlParams.get('role') === 'store') {
          setMode('store');
          storeData.step = 'login';
          renderStoreView();
          renderResetPasswordForm();
        } else {
          openFullPageModal('profile');
          renderResetPasswordForm();
        }
      }
    } else {
      toast.error("Link di recupero non valido. Richiedine uno nuovo.");
    }
  }

  await restoreUserSession();
  const tempPartner = sessionStorage.getItem(SESSION_PARTNER);
  const permPartner = localStorage.getItem(PARTNER_AUTH_KEY);
  const cachedPartner = tempPartner || permPartner;

  if (cachedPartner) {
    // La cache serve solo per sapere QUALE negozio era loggato (l'id);
    // tutto il resto viene subito sovrascritto con i dati reali e attuali.
    const cachedId = JSON.parse(cachedPartner).id;
    const freshStore = await refreshPartnerSession(cachedId);
    if (freshStore) {
      state.currentStore = freshStore;
    } else {
      // Sessione non più valida: pulisci la cache invece di riprovare ad ogni caricamento
      sessionStorage.removeItem(SESSION_PARTNER);
      localStorage.removeItem(PARTNER_AUTH_KEY);
      state.currentStore = null;
    }
  }

  if (state.currentStore) refreshMyOffers(); // Carica le offerte vere appena la sessione è pronta

  // 3. Pulizia e Sincronizzazione Database
  syncShoppingList();

  // 4. Configura Navigazione Modalità (Navbar click)
  if($("#navModeUser")) $("#navModeUser").onclick = () => setMode("user");
  if($("#navModeStore")) $("#navModeStore").onclick = () => setMode("store");
  if($("#navModeAdmin")) $("#navModeAdmin").onclick = () => setMode("admin");

  // 5. Configura Ricerca e Filtri della Homepage
  const searchInput = document.getElementById("searchInput");
  const categorySelect = $("#categorySelect");


  if (searchInput) {
    // Avvolgiamo la funzione di rendering nel debounce
    const debouncedRender = debounce(() => {
      state.currentPage = 1; // Resetta la paginazione quando cerchi
      renderOffers();
    }, 300);
  
    searchInput.oninput = debouncedRender;
  }
  
  if (categorySelect) {
    categorySelect.onchange = () => {
      state.currentPage = 1;
      renderOffers();
    };
  }

  // 6. Aggiorna UI in base al login
  updateDrawerUI();
  
  if (state.currentUser) {
    updateLocationUI(`${state.currentUser.cap || ''} ${state.currentUser.citta || ''}`.trim());
  }

  // 7. Avvio Finale delle Viste
  if (state.currentStore) {
    storeData.step = 'dashboard';
    getMyOffers();
  }
  
 // Listener per il caricamento infinito/paginazione
 const loadMoreBtn = $("#loadMoreBtn");
 if (loadMoreBtn) {
  loadMoreBtn.onclick = () => {
    state.currentPage++;
    renderOffers();
  };
 }

  checkLocationPermission();
  checkSubscriptionsExpiry();
  setMode(state.mode); // Forza il rendering della vista corretta
  renderOffers();
  
  console.log("Sistema Decerne Pronto.");
 }catch (e) {
  console.error("Errore critico durante l'inizializzazione:", e);
 }
}

function applyStaticTexts() {
  try {
    if ($("#loadMoreBtn")) $("#loadMoreBtn").innerText = TEXT.offers.loadMore;
    if ($("#locationInput")) $("#locationInput").placeholder = TEXT.location.placeholder;
    if ($("#emptyMsg")) $("#emptyMsg").innerText = TEXT.offers.empty;
  } catch (e) { console.error(e); }
}

// Funzione per ottenere l'indirizzo reale e aggiornare l'input
async function fetchAddress(lat, lon) {
  const locInput = $("#locationInput");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); 

    // AGGIUNTO: User-Agent è obbligatorio per Nominatim
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, { 
      signal: controller.signal,
      headers: { 'User-Agent': 'DecerneApp/1.0' } 
    });
    
    if (!response.ok) throw new Error("Errore risposta server");
    
    const data = await response.json();
    clearTimeout(timeoutId);

    if (data.address) {
      const a = data.address;
      const city = a.city || a.town || a.village || a.suburb || "";
      const cap = a.postcode || "";
      const finalAddr = `${cap} ${city}`.trim();
      locInput.value = finalAddr || "Posizione rilevata";
      if (DEV_MODE) console.log("Posizione aggiornata:", finalAddr);
      state.currentPage = 1; 
      renderOffers();
    } else {
      locInput.value = "Posizione non riconosciuta";
      toast.error("Non siamo riusciti a riconoscere il tuo indirizzo. Inseriscilo manualmente.");
    }
  } catch (e) {
    console.warn("Errore localizzazione:", e);
    locInput.value = "Posizione non disponibile";
    toast.error("Errore nel rilevamento della posizione. Riprova o inserisci la città manualmente.");
  }
}

// Funzione principale di geolocalizzazione
function getGeoLocation() {
  if (!navigator.geolocation) return;
  
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      fetchAddress(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => { console.warn("Accesso negato dal browser"); }
  );
}

// Gestione del Banner Consenso
function checkLocationPermission() {
  const consent = localStorage.getItem("decerne_loc_consent");
  
  // Se non c'è una risposta salvata, mostra il banner
  if (!consent) {
    $("#locationBanner").classList.remove("hidden");
  } else if (consent === "allowed") {
    getGeoLocation();
  }
}

// Funzione principale di rendering della vista Store
function renderStoreView() {
  const container = $("#store-app-container");
  if (!container) return;
  
  const partner = getCurrentPartner();
  
  // LOGICA DI CONTROLLO STATO
  if (partner) {
    state.currentStore = partner;
    // Se è loggato e prova ad andare al login, portalo in Dashboard.
    // 'pricing' invece resta valido anche da loggato: è la pagina di upgrade volontario.
    if (storeData.step === 'login') {
      storeData.step = 'dashboard';
  }                                                                                                                   
  } else {
    // Se NON è loggato e prova ad andare in Dashboard, rimandalo ai Piani
    if (storeData.step === 'dashboard') {
      storeData.step = 'pricing';
    }
  }

  // RENDERING EFFETTIVO
  container.innerHTML = ""; // Pulisce il contenitore prima di disegnare

  if (storeData.step === 'pricing') {
    renderPricingTable(container);
  } else if (storeData.step === 'login') {
    renderStoreLoginForm(container);
  } else if (storeData.step === 'onboarding') {
    renderOnboarding(container);
  } else if (storeData.step === 'dashboard') {
    renderDashboard(container);
  }
}

function renderStoreLoginForm(container) {
  container.innerHTML = `
    <div class="pricing-wrapper" style="max-width: 420px; margin: 60px auto;">
      <div class="onboarding-card">
        <h3>Accesso Area Partner</h3>
        <div id="storeLoginError" class="error-msg hidden"></div>
        <form id="storeLoginForm" class="auth-form">
          <input type="email" id="storeLoginEmail" placeholder="Email aziendale" required>
          <input type="password" id="storeLoginPass" placeholder="Password" required>
          <button type="submit" class="btn full-width">Accedi</button>
        </form>
        <p style="text-align:center; margin-top:10px;">
          <a href="javascript:void(0)" onclick="renderStoreForgotPasswordForm()" style="font-size:0.85rem; color:#64748b;">Password dimenticata?</a>
        </p>
        <p class="auth-switch" style="text-align:center; margin-top:15px;">
          <a href="javascript:void(0)" onclick="storeData.step='pricing'; renderStoreView();">Torna ai piani</a>
        </p>
      </div>
    </div>
  `;

  $("#storeLoginForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerText = "Accesso in corso...";

    const email = $("#storeLoginEmail").value;
    const pass = $("#storeLoginPass").value;
    const result = await window.loginPartnerAction(email, pass);

    if (result.success) {
      storeData.step = 'dashboard';
      storeData.activeTab = 'home';
      renderStoreView();
      updateDrawerUI();
      await refreshMyOffers();
      toast.success("Bentornato!");
    } else {
      btn.disabled = false;
      btn.innerText = "Accedi";
      const err = $("#storeLoginError");
      const messages = {
        credentials: "Email o password errati.",
        'no-store': "Nessun negozio associato a questo account.",
        expired: "Il tuo abbonamento è scaduto. Contatta l'assistenza.",
        technical: "Errore tecnico. Riprova tra poco."
      };
      err.innerText = messages[result.reason] || "Errore durante l'accesso.";
      err.classList.remove("hidden");
    }
  };
}

function renderStoreForgotPasswordForm() {
  const container = $("#store-app-container");
  container.innerHTML = `
    <div class="pricing-wrapper" style="max-width: 420px; margin: 60px auto;">
      <div class="onboarding-card">
        <h3>Recupera password</h3>
        <p style="color:#64748b; margin-bottom:15px; font-size:0.9rem;">Inserisci l'email aziendale: ti invieremo un link per reimpostare la password.</p>
        <div id="storeForgotError" class="error-msg hidden"></div>
        <form id="storeForgotForm" class="auth-form">
          <input type="email" id="storeForgotEmail" placeholder="Email aziendale" required>
          <button type="submit" class="btn full-width">Invia link di recupero</button>
        </form>
        <p class="auth-switch" style="text-align:center; margin-top:15px;">
          <a href="javascript:void(0)" onclick="storeData.step='login'; renderStoreView();">Torna al login</a>
        </p>
      </div>
    </div>
  `;

  $("#storeForgotForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#storeForgotEmail").value.trim().toLowerCase();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}?reset=1&role=store`
    });
    if (error) {
      const err = $("#storeForgotError");
      err.innerText = "Errore nell'invio. Controlla l'email e riprova.";
      err.classList.remove("hidden");
      return;
    }
    toast.success("Se l'email è registrata, riceverai un link per reimpostare la password.");
    storeData.step = 'login';
    renderStoreView();
  };
}

function renderPricingTable(container) {
  const partner = getCurrentPartner();
  const currentPlan = partner?.plan || ''; // Recupera il piano attuale (se loggato)

// Tasto di ritorno visibile solo se l'utente è già loggato (quindi sta facendo un upgrade)
let backArrow = "";
if (partner) {
  backArrow = `
    <div class="pricing-back-nav">
      <button class="icon-btn-back" onclick="storeData.step='dashboard'; renderStoreView();" title="Torna alla Dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>Torna alla Dashboard</span>
      </button>
    </div>`;
}

  // Helper per generare i pulsanti in modo dinamico
  const getPlanButton = (planName, priceText) => {
    // 1. Caso: Il partner è già su questo piano
    if (currentPlan === planName) {
      return `<button class="btn full-width disabled" disabled>Piano Attuale</button>`;
    }
    
    // 2. Caso: Il partner è Starter e guarda Standard o Professional
    if (partner && currentPlan === 'Starter' && (planName === 'Standard' || planName === 'Professional')) {
      return `<button class="btn full-width" onclick="activatePlan('${planName}')">Attiva ${planName}</button>`;
    }

    // 3. Caso default: Non loggato o altri stati (usa il trial)
    return `<button class="btn ${planName === 'Standard' ? '' : 'outline'} full-width" onclick="startTrial('${planName}')">
              ${planName === 'Starter' ? 'Prova gratuita' : 'Scegli ' + planName}
            </button>`;
  };

  container.innerHTML = `
    <div class="pricing-wrapper">
      <div class="pricing-header">
        <span class="badge-partner">AREA PARTNER</span>
        <h2>Scegli il piano perfetto per il tuo business</h2>
        <p>Hai già un account? <button class="btn" style="padding: 5px 15px; font-size: 0.8rem; margin-left: 10px;" onclick="showStoreLogin()">Accedi qui</button></p>
      </div>
      
      <div class="pricing-grid">
        <!-- STARTER -->
        <div class="pricing-card">
          <div class="plan-type">🟦 STARTER</div>
          <div class="price">€0 <span>/ 30gg prova</span></div>
          <div class="price-sub">poi €19,99 / mese</div>
          <p class="plan-desc">Ideale per piccoli supermercati e negozi locali.</p>
          <ul class="features">
            <li>Fino a 10 offerte attive</li>
            <li>Dettagli completi prodotto</li>
            <li>Presenza sulla mappa</li>
            <li>Statistiche base</li>
          </ul>
          ${getPlanButton('Starter')}
        </div>

        <!-- STANDARD -->
        <div class="pricing-card popular">
          <div class="popular-badge">MIGLIOR VALORE</div>
          <div class="plan-type">🔵 STANDARD</div>
          <div class="price">€49,99 <span>/ mese</span></div>
          <p class="plan-desc">Per supermercati strutturati con più traffico.</p>
          <ul class="features">
            <li><strong>Offerte illimitate</strong></li>
            <li>Priorità nei risultati</li>
            <li>Evidenziazione grafica</li>
            <li>Statistiche avanzate (CTR)</li>
          </ul>
          ${getPlanButton('Standard')}
        </div>

        <!-- PROFESSIONAL -->
        <div class="pricing-card">
          <div class="plan-type">🔷 PROFESSIONAL</div>
          <div class="price">€149,99 <span>/ mese</span></div>
          <p class="plan-desc">Per catene e supermercati ad alto volume.</p>
          <ul class="features">
            <li>Offerte in posizione "Featured"</li>
            <li>Gestione multi-negozio</li>
            <li>Badge "Supermercato verificato"</li>
            <li>Supporto prioritario</li>
          </ul>
          ${getPlanButton('Professional')}
        </div>

        <!-- ENTERPRISE -->
        <div class="pricing-card">
          <div class="plan-type">🔶 ENTERPRISE</div>
          <div class="price">Custom</div>
          <p class="plan-desc">Per grandi catene o accordi su larga scala.</p>
          <ul class="features">
            <li>Integrazione sistemi interni</li>
            <li>Accesso dati aggregati</li>
            <li>SLA dedicato</li>
            <li>Account manager dedicato</li>
          </ul>
          <button class="btn outline full-width">Contattaci</button>
        </div>
      </div>

      <div class="store-footer-login" style="margin-top: 50px; text-align: center; border-top: 1px solid #eee; padding-top: 30px;">
        <p style="color: #64748b; font-size: 1rem;">
          Hai bisogno di assistenza per scegliere il piano? 
          <a href="#" style="color: var(--primary); font-weight: 700; text-decoration: none; margin-left: 5px;">Parla con un esperto</a>
        </p>
      </div>
    </div>
  `;
}

/**
 * Attiva un periodo di prova (Trial) per un determinato piano.
 * Gestisce il re-indirizzamento all'onboarding se il partner non è loggato,
 * oppure l'aggiornamento immediato del profilo se è già attiva una sessione.
 */
window.startTrial = async function(planName) {
  const partner = getCurrentPartner();
  const todayISO = new Date().toISOString().split("T")[0];

  if (!partner) {
    storeData.subscription.plan = planName;
    storeData.step = 'onboarding';
    renderStoreView();
    return;
  }

  const newSub = {
    plan: planName,
    status: 'trial',
    startedAt: todayISO,
    daysLeft: 30
  };

  const ok = await updatePartnerSubscription(partner.id, newSub);
  if (ok) {
    toast.success(`Periodo di prova per il piano ${planName} attivato!`);
    storeData.step = 'dashboard';
    storeData.activeTab = 'home';
    renderStoreView();
  } else {
    toast.error("Errore durante l'aggiornamento dell'abbonamento.");
  }
};

// Esempio ipotetico di funzione per forzare la scadenza (da usare per test o cron)
function simulateTrialExpiry(partnerId) {
  const expiredSub = {
      plan: 'Starter',
      status: 'expired',
      daysLeft: 0,
      expiredAt: new Date().toISOString()
  };
  updatePartnerSubscription(partnerId, expiredSub);
  renderStoreView(); // Rinfresca la UI per mostrare i blocchi
}

function renderOnboarding(container) {
  const step = storeData.onboardingStep;
  
  let detectedCity = "";
  const userLocInput = $("#locationInput");
  if (userLocInput && userLocInput.value) {
      const parts = userLocInput.value.trim().split(" ");
      detectedCity = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
  }

  container.innerHTML = `
    <div class="onboarding-card">
      <div class="step-indicator">
        <div class="step active"></div>
        <div class="step ${step >= 2 ? 'active' : ''}"></div>
        <div class="step ${step >= 3 ? 'active' : ''}"></div>
        <div class="step ${step >= 4 ? 'active' : ''}"></div>
      </div>
      
      ${step === 1 ? `
        <h3>Configura l'Account</h3>
        <p class="step-sub">Dati di accesso fondamentali.</p>
        <form id="onboardingForm" class="auth-form">
          <input type="text" id="obName" placeholder="Nome Supermercato (es: Conad City)" required value="${storeData.tempReg?.name || ''}">
          <select id="obType" required>
            <option value="">Tipologia Attività</option>
            <option value="supermarket">Supermercato</option>
            <option value="discount">Discount</option>
            <option value="local">Negozio Alimentare</option>
          </select>
          <input type="email" id="obEmail" placeholder="Email Aziendale" required value="${storeData.tempReg?.email || ''}">
          ${storeData.tempReg?.existingAccount ? `
            <p style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px; font-size:0.85rem; color:#1e40af;">
              Questa email è già registrata su Decerne. Userai la password che hai già — non serve impostarne una nuova.
            </p>
          ` : `
            <div class="form-row">
              <input type="password" id="obPass" placeholder="Password" required>
              <input type="password" id="obPassConfirm" placeholder="Conferma Password" required>
            </div>
          `}
          <input type="text" id="obRef" placeholder="Nome Referente" required value="${storeData.tempReg?.ref || ''}">
          <button type="submit" class="btn full-width">Continua alla verifica email</button>
        </form>
      ` : step === 2 ? `
        <h3>Verifica la tua email</h3>
        <p class="step-sub">Abbiamo inviato un codice a 6 cifre a <strong>${storeData.tempReg?.email || ''}</strong></p>
        <form id="onboardingForm" class="auth-form">
          <input type="text" id="obOtpCode" maxlength="6" inputmode="numeric" pattern="[0-9]*"
            placeholder="000000" style="font-size:1.5rem; letter-spacing:8px; text-align:center;" required>
          <button type="submit" class="btn full-width">Verifica codice</button>
        </form>
        <p style="margin-top:15px; font-size:0.9rem; text-align:center;">
          Non hai ricevuto il codice? <a href="javascript:void(0)" onclick="resendOnboardingOtp()">Invialo di nuovo</a>
        </p>
      ` : step === 3 ? `
        <h3>Posizione del Negozio</h3>
        <p class="step-sub">Indica dove si trova il punto vendita.</p>
        <form id="onboardingForm" class="auth-form">
          <div class="input-group">
            <label>Indirizzo e Numero Civico</label>
            <input type="text" id="obStreet" placeholder="Es: Via Roma, 15" required value="${storeData.tempReg?.street || ''}">
          </div>
          <div class="form-row">
            <div class="input-group" style="flex: 2;">
              <label>Città</label>
              <input type="text" id="obCity" placeholder="Es: Milano" required value="${storeData.tempReg?.city || getCleanUserCity() || ''}">
            </div>
            <div class="input-group" style="flex: 1;">
              <label>CAP</label>
              <input type="text" id="obCap" placeholder="12345" maxlength="5" required value="${storeData.tempReg?.cap || getCleanUserCap() || ''}">
            </div>
          </div>
          <button type="submit" class="btn full-width">Continua al passo 4</button>
        </form>
      ` : `
        <h3>Dettagli Aggiuntivi</h3>
        <p class="step-sub">Completa il profilo (Facoltativo).</p>
        <form id="onboardingForm" class="auth-form">
          <input type="url" id="obLogo" placeholder="URL Logo (es: https://...)">
          <input type="tel" id="obTel" placeholder="Numero di Telefono">
          <input type="text" id="obHours" placeholder="Orari (es: Lun-Sab 08-20)">
          <input type="url" id="obWeb" placeholder="Sito Web">
          
          <div class="input-group" style="margin-top: 10px;">
            <label>Codice Presentatore / Email Partner (Referral)</label>
            <input type="text" id="obReferral" placeholder="Inserisci l'ID o l'Email di chi ti ha invitato (Opzionale)">
          </div>

          <div style="display:flex; gap:10px; margin-top:20px;">
            <button type="submit" class="btn" style="flex:1">Completa Registrazione</button>
          </div>
        </form>
      `}
    </div>
  `;

  $("#onboardingForm").onsubmit = async (e) => {
    e.preventDefault();
    await handleOnboardingSubmit(step);
  };
}

async function resendOnboardingOtp() {
  if (!storeData.tempReg?.email) return;
  const { error } = storeData.tempReg.existingAccount
    ? await supabaseClient.auth.signInWithOtp({ email: storeData.tempReg.email, options: { shouldCreateUser: false } })
    : await supabaseClient.auth.resend({ type: 'signup', email: storeData.tempReg.email });
  if (error) toast.error("Errore nell'invio. Riprova tra qualche minuto.");
  else toast.success("Codice reinviato!");
}

// Nuova funzione per gestire la logica dei passaggi
async function handleOnboardingSubmit(step) {
  try {
    const form = document.getElementById("onboardingForm");
    const btn = form ? form.querySelector('button[type="submit"]') : null;
    if (btn) btn.disabled = true;

    if (step === 1) {
      const emailClean = clean($("#obEmail").value).trim().toLowerCase();
      const nameVal = clean($("#obName").value);
      const refVal = clean($("#obRef").value);
      const typeVal = $("#obType").value;

      // Primo tentativo: c'è già un account (cliente o altro) con questa email?
      // shouldCreateUser:false NON crea nulla, fallisce se l'email non esiste ancora
      const { error: otpCheckError } = await supabaseClient.auth.signInWithOtp({
        email: emailClean,
        options: { shouldCreateUser: false }
      });

      if (!otpCheckError) {
        // Esiste già un account con questa email: niente password nuova, codice già inviato
        storeData.tempReg = {
          name: nameVal,
          email: emailClean,
          ref: refVal,
          type: typeVal,
          existingAccount: true
        };
        storeData.onboardingStep = 2;
        renderStoreView();
        return;
      }

      // Nessun account esistente: serve una password nuova, se non l'ha ancora inserita mostriamo il campo
      if (!storeData.tempReg?.existingAccount && !document.getElementById("obPass")) {
        // Primo giro senza campo password visibile: impossibile, il campo c'è di default per email nuove.
        // Questo ramo non dovrebbe mai attivarsi, ma resta come sicurezza.
      }

      const pass = document.getElementById("obPass")?.value;
      const confirm = document.getElementById("obPassConfirm")?.value;
      if (!pass || pass !== confirm) {
        if (btn) btn.disabled = false;
        return toast.error("Le password non coincidono!");
      }

      storeData.tempReg = {
        name: nameVal,
        email: emailClean,
        pass: pass,
        ref: refVal,
        type: typeVal,
        existingAccount: false
      };

      const { data: authData, error: authError } = await supabaseClient.auth.signUp({
        email: emailClean,
        password: pass
      });
      if (authError) throw new Error(authError.message);
      if (!authData.user) throw new Error("Registrazione non completata.");

      storeData.onboardingStep = 2;
      renderStoreView();
    }
    else if (step === 2) {
      const token = $("#obOtpCode").value.trim();
      if (token.length !== 6) {
        if (btn) btn.disabled = false;
        return toast.error("Inserisci il codice a 6 cifre.");
      }

      // Email nuova -> tipo 'signup' (creata da signUp). Email già esistente -> tipo 'email' (da signInWithOtp)
      const otpType = storeData.tempReg.existingAccount ? 'email' : 'signup';

      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: storeData.tempReg.email,
        token,
        type: otpType
      });
      if (error || !data.user) {
        if (btn) btn.disabled = false;
        return toast.error("Codice non valido o scaduto. Riprova o richiedine uno nuovo.");
      }

      storeData.tempReg.authUserId = data.user.id;
      toast.success("Email verificata!");
      storeData.onboardingStep = 3;
      renderStoreView();
    }
    else if (step === 3) {
      if (!storeData.tempReg) throw new Error("Dati mancanti dallo step precedente.");
      storeData.tempReg.street = clean($("#obStreet").value);
      storeData.tempReg.city = clean($("#obCity").value).trim().toLowerCase();
      storeData.tempReg.cap = clean($("#obCap").value).trim();
      storeData.onboardingStep = 4;
      renderStoreView();
    }
    else if (step === 4) {
      if (!storeData.tempReg || !storeData.tempReg.city) throw new Error("Dati incompleti.");

      const referralInput = document.getElementById("obReferral")?.value.trim() || "";
      let referralNotes = "";
      if (referralInput) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referralInput);
        const { data: refData, error: refError } = await supabaseClient.rpc('verify_referral_by_email', {
          p_email: isUuid ? null : referralInput
        });
        if (isUuid) {
          const { data: byId } = await supabaseClient.from('public_stores').select('id, name').eq('id', referralInput).single();
          if (!byId) {
            if (btn) btn.disabled = false;
            return toast.error("Codice presentatore non valido.");
          }
          referralNotes = `Presentato da: ${byId.name} (${byId.id})`;
        } else if (referralInput) {
          if (refError || !refData || refData.length === 0) {
            if (btn) btn.disabled = false;
            return toast.error("Email del presentatore non trovata.");
          }
          referralNotes = `Presentato da: ${refData[0].name} (${refData[0].id})`;
        }
      }

      const logoUrl = clean($("#obLogo").value);
      const phone = clean($("#obTel").value);
      const fullAddress = `${storeData.tempReg.street}, ${storeData.tempReg.cap} ${storeData.tempReg.city}`;
      const emailClean = storeData.tempReg.email;
      const planChoice = storeData.subscription?.plan || 'Starter';

      // La sessione è già attiva dallo step 3 (verifyOtp): possiamo scrivere direttamente su DB
      const { data: storeRow, error: storeError } = await supabaseClient
        .from('stores')
        .insert({
          auth_user_id: storeData.tempReg.authUserId,
          email: emailClean,
          name: storeData.tempReg.name,
          address: fullAddress,
          city: storeData.tempReg.city,
          cap: storeData.tempReg.cap,
          logo_url: logoUrl,
          phone: phone,
          plan: planChoice,
          internal_notes: referralNotes
        })
        .select()
        .single();
      if (storeError) throw new Error("Errore creazione negozio: " + storeError.message);

      const { data: locationRow } = await supabaseClient
        .from('store_locations')
        .insert({
          store_id: storeRow.id,
          name: "Sede Principale",
          address: fullAddress
        })
        .select()
        .single();

      const newStore = {
        id: storeRow.id,
        email: storeRow.email,
        name: storeRow.name,
        address: storeRow.address,
        city: storeRow.city,
        cap: storeRow.cap,
        logo: storeRow.logo_url || "",
        phone: storeRow.phone || "",
        hours: "",
        internalNotes: storeRow.internal_notes || "",
        locations: [{ id: locationRow.id, name: "Sede Principale", address: fullAddress }],
        plan: storeRow.plan,
        subscription: {
          plan: storeRow.plan,
          status: 'trial',
          startedAt: new Date().toISOString().split("T")[0],
          daysLeft: 30
        }
      };

      const sessionData = JSON.stringify(newStore);
      localStorage.setItem(PARTNER_AUTH_KEY, sessionData);
      sessionStorage.setItem(SESSION_PARTNER, sessionData);

      state.currentStore = newStore;
      storeData.step = 'dashboard';
      storeData.activeTab = 'home';
      storeData.tempReg = null;

      toast.success("Registrazione completata! Benvenuto nel tuo pannello.");

      renderStoreView();
      updateDrawerUI();
    }
  } catch (e) {
    console.error("Dettaglio Errore Onboarding:", e);
    const form = document.getElementById("onboardingForm");
    const btn2 = form ? form.querySelector('button[type="submit"]') : null;
    if (btn2) {
      btn2.disabled = false;
      btn2.innerText = "Riprova";
    }
    toast.error("Errore tecnico: " + e.message);
  }
}

// MODIFICA: renderDashboard più sicura
function renderDashboard(container) {
  const partner = getCurrentPartner();
  if (!partner) return;

  container.innerHTML = `
    <div class="store-dashboard">
      <aside class="store-sidebar">
        <div class="sidebar-title">PANNELLO PARTNER</div>
        <button class="store-nav-btn ${storeData.activeTab === 'home' ? 'active' : ''}" onclick="switchStoreTab('home')">🏠 Panoramica</button>
        <button class="store-nav-btn ${storeData.activeTab === 'offers' ? 'active' : ''}" onclick="switchStoreTab('offers')">🏷️ Le mie Offerte</button>
        <button class="store-nav-btn ${storeData.activeTab === 'locations' ? 'active' : ''}" onclick="switchStoreTab('locations')">📍 Gestione Sedi</button>
        <button class="store-nav-btn ${storeData.activeTab === 'trash' ? 'active' : ''}" onclick="switchStoreTab('trash')">🗑️ Cestino</button>
        ${(() => {
          const p = getCurrentPartner();
          const plan = p?.plan || 'Starter';
          const isPro = plan === 'Professional' || plan === 'Enterprise';
          const isEnt = plan === 'Enterprise';
          return `
            ${isEnt ? `<button class="store-nav-btn ${storeData.activeTab === 'general' ? 'active' : ''}" onclick="switchStoreTab('general')">📊 Dashboard Generale</button>` : ''}
            ${isPro ? `<button class="store-nav-btn ${storeData.activeTab === 'api' ? 'active' : ''}" onclick="switchStoreTab('api')">🔌 Integrazione API</button>` : ''}
            ${isEnt ? `<button class="store-nav-btn ${storeData.activeTab === 'team' ? 'active' : ''}" onclick="switchStoreTab('team')">👥 Team</button>` : ''}
          `;
        })()}
        <button class="store-nav-btn ${storeData.activeTab === 'sub' ? 'active' : ''}" onclick="switchStoreTab('sub')">💳 Abbonamento</button>
        <button class="store-nav-btn ${storeData.activeTab === 'profile' ? 'active' : ''}" onclick="switchStoreTab('profile')">⚙️ Impostazioni</button>
        <div style="margin-top: auto; padding-top: 20px; border-top: 1px solid #eee;">
          <button class="store-nav-btn" onclick="logoutPartner()" style="color: #ef4444; width: 100%; text-align: left;">🚪 Esci</button>
        </div>
      </aside>
      <main class="store-content" id="active-tab-content"></main>
    </div>
  `;

  const contentArea = container.querySelector("#active-tab-content");
  if (contentArea) {
    const tabResult = renderCurrentTab();
    if (typeof tabResult === 'string') contentArea.innerHTML = tabResult;
    else { contentArea.innerHTML = ""; contentArea.appendChild(tabResult); }
  }
}

/**
 * Renderizza la Dashboard Home con statistiche a livelli, in base al piano attivo.
 * - Starter: statistiche base (Visualizzazioni, Click)
 * - Standard+: statistiche avanzate (+ CTR, Migliore Offerta, Più cliccata)
 * - Professional/Enterprise: + card API Key e Supporto prioritario
 */
function renderHomeTab() {
  const partner = getCurrentPartner();
  const myOffers = getMyOffers() || [];
  const plan = partner?.plan || 'Starter';
  const isProfessional = plan === 'Professional' || plan === 'Enterprise';
  const isStandardOrHigher = ['Standard', 'Professional', 'Enterprise'].includes(plan);

  // 1. CALCOLO METRICHE (comuni a tutti i piani)
  const totalViews = myOffers.reduce((acc, o) => acc + (o.views || 0), 0);
  const totalOpens = myOffers.reduce((acc, o) => acc + (o.opens || 0), 0);
  const avgCtr = totalViews > 0 ? ((totalOpens / totalViews) * 100).toFixed(1) : "0.0";

  let bestOffer = { product: "Nessuna", val: "0%" };
  let mostClicked = { product: "Nessuna", val: "0" };

  if (myOffers.length > 0) {
    const sortedByDiscount = [...myOffers].sort((a, b) => {
      const discA = a.originalPrice > a.price ? (a.originalPrice - a.price) / a.originalPrice : 0;
      const discB = b.originalPrice > b.price ? (b.originalPrice - b.price) / b.originalPrice : 0;
      return discB - discA;
    });
    if (sortedByDiscount[0]) {
      const o = sortedByDiscount[0];
      const p = o.originalPrice > o.price ? Math.round(((o.originalPrice - o.price) / o.originalPrice) * 100) : 0;
      bestOffer = { product: o.product, val: `-${p}%` };
    }

    const sortedByClicks = [...myOffers].sort((a, b) => (b.opens || 0) - (a.opens || 0));
    if (sortedByClicks[0]) {
      mostClicked = { product: sortedByClicks[0].product, val: sortedByClicks[0].opens || 0 };
    }
  }

  // 2. STATISTICHE BASE — sempre visibili, anche su Starter
  const basicStatsHTML = `
    <div class="stats-grid-saas">
      <div class="stat-card-saas">
        <div class="label">Visualizzazioni Totali</div>
        <div class="value" style="color: var(--primary);">${totalViews}</div>
      </div>
      <div class="stat-card-saas">
        <div class="label">Aperture Dettaglio</div>
        <div class="value" style="color: #10b981;">${totalOpens}</div>
      </div>
    </div>
  `;

  // 3. STATISTICHE AVANZATE — solo Standard e superiori
  const advancedStatsHTML = isStandardOrHigher ? `
    <div class="stats-grid-saas" style="margin-top: 20px;">
      <div class="stat-card-saas" style="border-top: 4px solid #6366f1;">
        <div class="label">CTR Medio</div>
        <div class="value" style="color: #6366f1;">${avgCtr}%</div>
      </div>
      <div class="stat-card-saas" style="border-top: 4px solid #f59e0b;">
        <div class="label">🔥 Migliore Offerta</div>
        <div class="value" style="font-size: 1.2rem;">${bestOffer.product}</div>
        <small style="color: #f59e0b; font-weight: 700;">Sconto: ${bestOffer.val}</small>
      </div>
      <div class="stat-card-saas" style="border-top: 4px solid #10b981;">
        <div class="label">🖱️ Più cliccata</div>
        <div class="value" style="font-size: 1.2rem;">${mostClicked.product}</div>
        <small style="color: #10b981; font-weight: 700;">${mostClicked.val} click</small>
      </div>
    </div>
  ` : `
    <div class="card-saas" style="text-align:center; padding: 30px; margin-top: 20px;">
      <p style="margin-bottom: 12px;">Sblocca CTR, Migliore Offerta e classifica click con il piano Standard o superiore.</p>
      <button class="btn outline" onclick="switchStoreTab('sub')">Scopri i vantaggi</button>
    </div>
  `;

  // 4. EXTRA — solo Professional/Enterprise
  const professionalExtras = isProfessional ? `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
      <div class="card-saas" style="border-left: 4px solid #6929c4;">
        <h3 style="color: #6929c4;">🔑 API Key</h3>
        <input type="text" value="${partner.apiKey || ''}" readonly style="width:100%; padding:8px; margin: 10px 0; border-radius:6px; border:1px solid #ddd; font-family:monospace; font-size:0.8rem;">
        <button class="btn" style="background:#6929c4; padding:5px 15px;" onclick="navigator.clipboard.writeText('${partner.apiKey || ''}'); toast.success('API Key copiata!')">Copia</button>
      </div>
      <div class="card-saas" style="border-left: 4px solid #10b981; background: #f0fdf4;">
        <h3 style="color: #166534;">🎧 Supporto Prioritario</h3>
        <p style="font-size: 0.8rem; margin: 10px 0;">Email: <strong>support@decerne.it</strong><br>Risposta: <strong>&lt; 24h</strong></p>
      </div>
    </div>
  ` : "";

  // 5. RITORNO UNICO
  return `
    ${getSubscriptionBanner()}
    <header class="tab-header">
      <div>
        <span class="badge-plan plan-${plan.toLowerCase()}">${plan}</span>
        <h2 style="margin-top:10px">Benvenuto, ${partner.name}</h2>
      </div>
      <button class="btn" onclick="handleNewOfferClick()">+ Crea prima offerta</button>
    </header>

    ${basicStatsHTML}
    ${advancedStatsHTML}
    ${professionalExtras}

    <div style="margin-top:20px; color:#64748b; font-size:0.9rem;">
      Usa il menu a sinistra per gestire le tue offerte e il profilo del punto vendita.
    </div>
  `;
}

// Gestore del cambio tab
window.switchStoreTab = (tab) => {
  storeData.activeTab = tab;
  
  if (tab === 'offers' || tab === 'home') refreshMyOffers();
  if (tab === 'trash') refreshMyTrash();
  if (tab === 'team') refreshMyTeam();

  if (state.mode === 'store') {
    renderStoreView();
  }
};

/**
 * Gestore centralizzato per il rendering della tab attiva.
 * Applica i filtri di sicurezza tramite checkPermission.
 */
function renderCurrentTab() {
  const partner = getCurrentPartner();
  if (!partner) return '';

  const plan = partner.plan || 'Starter';
  const isEnterprise = plan === 'Enterprise';
  const isProfessional = plan === 'Professional' || isEnterprise;

  switch(storeData.activeTab) {
    // --- LIVELLO ENTERPRISE ---
    case 'general': 
      return isEnterprise ? renderGeneralDashboardTab() : renderHomeTab();
    case 'team': 
      return isEnterprise ? renderTeamTab() : renderHomeTab();

    // --- LIVELLO PROFESSIONAL / ENTERPRISE ---
    case 'api': 
      return isProfessional ? renderApiTab() : renderHomeTab();
    case 'import': 
      return isProfessional ? renderImportTab() : renderHomeTab();

    // --- LIVELLO BASE (Sempre accessibili) ---
    case 'home': 
      return renderHomeTab();
    case 'offers': 
      return renderOffersTab();
      case 'locations': 
      return renderLocationsTab(); // Mostra la tab Sedi a tutti (con i limiti del piano)
    case 'trash':
      return renderTrashTab();
    case 'sub': 
      return renderSubTab();
    case 'profile': 
      return renderProfileTab(); // Questa ora è "Impostazioni"

    default: 
      return renderHomeTab();
  }
}

window.handleNewOfferClick = () => {
  try {
    const partner = getCurrentPartner();
    if (!partner) return toast.error("Effettua il login");
    
    const myOffers = getMyOffers();
    const currentPlan = (partner.plan || "Starter").toUpperCase();

    if (currentPlan === 'STARTER' && myOffers.length >= 10) {
      return showConfirm("Hai raggiunto il limite di 10 offerte per il piano Starter. Vuoi passare a Standard?", () => {
        switchStoreTab('sub');
      });
    }

    openOfferModal();
  } catch (e) {
    console.error("Errore tasto nuova offerta:", e);
  }
};

function renderStatsTab() {
  const partner = getCurrentPartner();
  const plan = partner?.plan || 'Starter';
  const isLocked = plan === 'Starter';
  
  // Recupera le offerte aggiornate dello store loggato
  const myOffers = getMyOffers(); 

  let statsContent = "";

  if (isLocked) {
    // Layout per Starter (Bloccato)
    statsContent = `
      <div class="stats-view-container" style="position: relative;">
        <div class="blur-content">
          <table class="offer-table">
            <thead><tr><th>Offerta</th><th>Views</th><th>Aperture</th><th>CTR%</th></tr></thead>
            <tbody>
              <tr><td>Prodotto Demo</td><td>120</td><td>15</td><td>12.5%</td></tr>
            </tbody>
          </table>
        </div>
        <div class="lock-overlay">
          <div class="lock-card">
            <div class="lock-icon">🔒</div>
            <h3>Statistiche Avanzate</h3>
            <p>Passa al piano <strong>Standard</strong> per monitorare l'efficacia delle tue offerte in tempo reale.</p>
            <button class="btn" onclick="switchStoreTab('sub')">Sblocca Ora</button>
          </div>
        </div>
      </div>`;
  } else {
    // Layout per Standard (Sbloccato)
    const rows = myOffers.map(o => {
      const views = o.views || 0;
      const opens = o.opens || 0;
      const ctr = views > 0 ? ((opens / views) * 100).toFixed(1) : "0.0";
      
      return `
        <tr>
          <td><strong>${o.product}</strong></td>
          <td>${views}</td>
          <td>${opens}</td>
          <td><span style="color: var(--primary); font-weight:700;">${ctr}%</span></td>
        </tr>`;
    }).join("");

    statsContent = `
      <div class="card-saas">
        <table class="offer-table">
          <thead>
            <tr>
              <th>Offerta</th>
              <th>Visualizzazioni</th>
              <th>Aperture (Popup)</th>
              <th>CTR%</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="text-align:center;">Nessun dato disponibile.</td></tr>'}
          </tbody>
        </table>
        <p style="font-size: 0.75rem; color: #64748b; margin-top: 15px;">
          * CTR (Click-Through Rate): Percentuale di utenti che hanno aperto il dettaglio dopo aver visto l'offerta.
        </p>
      </div>`;
  }

  return `
    <header class="tab-header">
      <h2>Analisi Performance</h2>
      ${!isLocked ? '<span class="badge-plan plan-standard">Standard Access</span>' : ''}
    </header>
    ${statsContent}
  `;
}

function renderTrashTab() {
  const trash = myTrashCache;

  if (trash.length === 0) {
    return `
      <h2>🗑️ Cestino</h2>
      <p style="color:#64748b; margin-top:20px;">Il cestino è vuoto.</p>
    `;
  }

  return `
    <h2>🗑️ Cestino</h2>
    <p style="color:#64748b; margin-bottom:20px;">Le offerte eliminate restano qui finché non le ripristini.</p>
    <table class="offer-table">
      <thead><tr><th>Prodotto</th><th>Eliminato il</th><th>Azioni</th></tr></thead>
      <tbody>
        ${trash.map(o => `
          <tr>
            <td><strong>${o.product}</strong></td>
            <td>${new Date(o.deletedAt).toLocaleString()}</td>
            <td><button class="btn outline" onclick="restoreOffer('${o.id}')">Ripristina</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Funzione per mostrare il form di login store
window.showStoreLogin = () => {
  storeData.step = 'login';
  renderStoreView();
};

// Funzione che renderizza il form di login specifico per i partner
function renderStoreLoginForm(container) {
  container.innerHTML = `
    <div class="onboarding-card">
      <h3>Accesso Partner</h3>
      <div id="storeLoginError" class="error-msg hidden"></div>
      
      <form id="storeLoginForm" class="auth-form">
        <input type="email" id="stEmail" placeholder="Email Aziendale" required>
        <input type="password" id="stPass" placeholder="Password" required>
        
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer;">
          <input type="checkbox" id="stRemember"> Resta collegato per 30 giorni
        </label>

        <button type="submit" class="btn full-width">Accedi alla Dashboard</button>
      </form>
      <p style="margin-top:20px; font-size:0.85rem; color:#64748b;">
        Non hai un account? <a href="javascript:void(0)" onclick="storeData.step='pricing'; renderStoreView();" style="color:var(--primary); font-weight:700;">Vedi i piani</a>
      </p>
    </div>
  `;

  $("#storeLoginForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const errBox = $("#storeLoginError");

    const emailValue = $("#stEmail").value.trim().toLowerCase();
    const passValue = $("#stPass").value;

    btn.disabled = true;
    btn.innerText = "Verifica in corso...";
    errBox.classList.add("hidden");

    const result = await loginPartnerAction(emailValue, passValue);

    if (result.success) {
      toast.success("Accesso effettuato! Benvenuto.");
      storeData.step = 'dashboard';
      storeData.activeTab = 'home';
      renderStoreView();
      updateDrawerUI();
      return;
    }

    if (result.reason === 'expired') {
      toast.error("ACCOUNT SCADUTO!");
      errBox.innerHTML = `⚠️ <strong>Accesso Negato:</strong> Il tuo periodo di prova o abbonamento è terminato.<br><br>
                          <button class="btn outline" style="padding:5px 10px; font-size:0.7rem;" 
                          onclick="storeData.step='pricing'; renderStoreView();">Rinnova ora</button>`;
    } else if (result.reason === 'credentials') {
      toast.error("Email o password errati.");
      errBox.innerText = "Email o password non corretti.";
    } else if (result.reason === 'no-store') {
      toast.error("Nessun account supermercato trovato.");
      errBox.innerHTML = `⚠️ Non esiste un account supermercato collegato a questa email.<br><br>
                          <button class="btn outline" style="padding:5px 10px; font-size:0.7rem;" 
                          onclick="storeData.step='pricing'; renderStoreView();">Registra il tuo negozio</button>`;
    } else {
      toast.error("Si è verificato un errore tecnico durante l'accesso.");
      errBox.innerText = "Errore tecnico. Riprova.";
    }
    errBox.classList.remove("hidden");
    btn.disabled = false;
    btn.innerText = "Accedi alla Dashboard";
  };
}

// Funzione di supporto per iniettare i dati nel modal e aprirlo
function displayProductInModal(product) {
  const modal = $("#fullPagePopup");
  const title = $("#modalTitle");
  const content = $("#modalContent");

  // Calcolo sconto percentuale
  const discPerc = product.originalPrice > product.price 
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100) 
    : 0;

  // Logica Distintivo Blu per i Professional
  const verifiedBadge = product.plan === 'Professional' 
    ? `<span class="store-verified-blue" style="font-size:0.85rem; margin-left:8px; vertical-align:middle; color:#0f62fe; font-weight:800;">✓ Negozio Verificato</span>` 
    : '';

  title.innerText = "Dettaglio Offerta";
  content.innerHTML = `
    <div class="detail-container" style="max-width: 900px; margin: 0 auto; text-align: left;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 30px; align-items: start;">
        
        <!-- Contenitore Immagine: Grande, Pieno e Arrotondato -->
        <div style="position: relative; width: 100%; height: 450px; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          <img src="${getSafeImageUrl(product.img)}" 
               style="width: 100%; height: 100%; object-fit: cover; display: block;" 
               alt="${product.product}">
          
          ${discPerc > 0 ? `
            <span class="perc-badge" style="position: absolute; top: 20px; left: 20px; background: #ff3b30; color: white; padding: 10px 18px; border-radius: 12px; font-size: 1.3rem; font-weight: 900; box-shadow: 0 4px 12px rgba(255,59,48,0.3);">
              -${discPerc}%
            </span>` : ''}
        </div>

        <!-- Colonna Info -->
        <div style="padding: 10px;">
          <span class="badge-plan plan-standard" style="background:#f1f5f9; color:#475569; padding:5px 12px; border-radius:6px; font-size:0.75rem; font-weight:700; text-transform:uppercase;">${product.category}</span>
          
          <h1 style="margin: 15px 0 10px 0; color: #1e293b; font-size: 2.2rem; line-height: 1.2;">${product.product}</h1>
          
          <p style="color: #64748b; font-size: 1rem; margin-bottom: 25px; line-height: 1.5;">
            🏪 Punto vendita: <strong style="color:#1e293b;">${product.storeName}</strong>${verifiedBadge}<br>
            📍 <span style="font-size: 0.9rem;">${product.storeAddress}</span>
          </p>
          
          <div style="background: #f0f6ff; padding: 25px; border-radius: 16px; margin-bottom: 25px; border: 1px solid #dbeafe;">
            <div class="price-container" style="display:flex; align-items: baseline; gap: 12px;">
              <span class="price-tag" style="font-size: 3rem; color: #0f62fe; font-weight: 900;">${formatPrice(product.price)}</span>
              ${product.originalPrice > product.price ? `<span class="old-price-small" style="font-size: 1.4rem; text-decoration: line-through; color: #94a3b8;">${formatPrice(product.originalPrice)}</span>` : ''}
            </div>
            <div style="margin-top: 10px; display: flex; align-items: center; gap: 6px; color: #1e40af; font-weight: 600;">
              <span>🗓️</span> <span>Scade il: ${product.endDate}</span>
            </div>
          </div>

          <div style="margin-bottom: 30px;">
            <h4 style="color: #1e293b; margin-bottom: 8px; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">Descrizione</h4>
            <p style="line-height: 1.6; color: #475569; font-size: 1.05rem;">${product.description || 'Nessuna descrizione aggiuntiva fornita dal punto vendita.'}</p>
          </div>
          
          <button class="btn full-width" onclick="saveToShoppingList('${product.id}')" style="height: 60px; font-size: 1.2rem; border-radius: 14px; background: #0f62fe; box-shadow: 0 4px 14px rgba(15,98,254,0.3); transition: transform 0.2s;">
            🛒 Aggiungi alla lista spesa
          </button>
        </div>

      </div>
    </div>
  `;
  modal.style.display = "flex";
}

// 1. Funzione per aggiornare la UI del Drawer in base al login
function updateDrawerUI() {
  const profileCard = $("#drawerProfileCard");
  const authButtons = $("#drawerAuthButtons");
  const user = state.currentUser;

  if (user) {
    // Se l'utente è loggato: mostra profilo, nasconde bottoni login
    if (profileCard) profileCard.classList.remove("hidden");
    if (authButtons) authButtons.classList.add("hidden");

    const avatar = $("#drawerAvatar");
    const nameLabel = $("#drawerName");
    const emailLabel = $("#drawerEmail");

    if (avatar) avatar.textContent = (user.nome[0] + (user.cognome ? user.cognome[0] : '')).toUpperCase();
    if (nameLabel) nameLabel.textContent = `${user.nome} ${user.cognome || ''}`;
    if (emailLabel) emailLabel.textContent = user.email;
    
    // Rendi la card cliccabile per aprire le impostazioni profilo
    if (profileCard) profileCard.onclick = () => openFullPageModal('profile');
  } else {
    // Se non loggato: mostra bottoni login, nasconde profilo
    if (profileCard) profileCard.classList.add("hidden");
    if (authButtons) authButtons.classList.remove("hidden");
  }
}

/**
 * Helper unico per aggiornare l'abbonamento di un partner sia nel DB (localStorage)
 * che nella sessione attiva (sessionStorage), garantendo la coerenza dei dati.
 */
async function updatePartnerSubscription(partnerId, subscriptionObj) {
  const { data: storeRow, error } = await supabaseClient
    .from('stores')
    .update({
      plan: subscriptionObj.plan,
      subscription_status: subscriptionObj.status,
      trial_started_at: subscriptionObj.startedAt || null,
      renewal_date: subscriptionObj.renewalDate || null
    })
    .eq('id', partnerId)
    .select()
    .single();

  if (error) {
    console.error("Errore aggiornamento abbonamento:", error);
    return false;
  }

  // Se è il negozio attualmente loggato in questo browser, sincronizza la sessione
  const partner = getCurrentPartner();
  if (partner && partner.id === partnerId) {
    const updatedStore = {
      ...partner,
      plan: storeRow.plan,
      subscription: {
        plan: storeRow.plan,
        status: storeRow.subscription_status,
        startedAt: storeRow.trial_started_at,
        renewalDate: storeRow.renewal_date,
        daysLeft: subscriptionObj.daysLeft ?? partner.subscription?.daysLeft ?? 30
      }
    };
    const dataString = JSON.stringify(updatedStore);
    sessionStorage.setItem(SESSION_PARTNER, dataString);
    localStorage.setItem(PARTNER_AUTH_KEY, dataString);
    state.currentStore = updatedStore;
  }

  logAuditAction(partnerId, "SUBSCRIPTION_UPDATED", JSON.stringify(subscriptionObj));
  return true;
}

function showToast(message, type) {
  if (type === "error") toast.error(message);
  else if (type === "info") toast.info(message);
  else toast.success(message);
}

// Nuova funzione per le Conferme in stile Toast
function showConfirm(message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:9999; display:flex; align-items:flex-end; justify-content:center; padding-bottom:30px;";
  
  const box = document.createElement("div");
  box.style.cssText = "background:white; padding:20px; border-radius:20px; width:90%; max-width:400px; box-shadow:0 10px 40px rgba(0,0,0,0.2); text-align:center; animation: slideUp 0.3s ease-out;";
  
  box.innerHTML = `
    <p style="margin-bottom:20px; font-weight:600; color:#161616;">${message}</p>
    <div style="display:flex; gap:10px;">
      <button id="confirmNo" class="btn outline" style="flex:1">Annulla</button>
      <button id="confirmYes" class="btn" style="flex:1; background:#ff3b30">Conferma</button>
    </div>
  `;
  
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#confirmNo").onclick = () => overlay.remove();
  box.querySelector("#confirmYes").onclick = () => {
    overlay.remove();
    onConfirm();
  };
}


// Banner speciale con tasto "Annulla"
function showUndoBanner(message, offerId) {
  const banner = document.createElement("div");
  banner.id = "undoBanner";
  banner.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: #161616; color: white; padding: 15px 25px; border-radius: 12px;
    display: flex; align-items: center; gap: 20px; z-index: 11000;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4); animation: slideUp 0.3s ease;
  `;
  banner.innerHTML = `
    <span>${message}</span>
    <button onclick="restoreOffer('${offerId}', true)" style="background:#0f62fe; color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:700;">ANNULLA</button>
  `;
  document.body.appendChild(banner);

  // Auto-rimozione dopo 10 secondi
  setTimeout(() => { if(banner) banner.remove(); }, 10000);
}

// Funzione universale di ripristino
window.restoreOffer = async (id) => {
  const { error } = await supabaseClient
    .from('offers')
    .update({ deleted_at: null })
    .eq('id', id);

  if (error) {
    console.error("Errore ripristino offerta:", error);
    return toast.error("Errore durante il ripristino.");
  }

  toast.success("Offerta ripristinata con successo!");
  await refreshMyOffers();
  await refreshMyTrash();
};

// Funzione da chiamare nel pannello Admin
// Queste funzioni richiedono un vero login admin collegato a Supabase
// (oggi il pannello admin è solo un controllo password nel browser, le
// regole di sicurezza del database non lo riconoscono). Le ricostruiremo
// quando avremo un'autenticazione admin reale.
window.renderAdminTrash = () => {
  const container = $("#adminOffers");
  container.innerHTML = `
    <div style='padding:40px; color:#64748b; text-align:center;'>
      🔒 Funzione non ancora disponibile: richiede un'autenticazione admin reale collegata a Supabase.
    </div>
  `;
};

window.permanentDelete = (id) => {
  toast.error("Funzione non disponibile: richiede autenticazione admin reale.");
};

window.emptyTrash = () => {
  toast.error("Funzione non disponibile: richiede autenticazione admin reale.");
};

window.renderAdminAudit = async () => {
  const container = $("#adminOffers");
  container.innerHTML = `<p style="padding:20px; color:#64748b;">Caricamento audit log...</p>`;

  // NB: come il registro modifiche, finché l'auth admin resta quella "legacy"
  // (Punto 5), questa query restituirà sempre vuoto: la RLS di SELECT
  // richiede un auth.uid() reale presente nella tabella "admins".
  const { data: logs, error } = await supabaseClient
    .from('audit_logs')
    .select('actor, action, target, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error("Errore caricamento audit log:", error);
    container.innerHTML = `<p style="padding:20px; color:#64748b;">Errore nel caricamento dell'audit log.</p>`;
    return;
  }

  let html = `<h3>🛡️ Audit Log & Sicurezza</h3>
              <table class="offer-table">
                <thead><tr><th>Data</th><th>Store ID</th><th>Evento</th><th>Dettagli</th></tr></thead><tbody>`;

  (logs || []).forEach(l => {
    const isAlert = l.action === "RATE_LIMIT_BLOCK";
    html += `<tr style="${isAlert ? 'background:#fff5f5; color:#c53030;' : ''}">
      <td>${new Date(l.created_at).toLocaleTimeString()}</td>
      <td>${l.actor}</td>
      <td><strong>${l.action}</strong></td>
      <td>${l.target}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
};

window.renderAdminHistory = async () => {
  const container = $("#adminOffers");
  container.innerHTML = `<p style="padding:20px; color:#64748b;">Caricamento registro...</p>`;

  // NB: finché l'auth admin resta quella "legacy" (Punto 5), questa query
  // restituirà sempre vuoto: la RLS richiede un auth.uid() reale presente
  // nella tabella "admins".
  const { data: rows, error } = await supabaseClient
    .from('offer_history')
    .select('offer_id, change_note, changed_at')
    .order('changed_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error("Errore caricamento registro modifiche:", error);
    container.innerHTML = `<p style="padding:20px; color:#64748b;">Errore nel caricamento del registro.</p>`;
    return;
  }

  let html = `<h3>📜 Registro Modifiche Globale</h3>
              <table class="offer-table">
                <thead><tr><th>Data</th><th>Partner</th><th>Prodotto ID</th><th>Modifica</th></tr></thead><tbody>`;

  (rows || []).forEach(r => {
    const [field, oldValue, newValue, modifiedBy] = r.change_note.split('::');
    html += `<tr>
      <td>${new Date(r.changed_at).toLocaleString()}</td>
      <td>${modifiedBy}</td>
      <td><small>${r.offer_id}</small></td>
      <td><strong>${field}</strong>: ${oldValue} ➔ ${newValue}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
};

function getCountdownText(endDate) {
  const diff = new Date(endDate) - new Date();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  
  if (days < 0) return "Scaduta";
  if (days === 0) return "OGGI";
  if (days === 1) return "Scade domani";
  return `Mancano ${days} gg`;
}

// Forza lo sblocco in caso di ID mancanti
if (typeof state === 'undefined') window.location.reload();

// Funzione per cambiare la modalità di visualizzazione anteprima
window.setPreviewDevice = (mode) => {
  const wrapper = $("#previewSimulationWrapper");
  const btnDesktop = $("#btnPrevDesktop");
  const btnMobile = $("#btnPrevMobile");

  if (mode === 'mobile') {
    wrapper.classList.remove('mode-desktop');
    wrapper.classList.add('mode-mobile');
    btnMobile.classList.add('active');
    btnDesktop.classList.remove('active');
  } else {
    wrapper.classList.remove('mode-mobile');
    wrapper.classList.add('mode-desktop');
    btnDesktop.classList.add('active');
    btnMobile.classList.remove('active');
  }
};

// --- SISTEMA TOAST UNIFICATO ---
const toast = {
  show(message, type = "info", duration = 4000) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;

    const content = document.createElement("div");
    content.className = "toast-content";
    content.textContent = message; // SICURO

    const closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.textContent = "×";
    
    const progress = document.createElement("div");
    progress.className = "toast-progress";
    const progressBar = document.createElement("div");
    progressBar.className = "toast-progress-bar";
    progress.appendChild(progressBar);

    const remove = () => {
      el.classList.add("removing");
      el.addEventListener("animationend", () => el.remove());
    };

    closeBtn.onclick = remove;
    setTimeout(remove, duration);

    el.appendChild(content);
    el.appendChild(closeBtn);
    el.appendChild(progress);
    container.appendChild(el);
  },
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error"); },
  info(msg) { this.show(msg, "info"); }
};

/**
 * Monitora lo stato di tutti gli abbonamenti.
 * Gestisce scadenze e downgrade automatici (Enterprise -> Professional -> Standard -> Starter).
 */
async function checkSubscriptionsExpiry() {
  const partner = getCurrentPartner();
  if (!partner || !partner.subscription) return;

  const sub = partner.subscription;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const TRIAL_DURATION_MS = 30 * MS_PER_DAY;

  // --- GESTIONE TRIAL (controlliamo solo il negozio davvero loggato in questo browser) ---
  if (sub.status === 'trial') {
    const startedAt = Date.parse(sub.startedAt);
    const elapsedMs = Date.now() - startedAt;
    const daysLeft = Math.max(0, 30 - Math.floor(elapsedMs / MS_PER_DAY));

    if (elapsedMs >= TRIAL_DURATION_MS) {
      await supabaseClient.from('stores').update({ subscription_status: 'expired' }).eq('id', partner.id);
      sub.status = 'expired';
      sub.daysLeft = 0;
      await expireStoreOffers(partner.id);
      logAuditAction(partner.id, "TRIAL_EXPIRED", "Periodo di prova di 30 giorni terminato.");
      toast.error("Il tuo periodo di prova gratuito è terminato.");
    } else if (sub.daysLeft !== daysLeft) {
      sub.daysLeft = daysLeft;
    }
    updateLocalSession(partner);
  }

}

/**
 * Utility per aggiornare la sessione partner corrente senza ricaricare
 */
function updateLocalSession(store) {
  sessionStorage.setItem(SESSION_PARTNER, JSON.stringify(store));
  state.currentStore = store;
  if (state.mode === 'store') renderStoreView();
}

/**
 * Genera l'HTML del banner di stato abbonamento per la dashboard partner.
 * Gestisce Trial, Scadenze Enterprise e piani scaduti.
 */
function getSubscriptionBanner() {
  const partner = getCurrentPartner();
  if (!partner || !partner.subscription) return "";

  const sub = partner.subscription;
  const plan = partner.plan || 'Starter';
  const today = new Date();

  // --- 1. STATO: ENTERPRISE IN SCADENZA (<= 7 GIORNI) ---
  if (plan === 'Enterprise' && sub.status === 'active' && sub.renewalDate) {
    const renewalDate = new Date(sub.renewalDate);
    const diffTime = renewalDate - today;
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysLeft <= 7 && daysLeft >= 0) {
      return `
        <div class="upgrade-banner" style="background: #fee2e2; border: 2px solid #ef4444; color: #b91c1c; padding: 15px 20px; border-radius: 12px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; animation: pulse 2s infinite; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);">
          <div style="flex: 1;">
            <strong style="font-size: 1rem; display: flex; align-items: center; gap: 8px;">
              🚨 Attenzione: Scadenza Imminente
            </strong>
            <p style="margin: 5px 0 0 0; font-size: 0.9rem; line-height: 1.4;">
              Il tuo piano <strong>Enterprise</strong> scadrà tra <strong>${daysLeft} ${daysLeft === 1 ? 'giorno' : 'giorni'}</strong>. 
              Rinnova ora per mantenere l'account manager dedicato e la gestione illimitata delle sedi.
            </p>
          </div>
          <button class="btn" style="background: #ef4444; color: white; white-space: nowrap; margin-left: 20px;" 
                  onclick="activatePlan('Enterprise')">
            Rinnova Ora
          </button>
        </div>`;
    }
  }

  // --- 2. STATO: TRIAL SCADUTO (Banner Rosso) ---
  if (sub.status === 'expired') {
    return `
      <div class="upgrade-banner" style="background: #fee2e2; border: 2px solid #ef4444; color: #b91c1c; padding: 25px; border-radius: 16px; margin-bottom: 30px;">
        <div style="display: flex; flex-direction: column; gap: 15px;">
          <p style="margin: 0; font-size: 1rem; line-height: 1.6;">
            <strong>⚠️ Il tuo periodo di prova è terminato.</strong><br>
            Le tue offerte sono state messe in pausa. Attiva un piano per riprendere la pubblicazione.
          </p>
          <button class="btn" style="background: #ef4444; color: white; width: fit-content;" 
                  onclick="storeData.step='pricing'; renderStoreView();">
            Vedi Piani
          </button>
        </div>
      </div>`;
  }

  // --- 3. STATO: TRIAL ATTIVO (Banner Blu) ---
  if (sub.status === 'trial') {
    return `
      <div class="upgrade-banner" style="background: #eff6ff; border: 1px solid #3b82f6; color: #1e40af; padding: 15px 20px; border-radius: 12px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>Trial ${plan.toUpperCase()}: ${sub.daysLeft} giorni rimanenti</strong>
          <small style="display: block; opacity: 0.8;">Sblocca tutte le funzionalità senza limiti.</small>
        </div>
        <button class="btn" style="background: #3b82f6;" onclick="storeData.step='pricing'; renderStoreView();">Passa a Standard</button>
      </div>`;
  }

  return "";
}

/**
 * Simula un modal di pagamento e attiva l'abbonamento Standard.
 */
window.promptUpgradeToStandard = function(partnerId) {
  showConfirm(
    `<h3>Attivazione Piano Standard</h3>
     <p>Stai per attivare il piano Standard a <strong>€49,99/mese</strong>.<br>Il pagamento verrà effettuato con il metodo salvato.</p>
     <small style="color:#64748b">Tutte le tue offerte 'paused' verranno riattivate automaticamente.</small>`, 
    async () => {
      const renewalDate = new Date();
      renewalDate.setMonth(renewalDate.getMonth() + 1);

      const activeSub = {
        plan: 'Standard',
        status: 'active',
        startedAt: new Date().toISOString().split("T")[0],
        renewalDate: renewalDate.toISOString().split("T")[0],
        daysLeft: 9999
      };

      const ok = await updatePartnerSubscription(partnerId, activeSub);
      if (!ok) return toast.error("Errore durante l'attivazione del piano.");

      // Riattiva tutte le offerte messe in pausa dalla scadenza del trial
      await supabaseClient
        .from('offers')
        .update({ status: 'active' })
        .eq('store_id', partnerId)
        .eq('status', 'paused');

      await refreshMyOffers();
      renderOffers();

      toast.success("Abbonamento attivato! Tutte le funzioni sono ora sbloccate. 🚀");
      storeData.activeTab = 'home';
      renderStoreView();
    }
  );
};

/**
 * Attiva un piano di abbonamento reale (non trial) per il partner loggato.
 * Gestisce logicamente i piani Standard, Professional ed Enterprise.
 */
window.activatePlan = async function(planName) {
  const partner = getCurrentPartner();
  if (!partner) return toast.error("Esegui il login come partner per attivare un piano.");

  showConfirm(`Confermi l'attivazione del piano ${planName}?`, async () => {
    const renewalDate = new Date();
    renewalDate.setMonth(renewalDate.getMonth() + 1);

    const updates = {
      plan: planName,
      subscription_status: 'active',
      renewal_date: renewalDate.toISOString().split('T')[0]
    };

    if (planName === 'Professional' && !partner.apiKey) {
      updates.api_key = generateRandomApiKey();
    }

    const { data: storeRow, error } = await supabaseClient
      .from('stores')
      .update(updates)
      .eq('id', partner.id)
      .select()
      .single();

    if (error) {
      console.error("Errore attivazione piano:", error);
      return toast.error("Errore durante l'attivazione del piano.");
    }

    const updatedStore = {
      ...partner,
      plan: storeRow.plan,
      apiKey: storeRow.api_key || partner.apiKey || "",
      subscription: {
        plan: storeRow.plan,
        status: storeRow.subscription_status,
        renewalDate: storeRow.renewal_date
      }
    };
    const dataString = JSON.stringify(updatedStore);
    sessionStorage.setItem(SESSION_PARTNER, dataString);
    localStorage.setItem(PARTNER_AUTH_KEY, dataString);
    state.currentStore = updatedStore;

    toast.success(`Piano ${planName} attivato con successo!`);
    storeData.step = 'dashboard';
    renderStoreView();
  });
};

// --- INTEGRAZIONE NELLE VISTE ---

// 2. Tracciamento OPENS: Inseriscilo all'inizio di openProductDetail
const originalOpenProductDetail = window.openProductDetail;
window.openProductDetail = async (id) => {
  supabaseClient.rpc('increment_offer_stat', { p_offer_id: id, p_field: 'opens' })
    .then(({ error }) => { if (error) console.warn("Errore opens:", error); });

  const { data: row, error } = await supabaseClient
    .from('offers')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !row) {
    toast.error("Prodotto non trovato.");
    return;
  }

  const storesById = await fetchPublicStoresMap([row.store_id]);
  const store = storesById[row.store_id] || {};

  // Stesso formato "appiattito" usato dalla griglia, per compatibilità col modal
  const product = {
    id: row.id,
    product: row.product,
    price: row.price,
    originalPrice: row.original_price,
    category: row.category,
    startDate: row.start_date,
    endDate: row.end_date,
    description: row.description,
    img: row.img_url,
    status: row.status,
    storeName: store.name || "",
    storeCity: store.city || "",
    storeCap: store.cap || "",
    storeAddress: store.address || "",
    plan: store.plan || "Starter"
  };

  displayProductInModal(product);
};

function renderLocationsTab() {
  const partner = getCurrentPartner();
  if (!partner) return '';

  const plan = partner.plan || 'Starter';
  const isProfessional = ['Professional', 'Enterprise'].includes(plan);
  const locations = partner.locations || [];

  return `
    <header class="tab-header">
      <h2>📍 Gestione Punti Vendita</h2>
      ${isProfessional ? 
        `<button class="btn" onclick="openAddLocationModal()">+ Aggiungi Sede</button>` : 
        `<span class="badge-plan plan-starter">Piano Starter: 1 Sede inclusa</span>`
      }
    </header>

    <div class="card-saas">
      <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 20px;">
        Configura gli indirizzi fisici dei tuoi supermercati. I clienti vedranno le offerte in base alla vicinanza a queste sedi.
      </p>

      <div id="locationsContainer" style="display: flex; flex-direction: column; gap: 12px;">
        ${locations.map((loc, index) => `
          <div class="card" style="display: flex; gap: 15px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; align-items: center;">
            <div style="font-size: 1.5rem;">🏠</div>
            <div style="flex: 1;">
              <div style="font-weight: 800; color: #1e293b;">${loc.name}</div>
              <div style="font-size: 0.85rem; color: #64748b;">${loc.address}</div>
            </div>
            ${index === 0 ? 
              `<span style="font-size: 0.7rem; font-weight: 800; color: #10b981; background: #dcfce7; padding: 4px 8px; border-radius: 4px;">PRINCIPALE</span>` : 
              `<button class="btn danger" style="padding: 5px 10px;" onclick="removeLocation(${index})">Rimuovi</button>`
            }
          </div>
        `).join('')}
      </div>

      ${!isProfessional ? `
        <div style="margin-top: 25px; padding: 15px; background: #eff6ff; border-radius: 12px; border: 1px solid #bfdbfe; font-size: 0.85rem; color: #1e40af;">
          🚀 <strong>Vuoi gestire più punti vendita?</strong> Passa al piano Professional per sbloccare la gestione multi-sede e pubblicare offerte per tutte le tue filiali.
        </div>
      ` : ''}
    </div>
  `;
}

window.openAddLocationModal = async () => {
  if (!checkPermission('Professional')) return;

  const name = prompt("Nome della sede (es: Filiale Sud):");
  if (!name) return;
  const addr = prompt("Indirizzo completo (Via, CAP, Città):");
  if (!addr) return;

  const partner = getCurrentPartner();

  const { data: newLoc, error } = await supabaseClient
    .from('store_locations')
    .insert({ store_id: partner.id, name: name.trim(), address: addr.trim() })
    .select()
    .single();

  if (error) {
    console.error("Errore aggiunta sede:", error);
    return toast.error("Errore durante l'aggiunta della sede.");
  }

  partner.locations.push({ id: newLoc.id, name: newLoc.name, address: newLoc.address });
  const dataString = JSON.stringify(partner);
  sessionStorage.setItem(SESSION_PARTNER, dataString);
  localStorage.setItem(PARTNER_AUTH_KEY, dataString);
  state.currentStore = partner;

  toast.success("Sede aggiunta!");
  renderStoreView();
};

window.removeLocation = (index) => {
  showConfirm("Eliminare questa sede? Le offerte collegate potrebbero non essere più accurate.", async () => {
    const partner = getCurrentPartner();
    const loc = partner.locations[index];
    if (!loc || !loc.id) return toast.error("Sede non valida.");

    const { error } = await supabaseClient
      .from('store_locations')
      .delete()
      .eq('id', loc.id);

    if (error) {
      console.error("Errore rimozione sede:", error);
      return toast.error("Errore durante la rimozione della sede.");
    }

    partner.locations.splice(index, 1);
    const dataString = JSON.stringify(partner);
    sessionStorage.setItem(SESSION_PARTNER, dataString);
    localStorage.setItem(PARTNER_AUTH_KEY, dataString);
    state.currentStore = partner;

    toast.success("Sede rimossa.");
    renderStoreView();
  });
};

function renderImportTab() {
  const partner = getCurrentPartner();
  const isProfessional = partner.plan === 'Professional';

  return `
    <header class="tab-header">
      <h2>Importazione Massiva</h2>
      <span class="badge-plan plan-professional">Esclusivo Professional</span>
    </header>

    <div class="stats-view-container" style="position: relative;">
      <div class="card-saas ${!isProfessional ? 'blur-content' : ''}">
        <p style="margin-bottom:15px; color:#64748b;">Incolla qui il tuo listino in formato JSON per caricare decine di offerte in un colpo solo.</p>
        
        <textarea id="jsonImportArea" placeholder='[
  { "nome": "Pasta Barilla 500g", "prezzo": 0.89, "originale": 1.29, "img": "https://...", "cat": "Dispensa" }
 ]' style="width:100%; height:300px; font-family:monospace; font-size:0.85rem; padding:15px; border-radius:12px; border:1px solid #e2e8f0;"></textarea>

        <div style="margin-top:20px;">
          <button class="btn" onclick="handleJSONImport()">Avvia Importazione</button>
          <button class="btn outline" onclick="downloadTemplateJSON()">Scarica Esempio</button>
        </div>
      </div>

      ${!isProfessional ? `
        <div class="lock-overlay">
          <div class="lock-card">
            <div class="lock-icon">⚡</div>
            <h3>Velocizza il tuo lavoro</h3>
            <p>Il piano <strong>Professional</strong> ti permette di importare centinaia di offerte via codice o file senza caricarle una per una.</p>
            <button class="btn" onclick="switchStoreTab('sub')">Passa a Professional</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

window.handleJSONImport = async () => {
  const textArea = $("#jsonImportArea");
  const partner = getCurrentPartner();
  const allowed = await checkRateLimit(partner.id);
  if (!allowed) return;
  
  try {
    const myOffers = getMyOffers();

    // Controllo preventivo lato client (il database lo applica comunque per sicurezza)
    if (partner.plan.toUpperCase() === 'STARTER' && myOffers.length >= 10) {
      toast.error("Limite di 10 offerte raggiunto per il piano Starter.");
      return;
    }

    const data = JSON.parse(textArea.value);
    if (!Array.isArray(data)) throw new Error("Il formato deve essere un array [ ... ]");

    const today = nowISODate();

    const rowsToInsert = data.map(item => ({
      store_id: partner.id,
      product: clean(item.nome),
      price: parseFloat(item.prezzo),
      original_price: parseFloat(item.originale || 0),
      img_url: item.img || "",
      category: item.cat || "Altro",
      start_date: today,
      end_date: item.scadenza || today,
      status: 'active'
    }));

    const { data: inserted, error } = await supabaseClient
      .from('offers')
      .insert(rowsToInsert)
      .select();

    if (error) {
      console.error("Errore importazione JSON:", error);
      return toast.error("Errore durante l'importazione: " + error.message);
    }

    toast.success(`Importazione riuscita! Caricate ${inserted.length} nuove offerte.`);
    textArea.value = "";
    await refreshMyOffers();
    renderOffers();
    switchStoreTab('offers');

  } catch (e) {
    console.error("Errore importazione JSON:", e);
    toast.error("Errore: " + e.message);
  }
};

window.downloadTemplateJSON = () => {
  const template = [
    { "nome": "Prodotto Esempio", "prezzo": 1.99, "originale": 2.50, "img": "https://link-immagine.jpg", "cat": "Dispensa", "scadenza": "2024-12-31" }
  ];
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template_decerne.json';
  a.click();
};

/**
 * TAB: DASHBOARD GENERALE
 * Calcola statistiche aggregate (Views, Click, CTR, Sedi) e disegna il grafico.
*/
function renderGeneralDashboardTab() {
  const partner = getCurrentPartner();
  const myOffers = getMyOffers();
  const locations = partner.locations || [];
  const isEnterprise = partner.plan === 'Enterprise';

  // 1. CALCOLO METRICHE AGGREGATE
  const totalViews = myOffers.reduce((acc, o) => acc + (o.views || 0), 0);
  const totalClicks = myOffers.reduce((acc, o) => acc + (o.opens || 0), 0);
  const avgCtr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(2) : "0.00";
  const activeOffersCount = myOffers.filter(o => o.status === 'active').length;
  const activeLocCount = locations.length || 1;

  // 2. CALCOLO MIGLIOR SEDE (per visualizzazioni)
  let bestLocName = "Dati insufficienti";
  let maxLocViews = -1;

  if (locations.length > 0) {
    locations.forEach((loc, index) => {
      const viewsForThisLoc = myOffers
        .filter(o => o.locationIdx == index)
        .reduce((acc, o) => acc + (o.views || 0), 0);
      
      if (viewsForThisLoc > maxLocViews && viewsForThisLoc > 0) {
        maxLocViews = viewsForThisLoc;
        bestLocName = loc.name;
      }
    });
  }

  // 3. TEMPLATE HTML
  const html = `
    <header class="tab-header">
  <div>
    <h2 style="color: var(--blue-900); margin:0;">📊 Dashboard Generale</h2>
  </div>
  <div style="display: flex; gap: 10px;">
    <!-- EXPORT CSV: Solo Enterprise -->
    ${partner.plan === 'Enterprise' ? `
      <button class="btn outline" onclick="exportOffersToCSV()">📥 Esporta dati CSV</button>
    ` : ''}
    <button class="btn" onclick="handleNewOfferClick()">+ Nuova Offerta</button>
  </div>
</header>

    <!-- GRIGLIA STATISTICHE -->
    <div class="stats-grid-saas">
      <div class="stat-card-saas" style="border-top: 4px solid #3b82f6;">
        <div class="label">Offerte Attive</div>
        <div class="value">${activeOffersCount}</div>
        <small>Su ${myOffers.length} totali</small>
      </div>
      <div class="stat-card-saas" style="border-top: 4px solid #10b981;">
        <div class="label">Visualizzazioni</div>
        <div class="value">${totalViews.toLocaleString()}</div>
        <small>Impressioni totali</small>
      </div>
      <div class="stat-card-saas" style="border-top: 4px solid #f59e0b;">
        <div class="label">Click (Aperture)</div>
        <div class="value">${totalClicks.toLocaleString()}</div>
        <small>Interazioni dirette</small>
      </div>
      <div class="stat-card-saas" style="border-top: 4px solid #6366f1;">
        <div class="label">CTR Medio</div>
        <div class="value">${avgCtr}%</div>
        <small>Efficacia offerte</small>
      </div>
    </div>

    <!-- SEZIONE PERFORMANCE SEDI E GRAFICO -->
    <div style="display: grid; grid-template-columns: 1fr 300px; gap: 20px; margin-top: 20px;">
      
      <!-- CARD ACCOUNT MANAGER (SOLO ENTERPRISE) -->
        ${isEnterprise ? `
          <div class="card-saas" style="border-left: 4px solid #1e40af; background: #f0f7ff; padding: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
              <div style="font-size: 1.8rem;">👤</div>
              <h3 style="margin: 0; color: #1e40af; font-size: 1rem;">Account Manager Dedicato</h3>
            </div>
            <p style="margin: 5px 0; font-size: 0.85rem; color: #1e293b;">
              Email: <strong>enterprise@decerne.it</strong>
            </p>
            <div style="display: inline-block; margin-top: 8px; background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase;">
              ⏱️ SLA: Risposta entro 4 ore
            </div>
          </div>
        ` : ''}

      <!-- BOX GRAFICO -->
      <div class="card-saas" style="padding: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 20px; font-size: 1rem; color: #475569;">Trend Interazioni (Ultimi 7 giorni)</h3>
        <div style="width: 100%; height: 250px;">
          <canvas id="generalStatsCanvas"></canvas>
        </div>
      </div>

      <!-- BOX MIGLIOR SEDE -->
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div class="card-saas" style="border-left: 4px solid #6929c4; background: #fdfaff; flex: 1; display: flex; flex-direction: column; justify-content: center;">
          <div class="label" style="color: #6929c4; font-weight: 700; margin-bottom: 10px;">🏆 MIGLIOR SEDE</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #1e293b;">${bestLocName}</div>
          <small style="color: #64748b; margin-top: 5px;">Sedi totali: ${activeLocCount}</small>
        </div>
        
        <div class="card-saas" style="background: #f1f5f9; flex: 1; display: flex; flex-direction: column; justify-content: center;">
           <div class="label" style="color: #475569; font-weight: 700; margin-bottom: 5px;">CONSIGLIO PRO</div>
           <p style="font-size: 0.75rem; color: #64748b; margin: 0; line-height: 1.4;">
             Le offerte nella sede "${bestLocName}" stanno performando meglio. Considera di replicare la strategia dei prezzi di questa sede anche sulle altre.
           </p>
        </div>
      </div>

    </div>
  `;

  // Renderizziamo il grafico dopo che l'HTML è stato inserito nel DOM
  setTimeout(() => drawGeneralChart(totalClicks), 100);

  return html;
}

/**
 * Disegna un grafico a barre base usando HTML5 Canvas
 */
function drawGeneralChart(totalClicks) {
  const canvas = document.getElementById('generalStatsCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();

  // Setup dimensioni per alta densità (Retina)
  canvas.width = rect.width * dpr;
  canvas.height = 250 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '250px';
  ctx.scale(dpr, dpr);

  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  
  // Genera dati mock basati sul totale reale per visualizzare il grafico
  const avgPerDay = totalClicks / 7;
  const data = days.map(() => Math.floor(avgPerDay * (0.6 + Math.random() * 0.8)));
  const maxVal = Math.max(...data, 10);

  const padding = 40;
  const chartWidth = rect.width - padding * 2;
  const chartHeight = 250 - padding * 2;
  const barSpacing = chartWidth / data.length;
  const barWidth = barSpacing * 0.6;

  // 1. Disegno Linee di Griglia Orizzontali
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartHeight / 4) * i;
    ctx.moveTo(padding, y);
    ctx.lineTo(rect.width - padding, y);
  }
  ctx.stroke();

  // 2. Disegno Barre
  data.forEach((val, i) => {
    const x = padding + (i * barSpacing) + (barSpacing - barWidth) / 2;
    const h = (val / maxVal) * chartHeight;
    const y = 250 - padding - h;

    // Gradiente moderno per la barra
    const grad = ctx.createLinearGradient(0, y, 0, 250 - padding);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#6366f1');

    ctx.fillStyle = grad;
    // Disegna rettangolo con bordi superiori arrotondati
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, [6, 6, 0, 0]);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, barWidth, h);
    }

    // 3. Testo (Giorni e Valori)
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(days[i], x + barWidth / 2, 250 - 15);
    
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(val, x + barWidth / 2, y - 8);
  });
}

/**
 * Genera un file CSV con i dati delle offerte del partner e avvia il download.
 */
window.exportOffersToCSV = () => {
  if (!checkPermission('Enterprise')) return;
  const partner = getCurrentPartner();
  const myOffers = getMyOffers();
  const locations = partner.locations || [];

  if (myOffers.length === 0) {
    return toast.error("Nessun dato da esportare.");
  }

  // 1. Definizione Intestazioni
  const headers = ["Prodotto", "Prezzo (€)", "Sconto %", "Sede", "Visualizzazioni", "Click (Aperture)"];
  
  // 2. Mappatura Righe
  const rows = myOffers.map(o => {
    // Calcolo Percentuale Sconto
    const discPerc = o.originalPrice > o.price 
      ? Math.round(((o.originalPrice - o.price) / o.originalPrice) * 100) 
      : 0;

    // Recupero nome sede
    const locName = locations[o.locationIdx]?.name || "Sede Principale";

    // Pulizia testi (evita che virgole nel nome prodotto rompano il CSV)
    const safeProduct = `"${o.product.replace(/"/g, '""')}"`;
    const safeLoc = `"${locName.replace(/"/g, '""')}"`;

    return [
      safeProduct,
      o.price.toFixed(2),
      discPerc + "%",
      safeLoc,
      o.views || 0,
      o.opens || 0
    ].join(",");
  });

  // 3. Unione Header e Righe
  const csvContent = [headers.join(","), ...rows].join("\n");

  // 4. Creazione Blob e Download
  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `report_decerne_${partner.name.replace(/\s+/g, '_').toLowerCase()}_${timestamp}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("Esportazione completata con successo!");
  } catch (err) {
    console.error("Errore esportazione CSV:", err);
    toast.error("Errore durante la generazione del file.");
  }
};

/**
 * Tab Gestione Team: Permette di aggiungere collaboratori (Admin/Manager).
 * Costruita interamente con metodi DOM sicuri.
 */
function renderTeamTab() {
  const partner = getCurrentPartner();
  if (partner.plan !== 'Enterprise') return renderHomeTab();

  const team = myTeamCache;

  // Contenitore principale
  const wrapper = document.createElement("div");

  // --- HEADER ---
  const header = document.createElement("header");
  header.className = "tab-header";

  const titleGroup = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.style.color = "var(--blue-900)";
  h2.textContent = "👥 Utenti Aziendali"; // Metodo sicuro
  const pDesc = document.createElement("p");
  pDesc.style.fontSize = "0.85rem";
  pDesc.style.color = "#64748b";
  pDesc.textContent = "Gestisci gli accessi dei tuoi collaboratori per questo punto vendita.";
  titleGroup.append(h2, pDesc);

  const badge = document.createElement("span");
  badge.className = "badge-plan plan-enterprise";
  badge.textContent = "Enterprise Only";

  header.append(titleGroup, badge);

  // --- LAYOUT GRID ---
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "1fr 350px";
  grid.style.gap = "30px";
  grid.style.alignItems = "start";

  // --- COLONNA SINISTRA: TABELLA ---
  const listCard = document.createElement("div");
  listCard.className = "card-saas";
  const h3List = document.createElement("h3");
  h3List.style.marginTop = "0";
  h3List.style.fontSize = "1rem";
  h3List.textContent = "Collaboratori Attivi";

  const table = document.createElement("table");
  table.className = "offer-table";
  
  // Header Tabella
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  ["Email", "Ruolo", "Stato", "Azioni"].forEach(txt => {
    const th = document.createElement("th");
    th.textContent = txt;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // Body Tabella
  const tbody = document.createElement("tbody");
  if (team.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.setAttribute("colspan", "4");
    td.style.textAlign = "center";
    td.style.color = "#94a3b8";
    td.textContent = "Nessun collaboratore aggiunto.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    team.forEach((u, idx) => {
      const tr = document.createElement("tr");

      const tdEmail = document.createElement("td");
      const strong = document.createElement("strong");
      strong.textContent = u.email;
      tdEmail.appendChild(strong);

      const tdRole = document.createElement("td");
      const roleSpan = document.createElement("span");
      roleSpan.className = `badge-plan ${u.role === 'Admin' ? 'plan-professional' : 'plan-standard'}`;
      roleSpan.textContent = u.role;
      tdRole.appendChild(roleSpan);

      const tdStatus = document.createElement("td");
      const statusSpan = document.createElement("span");
      statusSpan.style.color = "#10b981";
      statusSpan.textContent = "● Attivo";
      tdStatus.appendChild(statusSpan);

      const tdActions = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.style.padding = "4px 8px";
      delBtn.style.fontSize = "0.75rem";
      delBtn.textContent = "Rimuovi";
      delBtn.onclick = () => removeTeamMember(u.id);
      tdActions.appendChild(delBtn);

      tr.append(tdEmail, tdRole, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  }

  table.append(thead, tbody);
  listCard.append(h3List, table);

  // --- COLONNA DESTRA: FORM ---
  const formCard = document.createElement("div");
  formCard.className = "card-saas";
  formCard.style.background = "#f8fafc";
  const h3Form = document.createElement("h3");
  h3Form.style.marginTop = "0";
  h3Form.style.fontSize = "1rem";
  h3Form.textContent = "Aggiungi Collaboratore";

  const form = document.createElement("form");
  form.id = "addTeamForm";
  form.className = "auth-form";
  form.onsubmit = (e) => addTeamMember(e);

  const groupEmail = document.createElement("div");
  groupEmail.className = "input-group";
  const labelEmail = document.createElement("label");
  labelEmail.textContent = "Email Utente";
  const inputEmail = document.createElement("input");
  inputEmail.type = "email";
  inputEmail.id = "teamEmail";
  inputEmail.placeholder = "es: manager@supermercato.it";
  inputEmail.required = true;
  groupEmail.append(labelEmail, inputEmail);

  const groupRole = document.createElement("div");
  groupRole.className = "input-group";
  const labelRole = document.createElement("label");
  labelRole.textContent = "Ruolo Assegnato";
  const selectRole = document.createElement("select");
  selectRole.id = "teamRole";
  selectRole.style.width = "100%";
  selectRole.style.padding = "10px";
  selectRole.style.borderRadius = "8px";
  selectRole.style.border = "1px solid #ddd";

  const opt1 = document.createElement("option");
  opt1.value = "Manager";
  opt1.textContent = "Manager (Solo Offerte)";
  const opt2 = document.createElement("option");
  opt2.value = "Admin";
  opt2.textContent = "Admin (Accesso Totale)";
  selectRole.append(opt1, opt2);
  groupRole.append(labelRole, selectRole);

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn full-width";
  submitBtn.style.marginTop = "10px";
  submitBtn.textContent = "Invia Invito / Aggiungi";

  form.append(groupEmail, groupRole, submitBtn);

  const note = document.createElement("p");
  note.style.fontSize = "0.75rem";
  note.style.color = "#64748b";
  note.style.marginTop = "15px";
  note.style.lineHeight = "1.4";
  note.textContent = "Nota: Gli utenti aggiunti riceveranno un'email per configurare la propria password d'accesso.";

  formCard.append(h3Form, form, note);

  grid.append(listCard, formCard);
  wrapper.append(header, grid);

  return wrapper; // Restituisce un elemento DOM invece di una stringa
}

/**
 * Aggiunge un nuovo membro al team dello store Enterprise.
 * Include validazione email e gestione errori.
 */
window.addTeamMember = async (e) => {
  e.preventDefault();
  if (!checkPermission('Enterprise')) return;
  const partner = getCurrentPartner();
  if (!partner || partner.plan !== 'Enterprise') return;

  const allowed = await checkRateLimit(partner.id);
  if (!allowed) return;

  const emailInput = document.getElementById("teamEmail");
  const roleSelect = document.getElementById("teamRole");
  if (!emailInput || !roleSelect) return;

  const email = emailInput.value.trim().toLowerCase();
  const role = roleSelect.value;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) return toast.error("L'indirizzo email è obbligatorio.");
  if (!emailRegex.test(email)) {
    return toast.error("Inserisci un indirizzo email nel formato corretto (es: nome@azienda.it).");
  }

  if (myTeamCache.some(u => u.email === email)) {
    return toast.error(`L'utente ${email} fa già parte del tuo team.`);
  }

  const { error } = await supabaseClient
    .from('team_members')
    .insert({ store_id: partner.id, email, role });

  if (error) {
    console.error("Errore aggiunta membro team:", error);
    return toast.error("Si è verificato un errore durante il salvataggio.");
  }

  toast.success(`Collaboratore aggiunto: ${email} (${role})`);
  emailInput.value = "";
  await refreshMyTeam();
};

/**
 * Rimuove un collaboratore.
 */
window.removeTeamMember = (id) => {
  showConfirm("Sei sicuro di voler rimuovere questo collaboratore? Perderà l'accesso immediato.", async () => {
    const { error } = await supabaseClient
      .from('team_members')
      .delete()
      .eq('id', id);

    if (error) {
      console.error("Errore rimozione membro team:", error);
      return toast.error("Errore durante la rimozione.");
    }

    toast.info("Collaboratore rimosso.");
    await refreshMyTeam();
  });
};

/**
 * Tab API: Gestione chiavi e documentazione endpoint.
 * Esclusivo per Professional ed Enterprise.
 */
function renderApiTab() {
  const partner = getCurrentPartner();
  const isEnterprise = partner.plan === 'Enterprise';
  if (!checkPermission('Professional')) {
    setTimeout(() => switchStoreTab('home'), 100);
    return "";
  }
  return `
    <header class="tab-header">
      <div>
        <h2 style="color: var(--blue-900);">🔌 Integrazione API</h2>
        <p style="color: #64748b; font-size: 0.85rem;">Utilizza queste chiavi per collegare i tuoi sistemi interni a Decerne.</p>
      </div>
      <span class="badge-plan ${isEnterprise ? 'plan-enterprise' : 'plan-professional'}">${partner.plan}</span>
    </header>

    <!-- GESTIONE API KEY -->
    <div class="card-saas" style="margin-bottom: 25px;">
      <h3 style="margin-top:0; font-size: 1rem;">La tua API Key</h3>
      <div style="display: flex; gap: 10px; align-items: center; margin-top: 15px;">
        <input type="text" id="apiKeyDisplay" value="${partner.apiKey || 'Genera una chiave...'}" readonly
               style="flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-family: monospace; background: #f8fafc; font-size: 0.9rem;">
        <button class="btn outline" onclick="copyApiKeyToClipboard()">Copia</button>
        <button class="btn" style="background: #ef4444;" onclick="regeneratePartnerApiKey()">Rigenera</button>
      </div>
      <p style="font-size: 0.75rem; color: #94a3b8; margin-top: 12px;">
        <strong>Sicurezza:</strong> Non condividere mai la tua API Key. Se rigeneri la chiave, le integrazioni attuali smetteranno di funzionare immediatamente.
      </p>
    </div>

    <!-- DOCUMENTAZIONE ENDPOINT (Solo Enterprise) -->
    <div class="card-saas">
      <h3 style="margin-top:0; font-size: 1rem;">Documentazione Endpoint</h3>
      
      ${partner.plan === 'Enterprise' ? `
        <!-- VISUALIZZAZIONE COMPLETA: Solo Enterprise -->
        <div style="margin-top: 20px; background: #1e293b; border-radius: 12px; padding: 20px; font-family: 'Courier New', monospace; font-size: 0.85rem;">
          
          <div style="margin-bottom: 20px;">
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
              <span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">GET</span>
              <span style="color: #e2e8f0; font-weight: bold;">/v1/offers</span>
            </div>
            <div style="color: #94a3b8; margin-left: 55px;">Recupera la lista di tutte le tue offerte attive.</div>
          </div>

          <div style="margin-bottom: 20px;">
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
              <span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">POST</span>
              <span style="color: #e2e8f0; font-weight: bold;">/v1/offers</span>
            </div>
            <div style="color: #94a3b8; margin-left: 55px;">Crea una nuova offerta (singola o massiva).</div>
          </div>

          <div style="margin-bottom: 10px;">
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
              <span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">DELETE</span>
              <span style="color: #e2e8f0; font-weight: bold;">/v1/offers/{id}</span>
            </div>
            <div style="color: #94a3b8; margin-left: 55px;">Rimuove definitivamente un'offerta dal sistema.</div>
          </div>
        </div>
      ` : `
        <!-- VISUALIZZAZIONE LIMITATA: Professional o altri piani -->
        <div style="margin-top: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
          
          <!-- L'unico endpoint visibile ai Professional -->
          <div style="margin-bottom: 20px; opacity: 0.8;">
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
              <span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">GET</span>
              <span style="color: #1e293b; font-weight: bold;">/v1/offers</span>
            </div>
            <div style="color: #64748b; font-size: 0.85rem; margin-left: 55px;">Recupera la lista di tutte le tue offerte attive.</div>
          </div>

          <!-- Lock per API avanzate -->
          <div style="text-align: center; padding: 20px; background: #fff; border-radius: 8px; border: 1px dashed #cbd5e1;">
            <div style="font-size: 1.5rem; margin-bottom: 10px;">🔒</div>
            <p style="color: #475569; font-size: 0.85rem; font-weight: 600; margin: 0;">Automazione avanzata (POST/DELETE)</p>
            <p style="color: #64748b; font-size: 0.8rem; margin: 5px 0 15px 0;">Le API di scrittura e cancellazione massiva sono riservate ai partner Enterprise.</p>
            <button class="btn outline" style="font-size: 0.75rem; padding: 6px 12px;" onclick="switchStoreTab('sub')">Upgrade a Enterprise</button>
          </div>
        </div>
      `}
    </div>
  `;
}

/**
 * Rigenera una nuova chiave API per il partner e la salva nel DB Supabase.
 */
window.regeneratePartnerApiKey = async () => {
  if (!confirm("ATTENZIONE: Rigenerando la chiave, le tue integrazioni attuali smetteranno di funzionare finché non aggiornerai il tuo codice. Procedere?")) return;

  const partner = getCurrentPartner();
  if (!partner) return toast.error("Sessione non valida.");

  const newKey = generateRandomApiKey();
  
  // Feedback visivo sul pulsante durante l'attesa di Supabase
  const btn = document.querySelector('button[onclick="regeneratePartnerApiKey()"]');
  const originalText = btn ? btn.innerText : "Rigenera Chiave";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Generazione in corso...";
  }

  try {
    // 1. Aggiornamento atomico sul database Supabase (Corretto con const)
    const { data: updatedStore, error } = await supabaseClient
      .from('stores')
      .update({ api_key: newKey })
      .eq('id', partner.id)
      .select()
      .single();

    if (error) {
      console.error("Errore rigenerazione API Key:", error);
      toast.error("Errore tecnico durante il salvataggio sul database.");
      return;
    }

    // 2. Allineamento dello stato locale (Session & LocalStorage) per riflettere le modifiche
    partner.apiKey = updatedStore.api_key;
    const dataString = JSON.stringify(partner);
    sessionStorage.setItem(SESSION_PARTNER, dataString);
    
    if (typeof state !== 'undefined') {
      state.currentStore = partner;
    }
    
    toast.success("API Key rigenerata e sincronizzata con successo!");
    
    // 3. Ricarica la vista per mostrare istantaneamente il nuovo valore
    renderStoreView();
    
  } catch (err) {
    console.error("Errore inatteso:", err);
    toast.error("Si è verificato un errore imprevisto.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  }
};

/**
 * Copia la chiave negli appunti.
 */
window.copyApiKeyToClipboard = () => {
  const copyText = document.getElementById("apiKeyDisplay");
  copyText.select();
  copyText.setSelectionRange(0, 99999); // Per mobile
  
  navigator.clipboard.writeText(copyText.value);
  toast.info("API Key copiata negli appunti!");
};

// GESTIONE CHIUSURA DRAWER CON TASTO ESC
document.addEventListener('keydown', (e) => {
  try {
    if (e.key === 'Escape') {
      closeDrawer();
      // Opzionale: chiude anche i popup a tutto schermo se aperti
      closeFullPageModal();
    }
  } catch (e) {
    console.error("Errore durante la gestione del tasto Escape:", e);
  }
});

// FUNZIONI GESTIONE CARICAMENTO
window.showLoading = () => {
  try {
    const loader = document.getElementById('globalLoader');
    const app = document.getElementById('app');
    if (loader && app) {
      loader.style.display = 'flex';
      app.classList.add('loading');
    }
  } catch (e) {
    console.error("Errore durante showLoading:", e);
  }
};

window.hideLoading = () => {
  try {
    const loader = document.getElementById('globalLoader');
    const app = document.getElementById('app');
    if (loader && app) {
      loader.style.display = 'none';
      app.classList.remove('loading');
    }
  } catch (e) {
    console.error("Errore durante hideLoading:", e);
  }
};
