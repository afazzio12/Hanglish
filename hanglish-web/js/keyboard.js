// The Hanglish keyboard for the web: preview strip, three stages, 123 page and function rows.
import { Stage } from './core.js';
import { positionText, drawText, drawGlyphCentered, rowBand } from './render.js';

const KEY_GLYPH_SCALE = 0.088; // CSS px per font unit on keycaps

const svg = (body, w = 30, h = 26) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  stage: (s) => svg(`<rect x="6" y="2" width="18" height="22" rx="3.5"/><rect x="9.5" y="${[5.5, 10.5, 15.5][s - 1]}" width="11" height="5" rx="1" fill="currentColor" stroke="none"/>`),
  nextBlock: svg('<rect x="2" y="2" width="11" height="22" rx="2.5"/><rect x="17" y="2" width="11" height="22" rx="2.5" stroke-dasharray="2.6 2.2" stroke-width="1.6"/>'),
  delete: svg('<path d="M3 13 9 5h18v16H9z"/><path d="M14 9.5l7 7M21 9.5l-7 7"/>'),
  image: svg('<rect x="3" y="4" width="24" height="18" rx="2.5"/><path d="M3 19l8-7 6 5 4-3 6 5"/><circle cx="20" cy="9" r="2" fill="currentColor" stroke="none"/>'),
  return: svg('<path d="M24 5v10H5"/><path d="M10 10l-5 5 5 5"/>'),
};

