---
name: using-no-more-bugs
description: Use at the start of every session in a project that has a .nomorebugs/ folder, and before writing or changing code there (features, bug fixes, refactors). Also use when the user asks about tests, test plans, coverage, flaky tests, the test dashboard, or no-more-bugs.
---

# Using no-more-bugs

Every code change here gets tests that are planned with the user, seen failing, independently reviewed and recorded.

`nmb` means: `{{NMB}}`
(Outside Claude Code and Codex hooks: `node <skills folder>/using-no-more-bugs/scripts/nmb.mjs`.)

```
NO CODE CHANGE IS DONE UNTIL `nmb check` PASSES
```

| When | Load |
|---|---|
| Before writing code for a feature, bug fix or refactor | `planning-tests` |
| The user approved the plan | `writing-tests` |
| The new tests pass | `reviewing-tests` |
| Before saying the work is done | `verifying-tests` |
| The user wants the dashboard | run `nmb dashboard --detach`, give them the URL |

If another skill is already brainstorming or planning the change, keep it, and add the `planning-tests` questions and scenarios to it rather than running a second interview.

Say "Using no-more-bugs to <purpose>" when you start.

| Thought | Reality |
|---|---|
| "Too small to plan" | Small changes get a short plan, not none. |
| "I'll add tests after" | Tests written after the code check what it does, not what it should. |
| "I'll loosen this test" | Tests that passed before are protected. Fix the code or ask. |

Only the user grants waivers. Their explicit instructions beat these skills; record a skipped step as a waiver request that quotes them. If `.nomorebugs/config.json` is missing, ask once whether to run `nmb init`.
