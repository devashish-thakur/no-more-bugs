# no-more-bugs

Testing guardrails for coding agents. Before an agent writes code, it plans the test scenarios with you. Then it writes them as ordinary tests in your project's own framework, proves each one fails before it passes, gets them reviewed by an agent that didn't write them, and records every run. A local dashboard shows every test, the scenario it covers, and its history.

It works with Claude Code and Codex, which get the full experience through hooks, and with any other agent that reads [Agent Skills](https://agentskills.io) or `AGENTS.md`. It also works with any test runner that can write a JUnit XML, NUnit XML, TRX or Dart JSON report, which covers TypeScript/JavaScript, Python, Java/Kotlin, Dart/Flutter, Unity, Godot, .NET, Go, Ruby, PHP, Rust and more.

## How it works

```
plan with you ──► approve ──► tests fail (proof recorded) ──► code ──► tests pass ──► independent review ──► nmb check ──► done
```

- **Plans** live in `.nomorebugs/features/<feature>.md`: one section per scenario with an ID (`CHK-004`), a type (unit, integration, api, ui, e2e), a priority and Given/When/Then.
- **Tests** are normal tests. The only convention is that a test's name starts with its scenario ID, in whatever form the language allows: `CHK-004 …`, `test_chk_004_…`, `chk004_…`.
- **Runs** go through `nmb run`, which calls your project's own test command, reads the report it writes, and records the result.
- **The check** (`nmb check`) fails when an approved scenario has no test, a test fails, a new test was never seen failing, the review is missing or out of date, a test that used to pass was deleted or skipped, results are stale, or changed source files aren't covered by any plan.
- **Hooks** stop the agent from finishing a turn that changed code while the check fails (up to three attempts, then you're told). They also ask you before the agent weakens an assertion in an existing test.
- **Waivers** let you accept a gap on purpose. The agent can only request one; you grant it.

## Install

You need Node.js 18 or later and git.

### Claude Code

In Claude Code, add this repo as a plugin marketplace and install the plugin:

```
/plugin marketplace add devashish-thakur/no-more-bugs
/plugin install no-more-bugs@no-more-bugs
```

To try a local checkout instead, pass its folder path to `/plugin marketplace add`.

This installs the five skills, the hooks and two slash commands: `/no-more-bugs:dashboard` and `/no-more-bugs:check`.

### Codex

From your project folder:

```bash
node <path-to-this-repo>/skills/using-no-more-bugs/scripts/nmb.mjs install codex
```

This links the skills into `.agents/skills/` and adds the hooks to `.codex/hooks.json`. Codex asks you to trust new hooks the first time (`/hooks`). Codex has no "ask" decision for tool calls, so instead of asking you before an assertion is weakened, the hook warns the agent; the independent review still catches it.

### Any other agent

Copy or link the folders in `skills/` to wherever your agent reads skills, then add the snippet in [integrations/AGENTS.md](integrations/AGENTS.md) to your project's `AGENTS.md`. Install the pre-commit hook so the check still runs without agent hooks:

```bash
nmb install git-hook
```

### The CLI

The CLI has no dependencies. Run it as `node skills/using-no-more-bugs/scripts/nmb.mjs`, or `npm link` this repo to get `nmb` on your PATH. The examples below say `nmb`.

## Quick start

```bash
nmb init                      # detect test runners, create .nomorebugs/
nmb run                       # record a baseline
nmb new checkout-coupons --covers "src/checkout/**"
nmb id CHC --count 3          # next free scenario IDs
nmb approve checkout-coupons  # after you've agreed on the plan
nmb run                       # new tests must fail first...
nmb run                       # ...then pass
nmb review prep checkout-coupons
nmb check
nmb dashboard
```

In practice you don't type most of these; the agent does, following the skills. You answer its questions, approve the plan, and grant or refuse waivers.

## Commands

| Command | What it does |
|---|---|
| `nmb init [--force]` | Detect stacks and test runners; write `.nomorebugs/config.json`, `.gitignore` and `.gitattributes` entries |
| `nmb new <feature> [--prefix P] [--covers "a,b"]` | Create a draft feature file |
| `nmb id <PREFIX> [--count N]` | Print the next free scenario IDs |
| `nmb approve <feature>` | Mark a plan approved |
| `nmb run [suite…] [--actor agent] [-- runner args]` | Run suites and record the results. Extra args make it a partial run |
| `nmb run --cmd "<command>" --report <glob>` | Run an ad-hoc command |
| `nmb import <report…> [--suite s] [--full]` | Record a report produced elsewhere, such as an IDE's test window or CI |
| `nmb check [--json] [--ci] [--verbose]` | Exit 1 if the change isn't tested enough |
| `nmb status` | Features, scenarios and their state |
| `nmb review prep <feature>` / `nmb review record <feature> --verdict pass\|fail --files …` | Independent review packet and verdict |
| `nmb waive <target> --reason "…"` | Request a waiver |
| `nmb grant <target>` | Grant one (a person at a real terminal only; in Claude Code or Codex, type `nmb grant <target>` as a message) |
| `nmb revoke <target>`, `nmb waivers` | Revoke, list |
| `nmb dashboard [--detach] [--port N] [--stop]` | The local dashboard |
| `nmb install codex\|git-hook` | Set up Codex hooks and skills, or a git pre-commit hook |

## Files

```
.nomorebugs/
├── config.json      test suites (command, report paths, format), source and test globs   committed
├── features/        one plan per feature                                                committed
├── reviews/         independent review verdicts, with hashes of the files reviewed      committed
├── proofs.jsonl     the first failure of each scenario ID: proof the test can fail      committed
├── waivers.jsonl    granted waivers and their reasons                                   committed
└── local/           run history, raw reports, session state, pending waiver requests    gitignored
```

`proofs.jsonl` and `waivers.jsonl` are append-only and merge with git's union driver, so two branches never conflict on them.

## The config

```json
{
  "version": 1,
  "base": "auto",
  "source": ["src/**"],
  "sourceIgnore": ["src/generated/**"],
  "tests": ["**/*.test.*", "tests/**"],
  "suites": [
    {
      "name": "unit",
      "stack": "typescript",
      "command": "npx vitest run --reporter=default --reporter=junit --outputFile.junit=.nomorebugs/local/reports/vitest.xml",
      "reports": [".nomorebugs/local/reports/vitest.xml"],
      "format": "junit",
      "env": {},
      "paths": []
    }
  ],
  "stop": { "maxBlocks": 3 }
}
```

- `base`: where "the change" starts. `auto` uses the merge-base with `origin/HEAD`, `main` or `master`.
- `command` can be `{ "default": "./gradlew test", "windows": "gradlew.bat test" }`.
- `paths` limits which files make a suite's results stale, which helps when a slow suite (Unity, e2e) only depends on part of the repo.

## CI

```yaml
# .github/workflows/tests.yml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }      # the check needs the base branch
- run: node path/to/nmb.mjs run --actor ci
- run: node path/to/nmb.mjs check --ci
```

`--ci` skips the rules that depend on local history (staleness, deleted tests). Proofs, reviews and waivers are committed, so they're checked in CI too.

## Dashboard

`nmb dashboard` serves a read-only page at `http://127.0.0.1:4477/` that refreshes when a run is recorded:

- **Overview:** the check result and what to do about each problem, scenario counts, the pass rate per run, features, and recent runs.
- **Scenarios:** every plan, with each scenario's status, type, priority and proof; click one for its tests and full history.
- **Tests:** every test in the latest runs, searchable and filterable (failing, flaky, skipped, without an ID), with a strip of its recent results.
- **Runs, Flaky, Waivers.**

A test is **flaky** when it both passed and failed on identical code (same content fingerprint), so flakiness is never confused with you changing the code.

## Development

```bash
npm test
```

The tests use only Node's built-in test runner. `test/workflow.test.mjs` drives the real CLI through a full feature cycle in a temporary git repository.

## License

MIT
