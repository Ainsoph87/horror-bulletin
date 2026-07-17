// fetch_horror.js — v10
// Doppia fonte: TMDB (film) + TVMaze (serie TV premiere e nuove stagioni)
const TMDB_KEY       = process.env.TMDB_API_KEY;
const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_DB_ID;
const TG_TOKEN       = process.env.TELEGRAM_TOKEN;
const TG_CHAT        = process.env.TELEGRAM_CHAT_ID;
const DISCORD_URL    = process.env.DISCORD_WEBHOOK;

const TMDB_BASE   = 'https://api.themoviedb.org/3';
const TMDB_IMG    = 'https://image.tmdb.org/t/p/w500';
const TVMAZE_BASE = 'https://api.tvmaze.com';
const N_BASE      = 'https://api.notion.com/v1';
const N_HDR       = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

const fs = require('fs');
const path = require('path');
const { movieScore, showScore } = require('./rilevanza.js');

const now   = new Date();
const tM    = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
const tY    = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
const pad   = n => String(n).padStart(2,'0');
const dFrom = `${tY}-${pad(tM)}-01`;
const dTo   = `${tY}-${pad(tM)}-${new Date(tY, tM, 0).getDate()}`;
const MONTH_IT = new Date(tY, tM-1).toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase();

console.log(`Target: ${MONTH_IT} | ${dFrom} → ${dTo}`);

let DB_ID = null;

const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u2100-\u214F]/;
const isLatinReadable = t => {
  if (!t) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return false;
  return !NON_LATIN.test(t);
};

const TVMAZE_HORROR_GENRES = ['Horror','Thriller','Mystery','Supernatural','Crime'];
const RE_RELEASE_YEARS_THRESHOLD = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP HELPERS ──
async function tmdb(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

async function tmdbAll(path) {
  const sep   = path.includes('?') ? '&' : '?';
  const first = await (await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&page=1`)).json();
  const pages = Math.min(first.total_pages || 1, 5);
  let results = [...(first.results || [])];
  for (let p = 2; p <= pages; p++) {
    const r = await (await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&page=${p}`)).json();
    results = [...results, ...(r.results || [])];
    await sleep(250);
  }
  return results;
}

async function tvmaze(path) {
  const r = await fetch(`${TVMAZE_BASE}${path}`);
  if (!r.ok) throw new Error(`TVMaze ${r.status}`);
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

// ── NOTION SETUP ──
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
        { name: 'Cinema',         color: 'red'    },
        { name: 'Streaming',      color: 'blue'   },
        { name: 'VOD',            color: 'purple' },
        { name: 'Home Video',     color: 'yellow' },
        { name: 'Serie TV',       color: 'green'  }
      ]}},
      'Tipo':          { select: { options: [
        { name: 'Nuova uscita',    color: 'green'  },
        { name: 'Riedizione',      color: 'orange' },
        { name: 'Nuova stagione',  color: 'pink'   }
      ]}},
      'Piattaforma':   { rich_text: {} },
      'Data uscita':   { date: {} },
      'Anno originale':{ number: { format: 'number' } },
      'Sinossi IT':    { rich_text: {} },
      'Sinossi EN':    { rich_text: {} },
      'URL Locandina': { url: {} },
      'Rilevanza':     { number: { format: 'number' } },
      'Verificato':    { checkbox: {} },
      'Approvato':     { checkbox: {} },
      'Pubblicato':    { checkbox: {} }
    }
  });
  console.log(`DB created: ${r.id}`);
  return r.id.replace(/-/g,'');
}

async function exists(title, releaseDate) {
  // Finestra di 90 giorni: lo stesso film ripescato con data slittata è un duplicato,
  // una riedizione a distanza di anni no
  const r = await notion('POST', `/databases/${DB_ID}/query`, {
    filter: { property: 'Name', title: { equals: title } }
  });
  if (!releaseDate) return r.results.length > 0;
  const WINDOW = 90 * 86400000;
  return r.results.some(p => {
    const d = p.properties?.['Data uscita']?.date?.start;
    return d && Math.abs(new Date(d) - new Date(releaseDate)) <= WINDOW;
  });
}