export class Keyboard {
  /**
   * @param root   element to build into
   * @param data   FontData
   * @param composer Composer
   * @param on     { change(), image() }
   */
  constructor(root, data, composer, on) {
    this.root = root;
    this.data = data;
    this.composer = composer;
    this.on = on;
    this.showingNumbers = false;
    this.consonantKeys = [];
    this.markKeys = [];
    this.stageKeys = new Map();
    this.glyphKeys = [];
    this.build();
    this.refresh();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.drawGlyphKeys(); this.refresh(); });
  }

  // MARK: Building

  build() {
    const r = this.root;
    r.classList.add('kb');
    r.innerHTML = `
      <div class="kb-preview"><div class="kb-preview-scroll"><canvas></canvas></div><div class="kb-flash" aria-live="polite"></div></div>
      <div class="kb-keys">
        <div class="kb-page" data-page="consonants"></div>
        <div class="kb-page" data-page="vowels"></div>
        <div class="kb-page" data-page="numbers"></div>
      </div>
      <div class="kb-fn kb-fn1"></div>
      <div class="kb-fn kb-fn2"></div>`;
    this.previewScroll = r.querySelector('.kb-preview-scroll');
    this.previewCanvas = r.querySelector('.kb-preview canvas');
    this.flashEl = r.querySelector('.kb-flash');
    this.pages = Object.fromEntries([...r.querySelectorAll('.kb-page')].map((p) => [p.dataset.page, p]));

    const d = this.data;
    const tints = ['t-stop', 't-fric', 't-nasal'];
    d.consonantRows.forEach((ids, i) => {
      this.row(this.pages.consonants, 9, 0, ids.map((id) => {
        const k = this.glyphKey(`on10_${id}`, tints[i], d.phonemes.get(id)?.example);
        this.tap(k, () => this.edit((c) => c.consonant(id)));
        this.consonantKeys.push(k);
        return k;
      }));
    });

    const vowelKey = (id, tint) => {
      const k = this.glyphKey(`v_${id}`, tint, d.phonemes.get(id)?.example);
      this.tap(k, () => this.edit((c) => c.vowel(id)));
      return k;
    };
    this.row(this.pages.vowels, 5, 10, d.vowels.slice(0, 5).map((v) => vowelKey(v, 't-vowel')));
    this.row(this.pages.vowels, 5, 10, d.vowels.slice(5).map((v) => vowelKey(v, 't-vowel')));
    this.row(this.pages.vowels, 5, 10, d.diphthongs.map((v) => vowelKey(v, 't-diph')));
    this.row(this.pages.vowels, 3, 30, [['pl', 'plural'], ['past', 'past'], ['poss', 'possessive']].map(([m, label]) => {
      const k = this.glyphKey(`mark_${m}`, 't-mark', label, true);
      this.tap(k, () => this.edit((c) => c.mark(m)));
      this.markKeys.push(k);
      return k;
    }));

    const numKey = (s) => {
      const k = this.key('t-stop', s);
      k.innerHTML = `<span class="kb-label">${s.replace('"', '&quot;')}</span>`;
      this.tap(k, () => this.edit((c) => c.punctuation(s)));
      return k;
    };
    this.row(this.pages.numbers, 10, 0, [...'1234567890'].map(numKey));
    this.row(this.pages.numbers, 8, 0, ['.', ',', '?', '!', "'", '"'].map(numKey));
    this.row(this.pages.numbers, 8, 0, ['-', ':', ';', '(', ')'].map(numKey));

    // Function row 1: stage 1, stage 2, stage 3, next block, delete.
    const fn1 = r.querySelector('.kb-fn1');
    for (const s of [Stage.TOP, Stage.MIDDLE, Stage.BOTTOM]) {
      const k = this.key('t-fn', `Stage ${s}`, ICONS.stage(s));
      this.tap(k, () => { this.showingNumbers = false; this.edit((c) => c.setStage(s)); });
      this.stageKeys.set(s, k);
      fn1.append(k);
    }
    const next = this.key('t-fn', 'Next block', ICONS.nextBlock);
    this.tap(next, () => this.edit((c) => c.nextBlock()));
    fn1.append(next, this.deleteKey());

    // Function row 2: 123, space, image, return.
    const fn2 = r.querySelector('.kb-fn2');
    this.numbersKey = this.key('t-fn w12', 'Numbers and punctuation');
    this.tap(this.numbersKey, () => { this.showingNumbers = !this.showingNumbers; this.refresh(); });
    const space = this.key('t-space w32', 'Space');
    this.tap(space, () => this.edit((c) => c.space(performance.now() / 1000)));
    const image = this.key('t-fn', 'Share as image', ICONS.image);
    this.tap(image, () => this.on.image());
    const ret = this.key('t-fn w12', 'New line', ICONS.return);
    this.tap(ret, () => this.edit((c) => c.lineBreak()));
    fn2.append(this.numbersKey, space, image, ret);

    this.drawGlyphKeys();
  }

  key(cls, label, html = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `kb-key ${cls}`;
    if (label) b.setAttribute('aria-label', label);
    b.innerHTML = html;
    return b;
  }

  glyphKey(name, tint, label, dashed = false) {
    const k = this.key(tint + (dashed ? ' dashed' : ''), label);
    const c = document.createElement('canvas');
    k.append(c);
    this.glyphKeys.push({ canvas: c, name });
    return k;
  }

  /** Draws each keycap glyph, cropped to its ink bounds so it centres in the key. */
  drawGlyphKeys() {
    const dpr = window.devicePixelRatio || 1;
    const ink = getComputedStyle(this.root).getPropertyValue('--kb-ink').trim() || '#1c1c20';
    for (const { canvas, name } of this.glyphKeys) {
      const b = this.data.bounds.get(name);
      if (!b) continue;
      const w = (b.xMax - b.xMin) * KEY_GLYPH_SCALE;
      const h = (b.yMax - b.yMin) * KEY_GLYPH_SCALE;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      drawGlyphCentered(ctx, this.data, name, w / 2, h / 2, KEY_GLYPH_SCALE, ink);
    }
  }

  row(page, cols, insetPx, keys) {
    const row = document.createElement('div');
    row.className = 'kb-row';
    row.style.setProperty('--cols', cols);
    row.style.setProperty('--inset', `${insetPx}px`);
    row.append(...keys);
    page.append(row);
  }

  /** Acts on release inside the key, like a native keyboard; shows the pressed state. */
  tap(el, action) {
    el.addEventListener('pointerdown', (e) => { el.classList.add('down'); el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointerup', (e) => {
      const was = el.classList.contains('down');
      el.classList.remove('down');
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (was && inside && !el.disabled) action();
    });
    el.addEventListener('pointercancel', () => el.classList.remove('down'));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  deleteKey() {
    const k = this.key('t-fn', 'Delete', ICONS.delete);
    let delay = null, repeat = null;
    const stop = () => { clearTimeout(delay); clearInterval(repeat); k.classList.remove('down'); };
    k.addEventListener('pointerdown', (e) => {
      k.classList.add('down');
      k.setPointerCapture?.(e.pointerId);
      this.performDelete();
      delay = setTimeout(() => { repeat = setInterval(() => this.performDelete(), 80); }, 450);
    });
    k.addEventListener('pointerup', stop);
    k.addEventListener('pointercancel', stop);
    k.addEventListener('contextmenu', (e) => e.preventDefault());
    return k;
  }

  // MARK: Actions

  edit(change) {
    change(this.composer);
    this.refresh();
    this.on.change();
  }

  performDelete() {
    const result = this.composer.delete();
    if (result === 'removed') this.showingNumbers = false;
    this.refresh();
    this.on.change();
  }

  /** Brief icon over the preview strip: 'sent', 'copied', 'empty' or 'failed'. */
  flash(kind) {
    const el = this.flashEl;
    el.className = `kb-flash show ${kind}`;
    el.textContent = '';
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { el.className = 'kb-flash'; }, 1300);
  }

  // MARK: Redraw

  refresh() {
    const c = this.composer;
    const stage = c.stage;
    const show = (name, on) => { this.pages[name].hidden = !on; };
    show('consonants', !this.showingNumbers && stage !== Stage.MIDDLE);
    show('vowels', !this.showingNumbers && stage === Stage.MIDDLE);
    show('numbers', this.showingNumbers);
    for (const k of this.consonantKeys) k.disabled = !c.canAddConsonant;
    for (const k of this.markKeys) k.disabled = !c.canAddMark;
    for (const [s, k] of this.stageKeys) k.classList.toggle('active', !this.showingNumbers && s === stage);
    this.numbersKey.innerHTML = this.showingNumbers ? ICONS.stage(stage) : '<span class="kb-label small">123</span>';
    this.numbersKey.setAttribute('aria-label', this.showingNumbers ? 'Back to letters' : 'Numbers and punctuation');
    this.drawPreview();
  }

  /** The message so far on one line, current block outlined, row being filled highlighted. */
  drawPreview() {
    const d = this.data;
    const canvas = this.previewCanvas;
    const height = this.previewScroll.clientHeight || 58;
    const viewWidth = this.previewScroll.clientWidth || 300;
    const vMargin = 6, left = 14;
    const scale = (height - 2 * vMargin) / d.cellHeight;
    const text = positionText(d, this.composer.displayTokens, { emptyBlocksTakeSpace: true });
    const width = Math.max(viewWidth, Math.ceil(2 * left + text.width * scale));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(this.root);
    const ink = css.getPropertyValue('--kb-ink').trim();

    const f = text.unitFrames[text.unitFrames.length - 1];
    let box = null;
    if (f) {
      const pad = 40 * scale;
      box = { x: left + f.minX * scale - pad, y: vMargin - 3, w: (f.maxX - f.minX) * scale + 2 * pad, h: height - 2 * vMargin + 6 };
      if (!this.showingNumbers) {
        const [lo, hi] = rowBand(d, this.composer.stage);
        const y0 = Math.max(vMargin + (d.cellTop - hi) * scale, box.y + 1);
        const y1 = Math.min(vMargin + (d.cellTop - lo) * scale, box.y + box.h - 1);
        ctx.fillStyle = css.getPropertyValue('--kb-row-highlight').trim();
        ctx.fillRect(box.x + 1, y0, box.w - 2, y1 - y0);
      }
      ctx.strokeStyle = '#2f6fed';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.roundRect(box.x + 0.75, box.y + 0.75, box.w - 1.5, box.h - 1.5, 5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.25;
    for (const x of text.lineBreaks) ctx.fillRect(left + x * scale, vMargin + 8, 1, height - 2 * vMargin - 16);
    ctx.globalAlpha = 1;
    drawText(ctx, d, text, left, vMargin, scale, ink);

    // Keep the current block in view.
    if (box) {
      const s = this.previewScroll;
      if (box.x + box.w + 12 > s.scrollLeft + s.clientWidth) s.scrollLeft = box.x + box.w + 12 - s.clientWidth;
      else if (box.x - 12 < s.scrollLeft) s.scrollLeft = Math.max(0, box.x - 12);
    }
  }
}
