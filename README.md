# DECERNE

Piattaforma per pubblicare e trovare le offerte e i prodotti dei supermercati italiani.

## Struttura
- `frontend/` — sito statico (HTML, CSS e JavaScript senza framework). `js/main.js` è l'app, `js/handlers.js` collega gli eventi dei pulsanti (la CSP vieta gli `onclick` inline), `api/` contiene le funzioni serverless di Vercel per le anteprime social.
- Supabase — database con RLS, autenticazione ed Edge Function (progetto `DECERNE`).
- Hosting — Vercel (progetto `decerne`).

## Regole da rispettare quando si modifica il codice
- **Niente handler inline**: usa `data-onclick="nomeFunzione('arg')"` (solo chiamate a funzioni globali con argomenti semplici) oppure `addEventListener`. La CI blocca `onclick="..."`.
- **Ogni valore dinamico in `innerHTML` passa da `esc()`**; per gli URL immagine usa `getSafeImageUrl()`.
- Nessuna chiave segreta nel repository: nel browser va solo la chiave *publishable* di Supabase. `service_role`, Brevo e simili vivono solo come segreti delle Edge Function.
- Le librerie esterne si caricano da versioni esatte (mai `@2` o `latest`) e vanno aggiunte anche a `package.json`.

## Controlli automatici
La CI (`.github/workflows/ci.yml`) controlla sintassi JavaScript, validità di `vercel.json`, assenza di handler inline e vulnerabilità delle dipendenze (`npm audit`). Dependabot propone gli aggiornamenti ogni settimana.

## Sicurezza
Per segnalare un problema di sicurezza scrivi a contact.decerne@gmail.com (vedi `frontend/.well-known/security.txt`).