async function save(e) {
  const tipoName = e.tipoOverride || (e.isReRelease ? 'Riedizione' : 'Nuova uscita');
  const props = {
    'Name':            { title:     [{ text: { content: e.title } }] },
    'Regista':         { rich_text: [{ text: { content: e.director } }] },
    'Anno':            { number:    e.year },
    'Categoria':       { select:    { name: e.category } },
    'Tipo':            { select:    { name: tipoName } },
    'Piattaforma':     { rich_text: [{ text: { content: e.platform } }] },
    'Verificato':      { checkbox:  false },
    'Approvato':       { checkbox:  false },
    'Pubblicato':      { checkbox:  false }
  };
  if (e.releaseDate)    props['Data uscita']    = { date:      { start: e.releaseDate } };
  if (e.originalYear)   props['Anno originale'] = { number:    e.originalYear };
  if (e.synIT)          props['Sinossi IT']     = { rich_text: [{ text: { content: e.synIT.slice(0,2000) } }] };
  if (e.synEN)          props['Sinossi EN']     = { rich_text: [{ text: { content: e.synEN.slice(0,2000) } }] };
  if (e.poster)         props['URL Locandina']  = { url: e.poster };
  if (e.rilevanza != null) props['Rilevanza']   = { number: e.rilevanza };

  return notion('POST', '/pages', {
    parent: { database_id: DB_ID },
    properties: props,
    children: [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `Source: ${e.source} | ${e.notes||''}` } }] }
    }]
  });
}

// ── TITLE & RELEASE LOGIC ──
function bestTitle(det, detEN) {
  const candidates = [];
  if (det?.title) candidates.push(det.title);
  if (det?.name)  candidates.push(det.name);
  if (detEN?.title) candidates.push(detEN.title);
  if (detEN?.name)  candidates.push(detEN.name);
  for (const tr of det?.translations?.translations || []) {
    if (tr?.data?.title) candidates.push(tr.data.title);
    if (tr?.data?.name)  candidates.push(tr.data.name);
  }
  for (const c of candidates) if (isLatinReadable(c)) return c;
  return null;
}

function findReleaseInTargetMonth(releaseDates) {
  if (!releaseDates?.results) return null;
  const inMonth = [];
  for (const country of releaseDates.results) {
    for (const rd of country.release_dates || []) {
      const d = (rd.release_date || '').slice(0,10);
      if (d >= dFrom && d <= dTo) {
        inMonth.push({ type: rd.type, date: d, country: country.iso_3166_1, note: rd.note || '' });
      }
    }
  }
  if (!inMonth.length) return null;
  const priority = { 3:1, 2:2, 1:3, 4:4, 5:5, 6:6 };
  inMonth.sort((a,b) => (priority[a.type]||99) - (priority[b.type]||99));
  const preferred = ['US','GB','IT','FR','DE','CA','AU','ES','NL','SE'];
  for (const c of preferred) {
    const m = inMonth.find(r => r.country === c);
    if (m) return m;
  }
  return inMonth[0];
}

function categorizeRelease(release, watchProviders) {
  const t = release.type;
  if (t === 1 || t === 2 || t === 3) return { category: 'Cinema', platform: 'Cinema' };
  if (t === 5)                       return { category: 'Home Video', platform: 'Blu-ray / DVD / 4K UHD' };
  if (t === 6)                       return { category: 'Streaming', platform: 'TV / Streaming' };
  if (t === 4) {
    const provider = detectStreamingOrVOD(watchProviders);
    if (provider) return provider;
    return { category: 'VOD', platform: 'VOD / Digital' };
  }
  return { category: 'Cinema', platform: 'N/D' };
}

function detectStreamingOrVOD(wp) {
  if (!wp?.results) return null;
  const countries = ['US','GB','IT','FR','DE','CA','AU','ES'];
  for (const country of countries) {
    const c = wp.results[country];
    if (!c) continue;
    if (c.flatrate?.length) return { category: 'Streaming', platform: c.flatrate[0].provider_name };
    if (c.free?.length)     return { category: 'Streaming', platform: c.free[0].provider_name + ' (Free)' };
  }
  for (const country of countries) {
    const c = wp.results[country];
    if (!c) continue;
    if (c.rent?.length) return { category: 'VOD', platform: c.rent[0].provider_name };
    if (c.buy?.length)  return { category: 'VOD', platform: c.buy[0].provider_name };
  }
  return null;
}

