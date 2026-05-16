const axios = require("axios");

const FX_TTL_MS = 30 * 60 * 1000;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;

const fxCache = {
  rates: null,
  expiresAt: 0,
  source: null,
};

const geoCache = new Map();

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
  const detectedCurrency = normalizeCurrencyCode(payload.currency);
  const detectedCountry = String(payload.country_code || "").toUpperCase() || null;

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

function getHeaderCountry(req) {
  const candidate =
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"];

  const code = String(candidate || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

async function detectCurrencyForRequest(req) {
  const ip = getClientIp(req);

  if (ip) {
    try {
      const geo = await fetchGeoFromIp(ip);
      if (geo.currencyCode) return geo;
    } catch (_) {
    }
  }

  const countryCode = getHeaderCountry(req);
  return {
    countryCode,
    currencyCode: FALLBACK_CURRENCY,
    source: countryCode ? "request-header" : "fallback",
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

async function getCurrencyProfileForRequest(req) {
  const geo = await detectCurrencyForRequest(req);
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
