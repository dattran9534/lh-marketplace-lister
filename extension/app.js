const S = window.LHShared;
const IMG = window.LHImage;
const AI = window.LHAI;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { listings: [], settings: { ...S.DEFAULT_SETTINGS }, selectedId: null, filter: 'active', checked: new Set(), busy: false };
const params = new URLSearchParams(location.search);
const srcTabId = params.get('src') ? Number(params.get('src')) : null;

// ---------- storage ----------
async function load() {
  const d = await chrome.storage.local.get(['listings', 'settings']);
  state.listings = d.listings || [];
  state.settings = { ...S.DEFAULT_SETTINGS, ...(d.settings || {}) };
  // Your Supabase project is built in; fill it in if it was saved empty.
  if (!state.settings.cloudUrl || !state.settings.cloudKey) {
    state.settings.cloudUrl = S.DEFAULT_SETTINGS.cloudUrl;
    state.settings.cloudKey = S.DEFAULT_SETTINGS.cloudKey;
    await chrome.storage.local.set({ settings: state.settings });
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; chrome.storage.local.set({ listings: state.listings }); }, 250);
}
async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await chrome.storage.local.set({ listings: state.listings });
}
const current = () => state.listings.find((l) => l.id === state.selectedId);
const send = (msg) => chrome.runtime.sendMessage(msg);
const aiCfg = () => {
  const provider = state.settings.aiProvider === 'anthropic' ? 'anthropic' : 'gemini';
  return { provider, key: ((provider === 'gemini' ? state.settings.geminiKey : state.settings.apiKey) || '').trim() };
};
const aiReady = () => !!aiCfg().key;
const PROVIDER = {
  gemini: { name: 'Gemini', keyName: 'Google AI Studio API key', placeholder: 'AIza...', help: 'Free. Get one at aistudio.google.com (Get API key). Stored only in this browser.' },
  anthropic: { name: 'Claude', keyName: 'Anthropic API key', placeholder: 'sk-ant-...', help: 'Paid per use. Get one at console.anthropic.com. Stored only in this browser.' },
};

function setStatus(msg, kind = '') {
  const el = $('#importStatus');
  el.textContent = msg;
  el.className = 'status ' + kind;
}

// ---------- the import pipeline ----------
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function getCarfax(raw, say) {
  if (!raw.carfaxUrl) return null;
  say('reading the CARFAX report');
  const r = await send({ type: 'extractCarfax', url: raw.carfaxUrl });
  if (!r || !r.ok) return { error: (r && r.error) || 'CARFAX unavailable', positives: [], negatives: [] };
  const c = S.parseCarfax(r.text);
  return c ? { ...c, url: raw.carfaxUrl } : { error: 'Could not read the CARFAX report', positives: [], negatives: [] };
}

// Banner check on every photo, then (optionally) AI sorting.
async function processPhotos(images, say, { sort = true } = {}) {
  say('checking photos');
  const results = await pool(images, 6, (im) => (im.local ? LHLocal.get(im.local).then((b) => IMG.analyze('', '', b)) : IMG.analyze(im.url, im.fallback)).catch(() => ({ cropTop: 0, thumb: null })));
  let out = images.map((im, i) => ({ ...im, cropTop: results[i].cropTop }));
  let note = '';
  if (sort && state.settings.sortPhotos && aiReady() && results.some((r) => r.thumb)) {
    say('sorting photos with AI');
    try {
      const { labels, hero } = await AI.classifyPhotos(aiCfg(), results.map((r) => r.thumb));
      out = AI.sortImages(out, labels, hero);
      note = 'sorted';
    } catch (e) {
      note = 'AI sort failed: ' + e.message;
    }
  }
  // The dealer's waterfront hero shot is the one that carries the banner: it goes first.
  const heroIdx = out.findIndex((im) => im.cropTop > 0 && (!im.kind || im.kind === 'exterior' || im.kind === 'unknown'));
  if (heroIdx > 0) out.unshift(out.splice(heroIdx, 1)[0]);
  const max = state.settings.maxPhotos || 20;
  // First 20 that aren't "other" (engine bay, keys, papers); free slots go to the rest.
  let on = 0;
  out.forEach((im) => { im.on = im.kind !== 'other' && on < max; if (im.on) on++; });
  out.forEach((im) => { if (!im.on && on < max) { im.on = true; on++; } });
  return { images: out, note };
}

