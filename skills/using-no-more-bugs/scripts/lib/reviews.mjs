// Independent reviews: .nomorebugs/reviews/<feature>.json (committed).
// A review records which scenarios it covered and a hash of every test file it read, so the
// check can tell when tests changed after the review.
import fs from 'node:fs';
import path from 'node:path';
import { nmbPaths, readJson, writeJson, hashFile, nowIso, toPosix } from './util.mjs';

export function loadReviews(root) {
  const dir = nmbPaths(root).reviews;
  const out = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const r = readJson(path.join(dir, f));
      if (r && r.feature) out.set(r.feature, r);
    } catch {
      // A broken review file reads as "no review", which the check reports.
    }
  }
  return out;
}

export function recordReview(root, { feature, verdict, scenarios, files, notes, findings, reviewer }) {
  if (!['pass', 'fail'].includes(verdict)) throw new Error('--verdict must be pass or fail');
  const hashes = {};
  for (const f of files) {
    const rel = toPosix(f).replace(/^\.\//, '');
    const h = hashFile(path.join(root, rel));
    if (!h) throw new Error(`Can't read ${rel}; list the test files the review actually read.`);
    hashes[rel] = h;
  }
  const review = {
    feature,
    verdict,
    at: nowIso(),
    reviewer: reviewer || 'subagent',
    scenarios: [...new Set(scenarios)].sort(),
    files: hashes,
    notes: notes || '',
    findings: findings || [],
  };
  writeJson(path.join(nmbPaths(root).reviews, `${feature}.json`), review);
  return review;
}

// Which reviewed files have changed since the review was recorded.
export function changedSinceReview(root, review) {
  const changed = [];
  for (const [file, hash] of Object.entries(review.files || {})) {
    if (hashFile(path.join(root, file)) !== hash) changed.push(file);
  }
  return changed;
}
