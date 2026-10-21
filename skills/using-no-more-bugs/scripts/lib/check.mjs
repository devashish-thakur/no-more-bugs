// `nmb check`: decide whether the current change is tested enough.
import fs from 'node:fs';
import path from 'node:path';
import { buildState } from './state.mjs';
import { isGitRepo, resolveBase, changedFiles, existsAtBase, fingerprint } from './git.mjs';
import { matchAny } from './glob.mjs';
import { changedSinceReview } from './reviews.mjs';
import { findWaiver, findRequest } from './waivers.mjs';
import { hashFile, plural, truncate, shellTarget } from './util.mjs';

const DEFAULT_SOURCE_IGNORE = ['**/*.config.*', '**/*.d.ts', '**/*.md', '**/*.json', '**/*.lock', '**/*.yml', '**/*.yaml', '**/.*'];

export function runCheck(root, { ci = false, nmb = 'nmb' } = {}) {
  const state = buildState(root);
  const { config, features } = state;
  const findings = [];
  const add = (f) => findings.push({ severity: 'error', waivable: true, ...f });

  // ---------- feature files ----------
  for (const f of features) {
    for (const e of f.errors) add({ rule: 'feature-invalid', target: f.file, message: `${f.file}: ${e}`, fix: 'Fix the feature file.', waivable: false });
    for (const w of f.warnings) add({ rule: 'feature-warning', severity: 'warning', target: f.file, message: `${f.file}: ${w}` });
  }
  for (const e of state.featureErrors) add({ rule: 'duplicate-id', target: e.target, message: e.message, fix: `Give one of them a new ID (${nmb} id <prefix>).`, waivable: false });
  const drafts = features.filter((f) => f.plan === 'draft');
  const approved = features.filter((f) => f.plan === 'approved');
  for (const f of drafts) {
    if (f.scenarios.length) add({ rule: 'plan-draft', severity: 'info', target: f.slug, message: `${f.slug}: plan with ${plural(f.scenarios.length, 'scenario')} is waiting for the user's approval.` });
  }

  // ---------- git: what is "the change" ----------
  const repo = isGitRepo(root);
  const base = repo ? resolveBase(root, config.base) : null;
  const changed = repo && base ? changedFiles(root, base) : [];

  // ---------- suites: has everything been run on the current code? ----------
  const hasWork = approved.some((f) => f.scenarios.length) || changed.length > 0;
  for (const suite of config.suites) {
    const run = state.latestFull.get(suite.name);
    if (!run) {
      if (hasWork) add({ rule: 'not-run', target: suite.name, message: `Suite "${suite.name}" has never been run.`, fix: `${nmb} run ${suite.name}`, waivable: false });
      continue;
    }
    if (!ci) {
      const fp = fingerprint(root, suite.paths || []);
      if (fp && run.fingerprint && fp !== run.fingerprint) {
        add({ rule: 'stale', target: suite.name, message: `Suite "${suite.name}" last ran on different code (${run.time}).`, fix: `${nmb} run ${suite.name}`, waivable: false });
      }
    }
    const any = state.latestAny.get(suite.name);
    if (any && any !== run && any.error) add({ rule: 'run-error', severity: 'warning', target: suite.name, message: `The latest run of "${suite.name}" produced no report: ${any.error}` });
  }

  // ---------- scenarios in approved plans ----------
  for (const sc of state.scenarios) {
    if (sc.plan !== 'approved') continue;
    const label = `${sc.id} · ${sc.title}`;
    if (sc.status === 'planned') {
      add({ rule: 'no-test', target: sc.id, message: `${label}: no test has ${sc.id} in its name.`, fix: `Write a ${sc.type} test named with ${sc.id}, then ${nmb} run.` });
      continue;
    }
    if (sc.status === 'failing') {
      const bad = sc.tests.find((t) => t.status === 'failed' || t.status === 'error');
      add({ rule: 'failing', target: sc.id, message: `${label}: ${bad.name} ${bad.status}${bad.message ? `: ${truncate(bad.message, 160)}` : ''}`, fix: 'Fix the code until it passes. Proven tests may not be weakened.' });
    } else if (sc.status === 'skipped') {
      add({ rule: 'skipped', target: sc.id, message: `${label}: every test for it is skipped.`, fix: 'Remove the skip, or request a waiver with a reason.' });
    }
    if (sc.kind !== 'characterization' && !sc.proof) {
      add({
        rule: 'not-seen-failing',
        target: sc.id,
        message: `${label}: its test has never been seen failing, so there's no proof it can catch a bug.`,
        fix: `Make it fail once for the right reason (run it before the code exists, or with the fix reverted) using ${nmb} run, then make it pass.`,
      });
    }
  }

  // ---------- protected tests: ones that have passed before ----------
  for (const t of state.current.values()) {
    const e = state.index.tests[t.key];
    if (!e || !e.everPassed) continue;
    const covered = t.ids.some((id) => state.declared.get(id)?.feature.plan === 'approved');
    if (!covered && (t.status === 'failed' || t.status === 'error')) {
      add({ rule: 'regression', target: t.key, message: `${t.key} passed before and now ${t.status}${t.message ? `: ${truncate(t.message, 160)}` : ''}`, fix: 'Fix the code that broke it. Changing the test needs the user\'s approval.' });
    }
    if (t.status === 'skipped') {
      add({ rule: 'protected-skipped', target: t.key, message: `${t.key} passed before and is now skipped.`, fix: 'Remove the skip, or ask the user to grant a waiver.' });
    }
  }
  const presentIds = new Set(state.byId.keys());
  const suiteNames = new Set(config.suites.map((s) => s.name));
  for (const e of Object.values(state.index.tests)) {
    if (!e.everPassed || state.current.has(e.key) || !suiteNames.has(e.suiteName)) continue;
    const run = state.latestFull.get(e.suiteName);
    if (!run || String(e.lastSeen) >= String(run.time)) continue;
    // A renamed or moved test keeps its scenario ID; that isn't a deletion.
    if ((e.ids || []).some((id) => presentIds.has(id))) continue;
    add({ rule: 'protected-missing', target: e.key, message: `${e.key} passed before but wasn't in the latest full run of "${e.suiteName}".`, fix: 'If it was deleted or renamed on purpose, ask the user to grant a waiver for it.' });
  }

  // ---------- independent reviews ----------
  for (const f of approved) {
    const tested = state.scenarios.filter((s) => s.feature === f.slug && s.tests.length);
    if (!tested.length) continue;
    const review = state.reviews.get(f.slug);
    if (!review) {
      add({ rule: 'no-review', target: f.slug, message: `${f.slug}: its tests haven't had an independent review.`, fix: 'Run the reviewing-tests skill (a fresh subagent), which records the verdict.' });
      continue;
    }
    if (review.verdict !== 'pass') {
      add({ rule: 'review-failed', target: f.slug, message: `${f.slug}: the last review failed${review.notes ? `: ${truncate(review.notes, 160)}` : ''}.`, fix: 'Address the review findings, then review again.' });
      continue;
    }
    const reasons = [];
    const missing = tested.map((s) => s.id).filter((id) => !(review.scenarios || []).includes(id));
    if (missing.length) reasons.push(`${missing.join(', ')} weren't reviewed`);
    const changedFilesSince = changedSinceReview(root, review);
    if (changedFilesSince.length) reasons.push(`${changedFilesSince.join(', ')} changed after the review`);
    const testFiles = [...new Set(tested.flatMap((s) => s.tests.map((t) => t.file)).filter(Boolean))];
    const unread = testFiles.filter((file) => !(file in (review.files || {})) && fs.existsSync(path.join(root, file)));
    if (unread.length) reasons.push(`${unread.join(', ')} weren't part of it`);
    if (reasons.length) add({ rule: 'stale-review', target: f.slug, message: `${f.slug}: review is out of date (${reasons.join('; ')}).`, fix: 'Review again with the reviewing-tests skill.' });
  }

  // ---------- changes to existing test files need a review ----------
  const passingReviews = [...state.reviews.values()].filter((r) => r.verdict === 'pass');
  const testGlobs = config.tests || [];
  for (const file of changed) {
    if (!matchAny(file, testGlobs) || !fs.existsSync(path.join(root, file))) continue;
    if (!existsAtBase(root, base, file)) continue;
    const h = hashFile(path.join(root, file));
    if (passingReviews.some((r) => r.files?.[file] === h)) continue;
    add({ rule: 'test-changed-unreviewed', target: file, message: `${file} existed before this change and was modified, but no passing review covers its current content.`, fix: 'Include it in the feature\'s review, which checks no assertion was weakened.' });
  }

  // ---------- changed source must be covered by an approved feature ----------
  const ignore = [...DEFAULT_SOURCE_IGNORE, ...(config.sourceIgnore || [])];
  for (const file of changed) {
    if (!matchAny(file, config.source || []) || matchAny(file, testGlobs) || matchAny(file, ignore)) continue;
    if (!fs.existsSync(path.join(root, file))) continue;
    if (approved.some((f) => matchAny(file, f.covers))) continue;
    const draft = drafts.find((f) => matchAny(file, f.covers));
    add({
      rule: 'uncovered-source',
      target: file,
      message: draft ? `${file} changed; it's covered only by the draft plan ${draft.slug}.` : `${file} changed, but no approved feature lists it under "covers".`,
      fix: draft ? 'Get the plan approved.' : 'Add it to the covers list of the feature it belongs to (or plan a new one).',
    });
  }

  // ---------- IDs nobody declared ----------
  for (const [id, tests] of state.unknownIds) {
    add({ rule: 'unknown-id', severity: 'warning', target: id, message: `${tests[0].key} mentions ${id}, which no feature declares.` });
  }

  for (const f of findings) {
    f.waiver = f.waivable ? findWaiver(state.waivers, f) : null;
    f.request = f.waivable && !f.waiver ? findRequest(state.requests, f) : null;
  }
  const blocking = findings.filter((f) => f.severity === 'error' && !f.waiver);
  return { ok: blocking.length === 0, blocking, findings, state, base, changed, drafts };
}

