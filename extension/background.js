importScripts('extractor.js', 'localphotos.js', 'cloud.js', 'cloudsync.js');

const APP_URL = chrome.runtime.getURL('app.html');
const COMPOSER_URL = 'https://www.facebook.com/marketplace/create/vehicle';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openApp(query = '') {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url || '').startsWith(APP_URL));
  const target = APP_URL + query;
  if (existing) {
    await chrome.tabs.update(existing.id, { url: target, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target });
  }
}

// Toolbar button: open the app, remembering the tab you were on.
chrome.action.onClicked.addListener((tab) => {
  const usable = tab && tab.id != null && /^https?:/i.test(tab.url || '') && !/facebook\.com/i.test(tab.url || '');
  openApp(usable ? `?src=${tab.id}` : '');
});

// After a one-click update the app tab closes; bring it back.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'update') openApp('?updated=1');
});

function waitForComplete(tabId, timeout = 45000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      err ? reject(err) : resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const timer = setTimeout(() => finish(new Error('The page took too long to load')), timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && finish()).catch(() => {});
  });
}

async function withBackgroundTab(url, wait, fn) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForComplete(tab.id);
    await sleep(wait);
    return await fn(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runExtractor(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractVehicle, world: 'MAIN' });
  const data = res && res.result;
  if (!data || (!data.vin && !data.model)) throw new Error("Couldn't find vehicle details on that page. Open a single vehicle's page and try again.");
  return data;
}

async function extractFromTab({ tabId }) {
  return { data: await runExtractor(tabId) };
}

async function extractFromUrl({ url }) {
  return { data: await withBackgroundTab(url, 2500, runExtractor) };
}

// CARFAX reports render in the browser, so read them from a real tab.
async function extractCarfax({ url }) {
  const text = await withBackgroundTab(url, 3500, async (tabId) => {
    let t = '';
    for (let i = 0; i < 6; i++) {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.body.innerText.slice(0, 40000) });
      t = (res && res.result) || '';
      if (/Ownership History|Service History|Title History/i.test(t)) break;
      await sleep(1500);
    }
    return t;
  });
  if (!/carfax/i.test(text)) throw new Error('The CARFAX report did not load');
  return { text };
}

// Vehicle links on an inventory / search results page.
async function listVehicleLinks({ tabId }) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => [...new Set([...document.querySelectorAll('a[href*="/viewdetails/"]')].map((a) => a.href.split('?')[0].split('#')[0]))],
  });
  return { links: (res && res.result) || [] };
}

async function fetchImage({ url, fallback, local, cloud: cloudPath }) {
  if (local || cloudPath) {
    let blob = local ? await LHLocal.get(local).catch(() => null) : null;
    if (!blob && cloudPath) {
      // A photo added on the phone.
      const { settings = {} } = await chrome.storage.local.get('settings');
      const c = LHCloud({ url: settings.cloudUrl, key: settings.cloudKey, store: { get: async (k) => (await chrome.storage.local.get(k))[k], set: async (k, v) => chrome.storage.local.set({ [k]: v }) } });
      blob = await c.photos.download(cloudPath);
    }
    if (!blob) throw new Error('Your photo was not found');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { dataUrl: `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}` };
  }
  for (const u of [url, fallback].filter(Boolean)) {
    try {
      const r = await fetch(u, { credentials: 'omit' });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!/^image\//.test(blob.type) && blob.size < 5000) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { dataUrl: `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}` };
    } catch (e) {}
  }
  throw new Error('Photo download failed');
}

// One Facebook form per vehicle. Each tab is told which vehicle is its own.
async function openComposer({ id, ids }) {
  const list = ids || [id];
  const { pendingTabs = {} } = await chrome.storage.local.get('pendingTabs');
  for (let i = 0; i < list.length; i++) {
    // Opens behind your current tab so it doesn't interrupt you.
    const tab = await chrome.tabs.create({ url: COMPOSER_URL, active: false });
    pendingTabs[tab.id] = { id: list[i], at: Date.now() };
    await chrome.storage.local.set({ pendingTabs });
    if (i < list.length - 1) await sleep(1500);
  }
  return {};
}

async function myListing(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  const { pendingTabs = {} } = await chrome.storage.local.get('pendingTabs');
  const hit = pendingTabs[tabId];
  if (hit) {
    delete pendingTabs[tabId];
    // Drop stale entries too.
    for (const k of Object.keys(pendingTabs)) if (Date.now() - pendingTabs[k].at > 30 * 60 * 1000) delete pendingTabs[k];
    await chrome.storage.local.set({ pendingTabs });
  }
  return { pending: hit && Date.now() - hit.at < 30 * 60 * 1000 ? hit.id : null };
}

// ---------- Facebook jobs: sync, price change, sold/pending/available/delete ----------
// The app asks for a job; a Facebook tab opens, the content script does the
// work with Facebook's own buttons and reports back here.
const SELLING_URL = 'https://www.facebook.com/marketplace/you/selling';

async function startFbJob({ job }, sender) {
  const jobId = crypto.randomUUID();
  const url = job.kind === 'renew' ? 'https://www.facebook.com/marketplace/selling/renew_listings/'
    : (job.kind === 'price' || job.kind === 'photos' || job.kind === 'readDesc') && job.id ? `https://www.facebook.com/marketplace/edit/?listing_id=${job.id}` : SELLING_URL;
  // Background tab so you can keep working. The one exception is a full sync
  // (first time, or when asked): Facebook only loads older listings in a visible tab.
  const front = job.kind === 'sync' && job.full;
  const tab = await chrome.tabs.create({ url, active: !!front });
  const { fbJobs = {} } = await chrome.storage.local.get('fbJobs');
  fbJobs[tab.id] = { ...job, jobId, at: Date.now(), returnTo: front && sender.tab ? sender.tab.id : null };
  await chrome.storage.local.set({ fbJobs });
  return { jobId };
}

