---
name: planning-tests
description: Use before writing implementation code for a feature, bug fix or refactor in a project with a .nomorebugs/ folder, including while another skill is brainstorming or designing the change. Decides with the user which test scenarios to write.
---

# Planning tests

Agree with the user on the scenarios that prove the change works, before any code exists.

**Core principle:** infer everything you can from the code, then ask only about what you can't know.

## Process

1. **Size the change and name the flow**, so the user can override it:
   - **Feature:** the full process below.
   - **Bug fix:** a `regression` scenario that reproduces the bug, plus the edge cases it reveals.
   - **Refactor:** run `nmb run` first and confirm it passes. Plan `characterization` scenarios only where existing tests don't cover what you'll move.
   - **No behavior change** (docs, config, formatting): no plan. If the check flags a file, request a waiver saying why.
2. **Read before asking:** the code you'll change, its callers, its tests, `nmb status`, and any issue or spec the user linked.
3. **Ask about the gaps only**, in batches of up to four multiple-choice questions, recommended answer first. Use the agent's question tool if it has one. Ask more for risky code (money, auth, data loss, concurrency, integrations), little for low-risk changes. [question-bank.md](question-bank.md) lists what to consider. If the user says "use your judgment", state your main assumptions in one line and carry on.
4. **Write the plan** in the format in [feature-format.md](feature-format.md): `nmb new <feature> --covers "<globs>"` or extend an existing feature file, IDs from `nmb id <PREFIX> --count <n>`, one behavior per scenario, and `covers` listing every source file the change touches.
5. **Pick each scenario's type**: the lowest level that can catch its bug.

   | If the behavior… | Type |
   |---|---|
   | is logic: calculations, parsing, validation, state | `unit` |
   | crosses a boundary you own: database, queue, files, cache | `integration` |
   | is a contract other code relies on: HTTP, GraphQL, gRPC, events | `api` |
   | is something a user sees or does | `ui`; `e2e` for critical paths only |

   In games, `integration` usually means scene or PlayMode tests, and `ui` means simulated input on a running scene.
6. **Show the plan** as a table (ID, scenario, type, priority) with the file path, and ask the user to approve or change it.

<HARD-GATE>
Write no tests and no implementation code until the user approves the plan. Reading and exploring are fine. When they approve, run `nmb approve <feature>`. Approving a plan the user hasn't seen breaks this gate.
</HARD-GATE>

## Red flags

| Thought | Reality |
|---|---|
| "I know what they want" | Then the questions are quick. Ask the ones the code can't answer. |
| "Happy path is enough" | Errors and boundaries are where bugs live. Plan them now. |
| "Everything needs e2e" | Slow suites get skipped. Test at the lowest level that catches the bug. |

## Next

When the plan is approved, invoke `writing-tests` and no other skill.
