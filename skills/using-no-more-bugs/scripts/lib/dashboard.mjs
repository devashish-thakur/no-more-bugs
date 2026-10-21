// The local dashboard: a read-only HTTP server over the files in .nomorebugs/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nmbPaths, readJson, writeJson, readText } from './util.mjs';
import { runCheck } from './check.mjs';
import { loadRuns } from './history.mjs';
import { clearGitCache } from './git.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(here, '..', 'dashboard', 'index.html');
const CLI = path.resolve(here, '..', 'nmb.mjs');

// A cheap token that changes whenever anything the dashboard shows changes.
function version(root) {
  const p = nmbPaths(root);
  const parts = [];
  const stat = (f) => {
    try {
      const s = fs.statSync(f);
      parts.push(`${s.size}:${Math.round(s.mtimeMs)}`);
    } catch {
      parts.push('-');
    }
  };
  [p.runs, p.index, p.proofs, p.waivers, p.requests, p.config].forEach(stat);
  for (const dir of [p.features, p.reviews]) {
    try {
      for (const f of fs.readdirSync(dir).sort()) stat(path.join(dir, f));
    } catch {
      parts.push('-');
    }
  }
  return parts.join('|');
}

export function dashboardState(root) {
  clearGitCache(); // the server is long-lived; HEAD and the base can move between requests
  const result = runCheck(root, { nmb: 'nmb' });
  const { state } = result;
  const runs = state.runs.slice(-300);
  const tests = [...state.current.values()].map((t) => {
    const e = state.index.tests[t.key] || {};
    return {
      key: t.key,
      name: t.name,
      file: t.file || null,
      suite: t.suiteName,
      ids: t.ids,
      status: t.status,
      message: t.message || null,
      durationMs: t.durationMs ?? null,
      recent: e.recent || '',
      flaky: !!e.flaky,
      everPassed: !!e.everPassed,
      firstSeen: e.firstSeen || null,
      firstFailed: e.firstFailed || null,
      passes: e.passes || 0,
      fails: e.fails || 0,
    };
  });
  return {
    project: path.basename(root),
    root,
    generatedAt: new Date().toISOString(),
    check: {
      ok: result.ok,
      base: result.base,
      changed: result.changed.length,
      findings: result.findings.map((f) => ({ rule: f.rule, severity: f.severity, target: f.target, message: f.message, fix: f.fix, waived: !!f.waiver, requested: !!f.request })),
    },
    suites: state.config.suites.map((s) => {
      const last = state.latestAny.get(s.name);
      return { name: s.name, stack: s.stack || null, lastRun: last ? summarizeRun(last) : null };
    }),
    features: state.features.map((f) => ({
      slug: f.slug,
      name: f.name,
      title: f.title,
      prefix: f.prefix,
      plan: f.plan,
      covers: f.covers,
      errors: f.errors,
      review: state.reviews.get(f.slug) ? { verdict: state.reviews.get(f.slug).verdict, at: state.reviews.get(f.slug).at, notes: state.reviews.get(f.slug).notes } : null,
    })),
    scenarios: state.scenarios,
    tests,
    runs: runs.map(summarizeRun),
    waivers: state.waivers,
    requests: state.requests,
  };
}

function summarizeRun(r) {
  return { id: r.id, time: r.time, suite: r.suite, actor: r.actor, partial: !!r.partial, exitCode: r.exitCode, durationMs: r.durationMs, commit: r.commit, branch: r.branch, dirty: r.dirty, totals: r.totals, error: r.error || null };
}

// Every recorded result of one test, oldest first. Matches by key, or by scenario ID (which
// follows a test across renames).
export function testHistory(root, { key, id }) {
  const out = [];
  for (const run of loadRuns(root)) {
    for (const t of run.tests) {
      if ((key && t.key === key) || (id && (t.ids || []).includes(id))) {
        out.push({ runId: run.id, time: run.time, suite: run.suite, actor: run.actor, commit: run.commit, key: t.key, name: t.name, status: t.status, durationMs: t.durationMs ?? null, message: t.message || null });
      }
    }
  }
  return out;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createServer(root) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method !== 'GET') return send(res, 405, { error: 'read-only' });
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readText(PAGE, '<p>dashboard page missing</p>'), 'text/html; charset=utf-8');
      if (url.pathname === '/api/version') return send(res, 200, { version: version(root) });
      if (url.pathname === '/api/state') return send(res, 200, dashboardState(root));
      if (url.pathname === '/api/history') return send(res, 200, testHistory(root, { key: url.searchParams.get('key'), id: url.searchParams.get('id') }));
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });
}

function listen(server, port, tries = 20) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1);
        else reject(err);
      });
      server.listen(p, '127.0.0.1', () => resolve(p));
    };
    attempt(port, tries);
  });
}

export function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    // No browser available; the URL is printed anyway.
  }
}

export async function startDashboard(root, { port = 4477, open = true } = {}) {
  const server = createServer(root);
  const actual = await listen(server, port);
  const url = `http://127.0.0.1:${actual}/`;
  writeJson(nmbPaths(root).dashboard, { pid: process.pid, port: actual, url, started: new Date().toISOString() });
  console.log(`no-more-bugs dashboard: ${url}  (Ctrl+C to stop)`);
  if (open) openBrowser(url);
  const cleanup = () => {
    try {
      const info = readJson(nmbPaths(root).dashboard, null);
      if (info?.pid === process.pid) fs.rmSync(nmbPaths(root).dashboard, { force: true });
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  return { server, url };
}

async function alive(info) {
  if (!info?.url) return false;
  try {
    const res = await fetch(`${info.url}api/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Start the server in the background and return at once, reusing one that's already running.
export async function detachDashboard(root, { port = 4477, open = true } = {}) {
  const file = nmbPaths(root).dashboard;
  const existing = readJson(file, null);
  if (await alive(existing)) {
    console.log(`no-more-bugs dashboard is already running: ${existing.url}`);
    if (open) openBrowser(existing.url);
    return 0;
  }
  const child = spawn(process.execPath, [CLI, 'dashboard', '--no-open', '--port', String(port)], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const info = readJson(file, null);
    if (info && info.pid === child.pid && (await alive(info))) {
      console.log(`no-more-bugs dashboard: ${info.url}  (stop it with: nmb dashboard --stop)`);
      if (open) openBrowser(info.url);
      return 0;
    }
  }
  console.error('The dashboard did not start. Run "nmb dashboard" in the foreground to see why.');
  return 1;
}

export function stopDashboard(root) {
  const file = nmbPaths(root).dashboard;
  const info = readJson(file, null);
  if (!info) {
    console.log('No dashboard is running.');
    return 0;
  }
  try {
    process.kill(info.pid);
    console.log(`Stopped the dashboard (${info.url}).`);
  } catch {
    console.log('The dashboard was not running.');
  }
  fs.rmSync(file, { force: true });
  return 0;
}
