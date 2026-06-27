const axios = require("axios");
const https = require("https");
const db = require("../config/db");
const { COUNTRY_NAME_LOOKUP } = require("./countries");

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
let orgCurrencyColumnReady = false;

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

const CURRENCY_NAME_MAP = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  NGN: "Nigerian Naira",
  GHS: "Ghana Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  XOF: "West African CFA Franc",
  EGP: "Egyptian Pound",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  INR: "Indian Rupee",
  NPR: "Nepalese Rupee",
  SLE: "Sierra Leonean Leone",
};

const COUNTRY_CURRENCY_MAP = {
  AF: "AFN",
  AL: "ALL",
  AD: "EUR",
  AG: "XCD",
  AM: "AMD",
  AO: "AOA",
  AZ: "AZN",
  BB: "BBD",
  BS: "BSD",
  BG: "BGN",
  BH: "BHD",
  BI: "BIF",
  BJ: "XOF",
  BM: "BMD",
  BN: "BND",
  BO: "BOB",
  BT: "BTN",
  BY: "BYN",
  BZ: "BZD",
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  IM: "GBP",
  GG: "GBP",
  JE: "GBP",
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
  BA: "BAM",
  BW: "BWP",
  CF: "XAF",
  CG: "XAF",
  CH: "CHF",
  CL: "CLP",
  CM: "XAF",
  CO: "COP",
  CR: "CRC",
  CV: "CVE",
  CY: "EUR",
  CZ: "CZK",
  DJ: "DJF",
  DK: "DKK",
  DM: "XCD",
  DO: "DOP",
  DZ: "DZD",
  EC: "USD",
  EE: "EUR",
  EG: "EGP",
  ER: "ERN",
  ES: "EUR",
  ET: "ETB",
  FI: "EUR",
  FJ: "FJD",
  FR: "EUR",
  GA: "XAF",
  GE: "GEL",
  GL: "DKK",
  GM: "GMD",
  GN: "GNF",
  GQ: "XAF",
  GT: "GTQ",
  GW: "XOF",
  GY: "GYD",
  GH: "GHS",
  HN: "HNL",
  HR: "EUR",
  HT: "HTG",
  HU: "HUF",
  ID: "IDR",
  IE: "EUR",
  IL: "ILS",
  IN: "INR",
  IQ: "IQD",
  IR: "IRR",
  IS: "ISK",
  IT: "EUR",
  JM: "JMD",
  JO: "JOD",
  JP: "JPY",
  NG: "NGN",
  KE: "KES",
  KG: "KGS",
  KN: "XCD",
  KR: "KRW",
  KW: "KWD",
  KZ: "KZT",
  LA: "LAK",
  LB: "LBP",
  LC: "XCD",
  LI: "CHF",
  LK: "LKR",
  LR: "LRD",
  LS: "LSL",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  LY: "LYD",
  MA: "MAD",
  MC: "EUR",
  MD: "MDL",
  ME: "EUR",
  MG: "MGA",
  MK: "MKD",
  ML: "XOF",
  MM: "MMK",
  MN: "MNT",
  MR: "MRU",
  MT: "EUR",
  MU: "MUR",
  MW: "MWK",
  MX: "MXN",
  MY: "MYR",
  MZ: "MZN",
  NA: "NAD",
  NE: "XOF",
  NI: "NIO",
  NL: "EUR",
  NO: "NOK",
  NP: "NPR",
  NZ: "NZD",
  OM: "OMR",
  PA: "PAB",
  PE: "PEN",
  PG: "PGK",
  PH: "PHP",
  PK: "PKR",
  PL: "PLN",
  PR: "USD",
  PT: "EUR",
  PY: "PYG",
  QA: "QAR",
  RO: "RON",
  RS: "RSD",
  RW: "RWF",
  SA: "SAR",
  SB: "SBD",
  SC: "SCR",
  SD: "SDG",
  SE: "SEK",
  SG: "SGD",
  SI: "EUR",
  SK: "EUR",
  SL: "SLE",
  SN: "XOF",
  SO: "SOS",
  SR: "SRD",
  SS: "SSP",
  ST: "STN",
  SV: "USD",
  SY: "SYP",
  SZ: "SZL",
  TD: "XAF",
  TG: "XOF",
  TH: "THB",
  TJ: "TJS",
  TL: "USD",
  TM: "TMT",
  TN: "TND",
  TO: "TOP",
  TT: "TTD",
  TW: "TWD",
  TZ: "TZS",
  UG: "UGX",
  UY: "UYU",
  UZ: "UZS",
  VC: "XCD",
  VE: "VES",
  VN: "VND",
  VU: "VUV",
  WS: "WST",
  YE: "YER",
  ZA: "ZAR",
  ZM: "ZMW",
  ZW: "USD",
  AU: "AUD",
  BD: "BDT",
  BE: "EUR",
  BF: "XOF",
  CD: "CDF",
  CI: "XOF",
  CN: "CNY",
  DE: "EUR",
  GG: "GBP",
  HK: "HKD",
  IM: "GBP",
  JE: "GBP",
  KH: "KHR",
  KM: "KMF",
  LT: "EUR",
  LY: "LYD",
  RU: "RUB",
  TR: "TRY",
  UA: "UAH",
  GB: "GBP",
  CA: "CAD",
  AE: "AED",
  AR: "ARS",
  BR: "BRL",
  CU: "CUP",
  GD: "XCD",
};

