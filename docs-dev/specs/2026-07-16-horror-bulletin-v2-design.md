# Horror Bulletin v2 — Refactoring + Social Kit + predisposizione autoposting

**Data**: 2026-07-16
**Stato**: approvato (brainstorming con Mirko, sessione Claude Code)

## Obiettivo

Rifattorizzare il progetto mantenendo il vincolo fondante (costo 0 €/mese, GitHub Pages, zero build),
reintegrare la pagina Social con template di post scaricabili per X, Facebook, Instagram, Threads e TikTok,
e predisporre l'autoposting futuro senza API a pagamento.

## Contesto

- Il sito attuale (`docs/index.html`) ha solo Bulletin + Archivio; la vecchia pagina Social
  (copy per 5 social + slide TikTok canvas 1080×1920) sopravvive nel file orfano `docs/docs/index.html`.
- L'admin panel via Cloudflare Worker non esiste più: resta solo il bottone 🔑 e `WORKER_URL` nel frontend.
  Decisione: **Notion è l'admin panel** (flag Approvato/Pubblicato); il residuo Worker va rimosso.
- Pipeline esistente invariata: `fetch_horror.js` (cron mensile TMDB+TVMaze → Notion → Telegram/Discord),
  `sync_data.js` (Notion → `docs/data.json` ogni 2h).

## A. Struttura repo e pulizia

```
horror-bulletin/
├── .github/workflows/
│   ├── horror-bulletin.yml      → invariato (cron mensile)
│   ├── sync-data.yml            → invariato (sync 2h)
│   └── publish.yml              → NUOVO: autoposting, workflow_dispatch
├── docs/                        → GitHub Pages
│   ├── index.html               → solo markup
│   ├── styles.css               → CSS estratto
│   ├── app.js                   → load data, Bulletin, Archivio
│   ├── formatters.js            → post per i 5 social — fonte unica di verità, gira in browser e Node
│   ├── social.js                → pagina Social: copy one-move, share, ZIP
│   ├── vendor/jszip.min.js      → unica dipendenza, vendorizzata
│   └── data.json                → schema invariato, nessuna migrazione
├── fetch_horror.js              → resta in root (i workflow lo puntano lì)
├── sync_data.js                 → resta in root
├── publish.js                   → NUOVO: motore autoposting (adapter per social)
├── test/formatters.test.js      → node --test, zero framework
└── README.md                    → riscritto (oggi 44 byte)
```

Pulizia: eliminare `docs/docs/` (dopo recupero logica Social), rimuovere bottone 🔑 + `WORKER_URL`
+ `changeApiKey()` dal frontend.

## B. Pagina Social — one-move copy + ZIP

Tab **Social** nel nav + bottone "📋 Post" su ogni card approvata che porta al tab con la voce selezionata.
Solo le voci `approvato` sono postabili (come nella versione storica).

### One-move copy, per social (verificato: minimo di mosse possibile per piattaforma)

| Social | Mosse | Meccanismo |
|---|---|---|
| X | 1 copia + 1 incolla | `ClipboardItem` multi-formato (`text/plain` ≤280 char + `image/png` locandina); il composer X accetta immagini incollate |
| Facebook | 1 copia + 1 incolla | idem, testo lungo con sinossi IT completa |
| Threads | 1 copia + 1 incolla | idem, testo ≤500 char |
| Instagram | 1 gesto + 1 incolla (floor di piattaforma) | Bottone unico: caption+hashtag negli appunti **e** immagine via Web Share (mobile) o download (desktop). IG ignora le caption da app terze (policy 2015) e non accetta paste di immagini: non esiste workaround client-side |
| TikTok | 1 click + upload+incolla (floor di piattaforma) | Bottone unico: scarica slide 1080×1920 (canvas, ripresa dalla versione storica) + caption negli appunti |

- **Check di implementazione obbligatorio**: verificare a mano che X/FB/Threads accettino il paste
  combinato testo+immagine; se un composer prende solo l'immagine, fallback = due bottoni (testo / immagine).
