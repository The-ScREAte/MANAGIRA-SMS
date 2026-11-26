const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("public/css/driverPhone.css");

// Everything below the intro comment that is not inside the 640px blocks must be icon spacing only.
function phoneBlocks() {
  const blocks = [];
  const re = /@media \(max-width: 640px\)[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (depth && i < css.length) { if (css[i] === "{") depth += 1; else if (css[i] === "}") depth -= 1; i += 1; }
    blocks.push(css.slice(re.lastIndex, i - 1));
  }
  return blocks.join("\n");
}
const phone = phoneBlocks();
const heights = (selectorPart) => {
  const out = [];
  phone.split("}").forEach((rule) => {
    const [sel, body] = rule.split("{");
    if (!body || !sel.includes(selectorPart)) return;
    const h = body.match(/(?:^|[\s;])(?:min-)?height:\s*(\d+)px/g);
    if (h) h.forEach((x) => out.push(Number(x.match(/(\d+)px/)[1])));
  });
  return out;
};

test("driver phone rules live inside a 640px query", () => {
  assert.ok(phone.length > 2000, "phone block present");
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, "").split("@media")[0];
  assert.ok(!/padding:\s*\d+px\s+\d+px\s+\d+px/.test(outside), "no page padding outside the query");
  assert.match(phone, /\.drv \{ padding: 8px 12px 28px/);
});

test("critical driver actions keep at least 48px height and 14px text", () => {
  for (const part of [".drv-go", ".drvn-end", ".drvn-plain", ".drvf__btn", ".drv-reportbtn"]) {
    const found = heights(part);
    assert.ok(found.length, part + " has a phone height");
    assert.ok(Math.min(...found) >= 48, part + " is at least 48px: " + found.join(","));
  }
  assert.match(phone, /\.drv-go[^}]*font-size: 15px/);
  assert.match(phone, /drvn-confirm__btns \{ gap: 12px/);
});

test("secondary driver controls are at least 40px", () => {
  for (const part of [".drvf .drvf__x", ".drvn .drvn-morex", ".drv .drv-tabs button", ".drvn .drvn-skip"]) {
    const found = heights(part).concat(heights(part.replace(/^\./, "")));
    assert.ok(found.length && Math.min(...found) >= 40, part + " >= 40: " + found.join(","));
  }
});

test("phone type scale: 16px fields, 19px title", () => {
  assert.match(phone, /\.drv \.drv-top h1 \{ font-size: 19px/);
  assert.match(phone, /input:not\(\[type=checkbox\]\)[^{]*\{ font-size: 16px/);
});

test("driver views link the phone stylesheet and wire the bus-access icons", () => {
  const dash = read("views/driver/dashboard.ejs");
  const settings = read("views/driver/settings.ejs");
  assert.match(dash, /css\/driverPhone\.css/);
  assert.match(settings, /css\/driverPhone\.css/);
  assert.match(dash, /navIcon\('busAccess'/);
  assert.match(dash, /navIcon\('noBusAccess'/);
  assert.match(dash, /navIcon\('route'/);
  const nav = read("public/js/driverNav.js");
  assert.match(nav, /sharedIcon\('locate'/);
  assert.match(nav, /sharedIcon\('reportFile'/);
});

test("driver views have no inline handlers or dialogs", () => {
  for (const f of ["views/driver/dashboard.ejs", "views/driver/settings.ejs", "public/js/driverNav.js"]) {
    const src = read(f);
    assert.ok(!/\son(click|submit|change|input)=/i.test(src), f + " has an inline handler");
    assert.ok(!/\b(alert|confirm)\(/.test(src.replace(/\/\/.*$/gm, "")), f + " uses a dialog");
  }
});
