// docs/world-vocabulary.md의 표를 낱말 표(src/world/vocab.ts, vocab-doc.ts), 가전 종류 등록부(src/devices/kinds.ts camera·longEvents)와 이 집 가전(twin/)에서 만든다.
// 표는 <!-- vocab:이름 --> … <!-- /vocab:이름 --> 사이에만 쓴다. tests/world-vocab.test.ts가 문서 표와 만든 표가 다르면 실패한다.
//   npx tsx scripts/world-vocab-doc.ts          문서 표를 다시 쓴다
//   npx tsx scripts/world-vocab-doc.ts --check  다르면 1로 끝난다
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTwin } from "../src/layout/twin-files.js";
import { KINDS, KIND_ORDER, cameraKindOf } from "../src/devices/kinds.js";
import { rulesOf } from "../src/world/sight.js";
import { deviceStateKeys, deviceText } from "../src/world/relations.js";
import { CLASS_DOC, DEVICE_LONG_DOC, DEVICE_STATE_DOC, STATE_DOC } from "../src/world/vocab-doc.js";
import { CLASSES, DEVICE_LONG, DEVICE_STATES, STATES, type ClassKey, type DeviceLongKey, type DeviceStateKey, type FixtureClass, type SightRule, type StateKey } from "../src/world/vocab.js";

export const DOC_PATH = fileURLToPath(new URL("../docs/world-vocabulary.md", import.meta.url));
/** 문서 가전 표의 집. */
export const DOC_HOME = "mokryeon_180b";

const ROLE = { person: "Person", object: "Object", fixture: "Fixture", scene: "Scene furniture (filtered)" } as const;
const FACET = { place: "Location", contents: "Contents", body: "Body", open: "Open state", use: "Use", screen: "Screen", posture: "Posture", holding: "Holding", activity: "Activity", moment: "Momentary action" } as const;
const TARGET = { person: "Person", object: "Object", fixture: "Fixture" } as const;
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const code = (s: string) => `\`${s}\``;

function classes(): string {
  return table(["Key", "Korean label", "Role", "YOLO26s COCO", "Min. score", "Facet", "Example trigger"], (Object.keys(CLASSES) as ClassKey[]).map((k) => {
    const c = CLASSES[k];
    const coco = Object.entries(c.coco).map(([n, name]) => `${n} ${name}`).join(", ") || "— (VLM only)";
    return [code(k), c.label, ROLE[c.role], coco, c.role === "scene" ? "—" : c.minScore, c.facets.map((f) => FACET[f]).join(", ") || "—", CLASS_DOC[k] ?? "—"];
  }));
}

function states(): string {
  return table(["Key", "Korean label", "Facet", "Target", "Evidence", "Example trigger"], (Object.keys(STATES) as StateKey[]).map((k) => {
    const s = STATES[k];
    const d = STATE_DOC[k];
    const src = "pose" in s ? "Pose" : s.facet === "posture" ? "Pose and VLM" : "VLM";
    return [code(k), s.label, FACET[s.facet], s.for.map((t) => TARGET[t]).join(", "), d.how ? `${src}, ${d.how}` : src, d.example];
  }));
}

function devices(): string {
  const rows = (Object.keys(DEVICE_STATES) as DeviceStateKey[]).map((k) => {
    const s = DEVICE_STATES[k];
    return [code(k), `${s.attr} = ${String(s.value)}`, s.label, s.became, s.active ? "Yes" : "No", DEVICE_STATE_DOC[k]];
  });
  const long = (Object.entries(DEVICE_LONG) as [DeviceLongKey, (typeof DEVICE_LONG)[DeviceLongKey]][]).map(([k, l]) => [
    code(k), `${l.state} for over ${l.afterMs / 1000} s`, "—", l.label, "—", `${DEVICE_LONG_DOC[k]} Kinds: ${longKinds(k).join(", ")}`,
  ]);
  return table(["Key", "Twin attribute", "State text (Korean)", "Event text (Korean)", "Always shown", "Example trigger"], [...rows, ...long]);
}

