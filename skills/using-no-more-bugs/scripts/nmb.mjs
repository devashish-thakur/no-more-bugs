#!/usr/bin/env node
// no-more-bugs CLI. Zero dependencies; needs Node.js 18 or later.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { findRoot, isInitialized, nmbPaths, ensureDir, readText, plural, readJson, shellTarget } from './lib/util.mjs';
import { installCodex, installGitHook } from './lib/install.mjs';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './lib/config.mjs';
import { detectProject } from './lib/detect.mjs';
import { loadFeatures, createFeatureFile, nextIds, setPlan } from './lib/features.mjs';
import { runSuite, importReport, formatRunSummary } from './lib/run.mjs';
import { runCheck, formatCheck } from './lib/check.mjs';
import { buildState } from './lib/state.mjs';
import { requestWaiver, grantWaiver, revokeWaiver, loadWaivers, loadRequests, agentEnvironment } from './lib/waivers.mjs';
import { recordReview } from './lib/reviews.mjs';
import { reviewPacket } from './lib/review-prep.mjs';
import { runHook, NMB_CMD } from './lib/hooks.mjs';
import { startDashboard, detachDashboard, stopDashboard } from './lib/dashboard.mjs';

const VERSION = JSON.parse(readText(new URL('../../../package.json', import.meta.url), '{"version":"0.0.0"}')).version;

const HELP = `no-more-bugs ${VERSION}: testing guardrails for coding agents

Usage: nmb <command> [options]

Setup
  init [--force]                     Detect the project's test runners and create .nomorebugs/
Plans
  new <feature> [--prefix P] [--covers "a,b"] [--title "..."]
                                     Create a draft feature file for brainstormed scenarios
  id <PREFIX> [--count N]            Print the next free scenario IDs
  approve <feature>                  Mark a feature's plan as approved (after the user agrees)
Tests
  run [suite...] [--actor agent] [-- extra args]
                                     Run suites through their own command and record the results
  run --cmd "<command>" --report <glob> [--format junit|nunit|trx|dart-json]
                                     Run an ad-hoc command (recorded as a partial run)
  import <report...> [--suite name] [--format f] [--full]
                                     Record a report produced elsewhere (IDE test window, CI)
  check [--json] [--ci] [--verbose]  Fail if the change isn't tested enough
  status [--json]                    Summarize features, scenarios and gaps
Reviews and waivers
  review prep <feature>              Print what an independent reviewer needs
  review record <feature> --verdict pass|fail --files a,b [--scenarios A-001,A-002] [--notes "..."]
  waive <target> --reason "..." [--rule <rule>]
                                     Request a waiver (the user grants it)
  grant <target> [--reason "..."]    Grant a waiver. Only a person at a terminal can do this.
  revoke <target>                    Revoke a waiver
  waivers                            List granted waivers and pending requests
Dashboard
  dashboard [--port N] [--detach] [--no-open] [--stop]
Agents
  install codex [--user]             Link the skills into .agents/skills and add Codex hooks
  install git-hook [--force]         Block commits while the check fails
  hook <session-start|user-prompt-submit|stop|pre-tool-use>
                                     Claude Code hook handler (reads JSON on stdin)
  where                              Print the command that runs this CLI
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !BOOLEAN.has(a.slice(2))) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags, rest };
}

const BOOLEAN = new Set(['force', 'json', 'ci', 'verbose', 'detach', 'no-open', 'stop', 'full', 'partial', 'help', 'user']);

const list = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

function requireRoot() {
  const root = findRoot();
  if (!isInitialized(root)) {
    console.error(`no-more-bugs isn't set up here (looked from ${process.cwd()}). Run: nmb init`);
    process.exit(2);
  }
  return root;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { positional, flags, rest } = parseArgs(argv);
  if (!command || command === 'help' || command === '--help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (command) {
    case 'version':
    case '--version':
      console.log(VERSION);
      return 0;
    case 'where':
      console.log(NMB_CMD);
      return 0;
    case 'init':
      return init(flags);
    case 'new':
      return cmdNew(positional, flags);
    case 'id':
      return cmdId(positional, flags);
    case 'approve':
      return cmdApprove(positional);
    case 'run':
      return cmdRun(positional, flags, rest);
    case 'import':
      return cmdImport(positional, flags);
    case 'check':
      return cmdCheck(flags);
    case 'status':
      return cmdStatus(flags);
    case 'review':
      return cmdReview(positional, flags);
    case 'waive':
      return cmdWaive(positional, flags);
    case 'grant':
      return cmdGrant(positional, flags);
    case 'revoke':
      return cmdRevoke(positional);
    case 'waivers':
      return cmdWaivers(flags);
    case 'dashboard':
      return cmdDashboard(flags);
    case 'hook':
      return runHook(positional[0]);
    case 'install':
      return cmdInstall(positional, flags);
    default:
      console.error(`Unknown command "${command}". Run: nmb help`);
      return 2;
  }
}

