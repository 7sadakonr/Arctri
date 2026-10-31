// Packs the Figma app icon (build/icon-src, exported from "Arctri / App icon Black") into build/icon.png and build/icon.ico.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const src = (name) => readFileSync(`build/icon-src/${name}`);
const size = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

const bigPng = src('app-icon-1024.png'); // macOS builds an .icns from the 1024px PNG
const pngData = src('app-icon-256.png'); // ICO holds the 256px PNG (supported since Windows Vista)
if (size(bigPng).join() !== '1024,1024' || size(pngData).join() !== '256,256') {
  throw new Error('build/icon-src must hold app-icon-1024.png (1024x1024) and app-icon-256.png (256x256)');
}

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
copyFileSync('build/icon-src/app-icon-1024.png', 'build/icon.png');
writeFileSync('build/icon.ico', Buffer.concat([header, pngData]));
console.log('icon written', pngData.length, 'bytes (ico),', bigPng.length, 'bytes (png)');
