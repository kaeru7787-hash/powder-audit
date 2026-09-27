import { test } from "node:test";
import assert from "node:assert/strict";
import { frameCrop } from "../src/camera-geometry";
for (const [label, w, h, expected] of [
  ["縦カメラ", 1080, 1920, [108, 717, 864, 486]],
  ["横カメラ", 1920, 1080, [384, 216, 1152, 648]],
  ["4:3カメラ", 1600, 1200, [160, 240, 1280, 720]],
] as const)
  test(`${label}で画面のバーコード枠と読取領域が一致`, () => {
    const r = frameCrop(w, h, 400, 300, true);
    Object.values(r).forEach((v, i) =>
      assert.ok(Math.abs(v - expected[i]) < 0.001),
    );
  });
test("天秤のcontain表示と狭いOCR枠を維持", () => {
  const r = frameCrop(1080, 1920, 400, 300, false);
  assert.deepEqual(r, { x: 0, y: 720, width: 1080, height: 480 });
});