async function writeDescription(rec, say) {
  const fallback = S.describe(rec.raw, rec.fb, state.settings, rec.carfax);
  if (!state.settings.useAI || !aiReady()) return { text: fallback, by: 'template' };
  say('writing the description');
  try {
    const facts = S.factsFor(rec.raw, rec.fb, rec.carfax);
    const { fbListings = [], fbDescriptions = {} } = await chrome.storage.local.get(['fbListings', 'fbDescriptions']);
    const learn = S.learningSet(state.listings, fbListings, rec.id, fbDescriptions);
    const text = await AI.writeDescription(aiCfg(), facts, state.settings.opening, learn);
    rec.learnedFrom = { winners: learn.winners.map((w) => `${w.title} (${w.clicks} clicks)`), edits: learn.edits.length };
    return { text, by: 'ai' };
  } catch (e) {
    return { text: fallback, by: 'template', error: e.message };
  }
}

async function buildRecord(raw, existing, say) {
  const carfax = await getCarfax(raw, say);
  // Keep any photos you added yourself when re-importing.
  const mine = existing ? (existing.images || []).filter((im) => im.local).map(({ local }) => ({ local, url: '', fallback: '' })) : [];
  const photos = await processPhotos([...(raw.images || []).map((im) => ({ url: im.url, fallback: im.fallback || '' })), ...mine], say);
  const rec = {
    id: existing ? existing.id : crypto.randomUUID(),
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
    status: existing ? existing.status : 'draft',
    raw,
    carfax,
    images: photos.images,
    photoNote: photos.note,
  };
  rec.fb = S.toFacebook(raw, state.settings, carfax);
  if (existing && existing.descBy === 'edited' && existing.fb && existing.fb.description) {
    // Keep your own rewrite; re-import only refreshes price, miles, photos and CARFAX.
    rec.fb.description = existing.fb.description;
    rec.descBy = 'edited';
    return rec;
  }
  const d = await writeDescription(rec, say);
  rec.fb.description = d.text;
  rec.descBy = d.by;
  rec.descError = d.error || '';
  return rec;
}

function upsert(rec) {
  const i = state.listings.findIndex((l) => l.id === rec.id);
  if (i >= 0) state.listings[i] = rec;
  else state.listings.unshift(rec);
}

async function importOne(getRaw, label) {
  const say = (step) => setStatus(`${label}: ${step}…`);
  say('reading the dealer page');
  const raw = await getRaw();
  const existing = raw.vin && state.listings.find((l) => l.raw && l.raw.vin === raw.vin);
  const rec = await buildRecord(raw, existing, say);
  upsert(rec);
  await saveNow();
  renderList();
  return rec;
}

async function importUrls(urls) {
  urls = [...new Set(urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
  if (!urls.length) { setStatus('Paste at least one vehicle link.', 'err'); return; }
  if (state.busy) return;
  state.busy = true;
  $('#importBtn').disabled = true;
  let ok = 0, last = null;
  const errors = [];
  const imported = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      last = await importOne(async () => {
        const r = await send({ type: 'extractFromUrl', url: urls[i] });
        if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
        return r.data;
      }, `Vehicle ${i + 1} of ${urls.length}`);
      imported.push(last);
      ok++;
    } catch (e) {
      errors.push(`${urls[i].replace(/^https?:\/\/(www\.)?[^/]+/, '').slice(0, 50)}: ${e.message}`);
    }
  }
  state.busy = false;
  $('#importBtn').disabled = false;
  if (last) select(last.id);
  if (errors.length) setStatus(`Imported ${ok}. Problems: ${errors.join(' · ')}`, 'err');
  else { setStatus(`Imported ${ok} vehicle${ok === 1 ? '' : 's'}.`, 'ok'); $('#urls').value = ''; }
  await autoPostAfterImport(imported);
}

// With Auto post on, newly imported cars go straight to Facebook (in background tabs).
async function autoPostAfterImport(recs) {
  if (!state.settings.autoPost) return;
  const ready = recs.filter((r) => r && r.status !== 'posted' && !missingFields(r).length);
  if (!ready.length) return;
  await post(ready.map((r) => r.id), { quiet: true });
  setStatus(`Auto post: posting ${ready.length} vehicle${ready.length === 1 ? '' : 's'} in background tabs. They publish by themselves when they finish filling.`, 'ok');
}

async function importFromTab() {
  let tab;
  try { tab = await chrome.tabs.get(srcTabId); } catch (e) { setStatus('That tab is no longer open.', 'err'); return; }
  if (!/\/viewdetails\//i.test(tab.url || '')) {
    const r = await send({ type: 'listVehicleLinks', tabId: srcTabId });
    const links = (r && r.links) || [];
    if (links.length > 1) {
      if (!confirm(`This page lists ${links.length} vehicles. Import all of them? It takes about 15 seconds each.`)) return;
      return importUrls(links);
    }
  }
  if (state.busy) return;
  state.busy = true;
  try {
    const rec = await importOne(async () => {
      const r = await send({ type: 'extractFromTab', tabId: srcTabId });
      if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
      return r.data;
    }, 'Importing');
    select(rec.id);
    setStatus(`Imported ${rec.fb.year} ${rec.fb.make} ${rec.fb.model}.`, 'ok');
    await autoPostAfterImport([rec]);
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    state.busy = false;
  }
}

