import assert from "node:assert/strict";
import { test } from "node:test";
import { launchLayout } from "./launch-layout.ts";

const near = (actual: number, expected: number, within = 1, label = "") =>
  assert(Math.abs(actual - expected) <= within, `${label} ${actual} is not within ${within} of ${expected}`);

for (const [width, height, topInset] of [[412, 915, 40], [360, 780, 24]]) {
  test(`${width}×${height}: the upper body fills the bottom 60% and the wordmark sits between the safe area and the mascot`, () => {
    const { wordmark, mascot } = launchLayout(width, height, topInset);
    near(mascot.top, 0.4 * height, 1, "mascot top");
    // body center x = 420 of 618 sits on the screen center
    near(mascot.left + mascot.width * 420 / 618, width / 2, 1, "body center");
    // the screen bottom cuts the image at y = 640 of 1080 (feet and tail below are off screen)
    near((height - mascot.top) / mascot.height * 1080, 640, 1, "visible bottom");
    near(mascot.width / mascot.height, 618 / 1080, 0.001, "aspect");
    near(wordmark.width, Math.min(0.59 * width, 270), 0.01, "wordmark width");
    near(wordmark.height, wordmark.width * 374 / 2130, 0.01, "wordmark height");
    near(wordmark.top + wordmark.height / 2, (topInset + mascot.top) / 2, 1, "wordmark center");
  });
}

test("412×915 matches the chosen mock B (shot(640, 0.40))", () => {
  const { wordmark, mascot } = launchLayout(412, 915, 40);
  near(mascot.top, 366, 1, "top");
  near(mascot.width, 530, 1, "width");
  near(mascot.height, 926, 1, "height");
  near(mascot.left, -154, 1, "left");
  near(wordmark.top, 182, 1, "wordmark top");
});

test("the loading screen draws from launchLayout and leaves only through the flow's 2-second minimum", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("App.tsx", import.meta.url), "utf8");
  assert.match(app, /launchLayout\(width, height, insets\.top\)/);
  assert.match(app, /style=\{\[styles\.mascot, body\]\}/);
  assert.match(app, /launch: \{[^}]*overflow: "hidden"/);
  assert.match(app, /flow\.finishLaunch\(\);/);
  assert.doesNotMatch(app, /setTimeout\(flow\.finishLaunch/);
});
