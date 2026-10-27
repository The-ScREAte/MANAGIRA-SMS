const axios = require("axios");
const { toInternationalPhone, INVALID_PHONE_MESSAGE } = require("./phoneNumber");
const { encryptSecret, decryptSecret, maskSecret } = require("./encryption");

const PROVIDERS = ["arkesel", "africastalking", "twilio"];
const AFRICAN_COUNTRY_CODES = new Set([
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI",
  "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY",
  "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL",
  "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW",
]);

let smsSchemaReady = false;

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function isValidProvider(provider) {
  return PROVIDERS.includes(safeString(provider).toLowerCase());
}

function isTwilioAvailableForCountry(countryCode) {
  const normalizedCountryCode = safeString(countryCode).toUpperCase();
  return Boolean(normalizedCountryCode) && !AFRICAN_COUNTRY_CODES.has(normalizedCountryCode);
}

async function ensureSmsIntegrationSchema(dbClient) {
  if (smsSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS sms_active_provider TEXT,

      ADD COLUMN IF NOT EXISTS sms_arkesel_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_arkesel_configured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_arkesel_sender_id TEXT,
      ADD COLUMN IF NOT EXISTS sms_arkesel_api_key_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS sms_arkesel_last_status TEXT,
      ADD COLUMN IF NOT EXISTS sms_arkesel_last_error TEXT,
      ADD COLUMN IF NOT EXISTS sms_arkesel_last_tested_at TIMESTAMPTZ,

      ADD COLUMN IF NOT EXISTS sms_africastalking_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_africastalking_configured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_africastalking_username TEXT,
      ADD COLUMN IF NOT EXISTS sms_africastalking_sender_id TEXT,
      ADD COLUMN IF NOT EXISTS sms_africastalking_api_key_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS sms_africastalking_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_africastalking_last_status TEXT,
      ADD COLUMN IF NOT EXISTS sms_africastalking_last_error TEXT,
      ADD COLUMN IF NOT EXISTS sms_africastalking_last_tested_at TIMESTAMPTZ,

      ADD COLUMN IF NOT EXISTS sms_twilio_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_twilio_configured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sms_twilio_account_sid TEXT,
      ADD COLUMN IF NOT EXISTS sms_twilio_from_number TEXT,
      ADD COLUMN IF NOT EXISTS sms_twilio_auth_token_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS sms_twilio_last_status TEXT,
      ADD COLUMN IF NOT EXISTS sms_twilio_last_error TEXT,
      ADD COLUMN IF NOT EXISTS sms_twilio_last_tested_at TIMESTAMPTZ
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS sms_delivery_logs (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_message_id TEXT,
      recipient TEXT,
      status TEXT,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_org
      ON sms_delivery_logs (organization_id, created_at DESC)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_message_id
      ON sms_delivery_logs (provider, provider_message_id)
  `);

  smsSchemaReady = true;
}

function buildSmsIntegrationStatus(row = {}) {
  const activeProvider = safeString(row.sms_active_provider).toLowerCase();

  const arkesel = {
    provider: "arkesel",
    activated: parseBoolean(row.sms_arkesel_activated, false),
    configured: parseBoolean(row.sms_arkesel_configured, false),
    senderId: safeString(row.sms_arkesel_sender_id),
    maskedApiKey: maskSecret(decryptSecret(row.sms_arkesel_api_key_encrypted)),
    lastStatus: safeString(row.sms_arkesel_last_status) || "idle",
    lastError: safeString(row.sms_arkesel_last_error),
    lastTestedAt: row.sms_arkesel_last_tested_at || null,
  };

  const africastalking = {
    provider: "africastalking",
    activated: parseBoolean(row.sms_africastalking_activated, false),
    configured: parseBoolean(row.sms_africastalking_configured, false),
    username: safeString(row.sms_africastalking_username),
    senderId: safeString(row.sms_africastalking_sender_id),
    sandbox: parseBoolean(row.sms_africastalking_sandbox, false),
    maskedApiKey: maskSecret(decryptSecret(row.sms_africastalking_api_key_encrypted)),
    lastStatus: safeString(row.sms_africastalking_last_status) || "idle",
    lastError: safeString(row.sms_africastalking_last_error),
    lastTestedAt: row.sms_africastalking_last_tested_at || null,
  };

  const twilio = {
    provider: "twilio",
    activated: parseBoolean(row.sms_twilio_activated, false),
    configured: parseBoolean(row.sms_twilio_configured, false),
    accountSid: safeString(row.sms_twilio_account_sid),
    fromNumber: safeString(row.sms_twilio_from_number),
    maskedAuthToken: maskSecret(decryptSecret(row.sms_twilio_auth_token_encrypted)),
    lastStatus: safeString(row.sms_twilio_last_status) || "idle",
    lastError: safeString(row.sms_twilio_last_error),
    lastTestedAt: row.sms_twilio_last_tested_at || null,
  };

  return {
    activeProvider: isValidProvider(activeProvider) ? activeProvider : "",
    providers: { arkesel, africastalking, twilio },
  };
}

const SMS_INTEGRATION_COLUMNS = `
  sms_active_provider,
  sms_arkesel_activated, sms_arkesel_configured, sms_arkesel_sender_id, sms_arkesel_api_key_encrypted,
  sms_arkesel_last_status, sms_arkesel_last_error, sms_arkesel_last_tested_at,
  sms_africastalking_activated, sms_africastalking_configured, sms_africastalking_username,
  sms_africastalking_sender_id, sms_africastalking_api_key_encrypted, sms_africastalking_sandbox,
  sms_africastalking_last_status, sms_africastalking_last_error, sms_africastalking_last_tested_at,
  sms_twilio_activated, sms_twilio_configured, sms_twilio_account_sid, sms_twilio_from_number,
  sms_twilio_auth_token_encrypted, sms_twilio_last_status, sms_twilio_last_error, sms_twilio_last_tested_at
`;

async function getSmsIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildSmsIntegrationStatus({});
  await ensureSmsIntegrationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT ${SMS_INTEGRATION_COLUMNS} FROM organizations WHERE organization_id = $1 LIMIT 1`,
    [organizationId]
  );

  return buildSmsIntegrationStatus(result.rows[0] || {});
}

async function setSmsProviderActivation(dbClient, organizationId, provider, activated) {
  if (!isValidProvider(provider)) throw new Error("Unsupported SMS provider.");
  await ensureSmsIntegrationSchema(dbClient);

  const normalizedProvider = safeString(provider).toLowerCase();
  const activatedColumn = `sms_${normalizedProvider}_activated`;

  await dbClient.query(
    `UPDATE organizations SET ${activatedColumn} = $2 WHERE organization_id = $1`,
    [organizationId, Boolean(activated)]
  );

  if (!activated) {
    // Never leave a stale "active" pointer at a provider that was just deactivated.
    await dbClient.query(
      `UPDATE organizations
       SET sms_active_provider = NULL
       WHERE organization_id = $1 AND sms_active_provider = $2`,
      [organizationId, normalizedProvider]
    );
  }
}

async function saveArkeselSettings(dbClient, organizationId, { apiKey, senderId }) {
  await ensureSmsIntegrationSchema(dbClient);

  // Sender ID is optional: Arkesel accepts sends without a whitelisted one,
  // it just falls back to a generic/shared sender — some Ghana networks
  // (AirtelTigo) may filter those without a Letter of Authorization on
  // file, while others (MTN, Telecel) are more lenient. Schools can start
  // sending immediately and register a branded sender ID later.
  const normalizedSenderId = safeString(senderId).slice(0, 11);

  const normalizedApiKey = safeString(apiKey);
  const encryptedApiKey = normalizedApiKey ? encryptSecret(normalizedApiKey) : null;

  await dbClient.query(
    `UPDATE organizations
     SET sms_arkesel_configured = TRUE,
         sms_arkesel_sender_id = NULLIF($2, ''),
         sms_arkesel_api_key_encrypted = COALESCE($3, sms_arkesel_api_key_encrypted),
         sms_active_provider = 'arkesel',
         sms_arkesel_last_error = NULL
     WHERE organization_id = $1`,
    [organizationId, normalizedSenderId, encryptedApiKey]
  );
}

async function saveAfricasTalkingSettings(dbClient, organizationId, { username, apiKey, senderId, sandbox }) {
  await ensureSmsIntegrationSchema(dbClient);

  const normalizedUsername = safeString(username);
  if (!normalizedUsername) throw new Error("Username is required.");

  const normalizedSenderId = safeString(senderId).slice(0, 11);
  const normalizedApiKey = safeString(apiKey);
  const encryptedApiKey = normalizedApiKey ? encryptSecret(normalizedApiKey) : null;

  await dbClient.query(
    `UPDATE organizations
     SET sms_africastalking_configured = TRUE,
         sms_africastalking_username = $2,
         sms_africastalking_sender_id = NULLIF($3, ''),
         sms_africastalking_api_key_encrypted = COALESCE($4, sms_africastalking_api_key_encrypted),
         sms_africastalking_sandbox = $5,
         sms_active_provider = 'africastalking',
         sms_africastalking_last_error = NULL
     WHERE organization_id = $1`,
    [organizationId, normalizedUsername, normalizedSenderId, encryptedApiKey, Boolean(sandbox)]
  );
}

async function saveTwilioSettings(dbClient, organizationId, { accountSid, authToken, fromNumber }) {
  await ensureSmsIntegrationSchema(dbClient);

  const normalizedAccountSid = safeString(accountSid);
  const normalizedFromNumber = safeString(fromNumber);
  if (!normalizedAccountSid) throw new Error("Account SID is required.");
  if (!normalizedFromNumber) throw new Error("Sender phone number is required.");

  const normalizedAuthToken = safeString(authToken);
  const encryptedAuthToken = normalizedAuthToken ? encryptSecret(normalizedAuthToken) : null;

  await dbClient.query(
    `UPDATE organizations
     SET sms_twilio_configured = TRUE,
         sms_twilio_account_sid = $2,
         sms_twilio_from_number = $3,
         sms_twilio_auth_token_encrypted = COALESCE($4, sms_twilio_auth_token_encrypted),
         sms_active_provider = 'twilio',
         sms_twilio_last_error = NULL
     WHERE organization_id = $1`,
    [organizationId, normalizedAccountSid, normalizedFromNumber, encryptedAuthToken]
  );
}

async function markSmsProviderTestResult(dbClient, organizationId, provider, { success, errorMessage }) {
  if (!isValidProvider(provider)) return;
  await ensureSmsIntegrationSchema(dbClient);

  const normalizedProvider = safeString(provider).toLowerCase();
  await dbClient.query(
    `UPDATE organizations
     SET sms_${normalizedProvider}_last_status = $2,
         sms_${normalizedProvider}_last_error = $3,
         sms_${normalizedProvider}_last_tested_at = NOW()
     WHERE organization_id = $1`,
    [organizationId, success ? "success" : "error", success ? null : safeString(errorMessage).slice(0, 800)]
  );
}

// Loads and decrypts the org's currently active provider's credentials, ready for sendSms().
async function getTenantSmsCredentials(dbClient, organizationId) {
  if (!organizationId) throw new Error("Organization is required.");
  await ensureSmsIntegrationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT organization_country, ${SMS_INTEGRATION_COLUMNS} FROM organizations WHERE organization_id = $1 LIMIT 1`,
    [organizationId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Organization not found.");

  const provider = safeString(row.sms_active_provider).toLowerCase();
  if (!isValidProvider(provider)) {
    throw new Error("No SMS provider is configured for this school yet. Set one up under Settings → Integrations.");
  }

  if (provider === "twilio" && !isTwilioAvailableForCountry(row.organization_country)) {
    throw new Error("Twilio is not available for schools in African countries.");
  }

  if (provider === "arkesel") {
    const apiKey = decryptSecret(row.sms_arkesel_api_key_encrypted);
    if (!apiKey) throw new Error("Arkesel API key is missing. Re-save your Arkesel settings.");
    return {
      organizationId,
      provider,
      countryCode: safeString(row.organization_country).toUpperCase(),
      apiKey,
      senderId: safeString(row.sms_arkesel_sender_id),
    };
  }

  if (provider === "africastalking") {
    const apiKey = decryptSecret(row.sms_africastalking_api_key_encrypted);
    if (!apiKey) throw new Error("Africa's Talking API key is missing. Re-save your settings.");
    return {
      organizationId,
      provider,
      countryCode: safeString(row.organization_country).toUpperCase(),
      apiKey,
      username: safeString(row.sms_africastalking_username),
      senderId: safeString(row.sms_africastalking_sender_id),
      sandbox: parseBoolean(row.sms_africastalking_sandbox, false),
    };
  }

  const authToken = decryptSecret(row.sms_twilio_auth_token_encrypted);
  if (!authToken) throw new Error("Twilio auth token is missing. Re-save your Twilio settings.");
  return {
    organizationId,
    provider,
    countryCode: safeString(row.organization_country).toUpperCase(),
    authToken,
    accountSid: safeString(row.sms_twilio_account_sid),
    fromNumber: safeString(row.sms_twilio_from_number),
  };
}

function normalizeRecipients(recipients) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  return list.map((value) => safeString(value)).filter(Boolean);
}

async function sendViaArkesel(tenant, message, recipients, callbackUrl) {
  if (!tenant.apiKey) throw new Error("Arkesel API key is missing.");

  // Arkesel's API requires a sender value, but schools don't have to wait on
  // a whitelisted/branded one to start sending — fall back to a generic
  // identifiable sender until they register their own. Delivery to Ghana's
  // AirtelTigo network may be filtered without a whitelisted sender ID
  // (Letter of Authorization); MTN and Telecel are more lenient.
  const payload = {
    sender: tenant.senderId || "Managira",
    message,
    recipients,
  };
  if (callbackUrl) payload.callback_url = callbackUrl;

  let response;
  try {
    response = await axios.post("https://sms.arkesel.com/api/v2/sms/send", payload, {
      headers: {
        "api-key": tenant.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });
  } catch (error) {
    const apiMessage = safeString(error?.response?.data?.message || error?.message);
    throw new Error(`Arkesel error: ${apiMessage || "Unable to reach Arkesel."}`);
  }

  const data = response.data || {};
  if (response.status !== 200 || safeString(data.status).toLowerCase() !== "success") {
    throw new Error(`Arkesel error: ${safeString(data.message) || "Send did not succeed."}`);
  }

  return {
    success: true,
    provider: "arkesel",
    providerMessageId: safeString(data.data?.[0]?.id) || null,
    raw: data,
  };
}

async function sendViaAfricasTalking(tenant, message, recipients, callbackUrl) {
  if (!tenant.apiKey) throw new Error("Africa's Talking API key is missing.");
  if (!tenant.username) throw new Error("Africa's Talking username is missing.");

  const baseUrl = tenant.sandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
  const username = tenant.sandbox ? "sandbox" : tenant.username;

  const form = new URLSearchParams();
  form.set("username", username);
  form.set("to", recipients.join(","));
  form.set("message", message);
  if (tenant.senderId) form.set("from", tenant.senderId);

  let response;
  try {
    response = await axios.post(baseUrl, form.toString(), {
      headers: {
        apiKey: tenant.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      timeout: 20000,
    });
  } catch (error) {
    const apiMessage = safeString(
      error?.response?.data?.SMSMessageData?.Message || error?.response?.data?.message || error?.message
    );
    throw new Error(`Africa's Talking error: ${apiMessage || "Unable to reach Africa's Talking."}`);
  }

  const recipientResults = response.data?.SMSMessageData?.Recipients || [];
  const anySucceeded = recipientResults.some((entry) => safeString(entry?.status) === "Success");

  if (!anySucceeded) {
    const failureMessage =
      safeString(recipientResults[0]?.status) ||
      safeString(response.data?.SMSMessageData?.Message) ||
      "Send did not succeed.";
    throw new Error(`Africa's Talking error: ${failureMessage}`);
  }

  return {
    success: true,
    provider: "africastalking",
    providerMessageId: safeString(recipientResults[0]?.messageId) || null,
    raw: response.data,
  };
}

