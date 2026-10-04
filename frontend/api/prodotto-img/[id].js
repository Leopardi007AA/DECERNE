const https = require('https');
const net = require('net');
const dns = require('dns').promises;

const SUPABASE_URL = 'https://noqdpjlbmyjqzlmstfvx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ER6yqBMYCoQ561qXao-sBg_CrEv7BQ6';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Indirizzi che non devono mai essere raggiunti da questo server (rete interna, loopback, ecc.)
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if ((a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 192 && b === 0) || (a === 203 && b === 0)) return true;
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    v.startsWith('64:ff9b:') || v.startsWith('2002:') || v.startsWith('2001:db8') || v.startsWith('fec') || v.startsWith('fed') || v.startsWith('fee') || v.startsWith('fef') ||
      v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') ||
      v.startsWith('::ffff:');
  }
  return true;
}

// Risoluzione DNS controllata nel momento esatto della connessione
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }).then((addrs) => {
    const ok = addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length || ok.length !== addrs.length) return callback(new Error('indirizzo non consentito'));
    if (options && options.all) return callback(null, ok);
    return callback(null, ok[0].address, ok[0].family);
  }, (err) => callback(err));
}

function downloadImage(urlStr, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('url non valido')); }
    if (u.protocol !== 'https:') return reject(new Error('solo https'));
    if (net.isIP(u.hostname) || u.hostname === 'localhost') return reject(new Error('host non consentito'));

    const req = https.request({
      method: 'GET',
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      lookup: safeLookup,
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DecerneImageProxy/1.0)',
        'Accept': 'image/jpeg,image/png,image/webp,image/gif'
      }
    }, (resp) => {
      const status = resp.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && resp.headers.location) {
        resp.resume();
        if (redirectsLeft <= 0) return reject(new Error('troppi reindirizzamenti'));
        let next;
        try { next = new URL(resp.headers.location, u).href; } catch (e) { return reject(new Error('redirect non valido')); }
        return resolve(downloadImage(next, redirectsLeft - 1));
      }

      if (status !== 200) { resp.resume(); return reject(new Error('stato ' + status)); }

      const type = String(resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.includes(type)) { resp.resume(); return reject(new Error('tipo non consentito')); }

      const declared = Number(resp.headers['content-length'] || 0);
      if (declared > MAX_BYTES) { resp.resume(); return reject(new Error('immagine troppo grande')); }

      const chunks = [];
      let total = 0;
      resp.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) { req.destroy(new Error('immagine troppo grande')); return; }
        chunks.push(chunk);
      });
      resp.on('end', () => resolve({ type, body: Buffer.concat(chunks) }));
      resp.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  const rawId = req.query.id;
  const id = typeof rawId === 'string' && UUID_RE.test(rawId) ? rawId : null;
  if (!id) return res.status(404).end();

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/offers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=img_url`,
      { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` } }
    );
    const rows = await resp.json();
    const imgUrl = Array.isArray(rows) && rows[0] ? rows[0].img_url : null;
    if (!imgUrl || typeof imgUrl !== 'string') return res.status(404).end();

    const { type, body } = await downloadImage(imgUrl, MAX_REDIRECTS);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(200).send(body);
  } catch (e) {
    console.error('Errore immagine prodotto:', e && e.message);
    res.status(404).end();
  }
};