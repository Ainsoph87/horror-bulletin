// cleanup_lag.js — sanatoria una tantum: rimuove le voci Cinema "Nuova uscita" con anno
// originale precedente all'anno di uscita (≥7 mesi di distribution lag: film vecchi ripescati
// da release regionali in ritardo — es. Bring Her Back, Good Boy, Strange Harvest a luglio 2026).
// Le voci già Pubblicate non si toccano. Le nuove sono protette dalle guardie in fetch_horror.js.
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

async function main() {
  const children = await notion('GET', `/blocks/${NOTION_PAGE_ID}/children`);
  const dbId = children.results.find(b => b.type === 'child_database')?.id.replace(/-/g, '');
  if (!dbId) throw new Error('Database not found');

  const rows = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const r = await notion('POST', `/databases/${dbId}/query`, body);
    rows.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);

  let removed = 0, keptPublished = 0;
  for (const p of rows) {
    const props = p.properties;
    const cat  = props['Categoria']?.select?.name;
    const tipo = props['Tipo']?.select?.name;
    const anno = props['Anno']?.number;
    const orig = props['Anno originale']?.number;
    const pub  = props['Pubblicato']?.checkbox;
    const title = props['Name']?.title?.[0]?.plain_text || '?';

    if (cat === 'Cinema' && tipo === 'Nuova uscita' && anno != null && orig != null && orig < anno) {
      if (pub) { keptPublished++; console.log(`KEEP (pubblicato): ${title} (${orig}→${anno})`); continue; }
      await notion('PATCH', `/pages/${p.id}`, { archived: true });
      removed++;
      console.log(`REMOVED: ${title} (${orig}→${anno})`);
      await sleep(250);
    }
  }
  console.log(`\nCleanup: ${removed} rimosse, ${keptPublished} tenute perché già pubblicate, su ${rows.length} totali`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
