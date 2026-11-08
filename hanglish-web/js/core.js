// Hanglish core for the web: font data, encoder and composition state machine.
// Same behaviour as the Swift and Kotlin cores, and checked against the same test vectors.
// UI-free: runs in the browser and in Node (for the tests).

export const Stage = Object.freeze({ TOP: 1, MIDDLE: 2, BOTTOM: 3 });
export const MARKS = Object.freeze({ pl: 'mark_pl', past: 'mark_past', poss: 'mark_poss' });
export const MAX_ONSET = 3;
export const MAX_CODA = 4;
const SPACER_STEP = 10;
const SPACER_MAX = 1500;

/** Everything the core needs from syllabary-font-data.json (already parsed). */
export class FontData {
  constructor(json) {
    this.familyName = json.font.familyName;
    this.unitsPerEm = json.font.unitsPerEm;
    this.cellBottom = json.font.cellYRange[0];
    this.cellTop = json.font.cellYRange[1];
    this.codepoints = new Map(Object.entries(json.codepoints).map(([n, u]) => [n, parseInt(u.slice(2), 16)]));
    this.bounds = new Map(Object.entries(json.glyphBounds_xMin_yMin_xMax_yMax)
      .map(([n, b]) => [n, { xMin: b[0], yMin: b[1], xMax: b[2], yMax: b[3] }]));
    this.spacing = json.spacing;
    this.phonemes = new Map(json.phonemes.map((p) => [p.id, p]));
    const g = json.keyboardGroupsInOrder;
    this.consonantRows = [g.stops, g.fricatives, g.nasals_liquids_glides];
    this.vowels = g.vowels;
    this.diphthongs = g.diphthongs;
    this.testVectors = json.testVectors ?? [];
  }

  get cellHeight() { return this.cellTop - this.cellBottom; }

  /** The one-character string for a named glyph. */
  text(name) {
    const cp = this.codepoints.get(name);
    return cp === undefined ? null : String.fromCodePoint(cp);
  }
}

// MARK: Model
// A block is { onset: [], vowel: null|string, coda: [], order: [stages typed, oldest first] }.
// A unit is { block } or { mark }. A word is { units: [], punct: '' }. A token is a word or { br: true }.

export function makeBlock(onset = [], vowel = null, coda = [], order = null) {
  return {
    onset, vowel, coda,
    order: order ?? [...onset.map(() => Stage.TOP), ...(vowel ? [Stage.MIDDLE] : []), ...coda.map(() => Stage.BOTTOM)],
  };
}

export const blockIsEmpty = (b) => b.onset.length === 0 && b.vowel === null && b.coda.length === 0;

// MARK: Encoder

export function ceil10(v) {
  const r = Math.ceil(v / SPACER_STEP) * SPACER_STEP;
  return Math.min(Math.max(r, 0), SPACER_MAX);
}

export class Encoder {
  constructor(data) { this.data = data; }

  /** Component glyph names: onsets left to right, vowel, codas left to right. */
  components(unit) {
    if (unit.mark) return [MARKS[unit.mark]];
    const b = unit.block;
    return [
      ...b.onset.map((c, i) => `on${b.onset.length}${i}_${c}`),
      ...(b.vowel ? [`v_${b.vowel}`] : []),
      ...b.coda.map((c, i) => `co${b.coda.length}${i}_${c}`),
    ];
  }

  /** Ink extent { components, x0, x1 }, widened for blocks; null if nothing to draw. */
  extent(unit) {
    const names = this.components(unit).filter((n) => this.data.bounds.has(n));
    if (names.length === 0) return null;
    let x0 = Math.min(...names.map((n) => this.data.bounds.get(n).xMin));
    let x1 = Math.max(...names.map((n) => this.data.bounds.get(n).xMax));
    if (unit.block) {
      const c = this.data.spacing.blockCenterX;
      const hw = Math.max((x1 - x0) / 2, this.data.spacing.minBlockHalfWidth);
      x0 = Math.min(x0, c - hw);
      x1 = Math.max(x1, c + hw);
    }
    return { components: names, x0, x1 };
  }

