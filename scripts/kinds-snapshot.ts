// 가전 종류별 값 스냅숏: 등록부(src/model/kinds.ts)로 옮기기 전 값을 tests/fixtures/kinds-before.json에 뽑아 두고(npx tsx scripts/kinds-snapshot.ts > tests/fixtures/kinds-before.json),
// tests/kinds-registry.test.ts가 옮긴 뒤 같은 값을 다시 뽑아 견준다(결과가 바뀌지 않는 옮기기). 묶음 approval(승인 규칙·승인 표)과 나머지를 따로 본다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command, DeviceKind } from "../src/hub/types.js";
import { KIND_LABELS, KIND_PROFILES, TYPE_RULES, findTypeRule, twinChange } from "../src/model/mapping.js";
import { KIND_SYNONYMS } from "../src/agent/search.js";
import { CONFIRM_RULES, Policy, RISKY_ON_NAMES, isRiskyKind, riskyNames } from "../src/agent/policy.js";
import { CAUTION_LINE } from "../src/plan/labels.js";
import { DEVICE_ACTS } from "../src/agent/planTools.js";
import { PAIRABLE_KINDS, fitsKind, mirrorPlan, readAppliance, thinqSteps, type Reading } from "../src/thinq/appliance.js";
import { CLASSES, DEVICE_LONG, DEVICE_TEXT, SIGHT } from "../src/world/vocab.js";

const ROOT = join(import.meta.dirname, "..");
const NAME = "〈이름〉";

/** 카탈로그(공용·집)와 집 장면에 나오는 모든 트윈 type. */
function twinTypes(): string[] {
  const types = new Set<string>();
  const catalog = (dir: string) => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^﻿/, "")) as { type?: string };
      types.add(raw.type ?? f.replace(/\.json$/, ""));
    }
  };
  catalog(join(ROOT, "twin", "data", "catalog"));
  for (const home of readdirSync(join(ROOT, "twin", "data", "homes"))) {
    try { catalog(join(ROOT, "twin", "data", "homes", home, "catalog")); } catch { /* 집 카탈로그 없음 */ }
  }
  for (const home of readdirSync(join(ROOT, "twin", "homes"))) {
    try {
      const scene = JSON.parse(readFileSync(join(ROOT, "twin", "homes", home, "scene.json"), "utf8").replace(/^﻿/, "")) as { objects: { type: string }[] };
      for (const o of scene.objects) types.add(o.type);
    } catch { /* 장면 없음 */ }
  }
  return [...types].sort();
}

const COMMANDS: Command[] = [
  { type: "on" }, { type: "off" }, { type: "start" }, { type: "stop" }, { type: "pause" }, { type: "level", percent: 50 }, { type: "climate", mode: "cool" },
  { type: "lock" }, { type: "unlock" }, { type: "covering", openPercent: 50 }, { type: "valve", open: true }, { type: "valve", open: false },
];

const RISKY_TEXTS = [
  "", "거실 불 켜 줘", "레인지후드 켜 줘", "레인지 후드", "가스 레인지 켜", "전자 레인지 돌려 줘", "전자레인지", "레인지", "화 구", "화구", "버너 불", "인덕션이랑 전자레인지",
  "INDUCTION on", "Microwave", "쿡 탑", "하이 라이트", "전기 렌지", "TV 켜 줘", "냉장고 문 닫아", "레인지후드와 전자레인지",
];

const RAWS: Record<string, unknown>[] = [
  {},
  { operation: { airConOperationMode: "POWER_ON" }, airConJobMode: { currentJobMode: "COOL" }, temperatureInUnits: [{ unit: "F", targetTemperature: 77 }, { unit: "C", targetTemperature: 24, currentTemperature: 26 }], airFlow: { windStrength: "HIGH" } },
  { operation: { airConOperationMode: "POWER_OFF" }, airConJobMode: { currentJobMode: "AIR_DRY" }, temperature: { targetTemperature: 20 }, airFlow: { windStrength: "MID" } },
  { doorStatus: [{ locationName: "FREEZER", doorState: "CLOSE" }, { locationName: "MAIN", doorState: "OPEN" }] },
  { doorStatus: { doorState: "CLOSE" } },
];
const READINGS: Reading[] = [{}, { power: "on", mode: "heat", setpointC: 22, fan: "low" }, { power: "off" }, { door: "open" }, { door: "closed" }, { power: "on", mode: "cool", setpointC: 24, fan: "auto" }];
const WORLDS = [
  { twin: { power: "on", door: "closed" }, matter: { onOff: true, systemMode: "cool", setpointC: 24, fanMode: "auto" } },
  { twin: { power: "off", door: "open" }, matter: { onOff: false, systemMode: "heat", setpointC: 20, fanMode: "low" } },
];
const THINQ_TYPES = ["DEVICE_AIR_CONDITIONER", "DEVICE_REFRIGERATOR", "DEVICE_WASHER", "air_conditioner", "refrigerator", "DEVICE_KIMCHI_REFRIGERATOR", ""];
const SENSOR_VALUES: Record<string, unknown[]> = { door: ["closed", "open"], charging: ["off", "on"] };

