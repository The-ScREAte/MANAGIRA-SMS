// School website designs: the 3D designs (Glide, Prism, Panorama, Orbit) and the
// emblem designs (Crest, Mascot), photos are shown whole, and every design draws every
// kind of content.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const { LAYOUTS, LAYOUT_GROUPS, LAYOUT_VALUES, layoutsFor, layoutFor, buildSiteModel } = require("../utils/websiteView");
const emblems = require("../utils/websiteEmblems");
const { normalizeSection } = require("../utils/websiteExtras");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "views/partials/website/site.ejs");
const MOTION = LAYOUTS.filter((l) => l.motion);

test("the 3D and emblem designs are in every school's list", () => {
  assert.deepEqual(MOTION.map((l) => l.key), ["glide", "prism", "panorama", "orbit"]);
  assert.deepEqual(LAYOUTS.filter((l) => l.emblem).map((l) => l.key), ["orbit", "crest", "mascot"]);
  LAYOUTS.filter((l) => l.motion || l.emblem).forEach((l) => assert.equal(l.feature, undefined));
  assert.deepEqual(LAYOUT_GROUPS.map((g) => g.key), ["standard", "3d", "emblem"]);
  LAYOUTS.forEach((l) => assert.ok(LAYOUT_GROUPS.some((g) => g.key === l.group), `${l.name} is in a group`));
  assert.equal(new Set(LAYOUT_VALUES).size, LAYOUT_VALUES.length, "every stored value is unique");
});

test("every school gets every design, and an unknown one falls back to Classic", () => {
  assert.equal(layoutsFor().filter((l) => l.motion).length, 4);
  assert.equal(layoutFor("wireframe11").key, "prism");
  assert.equal(layoutFor("no-such-design").key, "classic");
  const site = buildSiteModel({ layout: "wireframe12" });
  assert.equal(site.layout, "panorama");
  assert.equal(site.motion, true);
});

test("photos are always shown whole, and the 3D designs have them", () => {
  assert.equal(buildSiteModel({ layout: "wireframe9" }).wholePhotos, true);
  const glide = buildSiteModel({ layout: "wireframe10" });
  assert.equal(glide.layout, "glide");
  assert.equal(glide.motion, true);
  assert.equal(glide.wholePhotos, true);
});

test("every design has a thumbnail in the design picker, and every 3D design has its own page", () => {
  const manage = fs.readFileSync(path.join(ROOT, "views/account/managePublicContent.ejs"), "utf8");
  const site = fs.readFileSync(SITE, "utf8");
  LAYOUTS.forEach((l) => {
    if (l.key === "classic") return; // Classic is drawn by the shared thumbnail rules
    assert.match(manage, new RegExp(`mpc-layout__thumb--${l.key} i:nth-child\\(1\\)`), `${l.name} has a thumbnail`);
  });
  MOTION.forEach((l) => assert.ok(site.includes(`L === '${l.base || l.key}'`), `${l.name} has its page`));
});

test("Mira can choose every design, and says when one isn't available", () => {
  const tool = require("../mira/tools/setWebsiteLayout");
  assert.deepEqual(tool.parameters.properties.layout.enum, LAYOUT_VALUES);
  MOTION.forEach((l) => assert.ok(tool.description.includes(l.name)));
});

