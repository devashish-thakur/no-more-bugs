// Feature files: .nomorebugs/features/<slug>.md
//
//   ---
//   feature: checkout-coupons
//   prefix: CHK
//   plan: draft            # draft | approved
//   covers: [src/checkout/coupons.ts, src/checkout/rules/**]
//   ---
//   # Checkout coupons
//
//   ## CHK-004 · Expired coupon is rejected
//   type: api · priority: high
//   Given ...
//
// Frontmatter is a small, strict subset of YAML: `key: value`, inline lists `[a, b]` and
// block lists (`- item`). Test status is never stored here; it comes from the history.
import fs from 'node:fs';
import path from 'node:path';
import { nmbPaths, readText, ensureDir, toPosix } from './util.mjs';
import { ID_RE, formatId, parseId, isRiskyPrefix, suggestPrefix } from './ids.mjs';

export const TYPES = ['unit', 'integration', 'api', 'ui', 'e2e'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const KINDS = ['behavior', 'regression', 'characterization'];
export const PLANS = ['draft', 'approved'];

const HEADING_RE = /^##\s+([A-Za-z][A-Za-z0-9]{1,9}-\d{3,})\s*(?:[·•:|\-–—]\s*)?(.*)$/;
const META_KEYS = new Set(['type', 'priority', 'kind', 'test', 'tests']);

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text, bodyStart: 0, errors: [] };
  const data = {};
  const errors = [];
  let end = -1;
  let listKey = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') {
      end = i;
      break;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) || (listKey ? /^-\s+(.*)$/.exec(line) : null);
    if (item && listKey) {
      data[listKey].push(unquote(stripComment(item[1])));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      errors.push(`frontmatter line ${i + 1} isn't "key: value": ${line.trim()}`);
      continue;
    }
    const value = stripComment(kv[2]).trim();
    listKey = null;
    if (value === '') {
      data[kv[1]] = [];
      listKey = kv[1];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[kv[1]] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      data[kv[1]] = unquote(value);
    }
  }
  if (end === -1) {
    errors.push('frontmatter has no closing ---');
    return { data, body: '', bodyStart: lines.length, errors };
  }
  return { data, body: lines.slice(end + 1).join('\n'), bodyStart: end + 1, errors };
}

function stripComment(value) {
  // A # starts a comment only when preceded by whitespace and not inside quotes.
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value;
}

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

export function parseFeature(text, file = 'feature.md') {
  const { data, body, bodyStart, errors } = parseFrontmatter(text);
  const slug = path.basename(file, path.extname(file));
  const feature = {
    file: toPosix(file),
    slug,
    name: String(data.feature || slug),
    prefix: data.prefix ? String(data.prefix).toUpperCase() : null,
    plan: data.plan ? String(data.plan).toLowerCase() : 'draft',
    covers: Array.isArray(data.covers) ? data.covers : data.covers ? [String(data.covers)] : [],
    title: null,
    scenarios: [],
    errors: [...errors],
    warnings: [],
  };
  if (!feature.prefix) feature.errors.push('frontmatter is missing "prefix"');
  else if (!/^[A-Z][A-Z0-9]{1,9}$/.test(feature.prefix)) feature.errors.push(`prefix "${feature.prefix}" must be 2-10 letters or digits, starting with a letter`);
  else if (isRiskyPrefix(feature.prefix)) feature.warnings.push(`prefix "${feature.prefix}" is a common word and may match ordinary test names`);
  if (!PLANS.includes(feature.plan)) feature.errors.push(`plan must be one of ${PLANS.join(', ')}, not "${feature.plan}"`);

  // Blank out HTML comments (keeping line numbers) so commented-out examples aren't parsed.
  const lines = body
    .replace(/<!--[\s\S]*?(-->|$)/g, (c) => c.replace(/[^\n]/g, ''))
    .split(/\r?\n/);
  let current = null;
  let inMeta = false;
  lines.forEach((line, idx) => {
    const lineNo = bodyStart + idx + 1;
    if (!feature.title) {
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) {
        feature.title = h1[1].trim();
        return;
      }
    }
    if (/^##\s/.test(line)) {
      const m = HEADING_RE.exec(line);
      if (!m) {
        // A non-scenario section (notes, out of scope) ends the current scenario.
        current = null;
        return;
      }
      const id = m[1].toUpperCase();
      const parsed = parseId(id);
      current = {
        id: parsed ? formatId(parsed.prefix, parsed.number) : id,
        title: m[2].trim() || '(untitled)',
        type: null,
        priority: 'medium',
        kind: 'behavior',
        line: lineNo,
        body: [],
      };
      feature.scenarios.push(current);
      inMeta = true;
      return;
    }
    if (!current) return;
    if (inMeta && line.trim()) {
      const parts = line.split(/\s*[·|;]\s*/);
      const pairs = parts.map((p) => /^([A-Za-z]+)\s*:\s*(.+)$/.exec(p.trim()));
      if (pairs.every((p) => p && META_KEYS.has(p[1].toLowerCase()))) {
        for (const [, k, v] of pairs) {
          const key = k.toLowerCase();
          if (key === 'type' || key === 'priority' || key === 'kind') current[key] = v.trim().toLowerCase();
          else current.tests = v.trim();
        }
        return;
      }
      inMeta = false;
    } else if (!line.trim()) {
      if (current.body.length) inMeta = false;
      return;
    }
    current.body.push(line);
  });

  const seen = new Set();
  for (const s of feature.scenarios) {
    s.body = s.body.join('\n').trim();
    const where = `${s.id} (line ${s.line})`;
    if (seen.has(s.id)) feature.errors.push(`${where} is declared twice`);
    seen.add(s.id);
    if (feature.prefix && parseId(s.id)?.prefix !== feature.prefix) feature.errors.push(`${where} doesn't use the feature prefix ${feature.prefix}`);
    if (!s.type) feature.errors.push(`${where} has no type (one of ${TYPES.join(', ')})`);
    else if (!TYPES.includes(s.type)) feature.errors.push(`${where} has type "${s.type}"; use one of ${TYPES.join(', ')}`);
    if (!PRIORITIES.includes(s.priority)) feature.errors.push(`${where} has priority "${s.priority}"; use one of ${PRIORITIES.join(', ')}`);
    if (!KINDS.includes(s.kind)) feature.errors.push(`${where} has kind "${s.kind}"; use one of ${KINDS.join(', ')}`);
    if (!s.body) feature.warnings.push(`${where} has no Given/When/Then description`);
  }
  return feature;
}

