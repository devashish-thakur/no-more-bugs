import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGrant, parsePatch, ASSERTION_RE, SKIP_RE } from '../skills/using-no-more-bugs/scripts/lib/hooks.mjs';
import { shellTarget } from '../skills/using-no-more-bugs/scripts/lib/util.mjs';
import { installCodex, SKILL_NAMES } from '../skills/using-no-more-bugs/scripts/lib/install.mjs';

test('grant parsing prefers the pending target, even with spaces', () => {
  const pending = ['test/cart.test.js::total adds prices', 'CHK-004'];
  assert.deepEqual(parseGrant('test/cart.test.js::total adds prices', pending), { target: 'test/cart.test.js::total adds prices', reason: '' });
  assert.deepEqual(parseGrant('test/cart.test.js::total adds prices moved to pricing', pending), { target: 'test/cart.test.js::total adds prices', reason: 'moved to pricing' });
  assert.deepEqual(parseGrant('"a b" because', []), { target: 'a b', reason: 'because' });
  assert.deepEqual(parseGrant('CHK-009 flaky upstream', pending), { target: 'CHK-009', reason: 'flaky upstream' });
});

test('targets with spaces are quoted in suggested commands', () => {
  assert.equal(shellTarget('CHK-004'), 'CHK-004');
  assert.equal(shellTarget('a::b c'), '"a::b c"');
});

test('apply_patch text is split into removed and added lines per file', () => {
  const files = parsePatch(['*** Begin Patch', '*** Update File: tests/test_cart.py', '@@', '-    assert total == 5', '+    assert total', ' context', '*** Add File: tests/test_new.py', '+def test_x(): pass', '*** End Patch'].join('\n'));
  assert.deepEqual(files.get('tests/test_cart.py'), { removed: ['    assert total == 5'], added: ['    assert total'] });
  assert.deepEqual(files.get('tests/test_new.py').added, ['def test_x(): pass']);
});

test('assertion and skip patterns cover the common frameworks', () => {
  for (const l of ['expect(x).toBe(1)', 'assert x == 1', 'Assert.That(x, Is.EqualTo(1));', 'assertThat(x).isEqualTo(1)', 'assert_eq(a, b)', 't.Errorf("bad")', 'XCTAssertEqual(a, b)']) assert.ok(ASSERTION_RE.test(l), l);
  for (const l of ["test.skip('x', () => {})", 'it.only(', '@pytest.mark.skip', '@Disabled', '[Ignore("later")]', 't.Skip("x")', "test('x', skip: true", 'pending()']) assert.ok(SKIP_RE.test(l), l);
  assert.ok(!SKIP_RE.test("test('skips nothing', () => {})"));
});

test('install codex links every skill and writes hooks without duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmb-codex-'));
  try {
    installCodex(dir);
    const again = installCodex(dir); // idempotent
    for (const name of SKILL_NAMES) assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', name, 'SKILL.md')), name);
    const hooks = JSON.parse(fs.readFileSync(again.hooksFile, 'utf8')).hooks;
    assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    assert.equal(hooks.Stop.length, 1);
    assert.match(hooks.Stop[0].hooks[0].command, /nmb\.mjs" hook stop$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
