const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { sendSms, verifySmsConnection } = require("../utils/smsIntegration");

test("Africa's Talking live connection check uses the live username and endpoint", async () => {
  const originalGet = axios.get;
  let request;
  axios.get = async (url, options) => {
    request = { url, options };
    return { data: { UserData: { balance: "KES 100" } } };
  };

  try {
    const result = await verifySmsConnection({
      provider: "africastalking",
      username: "school-live",
      apiKey: "test-live-key",
      sandbox: false,
    });

    assert.equal(result.ok, true);
    assert.match(request.url, /^https:\/\/api\.africastalking\.com\/version1\/user$/);
    assert.deepEqual(request.options.params, { username: "school-live" });
    assert.equal(request.options.headers.apiKey, "test-live-key");
  } finally {
    axios.get = originalGet;
  }
});

test("Africa's Talking sandbox check uses the sandbox username and endpoint", async () => {
  const originalGet = axios.get;
  let request;
  axios.get = async (url, options) => {
    request = { url, options };
    return { data: { UserData: { balance: "KES 100" } } };
  };

  try {
    const result = await verifySmsConnection({
      provider: "africastalking",
      username: "",
      apiKey: "test-sandbox-key",
      sandbox: true,
    });

    assert.equal(result.ok, true);
    assert.match(request.url, /^https:\/\/api\.sandbox\.africastalking\.com\/version1\/user$/);
    assert.deepEqual(request.options.params, { username: "sandbox" });
    assert.equal(request.options.headers.apiKey, "test-sandbox-key");
  } finally {
    axios.get = originalGet;
  }
});

test("Africa's Talking sandbox send uses the same sandbox username and endpoint", async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, options) => {
    request = { url, body: new URLSearchParams(body), options };
    return {
      data: {
        SMSMessageData: {
          Recipients: [{ messageId: "test-message", status: "Success" }],
        },
      },
    };
  };

  try {
    const result = await sendSms({
      provider: "africastalking",
      username: "",
      apiKey: "test-sandbox-key",
      sandbox: true,
    }, "Test message", ["+233551234567"]);

    assert.equal(result.success, true);
    assert.match(request.url, /^https:\/\/api\.sandbox\.africastalking\.com\/version1\/messaging$/);
    assert.equal(request.body.get("username"), "sandbox");
    assert.equal(request.options.headers.apiKey, "test-sandbox-key");
  } finally {
    axios.post = originalPost;
  }
});

test("Africa's Talking credential rejections name the selected environment", async () => {
  const originalGet = axios.get;
  axios.get = async () => {
    const error = new Error("Unauthorized");
    error.response = { status: 401 };
    throw error;
  };

  try {
    const result = await verifySmsConnection({
      provider: "africastalking",
      username: "school-live",
      apiKey: "test-live-key",
      sandbox: false,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /rejected the live credentials/);
    assert.doesNotMatch(result.message, /test-live-key/);
  } finally {
    axios.get = originalGet;
  }
});
