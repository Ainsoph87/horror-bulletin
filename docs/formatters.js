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
        clean(d.synEN || d.synIT), '',
        ['#horror', '#horrormovies', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },
    instagram(d) {
      return [header(d), '', clean(d.synEN || d.synIT), '.', '.', '.',
        ['#horror','#horrormovies','#horrorfilm','#horrorcommunity','#horrorlovers','#horrorfan',
         '#scary','#spooky','#cinephile','#moviestowatch', catTag(d), tipoTag(d)].filter(Boolean).join(' ')
      ].join('\n').trim();
    },
    threads(d) {
      const t = [header(d),
        [d.director ? `Dir. ${d.director}` : '', formatDate(d.releaseDate)].filter(Boolean).join(' · '),
        clean(d.platform || d.category), '',
        clean(d.synEN || d.synIT), '',
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
    { id:'x',         label:'𝕏 / Twitter',  hint:'≤280 char — caption copiata + locandina scaricata', format: FORMATS.x },
    { id:'facebook',  label:'📘 Facebook',   hint:'Post lungo — caption copiata + locandina scaricata', format: FORMATS.facebook },
    { id:'instagram', label:'📷 Instagram',  hint:'Caption copiata + immagine da caricare', format: FORMATS.instagram },
    { id:'threads',   label:'🧵 Threads',    hint:'≤500 char — caption copiata + locandina scaricata', format: FORMATS.threads },
    { id:'tiktok',    label:'🎵 TikTok',     hint:'Caption copiata + slide scaricata', format: FORMATS.tiktok }
  ];

  return { SOCIALS, CAT_EMOJI, formatDate, format: (id, d) => FORMATS[id](d) };
});
