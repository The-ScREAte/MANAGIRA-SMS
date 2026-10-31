let schemaReady;

async function ensureExternalSchoolWebsiteSchema(db) {
  if (!schemaReady) {
    schemaReady = db
      .query("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS external_website_url TEXT")
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }

  await schemaReady;
}

function normalizeExternalSchoolWebsiteUrl(value) {
  const input = String(value || "").trim();
  if (!input) return { url: null, error: null };
  if (input.length > 2048) {
    return { url: null, error: "The website address must be 2,048 characters or fewer." };
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;

  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return {
        url: null,
        error: "Enter a valid website address beginning with https:// or http://.",
      };
    }

    return { url: parsed.toString(), error: null };
  } catch (_error) {
    return {
      url: null,
      error: "Enter a valid website address beginning with https:// or http://.",
    };
  }
}

module.exports = {
  ensureExternalSchoolWebsiteSchema,
  normalizeExternalSchoolWebsiteUrl,
};