// ---------- init ----------
function init(flags) {
  const root = findRoot();
  const paths = nmbPaths(root);
  if (isInitialized(root) && !flags.force) {
    console.log(`no-more-bugs is already set up in ${root}. Use --force to re-detect the test suites.`);
    return 0;
  }
  const detected = detectProject(root);
  const previous = isInitialized(root) ? readJson(paths.config, {}) : {};
  const config = { ...DEFAULT_CONFIG, ...previous, source: detected.source, tests: detected.tests, suites: detected.suites };
  ensureDir(paths.features);
  ensureDir(paths.reviews);
  ensureDir(paths.reports);
  saveConfig(root, config);
  for (const f of [paths.waivers, paths.proofs]) if (!fs.existsSync(f)) fs.writeFileSync(f, '');
  appendOnce(path.join(root, '.gitignore'), ['# no-more-bugs: local history, reports and session state', '.nomorebugs/local/']);
  appendOnce(path.join(root, '.gitattributes'), ['# no-more-bugs: append-only logs merge without conflicts', '.nomorebugs/proofs.jsonl merge=union', '.nomorebugs/waivers.jsonl merge=union']);

  console.log(`no-more-bugs set up in ${root}`);
  console.log(`  stacks: ${detected.stacks.join(', ') || 'none detected'}`);
  for (const s of detected.suites) console.log(`  suite "${s.name}" (${s.stack}): ${typeof s.command === 'string' ? s.command : s.command[process.platform === 'win32' ? 'windows' : 'default'] || s.command.default}`);
  console.log(`  source: ${detected.source.join(', ') || '(none; set "source" in .nomorebugs/config.json)'}`);
  for (const n of detected.notes) console.log(`  note: ${n}`);
  console.log('\nNext: check the suite commands in .nomorebugs/config.json, then run "nmb run" once to record a baseline.');
  return 0;
}

function appendOnce(file, lines) {
  const text = readText(file, '');
  const missing = lines.filter((l) => !l.startsWith('#') && !text.split(/\r?\n/).includes(l));
  if (!missing.length) return;
  const block = `${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${lines.filter((l) => l.startsWith('#') || missing.includes(l)).join('\n')}\n`;
  fs.writeFileSync(file, text + block);
}

// ---------- plans ----------
function cmdNew(positional, flags) {
  const root = requireRoot();
  const created = createFeatureFile(root, { name: positional[0], prefix: flags.prefix, covers: list(flags.covers), title: flags.title });
  console.log(`Created ${created.file} (prefix ${created.prefix}, plan: draft).`);
  console.log(`Next free IDs: ${nextIds(loadFeatures(root), created.prefix, 3).join(', ')}`);
  return 0;
}

function cmdId(positional, flags) {
  const root = requireRoot();
  const features = loadFeatures(root);
  const arg = positional[0];
  if (!arg) {
    console.error('Usage: nmb id <PREFIX or feature> [--count N]');
    return 2;
  }
  const feature = features.find((f) => f.slug === arg || f.prefix === arg.toUpperCase());
  const prefix = feature?.prefix || arg.toUpperCase();
  console.log(nextIds(features, prefix, Number(flags.count) || 1).join('\n'));
  return 0;
}

function cmdApprove(positional) {
  const root = requireRoot();
  const slug = positional[0];
  if (!slug) {
    console.error('Usage: nmb approve <feature>');
    return 2;
  }
  setPlan(root, slug, 'approved');
  const f = loadFeatures(root).find((x) => x.slug === slug.replace(/\.md$/, ''));
  if (f?.errors.length) {
    console.error(`Approved, but the feature file has problems:\n  ${f.errors.join('\n  ')}`);
    return 1;
  }
  console.log(`Plan approved: .nomorebugs/features/${slug.replace(/\.md$/, '')}.md (${plural(f?.scenarios.length || 0, 'scenario')}).`);
  return 0;
}

// ---------- run ----------
async function cmdRun(positional, flags, rest) {
  const root = requireRoot();
  const config = loadConfig(root);
  let suites;
  if (flags.cmd) {
    if (!flags.report) {
      console.error('An ad-hoc run needs --report <path or glob> so its results can be read.');
      return 2;
    }
    suites = [{ name: flags.suite || 'adhoc', command: flags.cmd, reports: list(flags.report), format: flags.format || 'auto' }];
  } else if (positional.length) {
    suites = positional.map((name) => config.suites.find((s) => s.name === name) || name);
    const unknown = suites.filter((s) => typeof s === 'string');
    if (unknown.length) {
      console.error(`Unknown suite: ${unknown.join(', ')}. Configured: ${config.suites.map((s) => s.name).join(', ') || 'none'}`);
      return 2;
    }
  } else suites = config.suites;
  if (!suites.length) {
    console.error('No test suites are configured. Run "nmb init --force" or add one to .nomorebugs/config.json.');
    return 2;
  }
  const partial = flags.partial === true || rest.length > 0 || (!!flags.cmd && !flags.full);
  let exit = 0;
  for (const suite of suites) {
    const summary = await runSuite(root, suite, { actor: flags.actor, extraArgs: rest, partial });
    console.error(formatRunSummary(summary));
    const r = summary.run;
    if (r.error) exit = Math.max(exit, 3);
    else if (r.totals.failed + r.totals.error > 0 || r.exitCode !== 0) exit = Math.max(exit, 1);
  }
  return exit;
}

