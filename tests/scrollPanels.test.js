'use strict';
// Pop-ups that slide in from the right must always scroll to their last pixel.
// These checks guard the rules that broke it before (the browser sweep lives in the local-copy tools).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('custom editor pop-up sits in exactly one grid cell so its body scrolls', () => {
  const css = read('public/css/customForms.css');
  const rules = css.split('}').filter((r) => /(^|\n)\s*\.cfm\s*\{/.test(r));
  assert.ok(rules.length >= 1, '.cfm rule exists');
  for (const rule of rules) {
    if (!/display:\s*grid/.test(rule) && !/place-items/.test(rule)) continue;
    // An auto grid row grows with its content: the panel then runs past the screen and never scrolls.
    assert.match(rule, /grid-template-rows:\s*minmax\(0,\s*1fr\)/, 'a .cfm rule with grid layout fixes its row to the pop-up area');
  }
  assert.match(css, /\.cfm__body\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/, '.cfm__body can shrink and scrolls');
  assert.doesNotMatch(css, /\.cfm__box(--tall)?\s*\{[^}]*calc\(100vh/, 'pop-up height is not measured in vh (the page zoom shrinks it)');
});

test('panels moved under the header are pinned to the bottom edge', () => {
  const js = read('public/js/belowHeaderPanels.js');
  assert.match(js, /style\.bottom\s*=\s*'0px'/);
});

test('report builder pop-ups and the settings integration panel have no top offset left over', () => {
  assert.match(read('public/css/reportBuilder.css'), /\.rb-dialog\s*\{[^}]*margin:\s*0;/);
  const settings = read('views/account/settings.ejs');
  assert.match(settings, /\.integration-info-panel\s*\{[^}]*bottom:\s*0;/);
  assert.doesNotMatch(settings, /\.integration-info-panel\s*\{[^}]*height:\s*100%/);
});
