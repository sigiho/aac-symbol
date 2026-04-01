const API_SEARCH = 'https://api.arasaac.org/api/pictograms/ko/search/';
const IMG_BASE   = 'https://static.arasaac.org/pictograms';

function geminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}
function geminiTextUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey()}`;
}
function geminiImgUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey()}`;
}

const searchInput  = document.getElementById('search-input');
const searchBtn    = document.getElementById('search-btn');
const resultsEl    = document.getElementById('results');
const canvas       = document.getElementById('card-canvas');
const ctx          = canvas.getContext('2d');
const generateBtn  = document.getElementById('generate-btn');

const MAX_SYMBOLS = 3;
let selected         = [];
let lastGeneratedUrl = null;
let lastScene        = '';
let lastKorean       = '';
let lastLabels       = [];

const labelsEl = document.getElementById('card-labels');
const labelWordsEl = document.getElementById('label-words');
const labelSceneEl = document.getElementById('label-scene');

// ── Search ────────────────────────────────────────────────────────────────────

async function search() {
  const query = searchInput.value.trim();
  if (!query) return;

  resultsEl.innerHTML = '<p class="text-gray-500 text-sm col-span-full">Searching…</p>';

  try {
    const res = await fetch(API_SEARCH + encodeURIComponent(query));
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    renderResults(data.slice(0, 32));
  } catch {
    resultsEl.innerHTML = '<p class="text-red-400 text-sm col-span-full">No results found.</p>';
  }
}

function renderResults(symbols) {
  resultsEl.innerHTML = '';
  if (!symbols.length) {
    resultsEl.innerHTML = '<p class="text-gray-500 text-sm col-span-full">No results.</p>';
    return;
  }

  symbols.forEach(sym => {
    const label  = sym.keywords?.[0]?.keyword ?? String(sym._id);
    const imgSrc = `${IMG_BASE}/${sym._id}/${sym._id}_300.png`;

    const btn = document.createElement('button');
    btn.className = 'result-btn bg-gray-800 hover:bg-gray-700 border border-transparent hover:border-blue-500 rounded-lg p-1.5 flex flex-col items-center gap-1 transition-colors';
    btn.title = label;

    const img  = document.createElement('img');
    img.src    = imgSrc;
    img.alt    = label;
    img.className = 'w-14 h-14 object-contain';

    const span = document.createElement('span');
    span.textContent = label;
    span.className   = 'text-[10px] text-gray-400 truncate w-full text-center leading-tight';

    btn.append(img, span);
    btn.addEventListener('click', () => addSymbol(sym._id, label));
    resultsEl.appendChild(btn);
  });
}

// ── Stage & Symbol Canvas ─────────────────────────────────────────────────────

