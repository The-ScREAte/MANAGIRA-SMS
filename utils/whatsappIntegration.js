const axios = require("axios");

let whatsappSchemaReady = false;

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  }
  return fallback;
}

function safeString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizePhoneDigits(value) {
  return safeString(value).replace(/\D+/g, "");
}

function getMetaGraphApiVersion() {
  const fallback = "v21.0";
  const raw = safeString(process.env.META_GRAPH_API_VERSION);
  if (!raw) return fallback;
  return /^v\d+\.\d+$/.test(raw) ? raw : fallback;
}

function getMetaConfig() {
  return {
    appId: safeString(process.env.META_APP_ID),
    appSecret: safeString(process.env.META_APP_SECRET),
    embeddedSignupConfigId: safeString(process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID),
    graphApiVersion: getMetaGraphApiVersion(),
  };
}

function getMetaGraphBaseUrl() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

async function ensureWhatsappIntegrationSchema(dbClient) {
  if (whatsappSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS whatsapp_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS whatsapp_configured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS whatsapp_waba_id TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_business_name TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_display_phone_number TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_timezone TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_token_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS whatsapp_disconnected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS whatsapp_last_status TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_last_error TEXT
  `);

  whatsappSchemaReady = true;
}

function buildWhatsappIntegrationStatus(row = {}) {
  const activated = parseBoolean(row.whatsapp_activated, false);
  const configured = parseBoolean(row.whatsapp_configured, false);
  const wabaId = safeString(row.whatsapp_waba_id);
  const phoneNumberId = safeString(row.whatsapp_phone_number_id);
  const displayPhoneNumber = safeString(row.whatsapp_display_phone_number);
  const businessName = safeString(row.whatsapp_business_name);
  const timezone = safeString(row.whatsapp_timezone);
  const tokenExpiresAt = row.whatsapp_token_expires_at || null;
  const connectedAt = row.whatsapp_connected_at || null;
  const disconnectedAt = row.whatsapp_disconnected_at || null;
  const lastStatus = safeString(row.whatsapp_last_status) || "idle";
  const lastError = safeString(row.whatsapp_last_error);

  const connected = Boolean(configured && wabaId && phoneNumberId);

  return {
    activated,
    configured,
    connected,
    shouldShowFeatures: activated && connected,
    wabaId,
    phoneNumberId,
    displayPhoneNumber,
    businessName,
    timezone,
    tokenExpiresAt,
    connectedAt,
    disconnectedAt,
    lastStatus,
    lastError,
  };
}

function isTransientWhatsappErrorMessage(errorMessage) {
  const normalized = safeString(errorMessage).toLowerCase();
  if (!normalized) return false;

  return [
    "authentication error",
    "meta signup was cancelled or did not complete",
    "meta did not return an authorization code",
    "unable to load meta sdk script",
    "meta sdk failed to load",
  ].some((fragment) => normalized.includes(fragment));
}

async function getWhatsappIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildWhatsappIntegrationStatus({});
  await ensureWhatsappIntegrationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT
       whatsapp_activated,
       whatsapp_configured,
       whatsapp_waba_id,
       whatsapp_phone_number_id,
       whatsapp_business_name,
       whatsapp_display_phone_number,
       whatsapp_timezone,
       whatsapp_token_expires_at,
       whatsapp_connected_at,
       whatsapp_disconnected_at,
       whatsapp_last_status,
       whatsapp_last_error
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  return buildWhatsappIntegrationStatus(result.rows[0] || {});
}

async function setWhatsappIntegrationActivation(dbClient, organizationId, activated) {
  await ensureWhatsappIntegrationSchema(dbClient);

  await dbClient.query(
    `UPDATE organizations
     SET whatsapp_activated = $2,
         whatsapp_last_status = CASE WHEN $2 = FALSE THEN 'disabled' ELSE COALESCE(whatsapp_last_status, 'idle') END,
         whatsapp_last_error = CASE WHEN $2 = FALSE THEN NULL ELSE whatsapp_last_error END
     WHERE organization_id = $1`,
    [organizationId, Boolean(activated)]
  );
}

async function exchangeEmbeddedSignupCodeForToken(code) {
  const { appId, appSecret, graphApiVersion } = getMetaConfig();
  if (!appId || !appSecret) {
    throw new Error("Meta app credentials are not configured. Set META_APP_ID and META_APP_SECRET.");
  }

  const response = await axios.get(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      code,
    },
    timeout: 30000,
  });

  const accessToken = safeString(response.data?.access_token);
  if (!accessToken) {
    throw new Error("Meta did not return an access token.");
  }

  return {
    accessToken,
    expiresIn: Number(response.data?.expires_in || 0) || 0,
  };
}

async function subscribeAppToWaba(accessToken, wabaId) {
  const normalizedWabaId = safeString(wabaId);
  if (!normalizedWabaId) return;

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedWabaId)}/subscribed_apps`;
  await axios.post(
    url,
    null,
    {
      params: {
        access_token: accessToken,
      },
      timeout: 30000,
    }
  );
}

async function registerPhoneNumberForCloudApi(accessToken, phoneNumberId, pin) {
  const normalizedPhoneNumberId = safeString(phoneNumberId);
  if (!normalizedPhoneNumberId) return;

  const payload = {
    messaging_product: "whatsapp",
  };

  const normalizedPin = safeString(pin);
  if (normalizedPin) {
    payload.pin = normalizedPin;
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedPhoneNumberId)}/register`;

  try {
    await axios.post(url, payload, {
      params: { access_token: accessToken },
      timeout: 30000,
    });
  } catch (error) {
    const code = Number(error?.response?.status || 0);
    if (code === 400 || code === 409) {
      return;
    }
    throw error;
  }
}

async function saveWhatsappConnection(dbClient, organizationId, payload = {}) {
  await ensureWhatsappIntegrationSchema(dbClient);

  const expiresInSeconds = Number(payload.expiresIn || 0);
  const tokenExpiresAt = expiresInSeconds > 0
    ? new Date(Date.now() + expiresInSeconds * 1000)
    : null;

  await dbClient.query(
    `UPDATE organizations
     SET whatsapp_configured = TRUE,
         whatsapp_waba_id = $2,
         whatsapp_phone_number_id = $3,
         whatsapp_business_name = NULLIF($4, ''),
         whatsapp_display_phone_number = NULLIF($5, ''),
         whatsapp_timezone = NULLIF($6, ''),
         whatsapp_access_token = NULLIF($7, ''),
         whatsapp_token_expires_at = $8,
         whatsapp_connected_at = NOW(),
         whatsapp_disconnected_at = NULL,
         whatsapp_last_status = 'connected',
         whatsapp_last_error = NULL
     WHERE organization_id = $1`,
    [
      organizationId,
      safeString(payload.wabaId),
      safeString(payload.phoneNumberId),
      safeString(payload.businessName),
      safeString(payload.displayPhoneNumber),
      safeString(payload.timezone),
      safeString(payload.accessToken),
      tokenExpiresAt,
    ]
  );
}

async function markWhatsappConnectionError(dbClient, organizationId, errorMessage) {
  await ensureWhatsappIntegrationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET whatsapp_last_status = 'error',
         whatsapp_last_error = $2
     WHERE organization_id = $1`,
    [organizationId, safeString(errorMessage).slice(0, 800) || "Unknown WhatsApp setup error"]
  );
}

