// fetch_horror.js
// Eseguito da GitHub Actions il 28 di ogni mese alle 01:00
// Recupera uscite horror da TMDB, verifica via web, salva su Notion, pusha su Telegram e Discord

const TMDB_KEY = process.env.TMDB_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const NOTION_BASE = 'https://api.notion.com/v1';

// Calcola mese e anno target (mese successivo)
const now = new Date();
const targetMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
const targetYear = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
const dateFrom = `${targetYear}-${String(targetMonth).padStart(2,'0')}-01`;
const dateTo = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${new Date(targetYear, targetMonth, 0).getDate()}`;

console.log(`Fetching horror releases for ${targetYear}-${targetMonth} (${dateFrom} → ${dateTo})`);

async function fetchTMDB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB error: ${res.status} ${url}`);
  return res.json();
}

async function notionRequest(method, path, body) {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion error: ${res.status} ${err}`);
  }
  return res.json();
}

// Recupera film horror in uscita nel mese target
async function fetchHorrorMovies() {
  const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}&with_genres=27&primary_release_date.gte=${dateFrom}&primary_release_date.lte=${dateTo}&sort_by=popularity.desc&language=it-IT&page=1`;
  const data = await fetchTMDB(url);
  return data.results || [];
}

// Recupera serie horror in uscita nel mese target
async function fetchHorrorSeries() {
  const url = `${TMDB_BASE}/discover/tv?api_key=${TMDB_KEY}&with_genres=27&first_air_date.gte=${dateFrom}&first_air_date.lte=${dateTo}&sort_by=popularity.desc&language=it-IT&page=1`;
  const data = await fetchTMDB(url);
  return data.results || [];
}

// Dettagli completi per film (usa ID univoco — evita ambiguità)
async function fetchMovieDetails(id) {
  const url = `${TMDB_BASE}/movie/${id}?api_key=${TMDB_KEY}&language=it-IT&append_to_response=watch/providers,release_dates`;
  return fetchTMDB(url);
}

// Dettagli completi per serie
async function fetchSeriesDetails(id) {
  const url = `${TMDB_BASE}/tv/${id}?api_key=${TMDB_KEY}&language=it-IT&append_to_response=watch/providers`;
  return fetchTMDB(url);
}

// Sinossi in inglese (per il post bilingue)
async function fetchEnglishOverview(id, type) {
  const url = `${TMDB_BASE}/${type}/${id}?api_key=${TMDB_KEY}&language=en-US`;
  const data = await fetchTMDB(url);
  return data.overview || '';
}

// Determina piattaforma di streaming per l'Italia
function getPlatform(watchProviders, releaseType) {
  const it = watchProviders?.results?.IT;
  if (!it) return 'Cinema';
  if (it.flatrate?.length) return it.flatrate.map(p => p.provider_name).join(' / ');
  if (it.rent?.length) return 'VOD — ' + it.rent[0].provider_name;
  if (it.buy?.length) return 'VOD — ' + it.buy[0].provider_name;
  return 'Cinema';
}

// Determina categoria
function getCategory(platform, releaseType) {
  if (platform.startsWith('VOD')) return 'VOD';
  if (platform === 'Cinema') return 'Cinema';
  return 'Streaming';
}

// Controlla se il titolo esiste già su Notion (evita duplicati)
async function existsOnNotion(tmdbId) {
  const res = await notionRequest('POST', '/databases/' + NOTION_DB_ID + '/query', {
    filter: { property: 'ID TMDB', number: { equals: tmdbId } }
  });
  return res.results.length > 0;
}

// Salva una voce su Notion
async function saveToNotion(entry) {
  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      'Titolo':       { title: [{ text: { content: entry.title } }] },
      'Regista':      { rich_text: [{ text: { content: entry.director } }] },
      'Anno':         { number: entry.year },
      'Categoria':    { select: { name: entry.category } },
      'Piattaforma':  { rich_text: [{ text: { content: entry.platform } }] },
      'Data uscita':  { date: { start: entry.releaseDate } },
      'ID TMDB':      { number: entry.tmdbId },
      'Sinossi IT':   { rich_text: [{ text: { content: entry.synopsisIT } }] },
      'Sinossi EN':   { rich_text: [{ text: { content: entry.synopsisEN } }] },
      'URL Locandina':{ url: entry.posterUrl },
      'Verificato':   { checkbox: false },
      'Approvato':    { checkbox: false },
      'Pubblicato':   { checkbox: false }
    }
  };
  return notionRequest('POST', '/pages', body);
}

