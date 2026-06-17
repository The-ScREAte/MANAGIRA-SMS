const axios = require("axios");
const db = require("../config/db");

const FX_TTL_MS = 30 * 60 * 1000;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const ORG_GEO_TTL_MS = 6 * 60 * 60 * 1000;

const fxCache = {
  rates: null,
  expiresAt: 0,
  source: null,
};

const geoCache = new Map();
const orgGeoCache = new Map();

const FALLBACK_CURRENCY = "USD";

const CURRENCY_LOCALE_MAP = {
  USD: "en-US",
  GHS: "en-GH",
  EUR: "en-IE",
  GBP: "en-GB",
  NGN: "en-NG",
  KES: "en-KE",
  ZAR: "en-ZA",
  CAD: "en-CA",
  AUD: "en-AU",
  INR: "en-IN",
};

const COUNTRY_CURRENCY_MAP = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  ES: "EUR",
  IT: "EUR",
  PT: "EUR",
  NL: "EUR",
  BE: "EUR",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  FI: "EUR",
  PL: "PLN",
  AT: "EUR",
  GR: "EUR",
  CZ: "CZK",
  RO: "RON",
  HU: "HUF",
  UA: "UAH",
  TR: "TRY",
  RU: "RUB",
  GH: "GHS",
  NG: "NGN",
  KE: "KES",
  ZA: "ZAR",
  IN: "INR",
  AU: "AUD",
  NZ: "NZD",
  SG: "SGD",
  AE: "AED",
  SA: "SAR",
  QA: "QAR",
  PK: "PKR",
  BD: "BDT",
  ID: "IDR",
  PH: "PHP",
  MY: "MYR",
  TH: "THB",
  VN: "VND",
  IL: "ILS",
  HK: "HKD",
  JP: "JPY",
  KR: "KRW",
  CN: "CNY",
  BR: "BRL",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  PE: "PEN",
  MX: "MXN",
};

function roundTo2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const directIp = req.ip || req.connection?.remoteAddress || "";

  const rawIp = String(forwardedFor || directIp)
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "");

  if (!rawIp || rawIp === "::1" || rawIp === "127.0.0.1") return null;
  return rawIp;
}

function normalizeCurrencyCode(raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return code;
}

function getLocaleForCurrency(currencyCode) {
  const normalized = normalizeCurrencyCode(currencyCode) || FALLBACK_CURRENCY;
  return CURRENCY_LOCALE_MAP[normalized] || "en-US";
}

function getCurrencyForCountry(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return COUNTRY_CURRENCY_MAP[code] || null;
}

async function fetchGeoFromIp(ip) {
  const now = Date.now();
  if (geoCache.has(ip)) {
    const cached = geoCache.get(ip);
    if (cached.expiresAt > now) {
      return cached.value;
    }
    geoCache.delete(ip);
  }

  const response = await axios.get(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
    timeout: 5000,
    validateStatus: () => true,
  });

  const payload = response?.data || {};
  const detectedCountry = String(payload.country_code || "").toUpperCase() || null;
  const detectedCurrency =
    normalizeCurrencyCode(payload.currency) ||
    normalizeCurrencyCode(getCurrencyForCountry(detectedCountry));

  const value = {
    countryCode: detectedCountry,
    currencyCode: detectedCurrency,
    source: "ipapi.co",
  };

  geoCache.set(ip, {
    value,
    expiresAt: now + GEO_TTL_MS,
  });

  return value;
}

