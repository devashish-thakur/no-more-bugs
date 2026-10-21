// Claude Code hook handlers. Each reads the hook's JSON from stdin and prints JSON (or nothing).
// They fail open: if anything goes wrong, the hook exits quietly and the agent carries on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, isInitialized, nmbPaths, readJson, writeJson, readText, ensureDir, relPath, plural, shellTarget } from './util.mjs';
import { loadConfig } from './config.mjs';
import { runCheck, formatCheck } from './check.mjs';
import { fingerprint, resolveBase, fileAtBase, isGitRepo } from './git.mjs';
import { matchAny } from './glob.mjs';
import { grantWaiver, loadRequests } from './waivers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = path.resolve(here, '..', 'nmb.mjs');
export const NMB_CMD = `node "${CLI_PATH.replace(/\\/g, '/')}"`;

function rootFrom(input) {
  return findRoot(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function sessionFile(root, id) {
  return path.join(nmbPaths(root).sessions, `${String(id || 'default').replace(/[^\w-]/g, '_')}.json`);
}

function loadSession(root, id) {
  return readJson(sessionFile(root, id), null);
}

function saveSession(root, id, data) {
  ensureDir(nmbPaths(root).sessions);
  writeJson(sessionFile(root, id), { ...data, updated: new Date().toISOString() });
}

function pruneSessions(root) {
  const dir = nmbPaths(root).sessions;
  try {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch {
    // nothing to prune
  }
}

export function routerText() {
  const file = path.resolve(here, '..', '..', 'SKILL.md');
  const text = readText(file, '');
  const body = text.replace(/^---[\s\S]*?\n---\r?\n/, '').trim();
  return body.replace(/\{\{NMB\}\}/g, NMB_CMD);
}

// ---------- SessionStart ----------
export function sessionStart(input) {
  const root = rootFrom(input);
  if (!isInitialized(root)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<NO-MORE-BUGS>\nThe no-more-bugs testing skills are installed but not set up in this project. If the user asks for tests, test tracking or testing guardrails, set it up with: ${NMB_CMD} init\n</NO-MORE-BUGS>`,
      },
    };
  }
  pruneSessions(root);
  saveSession(root, input.session_id, { turnFingerprint: fingerprint(root), blocks: 0 });
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `<NO-MORE-BUGS>\n${routerText()}\n</NO-MORE-BUGS>`,
    },
  };
}

// ---------- UserPromptSubmit ----------
// Records the code state at the start of the turn, and turns "nmb grant <target> [reason]" lines
// typed by the user into granted waivers. The agent can't produce a user prompt, so it can't
// forge these.
const GRANT_RE = /^\s*(?:\/no-more-bugs:grant|nmb\s+grant)\s+(.+?)\s*$/gim;

// Split "<target> [reason]". Targets can contain spaces (test names do), so prefer the longest
// pending request the text starts with, then a quoted target, then the first word.
export function parseGrant(rest, pendingTargets = []) {
  const byLength = [...new Set(pendingTargets)].sort((a, b) => b.length - a.length);
  for (const t of byLength) {
    for (const form of [t, `"${t}"`, `'${t}'`]) {
      if (rest === form || rest.startsWith(`${form} `)) return { target: t, reason: rest.slice(form.length).trim() };
    }
  }
  const quoted = /^(["'])(.+?)\1(?:\s+(.*))?$/.exec(rest);
  if (quoted) return { target: quoted[2], reason: (quoted[3] || '').trim() };
  const [target, ...words] = rest.split(/\s+/);
  return { target, reason: words.join(' ') };
}

export function userPromptSubmit(input) {
  const root = rootFrom(input);
  if (!isInitialized(root)) return null;
  saveSession(root, input.session_id, { turnFingerprint: fingerprint(root), blocks: 0 });
  const prompt = String(input.prompt || '');
  const granted = [];
  const via = input.turn_id ? 'codex-prompt' : 'claude-code-prompt';
  for (const m of prompt.matchAll(GRANT_RE)) {
    const { target, reason } = parseGrant(m[1], loadRequests(root).map((r) => r.target));
    granted.push(grantWaiver(root, { target, reason: reason.replace(/^["']|["']$/g, ''), via }));
  }
  if (!granted.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `no-more-bugs: the user granted ${plural(granted.length, 'waiver')}: ${granted.map((g) => `${g.target} ("${g.reason}")`).join(', ')}. They are recorded in .nomorebugs/waivers.jsonl. Don't run nmb grant yourself.`,
    },
  };
}

// ---------- Stop ----------
export function stop(input) {
  const root = rootFrom(input);
  if (!isInitialized(root)) return null;
  const config = loadConfig(root);
  const maxBlocks = config.stop?.maxBlocks ?? 3;
  const session = loadSession(root, input.session_id) || { blocks: 0 };
  const fp = fingerprint(root);
  // Nothing changed during this turn: nothing to enforce.
  if (session.turnFingerprint && fp === session.turnFingerprint) return null;

  const result = runCheck(root, { nmb: NMB_CMD });
  if (result.ok) {
    saveSession(root, input.session_id, { ...session, blocks: 0, turnFingerprint: fp });
    return null;
  }
  const waitingOnUser = result.blocking.every((f) => f.request) || result.drafts.some((f) => f.scenarios.length);
  if (waitingOnUser) {
    const waits = [
      ...result.drafts.filter((f) => f.scenarios.length).map((f) => `approve the test plan .nomorebugs/features/${f.slug}.md`),
      ...result.blocking.filter((f) => f.request).map((f) => `grant or refuse the waiver for ${f.target} (type: nmb grant ${shellTarget(f.target)})`),
    ];
    return { systemMessage: `no-more-bugs is waiting for you: ${waits.join('; ')}.` };
  }
  if ((session.blocks || 0) >= maxBlocks) {
    saveSession(root, input.session_id, { ...session, blocks: 0 });
    return {
      systemMessage: `no-more-bugs: the check still fails after ${plural(maxBlocks, 'attempt')}, so the agent was allowed to stop. ${result.blocking.length} problem(s) remain; run "nmb check" to see them.`,
    };
  }
  saveSession(root, input.session_id, { ...session, blocks: (session.blocks || 0) + 1 });
  return {
    decision: 'block',
    reason: `${formatCheck(result, { nmb: NMB_CMD })}\n\nYou changed code in this turn, so you can't finish while the no-more-bugs check fails. Fix the problems, run the tests with ${NMB_CMD} run, and check again. If a problem truly can't be fixed, request a waiver (${NMB_CMD} waive <target> --reason "...") and ask the user to grant it.`,
  };
}

// ---------- PreToolUse (Edit|Write|MultiEdit) ----------
// Ask the user before an edit removes or changes an assertion that already existed when the change
// started, or adds a skip/only marker to an existing test file.
export const ASSERTION_RE = /(\bexpect\s*\(|\bassert|\bshould\b|\bAssert\.|\bverify\s*\(|XCTAssert|\brequire\.|\bt\.(?:Errorf?|Fatalf?)\s*\(|\.toBe|\.toEqual|\.toThrow|\.toMatch|\.toHave|assertThat|assert_that|is_equal|\bcheck\s*\()/;
export const SKIP_RE = /(\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|\bxtest\s*\(|\.only\s*\(|\bfit\s*\(|\bfdescribe\s*\(|@pytest\.mark\.(?:skip|xfail)|\bpytest\.skip\s*\(|@unittest\.skip|@Disabled|@Ignore\b|\[Ignore|\[Explicit|\bt\.Skip\w*\s*\(|\bskip\s*:\s*true|\bpending\s*\(|\.todo\s*\(|markTestSkipped|\bpass_test\s*\(|@skip\b)/;

function lines(text) {
  return String(text || '').split(/\r?\n/);
}

function removedAndAdded(before, after) {
  const counts = new Map();
  for (const l of lines(after)) counts.set(l.trim(), (counts.get(l.trim()) || 0) + 1);
  const removed = [];
  for (const l of lines(before)) {
    const k = l.trim();
    if (counts.get(k)) counts.set(k, counts.get(k) - 1);
    else removed.push(l);
  }
  const beforeSet = new Set(lines(before).map((l) => l.trim()));
  const added = lines(after).filter((l) => !beforeSet.has(l.trim()));
  return { removed, added };
}

// Codex edits files with apply_patch: "*** Update File: <path>" sections with -/+ lines.
export function parsePatch(text) {
  const files = new Map();
  let current = null;
  for (const line of lines(text)) {
    const header = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = { removed: [], added: [] };
      files.set(header[1].trim(), current);
    } else if (current && line.startsWith('-') && !line.startsWith('---')) current.removed.push(line.slice(1));
    else if (current && line.startsWith('+') && !line.startsWith('+++')) current.added.push(line.slice(1));
  }
  return files;
}

function editsOf(tool, ti, root) {
  if (tool === 'Write' && ti.file_path) return new Map([[ti.file_path, removedAndAdded(readText(path.resolve(root, ti.file_path), ''), ti.content)]]);
  if (tool === 'Edit' && ti.file_path) return new Map([[ti.file_path, removedAndAdded(ti.old_string, ti.new_string)]]);
  if (tool === 'MultiEdit' && ti.file_path && Array.isArray(ti.edits)) {
    const acc = { removed: [], added: [] };
    for (const e of ti.edits) {
      const r = removedAndAdded(e.old_string, e.new_string);
      acc.removed.push(...r.removed);
      acc.added.push(...r.added);
    }
    return new Map([[ti.file_path, acc]]);
  }
  const patchText = typeof ti.command === 'string' ? ti.command : typeof ti.input === 'string' ? ti.input : typeof ti.patch === 'string' ? ti.patch : null;
  if (tool === 'apply_patch' || (patchText && patchText.includes('*** Begin Patch'))) return parsePatch(patchText || '');
  return null;
}

export function preToolUse(input) {
  const ti = input.tool_input || {};
  const root = rootFrom(input);
  const edits = editsOf(input.tool_name, ti, root);
  if (!edits || !edits.size || !isInitialized(root) || !isGitRepo(root)) return null;
  const config = loadConfig(root);
  const base = resolveBase(root, config.base);
  const findings = [];
  for (const [file, { removed, added }] of edits) {
    const rel = relPath(root, file);
    if (rel.startsWith('..') || !matchAny(rel, config.tests || [])) continue;
    const baseText = fileAtBase(root, base, rel);
    if (baseText == null) continue; // new in this change: its tests aren't proven yet
    const baseLines = new Set(lines(baseText).map((l) => l.trim()));
    for (const l of removed.filter((x) => ASSERTION_RE.test(x) && baseLines.has(x.trim())).slice(0, 3)) findings.push(`${rel}: removes or changes: ${l.trim()}`);
    for (const l of added.filter((x) => SKIP_RE.test(x)).slice(0, 3)) findings.push(`${rel}: adds a skip: ${l.trim()}`);
  }
  if (!findings.length) return null;
  const message = `no-more-bugs: this edit touches tests that existed before this change.\n${findings.join('\n')}`;
  // Codex has no "ask" decision, so there the agent is warned instead; the review still checks the diff.
  if (input.turn_id || input.tool_name === 'apply_patch') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `${message}\nThese tests are protected. Don't weaken them to make code pass: fix the code, or stop and ask the user first.`,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `${message}\nApprove only if the test itself was wrong, not to make failing code pass.`,
    },
  };
}

export async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

export async function runHook(event) {
  try {
    const input = await readStdinJson();
    const handlers = { 'session-start': sessionStart, 'user-prompt-submit': userPromptSubmit, stop, 'pre-tool-use': preToolUse };
    const handler = handlers[event];
    if (!handler) return 0;
    const out = handler(input);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (err) {
    if (process.env.NMB_DEBUG) process.stderr.write(`no-more-bugs hook ${event} failed: ${err.stack || err}\n`);
  }
  return 0;
}