  /**
   * Glyphs plus unit placements. Glyphs are { name } or { char }. A placement is
   * { token, unit, glyphIndex, x0, x1 }. With emptyBlocksTakeSpace, an empty block is laid
   * out as a minimum-width block with no ink (the preview's current-block box).
   */
  layout(tokens, emptyBlocksTakeSpace = false) {
    const s = this.data.spacing;
    const glyphs = [];
    const placements = [];
    const spacer = (v) => glyphs.push({ name: `sp${ceil10(v)}` });
    let pen = { kind: 'start' };
    const finish = () => { if (pen.kind === 'unit') spacer(pen.x1); };

    tokens.forEach((token, t) => {
      if (token.br) {
        finish();
        glyphs.push({ char: '\n' });
        pen = { kind: 'start' };
        return;
      }
      let first = true;
      token.units.forEach((unit, u) => {
        let ext = this.extent(unit);
        if (!ext && emptyBlocksTakeSpace) {
          ext = { components: [], x0: s.blockCenterX - s.minBlockHalfWidth, x1: s.blockCenterX + s.minBlockHalfWidth };
        }
        if (!ext) return;
        let advance;
        if (pen.kind === 'start') advance = -ext.x0;
        else if (pen.kind === 'punct') advance = s.gapAfterPunctuation - ext.x0;
        else {
          const gap = unit.mark ? s.gapBeforeMark : (first ? s.gapBetweenWords : s.gapBetweenBlocksInWord);
          advance = pen.x1 - ext.x0 + gap;
        }
        spacer(advance);
        placements.push({ token: t, unit: u, glyphIndex: glyphs.length, x0: ext.x0, x1: ext.x1 });
        for (const n of ext.components) glyphs.push({ name: n });
        pen = { kind: 'unit', x1: ext.x1 };
        first = false;
      });
      if (token.punct) {
        if (pen.kind === 'unit') spacer(pen.x1 + s.gapBeforePunctuation);
        for (const ch of token.punct) glyphs.push({ char: ch });
        pen = { kind: 'punct' };
      }
    });
    finish();
    return { glyphs, placements };
  }

  glyphs(tokens) { return this.layout(tokens).glyphs; }

  /** The encoded string (Private Use Area characters plus normal characters). */
  string(tokens) {
    return this.glyphs(tokens).map((g) => (g.char ?? this.data.text(g.name) ?? '')).join('');
  }
}

export const testName = (g) => (g.char !== undefined ? `char:${g.char}` : g.name);

// MARK: Composer

/** The composition state machine behind the keyboard (same behaviour as iOS and Android). */
export class Composer {
  constructor() { this.clear(); this.doubleTapInterval = 0.3; }

  clear() {
    this.committed = [];
    this.units = [];
    this.currentBlock = makeBlock();
    this.stage = Stage.TOP;
    this.lastSpaceTap = null;
  }

  get currentWordUnits() {
    return blockIsEmpty(this.currentBlock) ? this.units : [...this.units, { block: this.currentBlock }];
  }

  /** The whole text, including the word being composed (empty current block left out). */
  get text() {
    const w = this.currentWordUnits;
    return w.length === 0 ? this.committed : [...this.committed, { units: w, punct: '' }];
  }

  /** Like text, but the current block is always the last unit of the last token, even when empty. */
  get displayTokens() {
    return [...this.committed, { units: [...this.units, { block: this.currentBlock }], punct: '' }];
  }

  get isEmpty() { return this.committed.length === 0 && this.units.length === 0 && blockIsEmpty(this.currentBlock); }

  get canAddConsonant() {
    if (this.stage === Stage.TOP) return this.currentBlock.onset.length < MAX_ONSET;
    if (this.stage === Stage.BOTTOM) return this.currentBlock.coda.length < MAX_CODA;
    return false;
  }

  get canAddMark() { return !blockIsEmpty(this.currentBlock) || this.units.length > 0; }

  setStage(s) { this.lastSpaceTap = null; this.stage = s; }

  /** Adds a consonant to the current stage's row. Stage 3 on an empty block makes a contraction. */
  consonant(id) {
    this.lastSpaceTap = null;
    if (!this.canAddConsonant) return false;
    const b = this.currentBlock;
    this.currentBlock = this.stage === Stage.TOP
      ? makeBlock([...b.onset, id], b.vowel, b.coda, [...b.order, Stage.TOP])
      : makeBlock(b.onset, b.vowel, [...b.coda, id], [...b.order, Stage.BOTTOM]);
    return true;
  }

  /** Sets or replaces the current block's vowel or diphthong. */
  vowel(id) {
    this.lastSpaceTap = null;
    const b = this.currentBlock;
    this.currentBlock = makeBlock(b.onset, id, b.coda, [...b.order.filter((s) => s !== Stage.MIDDLE), Stage.MIDDLE]);
  }

  /** Adds a mark unit after the current block; the next tap continues in a new block. */
  mark(m) {
    this.lastSpaceTap = null;
    if (!this.canAddMark) return false;
    this.#finishBlock();
    this.units = [...this.units, { mark: m }];
    this.stage = Stage.MIDDLE;
    return true;
  }

