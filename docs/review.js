// review.js — approvazione voci da sito (via Cloudflare Worker, vedi worker/)
(function () {
  const WORKER_URL = localStorage.getItem('hb_worker_url') || 'https://horror-bulletin-api.di-rodi-mirko2.workers.dev';
  let apiKey = localStorage.getItem('hb_api_key') || '';
  let mode = 'pending'; // pending | approved

  const $ = id => document.getElementById(id);

  function setKey() {
    const k = prompt('API Key del worker (vuota per rimuovere):', apiKey);
    if (k === null) return;
    apiKey = k.trim();
    if (apiKey) localStorage.setItem('hb_api_key', apiKey);
    else localStorage.removeItem('hb_api_key');
    render();
  }

  function setMode(btn, m) {
    mode = m;
    document.querySelectorAll('#review-filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  }

  function renderCounts() {
    const pend = HB.DATA.items.filter(i => !i.approvato).length;
    const appr = HB.DATA.items.length - pend;
    const chips = document.querySelectorAll('#review-filters .filter-btn');
    if (chips.length === 2) {
      chips[0].textContent = `⏳ Da approvare (${pend})`;
      chips[1].textContent = `✓ Approvate (${appr}) — qui si revoca`;
    }
  }

  function render() {
    renderCounts();
    if (!apiKey) {
      $('review-list').innerHTML = '<div class="empty">🔑 Imposta la API Key del worker per approvare da qui.<br><br><button class="zip-btn" onclick="HBReview.setKey()">Imposta API Key</button></div>';
      return;
    }
    const items = HB.DATA.items
      .filter(i => mode === 'pending' ? !i.approvato : i.approvato)
      .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
    if (!items.length) {
      $('review-list').innerHTML = `<div class="empty">${mode === 'pending' ? 'Niente da approvare. 🎉' : 'Nessuna voce approvata.'}</div>`;
      return;
    }
    $('review-list').innerHTML = items.map(d => `
      <div class="review-row" id="rev-${d.id}">
        <div class="review-poster">${d.poster ? `<img src="${d.poster}" loading="lazy" alt="">` : '☠'}</div>
        <div class="review-info">
          <div class="review-title">${d.title || 'Senza titolo'} ${d.year ? `(${d.year})` : ''}</div>
          <div class="review-meta">
            <span class="card-badge ${HB.CAT_BADGE[d.category] || 'badge-cinema'}" style="position:static;padding:2px 6px">${d.category || '?'}</span>
            <span>${d.tipo || ''}</span>
            <span class="card-date">${HB.formatDate(d.releaseDate)}</span>
            <span class="card-platform">${d.platform || ''}</span>
          </div>
          <div class="review-syn">${(d.synEN || d.synIT || '').slice(0, 180)}</div>
        </div>
        <div class="review-actions">
          ${mode === 'pending'
            ? `<button class="zip-btn one-move" onclick='HBReview.set(${JSON.stringify(d.id)}, true)'>✓ Approva</button>`
            : `<button class="zip-btn" onclick='HBReview.set(${JSON.stringify(d.id)}, false)'>↩ Revoca</button>`}
        </div>
      </div>
    `).join('');
  }

  async function set(id, approvato) {
    const item = HB.DATA.items.find(i => i.id === id);
    if (!item) return;
    const row = $('rev-' + id);
    if (row) row.style.opacity = '.4';
    try {
      const r = await fetch(WORKER_URL + '/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ id, props: { approvato } })
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      item.approvato = approvato;
      HB.showToast(approvato ? `✓ Approvato: ${item.title}` : `↩ Revocato: ${item.title}`);
      render();
      if (window.HBSocial) HBSocial.init(HB.DATA); // aggiorna select e lista ZIP
    } catch (e) {
      if (row) row.style.opacity = '1';
      HB.showToast('⚠️ ' + e.message);
    }
  }

  function init() { render(); }

  window.HBReview = { init, render, set, setKey, setMode };
})();
