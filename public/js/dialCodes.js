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

// Injected once, wherever this script runs, so every page using
// .phone-combo gets the same compact sizing without each page having to
// carry its own copy of these rules (and risk them drifting out of sync).
// !important because several pages already have their own generic
// .form-input width/height rules for other fields that would otherwise
// win by source order.
function ensurePhoneComboStyles() {
  if (document.getElementById("managira-phone-combo-styles")) return;
  const style = document.createElement("style");
  style.id = "managira-phone-combo-styles";
  style.textContent = `
    /* One merged pill matching this page's real "normal" input height
       (44px desktop / 34px on the same mobile breakpoint every other
       field collapses to). Flag is a real image (flagcdn.com), not a text
       emoji - Windows' default emoji font doesn't render most country
       flags as actual flag glyphs (falls back to plain letters), so an
       image is the only way to guarantee a flag actually shows as a flag
       on every device. The real <select> sits invisibly on top of the
       flag box (opacity:0, same size) so full native keyboard/mobile
       picker behavior still works - only its own visible box (text +
       dropdown arrow) is hidden, replaced by the flag image underneath. */
    .phone-combo {
      display: flex !important;
      gap: 0 !important;
      width: 100% !important;
      min-width: 0 !important;
      height: 44px !important;
      box-sizing: border-box !important;
      border: 1px solid var(--line-strong, #cfd6db) !important;
      border-radius: 10px !important;
      overflow: hidden !important;
      background: #fff !important;
      transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
    }
    .phone-combo:focus-within {
      border-color: var(--brand, #01535b) !important;
      box-shadow: 0 0 0 4px var(--brand-ring, rgba(1, 83, 91, 0.18)) !important;
    }
    .phone-combo .phone-flag-box {
      all: unset !important;
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      box-sizing: border-box !important;
      width: 48px !important;
      height: 100% !important;
      background: var(--surface-muted, #f5f8f9) !important;
      border-right: 1px solid var(--line-strong, #cfd6db) !important;
      cursor: pointer !important;
    }
    .phone-combo .phone-flag-icon {
      width: 22px !important;
      height: 16px !important;
      object-fit: cover !important;
      border-radius: 2px !important;
      pointer-events: none !important;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.08) !important;
    }
    .phone-combo .phone-dial-select {
      all: unset !important;
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      opacity: 0 !important;
      cursor: pointer !important;
      box-sizing: border-box !important;
    }
    .phone-combo .phone-local-input {
      all: unset !important;
      flex: 1 !important;
      box-sizing: border-box !important;
      min-width: 0 !important;
      height: 100% !important;
      padding: 0 12px !important;
      font-size: 0.88rem !important;
      color: var(--ink-900, #0b1f24) !important;
      background: #fff !important;
    }
    .phone-combo .phone-local-input::placeholder {
      color: var(--ink-300, #94a3a8) !important;
    }
    @media (max-width: 768px) {
      .phone-combo { height: 34px !important; }
      .phone-combo .phone-flag-box { width: 40px !important; }
      .phone-combo .phone-flag-icon { width: 20px !important; height: 15px !important; }
      .phone-combo .phone-local-input {
        font-size: 13px !important;
        padding: 0 8px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

// Turns any element matching `.phone-combo` (a <select class="phone-dial-select">
// next to an <input class="phone-local-input">) into a working country-code
// picker. Call this again after adding new guardian rows dynamically.
window.initPhoneCountryCombos = function initPhoneCountryCombos(root) {
  ensurePhoneComboStyles();
  const scope = root || document;
  scope.querySelectorAll(".phone-combo").forEach((combo) => {
    const select = combo.querySelector(".phone-dial-select");
    const input = combo.querySelector(".phone-local-input");
    if (!select || !input || select.dataset.initialized === "1") return;
    select.dataset.initialized = "1";

    input.placeholder = "Phone number";

    const defaultIso2 = (combo.dataset.defaultIso2 || "GH").toUpperCase();
    select.innerHTML = window.MANAGIRA_DIAL_CODES
      .map((c) => `<option value="${c.dial}" data-iso2="${c.iso2}">${c.name} (+${c.dial})</option>`)
      .join("");

    // Wrap the select in a flag box: a real flag image sits visually in
    // its place, the select itself stays exactly on top (see the
    // opacity:0 rule above) so all native interaction still works, it
    // just isn't seen - only the flag image is.
    const flagBox = document.createElement("div");
    flagBox.className = "phone-flag-box";
    const flagImg = document.createElement("img");
    flagImg.className = "phone-flag-icon";
    flagImg.alt = "";
    flagImg.loading = "lazy";
    select.parentNode.insertBefore(flagBox, select);
    flagBox.appendChild(flagImg);
    flagBox.appendChild(select);

    function updateFlag() {
      const opt = select.options[select.selectedIndex];
      const iso2 = String((opt && opt.dataset.iso2) || defaultIso2).toLowerCase();
      flagImg.src = `https://flagcdn.com/24x18/${iso2}.png`;
      flagImg.alt = iso2.toUpperCase();
    }
    select.addEventListener("change", updateFlag);

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

    updateFlag();
  });
};

// For code that sets a phone combo's value programmatically after init
// (e.g. populating an "Edit Driver" modal from a data-* attribute, reusing
// the same already-initialized combo rather than a fresh page load) -
// splits a leading "+<dial>" off the given value the same way the initial
// load does, instead of dumping the whole "+233241234567" string into the
// local-number box with the select left on its default country.
window.setPhoneComboValue = function setPhoneComboValue(combo, fullValue) {
  if (!combo) return;
  const select = combo.querySelector(".phone-dial-select");
  const input = combo.querySelector(".phone-local-input");
  const flagImg = combo.querySelector(".phone-flag-icon");
  if (!select || !input) return;

  const raw = String(fullValue || "").trim();
  let matchedDial = null;
  let localDigits = raw;
  if (raw.startsWith("+")) {
    const digits = raw.slice(1);
    const candidates = window.MANAGIRA_DIAL_CODES
      .filter((c) => digits.startsWith(c.dial))
      .sort((a, b) => b.dial.length - a.dial.length);
    if (candidates.length) {
      matchedDial = candidates[0].dial;
      localDigits = digits.slice(matchedDial.length);
    }
  }

  input.value = localDigits;
  if (matchedDial) {
    select.value = matchedDial;
  }

  if (flagImg) {
    const opt = select.options[select.selectedIndex];
    const iso2 = String((opt && opt.dataset.iso2) || combo.dataset.defaultIso2 || "GH").toLowerCase();
    flagImg.src = `https://flagcdn.com/24x18/${iso2}.png`;
    flagImg.alt = iso2.toUpperCase();
  }
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
