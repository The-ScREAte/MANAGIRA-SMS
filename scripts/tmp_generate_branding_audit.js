const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', 'BRANDING_ASSET_AUDIT.md');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.bmp', '.tiff', '.tif']);
const SCAN_EXTS = new Set(['.html', '.ejs', '.js', '.ts', '.json', '.xml', '.md', '.css']);
const IGNORE_DIRS = new Set(['.git', 'node_modules']);

const BRAND_PATTERNS = [
  /favicon/i,
  /apple-touch-icon/i,
  /manifest/i,
  /og:image/i,
  /twitter:image/i,
  /shortcut icon/i,
  /logo/i,
  /lovable/i,
  /managira\.png/i,
  /profilePlaceholder\.png/i,
];

const IMAGE_REF_REGEX = /(href|src|content)\s*=\s*["']([^"']+\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|bmp|tiff|tif))(?:\?[^"']*)?["']/ig;

function toPosixRel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

const allFiles = walk(ROOT);

const imageFiles = allFiles
  .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
  .sort((a, b) => toPosixRel(a).localeCompare(toPosixRel(b)));

const textFiles = allFiles
  .filter((f) => SCAN_EXTS.has(path.extname(f).toLowerCase()))
  .sort((a, b) => toPosixRel(a).localeCompare(toPosixRel(b)));

const brandingRefs = [];
const imageRefs = [];

for (const filePath of textFiles) {
  const rel = toPosixRel(filePath);
  const content = safeRead(filePath);
  if (!content) continue;

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (BRAND_PATTERNS.some((p) => p.test(line))) {
      brandingRefs.push({ rel, line: idx + 1, text: line.trim().slice(0, 240) });
    }

    let m;
    while ((m = IMAGE_REF_REGEX.exec(line)) !== null) {
      imageRefs.push({ rel, line: idx + 1, attr: m[1], ref: m[2] });
    }
  });
}

const lovableRefs = brandingRefs.filter((r) => /lovable/i.test(r.text));

function publicUrlGuess(rel) {
  if (rel.startsWith('public/')) {
    return '/' + rel.replace(/^public\//, '');
  }
  if (rel.startsWith('dist/')) {
    return '/' + rel.replace(/^dist\//, '');
  }
  return '';
}

const lines = [];
lines.push('# Branding Asset Audit');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push(`Total image/icon files found: **${imageFiles.length}**`);
lines.push(`Total branding-related references found: **${brandingRefs.length}**`);
lines.push(`Total explicit image URL refs in markup/code: **${imageRefs.length}**`);
lines.push('');

lines.push('## 1) Potential Search Result Branding Sources');
lines.push('These are the references most likely to affect Google result icon/brand snippets.');
lines.push('');
for (const ref of brandingRefs) {
  lines.push(`- [${ref.rel}#L${ref.line}](${ref.rel}#L${ref.line}) — ${ref.text.replace(/\|/g, '\\|')}`);
}
lines.push('');

lines.push('## 2) All Image/Icon Files in Workspace');
lines.push('');
for (const abs of imageFiles) {
  const rel = toPosixRel(abs);
  const url = publicUrlGuess(rel);
  if (url) {
    lines.push(`- [${rel}](${rel}) — URL guess: ${url}`);
  } else {
    lines.push(`- [${rel}](${rel})`);
  }
}
lines.push('');

lines.push('## 3) Explicit Image References in Code/Markup');
lines.push('');
for (const ref of imageRefs) {
  lines.push(`- [${ref.rel}#L${ref.line}](${ref.rel}#L${ref.line}) — ${ref.attr}="${ref.ref}"`);
}
lines.push('');

lines.push('## 4) Lovable Mentions');
lines.push('');
if (lovableRefs.length === 0) {
  lines.push('- None found.');
} else {
  for (const ref of lovableRefs) {
    lines.push(`- [${ref.rel}#L${ref.line}](${ref.rel}#L${ref.line}) — ${ref.text}`);
  }
}

fs.writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');
console.log('Wrote report:', toPosixRel(OUTPUT));
console.log('Image files:', imageFiles.length);
console.log('Brand refs:', brandingRefs.length);
console.log('Image refs:', imageRefs.length);
