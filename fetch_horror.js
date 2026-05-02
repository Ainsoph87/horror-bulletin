// fetch_horror.js — v6
// Uscite horror internazionali: Cinema, VOD, Home Video, Streaming, Serie TV
const TMDB_KEY       = process.env.TMDB_API_KEY;
const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_DB_ID;
const TG_TOKEN       = process.env.TELEGRAM_TOKEN;
const TG_CHAT        = process.env.TELEGRAM_CHAT_ID;
const DISCORD_URL    = process.env.DISCORD_WEBHOOK;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';
const N_BASE    = 'https://api.notion.com/v1';
const N_HDR     = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

const now   = new Date();
const tM    = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
const tY    = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
const pad   = n => String(n).padStart(2,'0');
const dFrom = `${tY}-${pad(tM)}-01`;
const dTo   = `${tY}-${pad(tM)}-${new Date(tY, tM, 0).getDate()}`;
const MONTH_IT = new Date(tY, tM-1).toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase();

console.log(`Target: ${MONTH_IT} | ${dFrom} → ${dTo}`);

let DB_ID = null;

// Caratteri non latini — esclude titoli illeggibili per pubblico occidentale
const NON_LATIN = /[\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0900-\u097F\uF900-\uFAFF\u0400-\u04FF]/;
const isReadable = t => t && !NON_LATIN.test(t);

function bestTitle(det, detEN) {
  const orig = det.title || det.name || '';
  if (isReadable(orig)) return orig;
  const en = detEN?.title || detEN?.name || '';
  if (isReadable(en)) return en;
  // Prova titolo inglese dalle translations
  const trans = det.translations?.translations?.find(t => t.iso_639_1 === 'en');
  const tEN = trans?.data?.title || trans?.data?.name || '';
  if (isReadable(tEN)) return tEN;
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tmdb(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

async function tmdbAll(path) {
  // Recupera tutte le pagine di risultati
  const sep = path.includes('?') ? '&' : '?';
  const first = await (await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&page=1`)).json();
  const pages = Math.min(first.total_pages || 1, 5); // max 5 pagine
  let results = [...(first.results || [])];
  for (let p = 2; p <= pages; p++) {
    const r = await (await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&page=${p}`)).json();
    results = [...results, ...(r.results || [])];
    await sleep(250);
  }
  return results;
}

