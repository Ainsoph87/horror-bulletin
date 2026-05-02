// fetch_horror.js — v5
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

let DB_ID = null;

// Caratteri non latini — titoli non leggibili da pubblico occidentale
const NON_LATIN = /[\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0900-\u097F\u0400-\u04FF\uF900-\uFAFF]/;

function isReadable(title) {
  return title && !NON_LATIN.test(title);
}

// Usa titolo inglese se il titolo originale non è leggibile
function bestTitle(det) {
  const orig = det.title || det.name || '';
  if (isReadable(orig)) return orig;
  // Prova titolo inglese dalle traduzioni
  const en = det.translations?.translations?.find(t => t.iso_639_1 === 'en');
  const enTitle = en?.data?.title || en?.data?.name || '';
  if (enTitle && isReadable(enTitle)) return enTitle;
  return null; // film da escludere
}

async function tmdb(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
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
  for (const block of r.results || []) {
    if (block.type === 'child_database') {
      console.log(`Found existing DB: ${block.id}`);
      return block.id.replace(/-/g,'');
    }
  }
  return null;
}

async function createDB() {
  console.log('Creating new Notion database...');
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
        { name: 'Home Video', color: 'yellow' }
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
  console.log(`Database created: ${r.id}`);
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
      paragraph: { rich_text: [{ type: 'text', text: { content: `TMDB ID: ${e.tmdbId}` } }] }
    }]
  });
}

function getPlatform(wp) {
  const it = wp?.results?.IT;
  if (!it) return 'Cinema';
  if (it.flatrate?.length) return it.flatrate.map(p => p.provider_name).join(' / ');
  if (it.rent?.length)     return 'VOD — ' + it.rent[0].provider_name;
  if (it.buy?.length)      return 'VOD — ' + it.buy[0].provider_name;
  return 'Cinema';
}

function getCategory(plat) {
  if (plat.startsWith('VOD')) return 'VOD';
  if (plat === 'Cinema')      return 'Cinema';
  return 'Streaming';
}

function formatDate(d) {
  if (!d) return 'N/D';
  const dt = new Date(d);
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Caption per Telegram — per singolo film
function filmCaption(e) {
  const tags = [
    '#horror', '#horrormovies',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.platform !== 'Cinema' ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'') : ''
  ].filter(Boolean).join(' ');

  return [
    `🎬 *${e.title}* (${e.year})`,
    ``,
    `🎥 *Regia / Dir.:* ${e.director}`,
    `📅 *Uscita:* ${formatDate(e.releaseDate)}`,
    `📺 *Piattaforma:* ${e.platform}`,
    ``,
    `🇮🇹 *Sinossi*`,
    e.synIT || '_Sinossi non disponibile._',
    ``,
    `🇬🇧 *Synopsis*`,
    e.synEN || '_Synopsis not available._',
    ``,
    tags
  ].join('\n');
}

// Separatore di categoria per Telegram
function categorySeparator(cat) {
  const icons = {
    'Cinema':     '🎟️',
    'Streaming':  '📡',
    'VOD':        '🎞️',
    'Home Video': '📀'
  };
  const icon = icons[cat] || '☠️';
  return [
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `${icon}  *${cat.toUpperCase()}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``
  ].join('\n');
}

// Intestazione mensile
function monthHeader(count) {
  return [
    `☠️ *HORROR BULLETIN*`,
    `📅 *${MONTH_IT}*`,
    ``,
    `_${count} uscite horror questo mese_`,
    ``,
    `#horror #horrorbulletin #horrormonth`
  ].join('\n');
}

// Delay per non superare rate limit Telegram
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tgSend(body) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, parse_mode: 'Markdown', disable_web_page_preview: true })
  });
  await sleep(500);
  return r;
}

async function tgPhoto(photo, caption) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      photo,
      caption: caption.slice(0, 1024),
      parse_mode: 'Markdown'
    })
  });
  await sleep(800);
  return r;
}

async function tgNoPhoto(caption) {
  return tgSend({
    chat_id: TG_CHAT,
    text: [
      `🖼️ _Locandina non disponibile_`,
      ``,
      caption
    ].join('\n')
  });
}

