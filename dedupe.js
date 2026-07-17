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