async function notion(method, path, body) {
  const r = await fetch(`${N_BASE}${path}`, {
    method, headers: N_HDR,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${json.message}`);
  return json;
}

async function findExistingDB() {
  const r = await notion('GET', `/blocks/${NOTION_PAGE_ID}/children`);
  for (const b of r.results || []) {
    if (b.type === 'child_database') { console.log(`Found DB: ${b.id}`); return b.id.replace(/-/g,''); }
  }
  return null;
}

async function createDB() {
  console.log('Creating Notion database...');
  const r = await notion('POST', '/databases', {
    parent: { type: 'page_id', page_id: NOTION_PAGE_ID },
    title: [{ type: 'text', text: { content: 'Horror Bulletin DB' } }],
    properties: {
      'Name':          { title: {} },
      'Regista':       { rich_text: {} },
      'Anno':          { number: { format: 'number' } },
      'Categoria':     { select: { options: [
        { name: 'Cinema',     color: 'red'    },
        { name: 'Streaming',  color: 'blue'   },
        { name: 'VOD',        color: 'purple' },
        { name: 'Home Video', color: 'yellow' },
        { name: 'Serie TV',   color: 'green'  }
      ]}},
      'Piattaforma':   { rich_text: {} },
      'Data uscita':   { date: {} },
      'Sinossi IT':    { rich_text: {} },
      'Sinossi EN':    { rich_text: {} },
      'URL Locandina': { url: {} },
      'Verificato':    { checkbox: {} },
      'Approvato':     { checkbox: {} },
      'Pubblicato':    { checkbox: {} }
    }
  });
  console.log(`DB created: ${r.id}`);
  return r.id.replace(/-/g,'');
}

async function exists(title) {
  const r = await notion('POST', `/databases/${DB_ID}/query`, {
    filter: { property: 'Name', title: { equals: title } }
  });
  return r.results.length > 0;
}

async function save(e) {
  const props = {
    'Name':        { title:     [{ text: { content: e.title } }] },
    'Regista':     { rich_text: [{ text: { content: e.director } }] },
    'Anno':        { number:    e.year },
    'Categoria':   { select:    { name: e.category } },
    'Piattaforma': { rich_text: [{ text: { content: e.platform } }] },
    'Verificato':  { checkbox:  false },
    'Approvato':   { checkbox:  false },
    'Pubblicato':  { checkbox:  false }
  };
  if (e.releaseDate) props['Data uscita']   = { date:      { start: e.releaseDate } };
  if (e.synIT)       props['Sinossi IT']    = { rich_text: [{ text: { content: e.synIT.slice(0,2000) } }] };
  if (e.synEN)       props['Sinossi EN']    = { rich_text: [{ text: { content: e.synEN.slice(0,2000) } }] };
  if (e.poster)      props['URL Locandina'] = { url: e.poster };

  return notion('POST', '/pages', {
    parent: { database_id: DB_ID },
    properties: props,
    children: [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `TMDB ID: ${e.tmdbId} | Tipo: ${e.releaseType}` } }] }
    }]
  });
}

// Mappa release_type TMDB → categoria
function releaseTypeToCategory(rt) {
  if (rt === 3 || rt === 2 || rt === 1) return 'Cinema';
  if (rt === 4)                          return 'VOD';
  if (rt === 5)                          return 'Home Video';
  if (rt === 6)                          return 'Streaming';
  return 'Cinema';
}

// Estrae piattaforma dai watch provider globali
function getPlatformGlobal(wp) {
  if (!wp?.results) return null;
  // Priorità: US, GB, IT, FR, DE
  for (const country of ['US','GB','IT','FR','DE']) {
    const c = wp.results[country];
    if (!c) continue;
    if (c.flatrate?.length) return c.flatrate[0].provider_name;
    if (c.free?.length)     return c.free[0].provider_name;
  }
  // Fallback: primo paese disponibile
  const first = Object.values(wp.results)[0];
  if (first?.flatrate?.length) return first.flatrate[0].provider_name;
  return null;
}

function formatDate(d) {
  if (!d) return 'N/D';
  return new Date(d).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
}

// ── FETCH FILM PER TIPO DI RELEASE ──
async function fetchMoviesByReleaseType(rt) {
  // release_type: 1=Premiere 2=Limited 3=Theatrical 4=Digital 5=Physical 6=TV
  const path = `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=${rt}&sort_by=popularity.desc&language=it-IT`;
  const results = await tmdbAll(path);
  return results.map(m => ({ ...m, _type:'movie', _releaseType: rt }));
}

// ── FETCH SERIE TV ──
async function fetchSeries() {
  const path = `/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT`;
  const results = await tmdbAll(path);
  return results.map(s => ({ ...s, _type:'tv', _releaseType: 6, title: s.name, release_date: s.first_air_date }));
}

// ── FETCH NUOVE STAGIONI di serie horror popolari ──
async function fetchNewSeasons() {
  // Cerca serie horror con nuove stagioni nel mese target
  const path = `/discover/tv?with_genres=27&air_date.gte=${dFrom}&air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT`;
  const results = await tmdbAll(path);
  // Filtra solo serie che hanno già almeno una stagione (non nuove)
  return results
    .filter(s => (s.first_air_date || '').substring(0,7) !== `${tY}-${pad(tM)}`)
    .map(s => ({ ...s, _type:'tv', _releaseType: 6, _isSeason: true, title: s.name, release_date: s.first_air_date }));
}

// ── FORMATO POST TELEGRAM ──
function filmCaption(e) {
  const catEmoji = { 'Cinema':'🎟️', 'Streaming':'📡', 'VOD':'🎞️', 'Home Video':'📀', 'Serie TV':'📺' };
  const tags = ['#horror','#horrormovies',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.platform && e.platform !== 'N/D' ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'') : ''
  ].filter(Boolean).join(' ');

  return [
    `${catEmoji[e.category]||'☠️'} *${e.title}* (${e.year})`,
    ``,
    `🎥 *Regia / Dir.:* ${e.director}`,
    `📅 *Uscita mondiale:* ${formatDate(e.releaseDate)}`,
    `📺 *${e.category}* — ${e.platform}`,
    ``,
    `🇮🇹 *Sinossi*`,
    e.synIT ? e.synIT.slice(0,600) : '_Sinossi non disponibile._',
    ``,
    `🇬🇧 *Synopsis*`,
    e.synEN ? e.synEN.slice(0,600) : '_Synopsis not available._',
    ``,
    `${tags}`
  ].join('\n');
}

function categorySeparator(cat) {
  const icons = { 'Cinema':'🎟️', 'Streaming':'📡', 'VOD':'🎞️', 'Home Video':'📀', 'Serie TV':'📺' };
  return `\n━━━━━━━━━━━━━━━━━━━━━━\n${icons[cat]||'☠️'}  *${cat.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
}

function monthHeader(grouped) {
  const total = Object.values(grouped).reduce((s,a) => s+a.length, 0);
  const order = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const counts = order.filter(c => grouped[c]?.length)
    .map(c => `${c}: ${grouped[c].length}`).join(' · ');
  return [
    `☠️ *HORROR BULLETIN*`,
    `📅 *${MONTH_IT}*`,
    ``,
    `_${total} uscite horror in arrivo_`,
    `_${counts}_`,
    ``,
    `#horror #horrorbulletin #horrormonth`
  ].join('\n');
}

async function tgSend(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true })
  });
  await sleep(600);
}

