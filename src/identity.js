// velox :: identity.js — coherent synthetic identities for onboarding/fraud-control testing.
//
// Signup risk engines mostly score *contradictions* and *links*, not individual values:
// a US phone with a German address, a random-hex email local-part next to a human name,
// a postal code that doesn't exist in the stated city, or the same device fingerprint
// across twenty accounts. This module generates identities where every field agrees —
// and validates them, so your own test runs can prove the coherence.
//
// Defaults use reserved/documentation values (RFC 2606 domains, ITU fictional number
// ranges) so generated data cannot collide with real people or inboxes. Pass
// `realistic: true` when you are wired to your own test mailbox/SMS infrastructure.

import { createHash } from 'node:crypto';

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const int = (rnd, min, max) => Math.floor(min + rnd() * (max - min + 1));
const digits = (rnd, n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

export function rngFrom(seed) {
  let s = (typeof seed === 'string' ? parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16) : seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* ─────────────────────────────── country data ─────────────────────────────── */

export const COUNTRIES = {
  US: {
    name: 'United States', locale: 'en-US', tz: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
    dial: '+1', regionLabel: 'state',
    first: ['James', 'Maria', 'Daniel', 'Ashley', 'Michael', 'Jessica', 'David', 'Emily', 'Chris', 'Sarah', 'Brian', 'Amanda', 'Kevin', 'Laura', 'Jason', 'Rachel'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson'],
    cities: [
      { city: 'Austin', region: 'TX', zips: ['78701', '78702', '78704'] },
      { city: 'Portland', region: 'OR', zips: ['97201', '97205', '97214'] },
      { city: 'Columbus', region: 'OH', zips: ['43201', '43206', '43215'] },
      { city: 'Charlotte', region: 'NC', zips: ['28202', '28205', '28211'] },
      { city: 'Denver', region: 'CO', zips: ['80202', '80205', '80211'] },
    ],
    streets: ['Maple St', 'Oak Ave', 'Cedar Ln', 'Sunset Blvd', 'Birch Dr', 'Willow Way'],
    phone: (r, fictional = true) => fictional
      ? `+1 ${pick(r, ['202', '303', '415', '512', '614', '704'])}-555-${String(int(r, 100, 199)).padStart(4, '0')}`   // 555-01xx is reserved
      : `+1 ${int(r, 200, 989)}-${int(r, 200, 999)}-${digits(r, 4)}`,
    postal: (zip) => zip,
  },
  GB: {
    name: 'United Kingdom', locale: 'en-GB', tz: ['Europe/London'],
    dial: '+44', regionLabel: 'county',
    first: ['Oliver', 'Amelia', 'Harry', 'Isla', 'Jack', 'Ava', 'George', 'Mia', 'Noah', 'Freya', 'Leo', 'Ivy'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Davies', 'Evans', 'Thomas', 'Roberts'],
    cities: [
      { city: 'Manchester', region: 'Greater Manchester', zips: ['M1 1AE', 'M2 5DB', 'M4 1HN'] },
      { city: 'Bristol', region: 'Bristol', zips: ['BS1 4DJ', 'BS3 4AG'] },
      { city: 'Leeds', region: 'West Yorkshire', zips: ['LS1 4AP', 'LS2 8LX'] },
    ],
    streets: ['High Street', 'Church Lane', 'Victoria Road', 'Station Road', 'Mill Lane'],
    phone: (r, fictional = true) => fictional ? `+44 7700 900${digits(r, 3)}` : `+44 7${digits(r, 3)} ${digits(r, 6)}`,   // 07700 900xxx is reserved
    postal: (z) => z,
  },
  DE: {
    name: 'Germany', locale: 'de-DE', tz: ['Europe/Berlin'],
    dial: '+49', regionLabel: 'state',
    first: ['Lukas', 'Anna', 'Jonas', 'Lena', 'Felix', 'Marie', 'Paul', 'Sophie', 'Max', 'Emma'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Schäfer'],
    cities: [
      { city: 'Berlin', region: 'Berlin', zips: ['10115', '10247', '12043'] },
      { city: 'München', region: 'Bayern', zips: ['80331', '80802'] },
      { city: 'Hamburg', region: 'Hamburg', zips: ['20095', '22765'] },
    ],
    streets: ['Hauptstraße', 'Bahnhofstraße', 'Gartenweg', 'Lindenallee', 'Ringstraße'],
    phone: (r, fictional = true) => fictional ? `+49 30 5550${digits(r, 3)}` : `+49 ${int(r, 30, 89)} ${digits(r, 7)}`,
    postal: (z) => z,
  },
  FR: {
    name: 'France', locale: 'fr-FR', tz: ['Europe/Paris'], dial: '+33', regionLabel: 'region',
    first: ['Lucas', 'Emma', 'Louis', 'Jade', 'Hugo', 'Louise', 'Nathan', 'Alice', 'Théo', 'Chloé'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau'],
    cities: [
      { city: 'Lyon', region: 'Auvergne-Rhône-Alpes', zips: ['69001', '69003'] },
      { city: 'Toulouse', region: 'Occitanie', zips: ['31000', '31500'] },
      { city: 'Nantes', region: 'Pays de la Loire', zips: ['44000', '44100'] },
    ],
    streets: ['Rue de la Paix', 'Avenue Victor Hugo', 'Boulevard Saint-Germain', 'Rue des Fleurs'],
    phone: (r, fictional = true) => fictional ? `+33 6 39 98 0${digits(r, 3)}` : `+33 6 ${digits(r, 2)} ${digits(r, 2)} ${digits(r, 2)} ${digits(r, 2)}`,
    postal: (z) => z,
  },
  BR: {
    name: 'Brazil', locale: 'pt-BR', tz: ['America/Sao_Paulo'], dial: '+55', regionLabel: 'state',
    first: ['João', 'Maria', 'Pedro', 'Ana', 'Lucas', 'Julia', 'Gabriel', 'Beatriz', 'Rafael', 'Camila'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Rodrigues'],
    cities: [
      { city: 'São Paulo', region: 'SP', zips: ['01001-000', '01310-100'] },
      { city: 'Rio de Janeiro', region: 'RJ', zips: ['20040-020', '22041-001'] },
      { city: 'Belo Horizonte', region: 'MG', zips: ['30110-001', '30140-071'] },
    ],
    streets: ['Rua das Flores', 'Avenida Paulista', 'Rua XV de Novembro', 'Travessa do Sol'],
    phone: (r, fictional = true) => `+55 11 9${digits(r, 4)}-${digits(r, 4)}`,
    postal: (z) => z,
  },
  IN: {
    name: 'India', locale: 'en-IN', tz: ['Asia/Kolkata'], dial: '+91', regionLabel: 'state',
    first: ['Aarav', 'Ananya', 'Vivaan', 'Diya', 'Aditya', 'Ishita', 'Arjun', 'Saanvi', 'Rohan', 'Meera'],
    last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Das', 'Mehta'],
    cities: [
      { city: 'Bengaluru', region: 'Karnataka', zips: ['560001', '560034'] },
      { city: 'Pune', region: 'Maharashtra', zips: ['411001', '411045'] },
      { city: 'Chennai', region: 'Tamil Nadu', zips: ['600001', '600028'] },
    ],
    streets: ['MG Road', 'Nehru Nagar', 'Gandhi Street', 'Park Avenue'],
    phone: (r, fictional = true) => `+91 9${digits(r, 4)} ${digits(r, 5)}`,
    postal: (z) => z,
  },
  JP: {
    name: 'Japan', locale: 'ja-JP', tz: ['Asia/Tokyo'], dial: '+81', regionLabel: 'prefecture',
    first: ['Haruto', 'Yui', 'Ren', 'Aoi', 'Sota', 'Hina', 'Yuto', 'Sakura', 'Riku', 'Mio'],
    last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura'],
    cities: [
      { city: 'Tokyo', region: 'Tokyo', zips: ['100-0001', '150-0002'] },
      { city: 'Osaka', region: 'Osaka', zips: ['530-0001', '542-0076'] },
    ],
    streets: ['Chuo-dori', 'Sakura-dori', 'Nishi-ku 3-2-1'],
    phone: (r, fictional = true) => `+81 90-${digits(r, 4)}-${digits(r, 4)}`,
    postal: (z) => z,
  },
  ES: {
    name: 'Spain', locale: 'es-ES', tz: ['Europe/Madrid'], dial: '+34', regionLabel: 'province',
    first: ['Hugo', 'Lucía', 'Martín', 'Sofía', 'Pablo', 'Martina', 'Álvaro', 'Julia'],
    last: ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez'],
    cities: [
      { city: 'Madrid', region: 'Madrid', zips: ['28001', '28013'] },
      { city: 'Barcelona', region: 'Barcelona', zips: ['08001', '08012'] },
    ],
    streets: ['Calle Mayor', 'Avenida del Mar', 'Carrer de Gràcia'],
    phone: (r, fictional = true) => `+34 6${digits(r, 8)}`,
    postal: (z) => z,
  },
  NL: {
    name: 'Netherlands', locale: 'nl-NL', tz: ['Europe/Amsterdam'], dial: '+31', regionLabel: 'province',
    first: ['Daan', 'Emma', 'Sem', 'Tess', 'Lucas', 'Sanne', 'Bram', 'Fleur'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van Dijk', 'Bakker', 'Visser', 'Smit'],
    cities: [
      { city: 'Amsterdam', region: 'Noord-Holland', zips: ['1011 AB', '1017 CT'] },
      { city: 'Rotterdam', region: 'Zuid-Holland', zips: ['3011 AA', '3021 AN'] },
    ],
    streets: ['Kerkstraat', 'Molenweg', 'Prinsengracht'],
    phone: (r, fictional = true) => `+31 6 ${digits(r, 8)}`,
    postal: (z) => z,
  },
  PL: {
    name: 'Poland', locale: 'pl-PL', tz: ['Europe/Warsaw'], dial: '+48', regionLabel: 'voivodeship',
    first: ['Jakub', 'Zuzanna', 'Antoni', 'Lena', 'Jan', 'Maja', 'Szymon', 'Hanna'],
    last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński'],
    cities: [
      { city: 'Warszawa', region: 'Mazowieckie', zips: ['00-001', '00-950'] },
      { city: 'Kraków', region: 'Małopolskie', zips: ['30-001', '31-001'] },
    ],
    streets: ['ul. Główna', 'ul. Kwiatowa', 'al. Jerozolimskie'],
    phone: (r, fictional = true) => `+48 ${digits(r, 3)} ${digits(r, 3)} ${digits(r, 3)}`,
    postal: (z) => z,
  },
  ID: {
    name: 'Indonesia', locale: 'id-ID', tz: ['Asia/Jakarta'], dial: '+62', regionLabel: 'province',
    first: ['Budi', 'Siti', 'Agus', 'Dewi', 'Rizky', 'Putri', 'Andi', 'Ayu'],
    last: ['Santoso', 'Wijaya', 'Hidayat', 'Nugroho', 'Lestari', 'Pratama'],
    cities: [
      { city: 'Jakarta', region: 'DKI Jakarta', zips: ['10110', '12190'] },
      { city: 'Bandung', region: 'Jawa Barat', zips: ['40111', '40115'] },
    ],
    streets: ['Jl. Merdeka', 'Jl. Sudirman', 'Jl. Melati'],
    phone: (r, fictional = true) => `+62 8${digits(r, 2)} ${digits(r, 4)} ${digits(r, 4)}`,
    postal: (z) => z,
  },
};

const EMAIL_PROVIDERS = ['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com'];
// RFC 2606 reserved: safe for tests, never delivers to a real person
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net'];

/** Disposable/throwaway domains risk engines penalise. */
export const DISPOSABLE_EMAIL_DOMAINS = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com'];

/* ─────────────────────────────── generation ─────────────────────────────── */

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** Build one identity where every field is consistent with the others. */
export function generateIdentity(opts = {}) {
  const {
    country = 'US', seed, emailDomain, password, minAge = 22, maxAge = 48,
    realistic = false, emailStyle = 'name', org,
  } = opts;
  const r = rngFrom(seed ?? Math.floor(Math.random() * 1e9));
  const c = COUNTRIES[String(country).toUpperCase()];
  if (!c) throw new Error(`unknown country "${country}" — have: ${Object.keys(COUNTRIES).join(', ')}`);
  const cc = String(country).toUpperCase();

  const firstName = pick(r, c.first);
  const lastName = pick(r, c.last);
  const fullName = `${firstName} ${lastName}`;
  const place = pick(r, c.cities);
  const zip = pick(r, place.zips);

  const n = int(r, 1, 99);
  const styles = {
    name: `${slug(firstName)}.${slug(lastName)}`,
    nameNum: `${slug(firstName)}.${slug(lastName)}${n}`,
    initial: `${slug(firstName)[0]}${slug(lastName)}`,
    flanked: `${slug(firstName)}${n}${slug(lastName)[0]}`,
  };
  const emailLocal = (styles[emailStyle] || styles.name) + (r() < 0.3 ? n : '');
  const domain = emailDomain || (realistic ? pick(r, EMAIL_PROVIDERS) : pick(r, RESERVED_DOMAINS));

  const age = int(r, minAge, maxAge);
  const dob = new Date(Date.UTC(new Date().getUTCFullYear() - age, int(r, 0, 11), int(r, 1, 28)));
  const pw = password || `${pick(r, ['Cedar', 'Harbor', 'Falcon', 'Granite', 'Maple', 'Copper'])}${pick(r, ['Sunset', 'River', 'Meadow', 'Ridge', 'Stone'])}${digits(r, 3)}!`;

  const id = {
    id: `${cc}-${digits(r, 6)}`,
    seed: seed ?? null,
    country: cc,
    countryName: c.name,
    locale: c.locale,
    timezone: pick(r, c.tz),
    languages: [c.locale, c.locale.split('-')[0]],
    firstName, lastName, fullName,
    username: styles.nameNum,
    email: `${emailLocal}@${domain}`,
    emailLocal, emailDomain: domain,
    phone: c.phone(r, !realistic),
    phoneCountry: cc,
    address: {
      line1: `${int(r, 12, 9800)} ${pick(r, c.streets)}`,
      city: place.city,
      region: place.region,
      postalCode: c.postal(zip),
      country: c.name,
      countryCode: cc,
    },
    dob: dob.toISOString().slice(0, 10),
    age,
    password: pw,
    ...(org ? { org } : {}),
    device: deviceFor(r, realistic),
  };
  id.coherence = checkIdentity(id);
  return id;
}

function deviceFor(r, realistic) {
  const profiles = ['chrome-windows', 'chrome-mac', 'chrome-linux'];
  const profile = pick(r, profiles);
  const viewports = { 'chrome-windows': [1920, 1080], 'chrome-mac': [1512, 982], 'chrome-linux': [1366, 768] };
  const [width, height] = viewports[profile];
  return { profile, width, height, dsf: r() < 0.35 ? 2 : 1, seed: int(r, 1, 99999) };
}

/* ─────────────────────────────── validation ─────────────────────────────── */

/** Cross-field contradictions a risk engine would notice. */
export function checkIdentity(id) {
  const issues = [];
  const c = COUNTRIES[id.country];
  if (!c) return { ok: false, issues: [{ field: 'country', why: 'unknown country' }] };
  const a = id.address || {};

  // phone ↔ address country
  const dial = (id.phone || '').trim().startsWith(c.dial);
  if (!dial) issues.push({ field: 'phone', why: `phone ${id.phone} is not a ${id.country} number (expected ${c.dial})` });

  // postal format ↔ country
  const postalOk = /^[0-9A-Za-z][0-9A-Za-z\s-]{2,9}$/.test(a.postalCode || '');
  if (!postalOk) issues.push({ field: 'postalCode', why: `"${a.postalCode}" is not a plausible postal code for ${id.country}` });
  const city = c.cities.find((x) => x.city === a.city);
  if (city && !city.zips.includes(a.postalCode)) issues.push({ field: 'postalCode', why: `${a.postalCode} is not in ${a.city}` });
  if (city && city.region !== a.region) issues.push({ field: 'region', why: `${a.region} is not the region of ${a.city}` });

  // locale/timezone ↔ country
  if (!c.tz.includes(id.timezone)) issues.push({ field: 'timezone', why: `${id.timezone} is not in ${id.country}` });
  if ((id.locale || '').split('-')[1] !== id.country && id.country !== 'GB') {
    if (id.locale !== 'en-IN' && id.locale !== 'en-GB') issues.push({ field: 'locale', why: `${id.locale} is not the locale of ${id.country}` });
  }

  // email ↔ name (weak-signal check: an obviously unrelated local-part is a flag)
  const local = (id.emailLocal || '').toLowerCase();
  const nameBits = [slug(id.firstName), slug(id.lastName), slug(id.lastName).slice(0, 4)];
  if (local && !nameBits.some((b) => b && local.includes(b))) issues.push({ field: 'email', why: `local part "${local}" has no relation to the name "${id.fullName}"` });
  if (DISPOSABLE_EMAIL_DOMAINS.includes((id.emailDomain || '').toLowerCase())) issues.push({ field: 'email', why: `${id.emailDomain} is a known disposable domain` });

  // age plausibility
  if (!id.age || id.age < 18 || id.age > 100) issues.push({ field: 'dob', why: `age ${id.age} is not plausible` });
  const y = Number(String(id.dob || '').slice(0, 4));
  if (y && new Date().getUTCFullYear() - y !== id.age) issues.push({ field: 'dob', why: 'dob and age disagree' });

  // address completeness
  if (!a.line1 || !a.city || !a.postalCode) issues.push({ field: 'address', why: 'incomplete address' });

  return { ok: issues.length === 0, issues };
}

/** The stealth/emulation settings that make a browser match this identity. */
export function identityStealth(id, extra = {}) {
  return {
    profile: id.device?.profile || 'chrome-linux',
    locale: id.locale,
    timezone: id.timezone,
    languages: id.languages,
    seed: id.device?.seed,
    ...extra,
  };
}

/** What the identity expects of its network exit (for proxy selection/verification). */
export function identityGeo(id) {
  return { country: id.country, locale: id.locale, timezone: id.timezone, languages: id.languages };
}

/** A batch of distinct identities (distinct device seeds + names), for farm testing. */
export function generateIdentities(count, opts = {}) {
  const out = [];
  const seen = new Set();
  const profiles = ['chrome-windows', 'chrome-mac', 'chrome-linux'];
  for (let i = 0; i < count; i++) {
    let id;
    let guard = 0;
    do {
      id = generateIdentity({ ...opts, seed: (opts.seed ?? 1) + i * 7919 + guard++ });
      // make each account look like a different machine: rotate the platform profile
      // (a batch of accounts all claiming the same platform is its own signal)
      if (opts.profile === undefined && opts.spreadDevices !== false) {
        const p = profiles[i % profiles.length];
        const viewports = { 'chrome-windows': [1920, 1080], 'chrome-mac': [1512, 982], 'chrome-linux': [1366, 768] };
        id.device = { ...id.device, profile: p, width: viewports[p][0], height: viewports[p][1], seed: (opts.seed ?? 1) + i * 104729 };
      }
    } while (seen.has(id.email) && guard < 50);
    seen.add(id.email);
    out.push(id);
  }
  return out;
}
