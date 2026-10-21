---
name: writing-tests
description: Use after a no-more-bugs test plan is approved, to write tests for its scenarios, and whenever a test fails and you're tempted to change the test. Covers unit, integration, API, UI and e2e tests in any language.
---

# Writing tests

Write tests for every scenario in the approved plan, in the project's existing framework and style, and watch each one fail before making it pass.

**Core principle:** a test you have never seen fail proves nothing.

```
EVERY NEW TEST FAILS FOR THE RIGHT REASON BEFORE IT PASSES
```

## Process

1. **Read the guide for this stack:** [typescript](references/typescript.md), [python](references/python.md), [java-kotlin](references/java-kotlin.md), [dart-flutter](references/dart-flutter.md), [unity](references/unity.md), [godot](references/godot.md), [other](references/other.md).
2. **Start each test's name with its scenario ID**, so every runner's report carries it:

   | Language | Example |
   |---|---|
   | TS / JS, Dart | `test("CHK-004 rejects an expired coupon", …)` |
   | Python, GDScript | `test_chk_004_rejects_expired_coupon` |
   | Java / Kotlin | `chk004_rejectsExpiredCoupon()` |
   | C# | `CHK004_RejectsExpiredCoupon()` |
   | Go | `t.Run("CHK-004 rejects an expired coupon", …)` |

3. **Write the tests before the implementation.** In compiled languages, add stubs that throw "not implemented" so the tests compile and fail at the assertion.
4. **Run them:** `nmb run --actor agent`. To iterate on a subset, pass the runner's filter after `--`, for example `nmb run unit -- -t CHK-004`.
5. **Check each failure.** The output must say `CHK-004 seen failing; proof recorded`, and the failure must come from the assertion, not an import error or typo. A new test that passes straight away isn't testing the new behavior: fix it, or show it failing by temporarily reverting the code.
6. **Implement** until they pass, then run every suite with a plain `nmb run`.

## Rules

- One behavior per test. Assert the scenario's "Then" exactly, including what must not change.
- Mock only what you don't own. Integration tests use real databases and queues. Never mock the thing under test.
- No sleeps or real clocks; fixed seeds; wait on conditions. Each test sets up and cleans up its own data.
- **Protected tests:** a test that has passed before, or existed before this change, may not be deleted, skipped, loosened or mocked into passing. If it's genuinely wrong, explain why and ask the user first.

## Red flags

| Thought | Reality |
|---|---|
| "It passed first time" | It may test nothing. Make it fail. |
| "I'll `.skip` it for now" | Skips block the check. |
| "Easier to mock the database" | Mocks hide query, schema and wiring bugs. |
| "The assertion is too strict" | The assertion is the spec. Change it only with the user. |

## Next

When all scenarios pass, invoke `reviewing-tests` and no other skill.