function formatDate(d) {
  if (!d) return 'N/D';
  return new Date(d).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
}

// ── FETCH FILM DA TMDB ──
async function fetchHorrorMovies() {
  const queries = [
    `/discover/movie?with_genres=27&primary_release_date.gte=${dFrom}&primary_release_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT`,
    `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=3&sort_by=popularity.desc&language=it-IT`,
    `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=2&sort_by=popularity.desc&language=it-IT`,
    `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=4&sort_by=popularity.desc&language=it-IT`,
    `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=5&sort_by=popularity.desc&language=it-IT`,
    `/discover/movie?with_genres=27&release_date.gte=${dFrom}&release_date.lte=${dTo}&with_release_type=6&sort_by=popularity.desc&language=it-IT`
  ];
  const all = await Promise.all(queries.map(q => tmdbAll(q)));
  const seen = new Set();
  const out  = [];
  for (const list of all) for (const m of list) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ ...m, _type:'movie' });
  }
  return out;
}

// ── FETCH SERIE TV DA TVMAZE ──
async function fetchHorrorSeriesPremieres() {
  console.log('Fetching TVMaze schedule for the month...');
  const days = [];
  const totalDays = new Date(tY, tM, 0).getDate();
  for (let d = 1; d <= totalDays; d++) {
    days.push(`${tY}-${pad(tM)}-${pad(d)}`);
  }

  const allEpisodes = [];
  for (const date of days) {
    try {
      const [tvSched, webSched] = await Promise.all([
        tvmaze(`/schedule?country=US&date=${date}`).catch(() => []),
        tvmaze(`/schedule/web?date=${date}`).catch(() => [])
      ]);
      for (const ep of tvSched) {
        if (ep && ep.show) allEpisodes.push({ ...ep, _show: ep.show, _src: 'tv' });
      }
      for (const ep of webSched) {
        if (ep && ep._embedded?.show) allEpisodes.push({ ...ep, _show: ep._embedded.show, _src: 'web' });
      }
      await sleep(120);
    } catch (err) {
      console.error(`TVMaze schedule error ${date}: ${err.message}`);
    }
  }

  console.log(`TVMaze: fetched ${allEpisodes.length} total episodes scheduled in month`);

  const premieres = allEpisodes.filter(ep => ep.number === 1);

  const seenShows = new Map();
  for (const ep of premieres) {
    const showId = ep._show.id;
    if (!seenShows.has(showId) || seenShows.get(showId).season > ep.season) {
      seenShows.set(showId, ep);
    }
  }

  const horrorOnly = [...seenShows.values()].filter(ep => {
    const genres = ep._show.genres || [];
    return genres.some(g => TVMAZE_HORROR_GENRES.includes(g));
  });

  const readable = horrorOnly.filter(ep => isLatinReadable(ep._show.name));

  console.log(`TVMaze filtered: ${premieres.length} premieres → ${seenShows.size} unique shows → ${horrorOnly.length} horror → ${readable.length} readable`);

  return readable;
}

// ── FORMATTAZIONE ──

// Caption singolo film per Telegram
function filmCaption(e) {
  const catEmoji = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const reLabel = e.isReRelease
    ? `\n♻️ *RIEDIZIONE* — Film originale del ${e.originalYear}\n📦 *Formato:* ${e.platform}\n`
    : (e.tipoOverride === 'Nuova stagione'
        ? `\n🎞️ *NUOVA STAGIONE* — Stagione ${e.seasonNum}\n📡 *Su:* ${e.platform}\n`
        : '');
  const tags = ['#horror','#horrormovies',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.isReRelease ? '#rerelease #riedizione' : (e.tipoOverride === 'Nuova stagione' ? '#newseason #season' + e.seasonNum : '#newrelease'),
    e.platform && e.platform !== 'N/D' && e.platform !== 'Cinema'
      ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'')
      : ''
  ].filter(Boolean).join(' ');

  const titleLine = e.tipoOverride === 'Nuova stagione'
    ? `${catEmoji[e.category]||'☠️'} *${e.title}* — Stagione ${e.seasonNum}`
    : `${catEmoji[e.category]||'☠️'} *${e.title}*${e.isReRelease ? ` (${e.originalYear})` : ` (${e.year})`}`;

  return [
    titleLine,
    reLabel,
    `🎥 *Regia / Dir.:* ${e.director}`,
    `📅 *Uscita:* ${formatDate(e.releaseDate)}`,
    e.isReRelease || e.tipoOverride === 'Nuova stagione' ? '' : `📺 *${e.category}* — ${e.platform}`,
    ``,
    `🇮🇹 *Sinossi*`,
    e.synIT ? e.synIT.slice(0,600) : '_Sinossi non disponibile._',
    ``,
    `🇬🇧 *Synopsis*`,
    e.synEN ? e.synEN.slice(0,600) : '_Synopsis not available._',
    ``,
    tags
  ].filter(Boolean).join('\n');
}