async function sendViaTwilio(tenant, message, recipients) {
  if (!tenant.authToken) throw new Error("Twilio auth token is missing.");
  if (!tenant.accountSid) throw new Error("Twilio account SID is missing.");
  if (!tenant.fromNumber) throw new Error("Twilio sender phone number is missing.");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(tenant.accountSid)}/Messages.json`;
  const basicAuth = Buffer.from(`${tenant.accountSid}:${tenant.authToken}`).toString("base64");

  const results = [];
  for (const to of recipients) {
    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", tenant.fromNumber);
    form.set("Body", message);

    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await axios.post(url, form.toString(), {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 20000,
      });

      const status = safeString(response.data?.status).toLowerCase();
      if (["failed", "undelivered"].includes(status)) {
        throw new Error(response.data?.error_message || `Twilio marked this message as ${status}.`);
      }

      results.push({ to, sid: response.data?.sid, status });
    } catch (error) {
      const apiMessage = safeString(error?.response?.data?.message || error?.message);
      throw new Error(`Twilio error: ${apiMessage || `Unable to send to ${to}.`}`);
    }
  }

  return {
    success: true,
    provider: "twilio",
    providerMessageId: results[0]?.sid || null,
    raw: results,
  };
}

// Sends `message` to `recipients` using `tenant`'s own saved credentials, so the
// tenant's own provider wallet is debited (never a shared Managira account).
async function sendSms(tenant, message, recipients, { callbackUrl } = {}) {
  const normalizedMessage = safeString(message);
  if (!normalizedMessage) throw new Error("Message text is required.");
  if (!normalizeRecipients(recipients).length) throw new Error("At least one recipient is required.");
  if (!tenant || !isValidProvider(tenant.provider)) {
    throw new Error("This school has no active SMS provider configured.");
  }
  // Numbers saved the local way get the school's country code. Arkesel takes
  // the digits without "+"; the other providers want "+".
  const normalizedRecipients = normalizeRecipients(recipients).map((value) => {
    const international = toInternationalPhone(value, tenant.countryCode);
    if (!international) throw new Error(INVALID_PHONE_MESSAGE);
    return tenant.provider === "arkesel" ? international.slice(1) : international;
  });

  if (tenant.provider === "arkesel") {
    return sendViaArkesel(tenant, normalizedMessage, normalizedRecipients, callbackUrl);
  }
  if (tenant.provider === "africastalking") {
    return sendViaAfricasTalking(tenant, normalizedMessage, normalizedRecipients, callbackUrl);
  }
  return sendViaTwilio(tenant, normalizedMessage, normalizedRecipients);
}

async function recordDeliveryStatus(dbClient, { organizationId, provider, providerMessageId, recipient, status, rawPayload }) {
  await ensureSmsIntegrationSchema(dbClient);
  await dbClient.query(
    `INSERT INTO sms_delivery_logs (organization_id, provider, provider_message_id, recipient, status, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      organizationId || null,
      safeString(provider),
      safeString(providerMessageId) || null,
      safeString(recipient) || null,
      safeString(status) || null,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ]
  );
}

