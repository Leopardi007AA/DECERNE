const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://noqdpjlbmyjqzlmstfvx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ER6yqBMYCoQ561qXao-sBg_CrEv7BQ6';
const SITE_ORIGIN = 'https://www.decerne.it';
// Domini da cui questa pagina può essere servita. Finché www.decerne.it non è collegato
// al progetto, i link condivisi usano il dominio vercel.app da cui arriva la richiesta.
const ALLOWED_HOSTS = ['www.decerne.it', 'decerne.it', 'decerne.vercel.app'];

function getOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  return ALLOWED_HOSTS.includes(host) ? `https://${host}` : SITE_ORIGIN;
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  // Se il parametro è ripetuto nell'URL, req.query.id arriva come array: lo scartiamo.
  // Un id che non è un UUID valido non deve mai raggiungere la query a Supabase.
  const rawId = req.query.id;
  const id = typeof rawId === 'string' && UUID_RE.test(rawId) ? rawId : null;
  // Percorso relativo al file stesso (frontend/api/prodotto/[id].js), non a
  // process.cwd() — nel bundle Vercel mantiene la struttura frontend/api/...,
  // quindi process.cwd() punta alla root del repo, non a frontend/.
  const indexPath = path.join(__dirname, '..', '..', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  try {
    if (!id) throw new Error('id non valido, salto la ricerca offerta');
    const url = `${SUPABASE_URL}/rest/v1/offers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=product,price,original_price,img_url,status,end_date`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    });
    const rows = await resp.json();
    const offer = Array.isArray(rows) ? rows[0] : null;

    if (offer) {
      const todayStr = new Date().toISOString().split('T')[0];
      const isExpired = offer.status !== 'active' || (offer.end_date && offer.end_date < todayStr);

      const productTitle = isExpired
        ? `${offer.product} - Offerta scaduta - DECERNE`
        : `${offer.product} - DECERNE`;
      const priceLabel = offer.original_price > offer.price
        ? `Solo €${offer.price} invece di €${offer.original_price}`
        : `€${offer.price}`;
      const description = isExpired
        ? `Questa offerta su DECERNE non è più disponibile. Scopri le altre offerte vicino a te.`
        : `${priceLabel} su DECERNE. Scopri l'offerta e trova il negozio più vicino a te.`;
      // I crawler dei social non renderizzano un data: URI come og:image: se il
      // negozio non ha caricato una foto reale, img_url è il placeholder SVG
      // interno, quindi in quel caso usiamo l'immagine di default del sito.
      const origin = getOrigin(req);
      // La foto del prodotto passa da /api/prodotto-img: così i social la leggono dal nostro
      // dominio anche se il sito del negozio blocca i link diretti.
      const hasProductImage = !!offer.img_url && offer.img_url.startsWith('https://');
      const image = hasProductImage ? `${origin}/api/prodotto-img/${id}` : `${origin}/og-image.png`;
      const canonicalUrl = `${origin}/prodotto/${id}`;

      html = html
      .replace(/<title>.*?<\/title>/, () => `<title>${escapeAttr(productTitle)}</title>`)
        .replace(/<meta name="description" content=".*?">/, () => `<meta name="description" content="${escapeAttr(description)}">`)
        .replace(/<meta property="og:title" content=".*?">/, () => `<meta property="og:title" content="${escapeAttr(productTitle)}">`)
        .replace(/<meta property="og:description" content=".*?">/, () => `<meta property="og:description" content="${escapeAttr(description)}">`)
        .replace(/<meta property="og:url" content=".*?">/, () => `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
        .replace(/<meta property="og:image" content=".*?">/, () => `<meta property="og:image" content="${escapeAttr(image)}">`)
        .replace(/<meta name="twitter:title" content=".*?">/, () => `<meta name="twitter:title" content="${escapeAttr(productTitle)}">`)
        .replace(/<meta name="twitter:description" content=".*?">/, () => `<meta name="twitter:description" content="${escapeAttr(description)}">`)
        .replace(/<meta name="twitter:image" content=".*?">/, () => `<meta name="twitter:image" content="${escapeAttr(image)}">`);

      // 1200x630 vale solo per l'immagine di default del sito: con la foto del prodotto le
      // dimensioni sono diverse, e dichiararle sbagliate fa scartare l'immagine a qualche social
      if (hasProductImage) {
        html = html
          .replace(/<meta property="og:image:width" content=".*?">\s*/, '')
          .replace(/<meta property="og:image:height" content=".*?">\s*/, '');
      }
    }
  } catch (e) {
    console.error('Errore generazione OG prodotto:', e);
    // in caso di errore serviamo comunque index.html "normale", niente di rotto
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(html);
};