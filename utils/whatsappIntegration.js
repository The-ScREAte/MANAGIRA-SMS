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

function getWhatsappRegistrationPinFromEnv() {
  const candidates = [
    process.env.WHATSAPP_CLOUD_API_REGISTRATION_PIN,
    process.env.WHATSAPP_REGISTRATION_PIN,
    process.env.WHATSAPP_PIN,
  ];

  for (const rawValue of candidates) {
    const normalized = safeString(rawValue);
    if (normalized) return normalized;
  }

  return "";
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
  if (normalizedPin && !/^\d{6}$/.test(normalizedPin)) {
    throw new Error("WHATSAPP_CLOUD_API_REGISTRATION_PIN must be exactly 6 digits.");
  }
  if (normalizedPin) {
    payload.pin = normalizedPin;
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedPhoneNumberId)}/register`;

  const isAlreadyRegisteredResponse = (message) => {
    const normalizedMessage = safeString(message).toLowerCase();
    if (!normalizedMessage) return false;
    return normalizedMessage.includes("already registered")
      || normalizedMessage.includes("is registered")
      || normalizedMessage.includes("duplicate registration");
  };

  try {
    const response = await axios.post(url, payload, {
      params: { access_token: accessToken },
      timeout: 30000,
    });

    const successValue = response?.data?.success;
    const responseErrorMessage = safeString(response?.data?.error?.message);

    // Meta usually returns { success: true } when registration is complete.
    // If success is explicitly false, treat as a real onboarding failure.
    if (successValue === false) {
      if (isAlreadyRegisteredResponse(responseErrorMessage)) return;
      throw new Error(responseErrorMessage || "Meta registration did not complete successfully.");
    }
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);
    const apiMessage = safeString(error?.response?.data?.error?.message || error?.message);

    if (
      statusCode === 400 &&
      (apiMessage.includes("parameter pin is required") || apiMessage.includes("The parameter pin is required"))
    ) {
      throw new Error(
        "Meta requires a 6-digit WhatsApp registration PIN for this sender line. " +
          "Set WHATSAPP_CLOUD_API_REGISTRATION_PIN in server environment and reconnect WhatsApp."
      );
    }

    // 409 and specific 400 responses may indicate a number that is already registered.
    if (statusCode === 409 || (statusCode === 400 && isAlreadyRegisteredResponse(apiMessage))) {
      return;
    }

    const registrationError = new Error(
      apiMessage || "Failed to register WhatsApp phone number for Cloud API."
    );
    registrationError.cause = error;
    throw registrationError;
  }
}

async function ensureWhatsappCloudReady(accessToken, wabaId, phoneNumberId, pin) {
  await registerPhoneNumberForCloudApi(accessToken, phoneNumberId, pin);
  await subscribeAppToWaba(accessToken, wabaId);
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

function pickFirstWhatsappAccountPayload(data) {
  const directAccounts = Array.isArray(data?.data) ? data.data : [];
  if (directAccounts.length) return directAccounts;

  const inlineAccounts = Array.isArray(data?.whatsapp_business_accounts?.data)
    ? data.whatsapp_business_accounts.data
    : [];
  if (inlineAccounts.length) return inlineAccounts;

  const businesses = Array.isArray(data?.businesses?.data) ? data.businesses.data : [];
  const nested = [];
  businesses.forEach((business) => {
    const owned = Array.isArray(business?.owned_whatsapp_business_accounts?.data)
      ? business.owned_whatsapp_business_accounts.data
      : [];
    owned.forEach((entry) => nested.push(entry));
  });
  return nested;
}

function pickPhoneRecord(phoneContainer) {
  const rows = Array.isArray(phoneContainer?.data)
    ? phoneContainer.data
    : (Array.isArray(phoneContainer) ? phoneContainer : []);
  return rows.find((row) => safeString(row?.id)) || null;
}

function extractSignupSeedFromPayload(payload, depth = 0) {
  if (!payload || depth > 8) {
    return {
      wabaId: "",
      phoneNumberId: "",
      displayPhoneNumber: "",
      businessName: "",
    };
  }

  const state = {
    wabaId: "",
    phoneNumberId: "",
    displayPhoneNumber: "",
    businessName: "",
  };

  const merge = (candidate = {}) => {
    if (!state.wabaId && safeString(candidate.wabaId)) state.wabaId = safeString(candidate.wabaId);
    if (!state.phoneNumberId && safeString(candidate.phoneNumberId)) state.phoneNumberId = safeString(candidate.phoneNumberId);
    if (!state.displayPhoneNumber && safeString(candidate.displayPhoneNumber)) state.displayPhoneNumber = safeString(candidate.displayPhoneNumber);
    if (!state.businessName && safeString(candidate.businessName)) state.businessName = safeString(candidate.businessName);
  };

  const parseJsonString = (raw) => {
    const text = safeString(raw);
    if (!text) return null;
    if (!text.startsWith("{") && !text.startsWith("[")) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  };

  const walk = (node, path = "", level = 0) => {
    if (!node || level > 8) return;

    if (typeof node === "string") {
      const parsed = parseJsonString(node);
      if (parsed) walk(parsed, `${path}.json`, level + 1);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`, level + 1));
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const directWabaId = safeString(node.waba_id || node.wabaId || node.whatsapp_business_account_id);
    const directPhoneId = safeString(node.phone_number_id || node.phoneNumberId || node.whatsapp_phone_number_id);
    const directDisplayPhone = safeString(node.display_phone_number || node.displayPhoneNumber);
    const directBusinessName = safeString(node.business_name || node.businessName || node.business_display_name || node.verified_name);

    merge({
      wabaId: directWabaId,
      phoneNumberId: directPhoneId,
      displayPhoneNumber: directDisplayPhone,
      businessName: directBusinessName,
    });

    const nodeId = safeString(node.id);
    if (nodeId && !state.wabaId && (node.phone_numbers || path.toLowerCase().includes("whatsapp_business_account"))) {
      state.wabaId = nodeId;
    }

    const phoneRecord = pickPhoneRecord(node.phone_numbers);
    if (phoneRecord) {
      merge({
        phoneNumberId: safeString(phoneRecord.id),
        displayPhoneNumber: safeString(phoneRecord.display_phone_number),
        businessName: safeString(phoneRecord.verified_name),
      });
    }

    Object.entries(node).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      const valueAsString = safeString(value);

      if (!state.wabaId && /(waba|whatsapp_business_account)/i.test(lowerKey) && valueAsString && /^\d+$/.test(valueAsString)) {
        state.wabaId = valueAsString;
      }

      if (!state.phoneNumberId && /(phone_number_id|phoneid|whatsapp_phone)/i.test(lowerKey) && valueAsString && /^\d+$/.test(valueAsString)) {
        state.phoneNumberId = valueAsString;
      }

      if (!state.displayPhoneNumber && /(display_phone_number|displayphonenumber)/i.test(lowerKey) && valueAsString) {
        state.displayPhoneNumber = valueAsString;
      }

      if (!state.businessName && /(business_name|businessname|verified_name)/i.test(lowerKey) && valueAsString) {
        state.businessName = valueAsString;
      }

      walk(value, `${path}.${key}`, level + 1);
    });
  };

  walk(payload, "payload", depth);
  return state;
}

