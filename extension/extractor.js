/*
 * Runs inside a vehicle detail page (injected by background.js) and returns
 * a plain object describing the vehicle. Tuned for lynnwoodhonda.com
 * (schema.org Vehicle JSON-LD + .vehicle-gallery-image photos from
 * content.homenetiol.com) with generic fallbacks for other dealer sites.
 * Must stay self-contained: it is serialized and run in the page.
 */
async function extractVehicle() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  const nameOf = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.name || '' : '');
  const num = (s) => {
    const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? Math.round(parseFloat(m[0])) : null;
  };

  // Nudge lazy loaded galleries.
  try {
    const max = Math.min(document.body.scrollHeight, 9000);
    for (let y = 0; y < max; y += 900) { window.scrollTo(0, y); await sleep(90); }
    window.scrollTo(0, 0);
    await sleep(300);
  } catch (e) {}

  const v = { sourceUrl: location.href.split('?')[0], site: location.hostname };

  // ---- 1. schema.org JSON-LD -------------------------------------------
  const nodes = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    nodes.push(o);
    ['@graph', 'itemOffered', 'mainEntity', 'about'].forEach((k) => o[k] && walk(o[k]));
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { walk(JSON.parse(s.textContent)); } catch (e) {}
  });
  const typeOf = (o) => [].concat(o['@type'] || []).join(' ');
  const ld =
    nodes.find((o) => /\b(Car|Vehicle|MotorVehicle|Motorcycle)\b/i.test(typeOf(o))) ||
    nodes.find((o) => o.vehicleIdentificationNumber) ||
    null;

  let ldImages = [];
  if (ld) {
    v.name = txt(ld.name);
    v.vin = txt(ld.vehicleIdentificationNumber || ld.vin || ld.productID).toUpperCase();
    v.stock = txt(ld.sku);
    v.year = num(ld.vehicleModelDate || ld.modelDate || ld.productionDate);
    v.make = txt(nameOf(ld.brand) || nameOf(ld.manufacturer));
    v.model = txt(nameOf(ld.model));
    v.trim = txt(ld.vehicleConfiguration);
    v.mileage = num(ld.mileageFromOdometer && typeof ld.mileageFromOdometer === 'object' ? ld.mileageFromOdometer.value : ld.mileageFromOdometer);
    v.exteriorColor = txt(ld.color);
    v.interiorColor = txt(ld.vehicleInteriorColor);
    v.bodyStyle = txt(ld.bodyType);
    v.fuelType = txt(ld.fuelType || (ld.vehicleEngine && ld.vehicleEngine.fuelType));
    v.transmission = txt(ld.vehicleTransmission);
    v.drive = txt(ld.driveWheelConfiguration);
    v.engine = txt(nameOf(ld.vehicleEngine));
    v.seats = num(ld.vehicleSeatingCapacity);
    const offers = [].concat(ld.offers || []);
    const prices = offers.map((o) => num(o.price ?? o.lowPrice)).filter((p) => p && p > 500);
    if (prices.length) v.price = Math.min(...prices);
    v.condition = txt(ld.itemCondition || (offers[0] && offers[0].itemCondition)).replace(/.*\//, '');
    ldImages = [].concat(ld.image || []).map((i) => (typeof i === 'string' ? i : i && (i.url || i.contentUrl))).filter(Boolean);
  }

  // ---- 2. visible page text fallbacks ----------------------------------
  const h1 = txt(document.querySelector('h1') && document.querySelector('h1').innerText);
  v.headline = h1;
  const body = document.body.innerText || '';
  const labeled = (re) => {
    const m = body.match(new RegExp('(?:^|\\n)\\s*(?:' + re + ')\\s*:?\\s*\\n?\\s*([^\\n]{1,60})', 'i'));
    return m ? txt(m[1]) : '';
  };
  if (!v.vin) v.vin = ((body.match(/\bVIN#?\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i) || [])[1] || '').toUpperCase();
  if (!v.stock) v.stock = (body.match(/\bStock\s*(?:#|No\.?|Number)?\s*:\s*([A-Z0-9-]{3,})/i) || [])[1] || '';
  if (!v.mileage) { const m = labeled('Mileage|Odometer'); v.mileage = num(m); }
  if (!v.exteriorColor) v.exteriorColor = labeled('Exterior(?: Color)?');
  if (!v.interiorColor) v.interiorColor = labeled('Interior(?: Color)?');
  if (!v.bodyStyle) v.bodyStyle = labeled('Body Style|Body');
  if (!v.transmission) v.transmission = labeled('Transmission');
  if (!v.engine) v.engine = labeled('Engine');
  if (!v.fuelType) v.fuelType = labeled('Fuel(?: Type)?');
  if (!v.price) {
    const m = body.match(/(?:Internet|Sale|Our|Selling|Final|Dealer|Your)\s+Price\s*:?\s*\$\s?([\d,]{4,7})/i);
    if (m) v.price = num(m[1]);
  }

  // Year / make / model / trim from the headline when schema is missing.
  if (!v.year || !v.make || !v.model) {
    const MAKES = ['Alfa Romeo', 'Aston Martin', 'Land Rover', 'Mercedes-Benz', 'Rolls-Royce', 'Acura', 'Audi', 'BMW', 'Bentley', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'GMC', 'Genesis', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Lucid', 'MINI', 'Maserati', 'Mazda', 'Mercury', 'Mitsubishi', 'Nissan', 'Polestar', 'Pontiac', 'Porsche', 'Ram', 'Rivian', 'Saab', 'Saturn', 'Scion', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];
    const head = (h1 || v.name || document.title).replace(/^(used|new|certified|pre-owned|cpo)\s+/i, '');
    const ym = head.match(/\b(19[5-9]\d|20[0-4]\d)\b\s+(.*)/);
    if (ym) {
      v.year = v.year || +ym[1];
      const rest = ym[2];
      const mk = MAKES.find((m) => rest.toLowerCase().startsWith(m.toLowerCase() + ' '));
      if (mk) {
        v.make = v.make || mk;
        const after = rest.slice(mk.length).trim().split(/\s+/);
        if (!v.model) v.model = after.shift() || '';
        if (!v.trim) v.trim = after.join(' ');
      }
    }
  }

  // Drive type: schema, headline, or the dealer description ("FWD", "AWD").
  const driveSrc = [v.drive, h1, v.trim, body.slice(0, 20000)].join(' ');
  if (/\b(AWD|all[\s-]?wheel[\s-]?drive)\b/i.test([v.drive, h1, v.trim].join(' '))) v.drive = 'AWD';
  else if (/\b(4WD|4x4|four[\s-]?wheel[\s-]?drive)\b/i.test([v.drive, h1, v.trim].join(' '))) v.drive = '4WD';
  else if (/\b(2WD|FWD|RWD|front[\s-]?wheel[\s-]?drive|rear[\s-]?wheel[\s-]?drive)\b/i.test([v.drive, h1].join(' '))) v.drive = '2WD';
  else {
    const d = driveSrc.match(/\b(AWD|4WD|4x4|FWD|RWD|2WD)\b/);
    v.drive = d ? (/AWD/.test(d[1]) ? 'AWD' : /4WD|4x4/.test(d[1]) ? '4WD' : '2WD') : '';
  }

  // ---- 3. features + dealer description --------------------------------
  const skip = (el) => el.closest('header, nav, footer, [class*="similar" i], [class*="related" i], [class*="recent" i]');
  const featureLines = [];
  const pushLines = (el) => {
    if (!el || skip(el)) return;
    txt(el.innerText).length && el.innerText.split('\n').forEach((l) => {
      l = txt(l);
      if (l && l.length < 70 && !/^features$/i.test(l)) featureLines.push(l);
    });
  };
  document.querySelectorAll('.Features, [class*="key-feature" i], [class*="installed-options" i], [class*="packages-and-option" i]').forEach(pushLines);
  if (!featureLines.length) document.querySelectorAll('[class*="feature" i] li, [class*="option" i] li, [class*="equipment" i] li, [class*="highlight" i] li').forEach(pushLines);
  v.features = [...new Set(featureLines)].slice(0, 250);

  let dealerDescription = '';
  const di = body.search(/Vehicle Description\s*\n/i);
  if (di >= 0) dealerDescription = body.slice(di, di + 1500).replace(/^Vehicle Description\s*/i, '').split(/\n\s*(?:Installed Packages|CarStory|Similar Vehicles)/i)[0];
  else {
    const el = document.querySelector('[class*="vehicle-description" i], [class*="seller-notes" i], [class*="comments" i]');
    dealerDescription = el ? el.innerText : '';
  }
  v.dealerDescription = txt(dealerDescription).slice(0, 1500);

  // ---- 4. photos --------------------------------------------------------
  const BAD = /logo|icon|sprite|badge|carfax|autocheck|placeholder|coming[-_ ]?soon|no[-_]?image|spinner|loader|avatar|staticmap|\.svg(\?|$)|\.gif(\?|$)/i;
  const seen = new Map();
  const order = [];
  const keyOf = (u) => {
    try { const x = new URL(u); return (x.host + x.pathname).toLowerCase().replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, ''); } catch (e) { return u; }
  };
  const bestFromSrcset = (ss) => {
    if (!ss) return '';
    let best = '', bw = 0;
    ss.split(',').forEach((part) => {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d) || 1;
      if (u && w >= bw) { bw = w; best = u; }
    });
    return best;
  };
  const add = (u) => {
    if (!u) return;
    try { u = new URL(u, location.href).href; } catch (e) { return; }
    if (!/^https?:/i.test(u) || BAD.test(u)) return;
    const k = keyOf(u);
    if (!seen.has(k)) { seen.set(k, u); order.push(k); }
  };
  const imgUrl = (img) =>
    bestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset')) ||
    img.getAttribute('data-src') || img.getAttribute('data-lazy') || img.getAttribute('data-original') ||
    img.currentSrc || img.src;

  // lynnwoodhonda.com gallery, in the dealer's order.
  document.querySelectorAll('.vehicle-gallery-image img').forEach((img) => add(imgUrl(img)));
  // Generic galleries on other dealer sites.
  if (order.length < 3) {
    document.querySelectorAll('[class*="gallery" i] img, [class*="slider" i] img, [class*="carousel" i] img, [class*="swiper" i] img, [id*="gallery" i] img, [class*="photo" i] img').forEach((img) => {
      if (!skip(img)) add(imgUrl(img));
    });
  }
  ldImages.forEach(add);
  // Photos whose URL contains the VIN (common on dealer CDNs).
  if (order.length < 3 && v.vin) {
    const html = document.documentElement.innerHTML;
    (html.match(/https?:\/\/[^"'\s()<>\\]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s()<>\\]*)?/gi) || [])
      .filter((u) => u.toUpperCase().includes(v.vin))
      .forEach(add);
  }
  v.images = order.map((k) => {
    const original = seen.get(k);
    let full = original;
    try {
      const x = new URL(original);
      ['w', 'h', 'width', 'height', 'impolicy', 'resize', 'size', 'fit', 'crop'].forEach((p) => x.searchParams.delete(p));
      full = x.href;
    } catch (e) {}
    return { url: full, fallback: full !== original ? original : '' };
  });

  const cf = [...document.querySelectorAll('a[href*="carfax.com/vehiclehistory" i], a[href*="carfax.com/VehicleHistory" i]')][0];
  v.carfaxUrl = cf ? cf.href : '';

  // Honda True Certified badge (img.honda-true-certified-logo, alt "Honda True Certified").
  const badge = [...document.querySelectorAll('img.honda-true-certified-logo, img[alt*="Honda True Certified" i], img[alt*="HondaTrue Certified" i], img[src*="hondatrue" i]')]
    .find((i) => !i.closest('header, nav, footer, [class*="similar" i], [class*="related" i]'));
  v.certified = badge ? (badge.getAttribute('alt') || 'Honda True Certified').trim() : '';
  if (v.certified) {
    // Use the dealer's own stated terms, e.g. "Powertrain Limited Warranty: 84 Month/100,000 Mile ... from original in-service date".
    const w = body.match(/Powertrain Limited Warranty:?\s*(\d+)\s*Month\s*\/\s*([\d,]+)\s*Mile/i);
    v.warrantyMonths = w ? +w[1] : 84;
    v.warrantyMiles = w ? +w[2].replace(/,/g, '') : 100000;
  }

  v.extractedAt = Date.now();
  return v;
}
