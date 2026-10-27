const test = require("node:test");
const assert = require("node:assert");
const { toInternationalPhone, normalizeWhatsappPhoneNumber, describePhone } = require("../utils/phoneNumber");
const { whatsappRecipient } = require("../utils/whatsappIntegration");
const { sendSms } = require("../utils/smsIntegration");

test("local numbers get the school's country code", () => {
  assert.strictEqual(toInternationalPhone("0244 123 456", "GH"), "+233244123456");
  assert.strictEqual(toInternationalPhone("(801) 555-1234", "US"), "+18015551234");
  assert.strictEqual(toInternationalPhone("0803 123 4567", "ng"), "+2348031234567");
  assert.strictEqual(toInternationalPhone("0712345678", "KE"), "+254712345678");
});

test("numbers that already have a country code keep it", () => {
  assert.strictEqual(toInternationalPhone("+233 24 412 3456", "US"), "+233244123456");
  assert.strictEqual(toInternationalPhone("233244123456", "GH"), "+233244123456");
  assert.strictEqual(toInternationalPhone("0044 7911 123456", "GH"), "+447911123456");
});

test("numbers that can't be dialled are refused", () => {
  assert.strictEqual(toInternationalPhone("12345", "GH"), null);
  assert.strictEqual(toInternationalPhone("", "GH"), null);
  assert.strictEqual(toInternationalPhone("0244123456", "US"), null);
  assert.strictEqual(normalizeWhatsappPhoneNumber("", "GH").valid, false);
});

test("WhatsApp gets digits with the country code", () => {
  assert.deepStrictEqual(normalizeWhatsappPhoneNumber("0244123456", "GH"), { normalized: "233244123456", valid: true, reason: "" });
  assert.strictEqual(whatsappRecipient("(801) 555-1234", "US"), "18015551234");
  assert.strictEqual(describePhone("0244123456", "GH").display, "+233 24 412 3456");
});

test("each SMS provider is sent the number in the form it expects", async () => {
  const axios = require("axios");
  const original = axios.post;
  const sent = [];
  axios.post = async (url, body) => {
    sent.push({ url, body });
    return { data: { status: "success", data: [{ id: "m1" }], SMSMessageData: { Recipients: [{ messageId: "m1", status: "Success", statusCode: 101 }] } } };
  };
  try {
    await sendSms({ provider: "arkesel", apiKey: "k", countryCode: "GH" }, "Hi", ["0244 123 456"]).catch(() => {});
    assert.deepStrictEqual(sent[0].body.recipients, ["233244123456"]);
    await assert.rejects(sendSms({ provider: "arkesel", apiKey: "k", countryCode: "GH" }, "Hi", ["123"]), /Invalid phone number/);
  } finally {
    axios.post = original;
  }
});
