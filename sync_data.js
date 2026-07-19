// sync_data.js
// Sync veloce: legge solo Notion ed esporta data.json per il frontend
const fs   = require('fs');
const path = require('path');

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_DB_ID;
const N_BASE = 'https://api.notion.com/v1';
const N_HDR  = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

async function notion(method, path, body) {
  const r = await fetch(`${N_BASE}${path}`, {
    method, headers: N_HDR,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${json.message}`);
  return json;
}

async function findDB() {
  const r = await notion('GET', `/blocks/${NOTION_PAGE_ID}/children`);
  for (const b of r.results || []) {
    if (b.type === 'child_database') return b.id.replace(/-/g,'');
  }
  throw new Error('Database not found in Notion page');
}

async function main() {
  const DB_ID = await findDB();
  console.log(`Sync from DB: ${DB_ID}`);

  const allRows = [];
  let cursor = undefined;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const r = await notion('POST', `/databases/${DB_ID}/query`, body);
    allRows.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);

  const items = allRows.map(p => {
    const props = p.properties || {};
    const t = (key, type) => {
      const v = props[key];
      if (!v) return null;
      if (type === 'title')      return v.title?.[0]?.plain_text || null;
      if (type === 'rich_text')  return v.rich_text?.map(x => x.plain_text).join('') || null;
      if (type === 'number')     return v.number;
      if (type === 'select')     return v.select?.name || null;
      if (type === 'date')       return v.date?.start || null;
      if (type === 'url')        return v.url || null;
      if (type === 'checkbox')   return !!v.checkbox;
      return null;
    };
    return {
      id:           p.id,
      title:        t('Name','title'),
      director:     t('Regista','rich_text'),
      year:         t('Anno','number'),
      category:     t('Categoria','select'),
      tipo:         t('Tipo','select'),
      platform:     t('Piattaforma','rich_text'),
      releaseDate:  t('Data uscita','date'),
      originalYear: t('Anno originale','number'),
      synIT:        t('Sinossi IT','rich_text'),
      synEN:        t('Sinossi EN','rich_text'),
      poster:       t('URL Locandina','url'),
      rilevanza:    t('Rilevanza','number'),
      verificato:   t('Verificato','checkbox'),
      approvato:    t('Approvato','checkbox'),
      pubblicato:   t('Pubblicato','checkbox'),
      scartato:     t('Scartato','checkbox')
    };
  });

  items.sort((a,b) => (b.releaseDate||'').localeCompare(a.releaseDate||''));

  // scarto = esclusione alla fonte: la voce non entra in data.json, quindi sparisce da
  // bulletin, archivio, bulk e social in un colpo solo. Filtrato PRIMA del dedup così un
  // eventuale duplicato non-scartato sopravvive.
  const live = items.filter(i => !i.scartato);

  const dedupeItems = require('./dedupe.js');
  const before = live.length;
  const deduped = dedupeItems(live);
  if (deduped.length < before) console.log(`Dedup: rimossi ${before - deduped.length} duplicati`);

  const now = new Date();
  const tM  = now.getMonth() + 1;
  const tY  = now.getFullYear();
  const monthIT = new Date(tY, tM-1).toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase();

  const data = {
    updatedAt:   new Date().toISOString(),
    targetMonth: monthIT,
    total:       deduped.length,
    items:       deduped
  };

  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'data.json'), JSON.stringify(data, null, 2));

  console.log(`Synced ${deduped.length} items to docs/data.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
