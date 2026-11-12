'use strict';
/* TubeLab — client-side YouTube growth system. No backend, no embedded keys. */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('tl_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tl_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('tl_' + k); } catch (e) {} }
};

/* ---------- navigation ---------- */
function nav(page) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  $$('#mainNav button').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'channels') { renderChannels(); loadDataFile(); }
  if (page === 'competitors') { renderCompetitors(); loadDataFile(); }
  if (page === 'checker') loadMakerHandoff();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-nav]');
  if (t) { e.preventDefault(); nav(t.dataset.nav); }
});

/* ---------- YouTube autocomplete (JSONP) ---------- */
let jsonpN = 0;
const suggestCache = new Map();
function ytSuggest(q) {
  q = q.trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  if (suggestCache.has(q)) return Promise.resolve(suggestCache.get(q));
  return new Promise((resolve, reject) => {
    const cb = 'tlcb' + (++jsonpN) + '_' + Date.now();
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Suggestion request timed out')); }, 9000);
    function cleanup() { clearTimeout(timer); script.remove(); try { delete window[cb]; } catch (e) { window[cb] = undefined; } }
    window[cb] = (data) => { cleanup(); const out = (data && data[1]) || []; suggestCache.set(q, out); resolve(out); };
    script.onerror = () => { cleanup(); reject(new Error('Could not reach YouTube suggestions')); };
    script.src = 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&q=' + encodeURIComponent(q) + '&callback=' + cb;
    document.head.appendChild(script);
  });
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const QUESTION_WORDS = ['how', 'what', 'why', 'when', 'where', 'who', 'can', 'does', 'is', 'will', 'which'];
const MODIFIERS = ['how', 'what', 'why', 'best', 'vs', 'tutorial', 'explained', 'documentary', 'history', 'story', 'facts', 'for beginners', '2026', 'in 2026', 'full movie', 'real story'];
function titleCase(s) { return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1)); }

/* ---------- Niche Finder ---------- */
function nicheScore(phrase, rank, siblings, depth) {
  const words = phrase.split(/\s+/).length;
  const demand = Math.max(8, Math.round(100 - rank * (70 / Math.max(1, siblings))));
  const depthScore = Math.min(100, depth * 10);
  let intent = words <= 1 ? 10 : Math.min(100, 26 + words * 13);
  if (QUESTION_WORDS.some(w => phrase.startsWith(w))) intent = Math.min(100, intent + 14);
  if (/\d/.test(phrase)) intent = Math.min(100, intent + 8);
  const opportunity = Math.round(demand * 0.35 + depthScore * 0.25 + intent * 0.4);
  return { demand, depth: depthScore, intent, opportunity };
}
$('#nicheForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const seed = $('#nicheSeed').value.trim();
  if (!seed) return;
  const st = $('#nicheStatus'), box = $('#nicheResults');
  box.innerHTML = ''; st.classList.remove('err'); st.textContent = 'Pulling live YouTube searches around “' + seed + '”…';
  try {
    const top = await ytSuggest(seed);
    if (!top.length) { st.textContent = 'YouTube returned no suggestions for that topic. Try a broader word.'; return; }
    const candidates = top.slice(0, 8);
    st.textContent = 'Scoring ' + candidates.length + ' niches by their own search depth…';
    const depths = await mapLimit(candidates, 4, async (c) => (await ytSuggest(c)).length);
    const cards = candidates.map((c, i) => ({ phrase: c, ...nicheScore(c, i, candidates.length, depths[i] || 0) }))
      .sort((a, b) => b.opportunity - a.opportunity);
    st.textContent = 'Done — ' + cards.length + ' niches found for “' + seed + '”. Highest opportunity first.';
    box.innerHTML = cards.map(c => `
      <div class="niche-card">
        <h3>${esc(titleCase(c.phrase))}<span class="opp ${c.opportunity >= 65 ? '' : c.opportunity >= 45 ? 'mid' : 'low'}">${c.opportunity}/100 opportunity</span></h3>
        <p class="sub">People really search this. Scores: demand from its rank among sibling searches, depth from how many sub-searches it spawns, intent from how specific the phrase is.</p>
        ${scoreRow('Demand', c.demand)}${scoreRow('Depth', c.depth)}${scoreRow('Intent', c.intent)}
        <div class="niche-actions">
          <button class="chip-btn" data-act="kw" data-q="${esc(c.phrase)}">Keywords for this niche</button>
          <button class="chip-btn" data-act="studio" data-q="${esc(c.phrase)}">Build titles &amp; hook</button>
          <button class="chip-btn" data-act="thumb" data-q="${esc(c.phrase)}">Thumbnail text</button>
        </div>
      </div>`).join('');
  } catch (err) { st.classList.add('err'); st.textContent = 'Something blocked the live search (' + err.message + '). Check your connection and try again.'; }
});
function scoreRow(label, v) { return `<div class="score-row"><span>${label}</span><div class="score-bar"><i style="width:${v}%"></i></div><b>${v}</b></div>`; }

