#!/usr/bin/env node
/**
 * The app's mark, drawn rather than drawn *on*.
 *
 * A desktop app is a row in a dock, a tile in a Start menu and a line in an
 * installer before it is ever a window, and until this script existed all three
 * showed Create React App's React atom — the scaffold's logo, on a household's
 * ledger. The window said "Canopy Budget" and everything around it said
 * something else.
 *
 * **It is a script and not a checked-in binary somebody once exported**, for
 * the reason the palette lives in `tailwind.config.js` rather than in a
 * stylesheet: the icon is made of the app's own colours, and when one of them
 * moves the icon has to move with it. The output *is* committed — a build must
 * not depend on this having been run — but it is reproducible from here, and
 * the diff on the source of a shape is a line of code rather than a wall of
 * base64.
 *
 * No image library: `zlib` is in Node and a PNG is a header, one deflated
 * block of scanlines and a checksum. Adding a dependency to draw four
 * rectangles would be the larger thing to maintain.
 *
 *     node buildResources/makeIcon.js
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------------------------------------------------------------------------
// The palette, from `tailwind.config.js`
//
// Copied rather than imported because that file is an ESM-ish Tailwind config
// read by PostCSS, and this script runs before anything is built. **If one of
// these moves there, move it here** — the icon is the app's colours or it is
// nothing.
// ---------------------------------------------------------------------------
const PANEL = "#0A3749"; // the chrome the app sits on
const SHEET = "#D3EBE9"; // the light data body, and so the page
const BAND = "#99D1CE"; // the header band over a table
const INK_SOFT = "#245361"; // a label on the sheet
const AZURE = "#599CAA"; // a figure
const VERDANT = "#2AA889"; // money in

/**
 * Drawn four times larger than it is written out, then averaged down.
 *
 * Coverage inside the shapes is a plain in/out test — a rounded corner at one
 * sample per pixel is a staircase, and this is what turns it into an edge. Four
 * is where the cost stops being visible: sixteen samples a pixel, on an image
 * small enough that the whole thing is a few megabytes.
 */
const SCALE = 4;

/** The mark, described once at 512 and scaled to whatever is asked for. */
const SIZE = 512;

function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * A canvas of straight RGB with no alpha channel.
 *
 * The mark is opaque to its own rounded edge and the corners outside it are
 * transparent, so the only alpha in the image is the one the background shape
 * writes. Tracked as a separate coverage plane rather than as premultiplied
 * colour, because averaging premultiplied edges is what makes downsampled
 * corners look dirty.
 */
function canvas(size) {
  return {
    size,
    rgb: new Float64Array(size * size * 3),
    alpha: new Float64Array(size * size),
  };
}

