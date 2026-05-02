// fetch_horror.js — v8
// - Filtro titoli non latini con fallback inglese rigoroso
// - Riedizioni segnalate esplicitamente
// - Tutti i paesi inclusi
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

// Filtro RIGOROSO caratteri non latini (esteso)
const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u2100-\u214F]/;
const isLatinReadable = t => {
  if (!t) return false;
  // Almeno un carattere alfabetico latino
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return false;
  // Nessun carattere fuori dal range latino esteso
  return !NON_LATIN.test(t);
};

// Soglia: re-edizione se primary release > N anni fa rispetto al mese target
const RE_RELEASE_YEARS_THRESHOLD = 2;

const STREAMING_PROVIDERS = [
  'netflix','amazon prime video','prime video','hulu','disney plus','disney+','hbo max','max',
  'apple tv+','apple tv plus','paramount+','paramount plus','peacock','shudder','starz',
  'crunchyroll','mubi','arrow','screambox','tubi','pluto tv','crackle','freevee','britbox',
  'acorn tv','sundance now','ovid','curiosity stream','rakuten viki','viki','fubo','fubotv',
  'now tv','sky go','infinity+','infinity plus','raiplay','mediaset infinity','tim vision','timvision',
  'discovery+','discovery plus','sky','bbc iplayer','channel 4','itvx'
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
        { name: 'Cinema',         color: 'red'    },
        { name: 'Streaming',      color: 'blue'   },
        { name: 'VOD',            color: 'purple' },
        { name: 'Home Video',     color: 'yellow' },
        { name: 'Serie TV',       color: 'green'  }
      ]}},
      'Tipo':          { select: { options: [
        { name: 'Nuova uscita',   color: 'green'  },
        { name: 'Riedizione',     color: 'orange' }
      ]}},
      'Piattaforma':   { rich_text: {} },
      'Data uscita':   { date: {} },
      'Anno originale':{ number: { format: 'number' } },
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

async function exists(title, releaseDate) {
  // Considera duplicato solo se titolo + data uscita coincidono
  const r = await notion('POST', `/databases/${DB_ID}/query`, {
    filter: {
      and: [
        { property: 'Name',        title: { equals: title } },
        { property: 'Data uscita', date:  { equals: releaseDate } }
      ]
    }
  });
  return r.results.length > 0;
}

async function save(e) {
  const props = {
    'Name':            { title:     [{ text: { content: e.title } }] },
    'Regista':         { rich_text: [{ text: { content: e.director } }] },
    'Anno':            { number:    e.year },
    'Categoria':       { select:    { name: e.category } },
    'Tipo':            { select:    { name: e.isReRelease ? 'Riedizione' : 'Nuova uscita' } },
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

  return notion('POST', '/pages', {
    parent: { database_id: DB_ID },
    properties: props,
    children: [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `TMDB ID: ${e.tmdbId} | Tipo release: ${e.releaseType} | ${e.notes||''}` } }] }
    }]
  });
}

// Trova il MIGLIOR titolo leggibile (latino) tra: italiano, inglese, originale, traduzioni
function bestTitle(det, detEN) {
  const candidates = [];

  // Italiano (primary)
  if (det.title)         candidates.push(det.title);
  if (det.name)          candidates.push(det.name);
  // Inglese
  if (detEN?.title)      candidates.push(detEN.title);
  if (detEN?.name)       candidates.push(detEN.name);
  // Tutte le traduzioni
  for (const tr of det.translations?.translations || []) {
    if (tr?.data?.title) candidates.push(tr.data.title);
    if (tr?.data?.name)  candidates.push(tr.data.name);
  }

  // Restituisci il primo titolo realmente leggibile
  for (const c of candidates) {
    if (isLatinReadable(c)) return c;
  }
  return null;
}

