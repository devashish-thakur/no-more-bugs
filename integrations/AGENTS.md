<!-- Add this section to your project's AGENTS.md (or CLAUDE.md, GEMINI.md, .cursorrules). -->

## Testing: no-more-bugs

This project uses no-more-bugs. Every code change gets tests that are planned with the user, seen failing, independently reviewed and recorded.

- `nmb` means `node <path to no-more-bugs>/skills/using-no-more-bugs/scripts/nmb.mjs` (or `npx no-more-bugs`).
- Before writing code for a feature, bug fix or refactor, follow the `planning-tests` skill: ask about the gaps, write the scenarios to `.nomorebugs/features/`, and get the user's approval.
- Then follow `writing-tests` (each test's name starts with its scenario ID, and every new test must fail before it passes), `reviewing-tests` (an independent review), and `verifying-tests`.
- Never call a change done until `nmb check` passes in the same turn.
- Never delete, skip or loosen a test that has passed before without the user's agreement.
- Never grant waivers or edit `.nomorebugs/waivers.jsonl`. Request one with `nmb waive <target> --reason "..."` and ask the user.
