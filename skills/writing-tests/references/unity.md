# Unity (C#)

## Runner and report

The Unity Test Framework writes NUnit 3 XML, which no-more-bugs reads directly (format `nunit`). Tests run inside the editor in batch mode:

```
"<Unity editor>" -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults .nomorebugs/local/reports/unity-editmode.xml -logFile .nomorebugs/local/reports/unity-editmode.log
```

`nmb init` finds the editor version in `ProjectSettings/ProjectVersion.txt` and looks in the default Unity Hub folders. Set `UNITY_EDITOR` to the editor's path if it's somewhere else. There are two suites: `unity-editmode` and `unity-playmode`. Don't add `-quit`: `-runTests` exits by itself.

**Batch mode can't run while the project is open in the Unity editor.** Close the editor before `nmb run`, or run the tests from the editor's Test Runner window and record the result with an ad-hoc run that only reads the report:

```
nmb run --cmd "echo reading report" --report "<path the Test Runner saved>" --format nunit --full
```

Editor launches are slow, so while iterating, run one suite with a filter: `nmb run unity-editmode -- -testFilter "CHK004"`.

## Naming

```csharp
[Test]
public void CHK004_RejectsExpiredCoupon()
{
    var result = _shop.Apply(ExpiredCoupon());
    Assert.That(result.Error, Is.EqualTo(CouponError.Expired));
}

[UnityTest]
public IEnumerator INV007_PicksUpItemOnContact()
{
    yield return LoadTestScene();
    _player.MoveTo(_item.transform.position);
    yield return new WaitUntil(() => _inventory.Count == 1);
    Assert.That(_inventory.Contains(_item.Id));
}
```

## By type

- **unit (EditMode):** plain C# logic. Keep game rules out of MonoBehaviours so they can be tested without a scene. Inject time (`ITimeProvider`) instead of `Time.time`.
- **integration (PlayMode):** load a minimal test scene, step frames with `yield return null`, and wait on conditions with `WaitUntil`, never fixed `WaitForSeconds`.
- **ui:** PlayMode tests that drive input with the Input System's `InputTestFixture` (press keys, move sticks) and assert on UI state.
- **e2e:** full flows in a built player need an external driver such as AltTester or GameDriver; keep these to the critical paths.

## Gotchas

- `[Ignore]` and `[Explicit]` show as skipped and block the check.
- Seed `UnityEngine.Random.InitState(…)` in tests that use randomness.
- Physics-dependent assertions should wait on a condition with a timeout, not a frame count.
- Test assemblies need an `.asmdef` that references the code under test and `UnityEngine.TestRunner`.
