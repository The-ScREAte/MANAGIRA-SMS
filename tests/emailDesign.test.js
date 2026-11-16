// The email look (utils/emailLayout.js), its plain-text part and the unsubscribe links
// (utils/emailLinks.js). Pure functions: no database, nothing is sent.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.EMAIL_LINK_SECRET = "email-design-test-secret";
const { renderModernEmail, htmlToPlainText, unsubscribeLine, UNSUBSCRIBE_SLOT } = require("../utils/emailLayout");
const links = require("../utils/emailLinks");
const { categoryOf, EMAIL_NOUNS, GUARDIAN_TOGGLEABLE, STAFF_TOGGLEABLE, HUB_TOGGLEABLE, STUDENT_TOGGLEABLE } = require("../utils/emailPreferences");

test("a school's email carries its name, one button, a preview line and the unsubscribe slot", () => {
  const html = renderModernEmail({
    title: "Report card for Audrey Diaz",
    greeting: "Hi Maria,",
    paragraphs: ["Audrey's fall report card is ready."],
    details: [{ label: "Term", value: "Fall 2026" }, "Plain <text>"],
    cta: { text: "View report card", url: "https://managira.com/guardian/reports?x=1&y=2" },
    schoolName: "Alpine <Test> School",
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes("Alpine &lt;Test&gt; School"), "school name escaped");
  assert.ok(html.includes("Sent by Alpine &lt;Test&gt; School through Managira."));
  assert.ok(html.includes("Plain &lt;text&gt;"), "plain detail strings are escaped");
  assert.equal((html.match(/View report card<\/a>/g) || []).length, 1);
  assert.ok(html.includes(UNSUBSCRIBE_SLOT));
  assert.match(html, /<!--preheader--><div[^>]*>Audrey&#39;s fall report card is ready\./);
  assert.ok(!/NO-REPLY|LinkedIn/i.test(html), "no shouting, no marketing");
});

test("Managira's own email shows the Managira brand and the help link", () => {
  const html = renderModernEmail({ title: "Reset your password", paragraphs: ["x"] });
  assert.ok(html.includes("managira-logo-sm.png"));
  assert.ok(html.includes("/legal/user-documentation"));
  assert.ok(!html.includes("Sent by"));
});

test("only http(s) and mailto links become buttons", () => {
  const html = renderModernEmail({ title: "x", cta: { text: "Open", url: "javascript:alert(1)" } });
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes(">Open</a>"));
});

test("the plain-text part keeps link addresses and drops the preview padding", () => {
  const html = renderModernEmail({
    title: "Set your password",
    paragraphs: ["Welcome.", "<ul><li>One</li><li>Two</li></ul>"],
    cta: { text: "Set your password", url: "https://managira.com/account/set?token=a&b=c" },
  });
  const text = htmlToPlainText(html);
  assert.ok(text.includes("Set your password (https://managira.com/account/set?token=a&b=c)"));
  assert.ok(text.includes("- One\n- Two"));
  assert.ok(!text.includes("&zwnj;") && !text.includes("͏"));
  assert.ok(!text.includes("<"), "no tags left");
  assert.ok(!/^: /m.test(text), "no empty labels");
  assert.equal(htmlToPlainText("<p>St. Mary&#x27;s &#38; Co&#39;s</p>"), "St. Mary's & Co's", "numeric entities decoded");
});

test("unsubscribe tokens round-trip and refuse tampering", () => {
  const token = links.unsubscribeToken("Maria.Diaz@Example.com", "weekly_parent_digest");
  assert.deepEqual(links.readUnsubscribeToken(token), { email: "maria.diaz@example.com", category: "weekly_parent_digest" });
  assert.equal(links.readUnsubscribeToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")), null);
  const [v, email, , sig] = token.split(".");
  const other = Buffer.from("report_card_email").toString("base64url");
  assert.equal(links.readUnsubscribeToken([v, email, other, sig].join(".")), null, "a signature is for one kind of email");
  assert.equal(links.readUnsubscribeToken("garbage"), null);
  assert.match(links.unsubscribeUrl("a@b.co", "bus_arrival"), /^https:\/\/[^/]+\/email\/unsubscribe\?t=/);
});

test("every kind of optional email has a short name for its unsubscribe line", () => {
  for (const entry of [...STAFF_TOGGLEABLE, ...GUARDIAN_TOGGLEABLE, ...HUB_TOGGLEABLE, ...STUDENT_TOGGLEABLE]) {
    assert.ok(EMAIL_NOUNS[entry.key], `EMAIL_NOUNS is missing ${entry.key}`);
    assert.equal(categoryOf(entry.key).label, EMAIL_NOUNS[entry.key]);
  }
  assert.equal(categoryOf("password_reset"), null, "unknown kinds get no unsubscribe");
  const line = unsubscribeLine({ url: "https://managira.com/email/unsubscribe?t=x", settingsUrl: "https://managira.com/email/settings", label: "weekly briefings" });
  assert.ok(line.includes("Don&#39;t want weekly briefings?") || line.includes("Don't want weekly briefings?"));
});
