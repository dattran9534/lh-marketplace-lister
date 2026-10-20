/* Photo helpers shared by the app page and the Facebook filler.
 * - smallUrl: the dealer CDN's 640x480 copy, for fast previews and analysis
 * - analyze: detects the "Lynnwood Honda" banner and returns how much of the
 *   top to trim, plus a small JPEG for the AI photo sorter
 * - finalize: full size photo -> banner trimmed, resized JPEG for Facebook */
(function (global) {
  function smallUrl(url, size = '640x480') {
    return /content\.homenetiol\.com\/.+\/0x0\//i.test(url) ? url.replace('/0x0/', `/${size}/`) : url;
  }

  // Looks for a solid white plate in the top right corner (the dealer
  // banner) and finds where it ends. Returns the fraction of height to trim
  // from the top, or 0 when there is no banner.
  function detectBanner(data, W, H) {
    const white = (x, y) => {
      const i = (y * W + x) * 4;
      return data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225;
    };
    const frac = (x0, x1, y0, y1) => {
      let n = 0, w = 0;
      for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++)
        for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x += 2) { n++; if (white(x, y)) w++; }
      return n ? w / n : 0;
    };
    // The banner is mostly white with the blue Honda logo and lettering.
    const blue = (x0, x1, y0, y1) => {
      let n = 0, b = 0;
      for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++)
        for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x++) {
          const i = (y * W + x) * 4; n++;
          if (data[i + 2] > 110 && data[i + 2] - data[i] > 50 && data[i + 2] - data[i + 1] > 15) b++;
        }
      return n ? b / n : 0;
    };
    const top = frac(0.62, 0.98, 0.01, 0.07);
    if (top < 0.45 || blue(0.5, 0.98, 0.01, 0.12) < 0.015) return 0;
    let bottom = 0;
    const gap = Math.max(4, Math.round(H * 0.05));
    for (let x = Math.floor(W * 0.6); x < W * 0.98; x += Math.max(1, Math.floor(W / 60))) {
      let last = -1, miss = 0;
      for (let y = 0; y < H * 0.35; y++) {
        if (white(x, y)) { last = y; miss = 0; }
        else if (last >= 0 && ++miss > gap) break;
      }
      bottom = Math.max(bottom, last);
    }
    const cut = bottom / H + 0.015;
    return cut > 0.04 && cut < 0.3 ? +cut.toFixed(3) : 0;
  }

  async function bitmapFrom(blob) {
    return createImageBitmap(blob);
  }

  function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  async function toBlob(c, type = 'image/jpeg', quality = 0.9) {
    if (c.convertToBlob) return c.convertToBlob({ type, quality });
    return new Promise((r) => c.toBlob(r, type, quality));
  }

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // App side: fetch the small copy, detect the banner, make an AI thumbnail.
  async function analyze(url, fallback, givenBlob) {
    let blob = givenBlob || null;
    if (!blob) for (const u of [smallUrl(url), url, fallback].filter(Boolean)) {
      try {
        const r = await fetch(u, { credentials: 'omit' });
        if (r.ok) { blob = await r.blob(); break; }
      } catch (e) {}
    }
    if (!blob) return { cropTop: 0, thumb: null };
    const bmp = await bitmapFrom(blob);
    const W = 400, H = Math.round((bmp.height * W) / bmp.width);
    const c = canvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, W, H);
    const cropTop = detectBanner(g.getImageData(0, 0, W, H).data, W, H);
    // Thumbnail for the AI sorter: 320px wide, banner already trimmed.
    const tW = 320, srcY = Math.round(bmp.height * cropTop), srcH = bmp.height - srcY;
    const tH = Math.round((srcH * tW) / bmp.width);
    const t = canvas(tW, tH);
    t.getContext('2d').drawImage(bmp, 0, srcY, bmp.width, srcH, 0, 0, tW, tH);
    const thumb = await blobToBase64(await toBlob(t, 'image/jpeg', 0.8));
    return { cropTop, thumb };
  }

  // Facebook side: trim the banner and resize for upload.
  async function finalize(blob, cropTop = 0, maxSide = 2048) {
    try {
      const bmp = await bitmapFrom(blob);
      const srcY = Math.round(bmp.height * (cropTop || 0));
      const srcH = bmp.height - srcY;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, srcH));
      const w = Math.round(bmp.width * scale), h = Math.round(srcH * scale);
      const c = canvas(w, h);
      c.getContext('2d').drawImage(bmp, 0, srcY, bmp.width, srcH, 0, 0, w, h);
      return await toBlob(c, 'image/jpeg', 0.9);
    } catch (e) {
      return blob;
    }
  }

  global.LHImage = { smallUrl, detectBanner, analyze, finalize, blobToBase64 };
})(typeof window !== 'undefined' ? window : globalThis);
