// Small shared helpers. No dependencies beyond Node's standard library.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const NMB_DIR = '.nomorebugs';

export function nmbPaths(root) {
  const base = path.join(root, NMB_DIR);
  const local = path.join(base, 'local');
  return {
    root,
    base,
    config: path.join(base, 'config.json'),
    features: path.join(base, 'features'),
    reviews: path.join(base, 'reviews'),
    waivers: path.join(base, 'waivers.jsonl'),
    proofs: path.join(base, 'proofs.jsonl'),
    local,
    runs: path.join(local, 'history', 'runs.jsonl'),
    index: path.join(local, 'history', 'index.json'),
    reports: path.join(local, 'reports'),
    requests: path.join(local, 'requests.json'),
    sessions: path.join(local, 'sessions'),
    dashboard: path.join(local, 'dashboard.json'),
  };
}

// Walk up from `start` to the nearest folder containing .nomorebugs/ (or a .git/ folder as a fallback).
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  let gitRoot = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, NMB_DIR, 'config.json'))) return dir;
    if (!gitRoot && fs.existsSync(path.join(dir, '.git'))) gitRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) return gitRoot || path.resolve(start);
    dir = parent;
  }
}

export function isInitialized(root) {
  return fs.existsSync(nmbPaths(root).config);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file, fallback = null) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function readJson(file, fallback = null) {
  const text = readText(file);
  if (text == null) return fallback;
  try {
    return JSON.parse(stripBom(text));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// JSON Lines files are merged with git's union driver, so a merge can leave conflict markers
// or duplicate lines. Both are tolerated: markers are skipped, duplicates are the caller's job.
export function readJsonl(file) {
  const text = readText(file);
  if (!text) return [];
  const out = [];
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(<<<<<<<|=======|>>>>>>>)/.test(line)) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn or hand-mangled line shouldn't take the whole file down.
    }
  }
  return out;
}

export function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Hash file content with line endings normalized, so a checkout on Windows and one on Linux agree.
export function hashFile(file) {
  const text = readText(file);
  if (text == null) return null;
  return sha256(text.replace(/\r\n/g, '\n'));
}

export function toPosix(p) {
  return p.split(path.sep).join('/').replace(/\\/g, '/');
}

export function relPath(root, file) {
  return toPosix(path.relative(root, path.resolve(root, file)));
}

// Quote a waiver target for a command line when it contains spaces.
export function shellTarget(target) {
  return /\s|"/.test(target) ? `"${String(target).replace(/"/g, '\\"')}"` : target;
}

export function nowIso() {
  return new Date().toISOString();
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export function truncate(text, max = 300) {
  if (!text) return text;
  const clean = String(text).trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