async function clearWhatsappConnectionError(dbClient, organizationId) {
  await ensureWhatsappIntegrationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET whatsapp_last_status = CASE
           WHEN whatsapp_configured = TRUE THEN 'connected'
           WHEN whatsapp_activated = TRUE THEN 'idle'
           ELSE COALESCE(whatsapp_last_status, 'idle')
         END,
         whatsapp_last_error = NULL
     WHERE organization_id = $1`,
    [organizationId]
  );
}

async function disconnectWhatsappIntegration(dbClient, organizationId) {
  await ensureWhatsappIntegrationSchema(dbClient);

  await dbClient.query(
    `UPDATE organizations
     SET whatsapp_configured = FALSE,
         whatsapp_waba_id = NULL,
         whatsapp_phone_number_id = NULL,
         whatsapp_business_name = NULL,
         whatsapp_display_phone_number = NULL,
         whatsapp_timezone = NULL,
         whatsapp_access_token = NULL,
         whatsapp_token_expires_at = NULL,
         whatsapp_disconnected_at = NOW(),
         whatsapp_last_status = 'disconnected',
         whatsapp_last_error = NULL
     WHERE organization_id = $1`,
    [organizationId]
  );
}

async function getWhatsappMessagingCredentials(dbClient, organizationId) {
  if (!organizationId) {
    return {
      configured: false,
      phoneNumberId: "",
      accessToken: "",
      tokenExpiresAt: null,
    };
  }

  await ensureWhatsappIntegrationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT
       whatsapp_configured,
       whatsapp_phone_number_id,
       whatsapp_access_token,
       whatsapp_token_expires_at
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  const row = result.rows[0] || {};
  return {
    configured: parseBoolean(row.whatsapp_configured, false),
    phoneNumberId: safeString(row.whatsapp_phone_number_id),
    accessToken: safeString(row.whatsapp_access_token),
    tokenExpiresAt: row.whatsapp_token_expires_at || null,
  };
}

async function sendWhatsappTemplateMessage(accessToken, phoneNumberId, payload = {}) {
  const normalizedPhoneNumberId = safeString(phoneNumberId);
  const normalizedAccessToken = safeString(accessToken);
  const recipient = normalizePhoneDigits(payload.to);
  const templateName = safeString(payload.templateName);
  const languageCode = safeString(payload.languageCode) || "en_US";
  const bodyParameters = Array.isArray(payload.bodyParameters)
    ? payload.bodyParameters
        .map((value) => safeString(value))
        .filter(Boolean)
        .map((text) => ({ type: "text", text }))
    : [];

  if (!normalizedAccessToken) {
    throw new Error("WhatsApp access token is missing. Reconnect WhatsApp and try again.");
  }

  if (!normalizedPhoneNumberId) {
    throw new Error("WhatsApp phone number ID is missing. Reconnect WhatsApp and try again.");
  }

  if (!recipient) {
    throw new Error("Recipient phone number is required.");
  }

  if (!templateName) {
    throw new Error("Template name is required.");
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedPhoneNumberId)}/messages`;
  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(bodyParameters.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: bodyParameters,
                },
              ],
            }
          : {}),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${normalizedAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  return response.data || {};
}

module.exports = {
  getMetaConfig,
  ensureWhatsappIntegrationSchema,
  buildWhatsappIntegrationStatus,
  getWhatsappIntegrationStatus,
  setWhatsappIntegrationActivation,
  exchangeEmbeddedSignupCodeForToken,
  registerPhoneNumberForCloudApi,
  subscribeAppToWaba,
  saveWhatsappConnection,
  markWhatsappConnectionError,
  clearWhatsappConnectionError,
  isTransientWhatsappErrorMessage,
  disconnectWhatsappIntegration,
  getWhatsappMessagingCredentials,
  normalizePhoneDigits,
  sendWhatsappTemplateMessage,
};