  /** One tap advances the stage (not past 3); two within doubleTapInterval (seconds) end the word. */
  space(time) {
    const last = this.lastSpaceTap;
    if (last && time >= last.time && time - last.time <= this.doubleTapInterval) {
      this.stage = last.stageBefore;
      this.endWord();
    } else {
      const before = this.stage;
      if (this.stage < Stage.BOTTOM) this.stage += 1;
      this.lastSpaceTap = { time, stageBefore: before };
    }
  }

  endWord() { this.lastSpaceTap = null; this.#commitWord(); this.stage = Stage.TOP; }

  nextBlock() { this.lastSpaceTap = null; this.#finishBlock(); this.stage = Stage.TOP; }

  /** Digits and punctuation attach after the current (or previous) word. */
  punctuation(s) {
    this.lastSpaceTap = null;
    if (!s) return;
    const last = this.committed[this.committed.length - 1];
    if (this.currentWordUnits.length > 0) this.#commitWord(s);
    else if (last && !last.br) this.committed = [...this.committed.slice(0, -1), { units: last.units, punct: last.punct + s }];
    else this.committed = [...this.committed, { units: [], punct: s }];
    this.stage = Stage.TOP;
  }

  lineBreak() { this.lastSpaceTap = null; this.#commitWord(); this.committed = [...this.committed, { br: true }]; this.stage = Stage.TOP; }

  /** Removes the last symbol typed; returns 'removed', 'literal' or 'nothing'. */
  delete() {
    this.lastSpaceTap = null;
    const b = this.currentBlock;

    // 1. A symbol in the current block.
    if (b.order.length > 0) {
      const s = b.order[b.order.length - 1];
      const order = b.order.slice(0, -1);
      if (s === Stage.TOP) this.currentBlock = makeBlock(b.onset.slice(0, -1), b.vowel, b.coda, order);
      else if (s === Stage.MIDDLE) this.currentBlock = makeBlock(b.onset, null, b.coda, order);
      else this.currentBlock = makeBlock(b.onset, b.vowel, b.coda.slice(0, -1), order);
      this.stage = s;
      return 'removed';
    }

    // 2. Empty block: step back within the current word.
    if (this.units.length > 0) {
      const last = this.units[this.units.length - 1];
      this.units = this.units.slice(0, -1);
      if (last.mark) {
        const before = this.units[this.units.length - 1];
        if (before && before.block) { this.units = this.units.slice(0, -1); this.currentBlock = before.block; }
        this.stage = Stage.MIDDLE;
      } else {
        this.#reopen(last.block);
      }
      return 'removed';
    }

    // 3. Empty word: step back into the committed text.
    const token = this.committed[this.committed.length - 1];
    if (!token) { this.stage = Stage.TOP; return 'nothing'; }
    if (token.br) {
      this.committed = this.committed.slice(0, -1);
      this.#reopenLastWord();
      return 'removed';
    }
    if (!token.punct) { this.#reopenLastWord(); return 'removed'; }
    const chars = [...token.punct];
    chars.pop();
    const shorter = { units: token.units, punct: chars.join('') };
    this.committed = this.committed.slice(0, -1);
    if (shorter.punct || shorter.units.length > 0) {
      this.committed = [...this.committed, shorter];
      if (!shorter.punct) this.#reopenLastWord();
    }
    return 'literal';
  }

  /** For saving and restoring (plain JSON). */
  snapshot() {
    return { committed: this.committed, units: this.units, currentBlock: this.currentBlock, stage: this.stage };
  }

  restore(s) {
    this.committed = s.committed ?? [];
    this.units = s.units ?? [];
    this.currentBlock = s.currentBlock ?? makeBlock();
    this.stage = s.stage ?? Stage.TOP;
    this.lastSpaceTap = null;
  }

  #finishBlock() {
    if (!blockIsEmpty(this.currentBlock)) {
      this.units = [...this.units, { block: this.currentBlock }];
      this.currentBlock = makeBlock();
    }
  }

  #commitWord(punct = '') {
    this.#finishBlock();
    if (this.units.length > 0 || punct) this.committed = [...this.committed, { units: this.units, punct }];
    this.units = [];
  }

  #reopen(b) {
    this.currentBlock = b;
    this.stage = b.order.length ? b.order[b.order.length - 1] : Stage.TOP;
  }

  #reopenLastWord() {
    this.stage = Stage.TOP;
    const w = this.committed[this.committed.length - 1];
    if (!w || w.br || w.punct || w.units.length === 0) return;
    this.committed = this.committed.slice(0, -1);
    this.units = w.units;
    const last = this.units[this.units.length - 1];
    if (last.block) { this.units = this.units.slice(0, -1); this.#reopen(last.block); }
    else this.stage = Stage.MIDDLE;
  }
}
