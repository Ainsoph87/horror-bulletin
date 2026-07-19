// social.js — pagina Social: one-move copy, share mobile, slide TikTok, ZIP bulk
(function () {
  let currentItem = null;
  const selected = new Set(); // id per ZIP bulk

  const $ = id => document.getElementById(id);
  const F = () => window.HBFormatters;

  function init(DATA) {
    // settorializzato: categoria prima di tutto, rilevanza dentro la categoria.
    // Niente più approvazione: tutto ciò che è in data.json (= non scartato) è postabile.
    const groups = new Map();
    for (const d of [...DATA.items].sort(HB.byCategory)) {
      const c = d.category || 'Altro';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(d);
    }
    $('post-select').innerHTML = '<option value="">— Scegli una voce —</option>' +
      [...groups].map(([cat, items]) =>
        `<optgroup label="${cat}">` +
        items.map(d => `<option value="${d.id}">${d.title}${d.rilevanza ? ` 🔥${d.rilevanza}` : ''} — ${HB.formatDate(d.releaseDate)}</option>`).join('') +
        '</optgroup>'
      ).join('');
    // ZIP bulk = solo mese corrente (il picker singolo sopra resta su tutto)
    const zipGroups = new Map();
    for (const d of HB.monthItems().sort(HB.byCategory)) {
      const c = d.category || 'Altro';
      if (!zipGroups.has(c)) zipGroups.set(c, []);
      zipGroups.get(c).push(d);
    }
    $('zip-list').innerHTML = [...zipGroups].map(([cat, items]) =>
      `<div style="font-weight:600;color:var(--text);margin:10px 0 4px">${cat} (${items.length})</div>` +
      items.map(d =>
        `<label style="display:block;cursor:pointer"><input type="checkbox" class="zip-check" data-cat="${cat}" style="accent-color:var(--red);margin-right:8px" onclick='HBSocial.toggle(${JSON.stringify(d.id)}, this.checked)'>${d.title} <span style="color:var(--text3)">(${d.rilevanza ? `🔥${d.rilevanza} — ` : ''}${HB.formatDate(d.releaseDate)})</span></label>`
      ).join('')
    ).join('') || '<div class="empty">Nessuna uscita nel mese corrente.</div>';
    renderButtons();
  }

  function toggleAll(checked) {
    document.querySelectorAll('#zip-list .zip-check').forEach(c => { c.checked = checked; });
    selected.clear();
    if (checked) HB.monthItems().forEach(i => selected.add(i.id));
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
    // stesso criterio del copia da PC: TikTok condivide il video, gli altri la locandina
    const asset = await postAsset(d, network);
    if (asset) payload.files = [new File([asset.blob], slug(d) + '.' + asset.ext, { type: asset.blob.type })];
    try { await navigator.share(payload); } catch (e) { if (e.name !== 'AbortError') HB.showToast('⚠️ Condivisione non riuscita'); }
  }

  // asset visivo del post, allineato al copia-incolla: TikTok → video MP4, altri → locandina PNG
  async function postAsset(d, network) {
    if (network === 'tiktok') {
      const vid = await slideVideo(d).catch(() => null);
      if (vid && vid.blob.size) return vid;
    }
    if (!d.poster) return null;
    const png = await posterPng(d.poster).catch(() => null);
    return png ? { blob: png, ext: 'png' } : null;
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

  // finestra di posting per social. X e Threads usano gli endpoint "intent" ufficiali (ToS-ok)
  // → caption già precompilata; gli altri non hanno deeplink di composizione, si apre la pagina.
  const COMPOSER = {
    x:         c => 'https://x.com/intent/post?text=' + encodeURIComponent(c),
    threads:   c => 'https://www.threads.net/intent/post?text=' + encodeURIComponent(c),
    facebook:  () => 'https://www.facebook.com/',
    instagram: () => 'https://www.instagram.com/',
    tiktok:    () => 'https://www.tiktok.com/tiktokstudio/upload'
  };

  async function downloadZip() {
    // ZIP settorializzato: cartella per categoria, dentro i film in ordine di rilevanza
    const items = HB.DATA.items.filter(i => selected.has(i.id)).sort(HB.byCategory);
    if (!items.length) return;
    const zip = new JSZip();
    const manifest = [];
    let n = 0;
    for (const d of items) {
      // il video slide si registra in ~3s a titolo: avanzamento per non far sembrare bloccato
      HB.showToast(`⏳ Preparo lo ZIP… ${++n}/${items.length} (video slide ≈3s a titolo)`);
      const folder = slug({ title: d.category || 'altro' }) + '/' + slug(d);
      const dir = zip.folder(slug({ title: d.category || 'altro' })).folder(slug(d));
      for (const s of F().SOCIALS) dir.file(s.id + '.txt', F().format(s.id, d));
      let poster = false, slideFile = null;
      if (d.poster) {
        const png = await posterPng(d.poster).catch(() => null);
        if (png) { dir.file('poster.png', png); poster = true; }
      }
      // slide TikTok come MP4 (stesso asset del copia-incolla), fallback PNG se il browser non registra
      const vid = await slideVideo(d).catch(() => null);
      if (vid && vid.blob.size) { slideFile = 'slide.' + vid.ext; dir.file(slideFile, vid.blob); }
      else { const slide = await slideBlob(d).catch(() => null); if (slide) { slideFile = 'slide.png'; dir.file(slideFile, slide); } }
      manifest.push({
        title: d.title, category: d.category || 'Altro', folder,
        socials: F().SOCIALS.map(s => {
          const caption = F().format(s.id, d);
          // TikTok si trascina il video, gli altri la locandina (o il video se manca la locandina)
          const file = s.id === 'tiktok' ? slideFile : (poster ? 'poster.png' : slideFile);
          return { id: s.id, label: s.label, caption, url: COMPOSER[s.id](caption), file: file && folder + '/' + file };
        })
      });
    }
    // launcher Windows (.hta): a differenza di una pagina browser ha accesso al file system,
    // quindi ogni bottone apre il composer + copia la caption + apre Esplora risorse col file selezionato.
    zip.file('apri-e-posta.hta', launcherHta(manifest));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'horror-bulletin-posts.zip');
    HB.showToast(`✓ ZIP con ${items.length} titoli — apri "apri-e-posta.hta"`);
  }

  // launcher Windows .hta: gira con mshta (motore IE), quindi ha accesso al file system.
  // Ogni bottone: copia la caption (clipboardData) + apre il composer nel browser predefinito
  // (Shell.Application.ShellExecute) + apre Esplora risorse col file selezionato (explorer /select).
  // Codice embedded in ES5 (niente arrow/template literal: Trident non li supporta).
  function launcherHta(posts) {
    const data = JSON.stringify(posts).replace(/</g, '\\u003c');
    return `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Horror Bulletin — Apri e posta</title>
<hta:application id="hb" applicationname="HorrorBulletin" scroll="yes" singleinstance="yes" border="thin" innerborder="no" />
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;background:#0a0a0f;color:#eee;margin:0;padding:20px}
  h1{color:#ff6b6b} h2{margin:22px 0 4px;border-bottom:1px solid #333;padding-bottom:4px;color:#fff}
  .social{margin:6px 0}
  .social b{display:inline-block;min-width:140px}
  button{background:#c0392b;color:#fff;border:0;border-radius:5px;padding:7px 12px;cursor:pointer;font-size:14px}
  button.done{background:#2d572c}
  .file{color:#5dade2;font-family:Consolas,monospace;font-size:12px;margin-left:8px}
  .steps{color:#9090a8;font-size:13px;background:#15151f;padding:12px;border-radius:6px;line-height:1.5}
  code{background:#222;padding:1px 5px}
</style></head><body>
<h1>☠ Apri e posta</h1>
<p class="steps"><b>Apri</b> (per ogni social) = copia la caption + apre la finestra di posting nel browser + apre Esplora risorse con il file già selezionato.
Poi ti resta solo: <code>Ctrl-V</code> nella casella (𝕏 e Threads sono già precompilati) · <b>trascina</b> il file evidenziato nel composer · premi <b>Post</b>.</p>
<div id="app"></div>
<script type="text/javascript">
var POSTS = ${data};
var BS = String.fromCharCode(92);
var wsh, shApp;
try { wsh = new ActiveXObject('WScript.Shell'); } catch(e){}
try { shApp = new ActiveXObject('Shell.Application'); } catch(e){}
try { window.resizeTo(780, 820); } catch(e){}
function e(s){ s=(s==null?'':''+s); return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function baseDir(){ var p=decodeURIComponent(location.href).replace(/^file:[/][/][/]/,''); p=p.substring(0,p.lastIndexOf('/')); return p.replace(/[/]/g, BS); }
function go(pi,si,btn){
  var s=POSTS[pi].socials[si];
  try { window.clipboardData.setData('Text', s.caption); } catch(e1){}
  try { if(shApp) shApp.ShellExecute(s.url); } catch(e2){}
  if(s.file && wsh){ try { wsh.Run('explorer /select,"'+baseDir()+BS+s.file.replace(/[/]/g,BS)+'"'); } catch(e3){} }
  btn.className='done'; btn.innerHTML='✓ aperto';
}
var html='';
for(var pi=0; pi<POSTS.length; pi++){
  var p=POSTS[pi];
  html+='<h2>'+e(p.category)+' — '+e(p.title)+'</h2>';
  for(var si=0; si<p.socials.length; si++){
    var s=p.socials[si];
    html+='<div class="social"><b>'+e(s.label)+'</b>'+
      '<button onclick="go('+pi+','+si+',this)">Apri</button>'+
      (s.file? '<span class="file">'+e(s.file)+'</span>' : '<span class="file">(nessun file)</span>')+
      '</div>';
  }
}
document.getElementById('app').innerHTML=html;
</script></body></html>`;
  }

  window.HBSocial = { init, open, select, copy, share, toggle, toggleAll, downloadZip };
})();
