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

test("the app wraps every screen in the boundary and keeps the dashboard connection above it", () => {
  const app = readFileSync(new URL("App.tsx", import.meta.url), "utf8");
  const root = app.slice(app.indexOf("export default function App"));
  assert.match(root, /createDashboardFlow\(/);
  assert.match(root, /<SafeAreaProvider>\s*<ScreenBoundary fallback=\{retry => <ScreenFailed onRetry=\{retry\} \/>\}>\s*<Portal flow=\{flow\} \/>\s*<\/ScreenBoundary>/);
  assert.match(app, />화면을 열지 못했어요</);
  assert.match(app, /title="다시 시도" onPress=\{onRetry\}/);
});
