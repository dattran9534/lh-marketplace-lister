/* LH Lister for iPhone. Reads and edits the same cars as the PC app through
 * your Supabase project. Anything that has to happen on Facebook (posting,
 * price changes on live listings, mark sold, delete) becomes a request that
 * your PC carries out the next time Edge is open. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get: async (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: async (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const S = { vehicles: [], fb: [], pcSeen: null, commands: [], filter: 'all', search: '', open: null };
  let cloud = null, uid = null;

  // ---------- config + sign in ----------
  function config() {
    const c = window.LH_CONFIG || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('lhCfg') || '{}'); } catch (e) {}
    return { url: c.url || saved.url || '', key: c.key || saved.key || '' };
  }

  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const cfg = config();
    $('#setupFields').hidden = !!(cfg.url && cfg.key);
    if (cfg.url && cfg.key) {
      cloud = LHCloud({ url: cfg.url, key: cfg.key, store });
      const u = await cloud.user();
      if (u) return enter(u);
    }
    const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const fromHomeScreen = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    $('#homeScreenTip').hidden = !(iPhone && !fromHomeScreen);
    show('login');
  }

  async function signIn() {
    let cfg = config();
    if (!cfg.url || !cfg.key) {
      cfg = { url: $('#cfgUrl').value.trim(), key: $('#cfgKey').value.trim() };
      if (!cfg.url || !cfg.key) return msg('#loginMsg', 'Enter the project URL and publishable key.');
      localStorage.setItem('lhCfg', JSON.stringify(cfg));
    }
    cloud = LHCloud({ url: cfg.url, key: cfg.key, store });
    const btn = $('#signInBtn');
    btn.disabled = true;
    msg('#loginMsg', 'Signing in…');
    try {
      const s = await cloud.signIn($('#email').value.trim(), $('#password').value);
      try { localStorage.setItem('lhEmail', $('#email').value.trim()); } catch (e) {}
      $('#password').value = '';
      enter(s.user);
    } catch (e) {
      msg('#loginMsg', /confirm/i.test(e.message) ? 'Confirm your email first (check your inbox).' : e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function enter(user) {
    uid = user.id;
    $('#whoAmI').textContent = `Signed in as ${user.email}`;
    show('main');
    load();
    setInterval(() => { if (!document.hidden) load(true); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  }

  function show(name) {
    if (name === 'login') {
      let lastEmail = '';
      try { lastEmail = localStorage.getItem('lhEmail') || ''; } catch (e) {}
      if (lastEmail && !$('#email').value) $('#email').value = lastEmail;
    }
    $('#login').hidden = name !== 'login';
    $('#main').hidden = name !== 'main';
  }
  const msg = (sel, t) => { $(sel).textContent = t; };
  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  // ---------- data ----------
  let loading = false;
  async function load(quiet) {
    if (loading) return;
    loading = true;
    if (!quiet) $('#refreshBtn').classList.add('spin');
    try {
      const [veh, fb, cmds] = await Promise.all([
        cloud.db.select('vehicles', 'deleted=eq.false&order=updated_at.desc'),
        cloud.db.select('fb_state'),
        cloud.db.select('commands', 'order=created_at.desc&limit=40'),
      ]);
      S.vehicles = (veh || []).map((r) => r.data).filter((d) => d && d.fb);
      S.fb = (fb && fb[0] && fb[0].listings) || [];
      S.pcSeen = fb && fb[0] && fb[0].pc_seen_at ? new Date(fb[0].pc_seen_at) : null;
      S.commands = cmds || [];
      render();
      if (S.open) renderSheet();
    } catch (e) {
      if (/sign in again/i.test(e.message)) { show('login'); msg('#loginMsg', e.message); }
      else if (!quiet) toast(e.message);
    } finally {
      loading = false;
      $('#refreshBtn').classList.remove('spin');
    }
  }

  async function saveVehicle(v) {
    v.updatedAt = Date.now();
    await cloud.db.upsert('vehicles', [{ id: v.id, user_id: uid, data: v, updated_at: new Date().toISOString(), updated_by: 'phone', deleted: false }], 'user_id,id');
  }

  async function request(kind, payload, label) {
    await cloud.db.insert('commands', [{ user_id: uid, kind, payload }]);
    toast(pcOnline() ? `${label}. Your PC is on it.` : `${label}. It will run when your PC has Edge open.`);
    await load(true);
    fastPoll();
  }
  let fastTimer;
  function fastPoll() {
    clearInterval(fastTimer);
    let n = 0;
    fastTimer = setInterval(() => { if (++n > 30 || !S.commands.some(isPending)) clearInterval(fastTimer); load(true); }, 4000);
  }
  const isPending = (c) => c.status === 'queued' || c.status === 'running';

  // ---------- matching cars to Facebook listings (same rules as the PC) ----------
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const RANK = { Active: 0, Pending: 1, Sold: 2 };
  function fbMatches(v, f) {
    const t = (f.title || '').toLowerCase();
    if (!t.startsWith(String(v.fb.year))) return false;
    if (!norm(t).includes(norm(v.fb.make))) return false;
    const m = norm((v.fb.model || '').split(' ')[0]);
    return !!m && norm(t).includes(m);
  }
  function items() {
    const fb = S.fb.map((f, i) => ({ ...f, key: 'fb' + i }));
    const used = new Set();
    const out = S.vehicles.map((v) => {
      const f = fb.filter((x) => !used.has(x.key) && fbMatches(v, x)).sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3))[0] || null;
      if (f) used.add(f.key);
      return { v, f, key: v.id };
    });
    fb.filter((f) => !used.has(f.key)).forEach((f) => out.push({ v: null, f, key: 'fb:' + f.title + '|' + f.listedOn }));
    return out;
  }
  const statusOf = (it) => (it.f ? it.f.status : it.v && it.v.status === 'posted' ? 'Posted' : it.v && it.v.status === 'opened' ? 'Sent to Facebook' : 'Not posted');
  const titleOf = (it) => (it.v ? `${it.v.fb.year} ${it.v.fb.make} ${it.v.fb.model}` : it.f.title);
  const priceOf = (it) => (it.f && it.f.price ? it.f.price : it.v ? it.v.fb.price : '');
  const money = (n) => (n ? '$' + Number(n).toLocaleString('en-US') : 'No price');
  const pcOnline = () => S.pcSeen && Date.now() - S.pcSeen.getTime() < 3 * 60 * 1000;
  const commandsFor = (it) => S.commands.filter((c) => (it.v && c.payload && c.payload.vehicleId === it.v.id) || (it.f && c.payload && c.payload.title === it.f.title && c.payload.listedOn === it.f.listedOn));

  // ---------- photos ----------
  const smallUrl = (u) => (/content\.homenetiol\.com\/.+\/0x0\//i.test(u || '') ? u.replace('/0x0/', '/640x480/') : u);
  const blobUrls = new Map();
  async function photoSrc(im) {
    if (im.cloud) {
      if (!blobUrls.has(im.cloud)) blobUrls.set(im.cloud, cloud.photos.download(im.cloud).then((b) => URL.createObjectURL(b)));
      return blobUrls.get(im.cloud);
    }
    return smallUrl(im.url || '');
  }
  function setImg(img, im) {
    if (!im) return;
    photoSrc(im).then((u) => { if (u) img.src = u; }).catch(() => {});
    if (im.cropTop) img.style.objectViewBox = `inset(${(im.cropTop * 100).toFixed(1)}% 0 0 0)`;
  }

  // Phone photos can be huge; shrink to 2048px JPEG before uploading.
  function shrink(file, maxSide = 2048) {
    return new Promise((resolve) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => { URL.revokeObjectURL(u); resolve(b || file); }, 'image/jpeg', 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(u); resolve(file); };
      img.src = u;
    });
  }

  async function addPhotos(files) {
    const v = S.open && S.open.v;
    if (!v || !files.length) return;
    let n = 0;
    try {
      for (const f of files) {
        msg('#photoMsg', `Uploading ${++n} of ${files.length}…`);
        const blob = await shrink(f);
        const path = `${uid}/${v.id}/phone-${crypto.randomUUID()}.jpg`;
        await cloud.photos.upload(path, blob);
        v.images = v.images || [];
        v.images.push({ cloud: path, url: '', fallback: '', on: true, cropTop: 0, kind: '' });
      }
      await saveVehicle(v);
      msg('#photoMsg', `Added ${files.length} photo${files.length === 1 ? '' : 's'}. They'll show on the PC within a minute.`);
      renderSheet();
      render();
    } catch (e) {
      msg('#photoMsg', `Upload stopped: ${e.message}`);
    }
  }

  // ---------- render ----------
  function render() {
    // PC status
    const pc = $('#pcStatus');
    pc.classList.toggle('on', !!pcOnline());
    $('.txt', pc).textContent = pcOnline() ? 'PC online' : S.pcSeen ? `PC offline since ${S.pcSeen.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'PC not connected yet';

    const all = items();
    const count = (fn) => all.filter(fn).length;
    $('#stats').innerHTML = '';
    [['Active', count((it) => it.f && it.f.status === 'Active')], ['Not posted', count((it) => it.v && !it.f && it.v.status !== 'posted')], ['Pending', count((it) => it.f && it.f.status === 'Pending')], ['Sold', count((it) => it.f && it.f.status === 'Sold')]]
      .forEach(([l, n]) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<b></b><span></span>'; $('b', d).textContent = n; $('span', d).textContent = l; $('#stats').appendChild(d); });

    const q = S.search.toLowerCase();
    const list = all.filter((it) => {
      const st = statusOf(it);
      if (S.filter === 'notposted' && (it.f || (it.v && it.v.status === 'posted'))) return false;
      if (['Active', 'Pending', 'Sold'].includes(S.filter) && st !== S.filter) return false;
      return !q || titleOf(it).toLowerCase().includes(q);
    });
    const grid = $('#grid');
    grid.innerHTML = '';
    $('#empty').hidden = list.length > 0;
    for (const it of list) {
      const c = document.createElement('button');
      c.className = 'card';
      const st = statusOf(it);
      const busy = commandsFor(it).some(isPending);
      c.innerHTML = `<div class="img"><img alt="" loading="lazy"><span class="badge st-${norm(st)}"></span>${busy ? '<span class="busy">Waiting for PC</span>' : ''}</div><div class="info"><b class="t"></b><span class="p"></span><span class="m muted"></span></div>`;
      const first = it.v ? (it.v.images || []).find((i) => i.on) || (it.v.images || [])[0] : null;
      if (first) setImg($('img', c), first); else if (it.f && it.f.photo) $('img', c).src = it.f.photo; else $('img', c).remove();
      $('.badge', c).textContent = st;
      $('.t', c).textContent = titleOf(it);
      $('.p', c).textContent = money(priceOf(it));
      $('.m', c).textContent = [it.v && it.v.fb.mileage ? Number(it.v.fb.mileage).toLocaleString() + ' mi' : '', it.f && it.f.status !== 'Sold' ? `${it.f.clicks || 0} clicks` : ''].filter(Boolean).join(' · ');
      c.onclick = () => openSheet(it);
      grid.appendChild(c);
    }
    renderActivity();
  }

  const STATUS_TXT = { queued: 'Waiting for PC', running: 'PC is working on it', done: 'Done', failed: 'Did not work' };
  function describeCmd(c) {
    const p = c.payload || {};
    const what = c.kind === 'price' ? `Price ${money(p.newPrice)}` : c.kind === 'action' ? ({ sold: 'Mark sold', pending: 'Mark pending', available: 'Mark available', delete: 'Delete' }[p.action] || p.action) : c.kind === 'post' ? 'Post to Facebook' : c.kind === 'import' ? 'Import' : c.kind === 'sync' ? 'Sync with Facebook' : c.kind;
    return `${what}${p.title ? ' · ' + p.title : ''}`;
  }
  function cmdRow(c) {
    const d = document.createElement('div');
    d.className = 'req st-' + c.status;
    d.innerHTML = '<b></b><span></span>';
    $('b', d).textContent = describeCmd(c);
    $('span', d).textContent = STATUS_TXT[c.status] + (c.result ? ` · ${c.result}` : '');
    return d;
  }
  function renderActivity() {
    const box = $('#activity');
    box.innerHTML = '';
    const recent = S.commands.slice(0, 6);
    if (!recent.length) return;
    const h = document.createElement('h3');
    h.textContent = 'Recent requests';
    box.appendChild(h);
    recent.forEach((c) => box.appendChild(cmdRow(c)));
  }

  // ---------- car sheet ----------
  function openSheet(it) {
    S.open = it;
    $('#sheet').hidden = false;
    document.body.classList.add('noscroll');
    $('#dPriceEdit').hidden = true;
    msg('#photoMsg', '');
    renderSheet();
  }
  function closeSheet() {
    S.open = null;
    $('#sheet').hidden = true;
    document.body.classList.remove('noscroll');
  }

  function renderSheet() {
    // Refresh the open item from the latest data.
    const fresh = items().find((x) => x.key === S.open.key) || S.open;
    S.open = fresh;
    const { v, f } = fresh;
    $('#dTitle').textContent = titleOf(fresh);
    $('#dMeta').textContent = [statusOf(fresh), v && v.fb.mileage ? Number(v.fb.mileage).toLocaleString() + ' mi' : '', v && v.raw && v.raw.stock ? 'Stock ' + v.raw.stock : '', f && f.listedOn ? 'Listed ' + f.listedOn : '', f && f.status !== 'Sold' ? `${f.clicks || 0} clicks` : ''].filter(Boolean).join(' · ');
    $('#dPrice').textContent = money(priceOf(fresh));

    const ph = $('#dPhotos');
    ph.innerHTML = '';
    const imgs = v ? (v.images || []).filter((i) => i.on) : [];
    if (imgs.length) imgs.forEach((im) => { const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; setImg(img, im); ph.appendChild(img); });
    else if (f && f.photo) { const img = document.createElement('img'); img.src = f.photo; ph.appendChild(img); }
    $('.photo-actions').hidden = !v;
    $('#dDescBox').hidden = !v;
    if (v && document.activeElement !== $('#dDesc')) $('#dDesc').value = v.fb.description || '';

    const acts = $('#dActions');
    acts.innerHTML = '';
    const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
    const busy = commandsFor(fresh).some(isPending);
    if (v && !f && v.status !== 'posted') add('Post to Facebook', 'primary', () => request('post', { vehicleId: v.id, title: titleOf(fresh) }, 'Posting requested'));
    if (f) {
      const base = { title: f.title, price: f.price, listedOn: f.listedOn, vehicleId: v ? v.id : '' };
      if (f.status === 'Active' || f.status === 'Pending') add('Mark sold', 'secondary', () => request('action', { ...base, action: 'sold' }, 'Mark sold requested'));
      if (f.status === 'Active') add('Mark pending', 'secondary', () => request('action', { ...base, action: 'pending' }, 'Mark pending requested'));
      if (f.status === 'Sold') add('Mark available', 'secondary', () => request('action', { ...base, action: 'available' }, 'Mark available requested'));
      if (f.id) add('Open on Facebook', 'link', () => window.open(`https://www.facebook.com/marketplace/item/${f.id}/`, '_blank'));
      add('Delete', 'danger', () => { if (confirm(`Delete "${f.title}" from Facebook? This can't be undone.`)) request('action', { ...base, action: 'delete' }, 'Delete requested'); });
    }
    $$('button', acts).forEach((b) => (b.disabled = busy && !/Open on Facebook/.test(b.textContent)));

    const reqs = commandsFor(fresh).slice(0, 4);
    const rbox = $('#dRequests');
    rbox.innerHTML = '';
    reqs.forEach((c) => rbox.appendChild(cmdRow(c)));
  }

  async function savePrice() {
    const it = S.open;
    const n = Math.round(Number($('#dPriceInput').value));
    if (!n || n < 100) return $('#dPriceInput').focus();
    $('#dPriceEdit').hidden = true;
    const live = it.f && (it.f.status === 'Active' || it.f.status === 'Pending');
    if (live) {
      await request('price', { vehicleId: it.v ? it.v.id : '', title: it.f.title, price: it.f.price, listedOn: it.f.listedOn, fbId: it.f.id || '', newPrice: n }, `Price change to ${money(n)} requested`);
    } else if (it.v) {
      it.v.fb.price = n;
      await saveVehicle(it.v);
      toast(`Price set to ${money(n)}.`);
      load(true);
    }
  }

  async function saveDesc() {
    const v = S.open && S.open.v;
    if (!v) return;
    v.fb.description = $('#dDesc').value;
    v.descBy = 'edited';
    await saveVehicle(v);
    toast('Description saved.');
  }

  // ---------- wire up ----------
  $('#loginForm').addEventListener('submit', (e) => { e.preventDefault(); signIn(); });
  $('#refreshBtn').onclick = () => load();
  $('#closeSheet').onclick = closeSheet;
  $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
  $('#menu').onclick = (e) => { if (e.target.id === 'menu') $('#menu').hidden = true; };
  $('#menuBtn').onclick = () => ($('#menu').hidden = false);
  $('#installHelpBtn').onclick = () => ($('#installHelp').hidden = false);
  $('#signOutBtn').onclick = async () => { await cloud.signOut(); location.reload(); };
  $('#syncFbBtn').onclick = () => { $('#menu').hidden = true; request('sync', {}, 'Sync requested'); };
  $('#addCarBtn').onclick = () => {
    const url = prompt('Paste a vehicle link from lynnwoodhonda.com');
    if (url && /^https?:\/\//i.test(url.trim())) request('import', { url: url.trim() }, 'Import requested');
  };
  $('#search').oninput = (e) => { S.search = e.target.value; render(); };
  $$('#chips .chip').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; $$('#chips .chip').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
  $('#dPriceBtn').onclick = () => { $('#dPriceEdit').hidden = false; $('#dPriceInput').value = priceOf(S.open) || ''; $('#dPriceInput').focus(); };
  $('#dPriceCancel').onclick = () => ($('#dPriceEdit').hidden = true);
  $('#dPriceSave').onclick = savePrice;
  $('#dDescSave').onclick = saveDesc;
  $('#addPhotos').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };

  start();
})();
