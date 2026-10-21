# Godot (GDScript)

## Runners and reports

Use GUT or gdUnit4; both write JUnit XML.

| Addon | Suite command | Report |
|---|---|---|
| GUT | `godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test -ginclude_subdirs -gexit -gjunit_xml_file=res://.nomorebugs/local/reports/gut.xml` | the `-gjunit_xml_file` path |
| gdUnit4 | `addons/gdUnit4/runtest.sh -a res://test` (`runtest.cmd` on Windows), env `GODOT_BIN=<path to godot>` | `reports/**/results.xml` |

Set `GODOT_BIN` (or put `godot` on the PATH) before `nmb init`, so the command uses the right executable. Headless runs are fast, so `nmb run` is cheap here.

Run one scenario while iterating with GUT: `nmb run godot -- -gunit_test_name=chk_004`.

## Naming

```gdscript
extends GutTest

func test_chk_004_rejects_expired_coupon():
    var shop = Shop.new()
    var result = shop.apply(expired_coupon())
    assert_eq(result.error, Shop.Error.COUPON_EXPIRED)
```

## By type

- **unit:** scripts that extend `RefCounted` or plain classes, tested without a scene tree. Inject time and randomness (`RandomNumberGenerator` with a fixed `seed`).
- **integration:** instantiate the scene with `add_child_autofree(scene.instantiate())` (GUT) or `scene_runner()` (gdUnit4), then await frames or signals (`await wait_for_signal(...)`).
- **ui:** gdUnit4's scene runner can simulate input (`simulate_key_pressed`, mouse moves); GUT has `InputSender`. Assert on node state, not pixels.

## Gotchas

- `pending()` in GUT counts as skipped and blocks the check.
- Free what you create (`autofree`, `queue_free`) or orphan warnings pile up and hide real failures.
- Physics and timers depend on frames: await a signal or poll a condition with a timeout instead of waiting a fixed time.
