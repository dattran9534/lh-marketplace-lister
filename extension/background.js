importScripts('extractor.js');

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

async function fetchImage({ url, fallback }) {
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
    const tab = await chrome.tabs.create({ url: COMPOSER_URL, active: i === 0 });
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

const handlers = { extractFromTab, extractFromUrl, extractCarfax, listVehicleLinks, fetchImage, openComposer, myListing };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  h(msg, sender).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});
