import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, detectFormat } from '../skills/using-no-more-bugs/scripts/lib/reports.mjs';
import { extractIds, suggestPrefix, formatId } from '../skills/using-no-more-bugs/scripts/lib/ids.mjs';
import { parseFeature } from '../skills/using-no-more-bugs/scripts/lib/features.mjs';
import { globToRegExp, matchAny, staticPrefix } from '../skills/using-no-more-bugs/scripts/lib/glob.mjs';
import { parseXml } from '../skills/using-no-more-bugs/scripts/lib/xml.mjs';

const VITEST = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="0.5">
  <testsuite name="tests/api/checkout.test.ts" timestamp="2026-10-22T10:00:00" hostname="x" tests="3" failures="1" errors="0" skipped="1" time="0.4">
    <testcase classname="tests/api/checkout.test.ts" name="checkout &gt; CHK-004 rejects expired coupon" time="0.012">
      <failure message="expected 200 to be 422 // Object.is equality" type="AssertionError"><![CDATA[AssertionError: expected 200 to be 422
 ❯ tests/api/checkout.test.ts:12:24]]></failure>
    </testcase>
    <testcase classname="tests/api/checkout.test.ts" name="checkout &gt; applies a valid coupon" time="0.003"></testcase>
    <testcase classname="tests/api/checkout.test.ts" name="checkout &gt; later" time="0"><skipped/></testcase>
  </testsuite>
</testsuites>`;

const PYTEST = `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" errors="1" failures="0" skipped="0" tests="2" time="0.1">
<testcase classname="tests.test_cart" name="test_chk_005_coupon_applies_once" file="tests/test_cart.py" line="10" time="0.001" />
<testcase classname="tests.test_cart" name="test_import" file="tests/test_cart.py" line="20" time="0.001"><error message="ModuleNotFoundError: No module named 'cart'">trace</error></testcase>
</testsuite></testsuites>`;

const NUNIT = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="3" result="Failed" total="3" passed="1" failed="1" skipped="1">
  <test-suite type="Assembly" name="Game.Tests.dll">
    <test-suite type="TestFixture" name="InventoryTests" fullname="Game.Tests.InventoryTests">
      <test-case id="1001" name="INV001_AddsItem" fullname="Game.Tests.InventoryTests.INV001_AddsItem" classname="Game.Tests.InventoryTests" result="Passed" duration="0.0123" />
      <test-case id="1002" name="INV002_RejectsOverflow" fullname="Game.Tests.InventoryTests.INV002_RejectsOverflow" classname="Game.Tests.InventoryTests" result="Failed" duration="0.2">
        <failure><message><![CDATA[  Expected: 10
  But was:  11]]></message><stack-trace>at ...</stack-trace></failure>
      </test-case>
      <test-case id="1003" name="Later" classname="Game.Tests.InventoryTests" result="Skipped" label="Ignored" duration="0"><reason><message>not yet</message></reason></test-case>
    </test-suite>
  </test-suite>
</test-run>`;

const DART = [
  '{"protocolVersion":"0.1.1","runnerVersion":"1.25.0","pid":1,"type":"start","time":0}',
  '{"suite":{"id":0,"platform":"vm","path":"test/score_test.dart"},"type":"suite","time":1}',
  '{"test":{"id":1,"name":"loading test/score_test.dart","suiteID":0,"groupIDs":[],"metadata":{"skip":false,"skipReason":null},"line":null,"column":null,"url":null},"type":"testStart","time":2}',
  '{"testID":1,"result":"success","skipped":false,"hidden":true,"type":"testDone","time":40}',
  '{"test":{"id":3,"name":"Score SCR-001 adds points","suiteID":0,"groupIDs":[2],"metadata":{"skip":false,"skipReason":null},"line":5,"column":5,"url":"file:///proj/test/score_test.dart"},"type":"testStart","time":41}',
  '{"testID":3,"error":"Expected: <3>\\n  Actual: <2>","stackTrace":"...","isFailure":true,"type":"error","time":50}',
  '{"testID":3,"result":"failure","skipped":false,"hidden":false,"type":"testDone","time":51}',
  'Some non-JSON line flutter prints',
  '{"success":false,"type":"done","time":60}',
].join('\n');