// Credentials for one provider (saved values, with any new ones typed in).
async function getProviderCredentials(dbClient, organizationId, provider, overrides = {}) {
  await ensureSmsIntegrationSchema(dbClient);
  const row = (await dbClient.query(
    `SELECT ${SMS_INTEGRATION_COLUMNS} FROM organizations WHERE organization_id = $1 LIMIT 1`,
    [organizationId]
  )).rows[0] || {};
  const pick = (typed, saved) => safeString(typed) || safeString(saved);
  if (provider === "twilio") {
    return {
      provider,
      accountSid: pick(overrides.accountSid, row.sms_twilio_account_sid),
      authToken: pick(overrides.authToken, decryptSecret(row.sms_twilio_auth_token_encrypted)),
      fromNumber: pick(overrides.fromNumber, row.sms_twilio_from_number),
    };
  }
  if (provider === "arkesel") {
    return { provider, apiKey: pick(overrides.apiKey, decryptSecret(row.sms_arkesel_api_key_encrypted)) };
  }
  if (provider === "africastalking") {
    return {
      provider,
      apiKey: pick(overrides.apiKey, decryptSecret(row.sms_africastalking_api_key_encrypted)),
      username: pick(overrides.username, row.sms_africastalking_username),
      sandbox: overrides.sandbox !== undefined ? !!overrides.sandbox : parseBoolean(row.sms_africastalking_sandbox, false),
    };
  }
  throw new Error("Unsupported SMS provider.");
}