async function tgPhoto(photo, caption) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, photo, caption: caption.slice(0,1024), parse_mode: 'Markdown' })
  });
  await sleep(800);
}

async function tgNoPhoto(caption) {
  await tgSend(`🖼️ _Locandina non disponibile_\n\n${caption}`);
}

async function discordEmbed(e) {
  const catColor = { 'Cinema':0xC0392B, 'Streaming':0x2980B9, 'VOD':0x8E44AD, 'Home Video':0xF39C12, 'Serie TV':0x27AE60 };
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{
      title: `${e.title} (${e.year})`,
      color: catColor[e.category] || 0x8B0000,
      fields: [
        { name: '🎥 Regia / Dir.', value: e.director,              inline: true },
        { name: '📅 Uscita',       value: formatDate(e.releaseDate), inline: true },
        { name: '📺 Categoria',    value: e.category,               inline: true },
        { name: '🎬 Piattaforma',  value: e.platform,               inline: true },
        { name: '🇮🇹 Sinossi',    value: (e.synIT||'_N/D_').slice(0,500) },
        { name: '🇬🇧 Synopsis',   value: (e.synEN||'_N/A_').slice(0,500) }
      ],
      thumbnail: e.poster ? { url: e.poster } : undefined,
      footer: { text: `#horror · #${e.category.toLowerCase().replace(/\s/g,'')}` }
    }]})
  });
  await sleep(800);
}

async function discordSep(cat) {
  const icons = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `\n${icons[cat]||'☠️'} **${cat.toUpperCase()}**\n━━━━━━━━━━━━━━━━━━━━━━` })
  });
  await sleep(500);
}

