# Horror Bulletin v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactoring modulare del sito statico + pagina Social con one-move copy e ZIP bulk + predisposizione autoposting via GitHub Actions.

**Architecture:** Sito statico su GitHub Pages (`docs/`), zero build. `formatters.js` è la fonte unica dei testi post (UMD: browser + Node). `social.js` gestisce copy/share/ZIP client-side. `publish.js` + `publish.yml` predispongono l'autoposting server-side con adapter per social.

**Tech Stack:** HTML/CSS/JS vanilla, JSZip (vendorizzato), Node 20 (`node --test`), GitHub Actions.

## Global Constraints

- Costo 0 €/mese: nessun servizio a pagamento, nessuna dipendenza npm, nessun build step
- `docs/` è la root di GitHub Pages: NON mettere file di sviluppo lì dentro
- Schema `docs/data.json` invariato (campi: id, title, director, year, category, tipo, platform, releaseDate, originalYear, synIT, synEN, poster, verificato, approvato, pubblicato)
- `fetch_horror.js` e `sync_data.js` restano in root; si modificano SOLO per la dedup (Task 8)
- Limiti testo: X ≤ 280 caratteri, Threads ≤ 500 caratteri
- Lingua UI: italiano; post bilingui IT/EN dove c'è spazio
- Branch di lavoro: `v2-refactor`
- Palette e stile: quelli esistenti in `docs/index.html` (dark, rosso #c0392b)

---

### Task 1: formatters.js con test (fonte unica dei post)

**Files:**
- Create: `docs/formatters.js`
- Create: `test/formatters.test.js`

**Interfaces:**
- Produces: globale browser `HBFormatters` / modulo Node con: `SOCIALS` (array `{id, label, hint, format}`), `format(id, item) → string`, `formatDate(iso) → string`, `CAT_EMOJI` (mappa categoria→emoji). `item` è una voce di data.json.

- [ ] **Step 1: Scrivere i test (falliscono: modulo inesistente)**

`test/formatters.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const F = require('../docs/formatters.js');

const item = {
  id: 'abc', title: 'The Thing', director: 'John Carpenter', year: 2026,
  category: 'Cinema', tipo: 'Riedizione', platform: 'UCI Cinemas',
  releaseDate: '2026-08-15', synIT: 'S'.repeat(400), synEN: 'E'.repeat(400),
  poster: 'https://image.tmdb.org/t/p/w500/x.jpg'
};

test('SOCIALS contiene i 5 social nell\'ordine giusto', () => {
  assert.deepStrictEqual(F.SOCIALS.map(s => s.id), ['x', 'facebook', 'instagram', 'threads', 'tiktok']);
});

test('X rispetta 280 caratteri', () => {
  assert.ok(F.format('x', item).length <= 280);
});

test('Threads rispetta 500 caratteri', () => {
  assert.ok(F.format('threads', item).length <= 500);
});

test('ogni post contiene titolo e #horror', () => {
  for (const s of F.SOCIALS) {
    const t = F.format(s.id, item);
    assert.ok(t.includes('The Thing'), s.id + ': manca il titolo');
    assert.ok(t.includes('#horror'), s.id + ': manca #horror');
  }
});

test('facebook contiene sinossi IT integrale', () => {
  assert.ok(F.format('facebook', item).includes(item.synIT));
});

test('campi mancanti non producono null/undefined nel testo', () => {
  const vuoto = { id: 'x', title: 'Senza Nulla' };
  for (const s of F.SOCIALS) {
    const t = F.format(s.id, vuoto);
    assert.ok(!/null|undefined/.test(t), s.id + ': ' + t);
  }
});

test('formatDate gestisce null', () => {
  assert.strictEqual(F.formatDate(null), 'N/D');
});
```

- [ ] **Step 2: Verificare che falliscano** — Run: `node --test test/` — Expected: FAIL (Cannot find module)

- [ ] **Step 3: Implementare `docs/formatters.js`**

```js
// formatters.js — fonte unica dei post social. Gira in browser (HBFormatters) e in Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HBFormatters = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const CAT_EMOJI = { 'Cinema':'🎟️','Streaming':'📡','VOD':'🎞️','Home Video':'📀','Serie TV':'📺' };

  function formatDate(d) {
    if (!d) return 'N/D';
    return new Date(d).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' });
  }

  const clean = v => v == null ? '' : String(v);
  const emoji = d => CAT_EMOJI[d.category] || '☠️';
  const catTag = d => d.category ? '#' + d.category.toLowerCase().replace(/\s/g, '') : '';
  const tipoTag = d => d.tipo === 'Riedizione' ? '#rerelease' : '#newrelease';
  const header = d => `${emoji(d)} ${clean(d.title)}${d.year ? ` (${d.year})` : ''}`;
  const anagrafica = d => [
    d.director ? `🎥 Regia / Dir.: ${d.director}` : '',
    d.releaseDate ? `📅 Uscita: ${formatDate(d.releaseDate)}` : '',
    `📺 ${[d.category, d.platform].filter(Boolean).join(' — ')}`
  ].filter(Boolean).join('\n');
  const cut = (t, max) => t.length > max ? t.slice(0, max - 1) + '…' : t;

  const FORMATS = {
    x(d) {
      const t = [header(d), d.director ? `Dir. ${d.director}` : '',
        [formatDate(d.releaseDate), d.platform || d.category].filter(Boolean).join(' · '),
        '', ['#horror', catTag(d)].filter(Boolean).join(' ')].filter(s => s !== '').join('\n');
      return cut(t, 280);
    },
    facebook(d) {
      return [header(d), '', anagrafica(d), '',
        clean(d.synIT || d.synEN), '',
        ['#horror', '#horrormovies', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },
    instagram(d) {
      return [header(d), '', clean(d.synIT || d.synEN), '.', '.', '.',
        ['#horror','#horrormovies','#horrorfilm','#horrorcommunity','#horrorlovers','#horrorfan',
         '#scary','#spooky','#cinephile','#moviestowatch', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').trim();
    },
    threads(d) {
      const t = [header(d),
        [d.director ? `Dir. ${d.director}` : '', formatDate(d.releaseDate)].filter(Boolean).join(' · '),
        clean(d.platform || d.category), '',
        cut(clean(d.synIT || d.synEN), 200), '',
        ['#horror', catTag(d)].filter(Boolean).join(' ')].filter(s => s !== '').join('\n');
      return cut(t, 500);
    },
    tiktok(d) {
      return [header(d), d.director ? `Dir. ${d.director}` : '',
        [formatDate(d.releaseDate), d.platform || d.category].filter(Boolean).join(' · '), '',
        ['#horror','#horrortok','#fyp','#horrormovies','#scary', catTag(d)].filter(Boolean).join(' ')
      ].filter(s => s !== '').join('\n');
    }
  };

  const SOCIALS = [
    { id:'x',         label:'𝕏 / Twitter',  hint:'≤280 char — 1 incolla (testo+immagine)', format: FORMATS.x },
    { id:'facebook',  label:'📘 Facebook',   hint:'Post lungo — 1 incolla (testo+immagine)', format: FORMATS.facebook },
    { id:'instagram', label:'📷 Instagram',  hint:'Caption copiata + immagine da caricare', format: FORMATS.instagram },
    { id:'threads',   label:'🧵 Threads',    hint:'≤500 char — 1 incolla (testo+immagine)', format: FORMATS.threads },
    { id:'tiktok',    label:'🎵 TikTok',     hint:'Caption copiata + slide scaricata', format: FORMATS.tiktok }
  ];

  return { SOCIALS, CAT_EMOJI, formatDate, format: (id, d) => FORMATS[id](d) };
});
```

- [ ] **Step 4: Verificare che passino** — Run: `node --test test/` — Expected: 7 pass
- [ ] **Step 5: Commit** — `git add docs/formatters.js test/ && git commit -m "feat: formatters condivisi per i 5 social con test"`

---

### Task 2: Split del frontend + pulizia residui

**Files:**
- Modify: `docs/index.html` (riscritto: solo markup + script tags)
- Create: `docs/styles.css` (CSS estratto)
- Create: `docs/app.js` (JS estratto: load/render Bulletin+Archivio)
- Delete: `docs/docs/` (versione orfana — la logica Social utile è già recuperata nel piano)

**Interfaces:**
- Produces: `window.HB = { DATA, formatDate, showPage, showToast, CAT_BADGE }` usato da `social.js` (Task 3); markup con tab `social` e pagina `page-social` vuota (placeholder riempito da Task 3); su ogni card approvata bottone `📋 Post` che chiama `HBSocial.open(id)`.

- [ ] **Step 1: Estrarre il CSS** — Copiare in `docs/styles.css` il contenuto del tag `<style>` dell'attuale `docs/index.html` (righe 8–88) verbatim, PIÙ le classi social della versione orfana `docs/docs/index.html` (righe 87–95: `.post-section`, `.post-title`, `.post-preview`, `.social-list`, `.social-item`, `.social-name`, `.social-type`, `.social-btn`) e queste nuove:

```css
.card-check{position:absolute;bottom:8px;right:8px;width:20px;height:20px;accent-color:var(--red);cursor:pointer}
.zip-bar{display:flex;align-items:center;gap:12px;margin-bottom:1rem;flex-wrap:wrap}
.zip-btn{padding:8px 16px;border-radius:var(--radius);border:1px solid var(--gold);background:transparent;color:var(--gold3);cursor:pointer;font-size:13px}
.zip-btn:hover{background:rgba(212,160,23,.15)}
.zip-btn:disabled{opacity:.4;cursor:not-allowed}
.one-move{border-color:var(--green2);color:var(--green3)}
.one-move:hover{background:rgba(39,174,96,.15)}
```

- [ ] **Step 2: Estrarre `docs/app.js`** — Copiare il JS dell'attuale `docs/index.html` (righe 172–337) con queste modifiche:
  - RIMUOVERE: `WORKER_URL`, `API_KEY`, `changeApiKey()`
  - `showPage`: tabs `{ bulletin: 0, archivio: 1, social: 2 }`
  - **Bulletin = solo mese corrente** (addendum /btw): in `renderCards()` e `renderStats()` filtrare prima con

```js
const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
const monthItems = () => DATA.items.filter(i => (i.releaseDate || '').startsWith(ym));
```

    `renderCards`/`renderStats` lavorano su `monthItems()`; `renderArchive` e la pagina Social restano su `DATA.items`. Empty state Bulletin: "Nessuna uscita per questo mese."
  - In `loadData()` aggiungere in coda: `if (window.HBSocial) HBSocial.init(DATA);`
  - In `renderCards()`, dentro `card-body`, dopo `card-syn`, aggiungere per le voci approvate:

```js
const postBtn = d.approvato
  ? `<div class="card-actions"><button class="card-btn" onclick='HBSocial.open(${JSON.stringify(d.id)})'>📋 Post Social</button></div>`
  : '';
```

  - Esportare in fondo: `window.HB = { get DATA(){ return DATA; }, formatDate, showPage, showToast, CAT_BADGE };`

- [ ] **Step 3: Riscrivere `docs/index.html`** — Stesso markup attuale ma: `<link rel="stylesheet" href="styles.css">` al posto di `<style>`; nav con terzo tab `Social`; SENZA bottone 🔑; pagina social (markup sotto); in fondo al body:

```html
<div id="page-social" class="page">
  <div class="bulletin-header"><div class="bulletin-title">Social — Post preformattati</div></div>
  <div class="post-section">
    <div class="post-title">Voce approvata</div>
    <select class="form-select" id="post-select" style="width:100%;max-width:500px" onchange="HBSocial.select(this.value)">
      <option value="">— Scegli una voce approvata —</option>
    </select>
    <div style="font-size:11px;color:var(--text3);margin-top:6px">Solo le voci con flag <code>Approvato</code> su Notion appaiono qui.</div>
  </div>
  <div class="post-section">
    <div class="post-title">⚡ One-move copy</div>
    <div class="social-list" id="social-buttons"></div>
  </div>
  <div class="post-section">
    <div class="post-title">Anteprima</div>
    <div class="post-preview" id="post-preview">Seleziona una voce per l'anteprima.</div>
    <div id="poster-preview" style="text-align:center;margin-top:12px"></div>
  </div>
  <div class="post-section">
    <div class="post-title">📦 ZIP bulk</div>
    <div class="zip-bar">
      <span style="font-size:12px;color:var(--text2)">Seleziona le card approvate nel Bulletin (checkbox) e scarica tutto.</span>
      <button class="zip-btn" id="zip-btn" onclick="HBSocial.downloadZip()" disabled>⬇ Scarica ZIP selezione (0)</button>
    </div>
  </div>
</div>
<script src="formatters.js"></script>
<script src="social.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 4: Eliminare `docs/docs/`** — `git rm -r docs/docs`
- [ ] **Step 5: Verifica manuale** — Servire `docs/` in locale (`npx http-server docs -p 8787` o equivalente), aprire nel browser: Bulletin e Archivio renderizzano come prima, tab Social esiste, console senza errori (ok l'errore se `social.js` non esiste ancora — crearlo vuoto con `window.HBSocial={init(){},open(){},select(){},downloadZip(){}}` come stub in questo task).
- [ ] **Step 6: Commit** — `git add -A docs && git commit -m "refactor: split index.html in moduli, via residui Worker e docs/docs"`

---

### Task 3: social.js — one-move copy, share, slide TikTok

**Files:**
- Modify: `docs/social.js` (da stub a implementazione)

**Interfaces:**
- Consumes: `HBFormatters` (Task 1), `window.HB` (Task 2)
- Produces: `window.HBSocial = { init(data), open(id), select(id), downloadZip(), toggle(id, checked) }`

- [ ] **Step 1: Implementare social.js**

```js
// social.js — pagina Social: one-move copy, share mobile, slide TikTok, ZIP bulk
(function () {
  let currentItem = null;
  const selected = new Set(); // id per ZIP bulk

  const $ = id => document.getElementById(id);
  const F = () => window.HBFormatters;

  function init(DATA) {
    const approved = DATA.items.filter(i => i.approvato);
    $('post-select').innerHTML = '<option value="">— Scegli una voce approvata —</option>' +
      approved.map(d => `<option value="${d.id}">${d.title} (${d.category || '?'}) — ${HB.formatDate(d.releaseDate)}</option>`).join('');
    renderButtons();
  }

  function renderButtons() {
    $('social-buttons').innerHTML = F().SOCIALS.map(s => {
      const oneMove = ['x', 'facebook', 'threads'].includes(s.id);
      return `<div class="social-item">
        <div><div class="social-name">${s.label}</div><div class="social-type">${s.hint}</div></div>
        <button class="social-btn ${oneMove ? 'one-move' : ''}" onclick="HBSocial.copy('${s.id}')">
          ${oneMove ? '⚡ Copia post completo' : s.id === 'tiktok' ? '⚡ Caption + slide' : '⚡ Caption + immagine'}
        </button>
        ${navigator.share ? `<button class="social-btn" onclick="HBSocial.share('${s.id}')">📤 Condividi (mobile)</button>` : ''}
      </div>`;
    }).join('');
  }

  function select(id) {
    currentItem = HB.DATA.items.find(i => i.id === id) || null;
    if (!currentItem) { $('post-preview').textContent = 'Seleziona una voce per l\'anteprima.'; $('poster-preview').innerHTML = ''; return; }
    $('post-preview').textContent = F().format('facebook', currentItem);
    $('poster-preview').innerHTML = currentItem.poster
      ? `<img src="${currentItem.poster}" style="max-width:240px;border-radius:8px" alt="">` : '';
  }

  function open(id) { HB.showPage('social'); $('post-select').value = id; select(id); }

  // ── poster → PNG blob (TMDB ha CORS aperto) ──
  async function posterPng(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise(ok => c.toBlob(ok, 'image/png'));
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }

  async function copy(network) {
    if (!currentItem) { HB.showToast('⚠️ Seleziona prima una voce approvata'); return; }
    const d = currentItem;
    const text = F().format(network, d);
    const combined = ['x', 'facebook', 'threads'].includes(network);

    // ponytail: paste combinato testo+immagine — se il browser rifiuta il multi-tipo, degrada a solo testo
    if (combined && d.poster && navigator.clipboard?.write) {
      try {
        const png = await posterPng(d.poster);
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'image/png': png
        })]);
        HB.showToast('⚡ Post completo copiato (testo+immagine) — incolla e via');
        return;
      } catch (e) { console.warn('combined copy failed, fallback testo:', e); }
    }

    try { await navigator.clipboard.writeText(text); } catch { fallbackCopy(text); }

    if (network === 'instagram' && d.poster) {
      downloadBlob(await posterPng(d.poster).catch(() => null), slug(d) + '-poster.png');
      HB.showToast('⚡ Caption copiata + locandina scaricata — carica e incolla');
    } else if (network === 'tiktok') {
      await downloadSlide(d);
      HB.showToast('⚡ Caption copiata + slide scaricata — carica e incolla');
    } else {
      HB.showToast('✓ Testo copiato per ' + network.toUpperCase());
    }
  }

  async function share(network) {
    if (!currentItem) { HB.showToast('⚠️ Seleziona prima una voce approvata'); return; }
    const d = currentItem;
    const text = F().format(network, d);
    // Instagram ignora il testo condiviso (policy): lo mettiamo comunque negli appunti
    try { await navigator.clipboard.writeText(text); } catch {}
    const payload = { text };
    if (d.poster) {
      const png = await posterPng(d.poster).catch(() => null);
      if (png) payload.files = [new File([png], slug(d) + '.png', { type: 'image/png' })];
    }
    try { await navigator.share(payload); } catch (e) { if (e.name !== 'AbortError') HB.showToast('⚠️ Condivisione non riuscita'); }
  }

  const slug = d => (d.title || 'film').replace(/[^a-z0-9]/gi, '_').toLowerCase();

  function downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  // ── slide TikTok 1080×1920 (ripresa dalla versione storica) ──
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '', cy = y;
    for (let n = 0; n < words.length; n++) {
      const t = line + words[n] + ' ';
      if (ctx.measureText(t).width > maxWidth && n > 0) { ctx.fillText(line.trim(), x, cy); line = words[n] + ' '; cy += lineHeight; }
      else line = t;
    }
    ctx.fillText(line.trim(), x, cy);
  }

  async function slideBlob(d) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, 1080, 1920);

    if (d.poster) {
      try {
        const img = new Image(); img.crossOrigin = 'anonymous';
        await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = d.poster; });
        const ratio = img.width / img.height, h = 1300, w = h * ratio;
        ctx.drawImage(img, (1080 - w) / 2, 120, w, h);
        const grad = ctx.createLinearGradient(0, 1000, 0, 1420);
        grad.addColorStop(0, 'rgba(10,10,15,0)'); grad.addColorStop(1, 'rgba(10,10,15,1)');
        ctx.fillStyle = grad; ctx.fillRect(0, 1000, 1080, 420);
      } catch {}
    }
    ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 100, 1080, 8);
    ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 48px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('☠ HORROR BULLETIN', 540, 80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 72px system-ui';
    wrapText(ctx, d.title || '', 540, 1450, 1000, 80);
    ctx.fillStyle = '#f0c040'; ctx.font = '52px system-ui';
    ctx.fillText(`(${d.year || '—'})`, 540, 1580);
    ctx.fillStyle = '#9090a8'; ctx.font = '36px system-ui';
    ctx.fillText(`Dir. ${d.director || 'N/D'}`, 540, 1660);
    ctx.fillStyle = '#5dade2'; ctx.font = '40px system-ui';
    ctx.fillText(`${HB.formatDate(d.releaseDate)} · ${d.platform || d.category || ''}`, 540, 1730);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 1812, 1080, 8);
    return new Promise(ok => canvas.toBlob(ok, 'image/png'));
  }

  async function downloadSlide(d) { downloadBlob(await slideBlob(d), 'horror-bulletin-' + slug(d) + '-slide.png'); }

  // ── ZIP bulk (Task 4 completa downloadZip) ──
  function toggle(id, checked) {
    checked ? selected.add(id) : selected.delete(id);
    const btn = $('zip-btn');
    btn.disabled = selected.size === 0;
    btn.textContent = `⬇ Scarica ZIP selezione (${selected.size})`;
  }

  window.HBSocial = { init, open, select, copy, share, toggle, downloadZip: () => {}, _internals: { posterPng, slideBlob, slug, selected } };
})();
```

- [ ] **Step 2: Verifica manuale nel browser** — Servire `docs/`, selezionare una voce approvata, provare: ⚡ su X/FB/Threads (toast "testo+immagine" o fallback testo), Instagram (caption+download), TikTok (caption+slide). Console pulita a parte warning attesi.
- [ ] **Step 3: Commit** — `git add docs/social.js && git commit -m "feat: pagina Social con one-move copy, share mobile e slide TikTok"`

---

### Task 4: ZIP bulk con JSZip vendorizzato

**Files:**
- Create: `docs/vendor/jszip.min.js` (JSZip 3.10.1 da cdnjs, vendorizzato)
- Modify: `docs/social.js` (implementare `downloadZip`)
- Modify: `docs/app.js` (checkbox sulle card approvate)
- Modify: `docs/index.html` (script tag vendor)

**Interfaces:**
- Consumes: `HBSocial._internals` (Task 3), `JSZip` globale

- [ ] **Step 1: Vendorizzare JSZip** — `curl -o docs/vendor/jszip.min.js https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js` e aggiungere `<script src="vendor/jszip.min.js"></script>` PRIMA di `social.js` in index.html.

- [ ] **Step 2: Checkbox nelle card (app.js)** — In `renderCards()`, dentro `card-poster` delle voci approvate:

```js
const check = d.approvato
  ? `<input type="checkbox" class="card-check" title="Aggiungi allo ZIP" onclick="event.stopPropagation();HBSocial.toggle(${JSON.stringify(d.id)}, this.checked)">`
  : '';
