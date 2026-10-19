/* One-click updates for the unpacked extension.
 * 1. Reads update.json (version + zip link) from the update source.
 * 2. Downloads the zip and unpacks it with the browser's built-in deflate.
 * 3. Writes the files into the extension folder (you pick it once; Edge
 *    remembers the choice) and reloads the extension.
 * Your vehicles and settings live in browser storage, not in the folder, so
 * an update never touches them. */
(function (global) {
  const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/dattran9534/lh-marketplace-lister/main/update.json';

  // ---- tiny zip reader (stored + deflate entries) ----
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The update file is not a valid zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Broken zip directory');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = u8.subarray(start, start + csize);
      if (method === 0) files[name] = data.slice();
      else if (method === 8) files[name] = await inflateRaw(data);
      else throw new Error(`Unsupported zip compression in ${name}`);
    }
    return files;
  }

  // ---- remembered folder handle (IndexedDB) ----
  const DB = 'lhml-updater', STORE = 'kv';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(op, key, val) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, op === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore(STORE);
      const req = op === 'get' ? st.get(key) : st.put(val, key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function folderHandle(forcePick) {
    let h = forcePick ? null : await kv('get', 'dir').catch(() => null);
    if (h) {
      const perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
    }
    if (!h) {
      if (!global.showDirectoryPicker) throw new Error('This browser cannot update folders. Use Edge or Chrome.');
      h = await global.showDirectoryPicker({ id: 'lhml-folder', mode: 'readwrite' });
    }
    // Make sure it's really this extension's folder.
    let manifest;
    try {
      const f = await (await h.getFileHandle('manifest.json')).getFile();
      manifest = JSON.parse(await f.text());
    } catch (e) {
      throw new Error('That folder has no manifest.json. Pick the lh-marketplace-lister folder you loaded in Edge.');
    }
    if (manifest.name !== chrome.runtime.getManifest().name) throw new Error('That folder holds a different extension. Pick the lh-marketplace-lister folder.');
    await kv('put', 'dir', h);
    return h;
  }

  async function writeFile(dir, path, bytes) {
    const parts = path.split('/').filter(Boolean);
    let d = dir;
    for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }

  const cmp = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  };

  async function check(source) {
    const r = await fetch((source || DEFAULT_SOURCE) + `?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Couldn't reach the update source (${r.status})`);
    const info = await r.json();
    const current = chrome.runtime.getManifest().version;
    return { ...info, current, available: cmp(info.version, current) > 0 };
  }

  async function install(info, onStep = () => {}, forcePick = false) {
    onStep('Choosing the extension folder…');
    const dir = await folderHandle(forcePick);
    onStep(`Downloading version ${info.version}…`);
    const zipUrl = new URL(info.zip, info.base || DEFAULT_SOURCE).href;
    const r = await fetch(zipUrl + `?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    const files = await unzip(await r.arrayBuffer());
    // The zip holds a top level "lh-marketplace-lister/" folder; strip it.
    const names = Object.keys(files);
    const prefix = names.every((n) => n.startsWith(names[0].split('/')[0] + '/')) ? names[0].split('/')[0] + '/' : '';
    if (!names.some((n) => n.slice(prefix.length) === 'manifest.json')) throw new Error('The update is missing manifest.json');
    let i = 0;
    for (const name of names) {
      onStep(`Installing ${++i} of ${names.length}…`);
      await writeFile(dir, name.slice(prefix.length), files[name]);
    }
    onStep('Restarting…');
    setTimeout(() => chrome.runtime.reload(), 400);
  }

  global.LHUpdater = { check, install, DEFAULT_SOURCE, unzip, pickFolder: () => folderHandle(true) };
})(typeof window !== 'undefined' ? window : globalThis);
