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

test('facebook contiene entrambe le sinossi integrali (EN + IT)', () => {
  const t = F.format('facebook', item);
  assert.ok(t.includes(item.synEN), 'manca EN integrale');
  assert.ok(t.includes(item.synIT), 'manca IT integrale');
});

test('instagram contiene entrambe le sinossi (EN + IT)', () => {
  const t = F.format('instagram', item);
  assert.ok(t.includes(item.synEN), 'manca EN');
  assert.ok(t.includes(item.synIT), 'manca IT');
});

test('threads: stato incluso e sinossi troncata al limite 500', () => {
  const t = F.format('threads', item);
  assert.ok(t.length <= 500);
  assert.ok(/Riedizione/.test(t), 'manca lo stato');
  assert.ok(t.includes('EEEE'), 'manca la sinossi (troncata)');
});

test('ogni post indica canale + stato in chiaro (cinema/riedizione/VOD...)', () => {
  for (const s of F.SOCIALS) {
    const t = F.format(s.id, item);
    assert.ok(/Riedizione/i.test(t), s.id + ': manca lo stato Riedizione');
    assert.ok(/cinema/i.test(t), s.id + ': manca il canale cinema');
  }
});

test('X non contiene sinossi ma resta ≤280 con stato', () => {
  const t = F.format('x', item);
  assert.ok(t.length <= 280);
  assert.ok(!t.includes('EEEE') && !t.includes('SSSS'), 'X non deve contenere sinossi');
  assert.ok(/cinema/i.test(t) && /Riedizione/i.test(t), 'X deve tenere lo stato');
});

test('TikTok include la sinossi EN (troncata, caption)', () => {
  assert.ok(F.format('tiktok', item).includes('EEEE'), 'tiktok: manca la sinossi');
});

test('threads e tiktok usano solo EN (IT non entra / caption breve)', () => {
  for (const id of ['threads', 'tiktok']) {
    const t = F.format(id, item);
    assert.ok(t.includes('EEEE'), id + ': manca EN');
    assert.ok(!t.includes('SSSS'), id + ': non deve usare la sinossi IT');
  }
});

test('threads con sinossi corte include entrambe (EN + IT) entro i 500', () => {
  const corto = { ...item, synEN: 'E'.repeat(80), synIT: 'S'.repeat(80) };
  const t = F.format('threads', corto);
  assert.ok(t.length <= 500);
  assert.ok(t.includes('EEEE') && t.includes('SSSS'), 'entrambe devono entrare quando corte');
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
