// Git helpers. Everything degrades gracefully when the project isn't a git repository.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sha256, toPosix, NMB_DIR } from './util.mjs';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function git(root, args, { input, allowFail = true } = {}) {
  const res = spawnSync('git', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error || res.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.error?.message}`);
  }
  return res.stdout;
}

// Git is slow to start on some machines (a second or more per call), so results that can't change
// within one command are memoized, and related questions share a single git call.
const memo = new Map();
function remember(key, fn) {
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}
export function clearGitCache() {
  memo.clear();
}

// { repo, head, branch } from one call.
export function repoInfo(root) {
  return remember(`info:${root}`, () => {
    const out = git(root, ['rev-parse', '--is-inside-work-tree', 'HEAD', '--abbrev-ref', 'HEAD']);
    if (out == null) {
      // Either not a repo, or a repo with no commits yet.
      const inside = git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
      return { repo: inside, head: null, branch: inside ? git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() || null : null };
    }
    const [, head, branch] = out.trim().split(/\r?\n/);
    return { repo: true, head: head || null, branch: branch && branch !== 'HEAD' ? branch : null };
  });
}

export function isGitRepo(root) {
  return repoInfo(root).repo;
}

export function headCommit(root) {
  return repoInfo(root).head;
}

export function currentBranch(root) {
  return repoInfo(root).branch;
}

// The commit the current change started from: the merge-base with the default branch,
// or HEAD when working directly on it. An empty repository uses the empty tree.
export function resolveBase(root, configured = 'auto') {
  return remember(`base:${root}:${configured}`, () => {
    const { repo, head } = repoInfo(root);
    if (!repo) return null;
    if (!head) return EMPTY_TREE;
    let ref = null;
    if (configured && configured !== 'auto') {
      ref = git(root, ['rev-parse', '--verify', '-q', `${configured}^{commit}`])?.trim() || null;
    } else {
      const out = git(root, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) || '';
      const refs = new Map(out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
        const [name, obj, sym] = l.split(' ');
        return [name, { obj, sym }];
      }));
      const originHead = refs.get('refs/remotes/origin/HEAD');
      const order = [originHead?.sym, 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'].filter(Boolean);
      for (const name of order) {
        if (refs.has(name)) {
          ref = refs.get(name).obj;
          break;
        }
      }
      if (!ref && originHead) ref = originHead.obj;
    }
    if (!ref) return head;
    return git(root, ['merge-base', head, ref])?.trim() || head;
  });
}

function splitZ(out) {
  return out ? out.split('\0').filter(Boolean) : [];
}

// Files that differ between `base` and the working tree, plus untracked files. POSIX paths.
export function changedFiles(root, base) {
  if (!base) return [];
  const diff = splitZ(git(root, ['diff', '--name-only', '--relative', '-z', '--no-renames', base, '--']));
  const untracked = splitZ(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([...diff, ...untracked].map(toPosix))].filter((f) => !f.startsWith(`${NMB_DIR}/`)).sort();
}

function baseFiles(root, base) {
  return remember(`tree:${root}:${base}`, () => new Set(splitZ(git(root, ['ls-tree', '-r', '--name-only', '-z', base])).map(toPosix)));
}

export function existsAtBase(root, base, file) {
  if (!base || base === EMPTY_TREE) return false;
  return baseFiles(root, base).has(toPosix(file));
}

export function fileAtBase(root, base, file) {
  if (!existsAtBase(root, base, file)) return null;
  return git(root, ['show', `${base}:./${toPosix(file)}`]);
}

export function diffFromBase(root, base, file) {
  if (!base) return null;
  return git(root, ['diff', '--no-color', base, '--', toPosix(file)]);
}

// Test runs write caches and reports; those must not count as code changes.
const NOISE = ['**/__pycache__/**', '**/.pytest_cache/**', '**/coverage/**', '**/test-results/**', '**/playwright-report/**', '**/surefire-reports/**', '**/.dart_tool/**', '**/TestResults/**', 'reports/**', '**/*.pyc'];

// A content fingerprint of the working tree: tracked files as they are on disk plus untracked
// files, independent of what is staged. `.nomorebugs/` is excluded so recording a run doesn't
// change the fingerprint it was recorded against. Returns { fingerprint, dirty }.
export function workingTree(root, pathspecs = []) {
  if (!isGitRepo(root)) return { fingerprint: fallbackFingerprint(root), dirty: null };
  const specs = [
    ...(pathspecs.length ? pathspecs.map((p) => `:(glob)${p}`) : ['.']),
    `:(exclude)${NMB_DIR}`,
    ...NOISE.map((n) => `:(exclude,glob)${n}`),
  ];
  const staged = git(root, ['ls-files', '-s', '-z', '--', ...specs]);
  if (staged == null) return { fingerprint: null, dirty: null };
  const entries = new Map();
  for (const rec of splitZ(staged)) {
    const tab = rec.indexOf('\t');
    const [, hash] = rec.slice(0, tab).split(' ');
    entries.set(rec.slice(tab + 1), hash);
  }
  // One call for modified (C), deleted (R) and untracked (?) files.
  const deleted = new Set();
  const toHash = new Set();
  for (const rec of splitZ(git(root, ['ls-files', '-t', '-m', '-d', '-o', '--exclude-standard', '-z', '--', ...specs]))) {
    const tag = rec[0];
    const file = rec.slice(2);
    if (tag === 'R') deleted.add(file);
    else toHash.add(file);
  }
  for (const d of deleted) {
    entries.delete(d);
    toHash.delete(d);
  }
  const list = [...toHash];
  if (list.length) {
    const hashes = (git(root, ['hash-object', '--stdin-paths'], { input: list.join('\n') + '\n' }) || '').trim().split(/\r?\n/);
    list.forEach((f, i) => entries.set(f, hashes[i] || 'unreadable'));
  }
  const lines = [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([f, h]) => `${h} ${f}`);
  return { fingerprint: sha256(lines.join('\n')).slice(0, 16), dirty: deleted.size + toHash.size > 0 };
}

export function fingerprint(root, pathspecs = []) {
  return workingTree(root, pathspecs).fingerprint;
}

export function isDirty(root) {
  return workingTree(root).dirty;
}

const FALLBACK_SKIP = new Set(['node_modules', '.git', NMB_DIR, '.venv', 'venv', '__pycache__', '.dart_tool', 'build', 'dist', 'target', 'Library', 'Temp', 'obj', 'bin', '.godot', '.gradle']);

// Without git: size + mtime of every file. Coarser, but still changes when files change.
function fallbackFingerprint(root) {
  const parts = [];
  let count = 0;
  const visit = (dir) => {
    if (count > 20000) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!FALLBACK_SKIP.has(e.name)) visit(full);
      } else if (e.isFile()) {
        count++;
        try {
          const st = fs.statSync(full);
          parts.push(`${toPosix(path.relative(root, full))}:${st.size}:${Math.round(st.mtimeMs)}`);
        } catch {
          // ignore files that vanish mid-walk
        }
      }
    }
  };
  visit(root);
  return sha256(parts.sort().join('\n')).slice(0, 16);
}
