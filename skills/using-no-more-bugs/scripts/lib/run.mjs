// `nmb run`: run a suite's own test command, read the report it writes, and record the run.
// `nmb import`: record a report that something else produced.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, suiteCommand } from './config.mjs';
import { loadFeatures } from './features.mjs';
import { findFiles } from './glob.mjs';
import { parseReport } from './reports.mjs';
import { recordRun, newRunId, testKey } from './history.mjs';
import { declaredPrefixes, idsFor } from './state.mjs';
import { fingerprint, workingTree, headCommit, currentBranch } from './git.mjs';
import { nmbPaths, ensureDir, nowIso, relPath, plural, truncate } from './util.mjs';

export function detectActor(explicit) {
  if (explicit && explicit !== true) return explicit;
  if (process.env.CI) return 'ci';
  if (process.env.CLAUDECODE) return 'agent:claude-code';
  if (process.env.CODEX_SANDBOX || process.env.CODEX_THREAD_ID) return 'agent:codex';
  return 'user';
}

function runShell(command, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env: { ...process.env, ...env }, shell: true, stdio: 'inherit', windowsHide: true });
    child.on('error', (err) => resolve({ code: 127, error: err.message }));
    child.on('exit', (code, signal) => resolve({ code: code ?? (signal ? 130 : 1) }));
  });
}

// Run one suite (or an ad-hoc command) and record the result.
export async function runSuite(root, suite, { actor, extraArgs = [], partial = false, log = console.error } = {}) {
  const config = loadConfig(root);
  ensureDir(nmbPaths(root).reports);
  const command = [suiteCommand(suite), ...extraArgs.map(quoteArg)].join(' ');

  // Our own report files are removed first, so a stale report can't be mistaken for this run's.
  for (const f of findFiles(root, suite.reports).filter((x) => x.startsWith('.nomorebugs/local/'))) {
    fs.rmSync(path.join(root, f), { force: true });
  }

  const fpBefore = fingerprint(root, suite.paths || []);
  const startedAt = Date.now();
  const time = nowIso();
  log(`nmb: running ${suite.name}: ${command}`);
  const result = await runShell(command, { cwd: root, env: suite.env || {} });
  const durationMs = Date.now() - startedAt;

  // Only reports written during this run count.
  const reportFiles = findFiles(root, suite.reports).filter((f) => {
    try {
      return fs.statSync(path.join(root, f)).mtimeMs >= startedAt - 2000;
    } catch {
      return false;
    }
  });
  const after = workingTree(root, suite.paths || []);
  return recordReports(root, suite, reportFiles, {
    time,
    command,
    actor,
    partial,
    exitCode: result.code,
    durationMs,
    // If files changed while the tests ran (e.g. snapshot updates), the run describes neither state.
    fingerprint: fpBefore === after.fingerprint ? after.fingerprint : null,
    dirty: after.dirty,
    startError: result.error,
    historyLimit: config.historyLimit,
  });
}

// Parse report files and record them as one run of `suite`.
export function recordReports(root, suite, reportFiles, meta) {
  const prefixes = declaredPrefixes(loadFeatures(root));
  const tests = [];
  const parseErrors = [];
  for (const f of reportFiles) {
    try {
      for (const t of parseReport(fs.readFileSync(path.resolve(root, f), 'utf8'), suite.format)) {
        const file = t.file ? relPath(root, t.file) : null;
        const test = { ...t, file: file && !file.startsWith('..') ? file : t.file };
        test.key = testKey(test);
        test.ids = idsFor(test, prefixes);
        tests.push(test);
      }
    } catch (err) {
      parseErrors.push(`${f}: ${err.message}`);
    }
  }
  // Two report files can describe the same test (e.g. retries); keep the last result per key.
  const unique = [...new Map(tests.map((t) => [t.key, t])).values()];
  const totals = { passed: 0, failed: 0, error: 0, skipped: 0 };
  for (const t of unique) totals[t.status]++;
  const run = {
    id: newRunId(),
    time: meta.time || nowIso(),
    suite: suite.name,
    command: meta.command,
    actor: detectActor(meta.actor),
    partial: !!meta.partial,
    exitCode: meta.exitCode ?? (totals.failed + totals.error ? 1 : 0),
    durationMs: meta.durationMs ?? unique.reduce((sum, t) => sum + (t.durationMs || 0), 0),
    commit: headCommit(root),
    branch: currentBranch(root),
    dirty: meta.dirty ?? null,
    fingerprint: meta.fingerprint ?? null,
    totals,
    reportFiles,
    tests: unique.map(compact),
  };
  if (meta.imported) run.imported = true;
  if (!reportFiles.length) {
    run.error = meta.startError ? `the command couldn't start: ${meta.startError}` : `no report was written at ${suite.reports.join(', ')}`;
  } else if (!unique.length && parseErrors.length) {
    run.error = `couldn't read the report: ${parseErrors.join('; ')}`;
  }
  const { proofsAdded } = recordRun(root, run, { historyLimit: meta.historyLimit || 500 });
  return { run, proofsAdded, parseErrors };
}

// Record a report produced outside nmb, such as an IDE's test window or a CI artifact.
export function importReport(root, files, { suite, format, actor, full }) {
  const config = loadConfig(root);
  const configured = config.suites.find((s) => s.name === suite);
  const s = configured ? { ...configured, format: format || configured.format } : { name: suite || 'imported', reports: files, format: format || 'auto' };
  const missing = files.filter((f) => !fs.existsSync(path.resolve(root, f)));
  if (missing.length) throw new Error(`No such report: ${missing.join(', ')}`);
  const tree = workingTree(root, s.paths || []);
  return recordReports(root, s, files, {
    command: `import ${files.join(' ')}`,
    actor,
    partial: !full,
    // nmb didn't watch this run, so it only counts as a run of the current code when --full says so.
    fingerprint: full ? tree.fingerprint : null,
    dirty: tree.dirty,
    imported: true,
    historyLimit: config.historyLimit,
  });
}

function compact(t) {
  const out = { key: t.key, suite: t.suite, name: t.name, status: t.status };
  if (t.file) out.file = t.file;
  if (t.ids?.length) out.ids = t.ids;
  if (t.durationMs != null) out.durationMs = t.durationMs;
  if (t.message && t.status !== 'passed') out.message = t.message;
  return out;
}

function quoteArg(a) {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`;
}

export function formatRunSummary({ run, proofsAdded, parseErrors }) {
  const lines = [];
  const t = run.totals;
  if (run.error) {
    lines.push(`nmb: ${run.suite}: ${run.error}. Check the suite's command and "reports" in .nomorebugs/config.json.`);
  } else {
    lines.push(`nmb: ${run.suite}: ${t.passed} passed, ${t.failed + t.error} failed, ${t.skipped} skipped${run.partial ? ' (partial run)' : ''} in ${(run.durationMs / 1000).toFixed(1)}s`);
  }
  for (const b of run.tests.filter((x) => x.status === 'failed' || x.status === 'error').slice(0, 10)) {
    lines.push(`  ✗ ${b.name}${b.message ? `: ${truncate(b.message.split('\n')[0], 140)}` : ''}`);
  }
  for (const p of proofsAdded) lines.push(`  ✓ ${p.id} seen failing; proof recorded`);
  if (!run.fingerprint && !run.error && !run.imported) lines.push('  ! files changed while the tests ran, so this run is not counted as current. Run again.');
  for (const e of parseErrors) lines.push(`  ! ${e}`);
  if (run.tests.length && !run.error) lines.push(`  recorded ${plural(run.tests.length, 'test')} in the history (${run.id})`);
  return lines.join('\n');
}
