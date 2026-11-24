import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("native loading, QR and connected headers render the shared artwork once in each place", () => {
  for (const [name, count] of [["App.tsx", 2], ["ConnectedHome.tsx", 1]] as const) {
    const source = read(name);
    assert.doesNotMatch(source, />\s*NOONCHI\s*<\/Text>/, `${name} still renders the brand as font text`);
    assert.doesNotMatch(source, /assets\/face\.png/, `${name} still adds a separate face beside the mark`);
    assert.equal([...source.matchAll(/<BrandWordmark\b/g)].length, count, name);
  }
});

test("the native mark shares one accessible, tinted, high-density artwork in the official proportions", () => {
  const component = read("BrandWordmark.tsx");
  assert.match(component, /accessibilityLabel="NOONCHI"/);
  assert.match(component, /resizeMode="contain"/);
  assert.match(component, /tintColor:\s*color/);
  assert.match(component, /height:\s*width\s*\*\s*374\s*\/\s*2130/);
  assert.match(component, /require\("\.\/assets\/noonchi-wordmark\.png"\)/);
  const png = readFileSync(new URL("assets/noonchi-wordmark.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16) * 374, png.readUInt32BE(20) * 2130);
  assert(png.readUInt32BE(16) >= 920);
  assert.equal(png[25], 6, "The source PNG must carry an alpha channel for native tinting");
});

test("the native splash and the app window use the same red as the loading screen behind the wordmark", () => {
  const background = /wordmarkBackground\s*=\s*"(#[0-9A-Fa-f]{6})"/.exec(read("BrandWordmark.tsx"))?.[1];
  assert.equal(background, "#A50034");
  const expo = JSON.parse(read("app.json")).expo;
  const plugins = expo.plugins as [string, Record<string, unknown>][];
  const splash = plugins.find(([name]) => name === "expo-splash-screen")?.[1];
  assert.equal(String(splash?.backgroundColor).toUpperCase(), background);
  // 앱 창 배경(prebuild의 activityBackground)이 다르면 스플래시와 로딩 화면 사이에 다른 빨강이 비친다
  assert.equal(String(expo.backgroundColor).toUpperCase(), background);
});
