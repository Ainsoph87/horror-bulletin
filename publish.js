// publish.js — predisposizione autoposting. Gira in GitHub Actions (vedi publish.yml).
// Ogni adapter si attiva compilando i secrets: finché mancano, il social viene saltato.
// Guida di attivazione per ciascun social: README §Autoposting.
const F = require('./docs/formatters.js');
const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const N_HDR = { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

// ponytail: adapter non implementati finché non si decide di attivare un social —
// la struttura (env → publish(text, item)) è il punto d'innesto, anche per API commerciali future.
const ADAPTERS = {
  x:         { env: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
               publish: async () => { throw new Error('adapter X non implementato — vedi README §Autoposting'); } },
  facebook:  { env: ['META_PAGE_TOKEN', 'FB_PAGE_ID'],
               publish: async () => { throw new Error('adapter Facebook non implementato — vedi README §Autoposting'); } },
  instagram: { env: ['META_PAGE_TOKEN', 'IG_USER_ID'],
               publish: async () => { throw new Error('adapter Instagram non implementato — vedi README §Autoposting'); } },
  threads:   { env: ['THREADS_TOKEN', 'THREADS_USER_ID'],
               publish: async () => { throw new Error('adapter Threads non implementato — vedi README §Autoposting'); } }
  // tiktok: escluso — Content Posting API richiede audit; flusso manuale via pagina Social
};

async function flagPublished(pageId) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: N_HDR,
    body: JSON.stringify({ properties: { 'Pubblicato': { checkbox: true } } })
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync('docs/data.json', 'utf8'));
  const queue = data.items.filter(i => !i.scartato && !i.pubblicato);
  console.log(`In coda: ${queue.length} voci non scartate e non pubblicate`);

  const active = Object.entries(ADAPTERS).filter(([id, a]) => {
    const missing = a.env.filter(k => !process.env[k]);
    if (missing.length) { console.log(`- ${id}: SKIP (secrets mancanti: ${missing.join(', ')})`); return false; }
    return true;
  });
  if (!active.length) { console.log('Nessun adapter configurato. Compila i secrets in publish.yml per attivare.'); return; }

  let okCount = 0, failCount = 0;
  for (const item of queue) {
    let allOk = true;
    for (const [id, a] of active) {
      try { await a.publish(F.format(id, item), item); console.log(`✓ ${id}: ${item.title}`); }
      catch (e) { console.error(`✗ ${id}: ${item.title} — ${e.message}`); allOk = false; }
    }
    if (allOk && active.length) { await flagPublished(item.id); okCount++; } else failCount++;
  }
  console.log(`Pubblicati: ${okCount}, falliti: ${failCount}`);
  if (okCount === 0 && failCount > 0) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