async function getOrganizationCountryFallback(organizationId) {
  const normalizedOrgId = Number(organizationId || 0);
  if (!normalizedOrgId) return null;

  try {
    const result = await db.query(
      `SELECT organization_country FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [normalizedOrgId]
    );
    const orgCountry = String(result.rows?.[0]?.organization_country || "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(orgCountry) ? orgCountry : null;
  } catch (_) {
    return null;
  }
}

async function getDominantOrganizationGeo(organizationId) {
  const normalizedOrgId = Number(organizationId || 0);
  if (!normalizedOrgId) return null;

  const now = Date.now();
  const cached = orgGeoCache.get(normalizedOrgId);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const ipRows = await db.query(
      `SELECT ip_address, COUNT(*)::int AS hit_count
         FROM organization_activity_logs
        WHERE organization_id = $1
          AND ip_address IS NOT NULL
          AND ip_address <> ''
          AND ip_address <> '127.0.0.1'
          AND ip_address <> '::1'
          AND created_at >= NOW() - INTERVAL '120 days'
        GROUP BY ip_address
        ORDER BY hit_count DESC
        LIMIT 25`,
      [normalizedOrgId]
    );

    const countryWeights = new Map();
    const currencyByCountry = new Map();

    for (const row of ipRows.rows || []) {
      const ip = String(row.ip_address || "").trim().replace(/^::ffff:/, "");
      if (!ip) continue;

      try {
        const geo = await fetchGeoFromIp(ip);
        const countryCode = String(geo?.countryCode || "").toUpperCase();
        if (!/^[A-Z]{2}$/.test(countryCode)) continue;

        const hits = Number(row.hit_count || 0) || 0;
        countryWeights.set(countryCode, (countryWeights.get(countryCode) || 0) + Math.max(1, hits));
        if (geo?.currencyCode) {
          currencyByCountry.set(countryCode, normalizeCurrencyCode(geo.currencyCode));
        }
      } catch (_) {
      }
    }

    let topCountry = null;
    let topWeight = -1;
    countryWeights.forEach((weight, countryCode) => {
      if (weight > topWeight) {
        topWeight = weight;
        topCountry = countryCode;
      }
    });

    if (topCountry) {
      const currencyCode =
        normalizeCurrencyCode(currencyByCountry.get(topCountry)) ||
        normalizeCurrencyCode(getCurrencyForCountry(topCountry));

      const value = {
        countryCode: topCountry,
        currencyCode,
        source: "org-dominant-activity-geo",
      };

      orgGeoCache.set(normalizedOrgId, {
        value,
        expiresAt: now + ORG_GEO_TTL_MS,
      });

      return value;
    }
  } catch (_) {
  }

  return null;
}

function getHeaderCountry(req) {
  const candidate =
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"];

  const code = String(candidate || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

async function detectCurrencyForRequest(req, options = {}) {
  const organizationId =
    Number(options.organizationId || 0) ||
    Number(req?.session?.organizationId || 0) ||
    null;

  const ip = getClientIp(req);

  if (ip) {
    try {
      const geo = await fetchGeoFromIp(ip);
      if (geo.currencyCode) {
        return {
          ...geo,
          source: "request-ip-geo",
        };
      }
    } catch (_) {
    }
  }

  if (organizationId) {
    const orgGeo = await getDominantOrganizationGeo(organizationId);
    if (orgGeo?.currencyCode) {
      return orgGeo;
    }
  }

  const countryCode = getHeaderCountry(req);
  const currencyFromCountry = normalizeCurrencyCode(getCurrencyForCountry(countryCode));
  if (currencyFromCountry) {
    return {
      countryCode,
      currencyCode: currencyFromCountry,
      source: "request-header",
    };
  }

  if (organizationId) {
    const orgCountryCode = await getOrganizationCountryFallback(organizationId);
    const orgCurrency = normalizeCurrencyCode(getCurrencyForCountry(orgCountryCode));
    if (orgCurrency) {
      return {
        countryCode: orgCountryCode,
        currencyCode: orgCurrency,
        source: "organization-country-fallback",
      };
    }
  }

  return {
    countryCode,
    currencyCode: FALLBACK_CURRENCY,
    source: "fallback",
  };
}

async function fetchUsdRates() {
  const now = Date.now();
  if (fxCache.rates && fxCache.expiresAt > now) {
    return fxCache;
  }

  let rates = null;
  let source = null;

  try {
    const primary = await axios.get("https://open.er-api.com/v6/latest/USD", {
      timeout: 6000,
      validateStatus: () => true,
    });

    if (primary?.data?.result === "success" && primary?.data?.rates) {
      rates = primary.data.rates;
      source = "open.er-api.com";
    }
  } catch (_) {
  }

  if (!rates) {
    try {
      const fallback = await axios.get("https://api.exchangerate.host/latest?base=USD", {
        timeout: 6000,
        validateStatus: () => true,
      });

      if (fallback?.data?.rates) {
        rates = fallback.data.rates;
        source = "exchangerate.host";
      }
    } catch (_) {
    }
  }

  if (!rates) {
    if (fxCache.rates) return fxCache;
    rates = { USD: 1 };
    source = "fallback";
  }

  fxCache.rates = rates;
  fxCache.source = source;
  fxCache.expiresAt = now + FX_TTL_MS;
  return fxCache;
}

async function getUsdRate(targetCurrency) {
  const normalizedTarget = normalizeCurrencyCode(targetCurrency) || FALLBACK_CURRENCY;
  if (normalizedTarget === "USD") return 1;

  const { rates } = await fetchUsdRates();
  const rate = Number(rates?.[normalizedTarget]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

async function getCurrencyProfileForRequest(req, options = {}) {
  const geo = await detectCurrencyForRequest(req, options);
  const userCurrency = normalizeCurrencyCode(geo.currencyCode) || FALLBACK_CURRENCY;
  const usdToUserRate = (await getUsdRate(userCurrency)) || 1;
  const usdToGhsRate = (await getUsdRate("GHS")) || null;

  return {
    userCurrency,
    countryCode: geo.countryCode,
    detectionSource: geo.source,
    usdToUserRate,
    usdToGhsRate,
    locale: getLocaleForCurrency(userCurrency),
    updatedAt: new Date(),
  };
}

function localizeUsdAmount(usdAmount, currencyProfile) {
  const amountUsd = roundTo2(usdAmount);
  const usdToUserRate = Number(currencyProfile?.usdToUserRate || 1);
  const usdToGhsRate = Number(currencyProfile?.usdToGhsRate || 0);
  const userCurrency = currencyProfile?.userCurrency || FALLBACK_CURRENCY;

  return {
    amountUsd,
    userCurrency,
    localizedAmount: roundTo2(amountUsd * usdToUserRate),
    ghsAmount: usdToGhsRate > 0 ? roundTo2(amountUsd * usdToGhsRate) : null,
    usdToUserRate,
    usdToGhsRate: usdToGhsRate > 0 ? usdToGhsRate : null,
  };
}

function formatCurrencyAmount(value, currencyCode, localeOverride) {
  const amount = Number(value || 0);
  const currency = normalizeCurrencyCode(currencyCode) || FALLBACK_CURRENCY;
  const locale = localeOverride || getLocaleForCurrency(currency);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (_) {
    return `${currency} ${roundTo2(amount).toFixed(2)}`;
  }
}

module.exports = {
  getCurrencyProfileForRequest,
  getLocaleForCurrency,
  getUsdRate,
  normalizeCurrencyCode,
  localizeUsdAmount,
  formatCurrencyAmount,
};
