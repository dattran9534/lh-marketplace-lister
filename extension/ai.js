/* AI calls made from the app page. Two providers:
 * - Google Gemini (default): free tier, key from aistudio.google.com
 * - Anthropic Claude: paid, key from console.anthropic.com
 * Keys are stored only in this browser. */
(function (global) {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // Writer tries the stronger model first, then the one with the bigger free allowance.
  const GEMINI_WRITER = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const GEMINI_SORTER = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
  const CLAUDE_WRITER = ['claude-sonnet-5-5'];
  const CLAUDE_SORTER = ['claude-haiku-5-5'];

  class AIError extends Error {
    constructor(msg, retryOther) { super(msg); this.retryOther = retryOther; }
  }

  // parts: [{ text } | { image: base64 jpeg }]
  async function geminiCall(key, model, { system, parts, json, maxTokens }) {
    const body = {
      contents: [{ role: 'user', parts: parts.map((p) => (p.image ? { inline_data: { mime_type: 'image/jpeg', data: p.image } } : { text: p.text })) }],
      generationConfig: { maxOutputTokens: maxTokens || 2048, ...(json ? { responseMimeType: 'application/json' } : {}) },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const r = await fetch(`${GEMINI}${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
      if (r.status === 400 && /api key/i.test(msg)) throw new AIError('The Google API key was not accepted. Check it in Settings.');
      if (r.status === 403) throw new AIError('The Google API key was not accepted. Check it in Settings.');
      // Quota used up, model busy, or model not offered: try the next model.
      if (r.status === 429 || r.status === 503 || r.status === 404) throw new AIError(r.status === 429 ? "Today's free Gemini limit is used up. It resets at midnight Pacific." : msg, true);
      throw new AIError(msg);
    }
    const cand = (j.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!text) throw new AIError(cand && cand.finishReason ? `Gemini returned no text (${cand.finishReason})` : 'Gemini returned no text', true);
    return text;
  }

  async function claudeCall(key, model, { system, parts, maxTokens }) {
    const content = parts.map((p) => (p.image ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image } } : { type: 'text', text: p.text }));
    const body = { model, max_tokens: maxTokens || 4000, messages: [{ role: 'user', content }] };
    if (system) body.system = system;
    const r = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
      if (r.status === 401) throw new AIError('The Anthropic API key was not accepted. Check it in Settings.');
      if (/credit/i.test(msg)) throw new AIError('Your Anthropic account is out of credits.');
      throw new AIError(msg, r.status === 429 || r.status === 529);
    }
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  // cfg: { provider: 'gemini' | 'anthropic', key }
  async function run(cfg, role, req) {
    const gem = cfg.provider !== 'anthropic';
    const models = gem ? (role === 'writer' ? GEMINI_WRITER : GEMINI_SORTER) : role === 'writer' ? CLAUDE_WRITER : CLAUDE_SORTER;
    let last;
    for (const m of models) {
      try {
        return gem ? await geminiCall(cfg.key, m, req) : await claudeCall(cfg.key, m, req);
      } catch (e) {
        last = e;
        if (!e.retryOther) break;
      }
    }
    throw last;
  }

  const parseJson = (text) => {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Unexpected reply from the photo sorter');
    return JSON.parse(m[0]);
  };

  const ORDER = { exterior: 0, exterior_detail: 1, interior: 2, other: 3, unknown: 4 };

  // thumbs: base64 JPEGs (null for photos that failed). Returns 0 based results.
  async function classifyPhotos(cfg, thumbs) {
    const parts = [];
    thumbs.forEach((b64, i) => {
      if (!b64) return;
      parts.push({ text: `Image ${i + 1}:` });
      parts.push({ image: b64 });
    });
    parts.push({
      text:
        'These are photos from a used car listing. Label every image with one category:\n' +
        '- "exterior": the whole vehicle seen from outside, any angle\n' +
        '- "exterior_detail": close up of an outside part (wheel, headlight, badge, grille, tailgate)\n' +
        '- "interior": inside the cabin (seats, dashboard, steering wheel, screen, door panel, headliner) or the cargo area / trunk\n' +
        '- "other": engine bay, keys, manuals, documents, window sticker, logos or anything else\n' +
        'Also choose "hero": the photo to show first. It is the front three quarter view of the whole car showing the front and the driver side, usually parked on the waterfront with mountains and a ferry behind it. If there is no such photo, pick the best front three quarter exterior.\n' +
        'Reply with JSON only, using the image numbers shown: {"labels": {"1": "exterior", "2": "interior"}, "hero": 1}',
    });
    const text = await run(cfg, 'sorter', { parts, json: true, maxTokens: 4096 });
    const j = parseJson(text);
    const valid = (v) => (typeof v === 'string' && ORDER[v.toLowerCase().trim()] !== undefined ? v.toLowerCase().trim() : 'unknown');
    const src = j.labels || {};
    const labels = thumbs.map((_, i) => valid(Array.isArray(src) ? src[i] : src[String(i + 1)]));
    const h = Number(j.hero);
    const hero = h >= 1 && h <= thumbs.length && labels[h - 1] === 'exterior' ? h - 1 : labels.indexOf('exterior');
    return { labels, hero };
  }

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

  const SYSTEM =
    'You write Facebook Marketplace vehicle listings for Dat, a car salesperson at Lynnwood Honda in Edmonds, Washington. ' +
    'Write in his voice: upbeat, friendly, plain everyday words, short sentences, like a real person posting, not an ad agency.\n\n' +
    'Here is one of his real posts for a different car. Match its shape and tone, but never reuse its facts:\n' +
    EXAMPLE + '\n\n' +
    'Shape of every post:\n' +
    '1. First line: the opening line you are given, copied exactly.\n' +
    '2. Paragraph one: start with "Recently arrived!" then the year, make, model (and AWD or 4WD if it has it) and the strongest points: mileage if it is low, then the verified history facts in one short sentence.\n' +
    '3. Paragraph two: one or two sentences on two or three standout features and why it suits drivers here in the Pacific Northwest, ending with a short line on why it is a good find.\n\n' +
    'What gets more messages from buyers:\n' +
    '- Facebook shows only the first two or three lines before "See more", so the "Recently arrived!" sentence must carry the biggest selling points: AWD/4WD, low miles, one owner, certified, standout trim.\n' +
    '- Use the plain words buyers search and scan for: AWD, low miles, one owner, clean title, no accidents, well serviced, certified, third row, Apple CarPlay, heated seats, sunroof, hybrid, MPG.\n' +
    '- Lead with history and two or three standout features. Never list every option.\n' +
    '- Sound like a real local seller, not an ad: no hype words (amazing, incredible, must see, won\'t last, deal of a lifetime), no ALL CAPS, no exclamation mark pile ups beyond the opening line. Facebook shows less of salesy posts.\n' +
    '- Give one concrete reason a local buyer would want it (commute, winter roads, family trips, fuel savings).\n\n' +
    'Rules:\n' +
    '- Use only the facts provided. Anything about owners, accidents, title, service history or where it was owned may ONLY come from "Verified history". If a topic is not listed there, do not mention it at all, not even to say it is unknown.\n' +
    '- Never mention damage, accidents, repairs, multiple owners, rental or fleet use, or anything negative.\n' +
    '- Never give a number of service records or visits. Say it is well serviced instead.\n' +
    '- If a "Certified pre-owned" line is given, include it in paragraph one word for word. Keep it short: no warranty miles, months or terms beyond that line. Never mention certification or warranty otherwise.\n' +
    '- Only call the miles low if the mileage line says so.\n' +
    '- Only mention AWD, 4WD or all wheel drive if the drive line says so.\n' +
    '- No price, payments, financing, phone numbers, hashtags or markdown. No emoji except the one in the opening line.\n' +
    '- Never write "Just got this one in".\n' +
    '- 55 to 100 words after the opening line, two paragraphs on separate lines, no blank lines.\n' +
    '- If you are shown Dat\'s best performing posts or his own edits, copy what works in them (hooks, order, word choices, length) but never their facts.\n' +
    'Reply with the post text only.';

  // learn: { winners: [{ text, title, clicks, perDay }], edits: [text] } from Dat's own posts.
  function learnBlock(learn) {
    if (!learn) return '';
    const out = [];
    if (learn.winners && learn.winners.length) {
      out.push("Dat's posts that got the most clicks per day on Facebook. Copy what makes them work, not their facts:");
      learn.winners.forEach((w, i) => out.push(`--- Top post ${i + 1}: ${w.title}, ${w.clicks} clicks (${w.perDay} a day) ---\n${w.text}`));
    }
    if (learn.edits && learn.edits.length) {
      out.push('Descriptions Dat rewrote himself. This is exactly how he likes them to sound:');
      learn.edits.forEach((t, i) => out.push(`--- Dat's edit ${i + 1} ---\n${t}`));
    }
    return out.length ? out.join('\n') + '\n\nNow write the post for this car:\n' : '';
  }

  async function writeDescription(cfg, facts, opening, learn) {
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
      facts.certified && `Certified pre-owned: ${facts.certified}`,
    ].filter(Boolean);
    const text = await run(cfg, 'writer', { system: SYSTEM, parts: [{ text: learnBlock(learn) + lines.join('\n') }], maxTokens: 4000 });
    let out = text.replace(/^["'`]+|["'`]+$/g, '').replace(/\*\*/g, '').replace(/\n{2,}/g, '\n').trim();
    if (opening && !out.startsWith(opening.slice(0, 12))) out = `${opening}\n${out}`;
    return out.replace(/just got this one in/gi, 'Recently arrived');
  }

  async function testKey(cfg) {
    await run(cfg, 'sorter', { parts: [{ text: 'Reply with OK.' }], maxTokens: 1024 });
    return true;
  }

  global.LHAI = { classifyPhotos, sortImages, writeDescription, testKey, ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
