// Header a school can put at the top of exported reports: its name, logo,
// address, phone and the date. Choices are stored with a saved report.
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const BRANDING_KEYS = ["orgName", "logo", "address", "phone", "date"];
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

// Ticked items plus where the header sits: "left" (logo beside the text) or "center".
function normalizeBranding(raw) {
  const safe = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    ...Object.fromEntries(BRANDING_KEYS.map((key) => [key, safe[key] === true])),
    align: safe.align === "center" ? "center" : "left",
  };
}

const hasBranding = (branding) => BRANDING_KEYS.some((key) => branding?.[key]);

// Width and height from PNG, GIF or JPEG bytes; null for anything else.
function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { extension: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return { extension: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { extension: "jpeg", width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

async function loadLogo(logo) {
  const source = String(logo || "").trim();
  if (!source) return null;
  try {
    let buffer;
    if (/^https?:\/\//i.test(source)) {
      const response = await axios.get(source, { responseType: "arraybuffer", timeout: 5000, maxContentLength: MAX_LOGO_BYTES });
      buffer = Buffer.from(response.data);
    } else {
      // Local paths such as /images/... or /uploads/... under the app.
      const root = path.join(__dirname, "..");
      const candidates = [path.join(root, "public", source), path.join(root, source)].map((file) => path.normalize(file));
      const file = candidates.find((candidate) => candidate.startsWith(root) && fs.existsSync(candidate));
      if (!file || fs.statSync(file).size > MAX_LOGO_BYTES) return null;
      buffer = fs.readFileSync(file);
    }
    const info = imageInfo(buffer);
    return info && info.width > 0 && info.height > 0 ? { buffer, ...info } : null;
  } catch (_) {
    return null; // a missing logo never stops an export
  }
}

// The header content for one export, or null when nothing is ticked.
async function loadReportHeader(db, organizationId, rawBranding) {
  const branding = normalizeBranding(rawBranding);
  if (!hasBranding(branding)) return null;
  const result = await db.query(
    `SELECT organization_name, COALESCE(NULLIF(logo, ''), logo_path) AS logo, organization_address, organization_phone
       FROM organizations WHERE organization_id = $1`,
    [organizationId]
  );
  const org = result.rows[0] || {};
  return {
    orgName: branding.orgName ? String(org.organization_name || "").trim() : "",
    address: branding.address ? String(org.organization_address || "").trim() : "",
    phone: branding.phone ? String(org.organization_phone || "").trim() : "",
    date: branding.date
      ? new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : "",
    logo: branding.logo ? await loadLogo(org.logo) : null,
    align: branding.align,
  };
}

module.exports = { BRANDING_KEYS, normalizeBranding, hasBranding, imageInfo, loadLogo, loadReportHeader };
