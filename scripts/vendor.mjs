// Copia in frontend/vendor i file delle librerie usate dal sito, nelle versioni esatte di package-lock.json.
// Si lancia con: npm run vendor (dopo npm ci o npm install). Va rilanciato ogni volta che una libreria cambia versione.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const nm = 'node_modules';
const out = 'frontend/vendor';

const files = [
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js'],
  ['papaparse/papaparse.min.js', 'papaparse.min.js'],
  ['leaflet/dist/leaflet.js', 'leaflet/leaflet.js'],
  ['leaflet/dist/leaflet.css', 'leaflet/leaflet.css'],
  ['react/umd/react.production.min.js', 'react.production.min.js'],
  ['react-dom/umd/react-dom.production.min.js', 'react-dom.production.min.js']
];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of files) {
  mkdirSync(dirname(`${out}/${to}`), { recursive: true });
  cpSync(`${nm}/${from}`, `${out}/${to}`);
}
cpSync(`${nm}/leaflet/dist/images`, `${out}/leaflet/images`, { recursive: true });

// Fine riga sempre LF: alcuni file npm usano CRLF e Git su Windows li converte,
// quindi senza questo passaggio il controllo "vendor = lockfile" della CI fallirebbe.
for (const [, to] of files) {
  const p = `${out}/${to}`;
  const text = readFileSync(p, 'utf8');
  if (text.includes('\r\n')) writeFileSync(p, text.replace(/\r\n/g, '\n'));
}
console.log('Librerie copiate in ' + out);