/* cross-tool actions */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const q = b.dataset.q || '';
  if (b.dataset.act === 'kw') { $('#kwSeed').value = q; nav('keywords'); $('#kwForm').requestSubmit(); }
  if (b.dataset.act === 'studio') { $('#contentTopic').value = q; nav('content'); $('#contentForm').requestSubmit(); }
  if (b.dataset.act === 'thumb') { $('#mkText').value = q.toUpperCase(); nav('maker'); drawThumb(); }
  if (b.dataset.act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(q); b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = 'Copy', 1200); }
});

/* ---------- Keyword Finder ---------- */
let kwAll = [];
$('#kwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const seed = $('#kwSeed').value.trim(); if (!seed) return;
  const st = $('#kwStatus'), box = $('#kwResults');
  box.innerHTML = ''; $('#kwToolbar').classList.add('hidden'); st.classList.remove('err');
  st.textContent = 'Asking YouTube what people type after “' + seed + '”…';
  try {
    const queries = new Set([seed]);
    QUESTION_WORDS.forEach(w => queries.add(w + ' ' + seed));
    MODIFIERS.forEach(m => queries.add(seed + ' ' + m));
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach(l => queries.add(seed + ' ' + l));
    const queryList = Array.from(queries);
    let done = 0;
    const results = await mapLimit(queryList, 5, async (q) => { const r = await ytSuggest(q); st.textContent = 'Expanding… ' + (++done) + '/' + queryList.length + ' angles checked'; return r; });
    const seen = new Map();
    results.forEach(list => (list || []).forEach(p => { const key = p.toLowerCase(); if (!seen.has(key)) seen.set(key, p); }));
    kwAll = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    if (!kwAll.length) { st.textContent = 'No suggestions came back. Try a shorter or broader seed.'; return; }
    st.textContent = 'Done — ' + kwAll.length + ' real search phrases found.';
    $('#kwCount').textContent = kwAll.length + ' phrases';
    $('#kwToolbar').classList.remove('hidden');
    const groups = { 'Questions people ask': [], 'How / What / Why': [], 'Long-tail (specific = clickable)': [], 'More real searches': [] };
    kwAll.forEach(p => {
      const low = p.toLowerCase();
      if (QUESTION_WORDS.includes(low.split(' ')[0]) || low.includes('?')) groups['Questions people ask'].push(p);
      else if (/^(how|what|why)\b/.test(low)) groups['How / What / Why'].push(p);
      else if (p.split(/\s+/).length >= 4) groups['Long-tail (specific = clickable)'].push(p);
      else groups['More real searches'].push(p);
    });
    box.innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([name, items]) => `
      <div class="kw-group"><h3>${name} <span style="color:var(--faint);font-size:13px">(${items.length})</span></h3>
      <div class="kw-list">${items.map(p => `<span class="kw-item">${esc(p)}<button class="mini" data-act="copy" data-q="${esc(p)}">Copy</button><button class="mini" data-act="studio" data-q="${esc(p)}">Titles</button></span>`).join('')}</div></div>`).join('');
  } catch (err) { st.classList.add('err'); st.textContent = 'Live search failed (' + err.message + '). Try again in a moment.'; }
});
$('#kwCopy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(kwAll.join('\n')); $('#kwCopy').textContent = 'Copied ✓'; setTimeout(() => $('#kwCopy').textContent = 'Copy all', 1200); });
$('#kwCsv').addEventListener('click', () => {
  const csv = 'keyword,words\n' + kwAll.map(k => '"' + k.replace(/"/g, '""') + '",' + k.split(/\s+/).length).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'tubelab-keywords.csv'; a.click(); URL.revokeObjectURL(a.href);
});

/* hero search routes into niche research */
$('#heroSearch').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#heroSeed').value.trim(); if (!v) return; $('#nicheSeed').value = v; nav('niche'); $('#nicheForm').requestSubmit(); });

/* ---------- Content Studio ---------- */
function buildPackage(topic) {
  const raw = topic.trim().replace(/\?+$/, ''); const T = titleCase(raw);
  const titles = [];
  const low = raw.toLowerCase();
  if (QUESTION_WORDS.includes(low.split(' ')[0])) {
    const core = T.replace(/^(How|What|Why|When|Where|Who|Can|Does|Is|Will|Which)\s+/i, '');
    const qWord = T.split(' ')[0];
    titles.push(
      { t: T + '?', p: 'The searched question, word for word' },
      { t: T + ': The Untold Story', p: 'Story promise' },
      { t: 'The Hidden Truth Behind ' + T, p: 'Secret / reveal' },
      { t: core + ' — ' + qWord + '?', p: 'Short punchy variant' },
      { t: 'Exposed: ' + T, p: 'Investigation angle' },
      { t: T + ' — The Full Story', p: 'Complete account' }
    );
  } else {
    titles.push(
      { t: 'Why ' + T + ' Is Not What You Think', p: 'Curiosity gap + familiar subject' },
      { t: T + ': The Untold Story', p: 'Story promise' },
      { t: 'How ' + T + ' Changed Everything', p: 'How + consequence' },
      { t: 'The Hidden Truth Behind ' + T, p: 'Secret / reveal' },
      { t: '7 Things About ' + T + ' Nobody Tells You', p: 'Number + insider angle' },
      { t: 'What Really Happened With ' + T, p: 'Mystery / investigation' }
    );
  }
  const hooks = [
    `This is ${raw} — and in the next ten seconds you'll see the one detail almost everyone gets wrong about it.`,
    `Everything you think you know about ${raw} is missing one fact. Here it is on screen — watch what it changes.`,
    `${T}. It sounds simple. It isn't. By the end of this video you'll understand why it still matters today.`
  ];
  const beats = [
    ['0:00', '<b>Hook.</b> The topic itself on screen in the first frame, the hook line spoken, the question posed — and NOT answered.'],
    ['0:10', '<b>The promise.</b> Say exactly what the viewer will know by the end that they don\'t know now.'],
    ['0:30', '<b>Setup.</b> The minimum background: who, where, when. One visual change every few seconds — a still screen is a dead video.'],
    ['1:30', '<b>First turn.</b> The first surprise, document, number or witness. Put your strongest verified fact here.'],
    ['3:00', '<b>Escalation.</b> Raise the stakes: what went wrong, who benefited, what was hidden. New hook question at every turn.'],
    ['5:00', '<b>The twist.</b> The detail that reframes everything before it. Hold one beat of silence before it lands.'],
    ['6:30', '<b>Payoff.</b> Answer the opening question completely — the click was a promise, keep it.'],
    ['End', '<b>Loop or next door.</b> End on the sentence that makes the next video (or a rewatch) the natural move. No long goodbye.']
  ];
  return { titles: titles.slice(0, 6), hooks, beats };
}
function renderPackage(topic, pkg) {
  $('#contentResults').innerHTML = `
    <div class="pkg"><h3>Titles — built for “${esc(topic)}”</h3>
      ${pkg.titles.map(x => `<div class="title-line"><span>${esc(x.t)}</span><span class="pat">${esc(x.p)}</span></div>`).join('')}
      <p class="mini-note" style="margin-top:10px">Check first: type the winning title into YouTube's search bar. Its words should appear in the suggestions — if not, bend the title toward the Keyword Finder phrases.</p>
    </div>
    <div class="pkg"><h3>First 10 seconds — pick one hook</h3>
      ${pkg.hooks.map(h => `<div class="hook-box">${esc(h)}</div>`).join('')}
      <p class="mini-note">Rule: words and picture say the same thing at the same second, and the topic is visible in the first frame — no mood-only openings.</p>
    </div>
    <div class="pkg"><h3>Script outline</h3>
      ${pkg.beats.map(b => `<div class="beat"><span class="t">${b[0]}</span><p>${b[1]}</p></div>`).join('')}
    </div>`;
}
$('#contentForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const topic = $('#contentTopic').value.trim(); if (!topic) return;
  $('#contentStatus').textContent = '';
  renderPackage(topic, buildPackage(topic));
});
async function aiGenerate(topic) {
  const keys = store.get('keys', {});
  const prompt = `You are a YouTube packaging expert. Topic/keyword phrase: "${topic}". Write: (1) 6 clickable titles using winner patterns (question, untold story, hidden truth, number, mystery) — the searched words must stay in the title; (2) 3 alternative first-10-seconds hooks that name the topic immediately; (3) a script outline with timestamps and one line per beat, with a new hook question every 60-90 seconds. No fluff, no markdown tables.`;
  if (keys.gemini) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const j = await r.json(); if (!r.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || r.status));
    return j.candidates[0].content.parts.map(p => p.text || '').join('');
  }
  if (keys.groq) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.groq },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: prompt }], max_tokens: 1200 })
    });
    const j = await r.json(); if (!r.ok) throw new Error('Groq: ' + ((j.error && j.error.message) || r.status));
    return j.choices[0].message.content;
  }
  if (keys.openrouter) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.openrouter },
      body: JSON.stringify({ model: 'google/gemma-4-31b-it:free', messages: [{ role: 'user', content: prompt }], max_tokens: 1200 })
    });
    const j = await r.json(); if (!r.ok) throw new Error('OpenRouter: ' + ((j.error && j.error.message) || r.status));
    return j.choices[0].message.content;
  }
  throw new Error('AI_OFF');
}
$('#contentAi').addEventListener('click', async () => {
  const topic = $('#contentTopic').value.trim(); if (!topic) { $('#contentStatus').textContent = 'Type a topic first.'; return; }
  const st = $('#contentStatus'); st.classList.remove('err'); st.textContent = 'AI is writing the package…';
  renderPackage(topic, buildPackage(topic));
  try {
    const text = await aiGenerate(topic);
    st.textContent = 'AI package ready.';
    $('#contentResults').insertAdjacentHTML('beforeend', `<div class="pkg"><h3>AI package</h3><pre class="ai-out">${esc(text)}</pre></div>`);
  } catch (err) {
    if (err.message === 'AI_OFF') { st.classList.remove('err'); st.textContent = 'Done — the built-in package above is complete. The AI writer is an optional extra and stays off; you do not need it.'; }
    else { st.classList.add('err'); st.textContent = err.message; }
  }
});