// Discord — un embed per film
async function discordFilm(e) {
  const embed = {
    title: `${e.title} (${e.year})`,
    color: 0x8B0000,
    fields: [
      { name: '🎥 Regia / Dir.', value: e.director, inline: true },
      { name: '📅 Uscita',       value: formatDate(e.releaseDate), inline: true },
      { name: '📺 Piattaforma',  value: e.platform, inline: true },
      { name: '🇮🇹 Sinossi',     value: (e.synIT || '_Non disponibile_').slice(0,1000) },
      { name: '🇬🇧 Synopsis',    value: (e.synEN || '_Not available_').slice(0,1000) }
    ],
    thumbnail: e.poster ? { url: e.poster } : undefined,
    footer: { text: `#horror #${e.category.toLowerCase()}` }
  };

  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
  await sleep(800);
}

async function discordSeparator(cat) {
  const icons = { 'Cinema':'🎟️', 'Streaming':'📡', 'VOD':'🎞️', 'Home Video':'📀' };
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `\n${icons[cat]||'☠️'} **${cat.toUpperCase()}**\n━━━━━━━━━━━━━━━━━━━━━━` })
  });
  await sleep(500);
}

async function discordHeader(count) {
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `# ☠️ HORROR BULLETIN — ${MONTH_IT}\n*${count} uscite horror questo mese*` })
  });
  await sleep(500);
}

async function main() {
  const existingId = await findExistingDB();
  DB_ID = existingId || await createDB();
  console.log(`Using DB: ${DB_ID}`);

  const [mRes, sRes] = await Promise.all([
    tmdb(`/discover/movie?with_genres=27&primary_release_date.gte=${dFrom}&primary_release_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`),
    tmdb(`/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`)
  ]);

  const movies = (mRes.results||[]).map(m => ({ ...m, _type:'movie' }));
  const series = (sRes.results||[]).map(s => ({ ...s, _type:'tv', title:s.name, release_date:s.first_air_date }));
  const all    = [...movies, ...series];
  console.log(`Found ${movies.length} movies, ${series.length} series (pre-filter)`);

  const saved = [];

  for (const item of all) {
    try {
      const rawTitle = item.title || item.name || '';

      // Fetch dettagli con translations per titolo inglese fallback
      const [det, detEN] = await Promise.all([
        tmdb(`/${item._type}/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/${item._type}/${item.id}?language=en-US`)
      ]);

      // Filtra titoli non leggibili da pubblico occidentale
      const title = bestTitle(det) || bestTitle(detEN);
      if (!title) {
        console.log(`Skip (non-latin title): ${rawTitle}`);
        continue;
      }

      if (await exists(title)) { console.log(`Skip (exists): ${title}`); continue; }

      const plat = getPlatform(det['watch/providers']);
      const cat  = getCategory(plat);
      const dir  = item._type === 'movie'
        ? (det.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D')
        : (det.created_by?.map(c => c.name).join(', ') || 'N/D');

      const entry = {
        title,
        director:    dir,
        year:        new Date(det.release_date || det.first_air_date || `${tY}-01-01`).getFullYear(),
        category:    cat,
        platform:    plat,
        releaseDate: det.release_date || det.first_air_date || null,
        tmdbId:      item.id,
        synIT:       det.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: ${entry.title} [${entry.category}]`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.title||item.name}]: ${err.message}`);
    }
  }

  if (!saved.length) { console.log('No new entries.'); return; }

  // Raggruppa per categoria
  const order    = ['Cinema', 'Streaming', 'VOD', 'Home Video'];
  const grouped  = {};
  order.forEach(c => grouped[c] = []);
  saved.forEach(e => {
    if (grouped[e.category]) grouped[e.category].push(e);
    else grouped['Cinema'].push(e);
  });

  const total = saved.length;

  // ── TELEGRAM ──
  await tgSend({ chat_id: TG_CHAT, text: monthHeader(total) });

  for (const cat of order) {
    const films = grouped[cat];
    if (!films.length) continue;

    await tgSend({ chat_id: TG_CHAT, text: categorySeparator(cat) });

    for (const e of films) {
      const caption = filmCaption(e);
      if (e.poster) {
        await tgPhoto(e.poster, caption);
      } else {
        await tgNoPhoto(caption);
      }
    }
  }

  // ── DISCORD ──
  await discordHeader(total);

  for (const cat of order) {
    const films = grouped[cat];
    if (!films.length) continue;
    await discordSeparator(cat);
    for (const e of films) {
      await discordFilm(e);
    }
  }

  console.log(`Done — ${total} entries saved and pushed.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
