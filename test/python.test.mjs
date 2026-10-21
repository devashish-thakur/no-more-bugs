// A real pytest project, end to end. Skipped when pytest isn't installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'using-no-more-bugs', 'scripts', 'nmb.mjs');
const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasPytest = spawnSync(PY, ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0;
let dir;

function env() {
  const e = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'CLAUDECODE', 'CI']) delete e[k];
  return e;
}
const nmb = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: env() });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const git = (...args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

before(() => {
  if (!hasPytest) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmb-py-'));
  write('pytest.ini', '[pytest]\ntestpaths = tests\npythonpath = .\n');
  write('shop/__init__.py', '');
  write('shop/cart.py', 'def total(items):\n    return sum(i["price"] for i in items)\n');
  write('tests/test_cart.py', 'from shop.cart import total\n\ndef test_total_adds_prices():\n    assert total([{"price": 2}, {"price": 3}]) == 5\n');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'start');
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('pytest: init, red with proof, green, file paths in the history', { skip: !hasPytest && 'pytest not installed' }, () => {
  const init = nmb(['init']);
  assert.equal(init.code, 0, init.out);
  assert.match(init.out, /stacks: python/);
  assert.match(init.out, /--junitxml=.*junit_family=xunit1/);

  write('.nomorebugs/features/discounts.md', '---\nfeature: discounts\nprefix: DSC\nplan: approved\ncovers: [shop/discounts.py]\n---\n# Discounts\n\n## DSC-001 · Ten percent off over 100\ntype: unit · priority: high\nGiven a total of 120\nThen  the discounted total is 108\n');
  write('shop/discounts.py', 'def discounted(total):\n    raise NotImplementedError\n');
  write('tests/test_discounts.py', 'from shop.discounts import discounted\n\ndef test_dsc_001_ten_percent_off_over_100():\n    assert discounted(120) == 108\n');
  const red = nmb(['run']);
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /DSC-001 seen failing; proof recorded/);

  write('shop/discounts.py', 'def discounted(total):\n    return total * 0.9 if total > 100 else total\n');
  const green = nmb(['run']);
  assert.equal(green.code, 0, green.out);

  const status = nmb(['status']);
  assert.match(status.out, /✓ DSC-001 Ten percent off over 100 \(unit, high\) · seen failing/);
  const rec = nmb(['review', 'record', 'discounts', '--verdict', 'pass', '--notes', 'checks the exact value']);
  assert.equal(rec.code, 0, rec.out); // files come from the report's file attributes
  assert.match(fs.readFileSync(path.join(dir, '.nomorebugs/reviews/discounts.json'), 'utf8'), /tests\/test_discounts\.py/);
  const check = nmb(['check']);
  assert.equal(check.code, 0, check.out);
});

test('import records a report produced elsewhere', { skip: !hasPytest && 'pytest not installed' }, () => {
  const report = path.join(dir, 'external.xml');
  spawnSync(PY, ['-m', 'pytest', `--junitxml=${report}`, '-o', 'junit_family=xunit1', '-q'], { cwd: dir, encoding: 'utf8' });
  const r = nmb(['import', 'external.xml', '--suite', 'unit']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 passed, 0 failed, 0 skipped \(partial run\)/);
});