// Checks the credentials with the provider without sending a message (no cost).
// Returns { ok, message }.
async function verifySmsConnection(creds) {
  const status = (err) => (err && err.response && err.response.status) || 0;
  const offline = (name) => ({ ok: false, message: `Couldn't reach ${name}. Check your internet connection and try again.` });
  if (creds.provider === "twilio") {
    if (!/^AC[0-9a-fA-F]{32}$/.test(creds.accountSid || "")) return { ok: false, message: "The Account SID should start with AC and be 34 characters long." };
    if (!creds.authToken) return { ok: false, message: "Add your Twilio Auth Token." };
    if (!/^\+[1-9]\d{6,14}$/.test(String(creds.fromNumber || "").replace(/[\s()-]/g, ""))) return { ok: false, message: "Enter the Twilio phone number with its country code, e.g. +15551234567." };
    const auth = { username: creds.accountSid, password: creds.authToken };
    const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}`;
    let account;
    try {
      account = (await axios.get(`${base}.json`, { auth, timeout: 12000 })).data;
    } catch (err) {
      if ([401, 403, 404].includes(status(err))) return { ok: false, message: "Twilio didn't accept this Account SID and Auth Token. Copy both again from your Twilio Console home page." };
      return offline("Twilio");
    }
    if (account && account.status && account.status !== "active") return { ok: false, message: `Your Twilio account is ${account.status}. Reactivate it in Twilio, then try again.` };
    const number = String(creds.fromNumber).replace(/[\s()-]/g, "");
    try {
      const owned = (await axios.get(`${base}/IncomingPhoneNumbers.json`, { auth, params: { PhoneNumber: number }, timeout: 12000 })).data;
      if (!owned || !Array.isArray(owned.incoming_phone_numbers) || !owned.incoming_phone_numbers.length) {
        return { ok: false, message: `${number} isn't a number in this Twilio account. Use one from Phone Numbers › Active numbers.` };
      }
    } catch (err) {
      return offline("Twilio");
    }
    return { ok: true, message: `Connected to Twilio${account && account.friendly_name ? ` (${account.friendly_name})` : ""}. Messages will come from ${number}.` };
  }
  if (creds.provider === "arkesel") {
    if (!creds.apiKey) return { ok: false, message: "Add your Arkesel API key." };
    try {
      const data = (await axios.get("https://sms.arkesel.com/api/v2/clients/balance-details", { headers: { "api-key": creds.apiKey }, timeout: 12000 })).data || {};
      if (String(data.status || "").toLowerCase() !== "success") return { ok: false, message: "Arkesel didn't accept this API key. Copy it again from your Arkesel dashboard." };
      const bal = data.data && (data.data.sms_balance ?? data.data.main_balance);
      return { ok: true, message: `Connected to Arkesel${bal !== undefined && bal !== null ? `. SMS balance: ${bal}` : ""}.` };
    } catch (err) {
      if ([401, 403].includes(status(err))) return { ok: false, message: "Arkesel didn't accept this API key. Copy it again from your Arkesel dashboard." };
      return offline("Arkesel");
    }
  }
  if (creds.provider === "africastalking") {
    if (!creds.username) return { ok: false, message: "Add your Africa's Talking username." };
    if (!creds.apiKey) return { ok: false, message: "Add your Africa's Talking API key." };
    const host = creds.sandbox ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
    try {
      const data = (await axios.get(`${host}/version1/user`, { params: { username: creds.username }, headers: { apiKey: creds.apiKey, Accept: "application/json" }, timeout: 12000 })).data || {};
      const bal = data.UserData && data.UserData.balance;
      return { ok: true, message: `Connected to Africa's Talking${bal ? `. Balance: ${bal}` : ""}.` };
    } catch (err) {
      if ([401, 403].includes(status(err))) return { ok: false, message: "Africa's Talking didn't accept this username and API key. Make sure both are from the same app (live, not sandbox)." };
      return offline("Africa's Talking");
    }
  }
  return { ok: false, message: "Unsupported SMS provider." };
}

module.exports = {
  AFRICAN_COUNTRY_CODES,
  PROVIDERS,
  isValidProvider,
  isTwilioAvailableForCountry,
  ensureSmsIntegrationSchema,
  getSmsIntegrationStatus,
  setSmsProviderActivation,
  saveArkeselSettings,
  saveAfricasTalkingSettings,
  saveTwilioSettings,
  markSmsProviderTestResult,
  getTenantSmsCredentials,
  getProviderCredentials,
  verifySmsConnection,
  sendSms,
  recordDeliveryStatus,
};
