// velox :: bandwidth.js — page bandwidth profiles. Cutting bytes you never read is
// the single biggest win in automation: fewer resources, capped bodies, no third-party
// chatter, and accounting so the saving is measurable instead of a claim.
//
//   newPage({ bandwidth: 'lean' })      // no images / fonts / media
//   newPage({ bandwidth: 'minimal' })   // documents + scripts + xhr only
//   newPage({ bandwidth: 'text-only' }) // documents only — the lowest possible
//   newPage({ bandwidth: { block: ['image', 'media'], maxBytes: 1_000_000, blockThirdParty: true } })

const TYPE_ALIASES = {
  image: ['Image'],
  images: ['Image'],
  img: ['Image'],
  font: ['Font'],
  fonts: ['Font'],
  media: ['Media'],
  video: ['Media'],
  audio: ['Media'],
  stylesheet: ['Stylesheet'],
  css: ['Stylesheet'],
  script: ['Script'],
  js: ['Script'],
  xhr: ['XHR', 'Fetch'],
  fetch: ['XHR', 'Fetch'],
  document: ['Document'],
  html: ['Document'],
  websocket: ['WebSocket'],
  manifest: ['Manifest'],
  other: ['Other'],
  ping: ['Ping'],
  csp: ['CSPViolationReport'],
  preflight: ['Preflight'],
};

function expandTypes(list = []) {
  const out = new Set();
  for (const t of list) {
    const key = String(t).toLowerCase();
    for (const m of (TYPE_ALIASES[key] || [t])) out.add(m);
  }
  return out;
}

export const PRESETS = {
  // measure everything, block nothing
  full: { block: [], maxBytes: 0, blockThirdParty: false },
  // keep the page usable: no images, fonts or media
  lean: { block: ['image', 'font', 'media'], maxBytes: 0, blockThirdParty: false },
  // render + data only: documents, scripts, styles, xhr
  minimal: { block: ['image', 'font', 'media', 'manifest', 'ping', 'csp', 'preflight'], maxBytes: 0, blockThirdParty: false },
  // the document itself and nothing else — ideal for scraping text
  'text-only': { block: ['image', 'font', 'media', 'stylesheet', 'manifest', 'ping', 'csp', 'preflight'], maxBytes: 0, blockThirdParty: true },
};

/**
 * Turn a profile name (or object) into concrete rules.
 * @returns {{ blockTypes:Set<string>, maxBytes:number, blockThirdParty:boolean, name:string }}
 */
export function resolveBandwidth(profile) {
  if (!profile || profile === 'full') return { blockTypes: new Set(), maxBytes: 0, blockThirdParty: false, name: 'full' };
  if (typeof profile === 'string') {
    const preset = PRESETS[profile];
    if (!preset) throw new Error(`unknown bandwidth profile "${profile}" — try: ${Object.keys(PRESETS).join(', ')}`);
    return { blockTypes: expandTypes(preset.block), maxBytes: preset.maxBytes, blockThirdParty: preset.blockThirdParty, name: profile };
  }
  const merged = { ...(profile.preset ? PRESETS[profile.preset] : {}), ...profile };
  return {
    blockTypes: expandTypes(merged.block || []),
    maxBytes: merged.maxBytes || 0,
    blockThirdParty: !!merged.blockThirdParty,
    name: profile.preset || 'custom',
  };
}

/** Host comparison that treats sub.example.com as the same site as example.com. */
export function sameSite(a, b) {
  if (!a || !b) return true;
  const h1 = a.replace(/^\./, '').toLowerCase();
  const h2 = b.replace(/^\./, '').toLowerCase();
  return h1 === h2 || h1.endsWith('.' + h2) || h2.endsWith('.' + h1);
}

/** Human-readable byte count. */
export function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