async function myJob(msg, sender) {
  const { fbJobs = {} } = await chrome.storage.local.get('fbJobs');
  const job = fbJobs[sender.tab && sender.tab.id];
  return { job: job && Date.now() - job.at < 10 * 60 * 1000 ? job : null };
}

async function jobDone({ jobId, result }, sender) {
  const tabId = sender.tab && sender.tab.id;
  const { fbJobs = {}, jobResults = {} } = await chrome.storage.local.get(['fbJobs', 'jobResults']);
  const job = fbJobs[tabId];
  delete fbJobs[tabId];
  for (const k of Object.keys(jobResults)) if (Date.now() - jobResults[k].at > 60 * 60 * 1000) delete jobResults[k];
  jobResults[jobId] = { ...result, at: Date.now() };
  const update = { fbJobs, jobResults };
  if (result.listings) {
    update.fbListings = await mergeListings(result.listings, result.full, job);
    update.fbSyncedAt = Date.now();
  }
  await chrome.storage.local.set(update);
  setTimeout(() => {
    chrome.tabs.remove(tabId).catch(() => {});
    if (job && job.returnTo) chrome.tabs.update(job.returnTo, { active: true }).catch(() => {});
  }, result.ok ? 800 : 4000);
  return {};
}

// A full sync replaces the list. A partial one (background tab, or the cards
// on screen when you visit your selling page) updates what it saw and keeps the rest.
const listingKey = (l) => `${l.title}|${l.listedOn}`;
async function mergeListings(seen, full, job) {
  if (full) return seen;
  const { fbListings = [] } = await chrome.storage.local.get('fbListings');
  const byKey = new Map(seen.map((l) => [listingKey(l), l]));
  let out = fbListings.map((old) => {
    const fresh = byKey.get(listingKey(old));
    if (fresh) { byKey.delete(listingKey(old)); return { ...old, ...fresh, id: fresh.id || old.id, photo: fresh.photo || old.photo }; }
    return old;
  });
  // A deleted listing won't be seen again: drop it.
  if (job && job.action === 'delete') out = out.filter((l) => !(l.title === job.title && String(l.price) === String(job.price)));
  return [...byKey.values(), ...out];
}

async function showMe(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (tabId != null) {
    const { fbJobs = {} } = await chrome.storage.local.get('fbJobs');
    const t = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (fbJobs[tabId] && t[0] && t[0].id !== tabId) { fbJobs[tabId].returnTo = t[0].id; await chrome.storage.local.set({ fbJobs }); }
    await chrome.tabs.update(tabId, { active: true });
  }
  return {};
}

async function passiveSync({ listings }) {
  const merged = await mergeListings(listings, false, null);
  await chrome.storage.local.set({ fbListings: merged, fbSyncedAt: Date.now() });
  return {};
}

async function cancelJob({ jobId }) {
  const { fbJobs = {} } = await chrome.storage.local.get('fbJobs');
  for (const [tabId, j] of Object.entries(fbJobs)) {
    if (j.jobId === jobId) { delete fbJobs[tabId]; chrome.tabs.remove(Number(tabId)).catch(() => {}); }
  }
  await chrome.storage.local.set({ fbJobs });
  return {};
}

// Auto post finished in a Facebook tab.
async function markPosted({ id }) {
  const { listings = [] } = await chrome.storage.local.get('listings');
  const l = listings.find((x) => x.id === id);
  if (l) { l.status = 'posted'; l.postedAt = Date.now(); await chrome.storage.local.set({ listings }); }
  return {};
}

// ---------- auto renew ----------
// Once a day between 9am and 7pm, renew every car listing Facebook says is ready.
async function waitJob(jobId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1500);
    const { jobResults = {} } = await chrome.storage.local.get('jobResults');
    if (jobResults[jobId]) return jobResults[jobId];
  }
  await cancelJob({ jobId });
  throw new Error('Facebook took too long');
}

async function renewNow({ titles } = {}) {
  const { jobId } = await startFbJob({ job: { kind: 'renew', carsOnly: true, titles: titles || null } }, {});
  const r = await waitJob(jobId, 180000);
  const lastRenew = { at: Date.now(), ok: !!r.ok, renewed: r.renewed || [], error: r.ok ? '' : r.error || '' };
  await chrome.storage.local.set({ lastRenew });
  if (!r.ok) throw new Error(r.error);
  return lastRenew;
}

async function autoRenewTick() {
  const { settings = {}, lastRenew } = await chrome.storage.local.get(['settings', 'lastRenew']);
  if (!settings.autoRenew) return;
  const h = new Date().getHours();
  if (h < 9 || h >= 19) return;
  if (lastRenew && Date.now() - lastRenew.at < 20 * 3600 * 1000) return;
  try { await renewNow(); } catch (e) {}
}
chrome.alarms.create('autoRenew', { periodInMinutes: 60, delayInMinutes: 2 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'autoRenew') autoRenewTick(); });

const handlers = { extractFromTab, extractFromUrl, extractCarfax, listVehicleLinks, fetchImage, openComposer, myListing, startFbJob, myJob, jobDone, cancelJob, markPosted, passiveSync, showMe, renewNow: async (m) => ({ result: await renewNow(m) }), cloudSyncNow: async () => { await LHCloudSync.syncOnce(); return {}; } };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  h(msg, sender).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});
