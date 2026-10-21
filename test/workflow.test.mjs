// End to end: drive the real CLI through a feature's whole life in a throwaway git repo that uses
// Node's built-in test runner (so the test needs nothing installed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'using-no-more-bugs', 'scripts', 'nmb.mjs');
let dir;

// Child processes of `node --test` inherit NODE_TEST_CONTEXT, which would turn the sample
// project's own `node --test` into a sub-runner. Strip it, and any agent markers.
function env(extra = {}) {
  const e = { ...process.env, ...extra };
  for (const k of ['NODE_TEST_CONTEXT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CI']) delete e[k];
  return e;
}

function nmb(args, { input, extraEnv } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', input, env: env(extraEnv) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: env() });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function write(rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

function hook(event, payload) {
  const r = nmb(['hook', event], { input: JSON.stringify({ session_id: 's1', cwd: dir, ...payload }) });
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmb-e2e-'));
  write('package.json', JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }, null, 2));
  write('src/cart.js', 'export function total(items) { return items.reduce((s, i) => s + i.price, 0); }\n');
  write('test/cart.test.js', `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/cart.js';\ntest('total adds prices', () => {\n  assert.equal(total([{ price: 2 }, { price: 3 }]), 5);\n});\n`);
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.']);
  sh('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'start']);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('init detects the node test runner and writes config', () => {
  const r = nmb(['init']);
  assert.equal(r.code, 0, r.out);
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.nomorebugs/config.json'), 'utf8'));
  assert.equal(config.suites[0].name, 'unit');
  assert.match(config.suites[0].command, /--test-reporter=junit/);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.nomorebugs\/local\//);
  assert.match(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8'), /proofs\.jsonl merge=union/);
});

