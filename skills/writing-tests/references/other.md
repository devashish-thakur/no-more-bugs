# Other stacks

no-more-bugs works with any runner that can write one of four report formats: JUnit XML, NUnit 3 XML, TRX, or the Dart JSON stream. Add a suite to `.nomorebugs/config.json`:

```json
{
  "name": "unit",
  "stack": "ruby",
  "command": "bundle exec rspec --format progress --format RspecJunitFormatter --out .nomorebugs/local/reports/rspec.xml",
  "reports": [".nomorebugs/local/reports/rspec.xml"],
  "format": "junit"
}
```

| Stack | How to get a report |
|---|---|
| .NET (`dotnet test`) | `--logger "trx;LogFilePrefix=nmb" --results-directory .nomorebugs/local/reports/dotnet`, format `trx` |
| Go | `gotestsum --junitfile .nomorebugs/local/reports/go.xml -- ./...` (install gotestsum) |
| Rust | `cargo nextest run` with a JUnit output configured in `.config/nextest.toml` |
| Ruby (RSpec) | the `rspec_junit_formatter` gem, as above |
| PHP (PHPUnit) | `--log-junit .nomorebugs/local/reports/phpunit.xml` |
| Swift (XCTest) | `xcbeautify --report junit`, or `swift test --xunit-output` |
| Elixir | the `junit_formatter` package |

Test naming: put the scenario ID at the start of the test's name in whatever form the language allows: `CHK-004`, `chk_004` or `chk004` are all recognized.

The general rules from the writing-tests skill apply unchanged: red before green, one behavior per test, real dependencies for integration tests, mocks only for what you don't own, and no sleeps.
