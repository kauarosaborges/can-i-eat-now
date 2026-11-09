import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(projectRoot, 'www', 'icons');
const iosAssets = join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets');
const SAMPLES = 4;

const COLORS = {
  top: [18, 112, 121],
  bottom: [10, 60, 67],
  cream: [255, 246, 232],
  peach: [242, 166, 90],
  splash: [10, 60, 67],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const stride = size * channels + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = y * stride + 1 + x * channels;
      for (let channel = 0; channel < channels; channel += 1) raw[target + channel] = pixels[source + channel];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insideRing(x, y, radius, width) {
  const distance = Math.hypot(x - 0.5, y - 0.5);
  return Math.abs(distance - radius) <= width / 2;
}

function insideArc(x, y, radius, width, sweep) {
  const angle = (Math.atan2(x - 0.5, -(y - 0.5)) + Math.PI * 2) % (Math.PI * 2);
  if (insideRing(x, y, radius, width) && angle <= sweep) return true;
  const caps = [0, sweep].map((value) => ({ x: 0.5 + Math.sin(value) * radius, y: 0.5 - Math.cos(value) * radius }));
  return caps.some((cap) => Math.hypot(x - cap.x, y - cap.y) <= width / 2);
}

function insideDrop(x, y) {
  const center = { x: 0.5, y: 0.555 };
  const radius = 0.105;
  const tipY = 0.345;
  if (Math.hypot(x - center.x, y - center.y) <= radius) return true;
  const distance = center.y - tipY;
  const tangentDepth = (distance * distance - radius * radius) / distance;
  if (y < tipY || y > tipY + tangentDepth) return false;
  const halfAngleTan = radius / Math.sqrt(distance * distance - radius * radius);
  return Math.abs(x - center.x) <= (y - tipY) * halfAngleTan;
}

function shade(x, y, { rounded, scale, flat }) {
  if (rounded && !insideRoundedRect(x, y, 0.22)) return null;
  const mix = Math.min(1, Math.max(0, y));
  let color = flat || COLORS.top.map((value, index) => value + (COLORS.bottom[index] - value) * mix);
  const ux = 0.5 + (x - 0.5) / scale;
  const uy = 0.5 + (y - 0.5) / scale;
  if (insideRing(ux, uy, 0.29, 0.075)) color = color.map((value, index) => value + (COLORS.cream[index] - value) * 0.2);
  if (insideArc(ux, uy, 0.29, 0.075, Math.PI * 1.5)) color = COLORS.peach;
  if (insideDrop(ux, uy)) color = COLORS.cream;
  return color;
}

function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  const box = options.box || { from: 0, to: size };
  const span = box.to - box.from;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const offset = (py * size + px) * 4;
      if (options.flat && (px < box.from || px >= box.to || py < box.from || py >= box.to)) {
        pixels[offset] = options.flat[0];
        pixels[offset + 1] = options.flat[1];
        pixels[offset + 2] = options.flat[2];
        pixels[offset + 3] = 255;
        continue;
      }
      let red = 0;
      let green = 0;
      let blue = 0;
      let coverage = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const color = shade((px - box.from + (sx + 0.5) / SAMPLES) / span, (py - box.from + (sy + 0.5) / SAMPLES) / span, options);
          if (!color) continue;
          red += color[0];
          green += color[1];
          blue += color[2];
          coverage += 1;
        }
      }
      if (coverage > 0) {
        pixels[offset] = Math.round(red / coverage);
        pixels[offset + 1] = Math.round(green / coverage);
        pixels[offset + 2] = Math.round(blue / coverage);
      }
      pixels[offset + 3] = Math.round((coverage / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#127079"/>
      <stop offset="1" stop-color="#0a3c43"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="148.5" fill="none" stroke="#fff6e8" stroke-opacity="0.2" stroke-width="38.4"/>
  <path d="M256 107.5A148.5 148.5 0 1 1 107.5 256" fill="none" stroke="#f2a65a" stroke-width="38.4" stroke-linecap="round"/>
  <path d="M256 176.6C243 196 202 245 202 284a54 54 0 0 0 108 0c0-39-41-88-54-107.4z" fill="#fff6e8"/>
</svg>
`;

mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'icon.svg'), SVG);
const outputs = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];
for (const output of outputs) {
  writeFileSync(join(root, output.file), encodePng(output.size, render(output.size, output)));
  process.stdout.write(`${output.file}\n`);
}

if (existsSync(iosAssets)) {
  writeFileSync(join(iosAssets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), encodePng(1024, render(1024, { rounded: false, scale: 0.9 }), { alpha: false }));
  process.stdout.write('AppIcon-512@2x.png\n');
  const splashSize = 2732;
  const iconSize = 520;
  const from = Math.round((splashSize - iconSize) / 2);
  const splash = encodePng(splashSize, render(splashSize, { rounded: false, scale: 1, flat: COLORS.splash, box: { from, to: from + iconSize } }), { alpha: false });
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    writeFileSync(join(iosAssets, 'Splash.imageset', name), splash);
    process.stdout.write(`${name}\n`);
  }
}
