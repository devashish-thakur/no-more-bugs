# Dart and Flutter

## Runner and report

Both write a JSON event stream that no-more-bugs reads directly (format `dart-json`):

```
dart test --file-reporter json:.nomorebugs/local/reports/dart.json
flutter test --file-reporter json:.nomorebugs/local/reports/dart.json
```

`--file-reporter` writes the file in addition to the normal console output. Avoid `print` inside tests: printed lines land in the JSON file (non-JSON lines are skipped, but they're noise).

Run one scenario while iterating: `nmb run flutter -- --plain-name "CHK-004"`.

## Naming

Group names are part of the reported name, so the ID can sit on the test or on its group:

```dart
group('checkout coupons', () {
  test('CHK-004 rejects an expired coupon', () {
    expect(() => cart.apply(expiredCoupon), throwsA(isA<CouponExpired>()));
  });
});
```

## By type

- **unit:** `package:test`. Inject a `Clock` (package `clock`) instead of `DateTime.now()`.
- **integration:** real local services where you can (a test database, an emulator such as the Firebase Local Emulator Suite). Mock only third-party APIs, with `mocktail` or `http`'s `MockClient`.
- **ui:** widget tests with `testWidgets`, `find.byType`/`find.text`/`find.bySemanticsLabel`, and `tester.pumpAndSettle()`. Golden tests for visual output; an updated golden is a changed assertion.
- **e2e:** `integration_test` on a device or emulator (`flutter test integration_test -d <device>`). Add it as a separate suite, since it needs a device.

## Gotchas

- `skip: true` on a test or group is reported as skipped and blocks the check.
- Forgetting `await tester.pump()` lets a widget test pass before the UI updates.
- Timers left running fail widget tests at teardown; cancel them or use `fakeAsync`.
