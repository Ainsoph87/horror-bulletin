// fetch_horror.js — v7
// Verifica rigorosa: ogni film deve avere una release effettiva nel mese target
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

const NON_LATIN = /[\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0900-\u097F\uF900-\uFAFF\u0400-\u04FF]/;
const isReadable = t => t && !NON_LATIN.test(t);

// Provider noti come Streaming (subscription/SVOD)
const STREAMING_PROVIDERS = [
  'netflix','amazon prime video','prime video','hulu','disney plus','disney+','hbo max','max',
  'apple tv+','apple tv plus','paramount+','paramount plus','peacock','shudder','starz',
  'crunchyroll','mubi','arrow','screambox','tubi','pluto tv','crackle','freevee','britbox',
  'acorn tv','sundance now','ovid','curiosity stream','rakuten viki','viki','fubo','fubotv',
  'now tv','sky go','infinity+','infinity plus','raiplay','mediaset infinity','tim vision','timvision',
  'discovery+','discovery plus','sky','bbc iplayer','channel 4','itvx'
];

// Provider noti come VOD (acquisto/noleggio digitale)
const VOD_PROVIDERS = [
  'apple tv','itunes','google play','google play movies','youtube','amazon video','prime video store',
  'microsoft store','vudu','fandango at home','rakuten tv','chili','mymovies','infinity','redbox'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tmdb(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path.slice(0,80)}`);
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
      paragraph: { rich_text: [{ type: 'text', text: { content: `TMDB ID: ${e.tmdbId} | Tipo release: ${e.releaseType} | Note: ${e.notes||''}` } }] }
    }]
  });
}

function bestTitle(det, detEN) {
  const orig = det.title || det.name || '';
  if (isReadable(orig)) return orig;
  const en = detEN?.title || detEN?.name || '';
  if (isReadable(en)) return en;
  const trans = det.translations?.translations?.find(t => t.iso_639_1 === 'en');
  const tEN = trans?.data?.title || trans?.data?.name || '';
  if (isReadable(tEN)) return tEN;
  return null;
}

// Trova la release specifica nel mese target
// Restituisce { type, date, country, note } oppure null
function findReleaseInTargetMonth(releaseDates) {
  if (!releaseDates?.results) return null;

  const inMonth = [];

  for (const country of releaseDates.results) {
    for (const rd of country.release_dates || []) {
      const d = (rd.release_date || '').slice(0,10);
      if (d >= dFrom && d <= dTo) {
        inMonth.push({
          type:    rd.type,
          date:    d,
          country: country.iso_3166_1,
          note:    rd.note || ''
        });
      }
    }
  }

  if (!inMonth.length) return null;

  // Priorità: 3 (Theatrical) > 2 (Limited) > 1 (Premiere) > 4 (Digital) > 5 (Physical) > 6 (TV)
  const priority = { 3:1, 2:2, 1:3, 4:4, 5:5, 6:6 };
  inMonth.sort((a,b) => (priority[a.type]||99) - (priority[b.type]||99));

  // Preferisci paese tra US, GB, IT, FR, DE
  const preferredCountries = ['US','GB','IT','FR','DE','CA','AU'];
  for (const c of preferredCountries) {
    const match = inMonth.find(r => r.country === c);
    if (match) return match;
  }
  return inMonth[0];
}

// Categorizza in base al release type effettivo del mese target
function categorizeRelease(release, watchProviders) {
  const t = release.type;

  // Cinema
  if (t === 1 || t === 2 || t === 3) return { category: 'Cinema', platform: 'Cinema' };

  // Home Video (Physical)
  if (t === 5) return { category: 'Home Video', platform: 'Blu-ray / DVD / 4K UHD' };

  // TV
  if (t === 6) return { category: 'Streaming', platform: 'TV / Streaming' };

  // Digital (type 4) — distinguere VOD vs Streaming dai provider
  if (t === 4) {
    const provider = detectStreamingOrVOD(watchProviders);
    if (provider) return provider;
    // Default per type 4 senza provider
    return { category: 'VOD', platform: 'VOD / Digital' };
  }

  return { category: 'Cinema', platform: 'N/D' };
}

// Analizza i watch provider per distinguere Streaming da VOD
function detectStreamingOrVOD(wp) {
  if (!wp?.results) return null;

  // Controlla i paesi prioritari
  const countries = ['US','GB','IT','FR','DE','CA','AU'];
  for (const country of countries) {
    const c = wp.results[country];
    if (!c) continue;

    // Streaming (flatrate = abbonamento)
    if (c.flatrate?.length) {
      const provider = c.flatrate[0].provider_name;
      const isStreaming = STREAMING_PROVIDERS.some(s => provider.toLowerCase().includes(s));
      if (isStreaming) return { category: 'Streaming', platform: provider };
      return { category: 'Streaming', platform: provider };
    }

    // Free
    if (c.free?.length) {
      return { category: 'Streaming', platform: c.free[0].provider_name + ' (Free)' };
    }
  }

  // Solo VOD/rent/buy
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

// ── FETCH FILM HORROR ──
async function fetchHorrorMovies() {
  // Discover su tutti i tipi di release nel mese
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
  for (const list of all) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ ...m, _type: 'movie' });
    }
  }
  return out;
}

async function fetchHorrorSeries() {
  const path = `/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT`;
  const list = await tmdbAll(path);
  return list.map(s => ({ ...s, _type: 'tv', title: s.name, release_date: s.first_air_date }));
}

// ── FORMATTAZIONE POST ──
function filmCaption(e) {
  const catEmoji = { 'Cinema':'🎟️', 'Streaming':'📡', 'VOD':'🎞️', 'Home Video':'📀', 'Serie TV':'📺' };
  const tags = ['#horror','#horrormovies',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.platform && e.platform !== 'N/D' && e.platform !== 'Cinema'
      ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'')
      : ''
  ].filter(Boolean).join(' ');

  return [
    `${catEmoji[e.category]||'☠️'} *${e.title}* (${e.year})`,
    ``,
    `🎥 *Regia / Dir.:* ${e.director}`,
    `📅 *Uscita:* ${formatDate(e.releaseDate)}`,
    `📺 *${e.category}* — ${e.platform}`,
    ``,
    `🇮🇹 *Sinossi*`,
    e.synIT ? e.synIT.slice(0,600) : '_Sinossi non disponibile._',
    ``,
    `🇬🇧 *Synopsis*`,
    e.synEN ? e.synEN.slice(0,600) : '_Synopsis not available._',
    ``,
    tags
  ].join('\n');
}

function categorySeparator(cat) {
  const icons = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
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
  const catColor = { 'Cinema':0xC0392B,'Streaming':0x2980B9,'VOD':0x8E44AD,'Home Video':0xF39C12,'Serie TV':0x27AE60 };
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{
      title: `${e.title} (${e.year})`,
      color: catColor[e.category] || 0x8B0000,
      fields: [
        { name: '🎥 Regia / Dir.', value: e.director,                inline: true },
        { name: '📅 Uscita',       value: formatDate(e.releaseDate), inline: true },
        { name: '📺 Categoria',    value: e.category,                inline: true },
        { name: '🎬 Piattaforma',  value: e.platform,                inline: true },
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

  console.log('Fetching candidates...');
  const [movies, series] = await Promise.all([
    fetchHorrorMovies(),
    fetchHorrorSeries()
  ]);
  console.log(`Candidates: ${movies.length} movies, ${series.length} series`);

  const saved = [];

  // ── PROCESSA FILM ──
  for (const item of movies) {
    try {
      const [det, detEN, releaseDates] = await Promise.all([
        tmdb(`/movie/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/movie/${item.id}?language=en-US`),
        tmdb(`/movie/${item.id}/release_dates`)
      ]);

      // Verifica RIGOROSA: deve avere una release nel mese target
      const release = findReleaseInTargetMonth(releaseDates);
      if (!release) {
        console.log(`Skip (no release in month): ${item.title}`);
        continue;
      }

      const title = bestTitle(det, detEN);
      if (!title) {
        console.log(`Skip (non-latin): ${item.title}`);
        continue;
      }

      if (await exists(title)) { console.log(`Skip (exists): ${title}`); continue; }

      const { category, platform } = categorizeRelease(release, det['watch/providers']);

      const dir = det.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D';

      const entry = {
        title,
        director:    dir,
        year:        new Date(release.date).getFullYear(),
        category,
        platform,
        releaseDate: release.date,
        tmdbId:      item.id,
        releaseType: release.type,
        synIT:       det.overview  || detEN.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null,
        notes:       `${release.country} type ${release.type}`
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: [${category}] ${title} (${release.date} ${release.country})`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.title}]: ${err.message}`);
    }
  }

  // ── PROCESSA SERIE TV ──
  for (const item of series) {
    try {
      const [det, detEN] = await Promise.all([
        tmdb(`/tv/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/tv/${item.id}?language=en-US`)
      ]);

      const firstAir = det.first_air_date || item.first_air_date;
      if (!firstAir || firstAir < dFrom || firstAir > dTo) {
        console.log(`Skip (out of month): ${item.name}`);
        continue;
      }

      const title = bestTitle(det, detEN);
      if (!title) { console.log(`Skip (non-latin): ${item.name}`); continue; }
      if (await exists(title)) { console.log(`Skip (exists): ${title}`); continue; }

      const wp = det['watch/providers'];
      const provider = detectStreamingOrVOD(wp);
      const platform = provider?.platform || 'Streaming';

      const dir = det.created_by?.map(c => c.name).join(', ') || 'N/D';

      const entry = {
        title,
        director:    dir,
        year:        new Date(firstAir).getFullYear(),
        category:    'Serie TV',
        platform,
        releaseDate: firstAir,
        tmdbId:      item.id,
        releaseType: 6,
        synIT:       det.overview  || detEN.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null,
        notes:       'TV series first air'
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: [Serie TV] ${title}`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.name}]: ${err.message}`);
    }
  }

  if (!saved.length) { console.log('No new entries.'); return; }

  // Raggruppa e ordina
  const order   = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const grouped = {};
  order.forEach(c => grouped[c] = []);
  saved.forEach(e => {
    if (grouped[e.category] !== undefined) grouped[e.category].push(e);
    else grouped['Cinema'].push(e);
  });
  order.forEach(c => grouped[c].sort((a,b) => (a.releaseDate||'') < (b.releaseDate||'') ? -1 : 1));

  // ── TELEGRAM ──
  console.log('Pushing to Telegram...');
  await tgSend(monthHeader(grouped));
  for (const cat of order) {
    if (!grouped[cat].length) continue;
    await tgSend(categorySeparator(cat));
    for (const e of grouped[cat]) {
      const caption = filmCaption(e);
      if (e.poster) await tgPhoto(e.poster, caption);
      else          await tgNoPhoto(caption);
    }
  }

  // ── DISCORD ──
  console.log('Pushing to Discord...');
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `# ☠️ HORROR BULLETIN — ${MONTH_IT}\n*${saved.length} uscite horror in arrivo*` })
  });
  await sleep(500);
  for (const cat of order) {
    if (!grouped[cat].length) continue;
    await discordSep(cat);
    for (const e of grouped[cat]) await discordEmbed(e);
  }

  console.log(`\nDone — ${saved.length} entries saved and pushed.`);
  order.forEach(c => { if (grouped[c].length) console.log(`  ${c}: ${grouped[c].length}`); });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
