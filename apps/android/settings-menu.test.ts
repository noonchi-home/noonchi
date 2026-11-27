import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applianceSummary, demoSettings, listedPages, pageLabels, previousPage, type SettingsPage } from "./settings-menu.ts";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8").split("\r\n").join("\n");
const titles = (hasHome: boolean, shown?: readonly SettingsPage[]) => listedPages(hasHome, shown).map(page => pageLabels[page]);

test("the demo settings list shows the house picker only before a home is chosen, then appliances, mode, start position and stations", () => {
  assert.deepEqual(titles(false), ["집 고르기", "가전 연결", "모드", "시작 위치", "자리·구역"]);
  assert.deepEqual(titles(true), ["가전 연결", "모드", "시작 위치", "자리·구역"]);
});

test("a hidden page comes back by adding it to the shown list, and the device picker and remotes open only from the appliance page", () => {
  assert.deepEqual(titles(true, [...demoSettings.pages, "layout", "devices", "remotes"]), ["가전 연결", "모드", "시작 위치", "자리·구역", "배치 보정"]);
});

test("the appliance page shows only the IR section", () => {
  assert.deepEqual(demoSettings.appliances, ["ir"]);
});

test("the appliance summary follows the IR remotes while ThinQ is hidden", () => {
  assert.equal(applianceSummary({ pairs: { tv: "thinq-1" }, ir: { ready: true } }), "리모컨 연결됨");
  assert.equal(applianceSummary({ pairs: { tv: "thinq-1" } }), "미연결");
  assert.equal(applianceSummary({ pairs: {}, ir: { ready: false } }), "미연결");
  assert.equal(applianceSummary({ pairs: { tv: "a", fan: "b" }, ir: { ready: true } }, ["thinq", "ir"]), "2개 연결");
});

test("back from the device picker or the remotes returns to the appliance page and every other page returns to the list", () => {
  assert.equal(previousPage("devices"), "appliances");
  assert.equal(previousPage("remotes"), "appliances");
  for (const page of ["house", "appliances", "mode", "position", "stations", "layout"] as const) assert.equal(previousPage(page), undefined, page);
});

test("the settings screen draws from the shown lists and keeps the hidden pages' code", () => {
  const settings = source("ConnectedSettings.tsx");
  assert.match(settings, /listedPages\(!!setup\.home\)\.map\(key => <Choice key=\{key\} title=\{pageLabels\[key\]\}/);
  assert.match(settings, /appliances: applianceSummary\(setup\)/);
  assert.match(settings, /\{page === "layout" && <LayoutSetting \{\.\.\.context\} \/>\}/);
  assert.match(settings, /function LayoutSetting\(/);
  assert.match(settings, /\{demoSettings\.appliances\.includes\("thinq"\) && <ThinqSection /);
  assert.match(settings, /function ThinqSection\([\s\S]*?<Heading>LG ThinQ API 기본 연결<\/Heading>/);
  assert.match(settings, /<Action title="읽을 가전 선택" disabled=\{busy\} onPress=\{onChooseDevices\} secondary \/>/);
  assert.doesNotMatch(settings, /Matter/);
  assert.match(settings, /\{demoSettings\.serverOrigin && <Copy>\{hub\.origin\}<\/Copy>\}/);
  assert.match(settings, /<Action title="서버 연결 끊기" secondary/);
});
