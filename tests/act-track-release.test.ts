// 켠 위험 가전 추적(hot·끄기 안내)을 푸는 길은 하나다(src/act/track/safety.ts SafetyTracker): 추적은 releaseIfOff로만 풀고, 작동 끝남은 cycleEnded로만 본다.
// 구조 검사: 실행 추적 폴더(src/act/track/) 파일 전체에서 hot·끄기 안내를 지우는 코드는 releaseIfOff·handOver·nextReminder 몸통 안에만,
// 가전 이력을 보는 코드는 cycleEnded 몸통 안에만 있어야 한다. 지우는 코드는 받는 쪽 이름과 상관없이 찾는다(this.·r.·core.safety.·#).
// 추적 상태(hot·reminder·offQueue·cycles·released)는 SafetyTracker의 # 비공개 칸에만 두고, 부분이 함께 받는 TrackCore·계획 실행 상태 Run·다른 부분에는 두지 않는다.
// 과거 실수(79ff269의 onAnswer·onHeard·reminderTick·advance가 「완료」·말·만료·끄기 단계 넘김으로 풀었다)에서 실패하는지도 본다:
// 79ff269의 track.ts 그대로, 그리고 그 실수 줄을 지금 steps.ts·answers.ts·tracker.ts·safety.ts·core.ts(TrackCore)에 하나씩 넣은 자료.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TRACK_DIR = join(ROOT, "src", "act", "track");
const WHY = "추적은 releaseIfOff로만 풀고, 작동 끝남은 cycleEnded로만 본다";
const RELEASE = ["releaseIfOff", "handOver", "nextReminder"] as const;
/** 지우는 코드(받는 쪽 이름과 상관없이)와 그 코드를 둘 수 있는 몸통. */
const RULES: { pattern: RegExp; inside: readonly string[] }[] = [
  { pattern: /\bhot\.delete\(/g, inside: RELEASE },
  { pattern: /\bhot\.clear\(/g, inside: RELEASE },
  { pattern: /\breminder\s*=(?!=)\s*null\b/g, inside: RELEASE },
  { pattern: /\boffQueue\.splice\(/g, inside: RELEASE },
  { pattern: /\boffQueue\.shift\(/g, inside: RELEASE },
  { pattern: /\boffSince\(/g, inside: ["cycleEnded"] },
  { pattern: /\bhistory\.some\(/g, inside: ["cycleEnded"] },
];
/** 추적 상태 이름: SafetyTracker의 # 비공개 칸에만 둔다. */
const STATE = ["hot", "reminder", "offQueue", "cycles", "released"] as const;

/** 실행 추적 폴더의 파일 전체(이름 차례). */
const trackFiles = () => readdirSync(TRACK_DIR).filter((f) => f.endsWith(".ts")).sort();
const readTrack = (f: string) => readFileSync(join(TRACK_DIR, f), "utf8");

/** 주석을 같은 길이의 빈칸으로 바꾼다(줄 번호를 지키려고 줄바꿈은 둔다). 글 안의 //는 건드리지 않게 따옴표·백틱 글은 건너뛴다. */
function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (src.startsWith("//", i)) {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? src.length : j;
      out += " ".repeat(end - i);
      i = end;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** open 자리의 여는 괄호와 짝이 맞는 닫는 괄호 자리. 없으면 -1. */
function closing(src: string, open: number, a: string, b: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === a) depth++;
    else if (src[i] === b && --depth === 0) return i;
  }
  return -1;
}

/** 메서드·함수 몸통 범위: 줄 첫머리의 정의(꾸밈말·function·# 붙어도 됨) 「이름(인자): 돌려줄 타입 {」의 { 부터 짝이 맞는 } 까지. 부르는 줄은 정의가 아니다. */
function bodies(src: string, name: string): [number, number][] {
  const out: [number, number][] = [];
  const def = new RegExp(String.raw`(?:^|\n)[ \t]*(?:(?:export|private|public|protected|static|async|function)\s+)*#?${name}\s*\(`, "g");
  for (let m = def.exec(src); m; m = def.exec(src)) {
    const params = closing(src, m.index + m[0].length - 1, "(", ")");
    const head = params < 0 ? null : /^\s*(?::[^;{}()=]*)?\{/.exec(src.slice(params + 1));
    if (!head) continue;
    const open = params + 1 + head[0].length - 1;
    const end = closing(src, open, "{", "}");
    if (end > 0) out.push([open, end]);
  }
  return out;
}

/** 규칙을 어긴 자리(줄 번호와 그 줄). */
export function releaseLeaks(source: string): string[] {
  const src = stripComments(source);
  const lineOf = (pos: number) => src.slice(0, pos).split("\n").length;
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  for (const rule of RULES) {
    const allowed = rule.inside.flatMap((n) => bodies(src, n));
    rule.pattern.lastIndex = 0;
    for (let m = rule.pattern.exec(src); m; m = rule.pattern.exec(src)) {
      if (allowed.some(([a, b]) => m!.index > a && m!.index < b)) continue;
      const line = lineOf(m.index);
      out.push(`${line}: ${lines[line - 1]!.trim()}`);
    }
  }
  return out;
}

/** 파일의 클래스·인터페이스마다 바로 아래 칸 이름(# 붙은 것은 #까지). 안쪽 { } 속(메서드 몸통·타입 글)은 보지 않는다. */
export function members(source: string): Map<string, string[]> {
  const src = stripComments(source);
  const out = new Map<string, string[]>();
  const head = /\b(?:class|interface)\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  for (let m = head.exec(src); m; m = head.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closing(src, open, "{", "}");
    if (end < 0) continue;
    let flat = "";
    let depth = 0;
    for (const c of src.slice(open + 1, end)) {
      if (c === "{") depth++;
      if (depth === 0) flat += c;
      if (c === "}") depth--;
    }
    const names = flat.split(/[;\n]/).flatMap((part) => {
      const x = /^\s*(?:(?:public|private|protected|readonly|static|declare|abstract|override|get|set|async)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*[:=(<]/.exec(part);
      return x ? [x[1]!] : [];
    });
    out.set(m[1]!, names);
  }
  return out;
}

/** 추적 상태를 둔 자리 가운데 규칙(SafetyTracker의 # 칸) 밖인 것: 「클래스.칸」. SafetyTracker에 # 칸이 빠졌으면 「SafetyTracker.#칸 없음」. */
export function stateLeaks(files: Record<string, string>): string[] {
  const out: string[] = [];
  let safety: string[] | undefined;
  for (const src of Object.values(files)) {
    for (const [cls, names] of members(src)) {
      if (cls === "SafetyTracker") safety = names;
      for (const n of names) if ((STATE as readonly string[]).includes(n) || (cls !== "SafetyTracker" && (STATE as readonly string[]).includes(n.slice(1)) && n.startsWith("#"))) out.push(`${cls}.${n}`);
    }
  }
  for (const s of STATE) if (!safety?.includes(`#${s}`)) out.push(`SafetyTracker.#${s} 없음`);
  return out;
}

/** method 몸통 첫머리에 줄을 넣는다(과거 실수를 지금 파일에 넣은 자료). 그 메서드가 파일에 꼭 하나여야 한다. */
function inject(source: string, method: string, lines: readonly string[]): string {
  const found = bodies(stripComments(source), method);
  if (found.length !== 1) throw new Error(`${method} 몸통이 ${found.length}개예요`);
  const open = found[0]![0];
  return `${source.slice(0, open + 1)}\n    ${lines.join("\n    ")}${source.slice(open + 1)}`;
}

describe("켠 위험 가전 추적을 푸는 길(구조)", () => {
  it("src/act/track/ 파일 전체: hot·끄기 안내를 지우는 코드는 releaseIfOff·handOver·nextReminder 안에만, 가전 이력은 cycleEnded 안에서만 본다", () => {
    const files = trackFiles();
    // 엉뚱한 폴더를 보고 통과하지 않게: 부분 파일과 푸는 몸통이 있어야 한다
    expect(files).toEqual(expect.arrayContaining(["core.ts", "tracker.ts", "start.ts", "steps.ts", "approval.ts", "safety.ts", "answers.ts", "coach.ts"]));
    const safety = stripComments(readTrack("safety.ts"));
    for (const n of [...RELEASE, "cycleEnded"]) expect(bodies(safety, n), `safety.ts ${n}`).toHaveLength(1);
    const leaks = files.flatMap((f) => releaseLeaks(readTrack(f)).map((l) => `${f}:${l}`));
    expect(leaks, WHY).toEqual([]);
  });

  it("추적 상태(hot·reminder·offQueue·cycles·released)는 SafetyTracker의 # 비공개 칸에만 있다(TrackCore·Run·다른 부분에는 없다)", () => {
    const files = Object.fromEntries(trackFiles().map((f) => [f, readTrack(f)]));
    expect(members(files["core.ts"]!).has("TrackCore")).toBe(true);
    expect(members(files["core.ts"]!).has("Run")).toBe(true);
    expect(stateLeaks(files), WHY).toEqual([]);
  });

  it("과거 실수(79ff269의 track.ts: onAnswer·onHeard·reminderTick·advance가 「완료」·말·만료·끄기 단계 넘김으로 풀었다)에서는 실패한다", () => {
    const old = readFileSync(join(ROOT, "tests", "fixtures", "release", "track-79ff269.txt"), "utf8");
    const leaks = releaseLeaks(old).join("\n");
    expect(leaks).toMatch(/this\.reminder = null/);
    expect(leaks).toMatch(/hot\.delete\(/);
    expect(leaks).toMatch(/offSince\(/);
  });

  /** 79ff269의 실수 줄을 지금 파일의 그 일을 하는 메서드에 넣는다(받는 쪽 이름은 지금 구조대로 여러 가지). */
  const PAST: { file: string; method: string; lines: string[] }[] = [
    // 끄기 단계를 넘기면(advance) hot에서 뺐다. 닫힐 때(finish) hot을 비웠다
    { file: "steps.ts", method: "advance", lines: ['if (done?.kind === "do" && done.hand?.to === "off") r.hot.delete(done.hand.deviceId);'] },
    { file: "steps.ts", method: "finish", lines: ["this.core.safety.hot.clear();"] },
    // 끄기 안내의 「완료」(onAnswer)와 말(onHeard)로 안내를 지웠다
    { file: "answers.ts", method: "onAnswer", lines: ["this.core.safety.reminder = null;"] },
    { file: "answers.ts", method: "onHeard", lines: ["safety.offQueue.shift();"] },
    // 주기 보기(tick)에서 켜라고 한 뒤 본 꺼짐(가전 이력)이나 만료로 안내를 지웠다
    { file: "tracker.ts", method: "tick", lines: ["if (offSince(d, off.note.onAt) || now - off.at > core.cfg.offHoldMs) core.safety.offQueue.splice(0, 1);"] },
    // reminderTick이 만료로 안내를 지웠다(SafetyTracker 안이어도 푸는 몸통 밖)
    { file: "safety.ts", method: "reminderTick", lines: ["if (d.history.some((h) => h.to === \"off\")) this.#reminder = null;"] },
    // 부분이 함께 받는 TrackCore가 상태를 바꿀 때 추적을 비웠다
    { file: "core.ts", method: "step", lines: ["this.safety.hot.clear();"] },
  ];
  for (const p of PAST) {
    it(`과거 실수를 ${p.file} ${p.method}에 넣으면 실패한다: ${p.lines.join(" ")}`, () => {
      const now = readTrack(p.file);
      expect(releaseLeaks(now)).toEqual([]);
      const leaks = releaseLeaks(inject(now, p.method, p.lines));
      expect(leaks.length).toBeGreaterThan(0);
      for (const l of leaks) expect(p.lines.some((x) => l.endsWith(x))).toBe(true);
    });
  }

  it("과거 실수(hot을 계획 실행 상태 Run에, 끄기 안내를 TrackCore에 다시 둠)에서는 실패한다", () => {
    const files = Object.fromEntries(trackFiles().map((f) => [f, readTrack(f)]));
    const core = files["core.ts"]!;
    const withRun = core.replace(/export interface Run \{/, "export interface Run {\n  hot: Set<string>;");
    const withCore = core.replace(/export class TrackCore \{/, "export class TrackCore {\n  reminder: unknown = null;");
    expect(withRun).not.toBe(core);
    expect(withCore).not.toBe(core);
    expect(stateLeaks({ ...files, "core.ts": withRun })).toEqual(["Run.hot"]);
    expect(stateLeaks({ ...files, "core.ts": withCore })).toEqual(["TrackCore.reminder"]);
    const safety = files["safety.ts"]!.replace(/#hot\b/g, "hot");
    expect(stateLeaks({ ...files, "safety.ts": safety })).toEqual(["SafetyTracker.hot", "SafetyTracker.#hot 없음"]);
  });
});
