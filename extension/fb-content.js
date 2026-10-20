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
      const foot = panel.querySelector('.lhml-foot');
      if (only === null && settings.autoPost && !errs) {
        foot.textContent = 'Auto post is on: publishing…';
        await step('Publish', (r) => autoPublish(listing, r));
        const failed = logEl.querySelector('li.err[data-step="Publish"]');
        foot.textContent = failed ? 'Could not publish automatically. Check the form and publish it yourself.' : 'Published. You can close this tab.';
      } else {
        foot.textContent = errs
          ? `Done. ${errs} field${errs > 1 ? 's' : ''} need a quick look, then review and publish.${settings.autoPost ? ' (Auto post skipped because of this.)' : ''}`
          : 'Done. Review the listing, then publish it yourself.';
      }
    } finally {
      running = false;
      panel.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  let settingsCache = {};
  async function getData() {
    const d = await chrome.storage.local.get(['listings', 'settings']);
    settingsCache = { maxPhotos: 20, fillLocation: false, autoFill: true, fillVin: false, removeBanner: true, autoPost: false, ...(d.settings || {}) };
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

  // ---------- auto post ----------
  const btnByText = (re) =>
    [...document.querySelectorAll('[role="button"], button')].find((b) => visible(b) && !inPanel(b) &&
      re.test(((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).trim()) &&
      b.getAttribute('aria-disabled') !== 'true' && !b.disabled);

  async function autoPublish(listing, report) {
    const want = (listing.images || []).filter((i) => i.on).slice(0, settingsCache.maxPhotos || 20).length;
    if (want) {
      report('waiting for photos to upload');
      // Facebook shows "Photos · N / 20" once uploads are in.
      await waitFor(() => { const m = document.body.innerText.match(/Photos\s*·\s*(\d+)\s*\/\s*\d+/); return m && +m[1] >= Math.min(want, 20) - 1; }, 90000, 1000);
      await sleep(4000);
    }
    report('clicking Next');
    const next = await waitFor(() => btnByText(/^Next$/), 60000, 1000);
    if (!next) throw new Error('Next button never became clickable');
    next.click();
    report('clicking Publish');
    const pub = await waitFor(() => btnByText(/^Publish$/), 30000, 800);
    if (!pub) throw new Error('Publish button not found');
    await sleep(1200);
    pub.click();
    const left = await waitFor(() => !/^\/marketplace\/create/.test(location.pathname), 45000, 1000);
    if (!left) throw new Error('Facebook did not confirm the post');
    chrome.runtime.sendMessage({ type: 'markPosted', id: listing.id }).catch(() => {});
    return 'published';
  }

  // ---------- selling page: sync and listing actions ----------
  const SELLING = /^\/marketplace\/you\/selling/;
  const EDIT = /^\/marketplace\/edit\//;

  // Listing ids and photos from the data Facebook embeds in the page.
  function embeddedListings() {
    const out = {};
    document.querySelectorAll('script[type="application/json"]').forEach((sc) => {
      const t = sc.textContent;
      if (!t.includes('marketplace_listing_title')) return;
      try {
        const walk = (o, d = 0) => {
          if (!o || typeof o !== 'object' || d > 60) return;
          if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
          if (o.marketplace_listing_title && o.id) {
            const photo = o.primary_listing_photo && (o.primary_listing_photo.image ? o.primary_listing_photo.image.uri : o.primary_listing_photo.listing_image && o.primary_listing_photo.listing_image.uri);
            out[o.marketplace_listing_title] = out[o.marketplace_listing_title] || [];
            out[o.marketplace_listing_title].push({ id: o.id, photo: photo || '', price: (o.formatted_price && o.formatted_price.text) || '' });
          }
          for (const k in o) walk(o[k], d + 1);
        };
        walk(JSON.parse(t));
      } catch (e) {}
    });
    return out;
  }

  const MORE = '[aria-label^="More options for "]';
  // Text of a card even when Facebook has stopped drawing it (off screen).
  const textOf = (el) => {
    const parts = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const s = n.nodeValue.trim(); if (s) parts.push(s); }
    return parts.join('\n');
  };
  // Group inventory listings say "In stock" / "Out of stock" instead.
  const STATUS_RE = /(^|\n)(Active|Sold|Pending|In stock|Out of stock)(\n|$)/;
  const STATUS_MAP = { 'In stock': 'Active', 'Out of stock': 'Sold' };

  // The biggest box around this button that holds no other listing.
  function cardFor(btn) {
    let el = btn, best = null;
    for (let k = 0; k < 20 && el.parentElement; k++) {
      const p = el.parentElement;
      const titles = new Set([...p.querySelectorAll(MORE)].map((b) => b.getAttribute('aria-label')));
      if (titles.size > 1) break;
      el = p;
      const t = textOf(el);
      if (/\$[\d,]+/.test(t) && STATUS_RE.test(t)) best = el;
    }
    return best;
  }

  async function loadAllCards() {
    let last = -1, same = 0;
    for (let i = 0; i < 60 && same < 4; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(900);
      const n = document.querySelectorAll('[aria-label^="More options for "]').length;
      if (n === last) same++; else { same = 0; last = n; }
    }
    window.scrollTo(0, 0);
  }

  function scrapeCards() {
    const emb = embeddedListings();
    const seen = new Set();
    const out = [];
    for (const btn of document.querySelectorAll(MORE)) {
      const title = btn.getAttribute('aria-label').replace(/^More options for /, '').trim();
      if (!/^\d{4}\s/.test(title)) continue; // skips Messenger names etc.
      const card = cardFor(btn);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      const t = textOf(card);
      const price = ((t.match(/\$[\d,]+/) || [])[0] || '').replace(/[$,]/g, '');
      const raw = (t.match(STATUS_RE) || [])[2] || '';
      const listedOn = (t.match(/Listed on ([\d/]+)/) || [])[1] || '';
      const clicks = +((t.match(/([\d,]+) clicks? on listing/) || [])[1] || '0').replace(/,/g, '');
      const img = card.querySelector('img');
      const e = (emb[title] || []).find((c) => !c.taken && c.price.replace(/[$,]/g, '') === price) || (emb[title] || []).find((c) => !c.taken);
      if (e) e.taken = true;
      out.push({ title, price: price ? +price : '', status: STATUS_MAP[raw] || raw, group: !!STATUS_MAP[raw], listedOn, clicks, id: e ? e.id : '', photo: (e && e.photo) || (img ? img.src : '') });
    }
    return out;
  }

  // The "More options" button of the job's listing (matching price if the title repeats).
  function findCardButton(job) {
    const btns = [...document.querySelectorAll(`[aria-label="${CSS.escape('More options for ' + job.title)}"]`)];
    const cards = [...new Set(btns.map((b) => cardFor(b)).filter(Boolean))];
    const want = '$' + Number(job.price).toLocaleString('en-US');
    const card = cards.find((c) => textOf(c).includes(want)) || cards[0];
    return card ? { card, more: btns.find((b) => card.contains(b)) } : null;
  }

  // A button inside the listing's card, e.g. "Mark as sold" or "Mark out of stock".
  function cardButton(card, re) {
    return [...card.querySelectorAll('[role="button"], button')].find((b) => re.test(((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).trim()));
  }

  async function clickMenuItem(job, label) {
    const hit = findCardButton(job);
    const more = hit && hit.more;
    if (!more) throw new Error('Listing not found on your selling page');
    more.scrollIntoView({ block: 'center' });
    more.click();
    const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"], [role="menu"] [role="button"], [role="menu"] a')].find((e) => visible(e) && e.innerText.trim() === label), 5000);
    if (!item) throw new Error(`"${label}" is not offered for this listing`);
    item.click();
  }

  // Facebook sometimes asks a follow up question; answer it the safe way.
  async function confirmDialog(confirmRe, timeout = 4000) {
    const btn = await waitFor(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].filter(visible).pop();
      if (!dlg) return null;
      return [...dlg.querySelectorAll('[role="button"], button')].find((b) => visible(b) && confirmRe.test((b.getAttribute('aria-label') || b.innerText || '').trim()) && b.getAttribute('aria-disabled') !== 'true');
    }, timeout);
    if (btn) { btn.click(); await sleep(1200); }
    return !!btn;
  }

  async function setPriceOnEditPage(newPrice) {
    await waitFor(() => findField('Price'), 20000, 300);
    await sleep(1500);
    await setText('Price', newPrice);
    await sleep(800);
    const upd = await waitFor(() => btnByText(/^Update$/), 10000, 400);
    if (!upd) throw new Error('Update button not found');
    upd.click();
    const done = await waitFor(() => !EDIT.test(location.pathname) || !btnByText(/^Update$/), 30000, 800);
    if (!done) throw new Error('Facebook did not confirm the new price');
  }

  async function runJob(job) {
    const finish = (result) => chrome.runtime.sendMessage({ type: 'jobDone', jobId: job.jobId, result }).catch(() => {});
    try {
      if (job.kind === 'price' && EDIT.test(location.pathname)) {
        await setPriceOnEditPage(job.newPrice);
        return finish({ ok: true });
      }
      if (!SELLING.test(location.pathname)) return;
      await waitFor(() => document.querySelector('[aria-label^="More options for "]') || /no listings/i.test(document.body.innerText), 20000, 500);
      await sleep(1500);
      if (job.kind === 'sync') {
        await loadAllCards();
        return finish({ ok: true, listings: scrapeCards() });
      }
      const act = job.action;
      if (act === 'sold' || act === 'available') {
        const hit = findCardButton(job);
        if (!hit) throw new Error('Listing not found on your selling page');
        const b = cardButton(hit.card, act === 'sold' ? /^Mark (as sold|out of stock)\b/i : /^Mark (as available|in stock)\b/i);
        if (!b) throw new Error(act === 'sold' ? 'This listing has no "Mark as sold" button (already sold?)' : 'This listing is not marked sold');
        b.scrollIntoView({ block: 'center' });
        b.click();
        await sleep(1500);
        // "Who bought it?" style prompts: skip naming a buyer.
        await confirmDialog(act === 'sold' ? /^(Mark as sold|Skip|Not now|Done|Confirm)$/i : /^(Mark as available|Confirm|Done)$/i);
      } else if (act === 'pending') {
        await clickMenuItem(job, 'Mark as pending');
        await sleep(1500);
        await confirmDialog(/^(Mark as pending|Confirm|Done)$/i);
      } else if (act === 'delete') {
        await clickMenuItem(job, 'Delete listing');
        const ok = await confirmDialog(/^Delete$/i, 8000);
        if (!ok) throw new Error('Facebook did not ask to confirm the delete');
      } else if (job.kind === 'price') {
        await clickMenuItem(job, 'Edit listing');
        await waitFor(() => EDIT.test(location.pathname), 15000, 400);
        await setPriceOnEditPage(job.newPrice);
        return finish({ ok: true });
      }
      await sleep(2500);
      return finish({ ok: true, listings: scrapeCards() });
    } catch (e) {
      return finish({ ok: false, error: e.message || String(e) });
    }
  }

  let jobRunning = false;
  async function checkJob() {
    if (jobRunning) return;
    const r = await chrome.runtime.sendMessage({ type: 'myJob' }).catch(() => null);
    if (!r || !r.job) return;
    jobRunning = true;
    try { await runJob(r.job); } finally { jobRunning = false; }
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
    if (SELLING.test(location.pathname) || EDIT.test(location.pathname)) checkJob();
  }, 700);
})();
