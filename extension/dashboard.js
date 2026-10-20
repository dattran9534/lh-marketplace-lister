/* Dashboard (home page): every vehicle as a box, merged with what's live on
 * Facebook after a sync. Price changes and Mark sold / pending / available /
 * Delete run on Facebook through the extension's Facebook tab. */
(function () {
  const D = { filter: 'all', search: '', fb: [], syncedAt: 0, busy: new Set() };

  // ---------- views ----------
  function showView(name) {
    const dash = name === 'dash';
    $('#dashView').hidden = !dash;
    $('#workView').hidden = dash;
    $('#tabDash').classList.toggle('active', dash);
    $('#tabWork').classList.toggle('active', !dash);
    if (dash) render();
  }
  window.openInEditor = (id) => { showView('work'); select(id); window.scrollTo(0, 0); };

  // ---------- matching app vehicles to Facebook listings ----------
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function fbMatches(l, f) {
    const t = (f.title || '').toLowerCase();
    if (!t.startsWith(String(l.fb.year))) return false;
    if (!norm(t).includes(norm(l.fb.make))) return false;
    const firstModel = norm((l.fb.model || '').split(' ')[0]);
    return !!firstModel && norm(t).includes(firstModel);
  }
  const RANK = { Active: 0, Pending: 1, Sold: 2 };

  function items() {
    const fb = D.fb.map((f, i) => ({ ...f, key: 'fb' + i }));
    const used = new Set();
    const out = state.listings.map((l) => {
      const cands = fb.filter((f) => !used.has(f.key) && fbMatches(l, f))
        .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || (a.price === l.fb.price ? -1 : 0) - (b.price === l.fb.price ? -1 : 0));
      const f = cands[0] || null;
      if (f) used.add(f.key);
      return { l, f };
    });
    fb.filter((f) => !used.has(f.key)).forEach((f) => out.push({ l: null, f }));
    return out;
  }

  const statusOf = (it) => (it.f ? it.f.status : it.l && it.l.status === 'posted' ? 'Posted' : it.l && it.l.status === 'opened' ? 'Sent to Facebook' : 'Not posted');
  const titleOf = (it) => (it.l ? `${it.l.fb.year} ${it.l.fb.make} ${it.l.fb.model}` : it.f.title);
  const priceOf = (it) => (it.f && it.f.price ? it.f.price : it.l ? it.l.fb.price : '');
  const money = (n) => (n ? '$' + Number(n).toLocaleString('en-US') : 'No price');

  function visibleItems() {
    const q = D.search.toLowerCase();
    return items().filter((it) => {
      const st = statusOf(it);
      if (D.filter === 'notposted' && (it.f || (it.l && it.l.status === 'posted'))) return false;
      if (['Active', 'Pending', 'Sold'].includes(D.filter) && st !== D.filter) return false;
      return !q || titleOf(it).toLowerCase().includes(q);
    });
  }

  // ---------- render ----------
  function render() {
    if ($('#dashView').hidden) return;
    const all = items();
    const count = (fn) => all.filter(fn).length;
    $('#stats').innerHTML = '';
    [
      ['Active on Facebook', count((it) => it.f && it.f.status === 'Active')],
      ['Pending', count((it) => it.f && it.f.status === 'Pending')],
      ['Not posted yet', count((it) => it.l && !it.f && it.l.status !== 'posted')],
      ['Sold', count((it) => it.f && it.f.status === 'Sold')],
      ['Clicks on active listings', all.filter((it) => it.f && it.f.status === 'Active').reduce((s, it) => s + (it.f.clicks || 0), 0)],
    ].forEach(([label, n]) => {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = '<b></b><span></span>';
      d.querySelector('b').textContent = n;
      d.querySelector('span').textContent = label;
      $('#stats').appendChild(d);
    });
    $('#syncInfo').textContent = D.syncedAt ? `Last synced ${timeAgo(D.syncedAt)}` : 'Not synced yet';
    $('#autoPostToggle').checked = !!state.settings.autoPost;
    $('#autoRenewToggle').checked = !!state.settings.autoRenew;
    chrome.storage.local.get('lastRenew').then(({ lastRenew }) => {
      const t = lastRenew ? `Last renew ${timeAgo(lastRenew.at)}${lastRenew.renewed && lastRenew.renewed.length ? ` (${lastRenew.renewed.length})` : ''}` : '';
      $('#renewNowBtn').title = t || 'Renew every car listing that\'s ready now';
    });

    const list = visibleItems();
    const box = $('#boxes');
    box.innerHTML = '';
    $('#dashEmpty').hidden = list.length > 0;
    list.forEach((it) => box.appendChild(card(it)));
    updatePostSelected();
  }

  function timeAgo(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} hr ago` : new Date(t).toLocaleDateString();
  }

  function btn(label, cls, onClick, title) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    if (title) b.title = title;
    b.onclick = (e) => { e.stopPropagation(); onClick(b); };
    return b;
  }

  function card(it) {
    const { l, f } = it;
    const st = statusOf(it);
    const key = l ? l.id : 'fb:' + f.title + f.listedOn;
    const el = document.createElement('article');
    el.className = 'box' + (D.busy.has(key) ? ' busy' : '');
    const photo = l ? (l.images.find((i) => i.on) || l.images[0]) : null;
    el.innerHTML = `
      <div class="box-img">${photo || (f && f.photo) ? '<img alt="" loading="lazy" referrerpolicy="no-referrer">' : '<div class="noimg">No photo</div>'}
        <span class="box-status"></span>
        ${l && !f && l.status !== 'posted' ? '<label class="box-pick"><input type="checkbox"></label>' : ''}
      </div>
      <div class="box-body">
        <h3></h3>
        <div class="box-price"><span class="amt"></span><button class="link edit-price">Change price</button></div>
        <div class="price-edit" hidden><span>$</span><input type="number" min="0" step="1"><button class="primary save">Save</button><button class="link cancel">Cancel</button></div>
        <p class="box-meta muted"></p>
        <div class="box-actions"></div>
      </div>`;
    if (photo) setThumb($('img', el), photo);
    else if (f && f.photo) $('img', el).src = f.photo;
    const s = $('.box-status', el);
    s.textContent = st;
    s.className = 'box-status st-' + norm(st);
    $('h3', el).textContent = titleOf(it);
    $('.amt', el).textContent = money(priceOf(it));
    $('.box-meta', el).textContent = [
      l && l.fb.mileage ? Number(l.fb.mileage).toLocaleString() + ' mi' : '',
      l && l.raw.stock ? 'Stock ' + l.raw.stock : '',
      f && f.listedOn ? 'Listed ' + f.listedOn : '',
      f && f.status !== 'Sold' ? `${f.clicks || 0} clicks` : '',
      !l ? 'On Facebook only' : '',
    ].filter(Boolean).join(' · ');

    const pick = $('.box-pick input', el);
    if (pick) {
      pick.checked = state.checked.has(l.id);
      pick.onclick = (e) => { e.stopPropagation(); pick.checked ? state.checked.add(l.id) : state.checked.delete(l.id); updatePostSelected(); };
    }

    // price editing
    const editRow = $('.price-edit', el), showRow = $('.box-price', el), input = $('.price-edit input', el);
    editRow.onclick = (e) => e.stopPropagation();
    const pickLabel = $('.box-pick', el);
    if (pickLabel) pickLabel.onclick = (e) => e.stopPropagation();
    $('.edit-price', el).onclick = (e) => { e.stopPropagation(); editRow.hidden = false; showRow.hidden = true; input.value = priceOf(it) || ''; input.focus(); input.select(); };
    $('.cancel', el).onclick = (e) => { e.stopPropagation(); editRow.hidden = true; showRow.hidden = false; };
    const save = async () => {
      const v = Math.round(Number(input.value));
      if (!v || v < 100) { input.focus(); return; }
      editRow.hidden = true; showRow.hidden = false;
      await changePrice(it, key, v);
    };
    $('.save', el).onclick = (e) => { e.stopPropagation(); save(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') $('.cancel', el).click(); };

    // actions
    const acts = $('.box-actions', el);
    if (l) acts.appendChild(btn('Open', 'secondary', () => openInEditor(l.id), 'Photos, details and description'));
    if (l && !f) acts.appendChild(btn(state.settings.autoPost ? 'Post (auto)' : 'Post', 'primary', () => post([l.id])));
    if (f) {
      if (l && f.status !== 'Sold') acts.appendChild(btn('Update photos', 'secondary', () => updatePhotos(it, key), 'Replace the photos on Facebook with the ones selected in the app'));
      if (f.status === 'Active') {
        acts.appendChild(btn('Mark sold', 'secondary', () => fbAction(it, key, 'sold')));
        acts.appendChild(btn('Mark pending', 'secondary', () => fbAction(it, key, 'pending')));
      }
      if (f.status === 'Pending') acts.appendChild(btn('Mark sold', 'secondary', () => fbAction(it, key, 'sold')));
      if (f.status === 'Sold') acts.appendChild(btn('Mark available', 'secondary', () => fbAction(it, key, 'available')));
      if (f.id) acts.appendChild(btn('View', 'link', () => window.open(`https://www.facebook.com/marketplace/item/${f.id}/`, '_blank'), 'Open the listing on Facebook'));
      acts.appendChild(btn('Delete', 'danger', () => fbAction(it, key, 'delete'), 'Delete the listing from Facebook'));
    }
    if (l) el.onclick = () => openInEditor(l.id);
    return el;
  }

  function updatePostSelected() {
    const ids = items().filter((it) => it.l && !it.f && state.checked.has(it.l.id)).map((it) => it.l.id);
    const b = $('#dashPostSelected');
    b.disabled = !ids.length;
    b.textContent = ids.length ? `Post selected (${ids.length})` : 'Post selected';
    b.onclick = () => post(ids);
  }

  function say(msg, kind = '') {
    const el = $('#dashStatus');
    el.textContent = msg;
    el.className = 'status ' + kind;
  }

  // ---------- Facebook jobs ----------
  async function runJob(job, label, quiet) {
    const r = await chrome.runtime.sendMessage({ type: 'startFbJob', job });
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not open Facebook');
    const jobId = r.jobId;
    if (!quiet) say(`${label}…`);
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      await new Promise((res) => setTimeout(res, 1000));
      const { jobResults = {} } = await chrome.storage.local.get('jobResults');
      if (jobResults[jobId]) return jobResults[jobId];
    }
    chrome.runtime.sendMessage({ type: 'cancelJob', jobId });
    throw new Error('Facebook took too long. Make sure you are logged in to Facebook in Edge and try again.');
  }

  async function loadFb() {
    const d = await chrome.storage.local.get(['fbListings', 'fbSyncedAt']);
    D.fb = d.fbListings || [];
    D.syncedAt = d.fbSyncedAt || 0;
  }

  // After a sync, cars that are live on Facebook count as posted.
  async function reconcile() {
    let changed = false;
    items().forEach(({ l, f }) => {
      if (l && f && l.status !== 'posted') { l.status = 'posted'; changed = true; }
    });
    if (changed) { await saveNow(); renderList(); }
  }

  // Quick sync runs in a background tab and refreshes your newest listings.
  // Full sync (first time, or "Full sync") opens in front so Facebook loads everything.
  let syncing = false;
  async function sync({ full = false, quiet = false } = {}) {
    if (syncing) return;
    syncing = true;
    const b = $('#syncBtn');
    b.disabled = true;
    full = full || !D.fb.length;
    try {
      const res = await runJob({ kind: 'sync', full }, full ? 'Full sync with Facebook (a Facebook tab opens for a moment)' : 'Refreshing from Facebook in the background', quiet);
      if (!res.ok) throw new Error(res.error);
      await loadFb();
      await reconcile();
      if (!quiet) say(`Synced ${D.fb.length} vehicle listing${D.fb.length === 1 ? '' : 's'} from Facebook.`, 'ok');
      setTimeout(() => learnFromBest({ quiet: true }), 3000); // keep learning from your best posts
    } catch (e) {
      if (!quiet) say(e.message, 'err');
    } finally {
      syncing = false;
      b.disabled = false;
      render();
    }
  }

  async function changePrice(it, key, v) {
    const { l, f } = it;
    const live = f && (f.status === 'Active' || f.status === 'Pending');
    if (l) { l.fb.price = v; l.updatedAt = Date.now(); await saveNow(); renderList(); }
    if (!live) { say(`Price set to ${money(v)}${f ? ' in the app (sold listings keep their Facebook price)' : ''}.`, 'ok'); render(); return; }
    D.busy.add(key); render();
    try {
      const res = await runJob({ kind: 'price', title: f.title, price: f.price, id: f.id, newPrice: v }, `Changing the price on Facebook to ${money(v)}`);
      if (!res.ok) throw new Error(res.error);
      const stored = D.fb.find((x) => x.title === f.title && x.listedOn === f.listedOn);
      if (stored) stored.price = v;
      await chrome.storage.local.set({ fbListings: D.fb });
      say(`${f.title} is now ${money(v)} on Facebook.`, 'ok');
      sync({ quiet: true }); // refresh from Facebook in the background
    } catch (e) {
      say(`Price not changed on Facebook: ${e.message}`, 'err');
    } finally {
      D.busy.delete(key);
      render();
    }
  }

  // Replace a live listing's photos with the car's selected photos in the app.
  const photoJobImages = (l) => (l.images || []).filter((i) => i.on).slice(0, state.settings.maxPhotos || 20)
    .map(({ url, fallback, local, cloud, cropTop }) => ({ url, fallback, local, cloud, cropTop }));

  async function updatePhotos(it, key) {
    const { l, f } = it;
    const imgs = photoJobImages(l);
    if (!imgs.length) { say('Select at least one photo for this car first (Open → Photos).', 'err'); return; }
    if (!confirm(`Replace the photos on "${f.title}" with the ${imgs.length} photo${imgs.length === 1 ? '' : 's'} selected in the app?`)) return;
    D.busy.add(key); render();
    try {
      const res = await runJob({ kind: 'photos', title: f.title, price: f.price, id: f.id || '', images: imgs }, `Updating photos on Facebook (${imgs.length})`);
      if (!res.ok) throw new Error(res.error);
      say(`${f.title}: photos updated on Facebook (${res.message || imgs.length + ' photos'}).`, 'ok');
      sync({ quiet: true });
    } catch (e) {
      say(`Photos not updated: ${e.message}`, 'err');
    } finally {
      D.busy.delete(key);
      render();
    }
  }

  const ACTION_TEXT = {
    sold: ['Marking as sold', 'marked as sold'],
    pending: ['Marking as pending', 'marked as pending'],
    available: ['Marking as available', 'back on the market'],
    delete: ['Deleting', 'deleted from Facebook'],
  };

  async function fbAction(it, key, action) {
    const { f, l } = it;
    if (action === 'delete' && !confirm(`Delete "${f.title}" from Facebook? This can't be undone.${l ? '\n\nThe car stays in this app so you can post it again.' : ''}`)) return;
    D.busy.add(key); render();
    try {
      const res = await runJob({ kind: 'action', action, title: f.title, price: f.price }, `${ACTION_TEXT[action][0]} on Facebook`);
      if (!res.ok) throw new Error(res.error);
      await loadFb();
      if (l && action === 'delete') { l.status = 'draft'; await saveNow(); renderList(); }
      say(`${f.title} ${ACTION_TEXT[action][1]}.`, 'ok');
    } catch (e) {
      say(`Didn't work: ${e.message}`, 'err');
    } finally {
      D.busy.delete(key);
      render();
    }
  }

  // Read the descriptions of your best posts (by clicks per day) so the AI can
  // learn what works. Read only: nothing on Facebook is changed. One at a time,
  // in background tabs; posts it can't reach quietly are skipped.
  let learning = false;
  async function learnFromBest({ quiet = false } = {}) {
    if (learning) return;
    learning = true;
    try {
      const { fbDescriptions = {} } = await chrome.storage.local.get('fbDescriptions');
      const todo = S.postsToLearnFrom(D.fb, fbDescriptions, 3);
      if (!todo.length) { if (!quiet) say('Already learned from your best posts. It checks again after your next sync.', 'ok'); return; }
      let got = 0;
      for (const f of todo) {
        try {
          const res = await runJob({ kind: 'readDesc', title: f.title, price: f.price, id: f.id || '', quiet: true }, `Reading your post "${f.title}" to learn from it`, quiet);
          fbDescriptions[S.fbKey(f)] = { text: (res.ok && res.description) || '', at: Date.now() };
          if (res.ok && res.description) got++;
        } catch (e) {
          fbDescriptions[S.fbKey(f)] = { text: '', at: Date.now() };
        }
        await chrome.storage.local.set({ fbDescriptions });
      }
      if (!quiet) say(got ? `Learned from ${got} of your best post${got === 1 ? '' : 's'}. New descriptions will use what works in them.` : "Couldn't read those posts this time. It will try again after the next sync.", got ? 'ok' : 'err');
    } finally {
      learning = false;
    }
  }

  // ---------- renew ----------
  async function renewNow() {
    const b = $('#renewNowBtn');
    b.disabled = true;
    say('Renewing your car listings that are ready (in a background tab)…');
    try {
      const r = await chrome.runtime.sendMessage({ type: 'renewNow' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Could not renew');
      const n = r.result.renewed.length;
      say(n ? `Renewed ${n}: ${r.result.renewed.join(', ')}.` : 'Nothing was ready to renew yet. Facebook allows it about once a week per listing.', 'ok');
      if (n) sync({ quiet: true });
    } catch (e) {
      say(`Renew didn't work: ${e.message}`, 'err');
    } finally {
      b.disabled = false;
      render();
    }
  }

  async function setAutoRenew(on) {
    state.settings.autoRenew = on;
    state.settings.switchesAt = Date.now();
    await chrome.storage.local.set({ settings: state.settings });
    chrome.runtime.sendMessage({ type: 'cloudSyncNow' }).catch(() => {});
    say(on ? 'Auto renew is on. Once a day between 9am and 7pm, car listings that are ready get renewed in a background tab (Edge needs to be open).' : 'Auto renew is off.', 'ok');
    render();
  }

  async function setAutoPost(on) {
    if (on && !confirm('With Auto post on, each listing publishes by itself right after it fills in, without you checking it first. It only publishes when every field filled without a problem.\n\nTurn Auto post on?')) {
      $('#autoPostToggle').checked = false;
      return;
    }
    state.settings.autoPost = on;
    state.settings.switchesAt = Date.now();
    await chrome.storage.local.set({ settings: state.settings });
    chrome.runtime.sendMessage({ type: 'cloudSyncNow' }).catch(() => {});
    say(on ? 'Auto post is on. Listings publish right after they fill in.' : 'Auto post is off. You review and publish each listing yourself.', 'ok');
    render();
  }

  // ---------- init ----------
  window.Dash = {
    async init() {
      await loadFb();
      $('#tabDash').onclick = () => showView('dash');
      $('#tabWork').onclick = () => showView('work');
      $('#syncBtn').onclick = () => sync();
      $('#fullSyncBtn').onclick = () => sync({ full: true });
      $('#learnBtn').onclick = () => learnFromBest();
      $('#autoPostToggle').onchange = (e) => setAutoPost(e.target.checked);
      $('#autoRenewToggle').onchange = (e) => setAutoRenew(e.target.checked);
      $('#renewNowBtn').onclick = renewNow;
      $('#dashSearch').oninput = (e) => { D.search = e.target.value; render(); };
      $$('#dashFilters .fchip').forEach((b) => {
        b.onclick = () => {
          D.filter = b.dataset.f;
          $$('#dashFilters .fchip').forEach((x) => x.classList.toggle('active', x === b));
          render();
        };
      });
      // Keep in step with Facebook tabs (auto post) and other app tabs.
      chrome.storage.onChanged.addListener(async (ch) => {
        if (ch.listings && !saveTimer) { state.listings = ch.listings.newValue || []; renderList(); }
        if (ch.settings && ch.settings.newValue) { state.settings.autoPost = !!ch.settings.newValue.autoPost; state.settings.autoRenew = !!ch.settings.newValue.autoRenew; state.settings.switchesAt = ch.settings.newValue.switchesAt; }
        if (ch.fbListings) await loadFb();
        if (ch.listings || ch.fbListings || ch.settings) render();
      });
      setInterval(() => { if (!$('#dashView').hidden) $('#syncInfo').textContent = D.syncedAt ? `Last synced ${timeAgo(D.syncedAt)}` : 'Not synced yet'; }, 60000);
      showView(params.get('view') === 'work' ? 'work' : 'dash');
    },
    render,
    // For the vehicle editor: the live Facebook listing for a car, if any.
    liveFor(id) { const it = items().find((x) => x.l && x.l.id === id); return it && it.f && it.f.status !== 'Sold' ? it : null; },
    updatePhotos(id) { const it = items().find((x) => x.l && x.l.id === id); if (it && it.f) { showView('dash'); updatePhotos(it, it.l.id); } },
  };
})();