test('a baseline run records the existing test', () => {
  const r = nmb(['run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 passed, 0 failed/);
  const s = nmb(['status']);
  assert.match(s.out, /1 test in the latest runs, 1 without a scenario ID/);
});

test('planning: a draft feature does not block, an approved one does', () => {
  assert.equal(nmb(['new', 'coupons', '--prefix', 'CPN', '--covers', 'src/coupons.js']).code, 0);
  const file = path.join(dir, '.nomorebugs/features/coupons.md');
  const text = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/, '## CPN-001 · Expired coupons are rejected\ntype: unit · priority: high\nGiven a coupon that expired yesterday\nThen  applying it throws "expired"\n');
  fs.writeFileSync(file, text);
  let c = nmb(['check']);
  assert.equal(c.code, 0, c.out); // only a draft so far
  assert.match(c.out, /waiting for the user's approval/);
  assert.equal(nmb(['approve', 'coupons']).code, 0);
  c = nmb(['check']);
  assert.equal(c.code, 1);
  assert.match(c.out, /\[no-test\] CPN-001/);
});

test('red first: the new test fails and a proof is recorded', () => {
  write('src/coupons.js', 'export function apply(coupon, now) { return true; }\n');
  write('test/coupons.test.js', `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { apply } from '../src/coupons.js';\ntest('CPN-001 rejects an expired coupon', () => {\n  assert.throws(() => apply({ expires: 1 }, 2), /expired/);\n});\n`);
  const r = nmb(['run', '--actor', 'agent']);
  assert.equal(r.code, 1);
  assert.match(r.out, /CPN-001 seen failing; proof recorded/);
  const proofs = fs.readFileSync(path.join(dir, '.nomorebugs/proofs.jsonl'), 'utf8');
  assert.match(proofs, /"id":"CPN-001"/);
  const c = nmb(['check']);
  assert.match(c.out, /\[failing\] CPN-001/);
  assert.doesNotMatch(c.out, /not-seen-failing/);
});

test('green, then the review gate, then the check passes', () => {
  write('src/coupons.js', 'export function apply(coupon, now) {\n  if (coupon.expires < now) throw new Error("expired");\n  return true;\n}\n');
  assert.equal(nmb(['run']).code, 0);
  let c = nmb(['check']);
  assert.equal(c.code, 1);
  assert.match(c.out, /\[no-review\] coupons/);
  const prep = nmb(['review', 'prep', 'coupons']);
  assert.match(prep.out, /CPN-001/);
  assert.match(prep.out, /first seen failing/);
  const rec = nmb(['review', 'record', 'coupons', '--verdict', 'pass', '--files', 'test/coupons.test.js', '--notes', 'asserts the error']);
  assert.equal(rec.code, 0, rec.out);
  c = nmb(['check']);
  assert.equal(c.code, 0, c.out);
});

test('editing code after the run makes results stale', () => {
  write('src/coupons.js', fs.readFileSync(path.join(dir, 'src/coupons.js'), 'utf8') + '// tweak\n');
  const c = nmb(['check']);
  assert.match(c.out, /\[stale\] Suite "unit"/);
  assert.equal(nmb(['run']).code, 0);
  assert.equal(nmb(['check']).code, 0);
});

test('changing a reviewed test makes the review stale', () => {
  const f = path.join(dir, 'test/coupons.test.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + '// comment\n');
  nmb(['run']);
  const c = nmb(['check']);
  assert.match(c.out, /\[stale-review\] coupons/);
  nmb(['review', 'record', 'coupons', '--verdict', 'pass', '--files', 'test/coupons.test.js']);
  assert.equal(nmb(['check']).code, 0);
});

test('uncovered source changes are reported', () => {
  write('src/cart.js', 'export function total(items) { return items.reduce((s, i) => s + i.price, 0); }\nexport const x = 1;\n');
  nmb(['run']);
  const c = nmb(['check']);
  assert.match(c.out, /\[uncovered-source\] src\/cart\.js/);
  assert.match(c.out, /\[test-changed-unreviewed\]|PASSED|uncovered/);
});

test('deleting a protected test is caught; a user-granted waiver clears it', () => {
  fs.rmSync(path.join(dir, 'test/cart.test.js'));
  nmb(['run']);
  let c = nmb(['check']);
  assert.match(c.out, /\[protected-missing\] test\/cart\.test\.js::total adds prices/);
  // The agent can request but not grant.
  const req = nmb(['waive', 'test/cart.test.js::total adds prices', '--reason', 'cart totals moved to the pricing service']);
  assert.equal(req.code, 0, req.out);
  const g = nmb(['grant', 'test/cart.test.js::total adds prices'], { extraEnv: { CLAUDECODE: '1' } });
  assert.equal(g.code, 1);
  assert.match(g.out, /Refusing/);
  // The user types the grant as a message; the prompt hook records it.
  const out = hook('user-prompt-submit', { prompt: 'looks fine\nnmb grant test/cart.test.js::total adds prices' });
  assert.match(out.hookSpecificOutput.additionalContext, /granted 1 waiver/);
  nmb(['waive', 'src/cart.js', '--reason', 'export only used by a debugging script']);
  hook('user-prompt-submit', { prompt: 'nmb grant src/cart.js' });
  c = nmb(['check']);
  assert.equal(c.code, 0, c.out);
});

test('stop hook: allows when nothing changed, blocks on failures, gives up after the cap', () => {
  hook('user-prompt-submit', { prompt: 'start a turn' });
  assert.equal(hook('stop', {}), null); // nothing changed this turn
  write('src/coupons.js', 'export function apply() { return true; }\n'); // break it
  nmb(['run']);
  const out = hook('stop', {});
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /\[failing\] CPN-001/);
  hook('stop', {});
  hook('stop', {});
  const fourth = hook('stop', {});
  assert.equal(fourth.decision, undefined);
  assert.match(fourth.systemMessage, /still fails after 3 attempts/);
});

test('pre-tool-use hook asks before weakening an existing assertion', () => {
  sh('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.']);
  sh('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'coupons']);
  const file = path.join(dir, 'test/coupons.test.js');
  const weak = hook('pre-tool-use', {
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: "  assert.throws(() => apply({ expires: 1 }, 2), /expired/);", new_string: '  apply({ expires: 1 }, 2);' },
  });
  assert.equal(weak.hookSpecificOutput.permissionDecision, 'ask');
  const skip = hook('pre-tool-use', { tool_name: 'Edit', tool_input: { file_path: file, old_string: "test('CPN-001", new_string: "test.skip('CPN-001" } });
  assert.equal(skip.hookSpecificOutput.permissionDecision, 'ask');
  const fine = hook('pre-tool-use', { tool_name: 'Edit', tool_input: { file_path: file, old_string: '});', new_string: "});\ntest('CPN-002 x', () => { assert.ok(true); });" } });
  assert.equal(fine, null);
});

test('session start injects the router with the CLI path', () => {
  const out = hook('session-start', { source: 'startup' });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /<NO-MORE-BUGS>/);
  assert.match(ctx, /nmb\.mjs/);
  assert.doesNotMatch(ctx, /\{\{NMB\}\}/);
});

test('dashboard state and history endpoints', async () => {
  const { dashboardState, testHistory } = await import('../skills/using-no-more-bugs/scripts/lib/dashboard.mjs');
  const s = dashboardState(dir);
  assert.equal(s.features[0].slug, 'coupons');
  assert.ok(s.runs.length >= 5);
  const h = testHistory(dir, { id: 'CPN-001' });
  assert.ok(h.some((x) => x.status === 'failed') && h.some((x) => x.status === 'passed'));
});
