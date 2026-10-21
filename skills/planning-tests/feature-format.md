# Feature file format

One file per feature in `.nomorebugs/features/<feature>.md`. `nmb new <feature>` creates it.

```markdown
---
feature: checkout-coupons
prefix: CHK
plan: draft
covers: [src/checkout/coupons.ts, src/checkout/rules/**]
---
# Checkout coupons

## CHK-004 · Expired coupon is rejected
type: api · priority: high
Given a coupon that expired yesterday
When  POST /checkout is called with it
Then  the response is 422 COUPON_EXPIRED and the cart total is unchanged

## CHK-005 · A coupon can't be applied twice
type: unit · priority: medium · kind: regression
Given a cart that already has SAVE10
When  SAVE10 is applied again
Then  it fails with "already applied"
```

## Frontmatter

| Key | Meaning |
|---|---|
| `feature` | The feature's name; matches the file name |
| `prefix` | 2–10 letters or digits for this feature's scenario IDs. Avoid common words like API or GET |
| `plan` | `draft` until the user approves, then `approved` (`nmb approve <feature>`) |
| `covers` | Source files and globs this feature is responsible for. Changed files outside every approved feature's `covers` fail the check |

## Scenarios

- Heading: `## <ID> · <short description>`. Get IDs from `nmb id <PREFIX>`; never reuse one.
- First line under it: `type: … · priority: …`, optionally `· kind: …`.
  - type: `unit`, `integration`, `api`, `ui`, `e2e`
  - priority: `critical`, `high`, `medium` (default), `low`
  - kind: `behavior` (default), `regression` (reproduces a bug), `characterization` (locks in current behavior before a refactor; exempt from seen-failing)
- Then Given / When / Then, specific enough that a reviewer can tell whether a test checks it.
- Other `##` sections (notes, out of scope) are allowed and ignored. HTML comments are ignored.

Never write test status in this file. Status comes from the history.