/* ---------- Thumbnail Maker ---------- */
const mk = { img: null, scene: 'cinema' };
const SCENES = {
  cinema: ['#1a1a22', '#050507'], fire: ['#4a1408', '#0d0302'], ocean: ['#06283d', '#010a12'],
  space: ['#0b1030', '#01020a'], gold: ['#4d3405', '#140d01'], forest: ['#0e2a16', '#020805']
};
function loadMakerImage(src, cors) {
  const img = new Image();
  if (cors) img.crossOrigin = 'anonymous';
  img.onload = () => { mk.img = img; drawThumb(); };
  img.onerror = () => { if (cors) loadMakerImage(src, false); else alert('That image could not be loaded. Try uploading the file instead.'); };
  img.src = src;
}
$('#mkBgFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => loadMakerImage(r.result, false); r.readAsDataURL(f); });
$('#mkBgUrl').addEventListener('change', (e) => { if (e.target.value.trim()) loadMakerImage(e.target.value.trim(), true); });
$('#mkAiGen').addEventListener('click', () => {
  const st = $('#mkAiStatus'); const prompt = $('#mkAiPrompt').value.trim();
  if (!prompt) { st.textContent = 'First describe the scene above — what should be in the picture?'; return; }
  const DARK_WORDS = ['horror', 'ghost', 'scary', 'dark', 'death', 'dead', 'murder', 'mystery', 'haunted', 'demon', 'evil', 'nightmare', 'killer', 'war', 'battle', 'blood', 'curse', 'vanished', 'secret', 'hidden', 'empire', 'crime', 'mafia', 'prison', 'disaster', 'volcano', 'shark', 'predator', 'attack', 'survival', 'dragon', 'monster'];
  const BRIGHT_WORDS = ['happy', 'kids', 'children', 'child', 'smiling', 'smile', 'fun', 'funny', 'colorful', 'colourful', 'science fair', 'school', 'cartoon', 'cute', 'birthday', 'garden', 'beach', 'sunny', 'picnic', 'toy', 'game', 'baby', 'puppy', 'kitten', 'festival', 'party', 'dance', 'cooking', 'recipe', 'travel', 'holiday', 'christmas', 'eid'];
  const low = prompt.toLowerCase();
  const mood = $('#mkMood').value;
  const looksBright = BRIGHT_WORDS.some(w => low.includes(w));
  const looksDark = DARK_WORDS.some(w => low.includes(w));
  const look = mood === 'auto' ? (looksBright ? 'bright' : looksDark ? 'dark' : 'bright') : mood;
  const lookText = look === 'dark' ? 'moody dramatic lighting, deep shadows, cinematic contrast' : 'bright daylight, vivid fresh colors, clean well-lit scene, cheerful and clear';
  const full = (look === 'bright' ? 'Bright, cheerful, sunlit image: ' : '') + prompt + ', cinematic YouTube thumbnail background, one dominant subject filling the frame, ' + lookText + ', rich detail, no text, no letters, no watermark' + (look === 'bright' ? ', absolutely no dark background, no night scene, no gloomy mood' : '');
  const seed = Math.floor(Math.random() * 999999);
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(full) + '?width=1280&height=720&seed=' + seed + '&nologo=true&model=flux';
  st.textContent = 'AI is drawing your background… this can take 20–40 seconds.';
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { img._aiCrop = true; mk.img = img; drawThumb(); st.textContent = 'AI background is on. Add your title text below — or press Generate again for a new version.'; };
  img.onerror = () => { st.textContent = 'The AI painter did not answer — the connection is slow. Press Generate once more.'; };
  img.src = url;
});
$('#mkScene').addEventListener('change', (e) => { mk.scene = e.target.value || 'cinema'; mk.img = null; drawThumb(); });
['mkText', 'mkStyle', 'mkSize', 'mkPos', 'mkBadge', 'mkDark'].forEach(id => $('#' + id).addEventListener('input', drawThumb));
function coverDraw(ctx, img, W, H) {
  const s = Math.max(W / img.width, H / img.height); const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function drawThumb() {
  const cv = $('#mkCanvas'); if (!cv) return; const ctx = cv.getContext('2d'); const W = 1280, H = 720;
  $('#mkSizeVal').textContent = $('#mkSize').value; $('#mkDarkVal').textContent = $('#mkDark').value + '%';
  if (mk.img && mk.img._aiCrop) {
    const s = Math.max(W / mk.img.width, H / mk.img.height) * 1.13;
    ctx.drawImage(mk.img, (W - mk.img.width * s) / 2, 0, mk.img.width * s, mk.img.height * s);
  }
  else if (mk.img) coverDraw(ctx, mk.img, W, H);
  else {
    const [a, b] = SCENES[mk.scene] || SCENES.cinema;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.68, H * 0.36, 40, W * 0.68, H * 0.36, 520);
    rg.addColorStop(0, 'rgba(255,190,80,0.28)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.ellipse(W * 0.7, H * 0.95, 560, 190, 0, 0, Math.PI * 2); ctx.fill();
  }
  const dark = $('#mkDark').value / 100;
  if (dark > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dark + ')'; ctx.fillRect(0, 0, W, H); }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const text = ($('#mkText').value || '').trim();
  if (text) {
    const size = +$('#mkSize').value, style = $('#mkStyle').value, pos = $('#mkPos').value;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = (style === 'steel' ? '4px' : '1px'); } catch (e) {}
    const words = text.split(/\s+/); const lines = []; let line = '';
    ctx.font = '900 ' + size + 'px Archivo, sans-serif';
    words.forEach(w => { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > W - 110 && line) { lines.push(line); line = w; } else line = test; });
    if (line) lines.push(line);
    const lh = size * 1.06; const blockH = lines.length * lh;
    let y = pos === 'bottom' ? H - 64 - blockH + lh / 2 : pos === 'top' ? 64 + lh / 2 : (H - blockH) / 2 + lh / 2;
    const zone = ctx.createLinearGradient(0, pos === 'bottom' ? H - blockH - 130 : 0, 0, pos === 'bottom' ? H : blockH + 130);
    zone.addColorStop(0, 'rgba(0,0,0,0)'); zone.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = zone; ctx.fillRect(0, pos === 'bottom' ? H - blockH - 130 : 0, W, blockH + 130);
    lines.forEach((ln, i) => {
      const yy = y + i * lh;
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      let fill;
      if (style === 'gold') { fill = ctx.createLinearGradient(0, yy - size / 2, 0, yy + size / 2); fill.addColorStop(0, '#fff3b0'); fill.addColorStop(0.5, '#e8b34b'); fill.addColorStop(1, '#8a5a13'); ctx.strokeStyle = '#2a1a02'; }
      else if (style === 'red') { fill = ctx.createLinearGradient(0, yy - size / 2, 0, yy + size / 2); fill.addColorStop(0, '#ff7a6e'); fill.addColorStop(1, '#c40f0f'); ctx.strokeStyle = '#0d0000'; }
      else if (style === 'steel') { fill = ctx.createLinearGradient(0, yy - size / 2, 0, yy + size / 2); fill.addColorStop(0, '#ffffff'); fill.addColorStop(0.55, '#b9c2cc'); fill.addColorStop(1, '#5f6a75'); ctx.strokeStyle = '#10151a'; }
      else { fill = '#ffffff'; ctx.strokeStyle = '#000000'; }
      ctx.shadowColor = style === 'gold' ? 'rgba(232,179,75,0.55)' : 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = style === 'gold' ? 26 : 14; ctx.shadowOffsetY = 4;
      ctx.lineWidth = Math.max(6, size / 11);
      ctx.strokeText(ln.toUpperCase(), W / 2, yy);
      ctx.fillStyle = fill; ctx.shadowBlur = 0;
      ctx.fillText(ln.toUpperCase(), W / 2, yy);
    });
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  }
  if ($('#mkBadge').checked) {
    const bw = 208, bh = 52, bx = W - bw - 26, by = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(8,8,10,0.82)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 2.5; ctx.strokeStyle = '#e8b34b'; ctx.stroke();
    ctx.fillStyle = '#f5c65c'; ctx.font = '700 27px Archivo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('4K ULTRA HD', bx + bw / 2, by + bh / 2 + 1);
  }
  const mini = $('#mkMini'); if (mini) mini.getContext('2d').drawImage(cv, 0, 0, mini.width, mini.height);
}
$('#mkExport').addEventListener('click', () => {
  try {
    $('#mkCanvas').toBlob((blob) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tubelab-thumbnail.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  } catch (e) { alert('Export was blocked because the background image came from a site that does not allow reuse. Upload the image file instead and export again.'); }
});
$('#mkToChecker').addEventListener('click', () => {
  try { store.set('fromMaker', $('#mkCanvas').toDataURL('image/jpeg', 0.92)); } catch (e) {}
  nav('checker');
});

/* ---------- Thumbnail Checker ---------- */
let ckItems = [];
$('#ckFiles').addEventListener('change', (e) => {
  Array.from(e.target.files).slice(0, 3 - ckItems.length).forEach(f => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { ckItems.push({ src: r.result, img, name: f.name, bytes: f.size }); renderChecker(); }; img.src = r.result; };
    r.readAsDataURL(f);
  });
  e.target.value = '';
});
function loadMakerHandoff() {
  const src = store.get('fromMaker', null);
  if (src && !ckItems.some(i => i.src === src)) {
    const img = new Image();
    img.onload = () => { ckItems.unshift({ src, img, name: 'From Thumbnail Maker', bytes: Math.round(src.length * 0.75) }); ckItems = ckItems.slice(0, 3); renderChecker(); };
    img.src = src;
  }
}
function analyzeThumb(img) {
  const w = 160, h = 90; const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data; const lum = new Float32Array(w * h); let sum = 0;
  for (let i = 0; i < w * h; i++) { const L = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; lum[i] = L; sum += L; }
  const mean = sum / (w * h);
  let varSum = 0; for (let i = 0; i < w * h; i++) varSum += (lum[i] - mean) * (lum[i] - mean);
  const contrast = Math.sqrt(varSum / (w * h));
  let edges = 0;
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { if (Math.abs(lum[y * w + x] - lum[y * w + x - 1]) > 26) edges++; }
  const edgeDensity = edges / (w * h);
  return { brightness: Math.round(mean), contrast: Math.round(contrast), edgeDensity: Math.round(edgeDensity * 1000) / 10 };
}
function checkerVerdict(item, a) {
  const notes = []; let score = 100;
  if (item.img.naturalWidth !== 1280 || item.img.naturalHeight !== 720) { notes.push(`Size is ${item.img.naturalWidth}×${item.img.naturalHeight} — YouTube wants 1280×720.`); score -= 12; }
  if (item.bytes > 2 * 1024 * 1024) { notes.push('File is over 2 MB — YouTube will reject it. Export as JPG.'); score -= 15; }
  if (a.contrast < 38) { notes.push('Low contrast (' + a.contrast + ') — on a bright phone screen this will wash out. Deepen the darks behind the subject.'); score -= 18; }
  else if (a.contrast < 55) { notes.push('Contrast is workable (' + a.contrast + ') but a stronger subject/background split would hit harder.'); score -= 6; }
  else notes.push('Strong contrast (' + a.contrast + ') — the subject should pop at small size.');
  if (a.brightness < 45) { notes.push('Very dark overall (' + a.brightness + '/255) — fine for horror/mystery, risky for anything else.'); score -= 6; }
  if (a.brightness > 205) { notes.push('Very bright overall (' + a.brightness + '/255) — highlights may clip on phones.'); score -= 6; }
  if (a.edgeDensity > 16) { notes.push('High visual clutter (' + a.edgeDensity + '% busy edges) — at feed size detail turns to noise. Simplify: one subject, one idea.'); score -= 14; }
  else if (a.edgeDensity < 3.5) { notes.push('Very plain frame (' + a.edgeDensity + '% edges) — make sure the single subject is big and emotional enough to carry it.'); score -= 4; }
  else notes.push('Clutter level is healthy (' + a.edgeDensity + '% edges) — readable at a glance.');
  notes.push('Final human check: shrink it mentally to a postage stamp — if you can\'t say what it promises in 1 second, the text is too small or the idea is split.');
  return { score: Math.max(5, score), notes };
}
function renderChecker() {
  const grid = $('#ckGrid');
  grid.innerHTML = ckItems.map((item, idx) => {
    const a = analyzeThumb(item.img); const v = checkerVerdict(item, a);
    return `<div class="ck-card">
      <img class="main" src="${item.src}" alt="Thumbnail variant ${idx + 1}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="ck-score" style="color:${v.score >= 75 ? 'var(--green)' : v.score >= 55 ? 'var(--gold)' : 'var(--red-hot)'}">${v.score}</span>
        <span style="color:var(--faint);font-size:12px">${esc(item.name)} · click-readiness</span>
      </div>
      <ul class="ck-verdict">${v.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="ck-sizes">
        <figure><img src="${item.src}" style="width:236px"><figcaption>Search result</figcaption></figure>
        <figure><img src="${item.src}" style="width:148px"><figcaption>Feed</figcaption></figure>
        <figure><img src="${item.src}" style="width:104px"><figcaption>Up next</figcaption></figure>
      </div>
      <div class="feed-mock">
        <div class="fm-row"><span class="fm-thumb">another video</span><span><span class="fm-t">A title competing for the same thumb</span><br><span class="fm-s">Some Channel · 210K views</span></span></div>
        <div class="fm-row"><img src="${item.src}"><span><span class="fm-t">YOUR VIDEO — does it win this slot?</span><br><span class="fm-s">Your Channel · new</span></span></div>
        <div class="fm-row"><span class="fm-thumb">another video</span><span><span class="fm-t">Something louder, simpler, one idea</span><br><span class="fm-s">Rival Channel · 1.2M views</span></span></div>
      </div>
      <button class="ch-remove" data-ckremove="${idx}">Remove this variant</button>
    </div>`;
  }).join('');
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-ckremove]');
  if (r) { ckItems.splice(+r.dataset.ckremove, 1); renderChecker(); }
});

