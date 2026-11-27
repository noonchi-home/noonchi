import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { pressMotion, reduceMotionStore, savedMotion, slideMotion } from "./motion.ts";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8").split("\r\n").join("\n");

test("pressing shrinks to 0.97 and dims slightly, and with reduce motion only the dim stays, at once", () => {
  const press = pressMotion(false);
  assert.equal(press.scale, 0.97);
  assert(press.opacity >= 0.8 && press.opacity < 1, `opacity ${press.opacity}`);
  assert(press.inMs > 0 && press.inMs <= 150, `in ${press.inMs}`);
  assert(press.outMs > 0 && press.outMs <= 250, `out ${press.outMs}`);
  assert.deepEqual(pressMotion(true), { scale: 1, opacity: press.opacity, inMs: 0, outMs: 0 });
});

test("the saved mark shows for about 1.2 s and fades out, and with reduce motion it shows and hides without fading", () => {
  const saved = savedMotion(false);
  assert.equal(saved.inMs + saved.holdMs + saved.outMs, 1200);
  assert(saved.inMs > 0 && saved.outMs > 0 && saved.holdMs > saved.outMs, JSON.stringify(saved));
  assert.deepEqual(savedMotion(true), { inMs: 0, holdMs: 1200, outMs: 0 });
});

test("a settings page enters from the right edge and leaves to it, and with reduce motion it does not move", () => {
  const enter = slideMotion("in", 412, false);
  assert.deepEqual({ from: enter.from, to: enter.to }, { from: 412, to: 0 });
  assert(enter.ms >= 150 && enter.ms <= 350, `ms ${enter.ms}`);
  assert.deepEqual(slideMotion("out", 412, false), { from: 0, to: 412, ms: enter.ms });
  assert.deepEqual(slideMotion("in", 412, true), { from: 0, to: 0, ms: 0 });
  assert.deepEqual(slideMotion("out", 412, true), { from: 0, to: 0, ms: 0 });
});

function fakeAccessibility() {
  const handlers = new Set<(value: boolean) => void>();
  let answer: (value: boolean) => void = () => {};
  let removed = 0;
  return {
    source: {
      isReduceMotionEnabled: () => new Promise<boolean>(resolve => { answer = resolve; }),
      addEventListener: (_event: "reduceMotionChanged", handler: (value: boolean) => void) => {
        handlers.add(handler);
        return { remove: () => { handlers.delete(handler); removed++; } };
      },
    },
    answer: (value: boolean) => answer(value),
    change: (value: boolean) => handlers.forEach(handler => handler(value)),
    get listening() { return handlers.size; },
    get removed() { return removed; },
  };
}

test("reduce motion follows the system setting: the first read, later changes, and one listener for every subscriber", async () => {
  const system = fakeAccessibility();
  const store = reduceMotionStore(system.source);
  let calls = 0;
  const first = store.subscribe(() => calls++);
  const second = store.subscribe(() => calls++);
  assert.equal(system.listening, 1);
  assert.equal(store.get(), false);
  system.answer(true);
  await Promise.resolve();
  assert.equal(store.get(), true);
  assert.equal(calls, 2);
  system.change(false);
  assert.equal(store.get(), false);
  assert.equal(calls, 4);
  first();
  assert.equal(system.removed, 0);
  second();
  assert.equal(system.removed, 1);
});

test("a change heard before the first read finishes wins over the read", async () => {
  const system = fakeAccessibility();
  const store = reduceMotionStore(system.source);
  store.subscribe(() => {});
  system.change(true);
  system.answer(false);
  await Promise.resolve();
  assert.equal(store.get(), true);
});

test("buttons and choices press through the shared motion that follows the system reduce motion setting", () => {
  const ui = source("ConnectedUi.tsx");
  assert.match(ui, /export function Action\([\s\S]*?return <MotionPressable /);
  assert.match(ui, /export function Choice\([\s\S]*?return <MotionPressable /);
  assert.match(ui, /onPressIn=\{\(\) => move\(1\)\} onPressOut=\{\(\) => move\(0\)\}/);
  assert.match(ui, /const reduceMotion = reduceMotionStore\(AccessibilityInfo\);/);
  assert.match(ui, /useSyncExternalStore\(reduceMotion\.subscribe, reduceMotion\.get\)/);
  assert.match(ui, /pressMotion\(useReduceMotion\(\)\)/);
});

test("a successful settings save shows the saved mark over the next screen", () => {
  const home = source("ConnectedHome.tsx");
  assert.match(home, /<SavedMark count=\{saved\} \/>/);
  assert.match(home, /onSaved=\{async \(setup, chosen\) => \{[^}]*?setSaved\(count => count \+ 1\);/);
  assert.match(source("ConnectedUi.tsx"), /const motion = savedMotion\(reduce\);/);
});

test("settings pages slide in when opened and slide out before going back", () => {
  const settings = source("ConnectedSettings.tsx");
  assert.match(settings, /onPress=\{\(\) => open\(key\)\}/);
  assert.match(settings, /onChooseDevices=\{\(\) => open\("devices"\)\}/);
  assert.match(settings, /<Animated\.View style=\{slide\.style\}>/);
  assert.match(settings, /onPress=\{\(\) => slide\.leave\(/);
  const ui = source("ConnectedUi.tsx");
  assert.match(ui, /slideMotion\("in", width, reduce\)/);
  assert.match(ui, /slideMotion\("out", width, reduce\)/);
});

test("no app code vibrates", () => {
  const code = readdirSync(new URL(".", import.meta.url)).filter(name => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));
  assert(code.includes("ConnectedUi.tsx"));
  for (const name of code) assert.doesNotMatch(source(name), /Vibration|Haptics|vibrate/, name);
});
