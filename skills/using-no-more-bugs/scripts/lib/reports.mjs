// Test report readers. Every reader returns the same shape:
//   { suite, name, file, status: 'passed'|'failed'|'error'|'skipped', durationMs, message }
// Supported: JUnit XML (most runners), NUnit 3 XML (Unity Test Framework, NUnit), TRX (dotnet test),
// and the Dart/Flutter JSON event stream.
import { parseXml, walk, localName, firstChild, textOf } from './xml.mjs';
import { truncate, toPosix } from './util.mjs';

export const FORMATS = ['junit', 'nunit', 'trx', 'dart-json'];

export function detectFormat(content) {
  const head = content.replace(/^﻿/, '').trimStart().slice(0, 4000);
  if (head.startsWith('<')) {
    if (/<test-run[\s>]/.test(head) || /<test-results[\s>]/.test(head)) return 'nunit';
    if (/<TestRun[\s>]/.test(head)) return 'trx';
    if (/<testsuites?[\s>/]/.test(head) || /<testcase[\s>/]/.test(head)) return 'junit';
    return null;
  }
  if (/^\{.*"type"\s*:/.test(head) || /^\[\{.*"event"/.test(head)) return 'dart-json';
  return null;
}

export function parseReport(content, format = null) {
  const fmt = format && format !== 'auto' ? format : detectFormat(content);
  switch (fmt) {
    case 'junit':
      return parseJunit(content);
    case 'nunit':
      return parseNunit(content);
    case 'trx':
      return parseTrx(content);
    case 'dart-json':
      return parseDartJson(content);
    default:
      throw new Error('Unrecognized report format. Expected JUnit XML, NUnit XML, TRX or Dart JSON.');
  }
}

function seconds(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

function cleanFile(file) {
  if (!file) return null;
  let f = String(file);
  if (f.startsWith('file://')) {
    f = decodeURIComponent(f.slice(7));
    if (/^\/[A-Za-z]:/.test(f)) f = f.slice(1); // file:///C:/x on Windows
  }
  return toPosix(f).replace(/^\.\//, '');
}

// ---------- JUnit ----------
export function parseJunit(content) {
  const doc = parseXml(content);
  const out = [];
  for (const [node, parents] of walk(doc)) {
    if (localName(node.name) !== 'testcase') continue;
    const suiteNode = [...parents].reverse().find((p) => localName(p.name) === 'testsuite');
    const a = node.attrs;
    const failure = firstChild(node, 'failure');
    const error = firstChild(node, 'error');
    const skipped = firstChild(node, 'skipped');
    let status = 'passed';
    let message = null;
    if (failure) {
      status = 'failed';
      message = failure.attrs.message || textOf(failure);
    } else if (error) {
      status = 'error';
      message = error.attrs.message || textOf(error);
    } else if (skipped || a.status === 'skipped' || a.skipped === 'true') {
      status = 'skipped';
      message = skipped ? skipped.attrs.message || textOf(skipped) || null : null;
    }
    out.push({
      suite: a.classname || suiteNode?.attrs.name || '',
      name: a.name || '(unnamed)',
      file: cleanFile(a.file || suiteNode?.attrs.file || (looksLikeFile(a.classname) ? a.classname : null)),
      status,
      durationMs: seconds(a.time),
      message: message ? truncate(message, 2000) : null,
    });
  }
  return out;
}

function looksLikeFile(value) {
  return !!value && /[\\/].*\.\w+$|\.\w{1,6}$/.test(value) && /\.(m?[jt]sx?|py|dart|gd|cs|java|kt|go|rb|php|rs|swift)$/.test(value);
}

// ---------- NUnit 3 (Unity Test Framework writes this) ----------
export function parseNunit(content) {
  const doc = parseXml(content);
  const out = [];
  for (const [node, parents] of walk(doc)) {
    if (localName(node.name) !== 'test-case') continue;
    const a = node.attrs;
    const result = (a.result || (a.executed === 'False' ? 'Skipped' : 'Passed')).toLowerCase();
    const label = (a.label || '').toLowerCase();
    let status;
    if (result === 'passed' || result === 'success') status = 'passed';
    else if (result === 'failed' || result === 'failure') status = label === 'error' || label === 'invalid' ? 'error' : 'failed';
    else if (result === 'error') status = 'error';
    else status = 'skipped'; // Skipped, Inconclusive, Ignored, NotRunnable
    const failure = firstChild(node, 'failure');
    const reason = firstChild(node, 'reason');
    const msgNode = firstChild(failure || reason || node, 'message');
    const fixture = [...parents].reverse().find((p) => localName(p.name) === 'test-suite' && /fixture/i.test(p.attrs.type || ''));
    out.push({
      suite: a.classname || fixture?.attrs.fullname || '',
      name: a.name || a.fullname || '(unnamed)',
      file: null,
      status,
      durationMs: seconds(a.duration ?? a.time),
      message: msgNode ? truncate(textOf(msgNode), 2000) : null,
    });
  }
  return out;
}

// ---------- TRX (dotnet test --logger trx) ----------
export function parseTrx(content) {
  const doc = parseXml(content);
  const definitions = new Map();
  for (const [node] of walk(doc)) {
    if (localName(node.name) !== 'UnitTest') continue;
    const method = firstChild(node, 'TestMethod');
    definitions.set(node.attrs.id, { suite: method?.attrs.className || '' });
  }
  const out = [];
  for (const [node] of walk(doc)) {
    if (localName(node.name) !== 'UnitTestResult') continue;
    const a = node.attrs;
    const outcome = (a.outcome || '').toLowerCase();
    const status = outcome === 'passed' ? 'passed' : outcome === 'failed' ? 'failed' : outcome === 'error' || outcome === 'timeout' || outcome === 'aborted' ? 'error' : 'skipped';
    const def = definitions.get(a.testId) || { suite: '' };
    const output = firstChild(node, 'Output');
    const info = output && firstChild(output, 'ErrorInfo');
    const msg = info && firstChild(info, 'Message');
    out.push({
      suite: def.suite,
      name: a.testName || '(unnamed)',
      file: null,
      status,
      durationMs: trxDuration(a.duration),
      message: msg ? truncate(textOf(msg), 2000) : null,
    });
  }
  return out;
}

function trxDuration(value) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value || '');
  if (!m) return null;
  return Math.round(((+m[1] * 60 + +m[2]) * 60 + parseFloat(m[3])) * 1000);
}

// ---------- Dart / Flutter JSON reporter ----------
// `dart test --file-reporter json:<path>` and `flutter test --file-reporter json:<path>`
// write one JSON event per line. Lines that aren't JSON (Flutter sometimes prints them) are ignored.
export function parseDartJson(content) {
  const suites = new Map();
  const tests = new Map();
  const errors = new Map();
  const done = new Map();
  let events = [];
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      events = JSON.parse(trimmed).map((e) => e.params || e);
    } catch {
      events = [];
    }
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l.startsWith('{')) continue;
      try {
        events.push(JSON.parse(l));
      } catch {
        // ignore non-JSON noise
      }
    }
  }
  for (const e of events) {
    if (e.type === 'suite' && e.suite) suites.set(e.suite.id, e.suite);
    else if (e.type === 'testStart' && e.test) tests.set(e.test.id, { ...e.test, startTime: e.time });
    else if (e.type === 'error' && e.testID != null) {
      if (!errors.has(e.testID)) errors.set(e.testID, e);
    } else if (e.type === 'testDone') done.set(e.testID, e);
  }
  const out = [];
  for (const [id, t] of tests) {
    const d = done.get(id);
    if (!d || d.hidden) continue;
    if (/^loading /.test(t.name) && !t.url && !t.root_url) continue;
    const suite = suites.get(t.suiteID);
    const err = errors.get(id);
    let status;
    if (d.skipped) status = 'skipped';
    else if (d.result === 'success') status = 'passed';
    else if (d.result === 'failure') status = 'failed';
    else status = 'error';
    out.push({
      suite: suite?.path ? cleanFile(suite.path) : '',
      name: t.name,
      file: cleanFile(t.root_url || t.url || suite?.path || null),
      status,
      durationMs: d.time != null && t.startTime != null ? d.time - t.startTime : null,
      message: err ? truncate(err.error, 2000) : d.skipped ? t.metadata?.skipReason || null : null,
    });
  }
  return out;
}