const TRX = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="x" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="a" testName="PAY001_ChargesCard" outcome="Passed" duration="00:00:00.0310000" />
    <UnitTestResult testId="b" testName="PAY002_RefundsCard" outcome="Failed" duration="00:00:01.5000000"><Output><ErrorInfo><Message>Assert.Equal() Failure</Message></ErrorInfo></Output></UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest id="a" name="PAY001_ChargesCard"><TestMethod className="Shop.Tests.PaymentTests" name="PAY001_ChargesCard" /></UnitTest>
    <UnitTest id="b" name="PAY002_RefundsCard"><TestMethod className="Shop.Tests.PaymentTests" name="PAY002_RefundsCard" /></UnitTest>
  </TestDefinitions>
</TestRun>`;

test('detects each report format', () => {
  assert.equal(detectFormat(VITEST), 'junit');
  assert.equal(detectFormat(PYTEST), 'junit');
  assert.equal(detectFormat(NUNIT), 'nunit');
  assert.equal(detectFormat(TRX), 'trx');
  assert.equal(detectFormat(DART), 'dart-json');
  assert.equal(detectFormat('hello'), null);
});

test('reads JUnit from vitest: failure, pass, skip, entities, file from classname', () => {
  const r = parseReport(VITEST);
  assert.equal(r.length, 3);
  assert.equal(r[0].name, 'checkout > CHK-004 rejects expired coupon');
  assert.equal(r[0].status, 'failed');
  assert.match(r[0].message, /expected 200 to be 422/);
  assert.equal(r[0].file, 'tests/api/checkout.test.ts');
  assert.equal(r[0].durationMs, 12);
  assert.equal(r[1].status, 'passed');
  assert.equal(r[2].status, 'skipped');
});

test('reads JUnit from pytest with file attributes and errors', () => {
  const r = parseReport(PYTEST);
  assert.equal(r[0].file, 'tests/test_cart.py');
  assert.equal(r[0].status, 'passed');
  assert.equal(r[1].status, 'error');
  assert.match(r[1].message, /ModuleNotFoundError/);
});

test('reads NUnit 3 XML from the Unity Test Framework', () => {
  const r = parseReport(NUNIT);
  assert.deepEqual(r.map((t) => t.status), ['passed', 'failed', 'skipped']);
  assert.equal(r[0].suite, 'Game.Tests.InventoryTests');
  assert.match(r[1].message, /But was: {2}11/);
  assert.equal(r[2].message, 'not yet');
});

test('reads Dart JSON events and ignores hidden loading tests and noise', () => {
  const r = parseReport(DART);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Score SCR-001 adds points');
  assert.equal(r[0].status, 'failed');
  assert.equal(r[0].file, '/proj/test/score_test.dart');
  assert.equal(r[0].durationMs, 10);
});

test('reads TRX from dotnet test', () => {
  const r = parseReport(TRX);
  assert.deepEqual(r.map((t) => [t.suite, t.status]), [['Shop.Tests.PaymentTests', 'passed'], ['Shop.Tests.PaymentTests', 'failed']]);
  assert.equal(r[1].durationMs, 1500);
});

test('XML parser tolerates comments, doctype and self-closing tags', () => {
  const doc = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><!-- c --><a x=\'1\' y="&lt;2&gt;"><b/><c>t&#65;&#x42;</c></a>');
  const a = doc.children[0];
  assert.equal(a.attrs.y, '<2>');
  assert.equal(a.children.length, 2);
  assert.equal(a.children[1].text, 'tAB');
});

test('extracts IDs in every naming style, only for declared prefixes', () => {
  const p = new Set(['CHK', 'INV']);
  assert.deepEqual(extractIds('CHK-004 rejects expired coupon', p), ['CHK-004']);
  assert.deepEqual(extractIds('test_chk_004_rejects_expired_coupon', p), ['CHK-004']);
  assert.deepEqual(extractIds('chk004_rejectsExpiredCoupon', p), ['CHK-004']);
  assert.deepEqual(extractIds('testChk004RejectsExpired', p), ['CHK-004']);
  assert.deepEqual(extractIds('TestCheckout/CHK-004_rejects_expired_coupon', p), ['CHK-004']);
  assert.deepEqual(extractIds('INV001_AddsItem and CHK-12', p), ['INV-001']);
  assert.deepEqual(extractIds('covers CHK-004 and CHK-005', p), ['CHK-004', 'CHK-005']);
  assert.deepEqual(extractIds('XCHK004 nope', p), []);
  assert.deepEqual(extractIds('API-200 is not declared', p), []);
  assert.equal(formatId('chk', 7), 'CHK-007');
});

test('suggests readable, unique prefixes', () => {
  assert.equal(suggestPrefix('checkout-coupons'), 'CHC');
  assert.equal(suggestPrefix('inventory'), 'INV');
  assert.notEqual(suggestPrefix('inventory', new Set(['INV'])), 'INV');
});

const FEATURE = `---
feature: checkout-coupons
prefix: CHK
plan: approved   # approved after review with the user
covers: [src/checkout/coupons.ts, "src/checkout/rules/**"]
---
# Checkout coupons

