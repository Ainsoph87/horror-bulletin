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
  // registri "vuoti" (— / N/D) trattati come assenti
  const dirName = d => { const v = clean(d.director).trim(); return v && v !== '—' && v !== 'N/D' ? v : ''; };

  // canale in chiaro + tipo (riedizione/nuova stagione); il platform solo se non è al cinema e non ripete il canale
  const CAT_LABEL = { 'Cinema':'al cinema', 'Streaming':'in streaming', 'VOD':'in VOD', 'Home Video':'in home video', 'Serie TV':'serie TV' };
  function statusLine(d) {
    const base = CAT_LABEL[d.category] || (d.category ? String(d.category).toLowerCase() : '');
    const redundant = d.platform && d.category && d.platform.toLowerCase().includes(d.category.toLowerCase());
    const plat = d.platform && d.category !== 'Cinema' && !redundant ? ` (${d.platform})` : '';
    let txt;
    if (d.tipo === 'Riedizione') txt = `Riedizione — ${base}${plat}`;
    else if (d.tipo === 'Nuova stagione') txt = `Nuova stagione${plat}`;
    else txt = `${base}${plat}`;
    txt = txt.replace(/^—\s*/, '').trim();
    return txt ? `🔖 ${txt}` : '';
  }

  const anagrafica = d => [
    dirName(d) ? `🎥 Regia / Dir.: ${dirName(d)}` : '',
    d.releaseDate ? `📅 Uscita: ${formatDate(d.releaseDate)}` : ''
  ].filter(Boolean).join('\n');
  const cut = (t, max) => t.length > max ? t.slice(0, max - 1) + '…' : t;

  // post per social a limite stretto: intestazione+stato sempre integre, sinossi troncata a ciò che avanza.
  // margine di 8 sul budget = cuscinetto per il peso doppio degli emoji su X.
  function budgeted(d, max, tags) {
    const head = [header(d), statusLine(d),
      [dirName(d) ? `Dir. ${dirName(d)}` : '', formatDate(d.releaseDate)].filter(Boolean).join(' · ')
    ].filter(Boolean).join('\n');
    const tagLine = tags.filter(Boolean).join(' ');
    const syn = clean(d.synEN || d.synIT);
    const budget = max - head.length - tagLine.length - 8;
    const synOut = syn && budget > 24 ? cut(syn, budget) : '';
    return [head, synOut, tagLine].filter(s => s !== '').join('\n\n');
  }

  const FORMATS = {
    x(d) {
      return budgeted(d, 280, ['#horror', catTag(d)]);
    },
    facebook(d) {
      const head = [header(d), statusLine(d)].filter(Boolean).join('\n');
      return [head, '', anagrafica(d), '',
        clean(d.synEN || d.synIT), '',
        ['#horror', '#horrormovies', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },
    instagram(d) {
      const head = [header(d), statusLine(d)].filter(Boolean).join('\n');
      return [head, '', clean(d.synEN || d.synIT), '.', '.', '.',
        ['#horror','#horrormovies','#horrorfilm','#horrorcommunity','#horrorlovers','#horrorfan',
         '#scary','#spooky','#cinephile','#moviestowatch', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').trim();
    },
    threads(d) {
      return budgeted(d, 500, ['#horror', catTag(d)]);
    },
    tiktok(d) {
      return [header(d), statusLine(d), dirName(d) ? `Dir. ${dirName(d)}` : '',
        formatDate(d.releaseDate), cut(clean(d.synEN || d.synIT), 150),
        ['#horror','#horrortok','#fyp','#horrormovies','#scary', catTag(d)].filter(Boolean).join(' ')
      ].filter(s => s !== '').join('\n');
    }
  };

  const SOCIALS = [
    { id:'x',         label:'𝕏 / Twitter',  hint:'≤280 char — caption copiata + locandina scaricata', format: FORMATS.x },
    { id:'facebook',  label:'📘 Facebook',   hint:'Post lungo — caption copiata + locandina scaricata', format: FORMATS.facebook },
    { id:'instagram', label:'📷 Instagram',  hint:'Caption copiata + immagine da caricare', format: FORMATS.instagram },
    { id:'threads',   label:'🧵 Threads',    hint:'≤500 char — caption copiata + locandina scaricata', format: FORMATS.threads },
    { id:'tiktok',    label:'🎵 TikTok',     hint:'Caption copiata + slide scaricata', format: FORMATS.tiktok }
  ];

  return { SOCIALS, CAT_EMOJI, formatDate, format: (id, d) => FORMATS[id](d) };
});
