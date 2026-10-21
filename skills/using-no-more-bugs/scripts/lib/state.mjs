// Build one picture of the project from the files on disk: features, the latest results of every
// suite, history aggregates, proofs, reviews and waivers. Used by check, status and the dashboard.
import { loadConfig } from './config.mjs';
import { loadFeatures, crossFeatureErrors } from './features.mjs';
import { loadRuns, loadIndex, loadProofs } from './history.mjs';
import { loadWaivers, loadRequests } from './waivers.mjs';
import { loadReviews } from './reviews.mjs';
import { extractIds } from './ids.mjs';

export function declaredPrefixes(features) {
  return new Set(features.map((f) => f.prefix).filter(Boolean));
}

export function idsFor(test, prefixes) {
  // IDs can sit in the test name or in its enclosing class/group (e.g. a pytest class TestChk004).
  const suite = test.suite && test.suite !== test.file ? test.suite : '';
  return extractIds(`${test.name} ${suite}`, prefixes);
}

export function buildState(root, { runLimit = Infinity } = {}) {
  const config = loadConfig(root);
  const features = loadFeatures(root);
  const prefixes = declaredPrefixes(features);
  const declared = new Map();
  for (const f of features) for (const s of f.scenarios) declared.set(s.id, { feature: f, scenario: s });

  const runs = loadRuns(root, { limit: runLimit });
  const index = loadIndex(root);
  const proofs = loadProofs(root);
  const waivers = loadWaivers(root);
  const requests = loadRequests(root);
  const reviews = loadReviews(root);

  // Latest full (not filtered) run of each configured suite.
  const latestFull = new Map();
  const latestAny = new Map();
  for (const run of runs) {
    latestAny.set(run.suite, run);
    if (!run.partial && !run.error) latestFull.set(run.suite, run);
  }

  // Current results: every test from each suite's latest full run.
  const current = new Map();
  for (const [suite, run] of latestFull) {
    for (const t of run.tests) {
      current.set(t.key, { ...t, suiteName: suite, runId: run.id, runTime: run.time, ids: idsFor(t, prefixes) });
    }
  }

  const byId = new Map();
  const unknownIds = new Map();
  for (const t of current.values()) {
    for (const id of t.ids) {
      if (declared.has(id)) {
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(t);
      } else {
        if (!unknownIds.has(id)) unknownIds.set(id, []);
        unknownIds.get(id).push(t);
      }
    }
  }

  const scenarios = [];
  for (const f of features) {
    for (const s of f.scenarios) {
      const tests = byId.get(s.id) || [];
      const entries = tests.map((t) => index.tests[t.key]).filter(Boolean);
      let status;
      if (!tests.length) status = 'planned';
      else if (tests.some((t) => t.status === 'failed' || t.status === 'error')) status = 'failing';
      else if (tests.every((t) => t.status === 'skipped')) status = 'skipped';
      else status = 'passing';
      const flaky = entries.some((e) => e.flaky);
      scenarios.push({
        id: s.id,
        title: s.title,
        type: s.type,
        priority: s.priority,
        kind: s.kind,
        body: s.body,
        feature: f.slug,
        plan: f.plan,
        status,
        flaky,
        proof: proofs.get(s.id) || null,
        tests: tests.map((t) => ({ key: t.key, name: t.name, file: t.file, status: t.status, message: t.message, durationMs: t.durationMs, suiteName: t.suiteName })),
      });
    }
  }

  return {
    root,
    config,
    features,
    featureErrors: crossFeatureErrors(features),
    prefixes,
    declared,
    runs,
    index,
    proofs,
    waivers,
    requests,
    reviews,
    latestFull,
    latestAny,
    current,
    byId,
    unknownIds,
    scenarios,
  };
}
