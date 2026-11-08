// Hanglish web app: keyboard + rendered message + share / copy, saved between visits.
import { FontData, Composer } from './core.js';
import { loadFont, messageCanvas, canvasToPngBlob } from './render.js';
import { Keyboard } from './keyboard.js';

const SAVE_KEY = 'hanglish.composer';
const $ = (id) => document.getElementById(id);

const [json] = await Promise.all([
  fetch('data/syllabary-font-data.json').then((r) => r.json()),
  loadFont('fonts/SyllabarySerif-Regular.ttf'),
]);
const data = new FontData(json);
const composer = new Composer();
try {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) composer.restore(JSON.parse(saved));
} catch { /* private mode or blocked storage: start empty */ }

const keyboard = new Keyboard($('keyboard'), data, composer, { change: onChange, image: shareImage });
let current = null;   // the rendered message canvas
renderMessage();

function onChange() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(composer.snapshot())); } catch { /* ignore */ }
  renderMessage();
}

/** Shows the message as the picture that will be sent (1 CSS px per 3 image px, as in the apps). */
function renderMessage() {
  current = messageCanvas(data, composer.text);
  const holder = $('image-holder');
  holder.replaceChildren();
  if (current) {
    current.style.width = `${current.width / 3}px`;
    holder.append(current);
  }
  $('placeholder').hidden = !!current;
  $('copy-btn').disabled = !current;
  $('clear-btn').disabled = composer.isEmpty;
}

function pngFile() {
  if (!current) return null;
  return new File([canvasToPngBlob(current)], 'hanglish.png', { type: 'image/png' });
}

/** The image key: open the share sheet (WhatsApp, Messages…); clear once it's sent. */
async function shareImage() {
  const file = pngFile();
  if (!file) { keyboard.flash('empty'); return; }
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      composer.clear();
      keyboard.refresh();
      onChange();
      keyboard.flash('sent');
    } catch (e) {
      if (e.name !== 'AbortError') await copyImage(file);   // cancelled: keep the message
    }
  } else {
    await copyImage(file);   // no share sheet (e.g. desktop): copy instead
  }
}

/** Copies the picture to the clipboard, ready to paste into a chat. */
async function copyImage(file = pngFile()) {
  if (!file) { keyboard.flash('empty'); return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
    keyboard.flash('copied');
  } catch {
    // Last resort: download the PNG.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = 'hanglish.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    keyboard.flash('copied');
  }
}

$('copy-btn').addEventListener('click', () => copyImage());
$('clear-btn').addEventListener('click', () => {
  composer.clear();
  keyboard.refresh();
  onChange();
});
function showHelp() {
  const d = $('help');
  d.showModal();
  d.scrollTop = 0;          // the browser jumps to the Done button; start at the top
  d.querySelector('h2').focus?.();
}
$('help-btn').addEventListener('click', showHelp);

// Show help the first time.
try {
  if (!localStorage.getItem('hanglish.seenHelp')) {
    localStorage.setItem('hanglish.seenHelp', '1');
    showHelp();
  }
} catch { /* ignore */ }

// Redraw the preview strip when the width changes (rotation, window resize).
new ResizeObserver(() => keyboard.drawPreview()).observe($('keyboard'));

// Work offline and from the Home Screen.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