// Trova release nel mese target
function findReleaseInTargetMonth(releaseDates) {
  if (!releaseDates?.results) return null;
  const inMonth = [];
  for (const country of releaseDates.results) {
    for (const rd of country.release_dates || []) {
      const d = (rd.release_date || '').slice(0,10);
      if (d >= dFrom && d <= dTo) {
        inMonth.push({
          type: rd.type, date: d,
          country: country.iso_3166_1,
          note: rd.note || ''
        });
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
    if (c.flatrate?.length) {
      const provider = c.flatrate[0].provider_name;
      return { category: 'Streaming', platform: provider };
    }
    if (c.free?.length) {
      return { category: 'Streaming', platform: c.free[0].provider_name + ' (Free)' };
    }
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

// ── FETCH FILM ──
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

async function fetchHorrorSeries() {
  const path = `/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT`;
  const list = await tmdbAll(path);
  return list.map(s => ({ ...s, _type:'tv', title:s.name, release_date:s.first_air_date }));
}

// ── FORMATTAZIONE POST ──
function filmCaption(e) {
  const catEmoji = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  const reLabel  = e.isReRelease
    ? `\n♻️ *RIEDIZIONE* — Film originale del ${e.originalYear}\n📦 *Formato:* ${e.platform}\n`
    : '';
  const tags = ['#horror','#horrormovies',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.isReRelease ? '#rerelease #riedizione' : '#newrelease',
    e.platform && e.platform !== 'N/D' && e.platform !== 'Cinema'
      ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'')
      : ''
  ].filter(Boolean).join(' ');

  return [
    `${catEmoji[e.category]||'☠️'} *${e.title}*${e.isReRelease ? ` (${e.originalYear})` : ` (${e.year})`}`,
    reLabel,
    `🎥 *Regia / Dir.:* ${e.director}`,
    `📅 *Uscita:* ${formatDate(e.releaseDate)}`,
    e.isReRelease ? '' : `📺 *${e.category}* — ${e.platform}`,
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

async function discordEmbed(e) {
  const catColor = { 'Cinema':0xC0392B,'Streaming':0x2980B9,'VOD':0x8E44AD,'Home Video':0xF39C12,'Serie TV':0x27AE60 };
  const titleStr = e.isReRelease
    ? `♻️ ${e.title} (${e.originalYear}) — Riedizione`
    : `${e.title} (${e.year})`;

  const fields = [
    { name: '🎥 Regia / Dir.', value: e.director,                inline: true },
    { name: '📅 Uscita',       value: formatDate(e.releaseDate), inline: true },
    { name: '📺 Categoria',    value: e.category,                inline: true }
  ];
  if (e.isReRelease) {
    fields.push({ name: '📦 Formato/Edizione', value: e.platform, inline: false });
  } else {
    fields.push({ name: '🎬 Piattaforma', value: e.platform, inline: true });
  }
  fields.push({ name: '🇮🇹 Sinossi',  value: (e.synIT||'_Non disponibile_').slice(0,500) });
  fields.push({ name: '🇬🇧 Synopsis', value: (e.synEN||'_Not available_').slice(0,500) });

  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{
      title: titleStr,
      color: catColor[e.category] || 0x8B0000,
      fields,
      thumbnail: e.poster ? { url: e.poster } : undefined,
      footer: { text: e.isReRelease ? `#horror · #riedizione · #${e.category.toLowerCase().replace(/\s/g,'')}` : `#horror · #${e.category.toLowerCase().replace(/\s/g,'')}` }
    }]})
  });
  await sleep(2200);
}

async function discordSep(cat) {
  const icons = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `\n${icons[cat]||'☠️'} **${cat.toUpperCase()}**\n━━━━━━━━━━━━━━━━━━━━━━` })
  });
  await sleep(2200);
}

