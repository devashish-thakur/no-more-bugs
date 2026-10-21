# TypeScript and JavaScript

## Runners and reports

| Runner | Suite command in `.nomorebugs/config.json` | Report |
|---|---|---|
| Vitest | `npx vitest run --reporter=default --reporter=junit --outputFile.junit=.nomorebugs/local/reports/vitest.xml` | built in |
| Jest | `npx jest --ci --reporters=default --reporters=jest-junit`, with env `JEST_JUNIT_OUTPUT_DIR=.nomorebugs/local/reports`, `JEST_JUNIT_OUTPUT_NAME=jest.xml`, `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true` | needs `jest-junit` |
| Playwright | `npx playwright test --reporter=line,junit`, with env `PLAYWRIGHT_JUNIT_OUTPUT_FILE=.nomorebugs/local/reports/playwright.xml` | built in |
| node:test | `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=.nomorebugs/local/reports/node.xml` | built in |

`nmb init` writes these for you. Put env vars in the suite's `env` object, not in the command, so it works on Windows too.

Run one scenario while iterating: `nmb run unit -- -t CHK-004` (Vitest and Jest), `nmb run e2e -- -g CHK-004` (Playwright).

## Naming

```ts
describe('checkout coupons', () => {
  test('CHK-004 rejects an expired coupon', async () => { /* … */ });
});
```

## By type

- **unit:** pure functions and modules. Inject the clock (`vi.useFakeTimers()` / `jest.useFakeTimers()`), don't read `Date.now()` directly.
- **integration:** real database through the project's setup (a test database, Testcontainers for Node, or `docker compose`). Reset state per test with transactions or truncation.
- **api:** call the HTTP handler in-process (Supertest against the app, `fetch` against a server on a random port, or the framework's test client). Assert status, body shape and headers.
- **ui:** component tests with Testing Library: query by role and label, not by CSS class. Assert what the user sees.
- **e2e:** Playwright. Use `getByRole`, auto-waiting assertions (`await expect(locator).toBeVisible()`), never `waitForTimeout`. Seed data through the API, not the UI.

## Gotchas

- `test.only` and `describe.only` silently drop other tests. The check catches skips; review catches `.only`.
- Snapshot tests: an updated snapshot is a changed assertion. Review the diff, don't rubber-stamp `-u`.
- With MSW or nock, mock only third-party hosts; let requests to your own API hit the real handler.
- Async: always `await` the assertion (`await expect(...).rejects.toThrow()`), or the test can pass before it fails.
