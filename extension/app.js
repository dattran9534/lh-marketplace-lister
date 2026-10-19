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
const aiReady = () => !!(state.settings.apiKey && state.settings.apiKey.trim());

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
  const results = await pool(images, 6, (im) => IMG.analyze(im.url, im.fallback).catch(() => ({ cropTop: 0, thumb: null })));
  let out = images.map((im, i) => ({ ...im, cropTop: results[i].cropTop }));
  let note = '';
  if (sort && state.settings.sortPhotos && aiReady() && results.some((r) => r.thumb)) {
    say('sorting photos with AI');
    try {
      const { labels, hero } = await AI.classifyPhotos(state.settings.apiKey, results.map((r) => r.thumb));
      out = AI.sortImages(out, labels, hero);
      note = 'sorted';
    } catch (e) {
      note = 'AI sort failed: ' + e.message;
    }
  }
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
    const text = await AI.writeDescription(state.settings.apiKey, facts, state.settings.opening);
    return { text, by: 'ai' };
  } catch (e) {
    return { text: fallback, by: 'template', error: e.message };
  }
}

async function buildRecord(raw, existing, say) {
  const carfax = await getCarfax(raw, say);
  const photos = await processPhotos((raw.images || []).map((im) => ({ url: im.url, fallback: im.fallback || '' })), say);
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
  for (let i = 0; i < urls.length; i++) {
    try {
      last = await importOne(async () => {
        const r = await send({ type: 'extractFromUrl', url: urls[i] });
        if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
        return r.data;
      }, `Vehicle ${i + 1} of ${urls.length}`);
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
    l.descBy === 'ai' ? 'Written by AI from the dealer page and the positive CARFAX facts. Edit anything before posting.'
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
      (im.cropTop && state.settings.removeBanner ? '<span class="trim" title="Dealer banner will be trimmed off">Banner off</span>' : '');
    setThumb($('img', d), im);
    d.onclick = () => { im.on = !im.on; save(); renderPhotos(); renderList(); };
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

async function post(ids) {
  const list = ids.map((id) => state.listings.find((l) => l.id === id)).filter(Boolean);
  const bad = list.filter((l) => missingFields(l).length);
  if (bad.length) {
    alert(bad.map((l) => `${l.fb.year} ${l.fb.make} ${l.fb.model}: fill in ${missingFields(l).join(', ')}`).join('\n'));
    return;
  }
  if (list.length > 6 && !confirm(`Open ${list.length} Facebook tabs at once? Each one fills on its own. Posting a lot at once can make Facebook slow you down, so 5 or 6 at a time is safer.`)) return;
  list.forEach((l) => { if (l.status !== 'posted') l.status = 'opened'; });
  await saveNow();
  renderList();
  renderEditor();
  await send({ type: 'openComposer', ids: list.map((l) => l.id) });
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

async function resort() {
  const l = current();
  $('#sortBtn').disabled = true;
  $('#sortBtn').textContent = 'Sorting…';
  const r = await processPhotos(l.images.map(({ url, fallback }) => ({ url, fallback })), () => {});
  l.images = r.images;
  l.photoNote = r.note;
  await saveNow();
  $('#sortBtn').textContent = 'Sort with AI';
  renderEditor();
  renderList();
}

// ---------- settings ----------
const SETTING_INPUTS = {
  apiKey: '#setApiKey', opening: '#setOpening', location: '#setLocation', condition: '#setCondition',
  useAI: '#setUseAI', sortPhotos: '#setSortPhotos', removeBanner: '#setRemoveBanner', autoFill: '#setAutoFill',
  fillVin: '#setFillVin', fillLocation: '#setFillLocation',
};

function openSettings() {
  fillSelect($('#setCondition'), S.FB.conditions);
  for (const [k, sel] of Object.entries(SETTING_INPUTS)) {
    const el = $(sel);
    if (el.type === 'checkbox') el.checked = !!state.settings[k];
    else el.value = state.settings[k] || '';
  }
  $('#setVersion').textContent = `Version ${chrome.runtime.getManifest().version}`;
  $('#keyStatus').textContent = 'Stored only in this browser. Get one at console.anthropic.com.';
  $('#updateStatus').textContent = '';
  $('#settingsDlg').showModal();
}

async function saveSettings() {
  for (const [k, sel] of Object.entries(SETTING_INPUTS)) {
    const el = $(sel);
    state.settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  if (!state.settings.condition) state.settings.condition = 'Excellent';
  await chrome.storage.local.set({ settings: state.settings });
  renderAiTag();
  renderEditor();
}

function renderAiTag() {
  const t = $('#aiTag');
  t.textContent = aiReady() ? 'AI on' : 'AI off';
  t.className = 'chip ' + (aiReady() ? 'posted' : '');
  t.title = aiReady() ? 'Descriptions and photo sorting use Claude' : 'Add an Anthropic API key in Settings';
}

// ---------- updates ----------
let updateInfo = null;
async function checkForUpdate(manual) {
  try {
    const info = await LHUpdater.check(state.settings.updateSource);
    updateInfo = info.available ? info : null;
    $('#updateBar').hidden = !info.available;
    if (info.available) $('#updateText').textContent = `Version ${info.version} is ready${info.notes ? `: ${info.notes}` : '.'}`;
    if (manual) $('#updateStatus').textContent = info.available ? `Version ${info.version} is available.` : "You're on the latest version.";
  } catch (e) {
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
    const key = $('#setApiKey').value.trim();
    $('#keyStatus').textContent = 'Testing…';
    try { await AI.testKey(key); $('#keyStatus').textContent = 'Key works.'; }
    catch (e) { $('#keyStatus').textContent = e.message; }
  };
  $('#checkUpdateBtn').onclick = () => checkForUpdate(true);
  $('#repickFolderBtn').onclick = async () => {
    try { await LHUpdater.pickFolder(); $('#updateStatus').textContent = 'Folder saved for updates.'; }
    catch (e) { if (e.name !== 'AbortError') $('#updateStatus').textContent = e.message; }
  };
  $('#updateBtn').onclick = () => runUpdate(false);

  renderAiTag();
  renderList();
  const first = state.listings.find((l) => l.status !== 'posted') || state.listings[0];
  if (first) select(first.id);
  if (params.get('updated')) setStatus(`Updated to version ${chrome.runtime.getManifest().version}.`, 'ok');
  else if (!aiReady()) setStatus('Tip: add your Anthropic API key in Settings so AI can write descriptions and sort photos.');
  checkForUpdate(false);
}

init();
