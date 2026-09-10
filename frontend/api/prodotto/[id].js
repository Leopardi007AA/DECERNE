const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://noqdpjlbmyjqzlmstfvx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ER6yqBMYCoQ561qXao-sBg_CrEv7BQ6';
const SITE_ORIGIN = 'https://www.decerne.it';
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  const { id } = req.query;
  // Percorso relativo al file stesso (frontend/api/prodotto/[id].js), non a
  // process.cwd() — nel bundle Vercel mantiene la struttura frontend/api/...,
  // quindi process.cwd() punta alla root del repo, non a frontend/.
  const indexPath = path.join(__dirname, '..', '..', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  try {
    const url = `${SUPABASE_URL}/rest/v1/offers?id=eq.${encodeURIComponent(id)}&status=eq.active&deleted_at=is.null&select=product,price,original_price,img_url`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    });
    const rows = await resp.json();
    const offer = Array.isArray(rows) ? rows[0] : null;

    if (offer) {
      const productTitle = `${offer.product} - DECERNE`;
      const priceLabel = offer.original_price > offer.price
        ? `Solo €${offer.price} invece di €${offer.original_price}`
        : `€${offer.price}`;
      const description = `${priceLabel} su DECERNE. Scopri l'offerta e trova il negozio più vicino a te.`;
      const image = offer.img_url || DEFAULT_OG_IMAGE;
      const canonicalUrl = `${SITE_ORIGIN}/prodotto/${id}`;

      html = html
        .replace(/<title>.*?<\/title>/, `<title>${escapeAttr(productTitle)}</title>`)
        .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeAttr(description)}">`)
        .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${escapeAttr(productTitle)}">`)
        .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${escapeAttr(description)}">`)
        .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
        .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${escapeAttr(image)}">`)
        .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${escapeAttr(productTitle)}">`)
        .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${escapeAttr(description)}">`)
        .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${escapeAttr(image)}">`);
    }
  } catch (e) {
    console.error('Errore generazione OG prodotto:', e);
    // in caso di errore serviamo comunque index.html "normale", niente di rotto
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(html);
};