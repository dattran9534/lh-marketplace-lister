/* Runs on facebook.com. On the Marketplace vehicle composer it shows a small
 * panel that fills the "Vehicle for sale" form from a saved vehicle.
 * It never clicks Next or Publish: you review and publish yourself. */
(() => {
  if (window.__lhmlLoaded) return;
  window.__lhmlLoaded = true;

  const COMPOSER = /^\/marketplace\/create\/vehicle/;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const visible = (el) => !!(el && el.getClientRects().length);
  const PANEL_ID = 'lhml-panel';
  const inPanel = (el) => !!el.closest('#' + PANEL_ID);

  const ALIASES = {
    Gray: ['Gray', 'Grey'],
    'Automatic transmission': ['Automatic transmission', 'Automatic'],
    'Manual transmission': ['Manual transmission', 'Manual'],
    Gasoline: ['Gasoline', 'Petrol'],
    'Small Car': ['Small Car', 'Small car'],
  };

  // ---------- field helpers ----------
  function leafText(el) {
    const a = el.getAttribute('aria-label');
    if (a) return a;
    for (const s of el.querySelectorAll('span')) {
      if (!s.children.length && s.textContent.trim()) return s.textContent.trim();
    }
    return '';
  }

  function findField(label) {
    const want = norm(label);
    const els = [...document.querySelectorAll('label, [role="combobox"]')].filter((e) => visible(e) && !inPanel(e));
    return els.find((e) => norm(leafText(e)) === want) || els.find((e) => norm(leafText(e)).startsWith(want)) || null;
  }

  async function waitFor(fn, timeout = 6000, step = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function setNativeValue(input, value) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function typeInto(input, value) {
    value = String(value);
    input.focus();
    input.click();
    await sleep(60);
    input.select && input.select();
    document.execCommand('selectAll', false, null);
    let ok = false;
    try { ok = document.execCommand('insertText', false, value); } catch (e) {}
    await sleep(60);
    if (!ok || !norm(input.value).includes(norm(value).slice(0, 40))) setNativeValue(input, value);
    await sleep(80);
  }

  async function setText(label, value) {
    if (value === '' || value == null) return 'skipped (empty)';
    const f = await waitFor(() => findField(label), 4000);
    if (!f) throw new Error('field not on the page');
    const input = f.matches('input, textarea') ? f : f.querySelector('input, textarea');
    if (!input) throw new Error('no text box in field');
    await typeInto(input, value);
    input.blur();
    return String(value).length > 40 ? 'filled' : String(value);
  }

  function optionsFor(box) {
    const id = box.getAttribute('aria-controls');
    const lb = id ? document.getElementById(id) : null;
    if (lb) return [...lb.querySelectorAll('[role="option"]')];
    // Fallback: the visible listbox.
    const vis = [...document.querySelectorAll('[role="listbox"]')].filter(visible).pop();
    return vis ? [...vis.querySelectorAll('[role="option"]')] : [];
  }

  async function choose(label, value) {
    if (!value) return 'skipped (no value)';
    const box = await waitFor(() => findField(label), 5000);
    if (!box) throw new Error('field not on the page');
    const cands = (ALIASES[value] || [value]).map(norm);
    const matchIn = (opts) =>
      opts.find((o) => cands.includes(norm(o.textContent))) ||
      opts.find((o) => cands.some((c) => c && norm(o.textContent).startsWith(c)));

    if (box.getAttribute('aria-expanded') !== 'true') box.click();
    const opt = await waitFor(() => matchIn(optionsFor(box)), 3000);
    if (!opt) {
      if (box.getAttribute('aria-expanded') === 'true') box.click();
      throw new Error(`"${value}" is not one of the choices`);
    }
    opt.scrollIntoView({ block: 'nearest' });
    await sleep(60);
    opt.click();
    await sleep(250);
    if (box.getAttribute('aria-expanded') === 'true') box.click();
    return opt.textContent.trim();
  }

  async function setCheckbox(ariaStart, checked) {
    const cb = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')].find((c) =>
      norm(c.getAttribute('aria-label')).startsWith(norm(ariaStart))
    );
    if (!cb) throw new Error('checkbox not on the page');
    const isOn = cb.getAttribute('aria-checked') === 'true' || cb.checked === true;
    if (isOn !== !!checked) { (cb.closest('label') || cb).click(); await sleep(200); }
    return checked ? 'checked' : 'left unchecked';
  }

  async function setLocation(value) {
    if (!value) return 'skipped (empty)';
    const input = document.querySelector('input[aria-label="Location"]') || (findField('Location') || {}).querySelector?.('input');
    if (!input) throw new Error('field not on the page');
    await typeInto(input, value);
    const id = input.getAttribute('aria-controls');
    const opt = await waitFor(() => {
      const lb = id && document.getElementById(id);
      const opts = lb ? [...lb.querySelectorAll('[role="option"]')] : [...document.querySelectorAll('[role="listbox"] [role="option"]')].filter(visible);
      return opts[0];
    }, 4000);
    if (!opt) throw new Error('no location suggestion appeared');
    opt.click();
    await sleep(250);
    return opt.textContent.trim();
  }

  // ---------- photos ----------
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function addPhotos(images, report) {
    if (!images.length) return 'no photos selected';
    const input = [...document.querySelectorAll('input[type="file"]')].find((i) => /image/.test(i.accept || ''));
    if (!input) throw new Error('photo upload box not found');
    const files = new Array(images.length);
    let done = 0, failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < images.length) {
        const i = next++;
        const r = await chrome.runtime.sendMessage({ type: 'fetchImage', url: images[i].url, fallback: images[i].fallback });
        if (r && r.ok) {
          const removeBanner = settingsCache.removeBanner !== false;
          const jpg = await LHImage.finalize(dataUrlToBlob(r.dataUrl), removeBanner ? images[i].cropTop || 0 : 0);
          files[i] = new File([jpg], `photo-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' });
        } else failed++;
        done++;
        report(`downloading ${done}/${images.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const dt = new DataTransfer();
    files.filter(Boolean).forEach((f) => dt.items.add(f));
    if (!dt.files.length) throw new Error('none of the photos downloaded');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return `${dt.files.length} added${failed ? `, ${failed} failed` : ''}`;
  }

  // ---------- panel ----------
  let panel, logEl, selectEl, running = false;

  function log(name, state, detail) {
    let row = logEl.querySelector(`[data-step="${CSS.escape(name)}"]`);
    if (!row) {
      row = document.createElement('li');
      row.dataset.step = name;
      row.innerHTML = '<span class="ic"></span><span class="nm"></span><span class="dt"></span>';
      row.querySelector('.nm').textContent = name;
      logEl.appendChild(row);
    }
    row.className = state;
    row.querySelector('.ic').textContent = state === 'ok' ? '✓' : state === 'err' ? '!' : state === 'skip' ? '–' : '…';
    row.querySelector('.dt').textContent = detail || '';
  }

  async function step(name, fn) {
    log(name, 'run');
    try {
      const res = await fn((d) => log(name, 'run', d));
      log(name, /^skipped|^left/.test(res) ? 'skip' : 'ok', res);
    } catch (e) {
      log(name, 'err', e.message || String(e));
    }
  }

  async function fill(listing, settings, only) {
    if (running) return;
    running = true;
    panel.querySelectorAll('button').forEach((b) => (b.disabled = true));
    logEl.innerHTML = '';
    const fb = listing.fb;
    const photos = (listing.images || []).filter((i) => i.on).slice(0, settings.maxPhotos || 20);
    try {
      if (only === 'photos') { await step('Photos', (r) => addPhotos(photos, r)); return; }
      await step('Vehicle type', () => choose('Vehicle type', fb.vehicleType || 'Car/Truck'));
      await waitFor(() => findField('Mileage'), 5000);
      // VIN is optional: Facebook decodes it and can add its own (sometimes wrong)
      // specs like engine size. Filled first so our values win for the fields below.
      if (settings.fillVin && fb.vin) { await step('VIN', () => setText('VIN', fb.vin)); await sleep(1200); }
      const photoJob = only === 'details' ? null : step('Photos', (r) => addPhotos(photos, r));
      if (settings.fillLocation) await step('Location', () => setLocation(fb.location));
      await step('Year', () => choose('Year', String(fb.year)));
      await step('Make', async () => {
        const box = findField('Make');
        if (box && box.querySelector('input')) return setText('Make', fb.make);
        return choose('Make', fb.make);
      });
      await step('Model', () => setText('Model', fb.model));
      await step('Mileage', () => setText('Mileage', fb.mileage));
      await step('Price', () => setText('Price', fb.price));
      await step('Body style', () => choose('Body style', fb.bodyStyle));
      await step('Exterior color', () => choose('Exterior color', fb.exteriorColor));
      await step('Interior color', () => choose('Interior color', fb.interiorColor));
      await step('Clean title', () => setCheckbox('This vehicle has a clean title', fb.cleanTitle));
      await step('Condition', () => choose('Vehicle condition', fb.condition));
      await step('Fuel type', () => choose('Fuel type', fb.fuelType));
      await step('Transmission', () => choose('Transmission', fb.transmission));
      await step('Description', () => setText('Description', fb.description));
      if (photoJob) await photoJob;
      const errs = logEl.querySelectorAll('li.err').length;
      panel.querySelector('.lhml-foot').textContent = errs
        ? `Done. ${errs} field${errs > 1 ? 's' : ''} need a quick look, then review and publish.`
        : 'Done. Review the listing, then publish it yourself.';
    } finally {
      running = false;
      panel.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  let settingsCache = {};
  async function getData() {
    const d = await chrome.storage.local.get(['listings', 'settings']);
    settingsCache = { maxPhotos: 20, fillLocation: false, autoFill: true, fillVin: false, removeBanner: true, ...(d.settings || {}) };
    return { listings: d.listings || [], settings: settingsCache };
  }

  async function mount() {
    if (document.getElementById(PANEL_ID)) return;
    const { listings, settings } = await getData();
    const mine = await chrome.runtime.sendMessage({ type: 'myListing' }).catch(() => null);
    const pending = mine && mine.pending ? { id: mine.pending } : null;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="lhml-head"><strong>LH Marketplace Lister</strong><button class="lhml-min" title="Minimize">–</button></div>
      <div class="lhml-body">
        <select class="lhml-select"></select>
        <div class="lhml-actions">
          <button class="lhml-primary" data-act="all">Autofill</button>
          <button data-act="details">Details only</button>
          <button data-act="photos">Photos only</button>
        </div>
        <ul class="lhml-log"></ul>
        <div class="lhml-foot">Nothing gets published until you click Publish.</div>
      </div>`;
    document.body.appendChild(panel);
    logEl = panel.querySelector('.lhml-log');
    selectEl = panel.querySelector('.lhml-select');
    const active = listings.filter((l) => l.status !== 'posted');
    const list = active.length ? active : listings;
    if (!list.length) {
      selectEl.innerHTML = '<option value="">No vehicles yet. Import one in the app.</option>';
    } else {
      list.forEach((l) => {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = `${l.fb.year} ${l.fb.make} ${l.fb.model}${l.fb.price ? ' · $' + Number(l.fb.price).toLocaleString() : ''}`;
        selectEl.appendChild(o);
      });
      if (pending && list.some((l) => l.id === pending.id)) selectEl.value = pending.id;
    }
    panel.querySelector('.lhml-min').onclick = () => panel.classList.toggle('min');
    panel.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const d = await getData();
        const l = d.listings.find((x) => x.id === selectEl.value);
        if (!l) return;
        fill(l, d.settings, b.dataset.act === 'all' ? null : b.dataset.act);
      };
    });

    // Auto run when opened from the app.
    if (pending && settings.autoFill) {
      const l = listings.find((x) => x.id === pending.id);
      if (l) {
        await waitFor(() => findField('Vehicle type'), 15000, 250);
        await sleep(800);
        fill(l, settings, null);
      }
    }
  }

  function unmount() {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
  }

  let lastPath = '';
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    COMPOSER.test(location.pathname) ? waitFor(() => findField('Vehicle type'), 15000, 300).then(mount) : unmount();
  }, 700);
})();