// ---------- list ----------
const money = (n) => (n ? '$' + Number(n).toLocaleString('en-US') : '');
const STATUS = { draft: 'Draft', opened: 'Sent to Facebook', posted: 'Posted' };

function visibleListings() {
  return state.listings.filter((l) =>
    state.filter === 'all' ? true : state.filter === 'posted' ? l.status === 'posted' : l.status !== 'posted'
  );
}

function renderList() {
  const ul = $('#vehicleList');
  ul.innerHTML = '';
  const items = visibleListings();
  $('#emptyList').hidden = items.length > 0;
  for (const l of items) {
    const li = document.createElement('li');
    li.className = l.id === state.selectedId ? 'active' : '';
    const first = l.images.find((i) => i.on) || l.images[0];
    li.innerHTML = `
      <input type="checkbox" class="pick" aria-label="Select">
      <div class="thumb">${first ? '<img alt="" loading="lazy" referrerpolicy="no-referrer">' : ''}</div>
      <div class="info"><div class="t"></div><div class="s muted"></div><span class="chip ${l.status}"></span></div>`;
    if (first) setThumb($('img', li), first);
    $('.t', li).textContent = `${l.fb.year} ${l.fb.make} ${l.fb.model}`;
    $('.s', li).textContent = [money(l.fb.price), l.fb.mileage ? Number(l.fb.mileage).toLocaleString() + ' mi' : '', l.raw.stock ? '#' + l.raw.stock : ''].filter(Boolean).join(' · ');
    $('.chip', li).textContent = STATUS[l.status] || l.status;
    const box = $('.pick', li);
    box.checked = state.checked.has(l.id);
    box.onclick = (e) => { e.stopPropagation(); box.checked ? state.checked.add(l.id) : state.checked.delete(l.id); updateBatch(); };
    li.onclick = () => select(l.id);
    ul.appendChild(li);
  }
  updateBatch();
}

function updateBatch() {
  const ids = visibleListings().map((l) => l.id);
  for (const id of [...state.checked]) if (!state.listings.some((l) => l.id === id)) state.checked.delete(id);
  const n = ids.filter((id) => state.checked.has(id)).length;
  const btn = $('#postSelectedBtn');
  btn.disabled = n === 0;
  btn.textContent = n ? `Post selected (${n})` : 'Post selected';
  $('#selectAll').checked = n > 0 && n === ids.length;
}

function setThumb(img, im) {
  if (im.local) { LHLocal.objectUrl(im.local).then((u) => { if (u) img.src = u; else if (im.cloud) cloudThumb(im.cloud).then((c) => (img.src = c)).catch(() => {}); }); return; }
  if (im.cloud) { cloudThumb(im.cloud).then((u) => (img.src = u)).catch(() => {}); return; }
  img.src = IMG.smallUrl(im.url);
  img.onerror = function () { if (this.src !== im.url) this.src = im.url; };
  if (state.settings.removeBanner && im.cropTop) img.style.objectViewBox = `inset(${(im.cropTop * 100).toFixed(1)}% 0 0 0)`;
}

// ---------- editor ----------
function fillSelect(sel, opts) {
  sel.innerHTML = '<option value="">Choose…</option>' + opts.map((o) => `<option>${o}</option>`).join('');
}

function select(id) {
  state.selectedId = id;
  renderList();
  renderEditor();
}

