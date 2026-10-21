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
    postsPerDay: 5,
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

  // A Honda that just arrived (the dealer page still shows the catalog picture) and fits
  // HondaTrue Certified (up to 6 years old, under 80,000 miles) gets certified after reconditioning.
  // Warranty: 7 years / 100,000 miles from the original in-service date (or the model year).
  function willCertifyInfo(raw, carfax) {
    if (raw.certified || !raw.stockPhotos || !/honda/i.test(raw.make || '')) return null;
    if (raw.willCertify === false) return null;
    const year = Number(raw.year) || 0, now = new Date().getFullYear();
    if (!year || now - year > 6 || (raw.mileage && raw.mileage >= 80000)) return null;
    let until = year + 7;
    const start = carfax && carfax.inServiceDate;
    if (start) until = new Date(start + 'T12:00:00').getFullYear() + 7;
    if (until <= now) return null;
    return { until: String(until) };
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

  // How the miles compare with the usual ~12,000 a year for a car this age.
  function milesInfo(fb) {
    if (!fb.mileage || !fb.year) return null;
    const age = Math.max(1, new Date().getFullYear() - Number(fb.year) + 0.5);
    const perYear = Math.round(fb.mileage / age / 100) * 100;
    const level = perYear < 6000 && age >= 3 ? 'super' : perYear < 9500 ? 'low' : '';
    return { perYear, age, level };
  }
  function milesNote(fb) {
    const m = milesInfo(fb);
    return m && m.level ? `${m.level === 'super' ? 'super low' : 'low'} for the year, about ${m.perYear.toLocaleString('en-US')} miles a year` : '';
  }

  // What makes THIS car different, most unusual first. The writer builds the post around these.
  function standouts(raw, fb, carfax, settings) {
    const out = [];
    const hist = carfax ? carfax.positives : [];
    const has = (re) => hist.some((h) => re.test(h));
    const year = Number(fb.year) || 0;
    const age = new Date().getFullYear() - year;
    const model = (fb.model || '').split(' ')[0];
    const miles = fb.mileage ? Number(fb.mileage).toLocaleString('en-US') : '';
    const m = milesInfo(fb);
    if (m && m.level === 'super') out.push(`Only ${miles} miles on a ${year} ${model}. That's about ${m.perYear.toLocaleString('en-US')} miles a year when most cars do 12,000, super low for its age`);
    else if (m && m.level === 'low') out.push(`${miles} miles, low for a ${year} (about ${m.perYear.toLocaleString('en-US')} a year)`);
    else if (fb.mileage && age <= 2 && fb.mileage < 25000) out.push(`Barely broken in at ${miles} miles`);
    const cert = certifiedSentence(certifiedInfo(raw, carfax));
    if (cert) out.push(cert);
    if (has(/^One owner/)) out.push('One owner');
    const clean = [has(/^Clean title/) && 'clean title', has(/^No accidents/) && 'no accidents reported'].filter(Boolean);
    if (clean.length) out.push(cap(joinList(clean)));
    if (has(/^No accidents/) && /^(Excellent|Very good)$/i.test((settings && settings.condition) || fb.condition || '')) out.push('Clean condition');
    if (has(/Well serviced|serviced right here/i)) out.push(has(/serviced right here/i) ? 'Well serviced, sold and serviced right here at Lynnwood Honda' : 'Well serviced');
    if (has(/Locally owned/)) out.push('Locally owned in Washington');
    if (raw.drive === 'AWD' || raw.drive === '4WD') out.push(raw.drive === 'AWD' ? 'AWD' : '4WD');
    if (fb.fuelType === 'Hybrid' || fb.fuelType === 'Plug-in hybrid' || fb.fuelType === 'Electric') out.push(fb.fuelType === 'Electric' ? 'All electric' : 'Hybrid');
    if (/manual/i.test(raw.transmission || '') || /\b6MT|manual\b/i.test(raw.trim || '')) out.push('Manual transmission');
    // Features that are notable for this car's age and class, not a list of everything.
    const text = [(raw.features || []).join(' | '), raw.dealerDescription].join(' | ');
    if (raw.seats >= 7 || /3rd row|third row/i.test(text)) out.push('Third row seating');
    if (age >= 8 && /apple ?carplay|android auto/i.test(text)) out.push('Apple CarPlay / Android Auto, rare for its year');
    if (age >= 10 && /back ?up camera|rear ?view camera/i.test(text)) out.push('Backup camera, rare for its year');
    if (/panoramic/i.test(text)) out.push('Panoramic roof');
    return out;
  }

  // Everything the writer is allowed to use. Negatives are never included.
  function factsFor(raw, fb, carfax, settings) {
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
      standouts: standouts(raw, fb, carfax, settings),
      topFeatures: topFeatures(raw, fb),
      allFeatures: (raw.features || []).slice(0, 60),
      verifiedHistory: carfax ? carfax.positives : [],
      certified: certifiedSentence(certifiedInfo(raw, carfax)),
    };
  }

  // The 3 or 4 features buyers care most about, most appealing first.
  const KEY_FEATURES = [
    ['leather', /leather|leatherette/i, 'leather seats'],
    ['heated', /heated (front )?seats?|seat heaters?/i, 'heated seats'],
    ['vent', /ventilated|cooled seats?/i, 'ventilated seats'],
    ['wheel', /heated steering/i, 'a heated steering wheel'],
    ['pano', /panoramic/i, 'a panoramic roof'],
    ['roof', /moon ?roof|sun ?roof/i, 'a moonroof'],
    ['audio', /\bbose\b|premium (sound|audio)|\bels\b|harman|jbl|bang & olufsen|burmester/i, 'a premium sound system'],
    ['hud', /head[- ]?up display/i, 'a head-up display'],
    ['cam360', /360|surround view|multi[- ]?view camera/i, 'a 360 camera'],
    ['park', /parking (sensors?|assist|aid)|park assist|park distance/i, 'parking sensors'],
    ['wcp', /wireless (apple )?carplay/i, 'wireless Apple CarPlay'],
    ['nav', /navigation|\bgps\b/i, 'navigation'],
    ['remote', /remote (engine )?start/i, 'remote start'],
    ['acc', /adaptive cruise/i, 'adaptive cruise control'],
    ['third', /3rd row|third row/i, 'a third row'],
    ['lift', /power (lift ?gate|tailgate|hatch)/i, 'a power liftgate'],
    ['charge', /wireless (phone )?charg/i, 'wireless charging'],
    ['blind', /blind spot/i, 'blind spot monitoring'],
    ['cp', /apple carplay|android auto/i, 'Apple CarPlay'],
  ];
  function keyFeatures(raw) {
    const text = [(raw.features || []).join(' | '), (raw.trimFeatures || []).join(' | '), raw.dealerDescription].join(' | ');
    const has = new Set(KEY_FEATURES.filter(([, re]) => re.test(text)).map(([id]) => id));
    if (has.has('pano')) has.delete('roof');
    if (has.has('wcp')) has.delete('cp');
    const out = [];
    for (const [id, , label] of KEY_FEATURES) {
      if (!has.has(id) || out.length >= 4) continue;
      if (id === 'heated' && has.has('leather')) { out[out.indexOf('leather seats')] = 'heated leather seats'; continue; }
      out.push(label);
    }
    return out;
  }

  // Dat's own post shape (from his RDX post), filled with THIS car's facts:
  // 1) Recently arrived! + car + its biggest standout  2) history  3) well cared for ... making it a great ...  4) "...like this are getting harder to find!"
  function describe(raw, fb, settings, carfax) {
    const s = settings || {};
    const hist = carfax ? carfax.positives || [] : [];
    const has = (re) => hist.some((h) => re.test(h));
    const year = Number(fb.year) || '';
    const modelWord = (fb.model || raw.model || '').split(' ')[0];
    const awd = raw.drive === 'AWD' ? 'AWD' : raw.drive === '4WD' ? '4WD' : '';
    let name = `${fb.year} ${fb.make} ${fb.model}`.replace(/\s+/g, ' ').trim();
    if (awd && !new RegExp(`\\b${awd}\\b`).test(name)) name += ` ${awd}`;
    const miles = fb.mileage ? Number(fb.mileage).toLocaleString('en-US') : '';
    const m = milesInfo(fb);
    const serviced = has(/Well serviced|serviced right here/i);
    const here = has(/serviced right here/i);
    const oneOwner = has(/^One owner/);
    const cleanTitle = has(/^Clean title/);
    const noAcc = has(/^No accidents/);
    const local = has(/Locally owned/);
    const cleanCond = noAcc && /^(Excellent|Very good)$/i.test(s.condition || fb.condition || '');
    const hybrid = /hybrid|electric/i.test(fb.fuelType || '');
    const thrifty = hybrid || (raw.mpgHwy && raw.mpgHwy >= 33);
    const text = [(raw.features || []).join(' | '), raw.dealerDescription].join(' | ');
    const age = new Date().getFullYear() - (Number(fb.year) || 0);

    // 1. Lead: the biggest standout, with real numbers.
    const withBits = [];
    if (m && m.level === 'super') withBits.push(`only ${miles} miles (super low for a ${year})`);
    else if (m && m.level === 'low') withBits.push(`low miles (${miles})`);
    else if (fb.mileage && age <= 2 && fb.mileage < 25000) withBits.push(`only ${miles} miles`);
    if (serviced) withBits.push(here ? 'an excellent service history right here at Lynnwood Honda' : 'an excellent service history');
    const lead = `Recently arrived! ${name}${withBits.length ? ' with ' + joinList(withBits) : ''}.`;
    const will = willCertifyInfo(raw, carfax);
    const cert = certifiedSentence(certifiedInfo(raw, carfax)) ||
      (will ? `Will be reconditioned and Honda Certified Pre-Owned, with the Honda warranty up to ${will.until}!` : '');

    // 2. History, only what CARFAX shows.
    const histBits = [oneOwner && 'One owner', cleanTitle && 'clean title', noAcc && 'no accidents reported', local && 'locally owned'].filter(Boolean);
    const history = histBits.length ? cap(joinList(histBits)) + '.' : '';

    // 3. Condition + the trim's best features (from the dealer's feature list, or the AI's trim knowledge).
    // A car that hasn't been reconditioned yet isn't described as "well cared for".
    const care = cleanCond && !will ? 'Well cared for and in clean condition.' : '';
    const feats = keyFeatures(raw);
    const trimName = (raw.trim || '').replace(/\b(AWD|FWD|4WD|2WD|CVT|Automatic|Manual|Sedan|Hatchback|Coupe)\b/gi, '').replace(/\s+/g, ' ').trim();
    const featLine = feats.length >= 2 ? `Comes equipped with ${joinList(feats)}.` : '';

    // 4. Closing, specific to this car.
    const plural = /^[A-Z0-9-]+$/.test(modelWord) ? modelWord + 's' : /(s|x|z|ch|sh)$/i.test(modelWord) ? modelWord + 'es' : modelWord + 's';
    const adj = [(cleanTitle || noAcc) && 'Clean', m && m.level && 'low-mileage', oneOwner && 'one-owner'].filter(Boolean);
    const close = adj.length ? `${adj.join(' ').replace(/^Clean /, 'Clean, ')} ${plural} like this are getting harder to find!`.replace(/^(\w)/, (c) => c.toUpperCase())
      : cert ? `Certified ${plural} like this don't sit long!` : `Come check it out before it's gone!`;

    // The warranty line is the strongest finish; the "harder to find" line closes the rest.
    return [s.opening, [lead, history, care, featLine, cert, cert ? '' : close].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  }

  // The facts a description must keep (used to throw out AI text that drifted).
  function mustKeep(raw, fb, carfax) {
    const keep = [];
    const m = milesInfo(fb);
    if (m && m.level && fb.mileage) keep.push(Number(fb.mileage).toLocaleString('en-US'));
    const cert = certifiedSentence(certifiedInfo(raw, carfax));
    if (cert) keep.push((cert.match(/\b20\d\d\b/) || [])[0] || 'Certified');
    const will = willCertifyInfo(raw, carfax);
    if (will) keep.push(will.until);
    const hist = carfax ? carfax.positives || [] : [];
    if (hist.some((h) => /^One owner/.test(h))) keep.push('one owner');
    if (hist.some((h) => /^Clean title/.test(h))) keep.push('clean title');
    return keep.filter(Boolean);
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

  global.LHShared = { willCertifyInfo, keyFeatures, mustKeep, standouts, milesInfo, learningSet, postsToLearnFrom, fbKey, daysSince, FB, DEFAULT_SETTINGS, toFacebook, describe, topFeatures, parseCarfax, factsFor, milesNote, firstSaleDate, certifiedInfo, certifiedSentence, mapColor, mapBody, mapFuel, mapMake, modelLine, EXT_RULES, INT_RULES };
  if (typeof module !== 'undefined') module.exports = global.LHShared;
})(typeof window !== 'undefined' ? window : globalThis);
