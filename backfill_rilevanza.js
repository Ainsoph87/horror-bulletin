// backfill_rilevanza.js — una tantum: calcola la Rilevanza per le voci esistenti su Notion.
// Idempotente: salta le voci che hanno già un valore. Gira in GitHub Actions (backfill.yml).
const { movieScore, showScore } = require('./rilevanza.js');

const TMDB_KEY       = process.env.TMDB_API_KEY;
const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_DB_ID;
const N_HDR = { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notion(method, path, body) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    method, headers: N_HDR, body: body ? JSON.stringify(body) : undefined
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${json.message}`);
  return json;
}

async function findDB() {
  const r = await notion('GET', `/blocks/${NOTION_PAGE_ID}/children`);
  for (const b of r.results || []) if (b.type === 'child_database') return b.id.replace(/-/g, '');
  throw new Error('Database not found');
}

async function ensureProperty(dbId) {
  const db = await notion('GET', `/databases/${dbId}`);
  if (db.properties['Rilevanza']) return;
  await notion('PATCH', `/databases/${dbId}`, { properties: { 'Rilevanza': { number: { format: 'number' } } } });
  console.log('Proprietà Rilevanza creata sul DB');
}

async function tmdbSearchMovie(title, year) {
  const q = encodeURIComponent(title);
  const r = await fetch(`https://api.themoviedb.org/3/search/movie?query=${q}${year ? `&year=${year}` : ''}&api_key=${TMDB_KEY}`);
  if (!r.ok) return null;
  const json = await r.json();
  return json.results?.[0] || null;
}

async function tvmazeSearch(title) {
  const r = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
  if (!r.ok) return null;
  return r.json();
}

async function main() {
  const dbId = await findDB();
  await ensureProperty(dbId);

  const rows = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const r = await notion('POST', `/databases/${dbId}/query`, body);
    rows.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);

  let done = 0, skipped = 0, missed = 0;
  for (const p of rows) {
    const props = p.properties;
    if (props['Rilevanza']?.number != null) { skipped++; continue; }
    const title = props['Name']?.title?.[0]?.plain_text;
    const category = props['Categoria']?.select?.name;
    const year = props['Anno originale']?.number || props['Anno']?.number;
    if (!title) { missed++; continue; }

    let score = 0;
    try {
      if (category === 'Serie TV') {
        const show = await tvmazeSearch(title);
        score = show ? showScore(show) : 0;
      } else {
        const m = await tmdbSearchMovie(title, year);
        score = m ? movieScore(m) : 0;
      }
    } catch (e) { console.error(`  lookup fail "${title}": ${e.message}`); }

    if (score === 0) missed++;
    await notion('PATCH', `/pages/${p.id}`, { properties: { 'Rilevanza': { number: score } } });
    done++;
    console.log(`${done}. ${title} [${category}] → ${score}`);
    await sleep(300);
  }
  console.log(`\nBackfill: ${done} aggiornate, ${skipped} già valorizzate, ${missed} senza match (score 0)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
