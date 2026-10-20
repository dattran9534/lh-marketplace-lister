/* PC side of the phone sync (runs in the extension's background worker).
 * Every minute, and a few seconds after any change:
 *  - sends your cars, your own photos and your Facebook listings to the cloud
 *  - brings in what you changed on the phone (prices, photos, descriptions)
 *  - does what you asked for on the phone (change price, mark sold, post...) */
(function () {
  const local = {
    get: async (k) => (await chrome.storage.local.get(k))[k],
    set: async (k, v) => chrome.storage.local.set({ [k]: v }),
  };

  async function cloud() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    if (!settings.cloudUrl || !settings.cloudKey) return null;
    const c = LHCloud({ url: settings.cloudUrl, key: settings.cloudKey, store: local });
    return (await c.user()) ? c : null;
  }

  const fp = LHCloud.fingerprint;
  const iso = (t) => new Date(t || Date.now()).toISOString();

  // ---------- Facebook jobs started from the phone ----------
  async function runFbJob(job, timeoutMs = 150000) {
    const { jobId } = await startFbJob({ job }, {});
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      const { jobResults = {} } = await chrome.storage.local.get('jobResults');
      if (jobResults[jobId]) return jobResults[jobId];
    }
    await cancelJob({ jobId });
    throw new Error('Facebook took too long');
  }

  async function setLocalPrice(vehicleId, price) {
    if (!vehicleId) return;
    const { listings = [] } = await chrome.storage.local.get('listings');
    const l = listings.find((x) => x.id === vehicleId);
    if (l) { l.fb.price = price; l.updatedAt = Date.now(); await chrome.storage.local.set({ listings }); }
  }

  const COMMANDS = {
    async price(p) {
      if (p.title) {
        const r = await runFbJob({ kind: 'price', title: p.title, price: p.price, id: p.fbId || '', newPrice: p.newPrice });
        if (!r.ok) throw new Error(r.error);
        const { fbListings = [] } = await chrome.storage.local.get('fbListings');
        const f = fbListings.find((x) => x.title === p.title && x.listedOn === p.listedOn);
        if (f) { f.price = p.newPrice; await chrome.storage.local.set({ fbListings }); }
      }
      await setLocalPrice(p.vehicleId, p.newPrice);
      return `Price is now $${Number(p.newPrice).toLocaleString('en-US')}`;
    },
    async action(p) {
      const r = await runFbJob({ kind: 'action', action: p.action, title: p.title, price: p.price });
      if (!r.ok) throw new Error(r.error);
      if (p.action === 'delete' && p.vehicleId) {
        const { listings = [] } = await chrome.storage.local.get('listings');
        const l = listings.find((x) => x.id === p.vehicleId);
        if (l) { l.status = 'draft'; await chrome.storage.local.set({ listings }); }
      }
      return { sold: 'Marked as sold', pending: 'Marked as pending', available: 'Back on the market', delete: 'Deleted from Facebook' }[p.action] || 'Done';
    },
    // Replace a live listing's photos with the car's current selection
    // (the phone's latest edits were pulled in just before this runs).
    async photos(p) {
      const { listings = [], settings = {} } = await chrome.storage.local.get(['listings', 'settings']);
      const l = listings.find((x) => x.id === p.vehicleId);
      if (!l) throw new Error('That car is not on the PC yet');
      const images = (l.images || []).filter((i) => i.on).slice(0, settings.maxPhotos || 20)
        .map(({ url, fallback, local, cloud, cropTop }) => ({ url, fallback, local, cloud, cropTop }));
      if (!images.length) throw new Error('No photos are selected for this car');
      const r = await runFbJob({ kind: 'photos', title: p.title, price: p.price, id: p.fbId || '', images }, 240000);
      if (!r.ok) throw new Error(r.error);
      return `Photos updated on Facebook (${r.message || images.length + ' photos'})`;
    },
    async post(p) {
      const { listings = [] } = await chrome.storage.local.get('listings');
      const l = listings.find((x) => x.id === p.vehicleId);
      if (!l) throw new Error('That car is not on the PC yet');
      l.status = l.status === 'posted' ? 'posted' : 'opened';
      await chrome.storage.local.set({ listings });
      await openComposer({ ids: [p.vehicleId] });
      const { settings = {} } = await chrome.storage.local.get('settings');
      return settings.autoPost ? 'Posting on your PC (Auto post will publish it)' : 'Opened on your PC, waiting for you to publish';
    },
    async renew() {
      const r = await renewNow({});
      return r.renewed.length ? `Renewed ${r.renewed.length}: ${r.renewed.join(', ')}` : 'Nothing was ready to renew yet (Facebook allows it about once a week per listing)';
    },
    async sync() {
      const r = await runFbJob({ kind: 'sync' });
      if (!r.ok) throw new Error(r.error);
      return 'Synced with Facebook';
    },
    // Importing needs the full app (CARFAX, photos, AI), so open it in a background tab.
    async import(p, cmd) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`app.html?cmd=${cmd.id}&importUrl=${encodeURIComponent(p.url)}`), active: false });
      return { keepRunning: true }; // the app tab marks it done
    },
  };

  async function runCommands(c) {
    const queued = await c.db.select('commands', 'status=eq.queued&order=created_at.asc&limit=5');
    for (const cmd of queued || []) {
      const STEP = { price: 'Changing the price on Facebook…', action: 'Updating the listing on Facebook…', photos: 'Uploading photos to Facebook…', post: 'Opening Facebook…', sync: 'Syncing with Facebook…', renew: 'Renewing listings on Facebook…', import: 'Starting the import…' };
      await c.db.update('commands', { id: cmd.id }, { status: 'running', result: STEP[cmd.kind] || 'Working on it…' });
      try {
        const fn = COMMANDS[cmd.kind];
        if (!fn) throw new Error(`Unknown request "${cmd.kind}"`);
        const res = await fn(cmd.payload || {}, cmd);
        if (res && res.keepRunning) continue;
        await c.db.update('commands', { id: cmd.id }, { status: 'done', result: String(res || 'Done'), done_at: iso() });
      } catch (e) {
        await c.db.update('commands', { id: cmd.id }, { status: 'failed', result: e.message || String(e), done_at: iso() });
      }
    }
  }

  // ---------- two way sync ----------
  async function uploadOwnPhotos(c, uid, listings) {
    let changed = false;
    for (const l of listings) {
      for (const im of l.images || []) {
        if (!im.local || im.cloud) continue;
        const blob = await LHLocal.get(im.local).catch(() => null);
        if (!blob) continue;
        im.cloud = await c.photos.upload(`${uid}/${l.id}/${im.local}.jpg`, blob);
        changed = true;
      }
    }
    return changed;
  }

  async function syncSwitches(c) {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const remote = await c.account.get().catch(() => null);
    const localAt = settings.switchesAt || 0;
    if (remote && remote.at > localAt) {
      settings.autoPost = !!remote.autoPost;
      settings.autoRenew = !!remote.autoRenew;
      settings.switchesAt = remote.at;
      await chrome.storage.local.set({ settings });
    } else if (!remote || localAt > remote.at || remote.autoPost !== !!settings.autoPost || remote.autoRenew !== !!settings.autoRenew) {
      const at = localAt || Date.now();
      await c.account.set({ autoPost: !!settings.autoPost, autoRenew: !!settings.autoRenew, at });
      if (!localAt) { settings.switchesAt = at; await chrome.storage.local.set({ settings }); }
    }
  }

  let running = false;
  async function syncOnce() {
    if (running) return;
    running = true;
    try {
      const c = await cloud();
      if (!c) return;
      const uid = (await c.user()).id;
      const st = await chrome.storage.local.get(['listings', 'fbListings', 'fbSyncedAt', 'cloudFp', 'cloudPull']);
      let listings = st.listings || [];
      const sent = st.cloudFp || {};

      // 1. Bring in phone edits first, so they aren't overwritten.
      const since = st.cloudPull || '1970-01-01T00:00:00Z';
      const fromPhone = await c.db.select('vehicles', `updated_by=eq.phone&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc`);
      let newest = since, pulled = false;
      for (const row of fromPhone || []) {
        newest = row.updated_at > newest ? row.updated_at : newest;
        const i = listings.findIndex((l) => l.id === row.id);
        if (row.deleted) { if (i >= 0) listings.splice(i, 1); delete sent[row.id]; }
        else if (i >= 0) listings[i] = row.data; else listings.unshift(row.data);
        if (!row.deleted) sent[row.id] = fp(row.data);
        pulled = true;
      }

      // 2. Send your own photos, then any car that changed on the PC.
      const photosAdded = await uploadOwnPhotos(c, uid, listings);
      if (pulled || photosAdded) await chrome.storage.local.set({ listings });
      const changed = listings.filter((l) => sent[l.id] !== fp(l));
      if (changed.length) {
        await c.db.upsert('vehicles', changed.map((l) => ({ id: l.id, user_id: uid, data: l, updated_at: iso(), updated_by: 'pc', deleted: false })), 'user_id,id');
        changed.forEach((l) => (sent[l.id] = fp(l)));
      }
      // Cars deleted on the PC.
      const gone = Object.keys(sent).filter((id) => !listings.some((l) => l.id === id));
      if (gone.length) {
        await c.db.upsert('vehicles', gone.map((id) => ({ id, user_id: uid, data: {}, updated_at: iso(), updated_by: 'pc', deleted: true })), 'user_id,id');
        gone.forEach((id) => delete sent[id]);
      }

      // 3. Facebook listings + "PC is online" heartbeat.
      const fbList = st.fbListings || [];
      const row = { user_id: uid, pc_seen_at: iso() };
      if (sent.__fb !== fp(fbList)) { row.listings = fbList; row.synced_at = iso(st.fbSyncedAt); sent.__fb = fp(fbList); }
      await c.db.upsert('fb_state', [row], 'user_id');

      await chrome.storage.local.set({ cloudFp: sent, cloudPull: newest, cloudLastSync: Date.now(), cloudError: '' });

      // 4. Auto post / Auto renew switches, shared with the phone (newest change wins).
      await syncSwitches(c);

      // 5. Phone requests.
      await runCommands(c);
    } catch (e) {
      await chrome.storage.local.set({ cloudError: e.message || String(e) });
    } finally {
      running = false;
    }
  }

  chrome.alarms.create('cloudSync', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'cloudSync') syncOnce(); });

  // A few seconds after anything changes on the PC.
  let timer = null;
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !(ch.listings || ch.fbListings)) return;
    clearTimeout(timer);
    timer = setTimeout(syncOnce, 4000);
  });

  self.LHCloudSync = { syncOnce };
})();
