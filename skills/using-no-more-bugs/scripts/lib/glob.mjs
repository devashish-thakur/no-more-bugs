// Minimal glob support: **, *, ?, [abc], {a,b}. Paths are POSIX-style and relative to the project root.
// A pattern with no slash matches at any depth, like .gitignore.
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './util.mjs';

const cache = new Map();

export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let p = toPosix(pattern.trim()).replace(/^\.\//, '');
  if (!p.includes('/')) p = `**/${p}`;
  if (p.endsWith('/')) p += '**';
  let re = '';
  let i = 0;
  let braceDepth = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // "**/" matches zero or more directories; a trailing "**" matches everything below.
        if (p[i + 2] === '/') {
          re += '(?:[^/]*/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
        i += 1;
      } else {
        let cls = p.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (cls[0] === '!') cls = `^${cls.slice(1)}`;
        re += `[${cls}]`;
        i = end + 1;
      }
    } else if (c === '{') {
      braceDepth++;
      re += '(?:';
      i += 1;
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      re += ')';
      i += 1;
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
      i += 1;
    } else {
      re += c.replace(/[.+^$()|\\]/g, '\\$&');
      i += 1;
    }
  }
  const out = new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
  cache.set(pattern, out);
  return out;
}

export function matchGlob(file, pattern) {
  return globToRegExp(pattern).test(toPosix(file).replace(/^\.\//, ''));
}

export function matchAny(file, patterns = []) {
  return patterns.some((p) => matchGlob(file, p));
}

// The part of a pattern before its first wildcard: where a directory walk can start.
export function staticPrefix(pattern) {
  const p = toPosix(pattern).replace(/^\.\//, '');
  if (!p.includes('/')) return '';
  const parts = p.split('/');
  const fixed = [];
  for (const part of parts.slice(0, -1)) {
    if (/[*?[{]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join('/');
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.venv', 'venv', '__pycache__', '.dart_tool', 'Library', 'Temp', '.godot', '.gradle', '.idea']);

// Find files matching any of the patterns. Walks from each pattern's static prefix.
export function findFiles(root, patterns, { maxFiles = 50000 } = {}) {
  const found = new Set();
  const starts = new Set(patterns.map(staticPrefix));
  let count = 0;
  const visit = (dirRel, depth) => {
    if (depth > 25 || count > maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) && !patterns.some((p) => toPosix(p).includes(`${e.name}/`))) continue;
        visit(rel, depth + 1);
      } else if (e.isFile()) {
        count++;
        if (matchAny(rel, patterns)) found.add(rel);
      }
    }
  };
  for (const start of starts) visit(start, 0);
  return [...found].sort();
}