function renderEditor() {
  const l = current();
  $('#editor').hidden = !l;
  if (!l) return;
  $('#edTitle').textContent = `${l.fb.year} ${l.fb.make} ${l.fb.model}`;
  const meta = $('#edMeta');
  meta.innerHTML = '';
  const a = document.createElement('a');
  a.href = l.raw.sourceUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Dealer page';
  meta.append(a, document.createTextNode([l.raw.stock && `  ·  Stock ${l.raw.stock}`, l.raw.engine && `  ·  ${l.raw.engine}`].filter(Boolean).join('')));
  const chip = $('#edStatus');
  chip.textContent = STATUS[l.status] || l.status;
  chip.className = 'chip ' + l.status;
  $('#markBtn').textContent = l.status === 'posted' ? 'Mark as not posted' : 'Mark as posted';

  for (const el of $$('[data-field]')) {
    const v = l.fb[el.dataset.field];
    if (el.type === 'checkbox') el.checked = !!v;
    else {
      if (el.tagName === 'SELECT' && v && !$$('option', el).some((o) => o.value === String(v))) {
        const o = document.createElement('option'); o.textContent = v; el.appendChild(o);
      }
      el.value = v == null ? '' : v;
    }
  }
  $$('[data-raw]').forEach((el) => { const r = l.raw[el.dataset.raw]; el.textContent = r ? `Dealer: ${r}` : ''; });
  renderHistory(l);
  $('#descHint').textContent =
    l.descBy === 'edited' ? 'Your edit. The AI uses your rewrites to learn how you like posts to sound.'
    : l.descBy === 'ai' ? 'Written by AI from the dealer page and the positive CARFAX facts' + (l.learnedFrom && (l.learnedFrom.winners.length || l.learnedFrom.edits)
        ? `, learning from ${[l.learnedFrom.winners.length ? `your best posts: ${l.learnedFrom.winners.join(', ')}` : '', l.learnedFrom.edits ? `${l.learnedFrom.edits} of your own rewrites` : ''].filter(Boolean).join(' and ')}.`
        : '. It learns from your best posts once you sync with Facebook.') + ' Edit anything before posting.'
      : l.descError ? `AI writer failed (${l.descError}), so this is the basic version.`
        : aiReady() && state.settings.useAI ? 'Basic version. Click "Rewrite with AI" for an AI written one.'
          : 'Basic version. Add an API key in Settings to have AI write these.';
  $('#regenBtn').disabled = !aiReady();
  $('#sortBtn').disabled = !aiReady();
  renderPhotos();
}

function renderHistory(l) {
  const box = $('#history');
  const c = l.carfax;
  const link = $('#carfaxLink');
  link.hidden = !l.raw.carfaxUrl;
  if (l.raw.carfaxUrl) link.href = l.raw.carfaxUrl;
  if (!c) { box.innerHTML = '<p class="muted">No CARFAX link on the dealer page.</p>'; return; }
  if (c.error) { box.innerHTML = ''; const p = document.createElement('p'); p.className = 'muted'; p.textContent = c.error; box.appendChild(p); return; }
  box.innerHTML = '<div class="col good"><h4>Used in the post</h4><ul></ul></div><div class="col bad"><h4>Left out</h4><ul></ul></div>';
  const add = (ul, items, empty) => {
    if (!items.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = empty; ul.appendChild(li); return; }
    items.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  };
  add($('.good ul', box), c.positives, 'Nothing stood out');
  add($('.bad ul', box), c.negatives, 'Nothing to leave out');
}

const KIND = { exterior: 'Ext', exterior_detail: 'Detail', interior: 'Int', other: 'Other' };

function renderPhotos() {
  const l = current();
  const live = window.Dash && Dash.liveFor && Dash.liveFor(l.id);
  $('#fbPhotosBtn').hidden = !live;
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const max = state.settings.maxPhotos || 20;
  let onIndex = 0;
  l.images.forEach((im, i) => {
    const d = document.createElement('div');
    d.className = 'ph' + (im.on ? ' on' : '');
    d.draggable = true;
    const n = im.on ? ++onIndex : 0;
    if (n > max) d.classList.add('over');
    d.innerHTML = `<img alt="" loading="lazy" referrerpolicy="no-referrer"><span class="n">${im.on ? n : ''}</span>` +
      (im.kind && KIND[im.kind] ? `<span class="kind ${im.kind}">${KIND[im.kind]}</span>` : '') +
      (im.cropTop && state.settings.removeBanner ? '<span class="trim" title="Dealer banner will be trimmed off">Banner off</span>' : '') +
      (im.local ? '<span class="mine">Yours</span><button class="rm" title="Remove this photo">×</button>' : '');
    setThumb($('img', d), im);
    d.onclick = () => { im.on = !im.on; save(); renderPhotos(); renderList(); };
    const rm = $('.rm', d);
    if (rm) rm.onclick = async (e) => {
      e.stopPropagation();
      l.images.splice(i, 1);
      await LHLocal.del(im.local).catch(() => {});
      await saveNow(); renderPhotos(); renderList();
    };
    d.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(i)); d.classList.add('drag'); };
    d.ondragend = () => d.classList.remove('drag');
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('target'); };
    d.ondragleave = () => d.classList.remove('target');
    d.ondrop = (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (from === i || Number.isNaN(from)) return;
      const [moved] = l.images.splice(from, 1);
      l.images.splice(i, 0, moved);
      save(); renderPhotos(); renderList();
    };
    grid.appendChild(d);
  });
  const on = l.images.filter((i) => i.on).length;
  const trimmed = l.images.filter((i) => i.on && i.cropTop).length;
  $('#photoCount').textContent = `${Math.min(on, max)} of ${l.images.length} selected` + (on > max ? ` (only the first ${max} upload)` : '');
  $('#photoHint').textContent =
    (l.photoNote === 'sorted' ? 'Sorted by AI: exterior first, then details, interior, and other. ' : l.photoNote ? `${l.photoNote}. ` : '') +
    (trimmed && state.settings.removeBanner ? `The dealer banner gets trimmed off ${trimmed} photo${trimmed > 1 ? 's' : ''}. ` : '') +
    'Drag to reorder. Click a photo to include or skip it.';
}

