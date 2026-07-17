# ☠ Horror Bulletin

Bulletin gratuito e autonomo sulle uscite horror (cinema, streaming, VOD, home video, serie TV),
con archivio storico, kit di post preformattati per i social e push automatico su Telegram e Discord.

**Sito**: https://ainsoph87.github.io/horror-bulletin/ · **Costo infrastruttura: 0 €/mese**

## Architettura

```
TMDB + TVMaze ──(fetch_horror.js, cron il 28 del mese)──▶ Notion DB ──▶ push Telegram + Discord
                                                             │
                                              (sync_data.js, ogni 2 ore)
                                                             ▼
                                                      docs/data.json ──▶ GitHub Pages
```

Le voci si approvano dalla pagina **Review** del sito (o da Notion, spuntando i flag a mano).
Solo le voci `Approvato` compaiono nella pagina Social.

## Pagina Review — approvazione da sito

La tab Review elenca le voci da approvare (e le approvate, per revocarle) e scrive su Notion
tramite il Cloudflare Worker in `worker/` — il token Notion non tocca mai il browser.
Serve la API Key del worker, impostabile col bottone 🔑 (salvata in localStorage).

Deploy/aggiornamento del worker (free tier Cloudflare, una tantum):

```bash
cd worker
npx wrangler login                      # prima volta
npx wrangler deploy                     # sovrascrive horror-bulletin-api (stesso URL)
npx wrangler secret put NOTION_TOKEN    # token integrazione Notion
npx wrangler secret put API_KEY         # chiave a tua scelta, la stessa del bottone 🔑
```

Contratto: `POST /update` con header `X-Api-Key` e body
`{ "id": "<notion page id>", "props": { "approvato": true } }`
(accetta anche `pubblicato` e `verificato`). L'aggiornamento è ottimistico lato UI;
`data.json` si riallinea al sync successivo (max 2 ore).

## Struttura

| File | Responsabilità |
|---|---|
| `fetch_horror.js` | Cron mensile: fetch TMDB+TVMaze → Notion → push Telegram/Discord |
| `sync_data.js` | Notion → `docs/data.json` (ogni 2h, con dedup) |
| `dedupe.js` | Rimozione duplicati (stesso titolo+categoria entro 90 giorni) |
| `publish.js` | Autoposting via GitHub Actions (predisposizione, vedi sotto) |
| `docs/index.html` | Markup del sito (GitHub Pages) |
| `docs/styles.css` | Stili |
| `docs/app.js` | Bulletin (solo mese corrente) + Archivio |
| `docs/formatters.js` | Testi post per i 5 social — fonte unica, gira in browser e Node |
| `docs/social.js` | Pagina Social: one-move copy, share, slide TikTok, ZIP |
| `docs/review.js` | Pagina Review: approvazione voci da sito (via worker) |
| `worker/worker.js` | Cloudflare Worker: PATCH sicuro dei flag Notion |
| `docs/vendor/jszip.min.js` | Unica dipendenza, vendorizzata |

## Pagina Social — one-move copy

| Social | Mosse | Come funziona |
|---|---|---|
| 𝕏 / Twitter | 1 copia + 1 incolla | Un click copia testo (≤280) **e** locandina insieme; il composer accetta l'incolla combinato |
| Facebook | 1 copia + 1 incolla | Idem, con post lungo e sinossi integrale |
| Threads | 1 copia + 1 incolla | Idem, testo ≤500 |
| Instagram | 1 click + 1 incolla | IG ignora le caption di terze parti (policy) e non accetta paste di immagini: il click copia la caption **e** scarica la locandina |
| TikTok | 1 click + upload | Il click copia la caption **e** scarica la slide 1080×1920 |

Su mobile il bottone **📤 Condividi** apre la share sheet nativa con immagine + testo
(la caption viene comunque copiata negli appunti, perché Instagram la scarta).

**ZIP bulk**: checkbox sulle card approvate nel Bulletin → "Scarica ZIP selezione" nella pagina Social.
Per ogni film: `x.txt`, `facebook.txt`, `instagram.txt`, `threads.txt`, `tiktok.txt`, `poster.png`, `slide.png`.

Se la copia combinata testo+immagine non funziona nel tuo browser (dipende dal composer e da
eventuali estensioni), degrada automaticamente a copia solo-testo.

## Autoposting (§Autoposting)

`publish.js` + `.github/workflows/publish.yml` sono la predisposizione: leggono le voci
`approvato && !pubblicato`, le formattano con gli stessi formatter del sito e le passano agli
adapter. **Nessuna API a pagamento**: si usano le API ufficiali gratuite. Ogni social si attiva
in tre passi:

1. Ottieni le credenziali (sotto)
2. Aggiungile come secrets del repo e decommenta le righe corrispondenti in `publish.yml`
3. Implementa l'adapter in `publish.js` (la funzione `publish(text, item)` del social)

| Social | Costo | Setup credenziali |
|---|---|---|
| X | Gratis (free tier: 500 post/mese) | developer.x.com → progetto free → API key/secret + access token/secret |
| Facebook Pages | Gratis | developers.facebook.com → app → Page Access Token della pagina |
| Instagram | Gratis | Account business/creator collegato a una pagina FB → stessa app Meta → `IG_USER_ID` |
| Threads | Gratis | App Meta con Threads API → token + user id |
| TikTok | — | Resta manuale (la Content Posting API richiede audit): usa la pagina Social |

Il run si lancia da Actions → "Publish to socials" (`workflow_dispatch`); per automatizzarlo
dopo il cron mensile, decommenta lo `schedule` in `publish.yml`. Al successo la voce viene
flaggata `Pubblicato` su Notion. Se un domani servissero API commerciali (Buffer, Ayrshare…),
l'adapter è lo stesso punto d'innesto.

## Sviluppo

```bash
node --test                     # test formatter + dedup
npx http-server docs -p 8787    # serve il sito in locale
node publish.js                 # dry-run autoposting (senza secrets: skip di tutti gli adapter)
```

Secrets usati dai workflow esistenti: `TMDB_API_KEY`, `NOTION_TOKEN`, `NOTION_DB_ID`,
`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK`.
