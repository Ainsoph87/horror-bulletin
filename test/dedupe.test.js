const { test } = require('node:test');
const assert = require('node:assert');
const dedupeItems = require('../dedupe.js');

const mk = (title, category, releaseDate, extra = {}) => ({ title, category, releaseDate, ...extra });

test('stesso titolo+categoria entro 90 giorni: resta la data più recente', () => {
  const out = dedupeItems([mk('Hungry', 'Cinema', '2026-06-23'), mk('Hungry', 'Cinema', '2026-07-24')]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].releaseDate, '2026-07-24');
});

test('pubblicato vince sulla data', () => {
  const out = dedupeItems([
    mk('Hungry', 'Cinema', '2026-06-23', { pubblicato: true }),
    mk('Hungry', 'Cinema', '2026-07-24')
  ]);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].pubblicato);
});

test('approvato vince su non approvato', () => {
  const out = dedupeItems([
    mk('Hungry', 'Cinema', '2026-06-23', { approvato: true }),
    mk('Hungry', 'Cinema', '2026-07-24')
  ]);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].approvato);
});

test('categorie diverse non sono duplicati', () => {
  const out = dedupeItems([mk('Scream 7', 'Cinema', '2026-06-25'), mk('Scream 7', 'Home Video', '2026-06-25')]);
  assert.strictEqual(out.length, 2);
});

test('stesso titolo a distanza di anni (riedizione) non è duplicato', () => {
  const out = dedupeItems([mk('The Thing', 'Cinema', '2026-08-15'), mk('The Thing', 'Cinema', '2022-06-17')]);
  assert.strictEqual(out.length, 2);
});

test('titoli con case/spazi diversi sono lo stesso titolo', () => {
  const out = dedupeItems([mk('  hungry ', 'Cinema', '2026-06-23'), mk('Hungry', 'Cinema', '2026-07-24')]);
  assert.strictEqual(out.length, 1);
});