/** 지금 값 전부(JSON으로 쓸 수 있는 모양). */
export function kindsSnapshot() {
  const kinds = Object.keys(KIND_LABELS) as DeviceKind[];
  const policy = new Policy();
  const approval = Object.fromEntries(kinds.map((kind) => {
    const specs = [
      { from: "profile", capabilities: KIND_PROFILES[kind].capabilities },
      ...TYPE_RULES.filter((r) => r.kind === kind && r.capabilities).map((r) => ({ from: (r.types ?? r.prefixes ?? []).join(","), capabilities: r.capabilities! })),
    ];
    return [kind, specs.map((s) => ({ from: s.from, results: COMMANDS.map((c) => ({ command: c, reason: policy.requiresConfirmation({ kind, label: NAME, capabilities: s.capabilities }, c) })) }))];
  }));
  const thinq = {
    pairable: PAIRABLE_KINDS,
    fits: Object.fromEntries(kinds.map((k) => [k, THINQ_TYPES.filter((t) => fitsKind(k, t))])),
    read: Object.fromEntries(kinds.map((k) => [k, RAWS.map((raw) => readAppliance(k, raw))])),
    steps: Object.fromEntries(kinds.map((k) => [k, COMMANDS.map((c) => thinqSteps(k, c)?.map((s) => ({ name: s.name, body: s.body, done: READINGS.map((r) => s.done(r)) })) ?? null)])),
    mirror: Object.fromEntries(kinds.map((k) => [k, READINGS.flatMap((r) => WORLDS.map((w) => mirrorPlan({ kind: k }, r, w)))])),
  };
  const twin = Object.fromEntries(kinds.map((kind) => {
    const p = KIND_PROFILES[kind];
    const twinAttrs: Record<string, unknown[]> = {};
    for (const a of p.control?.attrs ?? []) twinAttrs[a] = [p.control!.inactive, p.control!.active];
    for (const s of p.sensors) twinAttrs[s] = SENSOR_VALUES[s] ?? ["off", "on"];
    const spec = { kind, label: NAME, sensors: p.sensors, twinAttrs };
    const results = Object.entries(twinAttrs).flatMap(([attr, values]) => values.map((v) => ({ attr, value: v, change: twinChange(spec, attr, v) })));
    return [kind, [...results, { attr: "nope", value: "on", change: twinChange(spec, "nope", "on") }]];
  }));
  const fixtures = (Object.keys(CLASSES) as (keyof typeof CLASSES)[]).filter((c) => CLASSES[c].role === "fixture");
  return {
    approval: {
      confirmRules: CONFIRM_RULES.map((r) => ({ kind: r.kind, command: r.command, reason: r.reason(NAME) })),
      table: approval,
    },
    labels: KIND_LABELS,
    profiles: KIND_PROFILES,
    typeRules: Object.fromEntries(twinTypes().map((t) => [t, findTypeRule(t) ?? null])),
    synonyms: KIND_SYNONYMS,
    risky: {
      names: RISKY_ON_NAMES,
      kinds: kinds.filter((k) => isRiskyKind(k)),
      texts: Object.fromEntries(RISKY_TEXTS.map((t) => [t, riskyNames(t)])),
    },
    caution: CAUTION_LINE,
    hand: DEVICE_ACTS,
    thinq,
    deviceText: DEVICE_TEXT,
    deviceLong: DEVICE_LONG,
    camera: {
      kindOf: Object.fromEntries(fixtures.map((c) => [c, (CLASSES[c] as { deviceKind?: string }).deviceKind ?? null])),
      sight: SIGHT,
    },
    twinChange: twin,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) console.log(JSON.stringify(kindsSnapshot(), null, 1));