// ── MAIN ──
async function main() {
  const existingId = await findExistingDB();
  DB_ID = existingId || await createDB();
  console.log(`Using DB: ${DB_ID}`);

  console.log('Fetching candidates...');
  const [movies, series] = await Promise.all([fetchHorrorMovies(), fetchHorrorSeries()]);
  console.log(`Candidates: ${movies.length} movies, ${series.length} series`);

  const saved   = [];
  const skipped = { nonLatin: 0, noRelease: 0, exists: 0, error: 0 };

  // FILM
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
      if (!title) {
        console.log(`Skip (no readable title): ${item.title}`);
        skipped.nonLatin++;
        continue;
      }

      if (await exists(title, release.date)) { skipped.exists++; continue; }

      const { category, platform } = categorizeRelease(release, det['watch/providers']);

      // Determina se riedizione
      const releaseYear  = new Date(release.date).getFullYear();
      const originalYear = det.release_date ? new Date(det.release_date).getFullYear() : releaseYear;
      const isReRelease  = (releaseYear - originalYear) >= RE_RELEASE_YEARS_THRESHOLD;

      // Costruisci descrizione formato per riedizioni
      let displayPlatform = platform;
      if (isReRelease) {
        if (category === 'Home Video') {
          // Estrai dettagli dal note se disponibili (es. "4K UHD")
          displayPlatform = release.note || 'Blu-ray / 4K UHD restaurato';
        } else if (category === 'Streaming') {
          displayPlatform = `Arrivo su ${platform}`;
        } else if (category === 'VOD') {
          displayPlatform = `VOD su ${platform}`;
        } else if (category === 'Cinema') {
          displayPlatform = release.note || 'Ri-distribuzione cinematografica';
        }
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
        tmdbId:      item.id,
        releaseType: release.type,
        synIT:       det.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null,
        notes:       `${release.country} type ${release.type}${release.note?' "'+release.note+'"':''}`
      };

      await save(entry);
      saved.push(entry);
      const tag = isReRelease ? `[♻️ RIED.${originalYear}]` : '[NEW]';
      console.log(`Saved: ${tag} [${category}] ${title} (${release.date} ${release.country})`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.title}]: ${err.message}`);
      skipped.error++;
    }
  }

  // SERIE TV
  for (const item of series) {
    try {
      const [det, detEN] = await Promise.all([
        tmdb(`/tv/${item.id}?language=it-IT&append_to_response=watch/providers,credits,translations`),
        tmdb(`/tv/${item.id}?language=en-US`)
      ]);

      const firstAir = det.first_air_date || item.first_air_date;
      if (!firstAir || firstAir < dFrom || firstAir > dTo) { skipped.noRelease++; continue; }

      const title = bestTitle(det, detEN);
      if (!title) { skipped.nonLatin++; continue; }
      if (await exists(title, firstAir)) { skipped.exists++; continue; }

      const wp       = det['watch/providers'];
      const provider = detectStreamingOrVOD(wp);
      const platform = provider?.platform || 'Streaming';
      const dir      = det.created_by?.map(c => c.name).join(', ') || 'N/D';
      const year     = new Date(firstAir).getFullYear();

      const entry = {
        title,
        director:    dir,
        year,
        originalYear: year,
        isReRelease: false,
        category:    'Serie TV',
        platform,
        releaseDate: firstAir,
        tmdbId:      item.id,
        releaseType: 6,
        synIT:       det.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null,
        notes:       'TV first air'
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: [NEW] [Serie TV] ${title}`);
      await sleep(400);

    } catch(err) {
      console.error(`Error [${item.name}]: ${err.message}`);
      skipped.error++;
    }
  }

  console.log(`\nSkipped: nonLatin=${skipped.nonLatin}, noRelease=${skipped.noRelease}, exists=${skipped.exists}, errors=${skipped.error}`);

  if (!saved.length) { console.log('No new entries.'); return; }

  // Raggruppa
  const order   = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const grouped = {};
  order.forEach(c => grouped[c] = []);
  saved.forEach(e => {
    if (grouped[e.category] !== undefined) grouped[e.category].push(e);
    else grouped['Cinema'].push(e);
  });
  // Ordina: prima nuove uscite, poi riedizioni; entrambe per data
  order.forEach(c => grouped[c].sort((a,b) => {
    if (a.isReRelease !== b.isReRelease) return a.isReRelease ? 1 : -1;
    return (a.releaseDate||'') < (b.releaseDate||'') ? -1 : 1;
  }));

  // TELEGRAM
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

  // DISCORD
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
