// `nmb install codex` and `nmb install git-hook`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, readText, ensureDir } from './util.mjs';
import { git } from './git.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'nmb.mjs');
const SKILLS_DIR = path.resolve(here, '..', '..', '..');
export const SKILL_NAMES = ['using-no-more-bugs', 'planning-tests', 'writing-tests', 'reviewing-tests', 'verifying-tests'];
const MARK = 'no-more-bugs';

function cliCommand(event) {
  return `node "${CLI.replace(/\\/g, '/')}" hook ${event}`;
}

// Link (or copy, if links aren't allowed) each skill folder into `targetDir`.
export function linkSkills(targetDir) {
  ensureDir(targetDir);
  const done = [];
  for (const name of SKILL_NAMES) {
    const src = path.join(SKILLS_DIR, name);
    const dest = path.join(targetDir, name);
    if (fs.existsSync(dest)) {
      done.push(`${name} (already there)`);
      continue;
    }
    try {
      fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
      done.push(`${name} (linked)`);
    } catch {
      fs.cpSync(src, dest, { recursive: true });
      done.push(`${name} (copied)`);
    }
  }
  return done;
}

export function installCodex(root, { user = false } = {}) {
  const skillsTarget = user ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.agents', 'skills') : path.join(root, '.agents', 'skills');
  const skills = linkSkills(skillsTarget);

  const hooksFile = user ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex', 'hooks.json') : path.join(root, '.codex', 'hooks.json');
  const config = readJson(hooksFile, null) || { hooks: {} };
  config.hooks ||= {};
  const wanted = {
    SessionStart: { event: 'session-start', timeout: 60 },
    UserPromptSubmit: { event: 'user-prompt-submit', timeout: 60 },
    PreToolUse: { matcher: '^(apply_patch|Edit|Write)$', event: 'pre-tool-use', timeout: 30 },
    Stop: { event: 'stop', timeout: 120 },
  };
  const changed = [];
  for (const [eventName, w] of Object.entries(wanted)) {
    const groups = (config.hooks[eventName] ||= []);
    // Drop an older no-more-bugs entry (for example one pointing at a previous install path).
    for (const g of groups) g.hooks = (g.hooks || []).filter((h) => !String(h.command || '').includes(`nmb.mjs" hook ${w.event}`) && h.name !== MARK);
    const kept = groups.filter((g) => g.hooks.length);
    const group = { ...(w.matcher ? { matcher: w.matcher } : {}), hooks: [{ type: 'command', command: cliCommand(w.event), timeout: w.timeout }] };
    config.hooks[eventName] = [...kept, group];
    changed.push(eventName);
  }
  ensureDir(path.dirname(hooksFile));
  writeJson(hooksFile, config);
  return { skillsTarget, skills, hooksFile, events: changed };
}

const HOOK_SCRIPT = (cli) => `#!/bin/sh
# ${MARK}: block commits while the no-more-bugs check fails.
# Skip once with: git commit --no-verify
node "${cli}" check
status=$?
if [ $status -ne 0 ]; then
  echo ""
  echo "no-more-bugs: commit blocked. Fix the problems above, or ask for a waiver."
  exit 1
fi
`;

export function installGitHook(root, { force = false } = {}) {
  const hooksDir = git(root, ['rev-parse', '--git-path', 'hooks'])?.trim();
  if (!hooksDir) throw new Error("This isn't a git repository.");
  const dir = path.resolve(root, hooksDir);
  const file = path.join(dir, 'pre-commit');
  const existing = readText(file);
  if (existing && !existing.includes(MARK) && !force) {
    throw new Error(`${file} already exists and isn't ours. Add this line to it instead:\n  node "${CLI.replace(/\\/g, '/')}" check || exit 1\nor re-run with --force to replace it.`);
  }
  ensureDir(dir);
  fs.writeFileSync(file, HOOK_SCRIPT(CLI.replace(/\\/g, '/')), { mode: 0o755 });
  return file;
}