function onFieldChange(e) {
  const el = e.target;
  const f = el.dataset.field;
  const l = current();
  if (!f || !l) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (['year', 'mileage', 'price'].includes(f)) v = v === '' ? '' : Math.round(Number(v));
  if (f === 'vin') v = String(v).toUpperCase();
  if (f === 'description') l.descBy = 'edited'; // your rewrites teach the AI your voice
  l.fb[f] = v;
  l.updatedAt = Date.now();
  save();
  if (['year', 'make', 'model', 'price', 'mileage'].includes(f)) {
    $('#edTitle').textContent = `${l.fb.year} ${l.fb.make} ${l.fb.model}`;
    renderList();
  }
}

// ---------- actions ----------
function missingFields(l) {
  return ['year', 'make', 'model', 'price', 'mileage'].filter((f) => !l.fb[f]);
}

async function post(ids, { quiet = false } = {}) {
  const list = ids.map((id) => state.listings.find((l) => l.id === id)).filter(Boolean);
  const bad = list.filter((l) => missingFields(l).length);
  if (bad.length) {
    alert(bad.map((l) => `${l.fb.year} ${l.fb.make} ${l.fb.model}: fill in ${missingFields(l).join(', ')}`).join('\n'));
    return;
  }
  if (!quiet && list.length > 6 && !confirm(`Open ${list.length} Facebook tabs at once? Each one fills on its own. Posting a lot at once can make Facebook slow you down, so 5 or 6 at a time is safer.`)) return;
  list.forEach((l) => { if (l.status !== 'posted') l.status = 'opened'; });
  await saveNow();
  renderList();
  renderEditor();
  await send({ type: 'openComposer', ids: list.map((l) => l.id) });
  if (!quiet) setStatus(`Opened ${list.length} Facebook tab${list.length === 1 ? '' : 's'} in the background.${state.settings.autoPost ? ' Auto post will publish when filling finishes.' : ' Switch to a tab to review and publish.'}`, 'ok');
}

