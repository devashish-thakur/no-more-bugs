// .nomorebugs/config.json
//
// {
//   "version": 1,
//   "base": "auto",                       // where "the change" starts: auto | a branch or commit
//   "source": ["src/**"],                 // changed files here must be covered by a feature
//   "tests":  ["tests/**", "**/*.test.*"],// test files (protected-test checks look here)
//   "suites": [
//     { "name": "unit", "stack": "typescript",
//       "command": "npx vitest run --reporter=default --reporter=junit --outputFile.junit=.nomorebugs/local/reports/vitest.xml",
//       "reports": [".nomorebugs/local/reports/vitest.xml"], "format": "junit",
//       "env": {}, "paths": [] }
//   ]
// }
//
// "command" may also be { "default": "...", "windows": "..." } for projects shared across platforms.
import { nmbPaths, readJson, writeJson } from './util.mjs';

export const DEFAULT_CONFIG = {
  version: 1,
  base: 'auto',
  source: [],
  tests: [],
  suites: [],
  stop: { maxBlocks: 3 },
};

export function loadConfig(root) {
  const file = nmbPaths(root).config;
  const raw = readJson(file);
  if (!raw) throw new Error('This project has no .nomorebugs/config.json. Run: nmb init');
  const config = { ...DEFAULT_CONFIG, ...raw, stop: { ...DEFAULT_CONFIG.stop, ...(raw.stop || {}) } };
  const problems = [];
  if (!Array.isArray(config.suites)) problems.push('"suites" must be a list');
  for (const [i, s] of (config.suites || []).entries()) {
    if (!s.name) problems.push(`suite ${i + 1} has no "name"`);
    if (!s.command) problems.push(`suite "${s.name || i + 1}" has no "command"`);
    if (!s.reports || !s.reports.length) problems.push(`suite "${s.name || i + 1}" has no "reports" paths`);
  }
  if (problems.length) throw new Error(`.nomorebugs/config.json: ${problems.join('; ')}`);
  return config;
}

export function saveConfig(root, config) {
  writeJson(nmbPaths(root).config, config);
}

export function suiteCommand(suite) {
  const c = suite.command;
  if (typeof c === 'string') return c;
  if (process.platform === 'win32' && c.windows) return c.windows;
  if (process.platform === 'darwin' && c.mac) return c.mac;
  return c.default || c.unix || c.linux || Object.values(c)[0];
}
