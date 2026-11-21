import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const GREEN = [22, 163, 74, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function insideRoundedRect(x, y, size, rx) {
  const cx = Math.min(x, size - 1 - x);
  const cy = Math.min(y, size - 1 - y);
  if (cx >= rx || cy >= rx) return true;
  const dx = rx - cx;
  const dy = rx - cy;
  return dx * dx + dy * dy <= rx * rx;
}

function drawAny(size) {
  const rx = Math.round(size * 0.22);
  const bars = [
    { y: 0.32, w: 0.52, h: 0.09 },
    { y: 0.5, w: 0.4, h: 0.09 },
    { y: 0.68, w: 0.28, h: 0.09 }
  ];
  return encodePng(size, size, (x, y) => {
    if (!insideRoundedRect(x, y, size, rx)) return CLEAR;
    for (const bar of bars) {
      const barH = Math.round(size * bar.h);
      const barW = Math.round(size * bar.w);
      const barY = Math.round(size * bar.y);
      const startX = Math.round((size - barW) / 2);
      if (Math.abs(y - barY) <= barH / 2 && x >= startX && x < startX + barW) {
        return WHITE;
      }
    }
    return GREEN;
  });
}

function drawMaskable(size) {
  const bars = [
    { y: 0.35, w: 0.6, h: 0.1 },
    { y: 0.52, w: 0.46, h: 0.1 },
    { y: 0.69, w: 0.32, h: 0.1 }
  ];
  return encodePng(size, size, (x, y) => {
    for (const bar of bars) {
      const barH = Math.round(size * bar.h);
      const barW = Math.round(size * bar.w);
      const barY = Math.round(size * bar.y);
      const startX = Math.round((size - barW) / 2);
      if (Math.abs(y - barY) <= barH / 2 && x >= startX && x < startX + barW) {
        return WHITE;
      }
    }
    return GREEN;
  });
}

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), drawAny(size));
  writeFileSync(join(outDir, `icon-maskable-${size}.png`), drawMaskable(size));
}

writeFileSync(join(outDir, "icon-512.png"), drawAny(512));
console.log("icons generated in public/icons");
