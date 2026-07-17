// worker.js — API sicura per approvare le voci da sito senza esporre il token Notion.
// Deploy: sovrascrive il worker esistente "horror-bulletin-api" (stesso URL usato dal frontend).
// Secrets richiesti (wrangler secret put / dashboard): NOTION_TOKEN, API_KEY
const ALLOWED_ORIGINS = ['https://ainsoph87.github.io', 'http://localhost:8787'];

const PROPS = { approvato: 'Approvato', pubblicato: 'Pubblicato', verificato: 'Verificato' };

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Content-Type': 'application/json'
  };
}

export default {
  async fetch(req, env) {
    const headers = cors(req.headers.get('Origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    if (req.headers.get('X-Api-Key') !== env.API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/update') {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    }

    let body;
    try { body = await req.json(); } catch { body = null; }
    if (!body || !body.id || !body.props || typeof body.props !== 'object') {
      return new Response(JSON.stringify({ error: 'Bad request: {id, props:{approvato|pubblicato|verificato: bool}}' }), { status: 400, headers });
    }

    const properties = {};
    for (const [k, v] of Object.entries(body.props)) {
      if (PROPS[k] && typeof v === 'boolean') properties[PROPS[k]] = { checkbox: v };
    }
    if (!Object.keys(properties).length) {
      return new Response(JSON.stringify({ error: 'Nessuna proprietà valida' }), { status: 400, headers });
    }

    const r = await fetch(`https://api.notion.com/v1/pages/${body.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: `Notion ${r.status}: ${err.message || ''}` }), { status: 502, headers });
    }
    return new Response(JSON.stringify({ ok: true }), { headers });
  }
};