/** 그 사건이 나는 가전 종류(등록부 longEvents, 등록부 순서). */
const longKinds = (key: DeviceLongKey): string[] => KIND_ORDER.filter((k) => KINDS[k].longEvents?.includes(key));
/** 카메라로 맞추는 가전 설비와 규칙(등록부 camera, 낱말 표 순서). */
const SIGHT_RULES = (Object.keys(CLASSES) as ClassKey[]).flatMap((c): [FixtureClass, readonly SightRule[]][] => {
  if (CLASSES[c].role !== "fixture") return [];
  const rules = rulesOf(c as FixtureClass);
  return rules.length ? [[c as FixtureClass, rules]] : [];
});
const sightValue = (r: SightRule) => Object.entries(r.values).map(([k, v]) => `${code(k)} ${r.attr} = ${String(v)}`).join(", ");

function sight(): string {
  return table(["Fixture", "Twin device kind", "Facet", "Observed value", "If the facet is absent"], SIGHT_RULES.flatMap(([cls, rules]) => rules.map((r) => [
    `${code(cls)} ${CLASSES[cls].label}`, cameraKindOf(cls) ?? "—", FACET[r.facet], sightValue(r), r.absent !== undefined ? `${r.attr} = ${String(r.absent)}` : "—",
  ])));
}

/** 그 가전을 카메라로 맞추는 값(가전 설비 글 + 값 글). 없으면 —. */
function sightOf(d: { kind: string; twinAttrs: Readonly<Record<string, readonly unknown[]>> }): string {
  const hits = SIGHT_RULES.filter(([cls]) => cameraKindOf(cls) === d.kind)
    .flatMap(([cls, rules]) => rules.filter((r) => r.attr in d.twinAttrs).map((r) => `${CLASSES[cls].label} ${Object.keys(r.values).map((k) => STATES[k as StateKey].label).join("·")}`));
  return hits.join(", ") || "—";
}

function home(): string {
  const twin = loadTwin(undefined, { home: DOC_HOME });
  return table(["Device ID", "Label (Korean)", "Kind", "State keys", "Event text (Korean)", "Camera evidence (Korean)"], twin.devices.map((d) => {
    const keys = Object.entries(d.twinAttrs).flatMap(([attr, values]) => values.flatMap((v) => deviceStateKeys(d.kind, { [attr]: v })));
    const events = keys.map((k) => `${d.label} ${deviceText(d.kind, k).became}`);
    const long = (Object.entries(DEVICE_LONG) as [DeviceLongKey, (typeof DEVICE_LONG)[DeviceLongKey]][]).filter(([k]) => longKinds(k).includes(d.kind)).map(([, l]) => `${d.label} ${l.label}`);
    return [code(d.id), d.label, d.kind, keys.map(code).join(", "), [...events, ...long].join(", "), sightOf(d)];
  }));
}

function rooms(): string {
  const twin = loadTwin(undefined, { home: DOC_HOME });
  return table(["Room ID", "Label (Korean)"], twin.rooms.map((r) => [code(r.id), r.label]));
}

export function renderTables(): Record<string, string> {
  return { classes: classes(), states: states(), rooms: rooms(), devices: devices(), home: home(), sight: sight() };
}

/** 문서의 표 자리를 만든 표로 바꾼 글(줄 끝은 LF). 자리가 없으면 던진다. */
export function renderDoc(md: string, tables = renderTables()): string {
  let out = md.replace(/\r\n/g, "\n");
  for (const [name, body] of Object.entries(tables)) {
    const re = new RegExp(`(<!-- vocab:${name} -->)[\\s\\S]*?(<!-- /vocab:${name} -->)`);
    if (!re.test(out)) throw new Error(`docs/world-vocabulary.md에 <!-- vocab:${name} --> 자리가 없습니다`);
    out = out.replace(re, `$1\n${body}\n$2`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const md = readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
  const next = renderDoc(md);
  if (process.argv.includes("--check")) {
    if (next !== md) {
      console.log("docs/world-vocabulary.md 표가 낱말 표와 다릅니다. 고침: npx tsx scripts/world-vocab-doc.ts");
      process.exitCode = 1;
    }
  } else if (next !== md) writeFileSync(DOC_PATH, next);
}