async function reimport() {
  const l = current();
  if (state.busy) return;
  state.busy = true;
  try {
    const rec = await importOne(async () => {
      const r = await send({ type: 'extractFromUrl', url: l.raw.sourceUrl });
      if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
      return r.data;
    }, 'Re-importing');
    select(rec.id);
    setStatus('Updated with the latest price, miles, photos and CARFAX.', 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    state.busy = false;
  }
}

async function rewrite() {
  const l = current();
  $('#regenBtn').disabled = true;
  $('#regenBtn').textContent = 'Writing…';
  const d = await writeDescription(l, () => {});
  l.fb.description = d.text;
  l.descBy = d.by;
  l.descError = d.error || '';
  await saveNow();
  $('#regenBtn').textContent = 'Rewrite with AI';
  renderEditor();
}

// Your own photos go in after the dealer's exterior shots and are turned on.
async function addOwnPhotos(files) {
  const l = current();
  if (!l || !files.length) return;
  const btn = $('#addPhotosBtn');
  btn.disabled = true;
  try {
    let n = 0;
    for (const f of files) {
      btn.textContent = `Adding ${++n} of ${files.length}…`;
      const id = await LHLocal.add(f);
      l.images.push({ local: id, url: '', fallback: '', on: true, cropTop: 0, kind: '' });
    }
    l.updatedAt = Date.now();
    await saveNow();
    setStatus(`Added ${files.length} photo${files.length === 1 ? '' : 's'}. Drag to put them where you want, or click "Sort with AI".`, 'ok');
  } catch (e) {
    setStatus(`Couldn't add photos: ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add your photos';
    renderPhotos(); renderList();
  }
}

async function resort() {
  const l = current();
  $('#sortBtn').disabled = true;
  $('#sortBtn').textContent = 'Sorting…';
  const r = await processPhotos(l.images.map(({ url, fallback, local }) => ({ url, fallback, local })), () => {});
  l.images = r.images;
  l.photoNote = r.note;
  await saveNow();
  $('#sortBtn').textContent = 'Sort with AI';
  renderEditor();
  renderList();
}

// ---------- settings ----------
const SETTING_INPUTS = {
  opening: '#setOpening', location: '#setLocation', condition: '#setCondition',
  useAI: '#setUseAI', sortPhotos: '#setSortPhotos', removeBanner: '#setRemoveBanner', autoFill: '#setAutoFill',
  fillVin: '#setFillVin', fillLocation: '#setFillLocation', cloudUrl: '#setCloudUrl', cloudKey: '#setCloudKey',
};

const keyDraft = { gemini: '', anthropic: '' };
function showProvider() {
  const p = PROVIDER[$('#setProvider').value];
  $('#keyLabel').textContent = p.keyName;
  $('#setApiKey').placeholder = p.placeholder;
  $('#setApiKey').value = keyDraft[$('#setProvider').value] || '';
  $('#keyStatus').textContent = p.help;
}

// ---------- phone app / cloud ----------
const PHONE_APP_URL = 'https://dattran9534.github.io/lh-marketplace-lister/';
const chromeStore = { get: async (k) => (await chrome.storage.local.get(k))[k], set: async (k, v) => chrome.storage.local.set({ [k]: v }) };
function cloudClient(urlOverride, keyOverride) {
  const url = urlOverride || state.settings.cloudUrl, key = keyOverride || state.settings.cloudKey;
  return url && key ? LHCloud({ url, key, store: chromeStore }) : null;
}

async function renderCloud() {
  const c = cloudClient();
  const who = c && (await c.user());
  $('#cloudSignedOut').hidden = !!who;
  $('#cloudSignedIn').hidden = !who;
  $('#cloudWho').textContent = who ? `Signed in as ${who.email}` : '';
  const { cloudLastSync, cloudError } = await chrome.storage.local.get(['cloudLastSync', 'cloudError']);
  $('#cloudStatus').textContent = !who ? 'Not connected.' : cloudError ? `Last sync problem: ${cloudError}` : cloudLastSync ? `Last synced ${new Date(cloudLastSync).toLocaleTimeString()}.` : 'Waiting for the first sync.';
  const a = $('#phoneLink'); a.href = PHONE_APP_URL; a.textContent = PHONE_APP_URL;
}

async function cloudAuth(mode) {
  const url = $('#setCloudUrl').value.trim(), key = $('#setCloudKey').value.trim();
  const email = $('#cloudEmail').value.trim(), pw = $('#cloudPassword').value;
  if (!url || !key) { $('#cloudStatus').textContent = 'Paste the project URL and publishable key first.'; return; }
  if (!email || pw.length < 6) { $('#cloudStatus').textContent = 'Enter your email and a password of at least 6 characters.'; return; }
  state.settings.cloudUrl = url; state.settings.cloudKey = key;
  await chrome.storage.local.set({ settings: state.settings });
  const c = cloudClient();
  $('#cloudStatus').textContent = mode === 'up' ? 'Creating your account…' : 'Signing in…';
  try {
    if (mode === 'up') {
      const r = await c.signUp(email, pw);
      if (r.confirm) { $('#cloudStatus').textContent = 'Check your email and click the confirm link (the page it opens may look broken, that is fine). Then come back and click Sign in.'; return; }
    } else {
      await c.signIn(email, pw);
    }
    $('#cloudPassword').value = '';
    await send({ type: 'cloudSyncNow' });
  } catch (e) {
    $('#cloudStatus').textContent = /confirm/i.test(e.message) ? 'Confirm your email first (check your inbox), then Sign in.' : e.message;
    return;
  }
  renderCloud();
}

// The phone asked this PC to import a car: done in a background tab, then it closes.
async function runPhoneImport() {
  const cmdId = params.get('cmd'), url = params.get('importUrl');
  if (!cmdId || !url) return;
  const c = cloudClient();
  let status = 'done', result = '';
  try {
    const rec = await importOne(async () => {
      const r = await send({ type: 'extractFromUrl', url });
      if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
      return r.data;
    }, 'Importing for your phone');
    result = `Imported ${rec.fb.year} ${rec.fb.make} ${rec.fb.model}`;
    await autoPostAfterImport([rec]);
  } catch (e) {
    status = 'failed'; result = e.message;
  }
  if (c) await c.db.update('commands', { id: cmdId }, { status, result, done_at: new Date().toISOString() }).catch(() => {});
  await send({ type: 'cloudSyncNow' });
  const me = await chrome.tabs.getCurrent();
  if (me) chrome.tabs.remove(me.id);
}

// Photos added on the phone show up here from the cloud.
const cloudUrls = new Map();
async function cloudThumb(path) {
  if (cloudUrls.has(path)) return cloudUrls.get(path);
  const c = cloudClient();
  if (!c) return '';
  const u = URL.createObjectURL(await c.photos.download(path));
  cloudUrls.set(path, u);
  return u;
}

function openSettings() {
  fillSelect($('#setCondition'), S.FB.conditions);
  for (const [k, sel] of Object.entries(SETTING_INPUTS)) {
    const el = $(sel);
    if (el.type === 'checkbox') el.checked = !!state.settings[k];
    else el.value = state.settings[k] || '';
  }
  $('#setVersion').textContent = `Version ${chrome.runtime.getManifest().version}`;
  keyDraft.gemini = state.settings.geminiKey || '';
  keyDraft.anthropic = state.settings.apiKey || '';
  $('#setProvider').value = aiCfg().provider;
  $('#setProvider').dataset.prev = aiCfg().provider;
  showProvider();
  $('#updateStatus').textContent = '';
  renderCloud();
  $('#settingsDlg').showModal();
}

async function saveSettings() {
  for (const [k, sel] of Object.entries(SETTING_INPUTS)) {
    const el = $(sel);
    state.settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  keyDraft[$('#setProvider').value] = $('#setApiKey').value.trim();
  state.settings.aiProvider = $('#setProvider').value;
  state.settings.geminiKey = keyDraft.gemini;
  state.settings.apiKey = keyDraft.anthropic;
  if (!state.settings.condition) state.settings.condition = 'Excellent';
  await chrome.storage.local.set({ settings: state.settings });
  renderAiTag();
  renderEditor();
}

function renderAiTag() {
  const t = $('#aiTag');
  const p = PROVIDER[aiCfg().provider];
  t.textContent = aiReady() ? `AI on (${p.name})` : 'AI off';
  t.className = 'chip ' + (aiReady() ? 'posted' : '');
  t.title = aiReady() ? `Descriptions and photo sorting use ${p.name}` : 'Add a free Gemini API key in Settings';
}

// ---------- updates ----------
let updateInfo = null;
async function checkForUpdate(manual) {
  try {
    const info = await LHUpdater.check(state.settings.updateSource);
    updateInfo = info.available ? info : null;
    $('#updateBar').hidden = !info.available;
    $('#settingsUpdateBtn').hidden = !info.available;
    if (info.available) $('#settingsUpdateBtn').textContent = `Update now to ${info.version}`;
    if (info.available) $('#updateText').textContent = `Version ${info.version} is ready${info.notes ? `: ${info.notes}` : '.'}`;
    if (manual) $('#updateStatus').textContent = info.available ? `Version ${info.version} is available.` : "You're on the latest version.";
  } catch (e) {
    $('#settingsUpdateBtn').hidden = true;
    if (manual) $('#updateStatus').textContent = e.message;
  }
}

async function runUpdate(forcePick) {
  if (!updateInfo) return;
  const btn = $('#updateBtn');
  btn.disabled = true;
  try {
    await LHUpdater.install(updateInfo, (s) => ($('#updateText').textContent = s), forcePick);
  } catch (e) {
    btn.disabled = false;
    if (e && e.name === 'AbortError') { $('#updateText').textContent = 'Update cancelled.'; return; }
    $('#updateText').textContent = e.message;
  }
}

// ---------- init ----------
async function init() {
  await load();
  $('#versionTag').textContent = `v${chrome.runtime.getManifest().version}`;
  $$('select[data-opts]').forEach((sel) => fillSelect(sel, S.FB[sel.dataset.opts]));
  $$('[data-field]').forEach((el) => { el.addEventListener('input', onFieldChange); el.addEventListener('change', onFieldChange); });

  $('#importBtn').onclick = () => importUrls($('#urls').value.split(/\s+/));
  $('#urls').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#importBtn').click(); });
  if (srcTabId != null) {
    try {
      const t = await chrome.tabs.get(srcTabId);
      if (t && /^https?:/.test(t.url || '')) {
        const btn = $('#importTabBtn');
        btn.hidden = false;
        btn.textContent = /\/viewdetails\//i.test(t.url) ? 'Import the page I was on' : 'Import from the page I was on';
        btn.title = t.title || t.url;
        btn.onclick = importFromTab;
      }
    } catch (e) {}
  }
  $('#filter').onchange = (e) => { state.filter = e.target.value; renderList(); };
  $('#selectAll').onchange = (e) => {
    visibleListings().forEach((l) => (e.target.checked ? state.checked.add(l.id) : state.checked.delete(l.id)));
    renderList();
  };
  $('#postSelectedBtn').onclick = () => post(visibleListings().filter((l) => state.checked.has(l.id)).map((l) => l.id));
  $('#photosFirst20').onclick = () => { const l = current(); l.images.forEach((im, i) => (im.on = i < 20)); save(); renderPhotos(); };
  $('#photosNone').onclick = () => { current().images.forEach((im) => (im.on = false)); save(); renderPhotos(); };
  $('#sortBtn').onclick = resort;
  $('#fbPhotosBtn').onclick = () => Dash.updatePhotos(current().id);
  $('#addPhotosBtn').onclick = () => $('#addPhotosInput').click();
  $('#addPhotosInput').onchange = async (e) => { await addOwnPhotos([...e.target.files]); e.target.value = ''; };
  const grid = $('#photoGrid');
  grid.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); grid.classList.add('dropping'); } });
  grid.addEventListener('dragleave', () => grid.classList.remove('dropping'));
  grid.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    grid.classList.remove('dropping');
    await addOwnPhotos([...e.dataTransfer.files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name)));
  });
  $('#regenBtn').onclick = rewrite;
  $('#copyBtn').onclick = async () => {
    await navigator.clipboard.writeText(current().fb.description || '');
    $('#copyBtn').textContent = 'Copied';
    setTimeout(() => ($('#copyBtn').textContent = 'Copy'), 1200);
  };
  $('#postBtn').onclick = () => post([current().id]);
  $('#markBtn').onclick = async () => {
    const l = current();
    l.status = l.status === 'posted' ? 'draft' : 'posted';
    await saveNow();
    renderList(); renderEditor();
  };
  $('#refreshBtn').onclick = reimport;
  $('#deleteBtn').onclick = async () => {
    const l = current();
    if (!confirm(`Delete ${l.fb.year} ${l.fb.make} ${l.fb.model} from this list?`)) return;
    state.listings = state.listings.filter((x) => x.id !== l.id);
    state.checked.delete(l.id);
    state.selectedId = null;
    await saveNow();
    renderList(); renderEditor();
  };
  $('#settingsBtn').onclick = openSettings;
  $('#saveSettings').onclick = saveSettings;
  $('#testKeyBtn').onclick = async () => {
    const cfg = { provider: $('#setProvider').value, key: $('#setApiKey').value.trim() };
    if (!cfg.key) { $('#keyStatus').textContent = 'Paste a key first.'; return; }
    $('#keyStatus').textContent = 'Testing…';
    try { await AI.testKey(cfg); $('#keyStatus').textContent = 'Key works.'; }
    catch (e) { $('#keyStatus').textContent = e.message; }
  };
  $('#setProvider').onchange = (e) => {
    keyDraft[e.target.dataset.prev || 'gemini'] = $('#setApiKey').value.trim();
    e.target.dataset.prev = e.target.value;
    showProvider();
  };
  $('#setProvider').onfocus = (e) => { e.target.dataset.prev = e.target.value; };
  $('#checkUpdateBtn').onclick = () => checkForUpdate(true);
  $('#settingsUpdateBtn').onclick = () => { $('#settingsDlg').close(); runUpdate(false); };
  $('#repickFolderBtn').onclick = async () => {
    try { await LHUpdater.pickFolder(); $('#updateStatus').textContent = 'Folder saved for updates.'; }
    catch (e) { if (e.name !== 'AbortError') $('#updateStatus').textContent = e.message; }
  };
  $('#updateBtn').onclick = () => runUpdate(false);

  renderAiTag();
  renderList();
  const first = state.listings.find((l) => l.status !== 'posted') || state.listings[0];
  if (first) select(first.id);
  $('#cloudSignInBtn').onclick = () => cloudAuth('in');
  $('#cloudSignUpBtn').onclick = () => cloudAuth('up');
  $('#cloudSignOutBtn').onclick = async () => { const c = cloudClient(); if (c) await c.signOut(); renderCloud(); };
  $('#cloudSyncBtn').onclick = async () => { $('#cloudStatus').textContent = 'Syncing…'; await send({ type: 'cloudSyncNow' }); renderCloud(); };
  if (params.get('cmd')) { runPhoneImport(); return; }
  if (params.get('updated')) setStatus(`Updated to version ${chrome.runtime.getManifest().version}.`, 'ok');
  else if (!aiReady()) setStatus('Tip: add a free Gemini API key in Settings so AI can write descriptions and sort photos.');
  // dashboard.js loads after this file; wait for it instead of racing it.
  if (!window.Dash && document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  if (window.Dash) await Dash.init();
  checkForUpdate(false);
}

init();
