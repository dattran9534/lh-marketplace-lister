/* Mapping from dealer data to Facebook's exact option names, plus the
 * description writer. Option lists were read from the live
 * facebook.com/marketplace/create/vehicle form (Car/Truck). */
(function (global) {
  const FB = {
    vehicleTypes: ['Car/Truck', 'Motorcycle', 'Powersport', 'RV/Camper', 'Trailer', 'Boat', 'Commercial/Industrial', 'Other'],
    makes: ['Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'BMW', 'Bentley', 'Buick', 'CODA', 'Cadillac', 'Chevrolet', 'Chrysler', 'Daewoo', 'Daihatsu', 'Dodge', 'Eagle', 'Ferrari', 'Fiat', 'Fisker', 'Ford', 'Freightliner', 'GMC', 'Genesis', 'Geo', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'Isuzu', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln', 'Lotus', 'Lucid', 'MINI', 'Maserati', 'Maybach', 'Mazda', 'Mclaren', 'Mercedes-Benz', 'Mercury', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Panoz', 'Plymouth', 'Polestar', 'Pontiac', 'Porsche', 'Ram', 'Rivian', 'Rolls-Royce', 'SRT', 'Saab', 'Saturn', 'Scion', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'],
    bodyStyles: ['Coupe', 'Truck', 'Sedan', 'Hatchback', 'SUV', 'Convertible', 'Wagon', 'Minivan', 'Small Car', 'Other'],
    colors: ['Black', 'Blue', 'Brown', 'Gold', 'Green', 'Gray', 'Pink', 'Purple', 'Red', 'Silver', 'Orange', 'White', 'Yellow', 'Charcoal', 'Off white', 'Tan', 'Beige', 'Burgundy', 'Turquoise'],
    conditions: ['Excellent', 'Very good', 'Good', 'Fair', 'Poor'],
    fuelTypes: ['Diesel', 'Electric', 'Gasoline', 'Flex', 'Hybrid', 'Petrol', 'Plug-in hybrid', 'Other'],
    transmissions: ['Automatic transmission', 'Manual transmission'],
  };

  const DEFAULT_SETTINGS = {
    location: 'Edmonds, Washington',
    fillLocation: false,
    condition: 'Excellent',
    opening: '\u{1F4CD} Contact me, Dat, for more information or schedule for test drive!!!',
    aiProvider: 'gemini',
    autoRenew: false,
    cloudUrl: 'https://auiprvcueqekuhuxepjp.supabase.co',
    cloudKey: 'sb_publishable_bgpi0s-mZeWhG6Mo3seTiA_Ug7eyR6o',
    geminiKey: '',
    apiKey: '',
    useAI: true,
    removeBanner: true,
    sortPhotos: true,
    autoFill: true,
    fillVin: false,
    maxPhotos: 20,
  };

  const lc = (s) => (s || '').toLowerCase();
  const tidy = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function mapMake(raw) {
    const n = lc(raw).replace(/[^a-z]/g, '');
    if (!n) return '';
    if (n === 'chevy') return 'Chevrolet';
    if (n === 'vw') return 'Volkswagen';
    if (n === 'mercedes' || n === 'mercedesbenz') return 'Mercedes-Benz';
    return FB.makes.find((m) => m.toLowerCase().replace(/[^a-z]/g, '') === n) || tidy(raw);
  }

  // Ordered: most specific first.
  const EXT_RULES = [
    [/burgundy|maroon|wine|merlot|garnet|cabernet/, 'Burgundy'],
    [/charcoal/, 'Charcoal'],
    [/off ?white|ivory|cream/, 'Off white'],
    [/turquoise|teal|aqua/, 'Turquoise'],
    [/modern steel|sonic gr[ae]y|meteorite|urban gr[ae]y|pewter|graphite|gunmetal|magnetic|smoke|lunar rock|polished metal|granite|slate|tungsten|iridium|storm|steel|gr[ae]y/, 'Gray'],
    [/silver|platinum(?! white)/, 'Silver'],
    [/white|snow|glacier|pearl white|platinum white/, 'White'],
    [/black|obsidian black|ebony|onyx|jet/, 'Black'],
    [/blue|obsidian|still night|aegean|navy|sapphire|cobalt|indigo|lapis|boost|canyon river|midnight/, 'Blue'],
    [/red|ruby|crimson|cherry|scarlet|rallye|san marino|radiant/, 'Red'],
    [/green|forest|olive|sage|emerald|jade/, 'Green'],
    [/brown|bronze|copper|mocha|espresso|chestnut|java|mahogany|caramel/, 'Brown'],
    [/gold|champagne/, 'Gold'],
    [/orange|molten lava|tangerine/, 'Orange'],
    [/yellow/, 'Yellow'],
    [/purple|violet|plum/, 'Purple'],
    [/pink/, 'Pink'],
    [/beige|sand|desert|khaki|stone|parchment|cashmere/, 'Beige'],
    [/\btan\b|saddle|camel/, 'Tan'],
  ];
  const INT_RULES = [
    [/black|ebony|jet|onyx/, 'Black'],
    [/gr[ae]y|graphite|ash/, 'Gray'],
    [/ivory|beige|sand|parchment|cashmere|stone|cream|almond|light/, 'Beige'],
    [/\btan\b|saddle|camel|caramel/, 'Tan'],
    [/brown|mocha|espresso|java|cocoa|chestnut/, 'Brown'],
    [/red|burgundy|maroon/, 'Red'],
    [/white/, 'White'],
    [/blue|navy/, 'Blue'],
  ];
  function mapColor(raw, rules) {
    const s = lc(raw);
    if (!s) return '';
    const exact = FB.colors.find((c) => c.toLowerCase() === s);
    if (exact) return exact;
    const hit = rules.find(([re]) => re.test(s));
    return hit ? hit[1] : '';
  }

  function mapBody(raw, model, trim) {
    const r = lc(raw);
    const m = lc(`${model} ${trim}`);
    if (/hatch/.test(r + ' ' + m)) return 'Hatchback';
    if (/coupe/.test(r + ' ' + m)) return 'Coupe';
    if (/convertible|cabrio|roadster/.test(r + ' ' + m)) return 'Convertible';
    const byModel = [
      [/odyssey|sienna|pacifica|carnival|sedona|grand caravan|quest|town & country/, 'Minivan'],
      [/ridgeline|f-?\d{3}|silverado|sierra|tacoma|tundra|\bram\b|frontier|ranger|colorado|canyon|gladiator|maverick|santa cruz|titan|crew ?cab|super ?crew|pickup/, 'Truck'],
      [/cr-?v|hr-?v|pilot|passport|prologue|element|rav4|highlander|4runner|sequoia|rogue|murano|pathfinder|armada|tucson|santa fe|palisade|kona|sorento|sportage|telluride|seltos|cx-?\d|mdx|rdx|zdx|explorer|expedition|escape|edge|bronco|equinox|traverse|blazer|tahoe|suburban|yukon|acadia|terrain|wrangler|cherokee|compass|outback|forester|crosstrek|ascent|xc\d0|\bx[1-7]\b|\bq[3-8]\b|\b(gx|rx|nx|ux|tx)\b|model [xy]|tiguan|atlas|id\.?4|venza|outlander|enclave|encore|envision/, 'SUV'],
      [/\bfit\b|versa note|golf|mazda3 hatch|bolt/, 'Hatchback'],
      [/civic|accord|insight|clarity|camry|corolla|sentra|altima|elantra|sonata|jetta|passat|malibu|impala|fusion|mazda3|mazda6|legacy|impreza|\btlx\b|\bilx\b|s60|s90|model 3|model s/, 'Sedan'],
    ];
    const bm = byModel.find(([re]) => re.test(m));
    if (bm) return bm[1];
    if (/sport utility|suv|crossover/.test(r)) return 'SUV';
    if (/sedan|4dr car/.test(r)) return 'Sedan';
    if (/pickup|truck|cab/.test(r)) return 'Truck';
    if (/minivan|van/.test(r)) return 'Minivan';
    if (/wagon/.test(r)) return 'Wagon';
    return '';
  }

  function mapFuel(raw, model, trim) {
    const s = lc(`${raw} ${model} ${trim}`);
    if (/plug-?in|phev/.test(s)) return 'Plug-in hybrid';
    if (/hybrid/.test(s)) return 'Hybrid';
    if (/electric|\bev\b|battery|prologue|model [3sxy]|id\.?4|ioniq [56]|bolt|leaf|e-tron|mach-e|lightning|polestar/.test(s)) return 'Electric';
    if (/diesel|tdi/.test(s)) return 'Diesel';
    if (/flex|e85/.test(s)) return 'Flex';
    return 'Gasoline';
  }

  function mapTransmission(raw) {
    return /manual|stick|\b\d ?mt\b|m\/t/i.test(raw || '') ? 'Manual transmission' : 'Automatic transmission';
  }

  function modelLine(d) {
    let model = tidy(d.model);
    let trim = tidy(d.trim);
    if (trim && lc(trim).startsWith(lc(model))) trim = tidy(trim.slice(model.length));
    trim = trim.replace(/\b([2-5] ?dr|sport utility|cvt|automatic|\d\.\dL)\b/gi, '').replace(/\s+/g, ' ').trim();
    const drive = d.drive === 'AWD' || d.drive === '4WD' ? d.drive : '';
    let line = tidy(`${model} ${trim}`);
    if (drive && !new RegExp(`\\b${drive}\\b`, 'i').test(line)) line += ` ${drive}`;
    return line;
  }

  // ---- description ------------------------------------------------------
  const FEATURES = [
    { id: 'awd', test: (d) => d.drive === 'AWD', label: () => 'all wheel drive' },
    { id: '4wd', test: (d) => d.drive === '4WD', label: () => 'four wheel drive' },
    { id: 'hybrid', test: (d) => d.fuel === 'Hybrid' || d.fuel === 'Plug-in hybrid', label: () => 'hybrid fuel economy' },
    { id: 'ev', test: (d) => d.fuel === 'Electric', label: () => 'all electric driving' },
    { id: 'thirdrow', re: /3rd row|third row|(7|8)[\s-]?passenger/i, test: (d) => d.seats >= 7, label: () => 'third row seating' },
    { id: 'carplay', re: /apple ?carplay|android auto/i, label: (t) => (/carplay/i.test(t) && /android auto/i.test(t) ? 'Apple CarPlay and Android Auto' : /carplay/i.test(t) ? 'Apple CarPlay' : 'Android Auto') },
    { id: 'heatedleather', test: (d, t) => /heated (front )?seats?/i.test(t) && /leather(?![\s-]?wrapped)/i.test(t), label: () => 'heated leather seats', covers: ['heated', 'leather'] },
    { id: 'roof', re: /moonroof|sunroof|panoramic/i, label: (t) => (/panoramic/i.test(t) ? 'a panoramic roof' : /moonroof/i.test(t) ? 'a moonroof' : 'a sunroof') },
    { id: 'lowmiles', test: (d) => d.mileage && d.year && d.mileage < 60000 && d.mileage / Math.max(1, new Date().getFullYear() - d.year + 0.5) < 7500, label: () => 'low miles for the year' },
    { id: 'oneowner', re: /\bone owner\b|\b1[\s-]owner\b|single owner/i, label: () => 'a one owner history' },
    { id: 'remote', re: /remote (engine )?start/i, label: () => 'remote start' },
    { id: 'heated', re: /heated (front )?(seats?|steering)/i, label: () => 'heated seats' },
    { id: 'leather', re: /leather(?![\s-]?wrapped)/i, label: () => 'leather seats' },
    { id: 'adaptive', re: /adaptive cruise|honda sensing/i, label: () => 'adaptive cruise control' },
    { id: 'blind', re: /blind ?spot|lanewatch/i, label: () => 'blind spot monitoring' },
    { id: 'nav', re: /navigation|\bnavi\b/i, label: () => 'built in navigation' },
    { id: 'liftgate', re: /power (lift ?gate|tailgate|hatch)/i, label: () => 'a power liftgate' },
    { id: 'wireless', re: /wireless (phone )?charg/i, label: () => 'wireless charging' },
    { id: 'tow', re: /tow(ing)? (package|pkg|hitch)|trailer hitch/i, label: () => 'a tow package' },
    { id: 'camera', re: /back ?up camera|rear ?view camera|multi.?angle/i, label: () => 'a backup camera' },
  ];

  function topFeatures(raw, fb) {
    const text = [(raw.features || []).join(' | '), raw.dealerDescription, raw.headline, raw.trim].join(' | ');
    const d = { drive: raw.drive, seats: raw.seats, fuel: fb.fuelType, mileage: fb.mileage, year: fb.year };
    const used = new Set();
    const out = [];
    for (const f of FEATURES) {
      if (out.length >= 3) break;
      if (used.has(f.id)) continue;
      const ok = (f.test && f.test(d, text)) || (f.re && f.re.test(text));
      if (!ok) continue;
      out.push(f.label(text));
      used.add(f.id);
      (f.covers || []).forEach((c) => used.add(c));
      if (f.id === 'awd' || f.id === '4wd') { used.add('awd'); used.add('4wd'); }
    }
    return out;
  }

  const joinList = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  // ---- CARFAX ------------------------------------------------------------
  // Original in-service date: the earliest first sale event in the detailed
  // history ("Registration issued or renewed", "Vehicle sold", "Vehicle purchase
  // reported", "Title issued or updated", "First owner reported").
  // Returns "YYYY-MM-DD" or ''.
  function firstSaleDate(text) {
    const start = text.search(/Detailed History/i);
    const lines = (start >= 0 ? text.slice(start) : text).split('\n').map((s) => s.trim()).filter(Boolean);
    const SALE = /Registration issued or renewed|Vehicle purchase reported|Vehicle sold|Title issued or updated|First owner reported|Titled or registered/i;
    let date = null, best = null;
    for (const l of lines) {
      const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) { date = `${m[3]}-${m[1]}-${m[2]}`; continue; }
      if (date && SALE.test(l) && (!best || date < best)) best = date;
    }
    return best || '';
  }

  // Honda True Certified warranty line from the dealer's terms and the in-service date.
  function certifiedInfo(raw, carfax) {
    if (!raw.certified) return null;
    const months = raw.warrantyMonths || 84;
    const miles = raw.warrantyMiles || 100000;
    const years = months % 12 ? `${months} month` : `${months / 12} year`;
    const terms = `${years}/${Number(miles).toLocaleString('en-US')} mile`;
    const info = { name: raw.certified, terms, months, miles, until: '', expired: false };
    const start = carfax && carfax.inServiceDate;
    if (start) {
      const d = new Date(start + 'T12:00:00');
      d.setMonth(d.getMonth() + months);
      info.until = String(d.getFullYear());
      info.expired = d < new Date();
    }
    if (raw.mileage && raw.mileage >= miles) info.expired = true;
    return info;
  }

  function certifiedSentence(c) {
    if (!c) return '';
    // Short and simple, like Dat writes it: "Honda True Certified with warranty through 2031."
    if (c.expired) return `${c.name}.`;
    return c.until ? `${c.name} with warranty through ${c.until}.` : `${c.name} with Honda warranty.`;
  }
  // Reads the text of a CARFAX report. Returns every fact found, split into
  // positives (safe to advertise) and negatives (never sent to the writer).
  function parseCarfax(text) {
    const t = text || '';
    if (!/carfax/i.test(t)) return null;
    const num = (re) => { const m = t.match(re); return m ? parseInt(m[1], 10) : null; };
    const owners = /CARFAX 1-Owner|\b1 Previous Owner\b/i.test(t) ? 1 : num(/(\d+)\s+Previous Owners?/i);
    const serviceRecords = num(/(\d+)\s+Service History Records?/i);
    // Real events read "Damage reported: minor damage"; the clean summary reads
    // "No Accidents or Damage Reported", which must not count.
    const damage = /\b(Damage|Accident) reported:/i.test(t) ||
      /(?<!No )(structural damage|airbag deployment|total loss|frame damage) reported/i.test(t);
    const noAccidents = !damage && /No accidents? or damage reported/i.test(t);
    const titleGuarantee = /None of these title problems were reported/i.test(t);
    const titleProblem = /title problem reported|(salvage|rebuilt|junk|flood|lemon|fire|hail)( title| brand)? (reported|issued)/i.test(t);
    const lastState = (t.match(/Last Owned in ([A-Z][A-Za-z ]+?)\s*(?:\n|$)/) || [])[1] || '';
    const f = {
      owners,
      serviceRecords,
      personal: /Personal Vehicle/i.test(t),
      lastState,
      damage,
      noAccidents,
      cleanTitle: titleGuarantee && !titleProblem,
      homegrown: /CARFAX Homegrown/i.test(t),
      recentlyServiced: /recently serviced/i.test(t),
      lowMileageOwner: /Low mileage!/i.test(t),
      value: (t.match(/\b(GREAT|GOOD) VALUE\b/) || [])[1] || '',
      greatReliability: /GREAT RELIABILITY/.test(t),
      noOpenRecalls: /No open recalls/i.test(t),
      fleetOrRental: /\b(Rental|Fleet|Commercial) Vehicle\b/i.test(t),
      inServiceDate: firstSaleDate(t),
    };
    const positives = [];
    if (f.owners === 1) positives.push('One owner');
    if (f.cleanTitle) positives.push('Clean title');
    if (f.noAccidents) positives.push('No accidents or damage reported');
    if (f.serviceRecords >= 3) positives.push('Well serviced');
    if (f.homegrown) positives.push('Sold and serviced right here at Lynnwood Honda');
    if (f.personal && !f.fleetOrRental) positives.push('Personal vehicle, not a rental or fleet car');
    if (/^washington$/i.test(f.lastState) && f.personal) positives.push('Locally owned in Washington');
    if (f.recentlyServiced) positives.push('Recently serviced');
    if (f.lowMileageOwner) positives.push('Driven fewer miles than average per year');
    if (f.greatReliability) positives.push('CARFAX rates its reliability as great');
    if (f.noOpenRecalls) positives.push('No open recalls');
    const negatives = [];
    if (f.damage) negatives.push('damage or accident reported');
    if (f.owners > 1) negatives.push(`${f.owners} previous owners`);
    if (f.fleetOrRental) negatives.push('rental, fleet or commercial use');
    if (titleGuarantee && titleProblem) negatives.push('title problem');
    return { ...f, positives, negatives };
  }

  function milesNote(fb) {
    if (!fb.mileage || !fb.year) return '';
    const yrs = Math.max(0.5, new Date().getFullYear() - Number(fb.year) + 0.5);
    const perYear = Math.round(fb.mileage / yrs / 100) * 100;
    return perYear < 10000 ? `low for the year, about ${perYear.toLocaleString('en-US')} miles a year` : '';
  }

  // Everything the writer is allowed to use. Negatives are never included.
  function factsFor(raw, fb, carfax) {
    return {
      vehicle: `${fb.year} ${fb.make} ${fb.model}`.trim(),
      mileage: fb.mileage ? `${Number(fb.mileage).toLocaleString('en-US')} miles${milesNote(fb) ? ` (${milesNote(fb)})` : ''}` : '',
      drive: raw.drive === 'AWD' ? 'AWD (all wheel drive)' : raw.drive === '4WD' ? '4WD (four wheel drive)' : '',
      exterior: raw.exteriorColor || '',
      interior: raw.interiorColor || '',
      body: fb.bodyStyle,
      fuel: fb.fuelType,
      engine: raw.engine || '',
      seats: raw.seats || '',
      topFeatures: topFeatures(raw, fb),
      allFeatures: (raw.features || []).slice(0, 60),
      verifiedHistory: carfax ? carfax.positives : [],
      certified: certifiedSentence(certifiedInfo(raw, carfax)),
    };
  }

  // Fallback writer used when AI is off or unavailable. Same shape as Dat's posts.
  function describe(raw, fb, settings, carfax) {
    const s = settings || {};
    const hist = carfax ? carfax.positives : [];
    const has = (re) => hist.some((h) => re.test(h));
    const lowMiles = !!milesNote(fb);
    const name = `${fb.year} ${fb.make} ${fb.model}`.replace(/\s+/g, ' ').trim();
    const p1 = [];
    let lead = `Recently arrived! ${name}`;
    const withBits = [];
    if (lowMiles) withBits.push('low miles');
    if (has(/well serviced|serviced right here/i)) withBits.push('a solid service history');
    if (withBits.length) lead += ` with ${joinList(withBits)}`;
    p1.push(lead + '.');
    const histBits = [];
    if (has(/^One owner/)) histBits.push('One owner');
    if (has(/^Clean title/)) histBits.push('clean title');
    if (has(/^No accidents/)) histBits.push('no accidents reported');
    if (has(/Locally owned/)) histBits.push('locally owned');
    if (histBits.length) p1.push(cap(joinList(histBits)) + '.');
    const cert = certifiedSentence(certifiedInfo(raw, carfax));
    if (cert) p1.push(cert);
    const feats = topFeatures(raw, fb);
    const p2 = [];
    if (feats.length) p2.push(`Equipped with ${joinList(feats)}, making it a great ${fb.bodyStyle === 'SUV' ? 'SUV' : fb.bodyStyle === 'Truck' ? 'truck' : 'car'} for the Pacific Northwest.`);
    if (lowMiles) p2.push(`Clean, low mileage ${fb.model.split(' ')[0]}s like this are getting harder to find!`);
    return [s.opening, p1.join(' '), p2.join(' ')].filter(Boolean).join('\n');
  }

  function toFacebook(raw, settings, carfax) {
    const fb = {
      vin: (raw.vin || '').toUpperCase(),
      vehicleType: 'Car/Truck',
      year: raw.year || '',
      make: mapMake(raw.make),
      model: modelLine(raw),
      mileage: raw.mileage || '',
      price: raw.price || '',
      bodyStyle: mapBody(raw.bodyStyle, raw.model, raw.trim),
      exteriorColor: mapColor(raw.exteriorColor, EXT_RULES),
      interiorColor: mapColor(raw.interiorColor, INT_RULES),
      cleanTitle: !!(carfax && carfax.cleanTitle),
      condition: (settings && settings.condition) || 'Excellent',
      fuelType: mapFuel(raw.fuelType, raw.model, raw.trim),
      transmission: mapTransmission(raw.transmission),
      location: (settings && settings.location) || '',
    };
    fb.description = describe(raw, fb, settings, carfax);
    return fb;
  }

  // ---- learning from Dat's own posts ------------------------------------
  // "10/19" -> days since that date (assumes the most recent such date).
  function daysSince(listedOn, now = new Date()) {
    const m = String(listedOn || '').match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    let d = new Date(y, +m[1] - 1, +m[2]);
    if (!m[3] && d > now) d = new Date(y - 1, +m[1] - 1, +m[2]);
    return Math.max(1, Math.round((now - d) / 86400000));
  }

  const n2 = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function sameCar(l, f) {
    const t = (f.title || '').toLowerCase();
    if (!t.startsWith(String(l.fb.year))) return false;
    if (!n2(t).includes(n2(l.fb.make))) return false;
    const m = n2((l.fb.model || '').split(' ')[0]);
    return !!m && n2(t).includes(m);
  }

  const fbKey = (f) => `${f.title}|${f.listedOn}`;

  // Your best Facebook posts by clicks per day, whose text we know (read from
  // Facebook, or the app's own copy), plus descriptions you rewrote yourself.
  function learningSet(listings, fbListings, excludeId, fbDesc = {}) {
    listings = listings || [];
    const me = listings.find((l) => l.id === excludeId);
    const winners = [];
    for (const f of fbListings || []) {
      if (!(f.clicks > 0)) continue;
      if (me && me.fb && sameCar(me, f)) continue; // never learn from the car being written
      const appCar = listings.find((l) => l.id !== excludeId && l.fb && l.fb.description && sameCar(l, f));
      const text = (fbDesc[fbKey(f)] && fbDesc[fbKey(f)].text) || (appCar && appCar.fb.description) || '';
      if (text.length < 40) continue;
      const days = daysSince(f.listedOn) || 7;
      // Rank by clicks per day, with 3 extra days added so a day-old post can't win on a lucky start.
      winners.push({ title: f.title, clicks: f.clicks, perDay: +(f.clicks / days).toFixed(1), score: f.clicks / (days + 3), text });
    }
    winners.sort((a, b) => b.score - a.score);
    const edits = listings
      .filter((l) => l.id !== excludeId && l.descBy === 'edited' && l.fb && l.fb.description)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 3)
      .map((l) => l.fb.description);
    return { winners: winners.slice(0, 3), edits };
  }

  // Which Facebook posts are worth reading next (top by clicks per day, text unknown or stale).
  function postsToLearnFrom(fbListings, fbDesc = {}, n = 3) {
    const fresh = (f) => fbDesc[fbKey(f)] && Date.now() - fbDesc[fbKey(f)].at < 14 * 86400000;
    return (fbListings || [])
      .filter((f) => f.clicks > 0)
      .map((f) => ({ f, score: f.clicks / ((daysSince(f.listedOn) || 7) + 3) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((x) => x.f)
      .filter((f) => !fresh(f));
  }

  global.LHShared = { learningSet, postsToLearnFrom, fbKey, daysSince, FB, DEFAULT_SETTINGS, toFacebook, describe, topFeatures, parseCarfax, factsFor, milesNote, firstSaleDate, certifiedInfo, certifiedSentence, mapColor, mapBody, mapFuel, mapMake, modelLine, EXT_RULES, INT_RULES };
  if (typeof module !== 'undefined') module.exports = global.LHShared;
})(typeof window !== 'undefined' ? window : globalThis);