// ── HEADER MENSILE ──
// Telegram
function monthHeaderTg(grouped) {
  const order = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const total = Object.values(grouped).reduce((s,a) => s+a.length, 0);
  const catEmoji = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const breakdown = order
    .filter(c => grouped[c]?.length)
    .map(c => `${catEmoji[c]} ${grouped[c].length} ${c}`)
    .join('\n');

  return [
    `☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️`,
    ``,
    `🩸 *HORROR BULLETIN* 🩸`,
    `📅 *${MONTH_IT}*`,
    ``,
    `*${total} uscite horror in arrivo*`,
    ``,
    breakdown,
    ``,
    `☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️☠️`,
    ``,
    `#horror #horrorbulletin #horrormonth`
  ].join('\n');
}

// ── SEPARATORE DI CATEGORIA ──
// Telegram — testo grande e visibile
function categorySeparatorTg(cat, count) {
  const icons = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const icon = icons[cat] || '☠️';
  const bar  = '━'.repeat(22);
  return [
    ``,
    bar,
    ``,
    `${icon}${icon}${icon}  *${cat.toUpperCase()}*  ${icon}${icon}${icon}`,
    `_${count} uscit${count === 1 ? 'a' : 'e'} in arrivo_`,
    ``,
    bar,
  ].join('\n');
}

// Discord — messaggio header categoria con embed colorato
async function discordCategorySep(cat, count) {
  const catColor = { 'Cinema':0xC0392B,'Streaming':0x2980B9,'VOD':0x8E44AD,'Home Video':0xF39C12,'Serie TV':0x27AE60 };
  const icons    = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const icon     = icons[cat] || '☠️';
  const color    = catColor[cat] || 0x8B0000;

  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `${icon}  ${cat.toUpperCase()}  ${icon}`,
        description: `**${count} uscit${count === 1 ? 'a' : 'e'} in arrivo**`,
        color,
      }]
    })
  });
  await sleep(2200);
}

// Discord — header mensile
async function discordMonthHeader(grouped) {
  const order = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const total = Object.values(grouped).reduce((s,a) => s+a.length, 0);
  const catEmoji = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const fields = order
    .filter(c => grouped[c]?.length)
    .map(c => ({ name: `${catEmoji[c]} ${c}`, value: `${grouped[c].length} uscite`, inline: true }));

  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `☠️ HORROR BULLETIN — ${MONTH_IT}`,
        description: `**${total} uscite horror in arrivo**`,
        color: 0x8B0000,
        fields,
      }]
    })
  });
  await sleep(2200);
}

