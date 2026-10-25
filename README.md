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

## Mappa e percorsi (MapMap)
Percorsi, indirizzi e ordine delle tappe passano da Edge Function pubbliche (`verify_jwt = false`, con limite per IP). Il browser non vede mai le chiavi.

- `route`: percorso con le manovre. Usa MapMap (`/route/v1`, formato OSRM); se non risponde passa al server demo `router.project-osrm.org`. In navigazione il ricalcolo parte ogni 20 secondi, circa 90 chiamate ogni mezz'ora di guida.
- `reverse-geocode`: da coordinate a via, città e CAP. Prova MapMap (reverse, più `/geocode` per il CAP), poi Photon, poi Nominatim, che di solito risponde 403 agli IP dei server cloud.
- `optimise-route`: ordine delle tappe sui tempi di guida (`/optimise`, una richiesta vale 10 chiamate). Si usa solo con almeno 3 tappe e fuori dal tour guidato; se non risponde il sito usa `computeVisitOrder`, in linea d'aria. Con l'ordine di MapMap il ricalcolo in viaggio non rimescola le tappe.

Secret delle Edge Function (dashboard Supabase, Edge Functions, Secrets):
- `OSRM_BASE_URL`: `https://api.mapmap.ai`
- `OSRM_API_KEY`: chiave MapMap usata da `route`
- `MAPMAP_API_KEY`: chiave MapMap usata da `reverse-geocode` e `optimise-route`

La chiave si emette con `POST https://api.mapmap.ai/v1/keys` e va verificata col link ricevuto per email: finché è provvisoria scade dopo pochi giorni e tutto passa ai ripieghi. Quando la cambi vanno aggiornati entrambi i secret. Il piano gratuito dà 50.000 chiamate al mese; finite, MapMap risponde 429 e subentrano i ripieghi, senza addebiti se non hai comprato credito. Se qualcosa non va, cerca nei log delle funzioni le righe "MapMap non ok", "Routing principale non ok" e "MapMap optimise non ok".

## Sicurezza
Per segnalare un problema di sicurezza scrivi a contact.decerne@gmail.com (vedi `frontend/.well-known/security.txt`).