---
name: reviewing-tests
description: Use when the tests for a no-more-bugs feature pass, when the check reports no-review, stale-review or test-changed-unreviewed, or after any change to an existing test. Gets an independent verdict on whether the tests really cover the scenarios.
---

# Reviewing tests

## Overview

Someone who didn't write the tests checks them against the agreed scenarios. You wrote them, so you can't be that reviewer.

**Core principle:** the reviewer gets the scenarios and the tests, never your reasoning about them.

## Process

1. **Dispatch a fresh subagent** with the prompt in [reviewer-prompt.md](reviewer-prompt.md). Fill in the feature name and the `nmb` command. Give it nothing else from this conversation.
2. **No subagents in this agent?** Run the same prompt in a new headless session (for example `claude -p` or `codex exec`). If that isn't possible either, review it yourself with the prompt, and record it with `--reviewer self` so the dashboard shows it was a self-review.
3. **Read the verdict.** The reviewer records it with `nmb review record`.
   - **pass:** go on.
   - **fail:** fix each finding (in the code or in your new tests; protected tests still need the user's say-so), run `nmb run` again, and dispatch a *new* reviewer. After three failed rounds, stop and show the user the findings.
4. **Any change to a reviewed test file** makes the review stale. Review again after it.

## Red flags

| Thought | Reality |
|---|---|
| "I'll summarize the feature for the reviewer" | Your summary carries your blind spots. It reads the feature file itself. |
| "The finding is nitpicky, I'll record a pass" | The reviewer records the verdict, not you. |
| "Same reviewer, one more pass" | A reviewer that has seen your fixes is no longer independent. Start a new one. |

## Next

When the review passes, invoke `verifying-tests` and no other skill.
