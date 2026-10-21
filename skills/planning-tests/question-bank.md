# Question bank

What to consider when planning scenarios. Answer as much as you can from the code first; ask the user only about what's left, and only for the areas this change touches.

## Inputs and boundaries
- Valid ranges, lengths and formats. What happens at the edges: empty, zero, one, the maximum, one past it?
- Missing, null or malformed input. Unicode, whitespace, very long strings.
- Units, time zones, currencies, locales, rounding.

## Outcomes and errors
- What the user or caller sees on success, exactly (status code, message, return value, UI state).
- Every failure mode, and what each one returns or shows. Which errors can be retried?
- What must *not* change when something fails (no partial writes, no double charges, totals unchanged).

## Permissions
- Who may do this? What happens for an anonymous user, a different user's data, an expired session, a missing role?

## State and data
- Preconditions: what must already exist? What if it was deleted or changed meanwhile?
- Idempotency: what happens if the same request arrives twice?
- Migrations and old data: does existing data still work?

## Concurrency and timing
- Two users or two requests at once. Ordering of events. Timeouts, slow dependencies, clock changes.

## Integrations
- Which external services are involved? Which ones we own (test for real) and which we don't (mock at the boundary)?
- Their failure modes: down, slow, rate-limited, returning garbage.

## UI
- Loading, empty, error and success states. Disabled states and double clicks.
- Keyboard and screen-reader access for anything new and interactive.
- Small screens.

## Games
- Frame-rate independence, pausing, scene reloads, save and load, input on each supported device.
- What must be deterministic (seeded randomness, physics steps) so tests are repeatable.

## Non-functional (ask only when it matters)
- Performance budgets, payload sizes, memory. Security-sensitive inputs. Logging that must or must not happen.