```

- [ ] **Step 3: Implementare downloadZip in social.js** — sostituire lo stub:

```js
  async function downloadZip() {
    const { selected, posterPng, slideBlob, slug } = window.HBSocial._internals;
    const items = HB.DATA.items.filter(i => selected.has(i.id));
    if (!items.length) return;
    const zip = new JSZip();
    for (const d of items) {
      const dir = zip.folder(slug(d));
      for (const s of F().SOCIALS) dir.file(s.id + '.txt', F().format(s.id, d));
      if (d.poster) {
        const png = await posterPng(d.poster).catch(() => null);
        if (png) dir.file('poster.png', png);
      }
      const slide = await slideBlob(d).catch(() => null);
      if (slide) dir.file('slide.png', slide);
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'horror-bulletin-posts.zip');
    HB.showToast(`✓ ZIP con ${items.length} titoli scaricato`);
  }
```

  e aggiornare l'export: `downloadZip` reale al posto di `() => {}`.

- [ ] **Step 4: Verifica manuale** — Selezionare 2 card approvate → scaricare ZIP → aprirlo: per ogni film cartella con 5 .txt + poster.png + slide.png.
- [ ] **Step 5: Commit** — `git add -A docs && git commit -m "feat: ZIP bulk con JSZip vendorizzato"`

---

### Task 5: publish.js + publish.yml (predisposizione autoposting)

**Files:**
- Create: `publish.js`
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `docs/formatters.js` (require), `docs/data.json`, env secrets

- [ ] **Step 1: publish.js**

```js
// publish.js — predisposizione autoposting. Gira in GitHub Actions (vedi publish.yml).
// Ogni adapter si attiva compilando i secrets: finché mancano, il social viene saltato.
// Guida di attivazione per ciascun social: README §Autoposting.
const F = require('./docs/formatters.js');
const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const N_HDR = { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

// ponytail: adapter non implementati finché non si decide di attivare un social —
// la struttura (env → publish(text, item)) è il punto d'innesto, anche per API commerciali future.
const ADAPTERS = {
  x:         { env: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
               publish: async () => { throw new Error('adapter X non implementato — vedi README §Autoposting'); } },
  facebook:  { env: ['META_PAGE_TOKEN', 'FB_PAGE_ID'],
               publish: async () => { throw new Error('adapter Facebook non implementato — vedi README §Autoposting'); } },
  instagram: { env: ['META_PAGE_TOKEN', 'IG_USER_ID'],
               publish: async () => { throw new Error('adapter Instagram non implementato — vedi README §Autoposting'); } },
  threads:   { env: ['THREADS_TOKEN', 'THREADS_USER_ID'],
               publish: async () => { throw new Error('adapter Threads non implementato — vedi README §Autoposting'); } }
  // tiktok: escluso — Content Posting API richiede audit; flusso manuale via pagina Social
};

async function flagPublished(pageId) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: N_HDR,
    body: JSON.stringify({ properties: { 'Pubblicato': { checkbox: true } } })
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync('docs/data.json', 'utf8'));
  const queue = data.items.filter(i => i.approvato && !i.pubblicato);
  console.log(`In coda: ${queue.length} voci approvate e non pubblicate`);

  const active = Object.entries(ADAPTERS).filter(([id, a]) => {
    const missing = a.env.filter(k => !process.env[k]);
    if (missing.length) { console.log(`- ${id}: SKIP (secrets mancanti: ${missing.join(', ')})`); return false; }
    return true;
  });
  if (!active.length) { console.log('Nessun adapter configurato. Compila i secrets in publish.yml per attivare.'); return; }

  let okCount = 0, failCount = 0;
  for (const item of queue) {
    let allOk = true;
    for (const [id, a] of active) {
      try { await a.publish(F.format(id, item), item); console.log(`✓ ${id}: ${item.title}`); }
      catch (e) { console.error(`✗ ${id}: ${item.title} — ${e.message}`); allOk = false; }
    }
    if (allOk && active.length) { await flagPublished(item.id); okCount++; } else failCount++;
  }
  console.log(`Pubblicati: ${okCount}, falliti: ${failCount}`);
  if (okCount === 0 && failCount > 0) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