// ── MAIN ──
async function main() {
  const existingId = await findExistingDB();
  DB_ID = existingId || await createDB();
  console.log(`Using DB: ${DB_ID}`);

  // Fetch parallelo per tutti i tipi di release
  console.log('Fetching all horror releases...');
  const [
    theatrical,   // Cinema
    limited,      // Cinema limited
    digital,      // VOD
    physical,     // Home Video
    tvRelease,    // Streaming/TV
    newSeries,    // Serie TV nuove
    newSeasons    // Nuove stagioni
  ] = await Promise.all([
    fetchMoviesByReleaseType(3),
    fetchMoviesByReleaseType(2),
    fetchMoviesByReleaseType(4),
    fetchMoviesByReleaseType(5),
    fetchMoviesByReleaseType(6),
    fetchSeries(),
    fetchNewSeasons()
  ]);

  // Deduplicazione per ID
  const seen = new Set();
  const all  = [];
  for (const item of [...theatrical, ...limited, ...digital, ...physical, ...tvRelease, ...newSeries, ...newSeasons]) {
    const key = `${item._type}-${item.id}-${item._releaseType}`;
    if (!seen.has(key)) { seen.add(key); all.push(item); }
  }

  console.log(`Total candidates: ${all.length}`);

  const saved = [];

  for (const item of all) {
    try {
      const [det, detEN] = await Promise.all([
        tmdb(`/${item._type}/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/${item._type}/${item.id}?language=en-US`)
      ]);

      const title = bestTitle(det, detEN);
      if (!title) {
        console.log(`Skip (non-latin): ${item.title||item.name}`);
        continue;
      }

      if (await exists(title)) { console.log(`Skip (exists): ${title}`); continue; }

      const cat = item._type === 'tv'
        ? (item._isSeason ? 'Serie TV' : 'Serie TV')
        : releaseTypeToCategory(item._releaseType);

      const platformGlobal = getPlatformGlobal(det['watch/providers']);
      const platform = platformGlobal ||
        (cat === 'Cinema'     ? 'Cinema'         :
         cat === 'VOD'        ? 'VOD / Digital'  :
         cat === 'Home Video' ? 'Blu-ray / DVD'  :
         cat === 'Streaming'  ? 'Streaming'      : 'N/D');

      const dir = item._type === 'movie'
        ? (det.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D')
        : (det.created_by?.map(c => c.name).join(', ') || 'N/D');

      const releaseDate = det.release_date || det.first_air_date || null;

      const entry = {
        title,
        director:    dir,
        year:        releaseDate ? new Date(releaseDate).getFullYear() : tY,
        category:    cat,
        platform,
        releaseDate,
        tmdbId:      item.id,
        releaseType: item._releaseType,
        synIT:       det.overview  || detEN.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: [${cat}] ${title}`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.title||item.name}]: ${err.message}`);
    }
  }

  if (!saved.length) { console.log('No new entries.'); return; }

  // Raggruppa per categoria
  const order   = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const grouped = {};
  order.forEach(c => grouped[c] = []);
  saved.forEach(e => {
    if (grouped[e.category] !== undefined) grouped[e.category].push(e);
    else grouped['Cinema'].push(e);
  });
  // Ordina per data uscita dentro ogni categoria
  order.forEach(c => grouped[c].sort((a,b) => (a.releaseDate||'') < (b.releaseDate||'') ? -1 : 1));

  // ── TELEGRAM ──
  console.log('Pushing to Telegram...');
  await tgSend(monthHeader(grouped));

  for (const cat of order) {
    const films = grouped[cat];
    if (!films.length) continue;
    await tgSend(categorySeparator(cat));
    for (const e of films) {
      const caption = filmCaption(e);
      if (e.poster) await tgPhoto(e.poster, caption);
      else          await tgNoPhoto(caption);
    }
  }

  // ── DISCORD ──
  console.log('Pushing to Discord...');
  const total = saved.length;
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `# ☠️ HORROR BULLETIN — ${MONTH_IT}\n*${total} uscite horror in arrivo*` })
  });
  await sleep(500);

  for (const cat of order) {
    const films = grouped[cat];
    if (!films.length) continue;
    await discordSep(cat);
    for (const e of films) await discordEmbed(e);
  }

  console.log(`\nDone — ${total} entries saved and pushed.`);
  order.forEach(c => { if (grouped[c].length) console.log(`  ${c}: ${grouped[c].length}`); });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
