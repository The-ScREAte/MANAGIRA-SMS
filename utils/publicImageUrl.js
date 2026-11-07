const crypto = require("crypto");

const IMAGE_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});
const PUBLIC_IMAGE_PREFIXES = [
  "images/ads/",
  "images/donations/",
  "images/hub-logos/",
  "images/logos/",
  "images/publicdashboard/",
  "images/website/",
];

function encodeObjectKey(key) {
  return String(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeObjectKey(key) {
  return String(key)
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function normalizeEncodedObjectKey(key) {
  return encodeObjectKey(decodeObjectKey(key));
}

function isSignedS3Url(value) {
  return /[?&](?:X-Amz-|AWSAccessKeyId=|Signature=|Expires=)/i.test(value);
}

function resolveS3Object(value, bucket) {
  const image = String(value || "").trim();
  if (!image) return null;

  const s3Uri = image.match(/^s3:\/\/([^/]+)\/(.*)$/i);
  if (s3Uri && s3Uri[1] === bucket) {
    return { key: decodeObjectKey(s3Uri[2]) };
  }

  const absolute = image.match(/^https?:\/\/([^/]+)\/(.*)$/i);
  if (absolute && !isSignedS3Url(image)) {
    const host = absolute[1].toLowerCase().replace(/:\d+$/, "");
    const path = absolute[2].split(/[?#]/, 1)[0];
    const virtualHost = host.match(/^(.+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i);
    if (virtualHost && virtualHost[1] === bucket.toLowerCase()) {
      return { key: decodeObjectKey(path) };
    }

    if (/^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(host)) {
      const separator = path.indexOf("/");
      if (separator > 0 && path.slice(0, separator) === bucket) {
        return { key: decodeObjectKey(path.slice(separator + 1)) };
      }
    }
  }

  if (!/^(?:https?:)?\/\//i.test(image) && !image.startsWith("/") && !image.startsWith("data:")) {
    return { key: image.replace(/^\/+/, "") };
  }

  return null;
}

function s3ObjectUrl(key, options = {}) {
  const bucket = String(options.bucket || process.env.S3_BUCKET_NAME || "").trim();
  const region = String(options.region || process.env.AWS_REGION || "").trim();
  if (!bucket || !region) return String(key || "");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeObjectKey(key)}`;
}

function isSupportedImageKey(key) {
  const normalized = String(key || "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "." || part === "..")) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, require("path").extname(normalized).toLowerCase());
}

function isRoutableImageKey(key) {
  const normalized = String(key || "");
  return isSupportedImageKey(normalized) &&
    (normalized.startsWith("images/") || /^\d{13}-[^/]+\.[a-z0-9]+$/i.test(normalized));
}

function isPublicImageKey(key) {
  return PUBLIC_IMAGE_PREFIXES.some((prefix) => String(key || "").startsWith(prefix));
}

function isLegacyDonationImageKey(key) {
  return /^\d{13}-[^/]+\.[a-z0-9]+$/i.test(String(key || "")) && isSupportedImageKey(key);
}

function isLegacyPublicImageKey(key) {
  return isLegacyDonationImageKey(key);
}

function imageContentType(key) {
  return IMAGE_TYPES[require("path").extname(String(key || "")).toLowerCase()] || null;
}

function imageSignature(key, expires, secret, viewer = "", scope = "") {
  return crypto
    .createHmac("sha256", secret)
    .update(`${key}\n${expires}\n${viewer}\n${scope}`)
    .digest("base64url");
}

function verifyPublicImageSignature(key, expires, signature, secret, viewer = "", scope = "") {
  const expiresAt = Number(expires);
  const now = Math.floor(Date.now() / 1000);
  if (!secret || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 3660) {
    return false;
  }

  const supplied = Buffer.from(String(signature || ""));
  const expected = Buffer.from(imageSignature(key, expiresAt, secret, viewer, scope));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function publicImageUrl(value, options = {}) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (image === "profilePlaceholder.png") return "/images/profilePlaceholder.png";
  const imageKeyPath = image.replace(/^\/(?=(?:images\/(?:ads|donations|hub-logos|logos|publicdashboard|website)\/|\d{13}-))/i, "");

  const bucket = String(options.bucket || process.env.S3_BUCKET_NAME || "").trim();
  const region = String(options.region || process.env.AWS_REGION || "").trim();
  const object = bucket ? resolveS3Object(imageKeyPath, bucket) : null;

  if (object && isRoutableImageKey(object.key) && options.secret) {
    // Rounded to a shared time window, so an image keeps one address across page
    // loads: the browser reuses its copy instead of downloading and repainting it,
    // and a page's HTML doesn't differ from one request to the next.
    const lifetime = options.expiresInSeconds || 3600;
    const span = Math.max(1, Math.floor(lifetime / 2));
    const expires = Math.floor((Math.floor(Date.now() / 1000) + lifetime) / span) * span;
    const publicScope = options.public === true || isPublicImageKey(object.key);
    const viewer = publicScope ? "" : options.viewer || "";
    const signature = imageSignature(object.key, expires, options.secret, viewer, publicScope ? "public" : "");
    const publicParam = publicScope ? "&public=1" : "";
    // A smaller copy where a page only shows a small picture (the sizes the route accepts).
    const widthParam = options.width ? `&w=${Number(options.width)}` : "";
    return `/public-image?key=${encodeURIComponent(object.key)}&expires=${expires}&signature=${encodeURIComponent(signature)}${publicParam}${widthParam}`;
  }

  if (object && bucket && region) return s3ObjectUrl(object.key, { bucket, region });
  if (image.startsWith("s3://")) {
    const s3Uri = image.match(/^s3:\/\/([^/]+)\/(.*)$/i);
    return s3Uri ? `https://${s3Uri[1]}.s3.${region || "amazonaws.com"}/${normalizeEncodedObjectKey(s3Uri[2])}` : image;
  }

  const absolute = image.match(/^(https?:\/\/)([^/]+)\/(.*)$/i);
  if (absolute && !isSignedS3Url(image)) {
    const host = absolute[2].toLowerCase();
    const virtualHost = host.match(/^(.+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i);
    if (virtualHost || /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(host)) {
      const path = absolute[3].split(/[?#]/, 1)[0];
      return `${absolute[1]}${absolute[2]}/${normalizeEncodedObjectKey(path)}`;
    }
  }

  if (image.startsWith("/") || image.startsWith("data:") || /^(?:https?:)?\/\//i.test(image)) return image;
  if (bucket && region) return s3ObjectUrl(image.replace(/^\/+/, ""), { bucket, region });
  return `/${image.replace(/^\/+/, "")}`;
}

publicImageUrl.s3ObjectUrl = s3ObjectUrl;
publicImageUrl.isSupportedImageKey = isSupportedImageKey;
publicImageUrl.isRoutableImageKey = isRoutableImageKey;
publicImageUrl.isPublicImageKey = isPublicImageKey;
publicImageUrl.isLegacyDonationImageKey = isLegacyDonationImageKey;
publicImageUrl.isLegacyPublicImageKey = isLegacyPublicImageKey;
publicImageUrl.imageContentType = imageContentType;
publicImageUrl.verifyPublicImageSignature = verifyPublicImageSignature;

module.exports = publicImageUrl;