```

- [ ] **Step 2: publish.yml**

```yaml
name: Publish to socials
on:
  workflow_dispatch:
  # Per pubblicazione automatica dopo il cron mensile, decommentare:
  # schedule:
  #   - cron: '0 8 1 * *'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Publish approved items
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          # ── Attivazione X (free tier: 500 post/mese) — vedi README §Autoposting ──
          # X_API_KEY: ${{ secrets.X_API_KEY }}
          # X_API_SECRET: ${{ secrets.X_API_SECRET }}
          # X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
          # X_ACCESS_SECRET: ${{ secrets.X_ACCESS_SECRET }}
          # ── Attivazione Meta (Graph API gratuite) ──
          # META_PAGE_TOKEN: ${{ secrets.META_PAGE_TOKEN }}
          # FB_PAGE_ID: ${{ secrets.FB_PAGE_ID }}
          # IG_USER_ID: ${{ secrets.IG_USER_ID }}
          # ── Attivazione Threads ──
          # THREADS_TOKEN: ${{ secrets.THREADS_TOKEN }}
          # THREADS_USER_ID: ${{ secrets.THREADS_USER_ID }}
        run: node publish.js
```

- [ ] **Step 3: Verifica** — Run: `node publish.js` senza env → Expected: log "SKIP (secrets mancanti…)" per ogni adapter + "Nessun adapter configurato", exit 0. (Serve un `docs/data.json` presente: c'è.)
- [ ] **Step 4: Commit** — `git add publish.js .github/workflows/publish.yml && git commit -m "feat: predisposizione autoposting via GitHub Actions"`

---

### Task 6: README

**Files:**
- Modify: `README.md` (riscrittura completa)

- [ ] **Step 1: Scrivere il README** con queste sezioni (contenuto derivato dalla spec `docs-dev/specs/2026-07-16-horror-bulletin-v2-design.md`):
  - Descrizione: bulletin gratuito uscite horror, sito GitHub Pages, costo 0 €/mese
  - Architettura: diagramma pipeline (TMDB/TVMaze → fetch_horror.js cron mensile → Notion → sync_data.js 2h → data.json → GitHub Pages; push Telegram/Discord)
  - Struttura file (tabella: file → responsabilità)
  - Pagina Social: come funziona la one-move copy per social (tabella con le mosse per ciascuno, incluso perché IG/TikTok hanno il floor a 2 mosse), ZIP bulk
  - §Autoposting: stato (predisposizione), guida attivazione per X (developer.x.com, free tier 500 post/mese, 4 secrets), Meta FB/IG (business account + app Meta + Graph API, 3 secrets), Threads (2 secrets); come implementare l'adapter in `publish.js`; nota TikTok manuale
  - Sviluppo: `node --test test/`, serve locale di `docs/`
- [ ] **Step 2: Commit** — `git add README.md && git commit -m "docs: README completo con guida autoposting"`

---

### Task 8: Dedup titoli (addendum /btw)

**Files:**
- Create: `dedupe.js` (root — modulo condiviso, testabile)
- Create: `test/dedupe.test.js`
- Modify: `sync_data.js` (dedup all'export)
- Modify: `fetch_horror.js:128-138` (funzione `exists`: finestra 90 giorni invece di data esatta)

**Interfaces:**
- Produces: `dedupeItems(items) → items` — rimuove i duplicati (stesso titolo normalizzato + categoria, date entro 90 giorni), tenendo la voce con `pubblicato`, poi `approvato`, poi data più recente. Riedizioni a distanza di anni = voci distinte.

- [ ] **Step 1: Test (falliscono)**

`test/dedupe.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const dedupeItems = require('../dedupe.js');

