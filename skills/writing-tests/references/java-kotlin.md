# Java and Kotlin

## Runners and reports

Maven Surefire and Gradle both write JUnit XML on every run, so the suites only need to point at them:

| Build | Command | Reports |
|---|---|---|
| Maven | `./mvnw -q test` (`mvnw.cmd` on Windows) | `target/surefire-reports/TEST-*.xml` |
| Gradle | `./gradlew test` (`gradlew.bat` on Windows) | `build/test-results/**/*.xml` |

The suite's `command` can hold both: `{ "default": "./gradlew test", "windows": "gradlew.bat test" }`. Only reports written during the run are read, so stale XML from earlier runs is ignored.

Run one scenario while iterating: `nmb run jvm -- -Dtest='*Coupon*'` (Maven) or `nmb run jvm -- --tests '*chk004*'` (Gradle).

## Naming

Surefire reports method names, not `@DisplayName`, so put the ID in the method name:

```java
@Test
void chk004_rejectsExpiredCoupon() {
    var response = checkout.apply(expiredCoupon());
    assertThat(response.status()).isEqualTo(422);
    assertThat(response.code()).isEqualTo("COUPON_EXPIRED");
}
```

```kotlin
@Test
fun `CHK-004 rejects an expired coupon`() { /* backtick names keep the ID readable */ }
```

## By type

- **unit:** JUnit 5 with AssertJ. Inject `java.time.Clock` instead of calling `now()`.
- **integration:** Testcontainers (`@Testcontainers`, `@Container`) for the real database and broker. With Spring, `@DataJpaTest` or `@SpringBootTest` plus `@ServiceConnection`.
- **api:** `MockMvc` or `WebTestClient` for in-process HTTP, or REST Assured against a server on a random port.
- **ui:** Android: Espresso or Compose UI tests (`createComposeRule`). Web: Playwright for Java.

## Gotchas

- `@Disabled` and `assumeTrue(false)` show up as skipped and block the check.
- Mockito: mock collaborators you don't own; never `spy` on the class under test to stub its own methods.
- Android instrumented tests write reports under `build/outputs/androidTest-results/`; add that glob to the suite's `reports` if you use them.
