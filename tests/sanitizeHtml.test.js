const test = require('node:test');
const assert = require('node:assert/strict');

const installedVersion = require('sanitize-html/package.json').version;
const bundled = require('../vendor/sanitize-html.cjs');
const sanitizeHtml = require('../utils/sanitizeHtml');

const QUESTION_RULES = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 'br', 'sub', 'sup', 'p'],
  allowedAttributes: {},
};

test('bundled sanitize-html matches the installed version (run npm run build:vendor after updates)', () => {
  assert.equal(bundled.__bundledVersion, installedVersion);
});

test('loader returns a working sanitizer', () => {
  assert.equal(typeof sanitizeHtml, 'function');
});

for (const [name, impl] of [['installed', sanitizeHtml], ['bundled', bundled]]) {
  test(`${name}: keeps simple formatting, removes scripts and event handlers`, () => {
    const out = impl('<b>Bold</b> <i>it</i><script>alert(1)</script><img src=x onerror=alert(1)><p onclick="x()">P</p>', QUESTION_RULES);
    assert.equal(out, '<b>Bold</b> <i>it</i><p>P</p>');
  });

  test(`${name}: blocks javascript: links and SVG tricks`, () => {
    const out = impl('<a href="javascript:alert(1)">x</a><svg><animate attributeName="href" values="javascript:alert(1)"/></svg>', {
      allowedTags: ['a'], allowedAttributes: { a: ['href'] },
    });
    assert.ok(!/javascript:/i.test(out));
    assert.ok(!/<svg|<animate/i.test(out));
  });
}