const mk = (title, category, releaseDate, extra = {}) => ({ title, category, releaseDate, ...extra });

test('stesso titolo+categoria entro 90 giorni: resta la data più recente', () => {
  const out = dedupeItems([mk('Hungry', 'Cinema', '2026-06-23'), mk('Hungry', 'Cinema', '2026-07-24')]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].releaseDate, '2026-07-24');
});

test('pubblicato vince sulla data', () => {
  const out = dedupeItems([
    mk('Hungry', 'Cinema', '2026-06-23', { pubblicato: true }),
    mk('Hungry', 'Cinema', '2026-07-24')
  ]);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].pubblicato);
});

test('approvato vince su non approvato', () => {
  const out = dedupeItems([
    mk('Hungry', 'Cinema', '2026-06-23', { approvato: true }),
    mk('Hungry', 'Cinema', '2026-07-24')
  ]);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].approvato);
});

test('categorie diverse non sono duplicati', () => {
  const out = dedupeItems([mk('Scream 7', 'Cinema', '2026-06-25'), mk('Scream 7', 'Home Video', '2026-06-25')]);
  assert.strictEqual(out.length, 2);
});

test('stesso titolo a distanza di anni (riedizione) non è duplicato', () => {
  const out = dedupeItems([mk('The Thing', 'Cinema', '2026-08-15'), mk('The Thing', 'Cinema', '2022-06-17')]);
  assert.strictEqual(out.length, 2);
});

