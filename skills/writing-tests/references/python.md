# Python

## Runner and report

pytest writes JUnit XML itself. `nmb init` sets up:

```
python -m pytest --junitxml=.nomorebugs/local/reports/pytest.xml -o junit_family=xunit1
```

`junit_family=xunit1` adds each test's file path to the report, which the dashboard and reviews use. With uv or Poetry the command starts with `uv run pytest` or `poetry run pytest`; with a `.venv` it uses that interpreter.

Run one scenario while iterating: `nmb run unit -- -k chk_004`.

## Naming

```python
def test_chk_004_rejects_expired_coupon(client, expired_coupon):
    response = client.post("/checkout", json={"coupon": expired_coupon.code})
    assert response.status_code == 422
    assert response.json()["code"] == "COUPON_EXPIRED"
```

A class works too: IDs in `class TestChk004:` apply to every test in it.

## By type

- **unit:** plain functions; parametrize boundaries with `@pytest.mark.parametrize`. Freeze time with `freezegun` or `time-machine`, or inject a clock.
- **integration:** a real database. Use the project's fixtures, `pytest-postgresql`, or Testcontainers. Wrap each test in a transaction that rolls back.
- **api:** the framework's test client (FastAPI/Starlette `TestClient` or `httpx.AsyncClient` with `ASGITransport`, Django's `Client`, Flask's `app.test_client()`).
- **ui / e2e:** Playwright for Python (`pytest-playwright`), using role-based locators.

## Gotchas

- `assert x` on a value that's always truthy (a non-empty dict, a Mock) proves nothing; assert the exact value.
- `@pytest.mark.skip`, `xfail` and `pytest.skip()` block the check for scenarios; don't use them to hide failures.
- `mock.patch` the third-party client, never the function under test. Use `autospec=True` so a mock can't accept calls the real thing would reject.
- Async tests need `pytest-asyncio` (or anyio) markers, or they're collected but never awaited.
