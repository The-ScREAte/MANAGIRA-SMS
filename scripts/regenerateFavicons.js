const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule.imagesToIco;

async function renderPngFromSvg(svgPath, size) {
  return sharp(svgPath)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function main() {
  const root = process.cwd();
  const sourceImage = path.join(root, 'public', 'images', 'favicon-source.png');
  const faviconDir = path.join(root, 'public', 'images', 'favicon_io');

  if (!fs.existsSync(sourceImage)) {
    throw new Error(`Favicon source image not found: ${sourceImage}`);
  }

  fs.mkdirSync(faviconDir, { recursive: true });

  const png16 = await renderPngFromSvg(sourceImage, 16);
  const png32 = await renderPngFromSvg(sourceImage, 32);
  const png180 = await renderPngFromSvg(sourceImage, 180);
  const png192 = await renderPngFromSvg(sourceImage, 192);
  const png512 = await renderPngFromSvg(sourceImage, 512);

  const ico = await pngToIco([png32, png16]);

  fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), ico);
  fs.writeFileSync(path.join(faviconDir, 'favicon.ico'), ico);
  fs.writeFileSync(path.join(faviconDir, 'favicon-16x16.png'), png16);
  fs.writeFileSync(path.join(faviconDir, 'favicon-32x32.png'), png32);
  fs.writeFileSync(path.join(faviconDir, 'apple-touch-icon.png'), png180);
  fs.writeFileSync(path.join(faviconDir, 'android-chrome-192x192.png'), png192);
  fs.writeFileSync(path.join(faviconDir, 'android-chrome-512x512.png'), png512);
  fs.writeFileSync(path.join(root, 'public', 'images', 'managira.png'), png512);

  console.log('Favicon assets regenerated successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
