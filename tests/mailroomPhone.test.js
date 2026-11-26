const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'mailroomPhone.css'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'common', 'mailroom.ejs'), 'utf8');

test('mailroom phone rules sit inside a 640px media query', () => {
  const start = css.indexOf('@media (max-width: 640px)');
  assert.ok(start >= 0);
  assert.ok(css.slice(0, start).replace(/\/\*[\s\S]*?\*\//g, '').trim() === '', 'no rules outside the media query');
  for (const sel of ['.mr-message-card', '.mr-history-filters', '.mr-tabs', '.mr-compose-meta']) {
    assert.ok(css.includes(sel), sel);
  }
});

test('mailroom history row has no fixed height and no clipped columns', () => {
  const card = css.split('\n').filter((l) => l.includes('.mr-message-card {'));
  assert.ok(card.length);
  for (const l of card) assert.ok(!/(^|[^-])(min-)?height\s*:/.test(l), l);
  assert.match(css, /\.mr-history-filters[^}]*overflow-x: auto/);
});

test('mailroom view links the phone stylesheet', () => {
  assert.ok(view.includes("/css/mailroomPhone.css"));
});