/* ---------- Channels & Competitors (YouTube public RSS) ---------- */
const OWN_CHANNELS = [
  { id: 'UC0muN9k-ye9io1iKFdYXK6A', name: 'Cinematic Realms' },
  { id: 'UCVWdAu0wzQ_ahxjKa1BPI3Q', name: 'Invisible Empires' },
  { id: 'UCofH-WClOiS0hPkilRgKgNg', name: 'Lost Chapters' },
  { id: 'UCSP5logpZlbjlj-ROsLoLEA', name: 'Sampoorn Itihas' },
  { id: 'UCoUlpDSqRha6LFGOdXy0kqQ', name: 'Apex Depths' },
  { id: 'UCmWqX8VwfWmtlxZIOnSLsLw', name: 'Space Files' },
  { id: 'UC47DLUlNUFv2UK2daslvtgw', name: 'Stick & Shadow' },
  { id: 'UC64QD7XTKTJV_jEi88h_5MQ', name: 'Wahlly-Gamer' },
  { id: 'UC223qUa4I5EdoCm_pqEHLGA', name: 'Muscle Map' },
  { id: 'UCPNPUvkvuTx7rVVvbJKYLew', name: 'TeeliToonz' }
];
const PROXIES = [
  (u) => u,
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
];
async function fetchText(url, timeoutMs) {
  for (const wrap of PROXIES) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs || 9000);
      const r = await fetch(wrap(url), { signal: ctl.signal }); clearTimeout(to);
      if (r.ok) { const t = await r.text(); if (t && t.length > 40) return t; }
    } catch (e) {}
  }
  throw new Error('Feed unreachable right now');
}
async function fetchViaRss2Json(channelId) {
  const feed = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  const r = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feed), { signal: ctl.signal });
  clearTimeout(to);
  if (!r.ok) throw new Error('rss2json ' + r.status);
  const j = await r.json();
  if (j.status !== 'ok' || !j.items) throw new Error('rss2json empty');
  return {
    name: (j.feed && j.feed.title) || '',
    videos: j.items.slice(0, 8).map(it => ({ title: it.title || '', link: it.link || '', published: (it.pubDate || '').replace(' ', 'T') + 'Z', thumb: it.thumbnail || '', views: null })),
    fetchedAt: Date.now()
  };
}
/* Same-origin data file, refreshed daily by the TubeLab data job — zero proxies involved. */
let dataFileLoaded = false;
async function loadDataFile() {
  if (dataFileLoaded) return; dataFileLoaded = true;
  try {
    const r = await fetch('channels-data.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    Object.entries(j.channels || {}).forEach(([id, data]) => {
      const cached = store.get('feed_' + id, null);
      if (!cached || (data.fetchedAt || 0) > (cached.fetchedAt || 0)) store.set('feed_' + id, data);
    });
    renderChannels(); renderCompetitors();
  } catch (e) {}
}
async function fetchChannelFeed(channelId) {
  /* Prefer the full RSS (carries view counts) via proxy chain; fall back to rss2json (no view counts). */
  try { return await fetchChannelFeedRss(channelId); } catch (e) { return await fetchViaRss2Json(channelId); }
}
async function fetchChannelFeedRss(channelId) {
  const xml = await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const name = (doc.querySelector('feed > title') || {}).textContent || '';
  const videos = Array.from(doc.querySelectorAll('entry')).slice(0, 8).map(en => {
    const g = en.getElementsByTagName('media:group')[0];
    const thumb = g && g.getElementsByTagName('media:thumbnail')[0] ? g.getElementsByTagName('media:thumbnail')[0].getAttribute('url') : '';
    const stats = g && g.getElementsByTagName('media:statistics')[0] ? +g.getElementsByTagName('media:statistics')[0].getAttribute('views') : null;
    const linkEl = en.querySelector('link');
    return { title: (en.querySelector('title') || {}).textContent || '', link: linkEl ? linkEl.getAttribute('href') : '', published: (en.querySelector('published') || {}).textContent || '', thumb, views: stats };
  });
  return { name, videos, fetchedAt: Date.now() };
}
async function resolveChannelId(input) {
  input = input.trim();
  if (/^UC[\w-]{22}$/.test(input)) return input;
  const m = input.match(/channel\/(UC[\w-]{22})/); if (m) return m[1];
  const handle = input.startsWith('@') ? input : (input.match(/@[\w.-]+/) || [])[0];
  if (!handle) return null;
  const html = await fetchText('https://www.youtube.com/' + handle);
  const mm = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"externalId":"(UC[\w-]{22})"/);
  return mm ? mm[1] : null;
}
function fmtViews(v) { if (v == null || isNaN(v)) return ''; if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M views'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K views'; return v + ' views'; }
function fmtDate(iso) { const d = new Date(iso); if (isNaN(d)) return ''; const days = Math.round((Date.now() - d) / 864e5); if (days <= 0) return 'today'; if (days === 1) return 'yesterday'; if (days < 30) return days + ' days ago'; if (days < 365) return Math.round(days / 30) + ' mo ago'; return Math.round(days / 365) + ' yr ago'; }
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function channelCard(ch, data, kind) {
  const head = `<div class="ch-head"><div><h3>${esc((data && data.name) || ch.name)}</h3><span class="handle">${esc(ch.id)}</span></div>
    <span><button class="ch-refresh" data-refresh="${esc(ch.id)}">Refresh</button>${kind === 'comp' ? ` <button class="ch-remove" data-unwatch="${esc(ch.id)}">stop watching</button>` : ''}</span></div>`;
  if (!data) return `<div class="ch-card">${head}<p class="ch-empty">Not loaded yet — hit Refresh to pull the latest videos.</p></div>`;
  if (!data.videos.length) return `<div class="ch-card">${head}<p class="ch-empty">Feed loaded but no videos were listed.</p></div>`;
  const med = median(data.videos.map(v => v.views).filter(v => v != null));
  const vids = data.videos.map(v => {
    const ratio = (v.views != null && med > 0) ? v.views / med : 0;
    const badge = kind === 'comp' && ratio >= 2 ? `<span class="breakout">BREAKOUT ${ratio.toFixed(1)}×</span>` : '';
    return `<a class="vid" href="${esc(v.link)}" target="_blank" rel="noopener"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span><span class="vt">${esc(v.title)}${badge}</span><br><span class="vm">${esc(fmtViews(v.views))}${v.views != null ? ' · ' : ''}${esc(fmtDate(v.published))}</span></span></a>`;
  }).join('');
  return `<div class="ch-card">${head}${vids}<p class="ch-empty">Updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${kind === 'comp' && med ? ' · channel median ≈ ' + fmtViews(med) : ''}</p></div>`;
}
async function refreshChannel(id, kind) {
  const data = await fetchChannelFeed(id);
  store.set('feed_' + id, data);
  if (kind === 'comp') { const list = store.get('competitors', []); const it = list.find(c => c.id === id); if (it && data.name) { it.name = data.name; store.set('competitors', list); } }
  return data;
}
document.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-refresh]');
  if (r) { r.textContent = 'Loading…'; try { await refreshChannel(r.dataset.refresh, 'any'); } catch (err) {} renderChannels(); renderCompetitors(); return; }
  const u = e.target.closest('[data-unwatch]');
  if (u) { store.set('competitors', store.get('competitors', []).filter(c => c.id !== u.dataset.unwatch)); renderCompetitors(); }
});
function allOwnChannels() { return OWN_CHANNELS.concat(store.get('extraChannels', [])); }
function renderChannels() {
  const grid = $('#chGrid'); if (!grid) return;
  grid.innerHTML = allOwnChannels().map(ch => channelCard(ch, store.get('feed_' + ch.id, null), 'own')).join('');
  const stamps = allOwnChannels().map(ch => store.get('feed_' + ch.id, null)).filter(Boolean).map(d => d.fetchedAt);
  $('#chUpdated').textContent = stamps.length ? 'Showing saved data — refresh for the latest.' : 'Nothing loaded yet — press Refresh all.';
}
$('#chRefreshAll').addEventListener('click', async () => {
  const btn = $('#chRefreshAll'); btn.textContent = 'Refreshing…';
  for (const ch of allOwnChannels()) { try { await refreshChannel(ch.id, 'own'); renderChannels(); } catch (e) {} }
  btn.textContent = 'Refresh all';
});
$('#chAddForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const inp = $('#chAddInput'); const v = inp.value.trim(); if (!v) return;
  try { const id = await resolveChannelId(v); if (!id) { alert('Could not resolve that channel. Paste the channel ID (UC…) from its About page.'); return; }
    const list = store.get('extraChannels', []); if (!allOwnChannels().some(c => c.id === id)) { list.push({ id, name: id }); store.set('extraChannels', list); }
    inp.value = ''; await refreshChannel(id, 'own'); renderChannels();
  } catch (err) { alert('Could not reach YouTube to resolve that channel right now.'); }
});
function renderCompetitors() {
  const grid = $('#compGrid'); if (!grid) return;
  const list = store.get('competitors', []);
  grid.innerHTML = list.length ? list.map(ch => channelCard(ch, store.get('feed_' + ch.id, null), 'comp')).join('')
    : '<p class="ch-empty" style="grid-column:1/-1">No competitors watched yet. Add the first one above — a channel in your niche whose videos keep beating yours.</p>';
}
$('#compForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const inp = $('#compInput'); const v = inp.value.trim(); if (!v) return;
  const st = $('#compStatus'); st.classList.remove('err'); st.textContent = 'Resolving channel…';
  try {
    const id = await resolveChannelId(v);
    if (!id) { st.classList.add('err'); st.textContent = 'Could not resolve that. Paste the channel ID (starts with UC) from the channel\'s About / share link.'; return; }
    const list = store.get('competitors', []);
    if (!list.some(c => c.id === id)) { list.push({ id, name: id }); store.set('competitors', list); }
    inp.value = ''; renderCompetitors();
    st.textContent = 'Added — loading its latest videos…';
    try { await refreshChannel(id, 'comp'); st.textContent = 'Watching it now — breakouts are flagged in red.'; }
    catch (err2) { st.textContent = 'It is on your watchlist. Its videos could not load just now — hit Refresh on its card in a moment.'; }
    renderCompetitors();
  } catch (err) { st.classList.add('err'); st.textContent = 'That channel could not be resolved. Paste the channel ID (starts with UC) from its About / share link.'; }
});