// Formatta il post bilingue
function formatPost(entry) {
  const tags = ['#horror', '#horrormovies', '#horrorfilm',
    '#' + entry.category.toLowerCase().replace(' ',''),
    entry.platform !== 'Cinema' ? '#' + entry.platform.toLowerCase().replace(/[^a-z0-9]/g,'') : ''
  ].filter(Boolean).join(' ');

  return `🎬 ${entry.title} (${entry.year})
📽️ Regia / Dir.: ${entry.director}
📅 Uscita mondiale / World Release: ${entry.releaseDate}
🏷️ ${entry.category}
📺 ${entry.platform}

🇮🇹 SINOSSI
${entry.synopsisIT || 'Sinossi non disponibile.'}

🇬🇧 SYNOPSIS
${entry.synopsisEN || 'Synopsis not available.'}

${tags}`;
}

// Push su Telegram
async function pushTelegram(text, posterUrl) {
  if (posterUrl) {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, photo: posterUrl, caption: text, parse_mode: 'HTML' })
    });
  } else {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' })
    });
  }
}

// Push su Discord
async function pushDiscord(text, posterUrl) {
  const body = {
    content: text,
    embeds: posterUrl ? [{ image: { url: posterUrl } }] : []
  };
  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// Messaggio riepilogativo di inizio mese
async function pushMonthSummary(entries) {
  const header = `☠️ HORROR BULLETIN — ${new Date(targetYear, targetMonth-1).toLocaleString('it-IT',{month:'long',year:'numeric'}).toUpperCase()}\n\n${entries.length} uscite horror in arrivo:\n\n` +
    entries.map((e,i) => `${i+1}. ${e.title} (${e.category} — ${e.platform}) — ${e.releaseDate}`).join('\n') +
    '\n\n#horror #horrorbulletin';
  await pushTelegram(header, null);
  await pushDiscord(header, null);
}

// MAIN
async function main() {
  try {
    console.log('Fetching movies...');
    const [movies, series] = await Promise.all([fetchHorrorMovies(), fetchHorrorSeries()]);
    console.log(`Found ${movies.length} movies, ${series.length} series`);

    const all = [
      ...movies.map(m => ({ ...m, mediaType: 'movie' })),
      ...series.map(s => ({ ...s, mediaType: 'tv', title: s.name, release_date: s.first_air_date }))
    ];

    const processed = [];

    for (const item of all) {
      try {
        // Controlla duplicati
        const exists = await existsOnNotion(item.id);
        if (exists) { console.log(`Skip (exists): ${item.title}`); continue; }

        // Dettagli completi via ID univoco
        const details = item.mediaType === 'movie'
          ? await fetchMovieDetails(item.id)
          : await fetchSeriesDetails(item.id);

        const synIT = details.overview || '';
        const synEN = await fetchEnglishOverview(item.id, item.mediaType);
        const providers = details['watch/providers'];
        const platform = getPlatform(providers, item.mediaType);
        const category = getCategory(platform, item.mediaType);
        const director = item.mediaType === 'movie'
          ? (details.credits?.crew?.find(c => c.job === 'Director')?.name || 'N/D')
          : (details.created_by?.map(c => c.name).join(', ') || 'N/D');

        const entry = {
          title: details.title || details.name,
          director,
          year: new Date(details.release_date || details.first_air_date).getFullYear(),
          category,
          platform,
          releaseDate: details.release_date || details.first_air_date,
          tmdbId: item.id,
          synopsisIT: synIT,
          synopsisEN: synEN,
          posterUrl: details.poster_path ? TMDB_IMG + details.poster_path : null
        };

        await saveToNotion(entry);
        processed.push(entry);
        console.log(`Saved: ${entry.title}`);

        // Pausa per rispettare rate limit TMDB
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`Error processing ${item.title}:`, err.message);
      }
    }

    if (processed.length === 0) {
      console.log('No new entries to push.');
      return;
    }

    // Push riepilogo mensile
    await pushMonthSummary(processed);

    // Push singolo per ogni voce approvata (in questo run tutte vanno in Notion come "da approvare")
    // Il push individuale avviene dall'app web dopo approvazione manuale
    console.log(`Done. ${processed.length} entries saved to Notion. Awaiting manual approval before individual push.`);

  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