async function resolveWhatsappSignupIdentifiers(accessToken, seed = {}) {
  const normalizedAccessToken = safeString(accessToken);
  const seededWabaId = safeString(seed.wabaId);
  const seededPhoneNumberId = safeString(seed.phoneNumberId);
  const seededBusinessName = safeString(seed.businessName);
  const seededDisplayPhoneNumber = safeString(seed.displayPhoneNumber);

  if (!normalizedAccessToken) {
    throw new Error("Meta access token is missing while resolving WhatsApp identifiers.");
  }

  if (seededWabaId && seededPhoneNumberId) {
    return {
      wabaId: seededWabaId,
      phoneNumberId: seededPhoneNumberId,
      businessName: seededBusinessName,
      displayPhoneNumber: seededDisplayPhoneNumber,
    };
  }

  const headers = {
    Authorization: `Bearer ${normalizedAccessToken}`,
  };
  const baseUrl = getMetaGraphBaseUrl();
  const discoveryErrors = [];
  const discoveryUrls = [
    `${baseUrl}/me/whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}`,
    `${baseUrl}/me?fields=whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}`,
    `${baseUrl}/me?fields=businesses{owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}}`,
  ];

  let discoveredAccounts = [];
  for (const url of discoveryUrls) {
    try {
      const response = await axios.get(url, {
        headers,
        timeout: 30000,
      });
      discoveredAccounts = pickFirstWhatsappAccountPayload(response?.data || {});
      if (discoveredAccounts.length) break;
    } catch (error) {
      const reason = safeString(error?.response?.data?.error?.message || error?.message);
      if (reason) discoveryErrors.push(reason);
      // Try the next discovery shape.
    }
  }

  if (!discoveredAccounts.length) {
    try {
      const businessesResponse = await axios.get(
        `${baseUrl}/me/businesses?fields=id,name`,
        {
          headers,
          timeout: 30000,
        }
      );

      const businessRows = Array.isArray(businessesResponse?.data?.data)
        ? businessesResponse.data.data
        : [];

      for (const business of businessRows) {
        const businessId = safeString(business?.id);
        if (!businessId) continue;

        try {
          const ownedWabaResponse = await axios.get(
            `${baseUrl}/${encodeURIComponent(businessId)}/owned_whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}`,
            {
              headers,
              timeout: 30000,
            }
          );

          const rows = Array.isArray(ownedWabaResponse?.data?.data)
            ? ownedWabaResponse.data.data
            : [];

          if (rows.length) {
            discoveredAccounts = rows;
            break;
          }
        } catch (error) {
          const reason = safeString(error?.response?.data?.error?.message || error?.message);
          if (reason) discoveryErrors.push(reason);
        }
      }
    } catch (error) {
      const reason = safeString(error?.response?.data?.error?.message || error?.message);
      if (reason) discoveryErrors.push(reason);
    }
  }

  const selectedAccount = discoveredAccounts.find((entry) => {
    const accountId = safeString(entry?.id);
    if (seededWabaId) return accountId === seededWabaId;
    return Boolean(accountId);
  }) || null;

  let resolvedWabaId = seededWabaId || safeString(selectedAccount?.id);
  let resolvedBusinessName = seededBusinessName || safeString(selectedAccount?.name);
  let selectedPhone = pickPhoneRecord(selectedAccount?.phone_numbers);

  if (!selectedPhone && resolvedWabaId) {
    try {
      const phoneResponse = await axios.get(
        `${baseUrl}/${encodeURIComponent(resolvedWabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
        {
          headers,
          timeout: 30000,
        }
      );
      selectedPhone = pickPhoneRecord(phoneResponse?.data?.data || phoneResponse?.data);
    } catch (_) {
      // Keep going; we may still have seeded identifiers.
    }
  }

  const resolvedPhoneNumberId = seededPhoneNumberId || safeString(selectedPhone?.id);
  const resolvedDisplayPhoneNumber = seededDisplayPhoneNumber || safeString(selectedPhone?.display_phone_number);

  if (!resolvedWabaId || !resolvedPhoneNumberId) {
    const firstDiscoveryError = safeString(discoveryErrors[0]);
    if (firstDiscoveryError) {
      throw new Error(`Meta signup completed but WhatsApp IDs were not returned (${firstDiscoveryError}). Please reconnect and ensure account selection is completed in Meta.`);
    }
    throw new Error("Meta signup completed but WhatsApp IDs were not returned. Please reconnect and ensure account selection is completed in Meta.");
  }

  return {
    wabaId: resolvedWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    businessName: resolvedBusinessName,
    displayPhoneNumber: resolvedDisplayPhoneNumber,
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

async function sendWhatsappTextMessage(accessToken, phoneNumberId, payload = {}) {
  const normalizedPhoneNumberId = safeString(phoneNumberId);
  const normalizedAccessToken = safeString(accessToken);
  const recipient = normalizePhoneDigits(payload.to);
  const text = safeString(payload.text);

  if (!normalizedAccessToken) {
    throw new Error("WhatsApp access token is missing. Reconnect WhatsApp and try again.");
  }

  if (!normalizedPhoneNumberId) {
    throw new Error("WhatsApp phone number ID is missing. Reconnect WhatsApp and try again.");
  }

  if (!recipient) {
    throw new Error("Recipient phone number is required.");
  }

  if (!text) {
    throw new Error("Text message body is required.");
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedPhoneNumberId)}/messages`;
  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body: text,
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

async function sendWhatsappDocumentMessage(accessToken, phoneNumberId, payload = {}) {
  const normalizedPhoneNumberId = safeString(phoneNumberId);
  const normalizedAccessToken = safeString(accessToken);
  const recipient = normalizePhoneDigits(payload.to);
  const documentLink = safeString(payload.documentLink);
  const caption = safeString(payload.caption);
  const filename = safeString(payload.filename);

  if (!normalizedAccessToken) {
    throw new Error("WhatsApp access token is missing. Reconnect WhatsApp and try again.");
  }

  if (!normalizedPhoneNumberId) {
    throw new Error("WhatsApp phone number ID is missing. Reconnect WhatsApp and try again.");
  }

  if (!recipient) {
    throw new Error("Recipient phone number is required.");
  }

  if (!documentLink) {
    throw new Error("Document link is required.");
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(normalizedPhoneNumberId)}/messages`;
  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: recipient,
      type: "document",
      document: {
        link: documentLink,
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
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

async function getWhatsappSetupChecklist(dbClient, organizationId) {
  const integrationStatus = await getWhatsappIntegrationStatus(dbClient, organizationId);

  if (!integrationStatus.connected) {
    return {
      checkedAt: new Date().toISOString(),
      metaReachable: false,
      items: [
        {
          key: "connected",
          label: "Connect your WhatsApp Business number",
          done: false,
          instructions: "Open the ⋮ menu and click Connect WhatsApp before this checklist can check anything else.",
          required: true,
          linkType: "internal",
          linkTarget: "whatsapp-connect-link",
          linkLabel: "Go to Connect",
        },
      ],
      overallReady: false,
    };
  }

  const items = [];

  const credentials = await getWhatsappMessagingCredentials(dbClient, organizationId);
  let metaReachable = false;
  let phoneInfo = null;
  let wabaInfo = null;
  let approvedTemplateCount = 0;
  let metaError = "";

  try {
    const base = getMetaGraphBaseUrl();
    const headers = { Authorization: `Bearer ${credentials.accessToken}` };

    const [phoneResp, wabaResp, templatesResp] = await Promise.all([
      axios.get(`${base}/${encodeURIComponent(credentials.phoneNumberId)}`, {
        headers,
        params: { fields: "name_status,code_verification_status,quality_rating,status" },
        timeout: 15000,
      }),
      axios.get(`${base}/${encodeURIComponent(integrationStatus.wabaId)}`, {
        headers,
        params: { fields: "business_verification_status,account_review_status,owner_business_info" },
        timeout: 15000,
      }),
      axios.get(`${base}/${encodeURIComponent(integrationStatus.wabaId)}/message_templates`, {
        headers,
        params: { limit: 50 },
        timeout: 15000,
      }),
    ]);

    phoneInfo = phoneResp.data || {};
    wabaInfo = wabaResp.data || {};
    approvedTemplateCount = (templatesResp.data?.data || []).filter(
      (t) => safeString(t?.status).toUpperCase() === "APPROVED"
    ).length;
    metaReachable = true;
  } catch (error) {
    metaError = error?.response?.data?.error?.message || error?.message || "Unable to reach Meta.";
  }

  const wabaId = safeString(integrationStatus.wabaId);
  const phoneNumbersUrl = wabaId
    ? `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`
    : "https://business.facebook.com/wa/manage/phone-numbers/";
  const templatesUrl = wabaId
    ? `https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`
    : "https://business.facebook.com/wa/manage/message-templates/";

  items.push({
    key: "phone_verified",
    label: "Verify phone number",
    done: metaReachable ? phoneInfo?.code_verification_status === "VERIFIED" : null,
    instructions: "Verify by OTP in WhatsApp Manager.",
    required: true,
    linkType: "external",
    linkTarget: phoneNumbersUrl,
    linkLabel: "Open WhatsApp Manager",
  });

  items.push({
    key: "display_name_approved",
    label: "Get display name approved",
    done: metaReachable ? phoneInfo?.name_status === "APPROVED" : null,
    instructions: "Blocks sending until approved. Do this first.",
    required: true,
    linkType: "external",
    linkTarget: phoneNumbersUrl,
    linkLabel: "Open WhatsApp Manager",
  });

  items.push({
    key: "template_approved",
    label: "Get a message template approved",
    done: metaReachable ? approvedTemplateCount > 0 : null,
    instructions: "Needed to message guardians who haven't texted first.",
    required: true,
    linkType: "external",
    linkTarget: templatesUrl,
    linkLabel: "Open Message Templates",
  });

  const lastDeliveredResult = await dbClient.query(
    `SELECT status, created_at FROM delivery_audit_history
     WHERE organization_id = $1 AND event_domain = 'whatsapp'
       AND event_name = 'whatsapp_delivery_status'
       AND status IN ('delivered', 'read')
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId]
  ).catch(() => ({ rows: [] }));
  const lastDelivered = lastDeliveredResult.rows[0];

  const priorStepsDone = items.every((item) => item.done === true);

  items.push({
    key: "live_send_confirmed",
    label: "Confirm a real message was delivered",
    done: Boolean(lastDelivered),
    instructions: priorStepsDone
      ? "A send being accepted isn't proof of delivery."
      : "Locked until the steps above are approved.",
    required: true,
    linkType: "internal",
    linkTarget: "whatsapp-default-test-button",
    linkLabel: "Go to Send Test Message",
    linkDisabled: !priorStepsDone,
  });

  const overallReady = items.filter((item) => item.required).every((item) => item.done === true);

  return {
    checkedAt: new Date().toISOString(),
    metaReachable,
    metaError: metaReachable ? "" : metaError,
    items,
    overallReady,
  };
}

module.exports = {
  getMetaConfig,
  getWhatsappRegistrationPinFromEnv,
  ensureWhatsappIntegrationSchema,
  buildWhatsappIntegrationStatus,
  getWhatsappIntegrationStatus,
  setWhatsappIntegrationActivation,
  exchangeEmbeddedSignupCodeForToken,
  registerPhoneNumberForCloudApi,
  ensureWhatsappCloudReady,
  subscribeAppToWaba,
  saveWhatsappConnection,
  markWhatsappConnectionError,
  clearWhatsappConnectionError,
  isTransientWhatsappErrorMessage,
  disconnectWhatsappIntegration,
  getWhatsappMessagingCredentials,
  extractSignupSeedFromPayload,
  resolveWhatsappSignupIdentifiers,
  normalizePhoneDigits,
  sendWhatsappTemplateMessage,
  sendWhatsappTextMessage,
  sendWhatsappDocumentMessage,
  getWhatsappSetupChecklist,
};
