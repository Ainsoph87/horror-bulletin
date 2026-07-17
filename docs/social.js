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
    const combined = ['x', 'facebook', 'threads'].includes(network);

    // ponytail: paste combinato testo+immagine — se il browser rifiuta il multi-tipo, degrada a solo testo
    if (combined && d.poster && navigator.clipboard && navigator.clipboard.write) {
      try {
        const png = await posterPng(d.poster);
        // clipboard.write resta appesa se la finestra perde il focus: timeout → fallback testo
        await Promise.race([
          navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'image/png': png
          })]),
          new Promise((_, ko) => setTimeout(() => ko(new Error('clipboard timeout')), 4000))
        ]);
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
        await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = corsUrl(d.poster); });
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

  // ── ZIP bulk ──
  function toggle(id, checked) {
    checked ? selected.add(id) : selected.delete(id);
    const btn = $('zip-btn');
    btn.disabled = selected.size === 0;
    btn.textContent = `⬇ Scarica ZIP selezione (${selected.size})`;
  }

  async function downloadZip() {
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

  window.HBSocial = { init, open, select, copy, share, toggle, downloadZip };
})();