/** Whether a point is inside a rectangle whose corners are quarter-circles. */
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) return true;

  // The corner a point is nearest, clamped into the rectangle's inner box. Only
  // a point outside that box is close enough to a corner for the arc to matter.
  const cx = Math.min(Math.max(px, x + radius), x + w - radius);
  const cy = Math.min(Math.max(py, y + radius), y + h - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Paint a rounded rectangle over whatever is already there.
 *
 * Source-over onto an opaque-or-empty canvas: inside the shape the pixel simply
 * becomes this colour. Every shape in the mark is opaque, so there is no
 * blending to get wrong — the only softness in the finished image comes from
 * the averaging at the end.
 */
function fill(target, { x, y, w, h, r = 0, color }) {
  const [red, green, blue] = parseHex(color);

  const from = Math.max(0, Math.floor(y));
  const to = Math.min(target.size, Math.ceil(y + h));
  const left = Math.max(0, Math.floor(x));
  const right = Math.min(target.size, Math.ceil(x + w));

  for (let py = from; py < to; py += 1) {
    for (let px = left; px < right; px += 1) {
      // Sampled at the pixel's centre, which is what keeps a shape placed on a
      // whole number from covering one row more than it should.
      if (!insideRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
      const i = py * target.size + px;
      target.rgb[i * 3] = red;
      target.rgb[i * 3 + 1] = green;
      target.rgb[i * 3 + 2] = blue;
      target.alpha[i] = 1;
    }
  }
}

/**
 * The mark itself: a page of figures on the app's own chrome.
 *
 * Deliberately three rows and not six. This is read at sixteen pixels in a task
 * bar far more often than at five hundred in an installer, and at that size the
 * only things that survive are the page, the band across its top and the fact
 * that the right-hand column is coloured — which is exactly what the app looks
 * like. A denser drawing reads as grey mush at the size that matters most.
 *
 * Coordinates are written against a 512 grid for legibility and scaled on the
 * way in, so the same description serves the installer's icon and the favicon.
 */
function drawMark(size) {
  const target = canvas(size);
  const k = size / SIZE;
  const at = (box) => ({
    ...box,
    x: box.x * k,
    y: box.y * k,
    w: box.w * k,
    h: box.h * k,
    r: (box.r ?? 0) * k,
  });

  // The tile. Rounded rather than square so it reads as an app icon on every
  // platform, including the two that would round it themselves anyway.
  fill(target, at({ x: 0, y: 0, w: 512, h: 512, r: 104, color: PANEL }));

  // The page, and the header band across the top of it. The band is drawn
  // first and full-height-rounded, then the sheet is laid over its lower half —
  // which is what gives the band square bottom corners and round top ones
  // without a second shape primitive to maintain.
  fill(target, at({ x: 104, y: 72, w: 304, h: 96, r: 20, color: BAND }));
  fill(target, at({ x: 104, y: 124, w: 304, h: 316, r: 20, color: SHEET }));

  // Three rows: a label on the left, a figure on the right. The figures are
  // ragged on their left edge because that is what a column of money looks
  // like, and the middle one is `verdant` for the same reason it is everywhere
  // else in the app — money coming in.
  const rows = [
    { top: 186, label: 104, figure: 96, color: AZURE },
    { top: 270, label: 128, figure: 64, color: VERDANT },
    { top: 354, label: 88, figure: 112, color: AZURE },
  ];

  for (const row of rows) {
    fill(target, at({ x: 140, y: row.top, w: row.label, h: 26, r: 13, color: INK_SOFT }));
    fill(
      target,
      at({
        x: 372 - row.figure,
        y: row.top,
        w: row.figure,
        h: 26,
        r: 13,
        color: row.color,
      })
    );
  }

  return target;
}

/** Average each block of `SCALE`² samples down to one finished pixel. */
function downsample(source, size) {
  const out = Buffer.alloc(size * size * 4);
  const samples = SCALE * SCALE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const i = (y * SCALE + sy) * source.size + (x * SCALE + sx);
          red += source.rgb[i * 3];
          green += source.rgb[i * 3 + 1];
          blue += source.rgb[i * 3 + 2];
          alpha += source.alpha[i];
        }
      }

      const p = (y * size + x) * 4;
      // Divided by the covered samples rather than by all of them: a corner
      // pixel that is half background must take that background's colour at
      // half alpha, not a colour darkened toward black by the empty half.
      const covered = alpha || 1;
      out[p] = Math.round(red / covered);
      out[p + 1] = Math.round(green / covered);
      out[p + 2] = Math.round(blue / covered);
      out[p + 3] = Math.round((alpha / samples) * 255);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 8-bit RGBA, no interlacing, every scanline filtered as "none".
 *
 * The filters exist to help the deflate stream find patterns in photographs.
 * This image is flat colour in straight runs, which deflate already compresses
 * to almost nothing, so choosing a filter per row would buy a few hundred bytes
 * in exchange for the part of a PNG encoder that is actually easy to get wrong.
 */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * An `.ico` holding PNGs rather than the old bitmap-plus-mask format.
 *
 * Windows has read PNG-compressed icon entries since Vista and every browser
 * reads them in a favicon, which makes the directory a 6-byte header, a 16-byte
 * entry per size, and the PNGs this script already knows how to write.
 *
 * Several sizes and not one: Windows picks the entry nearest the size it wants,
 * and letting it downscale 256 down to 16 is what turns a legible mark into
 * grey fringe.
 */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    // 256 is written as 0, which is the format's way of saying "the big one".
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // colours in the palette — none, it is truecolour
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    // Little-endian throughout the directory, unlike the PNGs it points at,
    // which are big-endian inside. The two formats simply disagree.
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function render(size) {
  return encodePng(downsample(drawMark(size * SCALE), size), size);
}

function main() {
  const root = path.join(__dirname, "..");
  const write = (file, buffer) => {
    fs.writeFileSync(file, buffer);
    console.log(`${path.relative(root, file).replace(/\\/g, "/")}  ${buffer.length} bytes`);
  };

  // The packager's icon. 512 because that is the size electron-builder wants to
  // derive every platform's format from.
  write(path.join(__dirname, "icon.png"), render(512));

  // The web build's, kept in step because the two builds are one app — the
  // browser tab and the dock should not show different marks.
  write(path.join(root, "public", "logo512.png"), render(512));
  write(path.join(root, "public", "logo192.png"), render(192));
  write(
    path.join(root, "public", "favicon.ico"),
    encodeIco([16, 32, 48, 64].map((size) => ({ size, png: render(size) })))
  );
}

main();