// Discord — embed singolo film
async function discordEmbed(e) {
  const catColor = { 'Cinema':0xC0392B,'Streaming':0x2980B9,'VOD':0x8E44AD,'Home Video':0xF39C12,'Serie TV':0x27AE60 };
  let titleStr;
  if (e.isReRelease)                           titleStr = `♻️ ${e.title} (${e.originalYear}) — Riedizione`;
  else if (e.tipoOverride === 'Nuova stagione') titleStr = `🎞️ ${e.title} — Stagione ${e.seasonNum}`;
  else                                         titleStr = `${e.title} (${e.year})`;

  const fields = [
    { name: '🎥 Regia / Dir.', value: e.director,                inline: true },
    { name: '📅 Uscita',       value: formatDate(e.releaseDate), inline: true },
    { name: '📺 Categoria',    value: e.category,                inline: true }
  ];
  if (e.isReRelease)                           fields.push({ name: '📦 Formato/Edizione', value: e.platform, inline: false });
  else if (e.tipoOverride === 'Nuova stagione') fields.push({ name: '📡 Su', value: e.platform, inline: false });
  else                                         fields.push({ name: '🎬 Piattaforma', value: e.platform, inline: true });

  fields.push({ name: '🇮🇹 Sinossi',  value: (e.synIT||'_Non disponibile_').slice(0,500) });
  fields.push({ name: '🇬🇧 Synopsis', value: (e.synEN||'_Not available_').slice(0,500) });

  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{
      title: titleStr,
      color: catColor[e.category] || 0x8B0000,
      fields,
      thumbnail: e.poster ? { url: e.poster } : undefined,
      footer: { text: `#horror · #${e.category.toLowerCase().replace(/\s/g,'')}` }
    }]})
  });
  await sleep(2200);
}

// ── TELEGRAM HELPERS ──
async function tgSend(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true })
  });
  await sleep(3500);
}

async function tgPhoto(photo, caption) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, photo, caption: caption.slice(0,1024), parse_mode: 'Markdown' })
  });
  await sleep(3500);
}

async function tgNoPhoto(caption) {
  await tgSend(`🖼️ _Locandina non disponibile_\n\n${caption}`);
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
}

