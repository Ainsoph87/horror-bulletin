// app.js — caricamento dati, Bulletin (solo mese corrente), Archivio
let DATA = { items: [], updatedAt: null, targetMonth: '', total: 0 };
let currentFilter = 'all';

const CAT_BADGE = {
  'Cinema':'badge-cinema','Streaming':'badge-streaming','VOD':'badge-vod',
  'Home Video':'badge-homevideo','Serie TV':'badge-serie'
};
const CAT_EMOJI = HBFormatters.CAT_EMOJI;
const formatDate = HBFormatters.formatDate;

// Bulletin = solo uscite del mese corrente; Archivio e Social lavorano su tutto
const ym = new Date().toISOString().slice(0, 7);
const monthItems = () => DATA.items.filter(i => (i.releaseDate || '').startsWith(ym));

async function loadData() {
  try {
    const r = await fetch('data.json?t=' + Date.now());
    DATA = await r.json();
    document.getElementById('updated-info').textContent = 'Aggiornato: ' + new Date(DATA.updatedAt).toLocaleString('it-IT');
    document.getElementById('bulletin-month').textContent = 'Uscite Horror — ' + DATA.targetMonth;
    document.getElementById('month-badge').textContent = DATA.targetMonth;
    renderStats();
    renderCards();
    renderArchive();
    populateYearFilter();
    if (window.HBSocial) HBSocial.init(DATA);
    if (window.HBReview) HBReview.init();
  } catch (err) {
    document.getElementById('cards-container').innerHTML = '<div class="empty">⚠️ Errore caricamento dati. Riprova più tardi.</div>';
    console.error(err);
  }
}

function renderStats() {
  const items = monthItems();
  const cats = ['Cinema','Streaming','VOD','Home Video','Serie TV'];
  const stats = [
    { num: items.length, label: 'Uscite del mese', color: 'var(--red3)' },
    ...cats.map(c => ({
      num: items.filter(i => i.category === c).length,
      label: (CAT_EMOJI[c] || '') + ' ' + c,
      color: 'var(--text)'
    })).filter(s => s.num > 0),
    { num: items.filter(i => i.tipo === 'Riedizione').length, label: '♻️ Riedizioni', color: 'var(--orange3)' }
  ];
  document.getElementById('stats-row').innerHTML = stats.map(s =>
    `<div class="stat-card"><div class="stat-num" style="color:${s.color}">${s.num}</div><div class="stat-label">${s.label}</div></div>`
  ).join('');
}

function applyFilter(items, f) {
  if (f === 'all')        return items;
  if (f === 'Riedizione') return items.filter(i => i.tipo === 'Riedizione');
  return items.filter(i => i.category === f);
}

function renderCards() {
  const filtered = applyFilter(monthItems(), currentFilter);
  if (!filtered.length) {
    document.getElementById('cards-container').innerHTML = '<div class="empty">Nessuna uscita per questo mese.</div>';
    return;
  }
  document.getElementById('cards-container').innerHTML = filtered.map(d => {
    const badgeClass = CAT_BADGE[d.category] || 'badge-cinema';
    const tipoClass  = d.tipo === 'Riedizione' ? '' : (d.tipo === 'Nuova stagione' ? 'stagione' : 'nuova');
    const tipoLabel  = d.tipo === 'Riedizione' ? '♻️ Ried.' : (d.tipo === 'Nuova stagione' ? 'Nuova S.' : 'NEW');
    const posterImg  = d.poster
      ? `<img src="${d.poster}" alt="${d.title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'card-poster-placeholder\\'>☠</div>'">`
      : `<div class="card-poster-placeholder">☠</div>`;
    const check = d.approvato
      ? `<input type="checkbox" class="card-check" title="Aggiungi allo ZIP" onclick='event.stopPropagation();HBSocial.toggle(${JSON.stringify(d.id)}, this.checked)'>`
      : '';
    const postBtn = d.approvato
      ? `<div class="card-actions"><button class="card-btn" onclick='HBSocial.open(${JSON.stringify(d.id)})'>📋 Post Social</button></div>`
      : '';
    return `
      <div class="card">
        <div class="card-poster">
          ${posterImg}
          <span class="card-badge ${badgeClass}">${d.category||'?'}</span>
          <span class="card-tipo ${tipoClass}">${tipoLabel}</span>
          ${check}
        </div>
        <div class="card-body">
          <div class="card-title">${d.title || 'Senza titolo'} ${d.year ? `(${d.year})` : ''}</div>
          <div class="card-meta">
            <span>Dir. ${d.director||'N/D'}</span>
            <span class="card-date">${formatDate(d.releaseDate)}</span>
            <span class="card-platform">${d.platform||''}</span>
          </div>
          <div class="card-syn">${(d.synIT || d.synEN || 'Sinossi non disponibile.').slice(0,140)}${(d.synIT||d.synEN||'').length>140?'...':''}</div>
        </div>
        ${postBtn}
      </div>
    `;
  }).join('');
}

function setFilter(btn, f) {
  document.querySelectorAll('#page-bulletin .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = f;
  renderCards();
}

function renderArchive() {
  const tbody = document.getElementById('archive-body');
  if (!DATA.items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Nessun dato disponibile.</td></tr>';
    return;
  }
  tbody.innerHTML = DATA.items.map(d => `
    <tr>
      <td style="font-weight:500;color:var(--text)">${d.title || ''}</td>
      <td style="color:var(--text2)">${d.director || '—'}</td>
      <td><span class="card-badge ${CAT_BADGE[d.category]||'badge-cinema'}" style="position:static;font-size:10px;padding:2px 6px">${d.category||'?'}</span></td>
      <td style="color:var(--text2);font-size:11px">${d.tipo||'—'}</td>
      <td style="color:var(--blue3)">${d.platform||''}</td>
      <td style="color:var(--gold3)">${formatDate(d.releaseDate)}</td>
    </tr>
  `).join('');
}

function filterArchive(q) {
  document.querySelectorAll('#archive-body tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}
function filterArchiveYear(y) {
  document.querySelectorAll('#archive-body tr').forEach(r => {
    r.style.display = !y || r.textContent.includes(y) ? '' : 'none';
  });
}
function filterArchiveCat(c) {
  document.querySelectorAll('#archive-body tr').forEach(r => {
    r.style.display = !c || r.textContent.includes(c) ? '' : 'none';
  });
}

function populateYearFilter() {
  const years = [...new Set(DATA.items.map(i => i.year).filter(Boolean))].sort((a,b)=>b-a);
  const sel = document.querySelector('#page-archivio .form-select:nth-of-type(1)');
  if (sel) sel.innerHTML = '<option value="">Tutti gli anni</option>' + years.map(y => `<option>${y}</option>`).join('');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav .nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const tabs = { bulletin: 0, archivio: 1, social: 2, review: 3 };
  document.querySelectorAll('nav .nav-tab')[tabs[id]].classList.add('active');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.style.display = 'none', 2800);
}

window.HB = { get DATA() { return DATA; }, formatDate, showPage, showToast, CAT_BADGE };

loadData();
