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

  // iPhone Safari ignores the "no zoom" setting on its own, so block the gestures too.
  function lockZoom() {
    const stop = (e) => e.preventDefault();
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
    // Two fingers on the screen = pinch: block it (one finger still scrolls).
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    // Double tap zoom is already off through touch-action in phone.css; quick repeated taps stay normal.
  }

  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    lockZoom();
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
    loadSwitches();
    setInterval(() => { if (!document.hidden) { load(true); loadSwitches(); } }, 15000);
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
      // A car that just went live on Facebook: say so.
      const nowPosted = S.vehicles.filter((v) => v.status === 'posted' && S.statusSeen && S.statusSeen[v.id] && S.statusSeen[v.id] !== 'posted');
      S.statusSeen = Object.fromEntries(S.vehicles.map((v) => [v.id, v.status]));
      if (nowPosted.length) postedBanner(nowPosted.map((v) => `${v.fb.year} ${v.fb.make} ${v.fb.model}`));
      S.fb = (fb && fb[0] && fb[0].listings) || [];
      S.pcSeen = fb && fb[0] && fb[0].pc_seen_at ? new Date(fb[0].pc_seen_at) : null;
      S.commands = cmds || [];
      render();
      if (S.commands.some(isPending)) fastPoll();
      if (S.open && !draft) renderSheet();
    } catch (e) {
      if (/sign in again/i.test(e.message)) { show('login'); msg('#loginMsg', e.message); }
      else if (!quiet) toast(e.message);
    } finally {
      loading = false;
      $('#refreshBtn').classList.remove('spin');
    }
  }

  function postedBanner(names) {
    let b = document.getElementById('postedBanner');
    if (!b) { b = document.createElement('div'); b.id = 'postedBanner'; b.className = 'posted-banner'; document.body.appendChild(b); }
    b.innerHTML = '<i class="pb-ck">✓</i><p class="pb-text"><b>Posted complete</b><em class="pb-sub"></em></p>';
    b.querySelector('.pb-sub').textContent = `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} live on Facebook Marketplace.`;
    b.hidden = false;
    clearTimeout(b._h);
    b._h = setTimeout(() => (b.hidden = true), 7000);
    b.onclick = () => (b.hidden = true);
  }

  async function saveVehicle(v) {
    v.updatedAt = Date.now();
    await cloud.db.upsert('vehicles', [{ id: v.id, user_id: uid, data: v, updated_at: new Date().toISOString(), updated_by: 'phone', deleted: false }], 'user_id,id');
  }

  async function request(kind, payload, label) {
    await cloud.db.insert('commands', [{ user_id: uid, kind, payload }]);
    cloud.ping('cmd'); // wakes the PC right away instead of waiting for its next check
    toast(pcOnline() ? `${label}. Your PC is on it.` : `${label}. It will run when your PC has Edge open.`);
    await load(true);
    fastPoll();
  }
  let fastTimer;
  function fastPoll() {
    if (fastTimer) return; // already polling
    clearInterval(fastTimer);
    let n = 0;
    fastTimer = setInterval(() => { if (++n > 60 || !S.commands.some(isPending)) { clearInterval(fastTimer); fastTimer = null; } load(true); }, 3000);
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
    // Hide the dealer banner: zoom the photo up from its bottom edge so the top
    // strip falls outside its frame (iPhone Safari can't crop with object-view-box).
    if (im.cropTop > 0 && im.cropTop < 0.4) {
      img.style.transformOrigin = '50% 100%';
      img.style.transform = `scale(${(1 / (1 - im.cropTop)).toFixed(4)})`;
    } else {
      img.style.transform = '';
    }
  }

  const STOCK = /stock_images|stockphoto|\/stock\//i;

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
      const stock = (v.images || []).filter((i) => STOCK.test(i.url || ''));
      if (stock.length) {
        // Your photos replace the dealer's generic catalog picture; the PC re-reads colors from them.
        v.images = v.images.filter((i) => !STOCK.test(i.url || ''));
        v.stockOnly = false;
        await saveVehicle(v);
        if (v.raw && v.raw.sourceUrl) request('import', { url: v.raw.sourceUrl, title: `${v.fb.year} ${v.fb.make} ${v.fb.model}`, vehicleId: v.id }, 'Updating the car with your photos');
      } else {
        await saveVehicle(v);
      }
      msg('#photoMsg', `Added ${files.length} photo${files.length === 1 ? '' : 's'}. They'll show on the PC within a minute.`);
      renderSheet();
      render();
    } catch (e) {
      msg('#photoMsg', `Upload stopped: ${e.message}`);
    }
  }

  // ---------- render ----------
  // Cards are kept and updated in place (no rebuild), so nothing blinks on refresh.
  const cards = new Map(); // key -> { el, sig, imgKey }
  const imgKeyOf = (im) => (im ? im.cloud || im.local || im.url || '' : '');
  let lastStats = '';

  function render() {
    const pc = $('#pcStatus');
    pc.classList.toggle('on', !!pcOnline());
    $('.txt', pc).textContent = pcOnline() ? 'PC online' : S.pcSeen ? `PC offline since ${S.pcSeen.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'PC not connected yet';

    const all = items();
    const count = (fn) => all.filter(fn).length;
    const stats = [['Active', count((it) => it.f && it.f.status === 'Active')], ['Not posted', count((it) => it.v && !it.f && it.v.status !== 'posted')], ['Pending', count((it) => it.f && it.f.status === 'Pending')], ['Sold', count((it) => it.f && it.f.status === 'Sold')]];
    const statsSig = JSON.stringify(stats);
    if (statsSig !== lastStats) {
      lastStats = statsSig;
      $('#stats').innerHTML = '';
      stats.forEach(([l, n]) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<b></b><span></span>'; $('b', d).textContent = n; $('span', d).textContent = l; $('#stats').appendChild(d); });
    }

    const q = S.search.toLowerCase();
    const list = all.filter((it) => {
      const st = statusOf(it);
      if (S.filter === 'notposted' && (it.f || (it.v && it.v.status === 'posted'))) return false;
      if (['Active', 'Pending', 'Sold'].includes(S.filter) && st !== S.filter) return false;
      return !q || titleOf(it).toLowerCase().includes(q);
    });
    const grid = $('#grid');
    $('#empty').hidden = list.length > 0;
    const keep = new Set();
    list.forEach((it, i) => {
      keep.add(it.key);
      const st = statusOf(it);
      const pending = commandsFor(it).find(isPending);
      const first = it.v ? (it.v.images || []).find((x) => x.on) || (it.v.images || [])[0] : null;
      const imgKey = first ? imgKeyOf(first) : (it.f && it.f.photo) || '';
      const meta = [it.v && it.v.fb.mileage ? Number(it.v.fb.mileage).toLocaleString() + ' mi' : '', it.f && it.f.status !== 'Sold' ? `${it.f.clicks || 0} clicks` : ''].filter(Boolean).join(' · ');
      const busyTxt = pending ? (pending.status === 'running' ? 'PC is working…' : 'Waiting for PC') : '';
      const sig = JSON.stringify([st, busyTxt, titleOf(it), priceOf(it), meta]);
      let c = cards.get(it.key);
      if (!c) {
        const el = document.createElement('button');
        el.className = 'card';
        el.innerHTML = '<div class="img"><img alt="" loading="lazy"><span class="badge"></span><span class="busy" hidden></span></div><div class="info"><b class="t"></b><span class="p"></span><span class="m muted"></span></div>';
        el.onclick = () => openSheet(el.__it);
        c = { el, sig: '', imgKey: null };
        cards.set(it.key, c);
      }
      c.el.__it = it;
      if (c.imgKey !== imgKey) {
        c.imgKey = imgKey;
        const img = $('img', c.el);
        img.hidden = !imgKey;
        if (first) setImg(img, first); else if (it.f && it.f.photo) img.src = it.f.photo;
      }
      if (c.sig !== sig) {
        c.sig = sig;
        const b = $('.badge', c.el);
        b.textContent = st;
        b.className = `badge st-${norm(st)}`;
        const busy = $('.busy', c.el);
        busy.hidden = !busyTxt;
        busy.textContent = busyTxt;
        $('.t', c.el).textContent = titleOf(it);
        $('.p', c.el).textContent = money(priceOf(it));
        $('.m', c.el).textContent = meta;
      }
      if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] || null);
    });
    for (const [k, c] of cards) if (!keep.has(k)) { c.el.remove(); cards.delete(k); }
    renderStatus();
    renderActivity();
  }

  // Live status: what your PC is doing right now, step by step.
  let lastStatus = '';
  function renderStatus() {
    const now = Date.now();
    const live = S.commands.filter((c) => isPending(c) || (c.done_at && now - new Date(c.done_at).getTime() < 90000)).slice(0, 4);
    const sig = JSON.stringify(live.map((c) => [c.id, c.status, c.result]));
    if (sig === lastStatus) return;
    lastStatus = sig;
    const bar = $('#statusBar');
    bar.hidden = !live.length;
    bar.innerHTML = '';
    live.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'srow st-' + c.status;
      const icon = c.status === 'done' ? '✓' : c.status === 'failed' ? '!' : '';
      row.innerHTML = `<span class="sicon">${icon || '<i class="spinner"></i>'}</span><span class="stext"><b></b><span></span></span>`;
      $('b', row).textContent = describeCmd(c);
      const mins = (now - new Date(c.created_at).getTime()) / 60000;
      const slow = isPending(c) && mins > 4 ? ' (taking longer than usual)' : '';
      $('.stext span', row).textContent = (c.status === 'queued' ? (pcOnline() ? 'Waiting for your PC…' : 'Waiting for your PC to come online (Edge open)') : c.result || STATUS_TXT[c.status]) + slow;
      const acts = document.createElement('span');
      acts.className = 'sacts';
      if (isPending(c)) acts.appendChild(cmdBtn('Cancel', () => cancelCmd(c)));
      if (c.status === 'failed' && !/^(Canceled|Tried again)$/.test(c.result || '')) acts.appendChild(cmdBtn('Try again', () => retryCmd(c)));
      if (acts.children.length) row.appendChild(acts);
      bar.appendChild(row);
    });
  }

  // Auto post / Auto renew, shared with the PC through your account.
  let switches = null;
  async function loadSwitches() {
    try {
      switches = (await cloud.account.get()) || { autoPost: false, autoRenew: false, at: 0 };
      $('#swAutoPost').checked = !!switches.autoPost;
      $('#swAutoRenew').checked = !!switches.autoRenew;
    } catch (e) {}
  }
  async function setSwitch(name, on, el) {
    if (name === 'autoPost' && on && !confirm('With Auto post on, a car you import publishes on Facebook right after it fills in, without you checking it first. It only publishes when every must-have field filled.\n\nTurn Auto post on?')) { el.checked = false; return; }
    el.disabled = true;
    try {
      const next = { autoPost: $('#swAutoPost').checked, autoRenew: $('#swAutoRenew').checked, at: Date.now() };
      switches = await cloud.account.set(next);
      const note = $('#switchNote');
      note.hidden = false;
      note.textContent = `${name === 'autoPost' ? 'Auto post' : 'Auto renew'} turned ${on ? 'on' : 'off'}. ${pcOnline() ? 'Your PC picks it up within a minute.' : 'Your PC picks it up next time Edge is open.'}`;
      setTimeout(() => (note.hidden = true), 6000);
    } catch (e) {
      el.checked = !on;
      toast(e.message);
    } finally {
      el.disabled = false;
    }
  }

  function cmdBtn(label, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sbtn'; b.textContent = label;
    b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message); } finally { b.disabled = false; } };
    return b;
  }
  async function cancelCmd(c) {
    await cloud.db.update('commands', { id: c.id }, { status: 'failed', result: 'Canceled', done_at: new Date().toISOString() });
    toast('Canceled');
    lastStatus = '';
    await load(true);
  }
  async function retryCmd(c) {
    await cloud.db.update('commands', { id: c.id }, { result: 'Tried again' });
    await request(c.kind, c.payload || {}, 'Trying again');
  }

  const STATUS_TXT = { queued: 'Waiting for PC', running: 'PC is working on it', done: 'Done', failed: 'Did not work' };
  function describeCmd(c) {
    const p = c.payload || {};
    const what = c.kind === 'price' ? `Price ${money(p.newPrice)}` : c.kind === 'action' ? ({ sold: 'Mark sold', pending: 'Mark pending', available: 'Mark available', delete: 'Delete' }[p.action] || p.action) : c.kind === 'photos' ? 'Update photos on Facebook' : c.kind === 'post' ? 'Post to Facebook' : c.kind === 'import' ? 'Import car' : c.kind === 'sync' ? 'Sync with Facebook' : c.kind === 'renew' ? 'Renew listings' : c.kind;
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
  let lastActivity = '';
  function renderActivity() {
    const box = $('#activity');
    const recent = S.commands.slice(0, 6);
    const sig = JSON.stringify(recent.map((c) => [c.id, c.status, c.result]));
    if (sig === lastActivity) return;
    lastActivity = sig;
    box.innerHTML = '';
    if (!recent.length) return;
    const h = document.createElement('h3');
    h.textContent = 'Recent requests';
    box.appendChild(h);
    recent.forEach((c) => box.appendChild(cmdRow(c)));
  }

  // ---------- car sheet ----------
  function openSheet(it) {
    closePhotoEditor();
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
    const imgs = v ? (v.images || []).filter((i) => i.on) : [];
    const phSig = JSON.stringify([fresh.key, imgs.map(imgKeyOf), f && f.photo]);
    if (ph.dataset.sig !== phSig) {
    ph.dataset.sig = phSig;
    ph.innerHTML = '';
    if (imgs.length) imgs.forEach((im) => { const wrap = document.createElement('div'); wrap.className = 'ph-frame'; const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; setImg(img, im); wrap.appendChild(img); ph.appendChild(wrap); });
    else if (f && f.photo) { const wrap = document.createElement('div'); wrap.className = 'ph-frame'; const img = document.createElement('img'); img.src = f.photo; wrap.appendChild(img); ph.appendChild(wrap); }
    }
    $('.photo-actions').hidden = !v;
    const stockNow = v && imgs.length > 0 && imgs.every((i) => STOCK.test(i.url || ''));
    if (stockNow) msg('#photoMsg', "This is the dealer's generic catalog picture, not the actual car. Tap Add photos to use your own.");
    $('#dDescBox').hidden = !v;
    // Drafts can be edited here like on the PC; a live listing's price changes go through Facebook.
    renderDetails(v, !!(v && !f && v.status !== 'posted'));
    if (v && document.activeElement !== $('#dDesc')) $('#dDesc').value = v.fb.description || '';

    const acts = $('#dActions');
    acts.innerHTML = '';
    const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
    const busy = commandsFor(fresh).some(isPending);
    if (v && !f && v.status !== 'posted') add('Post to Facebook', 'primary', async () => {
      if (detailsDirty && confirm('Save your changes to the details first?')) await saveDetails();
      closeSheet();
      await request('post', { vehicleId: v.id, title: titleOf(fresh) }, 'Posting requested');
    });
    if (v && v.raw && v.raw.sourceUrl) add('Refresh from dealer site', 'secondary', () => {
      if (confirm('Re-import this car from lynnwoodhonda.com? Price, miles, photos and CARFAX get updated. Your own description edits are kept.')) request('import', { url: v.raw.sourceUrl, title: titleOf(fresh), vehicleId: v.id }, 'Refresh requested');
    });
    if (f) {
      const base = { title: f.title, price: f.price, listedOn: f.listedOn, vehicleId: v ? v.id : '' };
      if (v && f.status !== 'Sold') add('Update photos on Facebook', 'secondary wide', () => {
        const n = (v.images || []).filter((i) => i.on).slice(0, 20).length;
        if (!n) return toast('Show at least one photo first (Edit photos).');
        if (confirm(`Replace the photos on Facebook with the ${n} photo${n === 1 ? '' : 's'} shown here?`)) request('photos', { ...base, fbId: f.id || '' }, 'Photo update requested');
      });
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

  // ---------- photo editor ----------
  let draft = null;
  function openPhotoEditor() {
    const v = S.open && S.open.v;
    if (!v) return;
    draft = (v.images || []).map((im) => ({ ...im }));
    $('#photoEditor').hidden = false;
    $('#editPhotosBtn').hidden = true;
    renderPhotoEditor();
  }
  function closePhotoEditor() {
    draft = null;
    $('#photoEditor').hidden = true;
    $('#editPhotosBtn').hidden = false;
  }
  function renderPhotoEditor() {
    const g = $('#peGrid');
    g.innerHTML = '';
    let n = 0;
    draft.forEach((im, i) => {
      const t = document.createElement('div');
      t.className = 'pe' + (im.on ? ' on' : '');
      const num = im.on ? ++n : 0;
      t.innerHTML = `<div class="pe-img"><img alt=""><span class="pe-n">${im.on ? num : 'Hidden'}</span></div>` +
        `<div class="pe-btns"><button class="pe-left" aria-label="Move earlier">◀ Earlier</button><button class="pe-first" aria-label="Make first">★ First</button>` +
        (im.cloud && /\/phone-/.test(im.cloud) ? '<button class="pe-del" aria-label="Delete photo">✕</button>' : '') + '</div>';
      if (num > 20) t.classList.add('over');
      setImg($('img', t), im);
      $('.pe-img', t).onclick = () => { im.on = !im.on; renderPhotoEditor(); };
      $('.pe-left', t).onclick = (e) => { e.stopPropagation(); if (i > 0) { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; renderPhotoEditor(); } };
      $('.pe-first', t).onclick = (e) => { e.stopPropagation(); draft.unshift(draft.splice(i, 1)[0]); draft[0].on = true; renderPhotoEditor(); };
      const del = $('.pe-del', t);
      if (del) del.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this photo?')) { draft.splice(i, 1); renderPhotoEditor(); } };
      g.appendChild(t);
    });
  }
  async function savePhotoEditor() {
    const v = S.open && S.open.v;
    if (!v || !draft) return;
    const removed = (v.images || []).filter((im) => im.cloud && /\/phone-/.test(im.cloud) && !draft.some((d) => d.cloud === im.cloud)).map((im) => im.cloud);
    v.images = draft;
    $('#peSave').disabled = true;
    try {
      await saveVehicle(v);
      if (removed.length) cloud.photos.remove(removed).catch(() => {});
      closePhotoEditor();
      const live = S.open.f && S.open.f.status !== 'Sold';
      toast(live ? 'Saved. Tap "Update photos on Facebook" to send them to the live post.' : 'Photo order saved.');
      renderSheet(); render();
    } catch (e) {
      toast(`Not saved: ${e.message}`);
    } finally {
      $('#peSave').disabled = false;
    }
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

  // ---------- listing details (same fields as the PC editor) ----------
  const FBO = (window.LHShared && LHShared.FB) || {};
  const FIELDS = [
    ['year', 'Year', 'number'], ['make', 'Make', 'makes'], ['model', 'Model', 'text'],
    ['mileage', 'Mileage', 'number'], ['price', 'Price ($)', 'number'], ['bodyStyle', 'Body style', 'bodyStyles'],
    ['exteriorColor', 'Exterior color', 'colors'], ['interiorColor', 'Interior color', 'colors'], ['condition', 'Condition', 'conditions'],
    ['fuelType', 'Fuel type', 'fuelTypes'], ['transmission', 'Transmission', 'transmissions'],
  ];
  let detailsKey = '', detailsDirty = false;
  function buildDetails() {
    const g = $('#dGrid');
    if (g.children.length) return;
    FIELDS.forEach(([k, label, type]) => {
      const l = document.createElement('label');
      l.className = 'dfield' + (k === 'model' ? ' wide' : '');
      l.append(document.createTextNode(label));
      let el;
      if (FBO[type]) {
        el = document.createElement('select');
        el.appendChild(new Option('Choose…', ''));
        FBO[type].forEach((o) => el.appendChild(new Option(o, o)));
      } else {
        el = document.createElement('input');
        el.type = type === 'number' ? 'text' : 'text';
        if (type === 'number') el.inputMode = 'numeric';
      }
      el.dataset.f = k;
      el.oninput = el.onchange = () => (detailsDirty = true);
      l.appendChild(el);
      g.appendChild(l);
    });
    $('#dDetails [data-f="cleanTitle"]').onchange = () => (detailsDirty = true);
  }
  function renderDetails(v, show) {
    $('#dDetails').hidden = !show;
    if (!show) return;
    buildDetails();
    if (detailsKey === v.id && detailsDirty) return; // don't overwrite while you're typing
    detailsKey = v.id; detailsDirty = false;
    $$('#dDetails [data-f]').forEach((el) => {
      const val = v.fb[el.dataset.f];
      if (el.type === 'checkbox') el.checked = !!val;
      else if (el.tagName === 'SELECT' && val && ![...el.options].some((o) => o.value === String(val))) { el.appendChild(new Option(val, val)); el.value = val; }
      else el.value = val == null ? '' : val;
    });
  }
  async function saveDetails() {
    const v = S.open && S.open.v;
    if (!v) return;
    const btn = $('#dDetailsSave');
    btn.disabled = true;
    try {
      $$('#dDetails [data-f]').forEach((el) => {
        const k = el.dataset.f;
        if (el.type === 'checkbox') v.fb[k] = el.checked;
        else if (['year', 'mileage', 'price'].includes(k)) v.fb[k] = Number(String(el.value).replace(/[^\d]/g, '')) || '';
        else v.fb[k] = el.value;
      });
      await saveVehicle(v);
      detailsDirty = false;
      toast('Details saved. The PC uses them when it posts.');
      render();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
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
  $('#renewBtn').onclick = () => { $('#menu').hidden = true; request('renew', {}, 'Renew requested'); };
  // ---------- add a car (link + optional photos from this phone) ----------
  let addFiles = [];
  function renderAddThumbs() {
    const box = $('#addThumbs');
    box.innerHTML = '';
    addFiles.forEach((f, i) => {
      const t = document.createElement('div');
      t.className = 'add-thumb';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove');
      x.onclick = () => { addFiles.splice(i, 1); renderAddThumbs(); };
      t.append(img, x);
      box.appendChild(t);
    });
    $('#onlyMineRow').hidden = !addFiles.length;
  }
  $('#addCarBtn').onclick = () => {
    addFiles = []; renderAddThumbs();
    $('#addUrl').value = ''; $('#addMsg').textContent = ''; $('#addGo').disabled = false;
    $('#addSheet').hidden = false;
  };
  $('#closeAdd').onclick = () => ($('#addSheet').hidden = true);
  $('#addSheet').onclick = (e) => { if (e.target.id === 'addSheet') $('#addSheet').hidden = true; };
  $('#addCarPhotos').onchange = (e) => { addFiles.push(...e.target.files); e.target.value = ''; renderAddThumbs(); };
  $('#addGo').onclick = async () => {
    const url = $('#addUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { $('#addMsg').textContent = 'Paste the link to the car first.'; return; }
    $('#addGo').disabled = true;
    try {
      const batch = crypto.randomUUID();
      const photos = [];
      for (const f of addFiles) {
        $('#addMsg').textContent = `Uploading photo ${photos.length + 1} of ${addFiles.length}…`;
        const path = `${uid}/incoming/${batch}/phone-${crypto.randomUUID()}.jpg`;
        await cloud.photos.upload(path, await shrink(f));
        photos.push(path);
      }
      $('#addSheet').hidden = true;
      await request('import', { url, photos, onlyMine: photos.length > 0 && $('#onlyMine').checked }, photos.length ? `Import requested with ${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Import requested');
    } catch (e) {
      $('#addMsg').textContent = `Upload stopped: ${e.message}`;
      $('#addGo').disabled = false;
    }
  };
  $('#search').oninput = (e) => { S.search = e.target.value; render(); };
  $$('#chips .chip').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; $$('#chips .chip').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
  $('#dPriceBtn').onclick = () => { $('#dPriceEdit').hidden = false; $('#dPriceInput').value = priceOf(S.open) || ''; $('#dPriceInput').focus(); };
  $('#dPriceCancel').onclick = () => ($('#dPriceEdit').hidden = true);
  $('#dPriceSave').onclick = savePrice;
  $('#dDescSave').onclick = saveDesc;
  $('#dDetailsSave').onclick = saveDetails;
  $('#swAutoPost').onchange = (e) => setSwitch('autoPost', e.target.checked, e.target);
  $('#swAutoRenew').onchange = (e) => setSwitch('autoRenew', e.target.checked, e.target);
  $('#editPhotosBtn').onclick = openPhotoEditor;
  $('#peCancel').onclick = closePhotoEditor;
  $('#peSave').onclick = savePhotoEditor;
  $('#addPhotos').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };

  start();
})();
