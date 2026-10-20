/* Your own photos (from your PC, including iPhone photos synced by iCloud),
 * kept in this browser's extension storage. Used by the app page and by the
 * background worker, which hands them to the Facebook tab. */
(function (global) {
  const DB = 'lhml-photos', STORE = 'photos';
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }
  const put = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const del = (id) => tx('readwrite', (s) => s.delete(id));

  // Shrink big phone photos (often 4000+ px, HEIC converted by the browser) to a
  // sensible size before saving. Returns a JPEG blob.
  async function prepare(file, maxSide = 2400) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) : await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    } catch (e) {
      return file; // e.g. a format the browser can't open; keep the original
    }
  }

  async function add(file) {
    const id = 'local-' + crypto.randomUUID();
    await put(id, await prepare(file));
    return id;
  }

  const urlCache = new Map();
  async function objectUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const blob = await get(id);
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    urlCache.set(id, u);
    return u;
  }

  global.LHLocal = { add, get, del, objectUrl };
})(typeof window !== 'undefined' ? window : globalThis);