// ── MAIN ──
async function main() {
  const existingId = await findExistingDB();
  DB_ID = existingId || await createDB();
  console.log(`Using DB: ${DB_ID}`);

  console.log('\n=== Fetching FILM from TMDB ===');
  const movies = await fetchHorrorMovies();
  console.log(`TMDB candidates: ${movies.length} movies`);

  console.log('\n=== Fetching SERIE TV from TVMaze ===');
  const seriesPremieres = await fetchHorrorSeriesPremieres();
  console.log(`TVMaze final candidates: ${seriesPremieres.length} series premieres`);

  const saved = [];
  const skipped = { nonLatin:0, noRelease:0, exists:0, error:0 };

  // ── PROCESSA FILM (TMDB) ──
  for (const item of movies) {
    try {
      const [det, detEN, releaseDates] = await Promise.all([
        tmdb(`/movie/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/movie/${item.id}?language=en-US`),
        tmdb(`/movie/${item.id}/release_dates`)
      ]);

      const release = findReleaseInTargetMonth(releaseDates);
      if (!release) { skipped.noRelease++; continue; }

      const title = bestTitle(det, detEN);
      if (!title) { skipped.nonLatin++; continue; }

      if (await exists(title, release.date)) { skipped.exists++; continue; }

      const { category, platform } = categorizeRelease(release, det['watch/providers']);
      const releaseYear  = new Date(release.date).getFullYear();
      const originalYear = det.release_date ? new Date(det.release_date).getFullYear() : releaseYear;
      const isReRelease  = (releaseYear - originalYear) >= RE_RELEASE_YEARS_THRESHOLD;

      let displayPlatform = platform;
      if (isReRelease) {
        if (category === 'Home Video')      displayPlatform = release.note || 'Blu-ray / 4K UHD restaurato';
        else if (category === 'Streaming')  displayPlatform = `Arrivo su ${platform}`;
        else if (category === 'VOD')        displayPlatform = `VOD su ${platform}`;
        else if (category === 'Cinema')     displayPlatform = release.note || 'Ri-distribuzione cinematografica';
      }

      const dir = det.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D';

      const entry = {
        title,
        director:    dir,
        year:        releaseYear,
        originalYear,
        isReRelease,
        category,
        platform:    displayPlatform,
        releaseDate: release.date,
        synIT:       det.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null,
        rilevanza:   movieScore(det),
        source:      'TMDB',
        notes:       `${release.country} type ${release.type}${release.note?' "'+release.note+'"':''}`
      };

      await save(entry);
      saved.push(entry);
      const tag = isReRelease ? `[♻️ RIED.${originalYear}]` : '[NEW]';
      console.log(`Saved: ${tag} [${category}] ${title}`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.title}]: ${err.message}`);
      skipped.error++;
    }
  }

  // ── PROCESSA SERIE TV (TVMaze) ──
  for (const ep of seriesPremieres) {
    try {
      const show        = ep._show;
      const title       = show.name;
      const releaseDate = (ep.airdate || '').slice(0,10);
      if (!releaseDate) continue;

      if (await exists(title, releaseDate)) { skipped.exists++; continue; }

      const isNewSeason = ep.season > 1;
      const platform    = show.webChannel?.name || show.network?.name || 'Streaming';
      const dir         = '—';
      const year        = new Date(releaseDate).getFullYear();
      const synEN       = stripHtml(show.summary);

      let synIT = '';
      try {
        if (show.externals?.imdb) {
          const find = await tmdb(`/find/${show.externals.imdb}?external_source=imdb_id&language=it-IT`);
          const tvHit = find.tv_results?.[0];
          if (tvHit?.overview) synIT = tvHit.overview;
        }
      } catch {}

      const entry = {
        title,
        director:    dir,
        year,
        originalYear: new Date(show.premiered || releaseDate).getFullYear(),
        isReRelease: false,
        tipoOverride: isNewSeason ? 'Nuova stagione' : 'Nuova uscita',
        seasonNum:   ep.season,
        category:    'Serie TV',
        platform,
        releaseDate,
        synIT,
        synEN,
        poster:      show.image?.original || show.image?.medium || null,
        rilevanza:   showScore(show),
        source:      'TVMaze',
        notes:       `Show ID ${show.id} | Season ${ep.season} ep ${ep.number}`
      };

      await save(entry);
      saved.push(entry);
      const tag = isNewSeason ? `[NEW S${ep.season}]` : '[NEW PREMIERE]';
      console.log(`Saved: ${tag} [Serie TV] ${title}`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${ep._show?.name}]: ${err.message}`);
      skipped.error++;
    }
  }

  console.log(`\nSkipped: nonLatin=${skipped.nonLatin}, noRelease=${skipped.noRelease}, exists=${skipped.exists}, errors=${skipped.error}`);

  if (!saved.length) { console.log('No new entries.'); return; }

  // Raggruppa per categoria
  const order   = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const grouped = {};
  order.forEach(c => grouped[c] = []);
  saved.forEach(e => {
    if (grouped[e.category] !== undefined) grouped[e.category].push(e);
    else grouped['Cinema'].push(e);
  });
  order.forEach(c => grouped[c].sort((a,b) => {
    if (a.isReRelease !== b.isReRelease) return a.isReRelease ? 1 : -1;
    return (a.releaseDate||'') < (b.releaseDate||'') ? -1 : 1;
  }));

  // ── TELEGRAM ──
  console.log('\nPushing to Telegram...');
  await tgSend(monthHeaderTg(grouped));
  for (const cat of order) {
    if (!grouped[cat].length) continue;
    await tgSend(categorySeparatorTg(cat, grouped[cat].length));
    for (const e of grouped[cat]) {
      if (e.poster) await tgPhoto(e.poster, filmCaption(e));
      else          await tgNoPhoto(filmCaption(e));
    }
  }

  // ── DISCORD ──
  console.log('Pushing to Discord...');
  await discordMonthHeader(grouped);
  for (const cat of order) {
    if (!grouped[cat].length) continue;
    await discordCategorySep(cat, grouped[cat].length);
    for (const e of grouped[cat]) await discordEmbed(e);
  }

  console.log(`\nDone — ${saved.length} entries saved and pushed.`);
  order.forEach(c => { if (grouped[c].length) console.log(`  ${c}: ${grouped[c].length}`); });

  await exportFullDataJson();
}

// ── EXPORT COMPLETO DB → data.json ──
async function exportFullDataJson() {
  console.log('\nExporting full DB to data.json...');
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
      verificato:   t('Verificato','checkbox'),
      approvato:    t('Approvato','checkbox'),
      pubblicato:   t('Pubblicato','checkbox')
    };
  });

  items.sort((a,b) => (b.releaseDate||'').localeCompare(a.releaseDate||''));

  const data = {
    updatedAt:   new Date().toISOString(),
    targetMonth: MONTH_IT,
    total:       items.length,
    items
  };

  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'data.json'), JSON.stringify(data, null, 2));
  console.log(`Exported ${items.length} items to docs/data.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
