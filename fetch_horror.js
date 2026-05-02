// fetch_horror.js — v2
const TMDB_KEY      = process.env.TMDB_API_KEY;
const NOTION_TOKEN  = process.env.NOTION_TOKEN;
const NOTION_DB_ID  = process.env.NOTION_DB_ID;
const TG_TOKEN      = process.env.TELEGRAM_TOKEN;
const TG_CHAT       = process.env.TELEGRAM_CHAT_ID;
const DISCORD_URL   = process.env.DISCORD_WEBHOOK;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';
const N_BASE    = 'https://api.notion.com/v1';
const N_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

// Mese successivo
const now = new Date();
const tM = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
const tY = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
const pad = n => String(n).padStart(2,'0');
const dFrom = `${tY}-${pad(tM)}-01`;
const dTo   = `${tY}-${pad(tM)}-${new Date(tY, tM, 0).getDate()}`;
console.log(`Target: ${tY}-${pad(tM)} (${dFrom} → ${dTo})`);

async function tmdb(path) {
  const r = await fetch(`${TMDB_BASE}${path}&api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

async function notion(method, path, body) {
  const r = await fetch(`${N_BASE}${path}`, {
    method,
    headers: N_HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

function platform(wp) {
  const it = wp?.results?.IT;
  if (!it) return 'Cinema';
  if (it.flatrate?.length) return it.flatrate.map(p => p.provider_name).join(' / ');
  if (it.rent?.length)     return 'VOD — ' + it.rent[0].provider_name;
  if (it.buy?.length)      return 'VOD — ' + it.buy[0].provider_name;
  return 'Cinema';
}

function category(plat) {
  if (plat.startsWith('VOD')) return 'VOD';
  if (plat === 'Cinema')      return 'Cinema';
  return 'Streaming';
}

async function alreadySaved(tmdbId) {
  const r = await notion('POST', `/databases/${NOTION_DB_ID}/query`, {
    filter: { property: 'tmdb_id', number: { equals: tmdbId } }
  });
  return r.results.length > 0;
}

async function save(e) {
  return notion('POST', '/pages', {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      'Titolo':       { title:      [{ text: { content: e.title } }] },
      'Regista':      { rich_text:  [{ text: { content: e.director } }] },
      'Anno':         { number:     e.year },
      'Categoria':    { select:     { name: e.category } },
      'Piattaforma':  { rich_text:  [{ text: { content: e.platform } }] },
      'Data uscita':  { date:       { start: e.releaseDate } },
      'tmdb_id':      { number:     e.tmdbId },
      'Sinossi IT':   { rich_text:  [{ text: { content: e.synIT.slice(0,2000) } }] },
      'Sinossi EN':   { rich_text:  [{ text: { content: e.synEN.slice(0,2000) } }] },
      'URL Locandina':{ url:        e.poster || null },
      'Verificato':   { checkbox:   false },
      'Approvato':    { checkbox:   false },
      'Pubblicato':   { checkbox:   false }
    }
  });
}

function postText(e) {
  const tags = ['#horror','#horrormovies','#horrorfilm',
    '#'+e.category.toLowerCase(),
    e.platform !== 'Cinema' ? '#'+e.platform.toLowerCase().replace(/[^a-z0-9]/g,'') : ''
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

async function pushTelegram(text, poster) {
  const ep = poster ? 'sendPhoto' : 'sendMessage';
  const body = poster
    ? { chat_id: TG_CHAT, photo: poster, caption: text.slice(0,1024) }
    : { chat_id: TG_CHAT, text };
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

async function summary(entries) {
  const hdr = `☠️ HORROR BULLETIN — ${new Date(tY, tM-1).toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase()}\n\n${entries.length} uscite horror in arrivo:\n\n`
    + entries.map((e,i)=>`${i+1}. ${e.title} (${e.category} — ${e.platform}) — ${e.releaseDate}`).join('\n')
    + '\n\n#horror #horrorbulletin';
  await pushTelegram(hdr, null);
  await pushDiscord(hdr, null);
}

async function main() {
  // Fetch film e serie horror
  const [mRes, sRes] = await Promise.all([
    tmdb(`/discover/movie?with_genres=27&primary_release_date.gte=${dFrom}&primary_release_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`),
    tmdb(`/discover/tv?with_genres=27&first_air_date.gte=${dFrom}&first_air_date.lte=${dTo}&sort_by=popularity.desc&language=it-IT&page=1`)
  ]);

  const movies = (mRes.results||[]).map(m=>({...m, _type:'movie'}));
  const series = (sRes.results||[]).map(s=>({...s, _type:'tv', title:s.name, release_date:s.first_air_date}));
  const all = [...movies, ...series];
  console.log(`Found ${movies.length} movies, ${series.length} series`);

  const saved = [];

  for (const item of all) {
    try {
      if (await alreadySaved(item.id)) { console.log(`Skip: ${item.title}`); continue; }

      const [det, detEN] = await Promise.all([
        tmdb(`/${item._type}/${item.id}?language=it-IT&append_to_response=watch/providers,credits`),
        tmdb(`/${item._type}/${item.id}?language=en-US`)
      ]);

      const wp   = det['watch/providers'];
      const plat = platform(wp);
      const cat  = category(plat);
      const dir  = item._type === 'movie'
        ? (det.credits?.crew?.find(c=>c.job==='Director')?.name || 'N/D')
        : (det.created_by?.map(c=>c.name).join(', ') || 'N/D');

      const entry = {
        title:       det.title || det.name,
        director:    dir,
        year:        new Date(det.release_date||det.first_air_date).getFullYear(),
        category:    cat,
        platform:    plat,
        releaseDate: det.release_date || det.first_air_date,
        tmdbId:      item.id,
        synIT:       det.overview || '',
        synEN:       detEN.overview || '',
        poster:      det.poster_path ? TMDB_IMG + det.poster_path : null
      };

      await save(entry);
      saved.push(entry);
      console.log(`Saved: ${entry.title}`);
      await new Promise(r=>setTimeout(r,350));

    } catch(err) {
      console.error(`Error [${item.title}]: ${err.message}`);
    }
  }

  if (!saved.length) { console.log('No new entries.'); return; }

  await summary(saved);
  console.log(`Done — ${saved.length} entries saved to Notion. Awaiting approval before individual push.`);
}

main().catch(err=>{ console.error('Fatal:', err); process.exit(1); });
