/**
 * Regenerates the extension icons from assets/icon.png. Decodes the source PNG,
 * area-averages it down to each target size, and re-encodes RGBA PNGs so the
 * browser extension ships the same artwork without an image dependency.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, '..', 'assets', 'icon.png');
const outDir = join(root, '..', 'extension', 'icons');
const SIZES = [16, 48, 128];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const parts = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || interlace !== 0 || channels === 0) {
    throw new Error(
      `unsupported PNG: depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`,
    );
  }

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const value =
        filter === 1
          ? line[i] + left
          : filter === 2
            ? line[i] + up
            : filter === 3
              ? line[i] + Math.floor((left + up) / 2)
              : filter === 4
                ? line[i] + paeth(left, up, upLeft)
                : filter === 0
                  ? line[i]
                  : Number.NaN;
      if (Number.isNaN(value)) throw new Error(`unsupported PNG filter ${filter}`);
      current[i] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = current[from];
      pixels[to + 1] = current[from + 1];
      pixels[to + 2] = current[from + 2];
      pixels[to + 3] = channels === 4 ? current[from + 3] : 255;
    }

    previous = current;
  }

  return { width, height, pixels };
}

function resize({ width, height, pixels }, size) {
  const output = Buffer.alloc(size * size * 4);

  for (let ty = 0; ty < size; ty += 1) {
    const top = (ty * height) / size;
    const bottom = ((ty + 1) * height) / size;

    for (let tx = 0; tx < size; tx += 1) {
      const left = (tx * width) / size;
      const right = ((tx + 1) * width) / size;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let area = 0;

      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy += 1) {
        const weightedY = Math.min(bottom, sy + 1) - Math.max(top, sy);

        for (let sx = Math.floor(left); sx < Math.ceil(right); sx += 1) {
          const weightedX = Math.min(right, sx + 1) - Math.max(left, sx);
          const weight = weightedX * weightedY;
          const at = (sy * width + sx) * 4;
          const coverage = pixels[at + 3] / 255;

          red += pixels[at] * coverage * weight;
          green += pixels[at + 1] * coverage * weight;
          blue += pixels[at + 2] * coverage * weight;
          alpha += pixels[at + 3] * weight;
          area += weight;
        }
      }

      const at = (ty * size + tx) * 4;
      const coverage = alpha / area;
      const scale = coverage === 0 ? 0 : 255 / coverage;
      output[at] = Math.round((red / area) * scale);
      output[at + 1] = Math.round((green / area) * scale);
      output[at + 2] = Math.round((blue / area) * scale);
      output[at + 3] = Math.round(coverage);
    }
  }

  return output;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icon = decodePng(await readFile(source));

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, resize(icon, size));
  await writeFile(join(outDir, `icon${size}.png`), png);
  console.log(`icons/icon${size}.png (${png.length} bytes)`);
}
