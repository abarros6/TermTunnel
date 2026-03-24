#!/usr/bin/env node
// Generates public/icon.png for TermTunnel.
// Uses only Node.js built-ins — no external dependencies.
// Usage: node scripts/generate-icon.js [--color=#0a0e14] [--output=public/icon.png]

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args    = process.argv.slice(2);
const bgHex   = args.find(a => a.startsWith('--color='))?.slice(8)  ?? '#0a0e14';
const outRel  = args.find(a => a.startsWith('--output='))?.slice(9) ?? 'public/icon.png';
const outPath = resolve(__dirname, '..', outRel);

function hexToRgb(hex) {
  const h = hex.replace(/^#/, '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

const SIZE = 180;
const CORNER = 28;   // rounded corner radius
const THICK  = 11;   // stroke width for >_
const AA     = 1.0;  // anti-alias softness

const [bgR, bgG, bgB] = hexToRgb(bgHex);
const [fgR, fgG, fgB] = [0, 255, 159]; // #00ff9f — app green

// ── Shape helpers ─────────────────────────────────────────────────────────────

function inRoundedRect(x, y) {
  const x1 = CORNER, x2 = SIZE - CORNER - 1;
  const y1 = CORNER, y2 = SIZE - CORNER - 1;
  if (x < x1 && y < y1) return Math.hypot(x - x1, y - y1) <= CORNER;
  if (x > x2 && y < y1) return Math.hypot(x - x2, y - y1) <= CORNER;
  if (x < x1 && y > y2) return Math.hypot(x - x1, y - y2) <= CORNER;
  if (x > x2 && y > y2) return Math.hypot(x - x2, y - y2) <= CORNER;
  return true;
}

// Distance from (px,py) to line segment (x0,y0)→(x1,y1)
function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1-x0, dy = y1-y0;
  const t  = Math.max(0, Math.min(1, ((px-x0)*dx + (py-y0)*dy) / (dx*dx + dy*dy)));
  return Math.hypot(px - (x0 + t*dx), py - (y0 + t*dy));
}

// ── Render pixels ─────────────────────────────────────────────────────────────
// >_ coordinates scaled from the original 512×512 SVG (font-size 260, x=80, baseline y=340)
// to 180×180 (scale ≈ 0.352)

// > chevron: top-left → right-tip → bottom-left
const GX0 = 26, GY0 = 30,   // top-left
      GX1 = 70, GY1 = 80,   // right tip (mid-height)
      GX2 = 26, GY2 = 130;  // bottom-left

// _ underline
const UX0 = 78,  UY = 127,
      UX1 = 148;

const rgba = new Uint8Array(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;

    if (!inRoundedRect(x, y)) {
      rgba[i+3] = 0; // transparent outside rounded rect
      continue;
    }

    // Background
    rgba[i] = bgR; rgba[i+1] = bgG; rgba[i+2] = bgB; rgba[i+3] = 255;

    // Distance to nearest part of the >_ symbol
    const d = Math.min(
      segDist(x, y, GX0, GY0, GX1, GY1),
      segDist(x, y, GX1, GY1, GX2, GY2),
      segDist(x, y, UX0, UY,  UX1, UY),
    );

    const half = THICK / 2;
    if (d < half - AA) {
      // Fully inside stroke
      rgba[i] = fgR; rgba[i+1] = fgG; rgba[i+2] = fgB;
    } else if (d < half + AA) {
      // Anti-aliased edge
      const a = (half + AA - d) / (2 * AA);
      rgba[i]   = Math.round(fgR * a + bgR * (1-a));
      rgba[i+1] = Math.round(fgG * a + bgG * (1-a));
      rgba[i+2] = Math.round(fgB * a + bgB * (1-a));
    }
  }
}

// ── PNG encode (built-ins only) ───────────────────────────────────────────────

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let k = 8; k--;) c = c>>>1 ^ (c&1 ? 0xEDB88320 : 0); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const crcBuf = Buffer.concat([t, d]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, d, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, no interlace

// Raw scanlines: 1 filter byte (0 = None) + width×4 bytes per row
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter type: None
  for (let x = 0; x < SIZE; x++) {
    const s = (y * SIZE + x) * 4;
    const d = rowStart + 1 + x * 4;
    raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
  }
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
process.stdout.write(`icon written → ${outPath} (${png.length} bytes)\n`);
