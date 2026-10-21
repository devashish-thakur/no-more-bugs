---
name: verifying-tests
description: Use before saying any code change is done, fixed, working or ready in a project with a .nomorebugs/ folder, and when a no-more-bugs Stop hook or nmb check reports problems.
---

# Verifying tests

## Overview

Prove the change is tested, with fresh evidence from this turn, before you report it.

**Core principle:** "should pass" isn't evidence. The check's output is.

## Process

1. Run every suite on the current code: `nmb run --actor agent`.
2. Run `nmb check` and read all of it.
3. Fix what it reports:

   | Rule | What to do |
   |---|---|
   | `stale`, `not-run` | `nmb run` |
   | `no-test` | Write the test for that scenario (`writing-tests`) |
   | `failing`, `regression` | Fix the code. Protected tests stay as they are unless the user agrees |
   | `not-seen-failing` | Make the test fail once for the right reason, then pass |
   | `no-review`, `stale-review`, `review-failed`, `test-changed-unreviewed` | `reviewing-tests` |
   | `uncovered-source` | Add the file to the right feature's `covers`, or plan a feature for it |
   | `protected-missing`, `protected-skipped` | Restore the test, or ask the user for a waiver |
   | `feature-invalid`, `duplicate-id` | Fix the feature file |

4. **Waivers.** When a problem truly can't or shouldn't be fixed, request a waiver: `nmb waive <target> --reason "<why>"`. Then stop and ask the user. They grant it by typing `nmb grant <target>` as a message (Claude Code) or by running that command in their own terminal. Never run `nmb grant` yourself and never edit `.nomorebugs/waivers.jsonl`.
5. Repeat until `nmb check` prints `PASSED`.
6. **Report:** what was tested (the scenario IDs), the check result, and anything waived. Mention that `nmb dashboard --detach` shows the history.

## Red flags

| Thought | Reality |
|---|---|
| "The tests passed earlier" | Earlier isn't now. Run them again. |
| "It's only failing because of a flaky test" | Flaky tests are bugs too. Name it, and show the dashboard's evidence. |
| "I'll report done and mention the failure" | Not done. Fix it or get a waiver. |

## Next

Done. Report to the user.
