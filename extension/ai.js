/* Claude API calls made from the app page (the extension's host permission
 * lets it reach api.anthropic.com directly). Uses your own API key, stored
 * only in this browser. */
(function (global) {
  const API = 'https://api.anthropic.com/v1/messages';
  const WRITER_MODEL = 'claude-sonnet-5-5';
  const SORTER_MODEL = 'claude-haiku-5-5';

  async function call(apiKey, body) {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
      if (r.status === 401) throw new Error('The API key was not accepted. Check it in Settings.');
      if (r.status === 400 && /credit/i.test(msg)) throw new Error('Your Anthropic account is out of credits.');
      throw new Error(msg);
    }
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  const parseJson = (text) => {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Unexpected reply from the photo sorter');
    return JSON.parse(m[0]);
  };

  // thumbs: array of base64 JPEGs (null for photos that failed to load).
  // Returns { labels: [...], hero: index } with 0 based indexes.
  async function classifyPhotos(apiKey, thumbs) {
    const content = [];
    thumbs.forEach((b64, i) => {
      if (!b64) return;
      content.push({ type: 'text', text: `Image ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    });
    content.push({
      type: 'text',
      text:
        'These are photos from a used car listing. Label every image with one category:\n' +
        '- "exterior": the whole vehicle seen from outside, any angle\n' +
        '- "exterior_detail": close up of an outside part (wheel, headlight, badge, grille, tailgate)\n' +
        '- "interior": inside the cabin (seats, dashboard, steering wheel, screen, door panel, headliner) or the cargo area / trunk\n' +
        '- "other": engine bay, keys, manuals, documents, window sticker, logos or anything else\n' +
        'Also choose "hero": the single best exterior photo to show first, ideally a front three quarter view of the whole car.\n' +
        'Reply with JSON only, using the image numbers shown: {"labels": {"1": "exterior", "2": "interior", ...}, "hero": 1}',
    });
    const text = await call(apiKey, { model: SORTER_MODEL, max_tokens: 3000, messages: [{ role: 'user', content }] });
    const j = parseJson(text);
    const valid = (v) => (typeof v === 'string' && ORDER[v.toLowerCase().trim()] !== undefined ? v.toLowerCase().trim() : 'unknown');
    const src = j.labels || {};
    const labels = thumbs.map((_, i) => valid(Array.isArray(src) ? src[i] : src[String(i + 1)]));
    const h = Number(j.hero);
    const hero = h >= 1 && h <= thumbs.length && labels[h - 1] === 'exterior' ? h - 1 : labels.indexOf('exterior');
    return { labels, hero };
  }

  const ORDER = { exterior: 0, exterior_detail: 1, interior: 2, other: 3, unknown: 4 };

  // Returns a new image array: hero first, then exterior, details, interior, other.
  function sortImages(images, labels, hero) {
    return images
      .map((im, i) => ({ im: { ...im, kind: labels[i] || 'unknown' }, i }))
      .sort((a, b) => {
        if (a.i === hero) return -1;
        if (b.i === hero) return 1;
        return (ORDER[a.im.kind] ?? 4) - (ORDER[b.im.kind] ?? 4) || a.i - b.i;
      })
      .map((x) => x.im);
  }

  const EXAMPLE =
    '\u{1F4CD} Contact me, Dat, for more information or schedule for test drive!!!\n' +
    'Recently arrived! 2013 Acura RDX AWD with low miles and an excellent service history. One owner, clean title, no accidents reported, and locally owned.\n' +
    'Well cared for and equipped with AWD, making it a great comfortable and reliable SUV for the Pacific Northwest. Clean, low-mileage one-owner RDXs like this are getting harder to find!';

  async function writeDescription(apiKey, facts, opening) {
    const system =
      'You write Facebook Marketplace vehicle listings for Dat, a car salesperson at Lynnwood Honda in Edmonds, Washington. ' +
      'Write in his voice: upbeat, friendly, plain everyday words, short sentences, like a real person posting, not an ad agency.\n\n' +
      'Here is one of his real posts for a different car. Match its shape and tone, but never reuse its facts:\n' +
      EXAMPLE + '\n\n' +
      'Shape of every post:\n' +
      '1. First line: the opening line you are given, copied exactly.\n' +
      '2. Paragraph one: start with "Recently arrived!" then the year, make, model (and AWD or 4WD if it has it) and the strongest points: mileage if it is low, then the verified history facts in one short sentence.\n' +
      '3. Paragraph two: one or two sentences on two or three standout features and why it suits drivers here in the Pacific Northwest, ending with a short line on why it is a good find.\n\n' +
      'Rules:\n' +
      '- Use only the facts provided. Anything about owners, accidents, title, service history or where it was owned may ONLY come from "Verified history". If a topic is not listed there, do not mention it at all, not even to say it is unknown.\n' +
      '- Never mention damage, accidents, repairs, multiple owners, rental or fleet use, or anything negative.\n' +
      '- Only call the miles low if the mileage line says so.\n' +
      '- Only mention AWD, 4WD or all wheel drive if the drive line says so.\n' +
      '- No price, payments, financing, phone numbers, hashtags or markdown. No emoji except the one in the opening line.\n' +
      '- Never write "Just got this one in".\n' +
      '- 45 to 85 words after the opening line, two paragraphs on separate lines, no blank lines.\n' +
      'Reply with the post text only.';
    const lines = [
      `Opening line: ${opening}`,
      `Vehicle: ${facts.vehicle}`,
      facts.drive && `Drive: ${facts.drive}`,
      facts.mileage && `Mileage: ${facts.mileage}`,
      facts.exterior && `Exterior color: ${facts.exterior}`,
      facts.interior && `Interior color: ${facts.interior}`,
      facts.body && `Body style: ${facts.body}`,
      facts.fuel && `Fuel: ${facts.fuel}`,
      facts.engine && `Engine: ${facts.engine}`,
      facts.seats && `Seats: ${facts.seats}`,
      facts.topFeatures.length && `Most wanted features it has: ${facts.topFeatures.join(', ')}`,
      facts.allFeatures.length && `Full feature list: ${facts.allFeatures.join(', ')}`,
      `Verified history: ${facts.verifiedHistory.length ? facts.verifiedHistory.join('; ') : 'none provided'}`,
    ].filter(Boolean);
    const text = await call(apiKey, {
      model: WRITER_MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
    let out = text.replace(/^["']|["']$/g, '').replace(/\n{2,}/g, '\n').trim();
    if (opening && !out.startsWith(opening.slice(0, 12))) out = `${opening}\n${out}`;
    return out.replace(/just got this one in/gi, 'Recently arrived');
  }

  async function testKey(apiKey) {
    await call(apiKey, { model: SORTER_MODEL, max_tokens: 50, messages: [{ role: 'user', content: 'Reply with OK.' }] });
    return true;
  }

  global.LHAI = { classifyPhotos, sortImages, writeDescription, testKey, ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
