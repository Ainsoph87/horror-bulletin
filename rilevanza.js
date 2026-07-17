// rilevanza.js — punteggio di rilevanza per l'ordinamento del bulletin.
// Combina buzz social (TMDB popularity / TVMaze weight) e gradimento (voti),
// smorzando i voti con log10 del numero di votanti per non premiare 10/10 con 3 voti.
// ponytail: euristica dichiarata, non scienza — se l'ordinamento non convince, si tara qui e si rilancia il backfill.

function movieScore(det) {
  const pop = det.popularity || 0;
  const vote = (det.vote_average || 0) * Math.log10((det.vote_count || 0) + 1) * 5;
  return Math.round(pop + vote);
}

function showScore(show) {
  const weight = show.weight || 0; // TVMaze 0-100
  const rating = (show.rating && show.rating.average) || 0; // 0-10
  return Math.round(weight + rating * 10);
}

module.exports = { movieScore, showScore };
