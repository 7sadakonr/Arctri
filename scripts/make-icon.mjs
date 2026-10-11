// Draws Arctri's own icon (no third-party artwork) and writes build/icon.png and build/icon.ico.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Draws the icon at N x N pixels (everything is laid out on a 256 grid and scaled). */
function draw(N) {
  const px = new Uint8Array(N * N * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * N + x) * 4;
    const sa = a / 255;
    const da = px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    px[i] = (r * sa + px[i] * da * (1 - sa)) / oa;
    px[i + 1] = (g * sa + px[i + 1] * da * (1 - sa)) / oa;
    px[i + 2] = (b * sa + px[i + 2] * da * (1 - sa)) / oa;
    px[i + 3] = oa * 255;
  };

  // rounded square with a vertical gradient
  const R = 56 * (N / 256);
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, R), N - 1 - R);
    const cy = Math.min(Math.max(y, R), N - 1 - R);
    return Math.hypot(x - cx, y - cy) <= R;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!inside(x, y)) continue;
      const t = y / N;
      set(x, y, 20 + 12 * t, 22 + 14 * t, 32 + 26 * t);
    }
  }

  // a chevron ">" and a cursor bar, drawn as thick line segments with soft edges
  const seg = (x0, y0, x1, y1, w, [r, g, b]) => {
    const minX = Math.floor(Math.min(x0, x1) - w), maxX = Math.ceil(Math.max(x0, x1) + w);
    const minY = Math.floor(Math.min(y0, y1) - w), maxY = Math.ceil(Math.max(y0, y1) + w);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N || !inside(x, y)) continue;
        const dx = x1 - x0, dy = y1 - y0;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
        const a = Math.max(0, Math.min(1, w / 2 - d + 0.5));
        if (a > 0) set(x, y, r, g, b, a * 255);
      }
    }
  };
  const accent = [122, 162, 255];
  const k = N / 256;
  seg(78 * k, 80 * k, 140 * k, 128 * k, 26 * k, accent);
  seg(140 * k, 128 * k, 78 * k, 176 * k, 26 * k, accent);
  seg(158 * k, 178 * k, 196 * k, 178 * k, 22 * k, [215, 218, 227]);
  return px;
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ICO containing the 256px PNG (supported since Windows Vista); the PNG is 1024px because macOS builds an .icns from it
const N = 256;
const pngData = png(N, N, draw(N));
const bigPng = png(1024, 1024, draw(1024));
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0; // 256
header[7] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(pngData.length, 14);
header.writeUInt32LE(22, 18);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', bigPng);
writeFileSync('build/icon.ico', Buffer.concat([header, pngData]));
console.log('icon written', pngData.length, 'bytes (ico),', bigPng.length, 'bytes (png)');
