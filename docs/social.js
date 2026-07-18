// social.js — pagina Social: one-move copy, share mobile, slide TikTok, ZIP bulk
(function () {
  let currentItem = null;
  const selected = new Set(); // id per ZIP bulk

  const $ = id => document.getElementById(id);
  const F = () => window.HBFormatters;

  function init(DATA) {
    // settorializzato: categoria prima di tutto, rilevanza dentro la categoria
    const approved = DATA.items.filter(i => i.approvato).sort(HB.byCategory);
    const groups = new Map();
    for (const d of approved) {
      const c = d.category || 'Altro';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(d);
    }
    $('post-select').innerHTML = '<option value="">— Scegli una voce approvata —</option>' +
      [...groups].map(([cat, items]) =>
        `<optgroup label="${cat}">` +
        items.map(d => `<option value="${d.id}">${d.title}${d.rilevanza ? ` 🔥${d.rilevanza}` : ''} — ${HB.formatDate(d.releaseDate)}</option>`).join('') +
        '</optgroup>'
      ).join('');
    $('zip-list').innerHTML = [...groups].map(([cat, items]) =>
      `<div style="font-weight:600;color:var(--text);margin:10px 0 4px">${cat} (${items.length})</div>` +
      items.map(d =>
        `<label style="display:block;cursor:pointer"><input type="checkbox" class="zip-check" data-cat="${cat}" style="accent-color:var(--red);margin-right:8px" onclick='HBSocial.toggle(${JSON.stringify(d.id)}, this.checked)'>${d.title} <span style="color:var(--text3)">(${d.rilevanza ? `🔥${d.rilevanza} — ` : ''}${HB.formatDate(d.releaseDate)})</span></label>`
      ).join('')
    ).join('') || '<div class="empty">Nessuna voce approvata.</div>';
    renderButtons();
  }

  function toggleAll(checked) {
    document.querySelectorAll('#zip-list .zip-check').forEach(c => { c.checked = checked; });
    selected.clear();
    if (checked) HB.DATA.items.filter(i => i.approvato).forEach(i => selected.add(i.id));
    const btn = $('zip-btn');
    btn.disabled = selected.size === 0;
    btn.textContent = `⬇ Scarica ZIP selezione (${selected.size})`;
  }

  function renderButtons() {
    $('social-buttons').innerHTML = F().SOCIALS.map(s => {
      return `<div class="social-item">
        <div><div class="social-name">${s.label}</div><div class="social-type">${s.hint}</div></div>
        <button class="social-btn one-move" onclick="HBSocial.copy('${s.id}')">
          ${s.id === 'tiktok' ? '⚡ Caption + slide' : '⚡ Caption + immagine'}
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
  // Il cache-buster evita il CORS-fail da risposta già cachata senza header ACAO (richiesta <img> non-CORS)
  const corsUrl = u => u + (u.includes('?') ? '&' : '?') + 'cors=1';

  async function posterPng(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = corsUrl(url); });
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

    // I compositori di X/Facebook/Threads/Instagram, se negli appunti c'è un'immagine, incollano
    // SOLO l'immagine e buttano il testo. Quindi: testo negli appunti + locandina scaricata a parte,
    // l'utente incolla il testo e allega l'immagine. (Il paste combinato testo+immagine non è supportato.)
    try { await navigator.clipboard.writeText(text); } catch { fallbackCopy(text); }

    if (network === 'tiktok') {
      const ext = await downloadSlide(d);
      HB.showToast(
        ext === 'mp4' ? '⚡ Caption copiata + video MP4 scaricato — carica su TikTok e incolla'
        : ext === 'webm' ? '⚠️ Caption copiata + video WEBM (il browser non registra MP4) — convertilo in MP4 per TikTok'
        : '⚠️ Caption copiata + PNG (questo browser non registra video) — per TikTok serve un MP4'
      );
    } else if (d.poster) {
      downloadBlob(await posterPng(d.poster).catch(() => null), slug(d) + '-poster.png');
      HB.showToast('⚡ Caption copiata + locandina scaricata — incolla il testo e allega l\'immagine');
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

  function drawSlide(ctx, d, poster) {
    ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, 1080, 1920);
    if (poster) {
      const ratio = poster.width / poster.height, h = 1300, w = h * ratio;
      ctx.drawImage(poster, (1080 - w) / 2, 120, w, h);
      const grad = ctx.createLinearGradient(0, 1000, 0, 1420);
      grad.addColorStop(0, 'rgba(10,10,15,0)'); grad.addColorStop(1, 'rgba(10,10,15,1)');
      ctx.fillStyle = grad; ctx.fillRect(0, 1000, 1080, 420);
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
  }

  // canvas 1080×1920 con la slide già disegnata (poster caricato una volta, riusato per PNG e video)
  async function slideCanvas(d) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    let poster = null;
    if (d.poster) {
      try {
        poster = new Image(); poster.crossOrigin = 'anonymous';
        await new Promise((ok, ko) => { poster.onload = ok; poster.onerror = ko; poster.src = corsUrl(d.poster); });
      } catch { poster = null; }
    }
    drawSlide(ctx, d, poster);
    return { canvas, ctx, redraw: () => drawSlide(ctx, d, poster) };
  }

  async function slideBlob(d) {
    const { canvas } = await slideCanvas(d);
    return new Promise(ok => canvas.toBlob(ok, 'image/png'));
  }

  // TikTok da PC accetta solo video → slide come MP4 di 3s (H.264 se il browser lo registra, senò WEBM).
  // ponytail: fermo-immagine di 3s; se un giorno serve movimento/audio, qui va un timeline vero.
  async function slideVideo(d) {
    if (typeof MediaRecorder === 'undefined') return null;
    const { canvas, redraw } = await slideCanvas(d);
    if (!canvas.captureStream) return null;
    const stream = canvas.captureStream(30);
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      .find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(ok => { rec.onstop = ok; });
    rec.start();
    // ridisegno via setInterval (non rAF): non si mette in pausa se la finestra perde il focus,
    // così captureStream continua a emettere frame e la registrazione non si impianta mai
    const iv = setInterval(redraw, 100);
    await new Promise(ok => setTimeout(() => {
      clearInterval(iv);
      if (rec.state !== 'inactive') rec.stop();
      stream.getTracks().forEach(t => t.stop());
      ok();
    }, 3000));
    await stopped;
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
  }

  // ritorna l'estensione effettiva ('mp4' | 'webm' | 'png') così il toast può avvisare l'utente
  async function downloadSlide(d) {
    const vid = await slideVideo(d).catch(() => null);
    if (vid && vid.blob.size) {
      downloadBlob(vid.blob, 'horror-bulletin-' + slug(d) + '-slide.' + vid.ext);
      return vid.ext;
    }
    downloadBlob(await slideBlob(d).catch(() => null), 'horror-bulletin-' + slug(d) + '-slide.png');
    return 'png';
  }

  // ── ZIP bulk ──
  function toggle(id, checked) {
    checked ? selected.add(id) : selected.delete(id);
    const btn = $('zip-btn');
    btn.disabled = selected.size === 0;
    btn.textContent = `⬇ Scarica ZIP selezione (${selected.size})`;
  }

  async function downloadZip() {
    // ZIP settorializzato: cartella per categoria, dentro i film in ordine di rilevanza
    const items = HB.DATA.items.filter(i => selected.has(i.id)).sort(HB.byCategory);
    if (!items.length) return;
    const zip = new JSZip();
    for (const d of items) {
      const dir = zip.folder(slug({ title: d.category || 'altro' })).folder(slug(d));
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

  window.HBSocial = { init, open, select, copy, share, toggle, toggleAll, downloadZip };
})();
