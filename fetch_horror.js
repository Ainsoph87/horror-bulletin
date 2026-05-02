// fetch_horror.js — v3
const TMDB_KEY     = process.env.TMDB_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TG_TOKEN     = process.env.TELEGRAM_TOKEN;
const TG_CHAT      = process.env.TELEGRAM_CHAT_ID;
const DISCORD_URL  = process.env.DISCORD_WEBHOOK;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';
const N_BASE    = 'https://api.notion.com/v1';
const N_HDR     = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

const now = new Date();
const tM  = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
const tY  = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
const pad = n => String(n).padStart(2,'0');
const dFrom = `${tY}-${pad(tM)}-01`;
const dTo   = `${tY}-${pad(tM)}-${new Date(tY, tM, 0).getDate()}`;
console.log(`Target: ${tY}-${pad(tM)} | ${dFrom} → ${dTo}`);

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

// Controlla duplicati per titolo
async function exists(title) {
  const r = await notion('POST', `/databases/${NOTION_DB_ID}/query`, {
    filter: { property: 'Titolo', title: { equals: title } }
  });
  return r.results.length > 0;
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

async function save(e) {
  // Proprietà Notion — solo quelle standard senza tmdb_id
  const props = {
    'Titolo':      { title:     [{ text: { content: e.title } }] },
    'Regista':     { rich_text: [{ text: { content: e.director } }] },
    'Anno':        { number:    e.year },
    'Piattaforma': { rich_text: [{ text: { content: e.platform } }] },
    'Verificato':  { checkbox:  false },
    'Approvato':   { checkbox:  false },
    'Pubblicato':  { checkbox:  false }
  };

  // Campi opzionali — aggiunti solo se la proprietà esiste
  // Data uscita
  if (e.releaseDate) props['Data uscita'] = { date: { start: e.releaseDate } };
  // Sinossi IT
  if (e.synIT) props['Sinossi IT'] = { rich_text: [{ text: { content: e.synIT.slice(0,2000) } }] };
  // Sinossi EN
  if (e.synEN) props['Sinossi EN'] = { rich_text: [{ text: { content: e.synEN.slice(0,2000) } }] };
  // URL Locandina
  if (e.poster) props['URL Locandina'] = { url: e.poster };
  // Categoria (Select)
  if (e.category) props['Categoria'] = { select: { name: e.category } };

  // Il corpo della pagina contiene TMDB ID come testo (nessuna proprietà speciale necessaria)
  const children = [{
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: `TMDB ID: ${e.tmdbId}` } }] }
  }];

  return notion('POST', '/pages', {
    parent: { database_id: NOTION_DB_ID },
    properties: props,
    children
  });
}

function buildPost(e) {
  const tags = ['#horror','#horrormovies','#horrorfilm',
    '#' + e.category.toLowerCase().replace(/\s/g,''),
    e.platform !== 'Cinema' ? '#' + e.platform.toLowerCase().replace(/[^a-z0-9]/g,'') : ''
  ].filter(Boolean).join(' ');
  return `🎬 ${e.title} (${e.year})
📽️ Regia / Dir.: ${e.director}
📅 Uscita mondiale / World Release: ${e.releaseDate}
🏷️ ${e.category}
📺 ${e.platform}

🇮🇹 SINOSSI
${e.synIT || 'Sinossi non disponibile.'}

🇬🇧 SYNOPSIS
${e.synEN || 'Synopsis not available.'}

${tags}`;
}

async function pushTG(text, poster) {
  const ep   = poster ? 'sendPhoto' : 'sendMessage';
  const body = poster
    ? { chat_id: TG_CHAT, photo: poster, caption: text.slice(0,1024) }
    : { chat_id: TG_CHAT, text: text.slice(0,4096) };
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${ep}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function pushDiscord(text, poster) {
  await fetch(DISCORD_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: text.slice(0,2000),
      embeds: poster ? [{ image: { url: poster } }] : []
    })
  });
}

async function main() {
  const [mRes, sRes] = await Promise.all([
    tmdb(`/discover/movie?with_genres=27&primary_release_date.gte=${dFrom}&primary_release_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`),
    tmdb(`/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`)
  ]);

  const movies = (mRes.results||[]).map(m => ({ ...m, _type:'movie' }));
  const series = (sRes.results||[]).map(s => ({ ...s, _type:'tv', title:s.name, release_date:s.first_air_date }));
  const all = [...movies, ...series];
  console.log(`Found ${movies.length} movies, ${series.length} series`);

  const saved = [];

  for (const item of all) {
    try {
      const titleRaw = item.title || item.name || 'Unknown';
      if (await exists(titleRaw)) { console.log(`Skip (exists): ${titleRaw}`); continue; }

      const [det, detEN] = await Promise.all([
        tmdb(`/${item._type}/${item.id}?language=it-IT&append_to_response=watch/providers,credits`),
        tmdb(`/${item._type}/${item.id}?language=en-US`)
      ]);

      const plat = getPlatform(det['watch/providers']);
      const cat  = getCategory(plat);
      const dir  = item._type === 'movie'
        ? (det.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D')
        : (det.created_by?.map(c => c.name).join(', ') || 'N/D');

      const entry = {
        title:       det.title || det.name || titleRaw,
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
      console.log(`Saved: ${entry.title}`);
      await new Promise(r => setTimeout(r, 400));

    } catch(err) {
      console.error(`Error [${item.title||item.name}]: ${err.message}`);
    }
  }

  if (!saved.length) { console.log('No new entries.'); return; }

  // Riepilogo mensile
  const hdr = `☠️ HORROR BULLETIN — ${new Date(tY, tM-1)
    .toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase()}\n\n`
    + `${saved.length} uscite horror in arrivo:\n\n`
    + saved.map((e,i) => `${i+1}. ${e.title} (${e.category} — ${e.platform}) — ${e.releaseDate}`).join('\n')
    + '\n\n#horror #horrorbulletin';

  await pushTG(hdr, null);
  await pushDiscord(hdr, null);
  console.log(`Done — ${saved.length} entries saved. Awaiting approval before individual push.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
