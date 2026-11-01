import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");

const BACKGROUND = [0x0b, 0x0d, 0x12];
const ACCENT = [0x7c, 0x6c, 0xff];
const WHITE = [0xe6, 0xe9, 0xf2];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(size) {
  const center = (size - 1) / 2;
  const radius = size * 0.22;
  const corner = radius;

  const insideRoundedSquare = (x, y) => {
    const dx = Math.abs(x - center);
    const dy = Math.abs(y - center);
    const limit = size / 2 - size * 0.06;
    if (dx > limit || dy > limit) return false;
    const cornerX = Math.max(dx - (limit - corner), 0);
    const cornerY = Math.max(dy - (limit - corner), 0);
    return Math.hypot(cornerX, cornerY) <= corner;
  };

  return (x, y) => {
    if (!insideRoundedSquare(x, y)) return [0, 0, 0, 0];

    const mix = (y / size) * 0.55;
    const base = BACKGROUND.map((channel, index) =>
      Math.round(channel + (ACCENT[index] - channel) * mix * 0.35),
    );

    const wifiCenterY = size * 0.68;
    const dx = x - center;
    const dy = wifiCenterY - y;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(Math.abs(dx), dy);

    const dot = distance <= size * 0.055;
    const ring = [0.19, 0.3, 0.41].some(
      (r) => Math.abs(distance - size * r) <= size * 0.045 && angle <= 0.85,
    );

    if (dot || ring) return [...WHITE, 255];
    return [...base, 255];
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, png(size, render(size)));
  console.log(`wrote ${file}`);
}
