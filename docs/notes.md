# Note tecniche e di sicurezza — DECERNE

## Architettura
- Frontend statico su Vercel (`frontend/`), funzioni `api/` per le pagine prodotto e il proxy immagini.
- Backend: Supabase (Postgres con RLS, Edge Functions, pg_cron). Email: Brevo.

## Regole di sicurezza da mantenere
- Nessun handler inline (`onclick="..."`): si usano `data-onclick` ecc. gestiti da `js/handlers.js` (la CSP vieta `unsafe-inline` sugli script).
- Ogni dato proveniente dal database o dall'utente va inserito in HTML con `esc()`; gli URL con `getSafeImageUrl()` / `getSafeLinkUrl()`.
- Piano, stato abbonamento, rinnovo e chiave API NON si scrivono dal browser: i trigger su `stores` li forzano/proteggono; si cambiano solo con le funzioni RPC dedicate o con la service role.
- Nessuna chiave segreta nel repository: solo la chiave pubblica (publishable) di Supabase. Segreti in Vault / variabili d'ambiente.
- Ogni nuova funzione SECURITY DEFINER: `revoke execute ... from public, anon, authenticated` e poi `grant` solo a chi serve.
- Ogni nuova tabella: RLS attiva + policy esplicite.

## Prima del lancio a pagamento
- Sostituire `activate_store_subscription`, `switch_own_store_to_annual` e `set_own_store_trial_or_expired` con attivazione tramite webhook del provider di pagamento (service role).

## Controlli periodici
- Supabase → Advisors (security) dopo ogni migrazione.
- GitHub → tab Security (Dependabot, secret scanning) e Actions (CI verde).
- Rinnovare `security.txt` prima della scadenza (campo Expires).
