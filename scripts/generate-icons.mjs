/**
 * Generates adaptive PWA icon variants from the existing bomb icon.
 * Run once: node scripts/generate-icons.mjs
 *
 * Produces:
 *   client/public/favicon_io/icon-light-512.png   white bg  + gold graphic (thickened)
 *   client/public/favicon_io/icon-dark-512.png    dark bg   + gold graphic
 *   client/public/favicon_io/icon-tinted-512.png  transparent bg + black graphic
 *   (same for 192px)
 */

import Jimp from 'jimp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'client', 'public', 'favicon_io');
const SRC = path.join(OUT, 'android-chrome-512x512.png');

// Palette
const GOLD   = { r: 0xff, g: 0xd7, b: 0x00 };
const DARK   = { r: 0x0f, g: 0x20, b: 0x27 };
const WHITE  = { r: 0xff, g: 0xff, b: 0xff };
const BLACK  = { r: 0x00, g: 0x00, b: 0x00 };
const TRANSP = { r: 0x00, g: 0x00, b: 0x00, a: 0 };

/** Returns true if the pixel is "background" (near-white) */
function isBg(r, g, b) {
  return r > 200 && g > 200 && b > 200;
}

/**
 * Build a boolean mask: true = foreground pixel in the source image.
 * Applies morphological dilation by `dilateRadius` pixels to thicken lines.
 */
function buildFgMask(img, dilateRadius = 0) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const data = img.bitmap.data;

  // Original foreground mask
  const raw = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      raw[y * w + x] = isBg(r, g, b) ? 0 : 1;
    }
  }

  if (dilateRadius === 0) return raw;

  // Dilate: for each pixel, check if any neighbor within radius is foreground
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = false;
      outer: for (let dy = -dilateRadius; dy <= dilateRadius; dy++) {
        for (let dx = -dilateRadius; dx <= dilateRadius; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && raw[ny * w + nx]) {
            found = true;
            break outer;
          }
        }
      }
      dilated[y * w + x] = found ? 1 : 0;
    }
  }
  return dilated;
}

async function makeVariant(size, bgColor, fgColor, outName, transparentBg = false, dilateRadius = 0) {
  const img = await Jimp.read(SRC);
  img.resize(size, size);

  const fgMask = buildFgMask(img, dilateRadius);
  const w = img.bitmap.width;

  img.scan(0, 0, w, img.bitmap.height, function (x, y, idx) {
    const isFg = fgMask[y * w + x];

    if (isFg) {
      this.bitmap.data[idx]     = fgColor.r;
      this.bitmap.data[idx + 1] = fgColor.g;
      this.bitmap.data[idx + 2] = fgColor.b;
      this.bitmap.data[idx + 3] = 255;
    } else {
      if (transparentBg) {
        this.bitmap.data[idx]     = 0;
        this.bitmap.data[idx + 1] = 0;
        this.bitmap.data[idx + 2] = 0;
        this.bitmap.data[idx + 3] = 0;
      } else {
        this.bitmap.data[idx]     = bgColor.r;
        this.bitmap.data[idx + 1] = bgColor.g;
        this.bitmap.data[idx + 2] = bgColor.b;
        this.bitmap.data[idx + 3] = 255;
      }
    }
  });

  const outPath = path.join(OUT, outName);
  await img.writeAsync(outPath);
  console.log(`✓ ${outPath}`);
}

async function main() {
  console.log('Generating adaptive PWA icons...\n');

  for (const size of [512, 192]) {
    // Default (any): gold bg + white graphic
    await makeVariant(size, GOLD, WHITE, `icon-light-${size}.png`, false, 0);

    // Dark purpose (Android dark mode): dark bg + gold graphic
    await makeVariant(size, DARK, GOLD, `icon-dark-${size}.png`, false, 0);
  }

  console.log('\nDone!');
}

main().catch(console.error);