function roundTo2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeIpCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^::ffff:/, "")
    .replace(/^\[(.*)\]$/, "$1");
}

function isPrivateOrLoopbackIp(ip) {
  const normalized = normalizeIpCandidate(ip).toLowerCase();
  if (!normalized) return true;
  if (normalized === "::1" || normalized === "127.0.0.1" || normalized === "localhost") return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized)) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req) {
  const headerCandidates = [
    req.headers["cf-connecting-ip"],
    req.headers["true-client-ip"],
    req.headers["fastly-client-ip"],
    req.headers["fly-client-ip"],
    req.headers["x-real-ip"],
    req.headers["x-client-ip"],
    req.headers["x-cluster-client-ip"],
    req.headers["x-forwarded-for"],
    req.ip,
    req.connection?.remoteAddress,
    req.socket?.remoteAddress,
  ];

  const allCandidates = [];
  for (const value of headerCandidates) {
    if (!value) continue;
    for (const part of String(value).split(",")) {
      const candidate = normalizeIpCandidate(part);
      if (candidate) allCandidates.push(candidate);
    }
  }

  const publicCandidate = allCandidates.find((candidate) => !isPrivateOrLoopbackIp(candidate));
  if (publicCandidate) return publicCandidate;

  const fallbackCandidate = allCandidates.find(
    (candidate) => !["::1", "127.0.0.1", "localhost"].includes(candidate)
  );
  return fallbackCandidate || null;
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

function getSupportedCurrencyOptions() {
  const uniqueCodes = new Set(["USD"]);
  Object.values(COUNTRY_CURRENCY_MAP).forEach((code) => {
    const normalized = normalizeCurrencyCode(code);
    if (normalized) uniqueCodes.add(normalized);
  });

  return Array.from(uniqueCodes)
    .sort((left, right) => left.localeCompare(right))
    .map((code) => ({
      code,
      name: CURRENCY_NAME_MAP[code] || code,
    }));
}

async function ensureOrganizationCurrencyColumn() {
  if (orgCurrencyColumnReady) return;

  await db.query(`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS organization_currency VARCHAR(3)
  `).catch(() => null);

  orgCurrencyColumnReady = true;
}

async function getOrganizationCurrencyOverride(organizationId) {
  const normalizedOrgId = Number(organizationId || 0);
  if (!normalizedOrgId) return null;

  try {
    await ensureOrganizationCurrencyColumn();
    const result = await db.query(
      `SELECT organization_currency FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [normalizedOrgId]
    );
    return normalizeCurrencyCode(result.rows?.[0]?.organization_currency);
  } catch (_) {
    return null;
  }
}

function normalizeLocationToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCountryNameMatchers() {
  const entries = [];
  Object.entries(COUNTRY_NAME_LOOKUP || {}).forEach(([code, name]) => {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedName = normalizeLocationToken(name);
    if (!/^[A-Z]{2}$/.test(normalizedCode) || !normalizedName) return;
    entries.push([normalizedName, normalizedCode]);
  });

  const aliases = [
    ["cote divoire", "CI"],
    ["ivory coast", "CI"],
    ["united states of america", "US"],
    ["usa", "US"],
    ["uk", "GB"],
    ["great britain", "GB"],
    ["uae", "AE"],
    ["russia", "RU"],
    ["south korea", "KR"],
    ["north korea", "KP"],
    ["congo dr", "CD"],
    ["dr congo", "CD"],
  ];

  aliases.forEach(([name, code]) => {
    entries.push([normalizeLocationToken(name), code]);
  });

  return entries
    .filter(([name, code]) => name && /^[A-Z]{2}$/.test(code))
    .sort((left, right) => right[0].length - left[0].length);
}

const COUNTRY_NAME_MATCHERS = buildCountryNameMatchers();

function inferCountryCodeFromLocationText(locationText) {
  const normalizedText = normalizeLocationToken(locationText);
  if (!normalizedText) return null;
  const haystack = ` ${normalizedText} `;

  for (const [needle, countryCode] of COUNTRY_NAME_MATCHERS) {
    if (needle.length < 3) continue;
    if (haystack.includes(` ${needle} `)) {
      return countryCode;
    }
  }

  return null;
}

function inferCountryCodeFromLocationParts(...parts) {
  const joined = parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return inferCountryCodeFromLocationText(joined);
}

async function fetchPublicJson(url, options = {}) {
  try {
    return await axios.get(url, options);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    const isTlsChainIssue =
      message.includes("unable to get local issuer certificate") ||
      message.includes("self signed certificate") ||
      message.includes("unable to verify the first certificate");

    if (!isTlsChainIssue) throw error;

    return axios.get(url, {
      ...options,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }
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

  const response = await fetchPublicJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
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
      `SELECT organization_country, organization_address, organization_province
         FROM organizations
        WHERE organization_id = $1
        LIMIT 1`,
      [normalizedOrgId]
    );
    const row = result.rows?.[0] || {};
    const orgCountry = String(row.organization_country || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(orgCountry)) return orgCountry;

    return inferCountryCodeFromLocationParts(row.organization_address, row.organization_province);
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
          AND COALESCE(user_role, '') IN ('Manager', 'Supervisor', 'Teacher')
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
    req.headers["cloudfront-viewer-country"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"] ||
    req.headers["x-geo-country"] ||
    req.headers["x-appengine-country"] ||
    req.headers["x-real-country"];

  const code = String(candidate || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function getAcceptLanguageCountry(req) {
  const raw = String(req?.headers?.["accept-language"] || "").trim();
  if (!raw) return null;

  const firstTag = raw
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .find(Boolean);

  if (!firstTag) return null;

  const parts = firstTag.replace(/_/g, "-").split("-");
  const region = String(parts[1] || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : null;
}

async function detectCurrencyForRequest(req, options = {}) {
  const organizationId =
    Number(options.organizationId || 0) ||
    Number(req?.session?.organizationId || 0) ||
    null;

  if (organizationId) {
    const orgCurrencyOverride = await getOrganizationCurrencyOverride(organizationId);
    if (orgCurrencyOverride) {
      const orgCountryCode = await getOrganizationCountryFallback(organizationId);
      return {
        countryCode: orgCountryCode,
        currencyCode: orgCurrencyOverride,
        source: "organization-currency-override",
      };
    }

    const orgCountryCode = await getOrganizationCountryFallback(organizationId);
    const orgCurrency = normalizeCurrencyCode(getCurrencyForCountry(orgCountryCode));
    if (orgCurrency) {
      return {
        countryCode: orgCountryCode,
        currencyCode: orgCurrency,
        source: "organization-country-fallback",
      };
    }

    const orgGeo = await getDominantOrganizationGeo(organizationId);
    if (orgGeo?.currencyCode) {
      return orgGeo;
    }

    // For organization-scoped pages, keep billing stable even when request geo
    // varies (VPN/proxy/mobility). If org settings are incomplete, use USD until
    // an explicit country/currency is saved in Settings.
    return {
      countryCode: null,
      currencyCode: FALLBACK_CURRENCY,
      source: "organization-default-fallback",
    };
  }

  const headerCountry = getHeaderCountry(req);
  const headerCurrency = normalizeCurrencyCode(getCurrencyForCountry(headerCountry));
  if (headerCurrency) {
    return {
      countryCode: headerCountry,
      currencyCode: headerCurrency,
      source: "request-header",
    };
  }

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

  const acceptLanguageCountry = getAcceptLanguageCountry(req);
  const acceptLanguageCurrency = normalizeCurrencyCode(getCurrencyForCountry(acceptLanguageCountry));
  if (acceptLanguageCurrency) {
    return {
      countryCode: acceptLanguageCountry,
      currencyCode: acceptLanguageCurrency,
      source: "accept-language-fallback",
    };
  }

  return {
    countryCode: headerCountry || acceptLanguageCountry || null,
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
    const primary = await fetchPublicJson("https://open.er-api.com/v6/latest/USD", {
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
      const fallback = await fetchPublicJson("https://api.exchangerate.host/latest?base=USD", {
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
    try {
      const tertiary = await fetchPublicJson("https://api.frankfurter.app/latest?from=USD", {
        timeout: 6000,
        validateStatus: () => true,
      });

      if (tertiary?.data?.rates) {
        rates = tertiary.data.rates;
        source = "frankfurter.app";
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
  getCurrencyForCountry,
  getSupportedCurrencyOptions,
  inferCountryCodeFromLocationParts,
  localizeUsdAmount,
  formatCurrencyAmount,
};
