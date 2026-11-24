import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ScreenBoundary } from "./screen-boundary.ts";

test("a render error shows the failure screen and retry draws the same screen again", () => {
  let retry: (() => void) | undefined;
  const boundary = new ScreenBoundary({ children: "screen", fallback: next => { retry = next; return "failed"; } });
  boundary.setState = update => {
    const next = typeof update === "function" ? update(boundary.state, boundary.props) : update;
    boundary.state = { ...boundary.state, ...next };
  };
  assert.equal(boundary.render(), "screen");
  boundary.state = { ...boundary.state, ...ScreenBoundary.getDerivedStateFromError() };
  assert.equal(boundary.render(), "failed");
  assert(retry);
  retry();
  assert.equal(boundary.render(), "screen");
});

test("a caught render error is written to the console and handed to onError once, and a failing onError stays quiet", () => {
  const error = new TypeError("object null is not iterable");
  const logged: unknown[][] = [];
  const reported: [unknown, string | null][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const boundary = new ScreenBoundary({ children: "screen", fallback: () => "failed", onError: (e, stack) => { reported.push([e, stack]); } });
    boundary.componentDidCatch(error, { componentStack: "\n    in ConnectedPlan" });
    assert.deepEqual(reported, [[error, "\n    in ConnectedPlan"]]);
    assert.equal(logged.length, 1);
    assert(logged[0].includes(error));
    const silent = new ScreenBoundary({ children: "screen", fallback: () => "failed", onError: () => { throw new Error("report failed"); } });
    assert.doesNotThrow(() => silent.componentDidCatch(error, {}));
    new ScreenBoundary({ children: "screen", fallback: () => "failed" }).componentDidCatch(error, { componentStack: null });
  } finally {
    console.error = original;
  }
});

test("the app wraps every screen in the boundary and keeps the dashboard connection above it", () => {
  const app = readFileSync(new URL("App.tsx", import.meta.url), "utf8");
  const root = app.slice(app.indexOf("export default function App"));
  assert.match(root, /createDashboardFlow\(/);
  assert.match(root, /<SafeAreaProvider>\s*<ScreenBoundary fallback=\{retry => <ScreenFailed onRetry=\{retry\} \/>\}\s+onError=\{\(error, componentStack\) => reportScreenError\(flow, error, componentStack\)\}>\s*<Portal flow=\{flow\} \/>\s*<\/ScreenBoundary>/);
  assert.match(app, /function reportScreenError\(flow: DashboardFlow, error: unknown, componentStack: string \| null\) \{\s*const \{ screen \} = flow\.view\(\);\s*if \(screen\.kind !== "dashboard"\) return;\s*void reportClientError\(\(\) => createConnectedHub\(screen\.url\), clientErrorReport\(error, componentStack, appConfig\.expo\.version, Date\.now\(\)\)\);/);
  assert.match(app, />화면을 열지 못했어요</);
  assert.match(app, /title="다시 시도" onPress=\{onRetry\}/);
});