export function loadFeatures(root) {
  const dir = nmbPaths(root).features;
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return files.map((f) => parseFeature(readText(path.join(dir, f), ''), `.nomorebugs/features/${f}`));
}

// Problems that span feature files: duplicate prefixes and duplicate IDs.
export function crossFeatureErrors(features) {
  const errors = [];
  const prefixes = new Map();
  const ids = new Map();
  for (const f of features) {
    if (f.prefix) {
      if (prefixes.has(f.prefix)) errors.push({ target: f.prefix, message: `prefix ${f.prefix} is used by both ${prefixes.get(f.prefix)} and ${f.file}` });
      else prefixes.set(f.prefix, f.file);
    }
    for (const s of f.scenarios) {
      if (ids.has(s.id) && ids.get(s.id) !== f.file) errors.push({ target: s.id, message: `${s.id} is declared in both ${ids.get(s.id)} and ${f.file}` });
      else ids.set(s.id, f.file);
    }
  }
  return errors;
}

export function nextIds(features, prefix, count = 1) {
  const p = prefix.toUpperCase();
  let max = 0;
  for (const f of features) {
    for (const s of f.scenarios) {
      const parsed = parseId(s.id);
      if (parsed && parsed.prefix === p) max = Math.max(max, parsed.number);
    }
  }
  return Array.from({ length: count }, (_, i) => formatId(p, max + i + 1));
}

export function slugify(name) {
  return String(name)
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function createFeatureFile(root, { name, prefix, covers = [], title }) {
  const slug = slugify(name);
  if (!slug) throw new Error('Give the feature a name, for example: nmb new checkout-coupons');
  const features = loadFeatures(root);
  if (features.some((f) => f.slug === slug)) throw new Error(`.nomorebugs/features/${slug}.md already exists`);
  const taken = new Set(features.map((f) => f.prefix).filter(Boolean));
  const p = (prefix || suggestPrefix(slug, taken)).toUpperCase();
  if (taken.has(p)) throw new Error(`prefix ${p} is already used by another feature`);
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(p)) throw new Error(`prefix "${p}" must be 2-10 letters or digits, starting with a letter`);
  const heading = title || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const coverLine = covers.length ? `[${covers.join(', ')}]` : '[]';
  const text = `---
feature: ${slug}
prefix: ${p}
plan: draft
covers: ${coverLine}
---
# ${heading}

<!-- One section per scenario. Get the next free IDs with: nmb id ${p} --count 3

## ${p}-001 · Short description of the behavior
type: unit · priority: medium
Given ...
When  ...
Then  ...
-->
`;
  const dir = nmbPaths(root).features;
  ensureDir(dir);
  const file = path.join(dir, `${slug}.md`);
  fs.writeFileSync(file, text);
  return { file: `.nomorebugs/features/${slug}.md`, slug, prefix: p };
}

// Set the plan field in a feature file's frontmatter, keeping everything else untouched.
export function setPlan(root, slug, plan) {
  const file = path.join(nmbPaths(root).features, `${slug.replace(/\.md$/, '')}.md`);
  const text = readText(file);
  if (text == null) throw new Error(`No feature file .nomorebugs/features/${slug}.md`);
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') throw new Error(`${slug}.md has no frontmatter`);
  const end = lines.indexOf('---', 1);
  const close = end === -1 ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : end;
  if (close === -1) throw new Error(`${slug}.md frontmatter has no closing ---`);
  const idx = lines.findIndex((l, i) => i > 0 && i < close && /^plan\s*:/.test(l));
  if (idx === -1) lines.splice(close, 0, `plan: ${plan}`);
  else lines[idx] = `plan: ${plan}`;
  fs.writeFileSync(file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
}

export { ID_RE };
