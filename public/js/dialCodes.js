// Mirrors utils/dialCodes.js — keep both in sync.
window.MANAGIRA_DIAL_CODES = [
  { iso2: "GH", name: "Ghana", dial: "233" },
  { iso2: "NG", name: "Nigeria", dial: "234" },
  { iso2: "CI", name: "Cote d'Ivoire", dial: "225" },
  { iso2: "TG", name: "Togo", dial: "228" },
  { iso2: "BJ", name: "Benin", dial: "229" },
  { iso2: "BF", name: "Burkina Faso", dial: "226" },
  { iso2: "SN", name: "Senegal", dial: "221" },
  { iso2: "ML", name: "Mali", dial: "223" },
  { iso2: "NE", name: "Niger", dial: "227" },
  { iso2: "GN", name: "Guinea", dial: "224" },
  { iso2: "SL", name: "Sierra Leone", dial: "232" },
  { iso2: "LR", name: "Liberia", dial: "231" },
  { iso2: "GM", name: "Gambia", dial: "220" },
  { iso2: "CM", name: "Cameroon", dial: "237" },
  { iso2: "KE", name: "Kenya", dial: "254" },
  { iso2: "UG", name: "Uganda", dial: "256" },
  { iso2: "TZ", name: "Tanzania", dial: "255" },
  { iso2: "RW", name: "Rwanda", dial: "250" },
  { iso2: "ET", name: "Ethiopia", dial: "251" },
  { iso2: "ZA", name: "South Africa", dial: "27" },
  { iso2: "ZM", name: "Zambia", dial: "260" },
  { iso2: "ZW", name: "Zimbabwe", dial: "263" },
  { iso2: "EG", name: "Egypt", dial: "20" },
  { iso2: "MA", name: "Morocco", dial: "212" },
  { iso2: "DZ", name: "Algeria", dial: "213" },
  { iso2: "TN", name: "Tunisia", dial: "216" },
  { iso2: "US", name: "United States", dial: "1" },
  { iso2: "CA", name: "Canada", dial: "1" },
  { iso2: "GB", name: "United Kingdom", dial: "44" },
  { iso2: "IE", name: "Ireland", dial: "353" },
  { iso2: "FR", name: "France", dial: "33" },
  { iso2: "DE", name: "Germany", dial: "49" },
  { iso2: "ES", name: "Spain", dial: "34" },
  { iso2: "IT", name: "Italy", dial: "39" },
  { iso2: "NL", name: "Netherlands", dial: "31" },
  { iso2: "BE", name: "Belgium", dial: "32" },
  { iso2: "PT", name: "Portugal", dial: "351" },
  { iso2: "CH", name: "Switzerland", dial: "41" },
  { iso2: "SE", name: "Sweden", dial: "46" },
  { iso2: "NO", name: "Norway", dial: "47" },
  { iso2: "DK", name: "Denmark", dial: "45" },
  { iso2: "AE", name: "United Arab Emirates", dial: "971" },
  { iso2: "SA", name: "Saudi Arabia", dial: "966" },
  { iso2: "QA", name: "Qatar", dial: "974" },
  { iso2: "IN", name: "India", dial: "91" },
  { iso2: "PK", name: "Pakistan", dial: "92" },
  { iso2: "CN", name: "China", dial: "86" },
  { iso2: "AU", name: "Australia", dial: "61" },
  { iso2: "NZ", name: "New Zealand", dial: "64" },
  { iso2: "BR", name: "Brazil", dial: "55" },
  { iso2: "JM", name: "Jamaica", dial: "1876" },
];

// Turns any element matching `.phone-combo` (a <select class="phone-dial-select">
// next to an <input class="phone-local-input">) into a working country-code
// picker. Call this again after adding new guardian rows dynamically.
window.initPhoneCountryCombos = function initPhoneCountryCombos(root) {
  const scope = root || document;
  scope.querySelectorAll(".phone-combo").forEach((combo) => {
    const select = combo.querySelector(".phone-dial-select");
    const input = combo.querySelector(".phone-local-input");
    if (!select || !input || select.dataset.initialized === "1") return;
    select.dataset.initialized = "1";

    const defaultIso2 = (combo.dataset.defaultIso2 || "GH").toUpperCase();
    select.innerHTML = window.MANAGIRA_DIAL_CODES
      .map((c) => `<option value="${c.dial}" data-iso2="${c.iso2}">${c.name} (+${c.dial})</option>`)
      .join("");

    // If the input already has a value (editing an existing guardian), try
    // to split a leading "+<dial>" off it so the select reflects what's
    // already saved instead of defaulting blind.
    const existing = String(input.value || "").trim();
    let matchedDial = null;
    if (existing.startsWith("+")) {
      const digits = existing.slice(1);
      const candidates = window.MANAGIRA_DIAL_CODES
        .filter((c) => digits.startsWith(c.dial))
        .sort((a, b) => b.dial.length - a.dial.length);
      if (candidates.length) {
        matchedDial = candidates[0].dial;
        input.value = digits.slice(matchedDial.length);
      }
    }

    if (matchedDial) {
      select.value = matchedDial;
    } else {
      const defaultOption = Array.from(select.options).find((o) => o.dataset.iso2 === defaultIso2);
      if (defaultOption) select.value = defaultOption.value;
    }
  });
};

// Call right before a form submits / a payload is built: rewrites each
// .phone-local-input's value to the full "+<dial><digits>" string, since
// that input's `name` attribute is what actually gets posted.
window.combinePhoneCountryCombos = function combinePhoneCountryCombos(root) {
  const scope = root || document;
  scope.querySelectorAll(".phone-combo").forEach((combo) => {
    const select = combo.querySelector(".phone-dial-select");
    const input = combo.querySelector(".phone-local-input");
    if (!select || !input) return;
    const digits = String(input.value || "").replace(/[^\d]/g, "");
    if (!digits) return;
    input.value = `+${select.value}${digits}`;
  });
};

document.addEventListener("DOMContentLoaded", () => window.initPhoneCountryCombos());
