import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listedPages, pageLabels, previousPage } from "./settings-menu.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").split("\r\n").join("\n");

test("리모컨 쪽은 가전 연결에서만 열고 가전 연결로 돌아가며, 설정 목록에는 없다", () => {
  assert.equal(pageLabels.remotes, "리모컨");
  assert.equal(previousPage("remotes"), "appliances");
  assert.ok(!listedPages(true).includes("remotes") && !listedPages(false).includes("remotes"));
  const settings = read("./ConnectedSettings.tsx");
  assert.match(settings, /\{demoSettings\.appliances\.includes\("ir"\) && <Action title="리모컨 등록" disabled=\{busy\} onPress=\{onChooseRemotes\} secondary \/>\}/);
  assert.match(settings, /onChooseRemotes=\{\(\) => open\("remotes"\)\}/);
  assert.match(settings, /\{page === "remotes" && <ConnectedRemotes hub=\{hub\} home=\{context\.home\} onBlock=\{block\}\s+onBack=\{\(\) => slide\.leave\(\(\) => setPage\(previousPage\(page\)\)\)\} \/>\}/);
  assert.doesNotMatch(settings, /remoteTitle/);
});

test("리모컨 화면은 ConnectedUi 부품과 ir-remotes 함수만 쓴다", () => {
  const screen = read("./ConnectedRemotes.tsx");
  const allowed = new Set(["../../src/contract/ir", "./ConnectedUi", "./connected-hub", "./ir-remotes", "react", "react-native"]);
  const imports = [...screen.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(imports.includes("./ConnectedUi") && imports.includes("./ir-remotes"));
  for (const name of imports) assert.ok(allowed.has(name), `쓰지 않는 import: ${name}`);
  assert.doesNotMatch(screen, /StyleSheet|style=|<View|<Text/);
  for (const name of ["readIr", "readPorts", "choosePort", "saveRemote", "startLearn", "waitLearn", "cancelLearn", "testButton", "deleteButton", "deleteRemote", "addPreset"]) assert.match(screen, new RegExp(`\\b${name}\\(`));
});

test("배우는 동안만 「버튼을 눌러 주세요」가 깜빡이고, 쪽을 떠나면 기다림을 멈추고 배우기를 취소한다", () => {
  const screen = read("./ConnectedRemotes.tsx");
  assert.match(screen, /if \(learning\?\.state === "waiting"\) return <>[\s\S]*?<Pulse>버튼을 눌러 주세요<\/Pulse>/);
  assert.equal(screen.match(/<Pulse>/g)?.length, 1);
  assert.match(screen, /useEffect\(\(\) => \(\) => \{\s*const stop = waiting\.current;\s*if \(stop && !stop\.signal\.aborted\) \{ stop\.abort\(\); void cancelLearn\(hub, home\)\.catch\(\(\) => \{\}\); \}/);
});

test("배우는 동안 읽기 실패는 글로 알리고 기다림을 이어 가며, 기다림이 실패해도 떠날 때 배우기를 취소하도록 waiting을 남긴다", () => {
  const screen = read("./ConnectedRemotes.tsx");
  assert.match(screen, /waitLearn\(hub, home, \{ signal: stop\.signal, onView: next => \{ setError\(""\); setView\(next\); \}, onError: failure => setError\(message\(failure\)\) \}\)/);
  assert.match(screen, /failure => \{ if \(!stop\.signal\.aborted\) setError\(message\(failure\)\); \}/);
  assert.equal(screen.match(/waiting\.current = null/g)?.length, 1);
});

test("시험 쏘기·리모컨 지우기·단추 지우기는 확인 창 뒤에만 부른다", () => {
  const screen = read("./ConnectedRemotes.tsx");
  assert.match(screen, /Alert\.alert\("실제 가전에 신호를 보낼까요\?", "연결한 실제 가전이 움직일 수 있어요\.", \[[^\]]*onPress: \(\) => void task\.run\(async \(\) => \{ await testButton\(/);
  assert.match(screen, /Alert\.alert\("리모컨을 지울까요\?", "배운 단추도 모두 지워져요\.", \[[^\]]*onPress: \(\) => void task\.run\(async \(\) => \{\s*setView\(await deleteRemote\(/);
  assert.match(screen, /Alert\.alert\(button\.label, undefined, \[[^\]]*text: "지우기", style: "destructive", onPress: \(\) => void task\.run\(async \(\) => \{ setView\(await deleteButton\(/);
  for (const name of ["testButton", "deleteRemote", "deleteButton"]) assert.equal(screen.match(new RegExp(`\\b${name}\\(`, "g"))?.length, 1, name);
});