## CHK-004 · Expired coupon is rejected
type: api · priority: high
Given a coupon that expired yesterday
When  POST /checkout is called with it
Then  422 COUPON_EXPIRED

## CHK-005 - A coupon can't be applied twice
type: unit
kind: regression
Given a cart with coupon X
Then  applying X again fails

<!--
## CHK-099 · commented-out example
type: unit
-->

## Notes
Free text that isn't a scenario.
`;

test('parses a feature file', () => {
  const f = parseFeature(FEATURE, '.nomorebugs/features/checkout-coupons.md');
  assert.deepEqual(f.errors, []);
  assert.equal(f.prefix, 'CHK');
  assert.equal(f.plan, 'approved');
  assert.deepEqual(f.covers, ['src/checkout/coupons.ts', 'src/checkout/rules/**']);
  assert.equal(f.title, 'Checkout coupons');
  assert.equal(f.scenarios.length, 2);
  const [a, b] = f.scenarios;
  assert.deepEqual([a.id, a.type, a.priority, a.kind], ['CHK-004', 'api', 'high', 'behavior']);
  assert.match(a.body, /^Given a coupon/);
  assert.deepEqual([b.id, b.type, b.priority, b.kind, b.title], ['CHK-005', 'unit', 'medium', 'regression', "A coupon can't be applied twice"]);
});

test('reports feature file mistakes clearly', () => {
  const f = parseFeature(`---\nfeature: x\nprefix: AB\nplan: maybe\n---\n## AB-001 · thing\ntype: smoke\n\n## CD-002 · other\ntype: unit\n\n## AB-001 · again\ntype: unit\n`, 'x.md');
  const all = f.errors.join('\n');
  assert.match(all, /plan must be one of/);
  assert.match(all, /type "smoke"/);
  assert.match(all, /CD-002.*prefix AB/);
  assert.match(all, /AB-001.*declared twice/);
});

test('block-list frontmatter works too', () => {
  const f = parseFeature(`---\nfeature: y\nprefix: YY\ncovers:\n  - src/a.ts\n  - src/b/**\n---\n`, 'y.md');
  assert.deepEqual(f.covers, ['src/a.ts', 'src/b/**']);
});

test('globs', () => {
  assert.ok(matchAny('src/checkout/rules/a.ts', ['src/checkout/rules/**']));
  assert.ok(matchAny('deep/dir/foo.test.ts', ['*.test.*']));
  assert.ok(matchAny('tests/test_cart.py', ['**/test_*.py']));
  assert.ok(matchAny('test_cart.py', ['**/test_*.py']));
  assert.ok(matchAny('src/x.tsx', ['src/**/*.{ts,tsx}']));
  assert.ok(!matchAny('lib/x.ts', ['src/**']));
  assert.ok(globToRegExp('a/**/b.xml').test('a/b.xml'));
  assert.equal(staticPrefix('target/surefire-reports/TEST-*.xml'), 'target/surefire-reports');
  assert.equal(staticPrefix('**/build/x.xml'), '');
});