async function addSymbol(id, label) {
  if (selected.length >= MAX_SYMBOLS) return;

  // Fetch English keyword for Pollinations (which blocks non-ASCII prompts)
  let englishLabel = label;
  try {
    const res  = await fetch(`https://api.arasaac.org/api/pictograms/en/${id}`);
    const data = await res.json();
    englishLabel = data.keywords?.[0]?.keyword || label;
  } catch {
    // fall back to original label
  }

  selected.push({ id, label, englishLabel });
  generateBtn.disabled = false;
  drawSymbolCanvas();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img      = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

async function drawSymbolCanvas() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  if (!selected.length) return;

  const count   = selected.length;
  const PAD     = 32;
  const TEXT_H  = 48;
  const slotW   = (W - PAD * 2) / count;
  const imgSize = Math.min(slotW - 24, H - TEXT_H - PAD * 2);

  try {
    const images = await Promise.all(
      selected.map(s => loadImage(`${IMG_BASE}/${s.id}/${s.id}_300.png`))
    );

    images.forEach((img, i) => {
      const x = PAD + i * slotW + (slotW - imgSize) / 2;
      const y = PAD + (H - TEXT_H - PAD * 2 - imgSize) / 2;
      ctx.drawImage(img, x, y, imgSize, imgSize);
    });

    const labelText = selected.map(s => s.label).join(' + ');
    ctx.fillStyle    = '#111111';
    ctx.font         = `bold ${count === 1 ? 22 : 18}px system-ui, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, W / 2, H - TEXT_H / 2, W - PAD * 2);
  } catch (err) {
    console.error('Canvas draw error:', err);
  }
}

// ── Contextual prompt composition via Gemini ─────────────────────────────────

// Returns { scene: "English for image prompt", korean: "한국어 문장" }
async function composeScene(koreanLabels, englishLabels) {
  try {
    const res = await fetch(geminiTextUrl(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `You are an AAC communication assistant.\n` +
          `Korean words selected: ${koreanLabels.join(', ')}\n` +
          `English equivalents: ${englishLabels.join(', ')}\n\n` +
          `1. Write a short natural English scene description (6-10 words) for image generation.\n` +
          `2. Write a short natural Korean sentence using ONLY the given Korean words — ` +
          `do NOT add any adjectives, colors, or extra descriptions not in the word list.\n\n` +
          `Respond with JSON only, no markdown:\n` +
          `{"scene":"...","korean":"..."}`
        }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0 }
      })
    });
    if (!res.ok) throw new Error('gemini text failed');
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      // Strip markdown code fences if present
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      // Extract JSON object even if there's surrounding text
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const json = JSON.parse(match[0]);
        if (json.scene && json.korean) return json;
      }
    }
  } catch {
    // fall back
  }
  return {
    scene:  englishLabels.join(' and '),
    korean: koreanLabels.join(' + ')
  };
}

// ── AI Image Generation (Pollinations) ───────────────────────────────────────

async function generateImage() {
  if (!selected.length) return;
  if (!geminiKey()) { openModal(); return; }

  const labels        = selected.map(s => s.label);
  const englishLabels = selected.map(s => s.englishLabel || s.label);

  generateBtn.disabled    = true;
  generateBtn.textContent = '⏳ Composing…';
  drawLoading('Composing scene with Gemini…');

  const { scene, korean } = await composeScene(labels, englishLabels);
  lastScene  = scene;
  lastKorean = korean;
  lastLabels = labels;

  const prompt =
    `Create a simple flat AAC communication pictogram illustrating: "${scene}". ` +
    `Style: minimal bold outlines, clean white background, ` +
    `symbolic icon style similar to ARASAAC pictograms, no text, no watermark, single clear scene, square format.`;

  generateBtn.textContent = '⏳ Generating…';
  drawLoading(`"${korean}"`);

  try {
    const res = await fetch(geminiImgUrl(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data  = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find(p => p.inlineData);
    if (!imgPart) throw new Error('No image in response');

    const { data: b64, mimeType } = imgPart.inlineData;
    const dataUrl = `data:${mimeType};base64,${b64}`;
    lastGeneratedUrl = dataUrl;

    const img = await new Promise((resolve, reject) => {
      const i  = new Image();
      i.onload  = () => resolve(i);
      i.onerror = reject;
      i.src     = dataUrl;
    });

    // Draw image letterboxed to fill square canvas without distortion
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);

    // Show labels below canvas
    labelWordsEl.textContent = lastLabels.join(' + ');
    labelSceneEl.textContent = lastKorean;
    labelsEl.classList.remove('hidden');
  } catch (err) {
    drawError(`Error: ${err.message}`);
  } finally {
    generateBtn.disabled    = false;
    generateBtn.textContent = '✦ Generate Image';
  }
}

function drawLoading(prompt = '') {
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle    = '#374151';
  ctx.font         = 'bold 14px system-ui, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Generating image…', canvas.width / 2, canvas.height / 2 - 16);
  if (prompt) {
    ctx.fillStyle = '#9ca3af';
    ctx.font      = '11px system-ui, sans-serif';
    const short   = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt;
    ctx.fillText(short, canvas.width / 2, canvas.height / 2 + 10, canvas.width - 40);
  }
}

function drawError(msg = 'Generation failed. Please try again.') {
  ctx.fillStyle = '#fef2f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle    = '#dc2626';
  ctx.font         = '15px system-ui, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

// ── Controls ──────────────────────────────────────────────────────────────────

function reset() {
  selected         = [];
  lastGeneratedUrl = null;
  lastScene        = '';
  lastKorean       = '';
  lastLabels       = [];
  generateBtn.disabled    = true;
  generateBtn.textContent = '✦ Generate Image';
  labelsEl.classList.add('hidden');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function download() {
  const W        = canvas.width;
  const PAD      = 32;
  const LINE_H   = 28;
  const TEXT_ROWS = 2; // words line + sentence line
  const cardH    = W + PAD * 2 + LINE_H * TEXT_ROWS;

  const card    = document.createElement('canvas');
  card.width    = W;
  card.height   = cardH;
  const cctx    = card.getContext('2d');

  // White background
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, W, cardH);

  // Image
  cctx.drawImage(canvas, 0, 0, W, W);

  // Divider
  cctx.fillStyle = '#e5e7eb';
  cctx.fillRect(PAD, W + 12, W - PAD * 2, 1);

  // Word labels  (e.g. 커피 + 컵 + 붓다)
  cctx.fillStyle    = '#111111';
  cctx.font         = `bold 17px system-ui, sans-serif`;
  cctx.textAlign    = 'center';
  cctx.textBaseline = 'middle';
  cctx.fillText(lastLabels.join(' + '), W / 2, W + PAD + 4, W - PAD * 2);

  // Korean sentence
  cctx.fillStyle = '#555555';
  cctx.font      = `15px system-ui, sans-serif`;
  cctx.fillText(lastKorean, W / 2, W + PAD + 4 + LINE_H, W - PAD * 2);

  const link    = document.createElement('a');
  link.download = 'aac-card.png';
  link.href     = card.toDataURL('image/png');
  link.click();
}

// ── Events ────────────────────────────────────────────────────────────────────

searchBtn.addEventListener('click', search);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
generateBtn.addEventListener('click', generateImage);
document.getElementById('reset-btn').addEventListener('click', reset);
document.getElementById('download-btn').addEventListener('click', download);

// ── API Key modal ─────────────────────────────────────────────────────────────

const modal       = document.getElementById('api-key-modal');
const keyInput    = document.getElementById('api-key-input');
const banner      = document.getElementById('api-key-banner');

function openModal() {
  keyInput.value = geminiKey();
  modal.classList.remove('hidden');
  keyInput.focus();
}

function closeModal() {
  modal.classList.add('hidden');
}

function saveKey() {
  const key = keyInput.value.trim();
  if (key) {
    localStorage.setItem('gemini_api_key', key);
    banner.classList.add('hidden');
  }
  closeModal();
}

document.getElementById('api-key-btn').addEventListener('click', openModal);
document.getElementById('api-key-cancel').addEventListener('click', closeModal);
document.getElementById('api-key-save').addEventListener('click', saveKey);
keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// Show banner on load if no key saved
if (!geminiKey()) banner.classList.remove('hidden');

// ── Init ──────────────────────────────────────────────────────────────────────

// Blank white canvas on load
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