// ---------- drawing every design with different content ----------
const photo = (n, extra = {}) => ({ image_url: `https://bucket.example/images/website/org_1/photo${n}.jpg`, caption: `Photo ${n}`, ...extra });
function contentFor(kind) {
  const now = new Date("2026-11-09T12:00:00Z");
  const base = {
    now,
    orgDetails: { organization_id: 1, organization_name: "Sample Academy", motto: "Learn & lead", aboutus: "A friendly school.", email: "office@sample.test", organization_phone: "555-0100", logo: "https://bucket.example/images/logos/1/logo.png", public_registration_enabled: true, registration_start_date: "2026-01-01", registration_end_date: "2027-01-01" },
    aboutDetails: { emails: ["office@sample.test"], phones: ["555-0100"], mottos: ["Learn & lead"] },
    slideshowImages: [photo(1), { image_url: "https://bucket.example/video.mp4", media_type: "video", poster_url: "https://bucket.example/images/website/poster.jpg" }],
    galleryImages: Array.from({ length: 15 }, (_, i) => photo(i + 2)),
    texts: [{ heading: "News", paragraph: "<p>Something <b>good</b> happened.</p>" }],
    events: [{ name: "Open day", details: "Come and see.", event_date: "2026-11-20" }],
    announcements: [{ message: "Fees due Friday", visibility: "public" }],
    extras: {
      hero: { enabled: true, kicker: "Welcome", tagline: "Where children shine" },
      quickFacts: { items: [{ value: "1,250+", label: "Students" }, { value: "98%", label: "Pass rate" }, { value: "K-12", label: "Grades" }] },
      welcome: { title: "A word from our principal", items: [{ name: "Dr. Ada Lane", role: "Principal", message: "Hello families.", imageUrl: "https://bucket.example/images/website/ada.jpg" }] },
      programs: { title: "Programs", intro: "", items: [{ title: "STEM", description: "Robots", imageUrl: "https://bucket.example/images/website/stem.jpg" }, { title: "Arts", description: "Music" }] },
      admissions: { title: "Admissions", intro: "", items: [{ title: "Apply", description: "Online" }] },
      leadership: { title: "Leadership", items: [{ name: "Sam Ray", role: "Head", imageUrl: "https://bucket.example/images/website/sam.jpg" }] },
      achievements: { title: "Awards", items: [{ year: "2026", title: "Science fair" }] },
      testimonials: { title: "Families", items: [{ quote: "Great school", name: "A parent", relation: "Grade 2" }] },
      faq: { title: "FAQ", items: [{ question: "Uniform?", answer: "Yes." }] },
      contact: { title: "Contact", intro: "", officeHours: "8-4", showMap: false, notifyEmail: "office@sample.test", address: "1 School Road" },
      about: { imageUrl: "https://bucket.example/images/website/campus.jpg", imageCaption: "Our campus" },
    },
  };
  if (kind === "no photos") return { ...base, slideshowImages: [], galleryImages: [], extras: { ...base.extras, about: null, welcome: { ...base.extras.welcome, items: [{ ...base.extras.welcome.items[0], imageUrl: "" }] } } };
  if (kind === "bare") return { now, orgDetails: { organization_id: 2, organization_name: "Tiny School" }, aboutDetails: {}, extras: {} };
  if (kind === "no banner") return { ...base, extras: { ...base.extras, hero: { enabled: false } } };
  return base;
}
const helpers = {
  publicImageUrl: (value) => String(value || ""),
  assetUrl: (value) => value,
};
function draw(site) {
  return ejs.render(fs.readFileSync(SITE, "utf8"), { site, ...helpers }, { filename: SITE });
}

test("every design draws every kind of school website without an error", () => {
  for (const kind of ["full", "no photos", "bare", "no banner"]) {
    for (const layout of LAYOUTS) {
      const site = buildSiteModel({ ...contentFor(kind), layout: layout.value });
      let html = "";
      assert.doesNotThrow(() => { html = draw(site); }, `${layout.name} / ${kind}`);
      assert.ok(html.includes(`sw-site--${layout.key}`), `${layout.name} / ${kind} draws its own design`);
      assert.equal(html.includes('src="/js/schoolSiteMotion.js"'), Boolean(layout.motion), `${layout.name} / ${kind}: motion script only for the 3D designs`);
    }
  }
});

test("every uploaded photo sits in a whole-photo frame", () => {
  const after = draw(buildSiteModel({ ...contentFor("full"), layout: "wireframe9" }));
  assert.match(after, /<span class="sw-photo sw-card__media" data-sw-photo="photo">/);
  assert.match(after, /<span class="sw-photo sw-welcome__photo" data-sw-photo="person">/);
  assert.match(after, /<span class="sw-photo sw-person__photo" data-sw-photo="person">/);
  assert.match(after, /<span class="sw-photo sw-about__photo" data-sw-photo="photo">/);
  assert.match(after, /class="sw-slide[^"]*"[^>]*data-sw-photo="hero"/);
  // Each frame has the blurred copy (hidden from screen readers) and the photo with its description.
  assert.match(after, /<img class="sw-photo__blur" src="[^"]+" alt="" aria-hidden="true"/);
  assert.match(after, /<img class="sw-photo__img" src="https:\/\/bucket\.example\/images\/website\/stem\.jpg" alt="STEM"/);
});

