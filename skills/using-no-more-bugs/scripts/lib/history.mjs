// Run history (local, gitignored) and proofs (committed).
//
//   .nomorebugs/local/history/runs.jsonl   one record per `nmb run` (rotated)
//   .nomorebugs/local/history/index.json   per-test aggregates that survive rotation
//   .nomorebugs/proofs.jsonl               first failing result of each scenario ID (committed,
//                                          merged with git's union driver)
import fs from 'node:fs';
import { nmbPaths, readJson, writeJson, readJsonl, appendJsonl, nowIso, truncate } from './util.mjs';

const RECENT = 30;
const STATUS_CHAR = { passed: 'p', failed: 'f', error: 'e', skipped: 's' };

export function testKey(t) {
  const where = t.file || t.suite || '';
  return where ? `${where}::${t.name}` : t.name;
}

export function loadRuns(root, { limit = Infinity } = {}) {
  const runs = readJsonl(nmbPaths(root).runs);
  return limit === Infinity ? runs : runs.slice(-limit);
}

export function loadIndex(root) {
  return readJson(nmbPaths(root).index, null) || { version: 1, tests: {}, runs: 0 };
}

export function loadProofs(root) {
  const byId = new Map();
  for (const p of readJsonl(nmbPaths(root).proofs)) {
    if (!p || !p.id) continue;
    const prev = byId.get(p.id);
    if (!prev || String(p.at) < String(prev.at)) byId.set(p.id, p);
  }
  return byId;
}

// Record a run: append it, update the index, and write proofs for IDs seen failing for the first time.
export function recordRun(root, run, { historyLimit = 500 } = {}) {
  const paths = nmbPaths(root);
  appendJsonl(paths.runs, run);
  rotate(paths.runs, historyLimit);

  const index = loadIndex(root);
  index.runs = (index.runs || 0) + 1;
  index.lastRun = { id: run.id, time: run.time, suite: run.suite };
  for (const t of run.tests) {
    const e = (index.tests[t.key] ||= {
      key: t.key,
      firstSeen: run.time,
      passes: 0,
      fails: 0,
      skips: 0,
      recent: '',
      fp: {},
    });
    Object.assign(e, { ids: t.ids || [], suite: t.suite, name: t.name, file: t.file || null, suiteName: run.suite });
    e.lastSeen = run.time;
    e.lastStatus = t.status;
    e.lastRunId = run.id;
    e.lastMessage = t.message || null;
    e.recent = (e.recent + STATUS_CHAR[t.status]).slice(-RECENT);
    if (t.status === 'passed') {
      e.passes++;
      e.everPassed = true;
      e.firstPassed ||= run.time;
    } else if (t.status === 'failed' || t.status === 'error') {
      e.fails++;
      e.firstFailed ||= run.time;
    } else e.skips++;
    if (run.fingerprint && (t.status === 'passed' || t.status === 'failed' || t.status === 'error')) {
      const mark = t.status === 'passed' ? 'p' : 'f';
      const prev = e.fp[run.fingerprint] || '';
      if (!prev.includes(mark)) e.fp[run.fingerprint] = [...new Set((prev + mark).split(''))].sort().join('');
      const keys = Object.keys(e.fp);
      if (keys.length > RECENT) for (const k of keys.slice(0, keys.length - RECENT)) delete e.fp[k];
      if (e.fp[run.fingerprint] === 'fp') {
        e.flaky = true;
        e.flakySince ||= run.time;
      }
    }
  }
  writeJson(paths.index, index);

  const proofs = loadProofs(root);
  const added = [];
  for (const t of run.tests) {
    if (t.status !== 'failed' && t.status !== 'error') continue;
    for (const id of t.ids || []) {
      if (proofs.has(id) || added.some((a) => a.id === id)) continue;
      const proof = {
        id,
        at: run.time,
        test: t.key,
        status: t.status,
        message: truncate(t.message || '(no failure message)', 500),
        commit: run.commit || null,
        actor: run.actor,
      };
      appendJsonl(paths.proofs, proof);
      added.push(proof);
    }
  }
  return { proofsAdded: added };
}

function rotate(file, limit) {
  let text;
  try {
    const st = fs.statSync(file);
    if (st.size < 2 * 1024 * 1024) {
      // Cheap path: only count lines when the file is reasonably small.
      text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n').filter(Boolean);
      if (lines.length <= limit) return;
      fs.writeFileSync(file, lines.slice(-limit).join('\n') + '\n');
      return;
    }
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length > limit) fs.writeFileSync(file, lines.slice(-limit).join('\n') + '\n');
}

export function newRunId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export { nowIso };
