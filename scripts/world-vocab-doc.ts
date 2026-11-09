// docs/world-vocabulary.md의 표를 낱말 표(src/world/vocab.ts, vocab-doc.ts)와 이 집 가전(twin/)에서 만든다.
// 표는 <!-- vocab:이름 --> … <!-- /vocab:이름 --> 사이에만 쓴다. tests/world-vocab.test.ts가 문서 표와 만든 표가 다르면 실패한다.
//   npx tsx scripts/world-vocab-doc.ts          문서 표를 다시 쓴다
//   npx tsx scripts/world-vocab-doc.ts --check  다르면 1로 끝난다
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTwin } from "../src/model/devices.js";
import { deviceStateKeys, deviceText } from "../src/world/relations.js";
import { CLASS_DOC, DEVICE_LONG_DOC, DEVICE_STATE_DOC, STATE_DOC } from "../src/world/vocab-doc.js";
import { CLASSES, DEVICE_LONG, DEVICE_STATES, STATES, type ClassKey, type DeviceStateKey, type StateKey } from "../src/world/vocab.js";

export const DOC_PATH = fileURLToPath(new URL("../docs/world-vocabulary.md", import.meta.url));
/** 문서 가전 표의 집. */
export const DOC_HOME = "mokryeon_180b";

const ROLE = { person: "사람", object: "물건", fixture: "가전 설비", scene: "가구, 거름" } as const;
const FACET = { place: "자리", contents: "안 내용", open: "열림", use: "쓰는 중", screen: "화면", posture: "자세", holding: "들고 있음", activity: "하는 일", moment: "순간 동작" } as const;
const TARGET = { person: "사람", object: "물건", fixture: "가전 설비" } as const;
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const code = (s: string) => `\`${s}\``;

function classes(): string {
  return table(["키", "한국어", "역할", "YOLO26n COCO", "최소 신뢰도", "면", "계기 예"], (Object.keys(CLASSES) as ClassKey[]).map((k) => {
    const c = CLASSES[k];
    const coco = Object.entries(c.coco).map(([n, name]) => `${n} ${name}`).join(", ");
    return [code(k), c.label, ROLE[c.role], coco, c.role === "scene" ? "—" : c.minScore, c.facets.map((f) => FACET[f]).join(", ") || "—", CLASS_DOC[k] ?? "—"];
  }));
}

function states(): string {
  return table(["키", "한국어", "면", "대상", "보는 방법", "계기 예"], (Object.keys(STATES) as StateKey[]).map((k) => {
    const s = STATES[k];
    const d = STATE_DOC[k];
    const src = s.facet === "posture" || s.facet === "holding" || k === "in_hand" ? "관절·VLM" : "VLM";
    return [code(k), s.label, FACET[s.facet], s.for.map((t) => TARGET[t]).join(", "), d.how ? `${src}, ${d.how}` : src, d.example];
  }));
}

function devices(): string {
  const rows = (Object.keys(DEVICE_STATES) as DeviceStateKey[]).map((k) => {
    const s = DEVICE_STATES[k];
    return [code(k), `${s.attr} = ${String(s.value)}`, s.label, s.became, s.active ? "예" : "아니오", DEVICE_STATE_DOC[k]];
  });
  const long = Object.entries(DEVICE_LONG).map(([k, l]) => [code(k), `${l.state} ${l.afterMs / 1000}초 넘게`, "—", l.label, "—", `${DEVICE_LONG_DOC[k as keyof typeof DEVICE_LONG_DOC]} 종류: ${l.kinds.join(", ")}`]);
  return table(["키", "트윈 속성", "상태 글", "사건 글", "늘 보임", "계기 예"], [...rows, ...long]);
}

function home(): string {
  const twin = loadTwin(undefined, { home: DOC_HOME });
  return table(["가전 id", "이름", "종류", "상태 키", "사건 줄"], twin.devices.map((d) => {
    const keys = Object.entries(d.twinAttrs).flatMap(([attr, values]) => values.flatMap((v) => deviceStateKeys(d.kind, { [attr]: v })));
    const events = keys.map((k) => `${d.label} ${deviceText(d.kind, k).became}`);
    const long = Object.values(DEVICE_LONG).filter((l) => (l.kinds as readonly string[]).includes(d.kind)).map((l) => `${d.label} ${l.label}`);
    return [code(d.id), d.label, d.kind, keys.map(code).join(", "), [...events, ...long].join(", ")];
  }));
}

function rooms(): string {
  const twin = loadTwin(undefined, { home: DOC_HOME });
  return table(["방 id", "이름"], twin.rooms.map((r) => [code(r.id), r.label]));
}

export function renderTables(): Record<string, string> {
  return { classes: classes(), states: states(), rooms: rooms(), devices: devices(), home: home() };
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
