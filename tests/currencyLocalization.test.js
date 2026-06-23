const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../utils/currencyLocalization.js');
const axiosModulePath = require.resolve('axios');
const dbModulePath = path.resolve(__dirname, '../config/db.js');

function loadWithMocks({ axiosMock, dbMock }) {
  const originals = new Map([
    [axiosModulePath, require.cache[axiosModulePath]],
    [dbModulePath, require.cache[dbModulePath]],
  ]);

  require.cache[axiosModulePath] = {
    id: axiosModulePath,
    filename: axiosModulePath,
    loaded: true,
    exports: axiosMock,
  };
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbMock,
  };

  delete require.cache[modulePath];
  const mod = require(modulePath);

  return {
    mod,
    restore() {
      delete require.cache[modulePath];
      for (const [target, original] of originals) {
        if (original) require.cache[target] = original;
        else delete require.cache[target];
      }
    },
  };
}

test('uses production country header before IP fallback', async () => {
  const axiosCalls = [];
  const { mod, restore } = loadWithMocks({
    axiosMock: {
      get: async (url) => {
        axiosCalls.push(url);
        if (url.includes('latest/USD')) {
          return { data: { result: 'success', rates: { USD: 1, EUR: 0.92, GHS: 15.1 } } };
        }
        throw new Error('unexpected geo lookup');
      },
    },
    dbMock: { query: async () => ({ rows: [] }) },
  });

  try {
    const profile = await mod.getCurrencyProfileForRequest({
      headers: {
        'cf-ipcountry': 'NL',
        'x-forwarded-for': '203.0.113.10',
      },
      ip: '10.0.0.5',
    });

    assert.equal(profile.userCurrency, 'EUR');
    assert.equal(profile.countryCode, 'NL');
    assert.equal(profile.detectionSource, 'request-header');
    assert.equal(axiosCalls.some((url) => url.includes('ipapi.co')), false);
  } finally {
    restore();
  }
});

test('falls back to accept-language region when no country header or usable geo exists', async () => {
  const { mod, restore } = loadWithMocks({
    axiosMock: {
      get: async (url) => {
        if (url.includes('latest/USD')) {
          return { data: { result: 'success', rates: { USD: 1, NGN: 1500, GHS: 15.1 } } };
        }
        return { data: {} };
      },
    },
    dbMock: { query: async () => ({ rows: [] }) },
  });

  try {
    const profile = await mod.getCurrencyProfileForRequest({
      headers: {
        'accept-language': 'en-NG,en;q=0.9',
      },
      ip: '127.0.0.1',
    });

    assert.equal(profile.userCurrency, 'NGN');
    assert.equal(profile.countryCode, 'NG');
    assert.equal(profile.detectionSource, 'accept-language-fallback');
  } finally {
    restore();
  }
});

test('uses fetched USD rates to localize detected currency', async () => {
  const { mod, restore } = loadWithMocks({
    axiosMock: {
      get: async (url) => {
        if (url.includes('latest/USD')) {
          return { data: { result: 'success', rates: { USD: 1, EUR: 0.91, GHS: 15.2 } } };
        }
        throw new Error(`unexpected url: ${url}`);
      },
    },
    dbMock: { query: async () => ({ rows: [] }) },
  });

  try {
    const profile = await mod.getCurrencyProfileForRequest({
      headers: { 'cf-ipcountry': 'NL' },
      ip: '127.0.0.1',
    });

    assert.equal(profile.userCurrency, 'EUR');
    assert.equal(profile.usdToUserRate, 0.91);
    assert.equal(profile.usdToGhsRate, 15.2);

    const localized = mod.localizeUsdAmount(100, profile);
    assert.equal(localized.localizedAmount, 91);
  } finally {
    restore();
  }
});

test('maps admin country codes to expected currency (EG -> EGP)', async () => {
  const { mod, restore } = loadWithMocks({
    axiosMock: {
      get: async (url) => {
        if (url.includes('latest/USD')) {
          return { data: { result: 'success', rates: { USD: 1, EGP: 49.7, GHS: 15.2 } } };
        }
        throw new Error(`unexpected url: ${url}`);
      },
    },
    dbMock: { query: async () => ({ rows: [] }) },
  });

  try {
    const profile = await mod.getCurrencyProfileForRequest({
      headers: { 'cf-ipcountry': 'EG' },
      ip: '127.0.0.1',
    });

    assert.equal(profile.countryCode, 'EG');
    assert.equal(profile.userCurrency, 'EGP');
    assert.equal(profile.usdToUserRate, 49.7);
  } finally {
    restore();
  }
});

test('detects requested countries with correct currencies', async () => {
  const expectedByCountry = {
    NP: 'NPR',
    SL: 'SLE',
    CI: 'XOF',
    KE: 'KES',
    ZA: 'ZAR',
    GH: 'GHS',
    US: 'USD',
  };

  const { mod, restore } = loadWithMocks({
    axiosMock: {
      get: async (url) => {
        if (url.includes('latest/USD')) {
          return {
            data: {
              result: 'success',
              rates: {
                USD: 1,
                NPR: 133,
                SLE: 22,
                XOF: 605,
                KES: 129,
                ZAR: 16,
                GHS: 11,
              },
            },
          };
        }
        throw new Error(`unexpected url: ${url}`);
      },
    },
    dbMock: { query: async () => ({ rows: [] }) },
  });

  try {
    for (const [countryCode, expectedCurrency] of Object.entries(expectedByCountry)) {
      const profile = await mod.getCurrencyProfileForRequest({
        headers: { 'cf-ipcountry': countryCode },
        ip: '127.0.0.1',
      });

      assert.equal(profile.countryCode, countryCode);
      assert.equal(profile.userCurrency, expectedCurrency);
      assert.equal(profile.detectionSource, 'request-header');
    }
  } finally {
    restore();
  }
});
