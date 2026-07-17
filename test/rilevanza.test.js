const { test } = require('node:test');
const assert = require('node:assert');
const { movieScore, showScore } = require('../rilevanza.js');

test('film: buzz alto batte voto alto con pochi votanti', () => {
  const buzz = movieScore({ popularity: 250, vote_average: 5, vote_count: 50 });
  const niche = movieScore({ popularity: 10, vote_average: 10, vote_count: 3 });
  assert.ok(buzz > niche);
});

test('film: a pari buzz, i voti pesano', () => {
  const votato = movieScore({ popularity: 50, vote_average: 8, vote_count: 1000 });
  const ignoto = movieScore({ popularity: 50, vote_average: 0, vote_count: 0 });
  assert.ok(votato > ignoto);
});

test('film: campi mancanti non rompono', () => {
  assert.strictEqual(movieScore({}), 0);
});

test('serie: weight + rating scalato', () => {
  assert.strictEqual(showScore({ weight: 90, rating: { average: 7.5 } }), 165);
});

test('serie: campi mancanti non rompono', () => {
  assert.strictEqual(showScore({}), 0);
});