test('titoli con case/spazi diversi sono lo stesso titolo', () => {
  const out = dedupeItems([mk('  hungry ', 'Cinema', '2026-06-23'), mk('Hungry', 'Cinema', '2026-07-24')]);
  assert.strictEqual(out.length, 1);
});
```

- [ ] **Step 2: Run `node --test` → i test dedupe FALLISCONO (modulo mancante)**

- [ ] **Step 3: Implementare `dedupe.js`**

```js
// dedupe.js — rimozione duplicati da cron mensile (stesso film ripescato con data slittata).
// Duplicato = stesso titolo normalizzato + categoria, date entro 90 giorni.
// Si tiene: pubblicato > approvato > data più recente. Riedizioni a distanza di anni restano distinte.
const WINDOW_DAYS = 90;
const norm = t => (t || '').toLowerCase().trim().replace(/\s+/g, ' ');
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
const rank = i => (i.pubblicato ? 4 : 0) + (i.approvato ? 2 : 0);

function dedupeItems(items) {
  const kept = [];
  for (const item of items) {
    const dup = kept.find(k =>
      norm(k.title) === norm(item.title) &&
      (k.category || '') === (item.category || '') &&
      k.releaseDate && item.releaseDate &&
      days(k.releaseDate, item.releaseDate) <= WINDOW_DAYS
    );
    if (!dup) { kept.push(item); continue; }
    const better =
      rank(item) > rank(dup) ||
      (rank(item) === rank(dup) && (item.releaseDate || '') > (dup.releaseDate || ''));
    if (better) kept[kept.indexOf(dup)] = item;
  }
  return kept;
}