/* ---------- Settings ---------- */
function loadKeys() { const k = store.get('keys', {}); $('#keyGemini').value = k.gemini || ''; $('#keyOpenrouter').value = k.openrouter || ''; $('#keyGroq').value = k.groq || ''; }
$('#keysSave').addEventListener('click', () => {
  store.set('keys', { gemini: $('#keyGemini').value.trim(), openrouter: $('#keyOpenrouter').value.trim(), groq: $('#keyGroq').value.trim() });
  $('#keysStatus').textContent = 'Saved in this browser only. Content Studio\'s AI button will use: ' + ($('#keyGemini').value.trim() ? 'Gemini' : $('#keyGroq').value.trim() ? 'Groq' : $('#keyOpenrouter').value.trim() ? 'OpenRouter' : 'none yet') + '.';
});
$('#keysClear').addEventListener('click', () => { store.del('keys'); loadKeys(); $('#keysStatus').textContent = 'Keys removed from this browser.'; });
$('#dataWipe').addEventListener('click', () => {
  Object.keys(localStorage).filter(k => k.startsWith('tl_')).forEach(k => localStorage.removeItem(k));
  ckItems = []; renderChecker(); renderChannels(); renderCompetitors(); loadKeys();
  $('#keysStatus').textContent = 'All TubeLab data cleared from this browser.';
});

/* ---------- Theme (light / dark) ---------- */
function paintThemeBtn() { const b = $('#themeToggle'); if (b) b.textContent = document.documentElement.dataset.theme === 'light' ? '🌙 Dark' : '☀ Light'; }
if (store.get('theme', 'dark') === 'light') document.documentElement.dataset.theme = 'light';
$('#themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next; store.set('theme', next); paintThemeBtn();
});
paintThemeBtn();

/* ---------- init ---------- */
loadKeys();
drawThumb();
renderChannels();
renderCompetitors();
loadDataFile();
