const { test } = require('node:test');
const assert = require('node:assert');
const F = require('../docs/formatters.js');

const item = {
  id: 'abc', title: 'The Thing', director: 'John Carpenter', year: 2026,
  category: 'Cinema', tipo: 'Riedizione', platform: 'UCI Cinemas',
  releaseDate: '2026-08-15', synIT: 'S'.repeat(400), synEN: 'E'.repeat(400),
  poster: 'https://image.tmdb.org/t/p/w500/x.jpg'
};

test('SOCIALS contiene i 5 social nell\'ordine giusto', () => {
  assert.deepStrictEqual(F.SOCIALS.map(s => s.id), ['x', 'facebook', 'instagram', 'threads', 'tiktok']);
});

test('X rispetta 280 caratteri', () => {
  assert.ok(F.format('x', item).length <= 280);
});

test('Threads rispetta 500 caratteri', () => {
  assert.ok(F.format('threads', item).length <= 500);
});

test('ogni post contiene titolo e #horror', () => {
  for (const s of F.SOCIALS) {
    const t = F.format(s.id, item);
    assert.ok(t.includes('The Thing'), s.id + ': manca il titolo');
    assert.ok(t.includes('#horror'), s.id + ': manca #horror');
  }
});

test('facebook contiene sinossi EN integrale (priorità inglese)', () => {
  assert.ok(F.format('facebook', item).includes(item.synEN));
});

test('instagram usa la sinossi EN', () => {
  assert.ok(F.format('instagram', item).includes(item.synEN));
});

test('threads non pre-tronca la sinossi (solo limite 500 piattaforma)', () => {
  const t = F.format('threads', item);
  assert.ok(t.includes(item.synEN), 'sinossi EN da 400 char deve entrare integrale');
  assert.ok(t.length <= 500);
});

test('sinossi EN ha priorità su IT anche quando entrambe presenti', () => {
  for (const id of ['facebook', 'instagram', 'threads']) {
    assert.ok(!F.format(id, item).includes('SSSS'), id + ': non deve usare la sinossi IT');
  }
});

test('campi mancanti non producono null/undefined nel testo', () => {
  const vuoto = { id: 'x', title: 'Senza Nulla' };
  for (const s of F.SOCIALS) {
    const t = F.format(s.id, vuoto);
    assert.ok(!/null|undefined/.test(t), s.id + ': ' + t);
  }
});

test('formatDate gestisce null', () => {
  assert.strictEqual(F.formatDate(null), 'N/D');
});