- Mobile: bottone "📤 Condividi" con `navigator.share({files, text})` — share sheet nativa.
  Le immagini TMDB (`image.tmdb.org`) servono CORS aperto: canvas → PNG blob funziona.
- Fallback: clipboard negato → textarea con testo preselezionato; `navigator.share` assente → solo copia;
  poster mancante → post/slide senza immagine.

### ZIP bulk

Checkbox sulle card approvate + "Scarica ZIP selezione". Per ogni film una cartella:
`x.txt`, `facebook.txt`, `instagram.txt`, `threads.txt`, `tiktok.txt`, `poster.jpg`, `slide.png`.
Generazione client-side con JSZip vendorizzato.

## C. Predisposizione autoposting (workaround: API ufficiali gratuite via GitHub Actions)

Principio: l'autoposting non passa dal browser ma da **GitHub Actions**, dove i secrets già vivono
(Telegram/Discord funzionano così oggi). Nessun Worker, nessun servizio a pagamento.

- `publish.js`: legge `data.json`, filtra `approvato && !pubblicato`, formatta con `docs/formatters.js`
  (stessi formatter del frontend), e per ogni social con secret configurato chiama l'adapter.
  Al successo flagga `Pubblicato` su Notion.
- `publish.yml`: `workflow_dispatch`, slot secrets documentati e commentati. Adapter senza secret → skip con log.
- Attivazione futura a costo zero, documentata nel README:
  - **X**: API free tier — 500 post/mese in scrittura, sufficiente per un bulletin mensile
  - **Facebook Pages / Instagram / Threads**: Graph API di Meta, gratuite; servono account business/creator
    e app Meta (burocrazia una tantum). È anche l'unica vera "one-move" per Instagram
  - **TikTok**: resta manuale (Content Posting API richiede audit)
- Se un domani si vorranno API commerciali (Buffer, Ayrshare…), l'adapter in `publish.js` è il punto d'innesto.

## D. Error handling e verifica

- Test `node --test` su `formatters.js`: limiti caratteri X (280) e Threads (500), presenza hashtag,
  campi mancanti (director/poster/sinossi null).
- `publish.js`: errori per-social non bloccanti (un adapter che fallisce non ferma gli altri); exit code ≠0
  solo se tutti falliscono.
- Verifica finale sul sito live GitHub Pages dopo il deploy.

## E. Addendum 2026-07-17 (da discussione /btw)

1. **Bulletin = solo mese corrente.** La dashboard Bulletin mostra solo le voci con `releaseDate` nel mese
   corrente (filtro client-side su YYYY-MM); l'Archivio continua a mostrare tutto. Stats della pagina
   Bulletin calcolate sul sottoinsieme del mese.
2. **Verifica duplicazione titoli.** Dati reali: 18 gruppi duplicati (stesso titolo+categoria, date entro
   ~60 giorni — il cron mensile ripesca film con data slittata). Fix su due livelli:
   - **Radice** (`fetch_horror.js`): il check `exists()` passa da titolo+data esatta a titolo (query Notion)
     + confronto locale categoria e finestra di 90 giorni.
   - **Sanatoria** (`sync_data.js`): dedupe all'export via modulo condiviso `dedupe.js` (root, testato con
     node --test): gruppi per titolo normalizzato+categoria con date entro 90 giorni → si tiene la voce con
     `pubblicato`, poi `approvato`, poi data più recente. Le riedizioni a distanza di anni restano voci distinte.

## Fuori scope

- Migrazione a framework/build (Next.js scartato: sovradimensionato per una vetrina di data.json)
- Ripristino admin panel / Cloudflare Worker
- Social oltre i 5 scelti (Bluesky, Mastodon, Reddit, YouTube Community: proposti e scartati da Mirko)
- Implementazione effettiva degli adapter di pubblicazione (solo predisposizione + doc di attivazione)