function cmdImport(positional, flags) {
  const root = requireRoot();
  if (!positional.length) {
    console.error('Usage: nmb import <report file...> [--suite name] [--format junit|nunit|trx|dart-json] [--full]');
    return 2;
  }
  const summary = importReport(root, positional, { suite: flags.suite === true ? null : flags.suite, format: flags.format === true ? null : flags.format, actor: flags.actor, full: !!flags.full });
  console.error(formatRunSummary(summary));
  const r = summary.run;
  return r.error ? 3 : r.totals.failed + r.totals.error > 0 ? 1 : 0;
}

// ---------- check / status ----------
function cmdCheck(flags) {
  const root = requireRoot();
  const result = runCheck(root, { ci: !!flags.ci, nmb: 'nmb' });
  if (flags.json) {
    const { state, ...rest } = result;
    console.log(JSON.stringify({ ...rest, drafts: result.drafts.map((d) => d.slug) }, null, 2));
  } else console.log(formatCheck(result, { verbose: !!flags.verbose }));
  return result.ok ? 0 : 1;
}

function cmdStatus(flags) {
  const root = requireRoot();
  const state = buildState(root);
  if (flags.json) {
    console.log(JSON.stringify({ features: state.features.map((f) => ({ slug: f.slug, plan: f.plan, prefix: f.prefix })), scenarios: state.scenarios }, null, 2));
    return 0;
  }
  const lines = [];
  const counts = { planned: 0, passing: 0, failing: 0, skipped: 0 };
  for (const s of state.scenarios) counts[s.status]++;
  lines.push(`${plural(state.features.length, 'feature')}, ${plural(state.scenarios.length, 'scenario')}: ${counts.passing} passing, ${counts.failing} failing, ${counts.planned} without a test, ${counts.skipped} skipped`);
  for (const f of state.features) {
    lines.push(`\n${f.slug} [${f.prefix}] plan: ${f.plan}`);
    for (const s of state.scenarios.filter((x) => x.feature === f.slug)) {
      const mark = { planned: '○', passing: '✓', failing: '✗', skipped: '–' }[s.status];
      const extra = [s.flaky ? 'flaky' : '', s.proof ? 'seen failing' : s.tests.length && s.kind !== 'characterization' ? 'never seen failing' : ''].filter(Boolean).join(', ');
      lines.push(`  ${mark} ${s.id} ${s.title} (${s.type}, ${s.priority})${extra ? ` · ${extra}` : ''}`);
    }
  }
  const untracked = [...state.current.values()].filter((t) => !t.ids.length).length;
  lines.push(`\n${plural(state.current.size, 'test')} in the latest runs, ${untracked} without a scenario ID.`);
  console.log(lines.join('\n'));
  return 0;
}

// ---------- reviews ----------
function cmdReview(positional, flags) {
  const root = requireRoot();
  const [sub, feature] = positional;
  if (sub === 'prep' && feature) {
    console.log(reviewPacket(root, feature));
    return 0;
  }
  if (sub === 'record' && feature) {
    const state = buildState(root);
    const f = state.features.find((x) => x.slug === feature);
    if (!f) {
      console.error(`No feature "${feature}". Features: ${state.features.map((x) => x.slug).join(', ')}`);
      return 2;
    }
    const tested = state.scenarios.filter((s) => s.feature === feature && s.tests.length);
    const scenarios = list(flags.scenarios).length ? list(flags.scenarios) : tested.map((s) => s.id);
    const files = list(flags.files).length ? list(flags.files) : [...new Set(tested.flatMap((s) => s.tests.map((t) => t.file)).filter(Boolean))];
    if (!files.length) {
      console.error('Pass the test files the review read: --files path/a.test.ts,path/b.test.ts');
      return 2;
    }
    const review = recordReview(root, {
      feature,
      verdict: flags.verdict,
      scenarios,
      files,
      notes: flags.notes === true ? '' : flags.notes,
      findings: list(flags.findings),
      reviewer: flags.reviewer === true ? undefined : flags.reviewer,
    });
    console.log(`Review recorded: ${feature} ${review.verdict} (${plural(review.scenarios.length, 'scenario')}, ${plural(Object.keys(review.files).length, 'file')}).`);
    return review.verdict === 'pass' ? 0 : 1;
  }
  console.error('Usage: nmb review prep <feature> | nmb review record <feature> --verdict pass|fail --files a,b');
  return 2;
}