export function formatCheck(result, { nmb = 'nmb', verbose = false } = {}) {
  const lines = [];
  const { blocking, findings } = result;
  const waived = findings.filter((f) => f.waiver);
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');
  if (result.ok) lines.push(`no-more-bugs check: PASSED${waived.length ? ` (${plural(waived.length, 'waiver')} applied)` : ''}`);
  else lines.push(`no-more-bugs check: FAILED (${plural(blocking.length, 'problem')})`);
  for (const f of blocking) {
    lines.push(`  ✗ [${f.rule}] ${f.message}`);
    if (f.fix) lines.push(`      fix: ${f.fix}`);
    if (f.request) lines.push(`      waiver requested ("${f.request.reason}"): waiting for the user to type: nmb grant ${shellTarget(f.target)}`);
  }
  for (const f of info) lines.push(`  … ${f.message}`);
  if (warnings.length) {
    lines.push(`  ${plural(warnings.length, 'warning')}:`);
    for (const f of warnings.slice(0, verbose ? Infinity : 8)) lines.push(`    ! ${f.message}`);
    if (!verbose && warnings.length > 8) lines.push(`    … and ${warnings.length - 8} more (${nmb} check --verbose)`);
  }
  if (waived.length && verbose) for (const f of waived) lines.push(`  ~ waived [${f.rule}] ${f.target}: ${f.waiver.reason}`);
  if (!result.ok) {
    const rules = new Set(blocking.map((f) => f.rule));
    if (rules.has('stale') || rules.has('not-run')) lines.push(`Next: ${nmb} run, then ${nmb} check again.`);
    else lines.push(`Next: fix the problems above. If one truly can't be fixed, ${nmb} waive <target> --reason "..." and ask the user to grant it.`);
  }
  return lines.join('\n');
}