module.exports = dedupeItems;
```

- [ ] **Step 4: Run `node --test` → tutti pass**

- [ ] **Step 5: Integrare in `sync_data.js`** — dopo `items.sort(...)`:

```js
const dedupeItems = require('./dedupe.js');
const before = items.length;
const deduped = dedupeItems(items);
if (deduped.length < before) console.log(`Dedup: rimossi ${before - deduped.length} duplicati`);
```

  e usare `deduped` al posto di `items` nella costruzione di `data` (`total: deduped.length, items: deduped`).

- [ ] **Step 6: Allargare `exists()` in `fetch_horror.js`** — sostituire il body: query per solo titolo, poi finestra locale:

```js
async function exists(title, releaseDate) {
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
```

- [ ] **Step 7: Verifica su dati reali** — Run: `node -e "const d=require('./docs/data.json');const dd=require('./dedupe.js');console.log(d.items.length,'->',dd(d.items).length)"` → Expected: da 382 a ~362 (18 gruppi, alcuni con 3 date)
- [ ] **Step 8: Commit** — `git add dedupe.js test/dedupe.test.js sync_data.js fetch_horror.js && git commit -m "fix: dedup titoli duplicati dal cron mensile (radice + sanatoria export)"`

---

### Task 7: Verifica finale e PR

- [ ] **Step 1: Test** — Run: `node --test test/` → Expected: tutti pass
- [ ] **Step 2: Sanity Node/browser dual-mode** — Run: `node -e "const F=require('./docs/formatters.js');console.log(F.SOCIALS.length)"` → Expected: `5`
- [ ] **Step 3: Smoke test browser completo** — Servire `docs/`, verificare: Bulletin, Archivio, Social, one-move copy (X/FB/Threads), IG caption+poster, TikTok caption+slide, ZIP con 2 film, niente errori console
- [ ] **Step 4: Push branch + PR** — `git push -u origin v2-refactor` e `gh pr create` con sintesi delle modifiche. NON mergiare su main (deploya il sito live): merge deciso da Mirko.