// ---------- waivers ----------
function cmdWaive(positional, flags) {
  const root = requireRoot();
  const req = requestWaiver(root, { target: positional[0], rule: flags.rule === true ? null : flags.rule, reason: flags.reason === true ? '' : flags.reason });
  console.log(`Waiver requested for ${req.target}${req.rule ? ` (${req.rule})` : ''}: "${req.reason}".`);
  console.log(`Ask the user to grant it. In Claude Code they type this as a message:  nmb grant ${shellTarget(req.target)}`);
  console.log(`In a terminal they run:  nmb grant ${shellTarget(req.target)}`);
  return 0;
}

async function cmdGrant(positional, flags) {
  const root = requireRoot();
  const target = positional[0];
  if (!target) {
    console.error('Usage: nmb grant <target> [--reason "..."]');
    return 2;
  }
  const agent = agentEnvironment();
  if (agent || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `Refusing: waivers must be granted by a person, and this looks like ${agent ? `an agent (${agent} is set)` : 'a non-interactive shell'}.\n` +
        `In Claude Code or Codex, type "nmb grant ${shellTarget(target)}" as a message. Otherwise run this command in your own terminal.`,
    );
    return 1;
  }
  const pending = loadRequests(root).filter((r) => r.target === target);
  if (pending.length) for (const p of pending) console.log(`Requested: ${p.reason}`);
  const answer = await ask(`Type ${target} to grant the waiver: `);
  if (answer.trim() !== target) {
    console.log('Not granted.');
    return 1;
  }
  const grant = grantWaiver(root, { target, reason: flags.reason === true ? '' : flags.reason, via: 'terminal' });
  console.log(`Granted: ${grant.target} ("${grant.reason}"). Recorded in .nomorebugs/waivers.jsonl; commit it with the change.`);
  return 0;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

function cmdRevoke(positional) {
  const root = requireRoot();
  if (!positional[0]) {
    console.error('Usage: nmb revoke <target>');
    return 2;
  }
  revokeWaiver(root, { target: positional[0], via: agentEnvironment() ? 'agent' : 'terminal' });
  console.log(`Revoked the waiver for ${positional[0]}.`);
  return 0;
}

function cmdWaivers(flags) {
  const root = requireRoot();
  const waivers = loadWaivers(root);
  const requests = loadRequests(root);
  if (flags.json) {
    console.log(JSON.stringify({ waivers, requests }, null, 2));
    return 0;
  }
  console.log(waivers.length ? 'Granted:' : 'No granted waivers.');
  for (const w of waivers) console.log(`  ${w.target}${w.rules ? ` [${w.rules.join(', ')}]` : ''}: ${w.reason} (${w.via}, ${w.at})`);
  console.log(requests.length ? 'Waiting for the user:' : 'No pending requests.');
  for (const r of requests) console.log(`  ${r.target}${r.rule ? ` [${r.rule}]` : ''}: ${r.reason}`);
  return 0;
}

// ---------- install ----------
function cmdInstall(positional, flags) {
  const what = positional[0];
  if (what === 'codex') {
    const root = findRoot();
    const r = installCodex(root, { user: !!flags.user });
    console.log(`Skills in ${r.skillsTarget}: ${r.skills.join(', ')}`);
    console.log(`Hooks in ${r.hooksFile}: ${r.events.join(', ')}`);
    console.log('Restart Codex, then review and trust the new hooks with /hooks.');
    if (!isInitialized(root) && !flags.user) console.log('This project has no .nomorebugs/ yet: run nmb init.');
    return 0;
  }
  if (what === 'git-hook') {
    const file = installGitHook(requireRoot(), { force: !!flags.force });
    console.log(`Installed ${file}: commits are blocked while nmb check fails (git commit --no-verify skips it).`);
    return 0;
  }
  console.error('Usage: nmb install codex [--user] | nmb install git-hook [--force]');
  return 2;
}

// ---------- dashboard ----------
async function cmdDashboard(flags) {
  const root = requireRoot();
  if (flags.stop) return stopDashboard(root);
  const port = Number(flags.port) || 4477;
  if (flags.detach) return detachDashboard(root, { port, open: !flags['no-open'] });
  await startDashboard(root, { port, open: !flags['no-open'] });
  return new Promise(() => {}); // keep serving until Ctrl+C
}

main().then(
  (code) => {
    if (typeof code === 'number') process.exitCode = code;
  },
  (err) => {
    console.error(`nmb: ${err.message}`);
    if (process.env.NMB_DEBUG) console.error(err.stack);
    process.exitCode = 2;
  },
);