test("the 3D designs show the first 12 photos and open the rest in the photo viewer", () => {
  for (const layout of MOTION) {
    const html = draw(buildSiteModel({ ...contentFor("full"), layout: layout.value }));
    assert.equal((html.match(/<figure class="sw-gallery__item" hidden>/g) || []).length, 3, `${layout.name} hides 3 of 15`);
    assert.match(html, /data-sw-lightbox-more="12">See 3 more photos</);
    assert.equal((html.match(/data-sw-lightbox="/g) || []).length, 15, "every photo is still in the viewer");
  }
  const classic = draw(buildSiteModel({ ...contentFor("full"), layout: "wireframe1" }));
  assert.ok(!classic.includes('data-sw-lightbox-more="'), "the other designs show every photo");
  assert.ok(!classic.includes("<figure class=\"sw-gallery__item\" hidden>"));
});

test("the 3D designs never hide content from visitors who ask for less motion or have no scripts", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/css/school-website-3d.css"), "utf8");
  // Starting positions (hidden, tilted) apply only under .sw-moving, which the page sets only
  // when motion is allowed, and which is removed again if the motion script never loads.
  css.split("}").forEach((rule) => {
    const [selector = "", body = ""] = rule.split("{");
    if (/opacity:\s*0[;\s]/.test(body) && !/:hover|is-shown|\.sw-pa-dots|@keyframes|^\s*(from|to|\d+%)/.test(selector)) {
      assert.match(selector, /\.sw-moving/, `hidden only while moving: ${selector.trim().slice(0, 120)}`);
    }
  });
  const site = fs.readFileSync(SITE, "utf8");
  assert.match(site, /prefers-reduced-motion: reduce/);
  assert.match(site, /if \(!window\.swMotionReady\) s\.classList\.remove\('sw-moving'\)/);
  const js = fs.readFileSync(path.join(ROOT, "public/js/schoolSiteMotion.js"), "utf8");
  assert.match(js, /lessMotion && lessMotion\.matches/);
});

test("an emblem design shows the school's emblem: one of ours, its logo or its own image", () => {
  const icon = buildSiteModel({ ...contentFor("full"), layout: "wireframe15" });
  assert.equal(icon.layout, "spotlight", "Mascot is drawn on Spotlight's page");
  assert.equal(icon.design, "mascot");
  assert.equal(icon.emblem.kind, "icon");
  assert.equal(icon.emblem.icon, emblems.DEFAULT_EMBLEM, "a school that never chose gets the shield");
  const html = draw(icon);
  assert.match(html, /class="sw-site sw-site--spotlight sw-site--mascot sw-emblem sw-emblem--icon sw-emblem--pattern/);
  assert.match(html, /--sw-emblem-pattern: url\(&#34;data:image\/svg\+xml,/);
  assert.match(html, /<span class="sw-emblem-mark sw-emblem-mark--panel" aria-hidden="true"><svg/);

  const lion = buildSiteModel({ ...contentFor("full"), extras: { ...contentFor("full").extras, emblem: normalizeSection("emblem", { kind: "icon", icon: "lion", placement: "single" }) }, layout: "wireframe14" });
  assert.equal(lion.emblem.icon, "lion");
  assert.match(draw(lion), /sw-site--classic sw-site--crest sw-emblem sw-emblem--icon sw-emblem--single/);

  const logo = buildSiteModel({ ...contentFor("full"), extras: { ...contentFor("full").extras, emblem: normalizeSection("emblem", { kind: "logo" }) }, layout: "wireframe13" });
  assert.equal(logo.emblem.kind, "image");
  assert.match(draw(logo), /--sw-emblem-image: url\(&#34;https:\/\/bucket\.example\/images\/logos\/1\/logo\.png&#34;\)/);
  assert.match(draw(logo), /class="sw-emblem-mark sw-or-emblem sw-emblem-mark--image" aria-hidden="true" data-sw-orbit><img/);

  // A link that could break out of the page's CSS is never used.
  const unsafe = buildSiteModel({ ...contentFor("full"), orgDetails: { ...contentFor("full").orgDetails, logo: 'https://x.example/a") ;}' }, extras: { ...contentFor("full").extras, emblem: { kind: "logo" } }, layout: "wireframe14" });
  assert.equal(unsafe.emblem.kind, "icon");
  assert.equal(normalizeSection("emblem", { kind: "image", imageUrl: "javascript:alert(1)" }).kind, "icon");
  assert.equal(normalizeSection("emblem", { icon: "no-such-emblem" }).icon, emblems.DEFAULT_EMBLEM);
});

test("every emblem draws as a picture and as a pattern", () => {
  assert.ok(emblems.EMBLEMS.length >= 20);
  emblems.EMBLEMS.forEach((e) => {
    const svg = emblems.emblemSvg(e.key, { idPrefix: "t" });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
    assert.ok(!/NaN|undefined/.test(svg), `${e.name} has no broken numbers`);
    assert.match(emblems.emblemPatternUrl(e.key), /^data:image\/svg\+xml,%3Csvg/);
  });
  assert.equal(new Set(emblems.EMBLEMS.map((e) => e.key)).size, emblems.EMBLEMS.length);
});
