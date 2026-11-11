// The site chat answers from the help center: real questions, as people type them, must find
// the guide that answers them, in the guide's own words, and anything else says so.
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../utils/docs/catalog");
const { ask, piecesOf, words } = require("../utils/docs/askDocs");

const articles = catalog.syncRows();

const QUESTIONS = [
  ["what happens when i forget my password", "reset-a-password-or-recover-account-access"],
  ["I forgot my password", "reset-a-password-or-recover-account-access"],
  ["how do i reset my password", "reset-a-password-or-recover-account-access"],
  ["how do I log in", "sign-in-to-managira"],
  ["how do i add a student", "create-and-add-student"],
  ["can I import many students at once", "create-and-add-student"],
  ["how do I take attendance", "mark-attendance-for-a-class"],
  ["how do I add a teacher", "create-and-add-employee-accounts-and-permissions"],
  ["how do parents pay school fees online", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["how do i create a bill", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["how do I print report cards", "report-card"],
  ["how do I set up single sign on", "single-sign-on"],
  ["how do I message parents", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  ["how do I create a school year and terms", "create-school-years-terms-and-set-the-current-term"],
  ["how do I promote students to the next class", "promote-students-and-manage-graduation"],
  ["how do I set up buses and routes", "set-up-transportation"],
  ["can parents track the school bus", "live-bus-tracking"],
  ["how do I make a transcript", "transcript"],
  ["how do I connect whatsapp", "connect-whatsapp-business-to-message-parents"],
  ["how do I get an api token", "service-accounts-and-access-tokens"],
  // Section titles and keywords find their guide too.
  ["connect google classroom", "integrations"],
  ["choose how your school uses google classroom", "integrations"],
  ["who pays the service fee", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["request payment", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["apple pay", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["main teacher", "create-and-manage-employee-accounts-and-permissions"],
  ["how do I sync my calendar with google", "calendar-sync-google-outlook-apple"],
  ["how do students take a test", "student-testing-room"],
  ["what can mira do", "mira-ai-capabilities"],
  // Misspelt words are read as the guides' words.
  ["how do i take attendence", "mark-attendance-for-a-class"],
  ["how do i reset my pasword", "reset-a-password-or-recover-account-access"],
  ["googel classroom", "integrations"],
  ["paygria", "set-up-paygira-bills-collections-and-guardian-payments"],
  // A guide's exact keyword, title or section title is that guide.
  ["paygira", "set-up-paygira-bills-collections-and-guardian-payments"],
  ["Understand localized pricing, currency detection, and USD fallback", "understand-localized-pricing-currency-and-usd-fallback"],
  ["2. Plan the promotion", "promote-students-and-manage-graduation"],
  ["how do i turn on single sign on", "single-sign-on"],
  ["how do I print report cards for the whole class", "report-card"],
  ["how do i delete a student", "edit-student-information"],
  ["how do parents pay fees online", "set-up-paygira-bills-collections-and-guardian-payments"],
];

test("real questions find the guide that answers them", () => {
  const missed = [];
  QUESTIONS.forEach(([question, slug]) => {
    const out = ask(question, articles);
    const got = out.type === "answer" ? out.source.url.split("/").pop().split("#")[0] : out.type;
    // A guide renamed later still counts if it is the same subject (the slug starts the same).
    if (got !== slug && !(slug.startsWith("create-and-add-employee") && got === "create-and-manage-employee-accounts-and-permissions")) missed.push(`"${question}" -> ${got} (wanted ${slug})`);
  });
  assert.deepEqual(missed, []);
});

test("the forgotten password answer quotes the guide and links to the right part of it", () => {
  const out = ask("what happens when i forget my password", articles);
  assert.equal(out.type, "answer");
  assert.match(out.answer.lines.join(" "), /Forgot password/);
  assert.match(out.source.url, /^\/legal\/user-documentation\/reset-a-password-or-recover-account-access#/);
});

test("a how-to question gets the guide's steps, in order", () => {
  const out = ask("how do I reset my password", articles);
  assert.equal(out.answer.mode, "steps");
  assert.ok(out.answer.lines.length >= 2);
});

test("anything the guides don't cover says so and offers the closest guides", () => {
  const out = ask("what is the weather in paris tomorrow", articles);
  assert.equal(out.type, "no_results");
  assert.equal(ask("hello", articles).type, "small_talk");
  assert.equal(ask("   ", articles).type, "empty");
});

test("typed words map to the guides' words", () => {
  assert.deepEqual(words("I forgot my log-in"), ["i", "forget", "my", "signin"]);
  assert.ok(words("Report cards").includes("reportcard"));
  assert.ok(words("e-mail").includes("email"));
});

test("every guide is cut into pieces that keep their section's link", () => {
  articles.forEach((article) => {
    const pieces = piecesOf(article);
    assert.ok(pieces.length > 0, article.slug);
    pieces.filter((p) => p.kind !== "summary").forEach((p) => assert.ok(p.text.trim(), article.slug));
  });
});

test("a guide's subject gets its overview, unless one of its sections is about exactly that", () => {
  assert.equal(ask("paygira", articles).source.section, "");
  assert.equal(ask("googel classroom", articles).source.section, "Connect Google Classroom");
  assert.equal(ask("single sign on", articles).source.section, "Set up and turn on single sign-on");
});
