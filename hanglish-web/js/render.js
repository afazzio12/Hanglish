// Drawing Hanglish text with the Syllabary Serif font on a canvas (preview strip, keycaps, PNG).
import { Encoder } from './core.js';

export const FONT_FAMILY = 'HanglishSyllabary';

/** Loads the font file and makes it available to canvases. */
export async function loadFont(url) {
  const face = new FontFace(FONT_FAMILY, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  return face;
}

const measureCtx = document.createElement('canvas').getContext('2d');

/** Advance of a normal character, in font units. */
function advance(data, ch) {
  measureCtx.font = `${data.unitsPerEm}px "${FONT_FAMILY}"`;
  return measureCtx.measureText(ch).width;
}

/** Composed text as positioned glyphs on one baseline, in font units. */
export function positionText(data, tokens, { emptyBlocksTakeSpace = false, lineBreakAdvance = 600 } = {}) {
  const layout = new Encoder(data).layout(tokens, emptyBlocksTakeSpace);
  const glyphs = [];
  const xAt = [];
  const lineBreaks = [];
  let x = 0;
  layout.glyphs.forEach((g, i) => {
    xAt[i] = x;
    if (g.name !== undefined) {
      if (g.name.startsWith('sp')) x += Number(g.name.slice(2));
      else { const t = data.text(g.name); if (t) glyphs.push({ text: t, x }); }
    } else if (g.char === '\n') {
      lineBreaks.push(x + lineBreakAdvance / 2);
      x += lineBreakAdvance;
    } else {
      glyphs.push({ text: g.char, x });
      x += advance(data, g.char);
    }
  });
  xAt[layout.glyphs.length] = x;
  const unitFrames = layout.placements.map((p) => ({ minX: xAt[p.glyphIndex] + p.x0, maxX: xAt[p.glyphIndex] + p.x1 }));
  return { glyphs, width: x, unitFrames, lineBreaks };
}

/** Draws positioned text; (left, top) is the top-left of the block cell, scale = px per font unit. */
export function drawText(ctx, data, positioned, left, top, scale, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${data.unitsPerEm * scale}px "${FONT_FAMILY}"`;
  const baseline = top + data.cellTop * scale;
  for (const g of positioned.glyphs) ctx.fillText(g.text, left + g.x * scale, baseline);
  ctx.restore();
}

/** Draws one glyph centred on its ink bounds at (cx, cy). */
export function drawGlyphCentered(ctx, data, name, cx, cy, scale, color) {
  const text = data.text(name);
  const b = data.bounds.get(name);
  if (!text || !b) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${data.unitsPerEm * scale}px "${FONT_FAMILY}"`;
  ctx.fillText(text, cx - ((b.xMin + b.xMax) / 2) * scale, cy + ((b.yMin + b.yMax) / 2) * scale);
  ctx.restore();
}

/** The vertical band (font units, y up) of a block row, for the row highlight. */
export function rowBand(data, stage) {
  const prefix = stage === 1 ? 'on' : stage === 2 ? 'v_' : 'co';
  let lo = Infinity, hi = -Infinity;
  for (const [n, b] of data.bounds) if (n.startsWith(prefix)) { lo = Math.min(lo, b.yMin); hi = Math.max(hi, b.yMax); }
  return [lo - 25, hi + 25];
}

// MARK: Message image

export const IMAGE_STYLE = { pixelsPerEm: 160, maxLineWidth: 1800, padding: 110, lineGap: 320, ink: '#1c1c21', background: '#ffffff' };

/** Visual lines: split at line breaks, and between words when a line gets too wide. */
export function wrap(data, tokens, maxWidthUnits) {
  const paragraphs = [[]];
  for (const t of tokens) if (t.br) paragraphs.push([]); else paragraphs[paragraphs.length - 1].push(t);
  const lines = [];
  for (const para of paragraphs) {
    let line = [];
    for (const word of para) {
      const candidate = [...line, word];
      if (line.length && positionText(data, candidate).width > maxWidthUnits) { lines.push(line); line = [word]; }
      else line = candidate;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

/** Renders the message to a canvas: dark text on white, padded, wrapped. Null if empty. */
export function messageCanvas(data, tokens, style = IMAGE_STYLE) {
  const scale = style.pixelsPerEm / data.unitsPerEm;
  const lines = wrap(data, tokens, style.maxLineWidth / scale).map((l) => positionText(data, l));
  const contentWidth = Math.max(0, ...lines.map((l) => l.width));
  if (contentWidth <= 0) return null;
  const lineHeight = (data.cellHeight + style.lineGap) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(contentWidth * scale + 2 * style.padding);
  canvas.height = Math.ceil(lines.length * lineHeight - style.lineGap * scale + 2 * style.padding);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  lines.forEach((l, i) => drawText(ctx, data, l, style.padding, style.padding + i * lineHeight, scale, style.ink));
  return canvas;
}

/** PNG as a Blob, made synchronously (keeps the tap's permission for share / copy on iPhone). */
export function canvasToPngBlob(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  const bytes = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}
