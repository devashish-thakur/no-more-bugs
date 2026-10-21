// Scenario IDs look like CHK-004. In test names they may appear as CHK-004, chk_004, chk004 or
// CHK004, because many languages don't allow hyphens in function names. Only prefixes declared in
// feature files are recognized, so ordinary test names aren't mistaken for IDs.

export const ID_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{3,})$/;

export function formatId(prefix, number) {
  return `${prefix.toUpperCase()}-${String(Number(number)).padStart(3, '0')}`;
}

export function parseId(id) {
  const m = ID_RE.exec(String(id).trim().toUpperCase());
  return m ? { prefix: m[1], number: Number(m[2]) } : null;
}

const reCache = new Map();

function prefixRegex(prefixes) {
  const key = [...prefixes].sort().join('|');
  if (!reCache.has(key)) {
    const alts = [...prefixes]
      .sort((a, b) => b.length - a.length)
      .map((p) => p.replace(/[^A-Za-z0-9]/g, ''))
      .filter(Boolean)
      .join('|');
    reCache.set(key, alts ? new RegExp(`(${alts})[-_ ]?(\\d{3,})(?!\\d)`, 'gi') : null);
  }
  return reCache.get(key);
}

// Returns the normalized IDs mentioned in `text`, in order, without duplicates.
export function extractIds(text, prefixes) {
  if (!text || !prefixes || prefixes.size === 0) return [];
  const re = prefixRegex(prefixes);
  if (!re) return [];
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    const prev = start > 0 ? text[start - 1] : '';
    const first = m[1][0];
    // Accept a boundary (start, punctuation, space, underscore) or a camelCase hump: testChk004.
    const boundary = !prev || !/[A-Za-z0-9]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(first));
    if (!boundary) continue;
    const id = formatId(m[1], m[2]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Prefixes that are likely to collide with ordinary words in test names.
const RISKY = new Set(['API', 'GET', 'PUT', 'POST', 'HTTP', 'UTF', 'ISO', 'TEST', 'ID', 'UI', 'DB', 'V', 'IT', 'SQL', 'URL', 'JSON', 'XML', 'TS', 'JS']);

export function isRiskyPrefix(prefix) {
  return RISKY.has(String(prefix).toUpperCase());
}

// Suggest a prefix from a feature name: "checkout-coupons" -> "CHC", falling back to more letters.
export function suggestPrefix(name, taken = new Set()) {
  const words = String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());
  const candidates = [];
  if (words.length === 1) {
    const w = words[0].replace(/[AEIOU]/g, (c, i) => (i === 0 ? c : ''));
    candidates.push(w.slice(0, 3), words[0].slice(0, 3), words[0].slice(0, 4));
  } else {
    candidates.push(words[0].slice(0, 2) + words[1][0], words.map((w) => w[0]).join('').slice(0, 4), words[0].slice(0, 3), words[0].slice(0, 2) + words[1].slice(0, 2));
  }
  for (const c of candidates) {
    const p = c.replace(/^[0-9]+/, '');
    if (p.length >= 2 && !taken.has(p) && !isRiskyPrefix(p)) return p;
  }
  for (let n = 2; n < 100; n++) {
    const p = `${(candidates[0] || 'F').slice(0, 3)}${n}`;
    if (!taken.has(p)) return p;
  }
  return 'FEAT';
}
