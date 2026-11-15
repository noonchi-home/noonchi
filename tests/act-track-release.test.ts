// 켠 위험 가전 추적(hot·끄기 안내)을 푸는 길은 하나다(src/act/track.ts): 추적은 releaseIfOff로만 풀고, 작동 끝남은 cycleEnded로만 본다.
// 구조 검사: hot·끄기 안내를 지우는 코드는 releaseIfOff·handOver·nextReminder 몸통 안에만, 가전 이력을 보는 코드는 cycleEnded 몸통 안에만 있어야 한다.
// 과거 실수(79ff269의 onAnswer·onHeard·reminderTick·advance가 「완료」·말·만료·끄기 단계 넘김으로 풀었다)에서 실패하는지도 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WHY = "추적은 releaseIfOff로만 풀고, 작동 끝남은 cycleEnded로만 본다";
/** 지우는 코드와 그 코드를 둘 수 있는 몸통. */
const RULES: { pattern: RegExp; inside: readonly string[] }[] = [
  { pattern: /\bhot\.delete\(/g, inside: ["releaseIfOff", "handOver", "nextReminder"] },
  { pattern: /\bhot\.clear\(/g, inside: ["releaseIfOff", "handOver", "nextReminder"] },
  { pattern: /this\.reminder\s*=\s*null/g, inside: ["releaseIfOff", "handOver", "nextReminder"] },
  { pattern: /\boffQueue\.splice\(/g, inside: ["releaseIfOff", "handOver", "nextReminder"] },
  { pattern: /\boffQueue\.shift\(/g, inside: ["releaseIfOff", "handOver", "nextReminder"] },
  { pattern: /\boffSince\(/g, inside: ["cycleEnded"] },
  { pattern: /\bhistory\.some\(/g, inside: ["cycleEnded"] },
];

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

/** 메서드·함수 몸통 범위: 「이름(」 정의 줄의 첫 { 부터 짝이 맞는 } 까지. */
function bodies(src: string, name: string): [number, number][] {
  const out: [number, number][] = [];
  const def = new RegExp(String.raw`(?:private|public|function)\s+${name}\s*\(`, "g");
  for (let m = def.exec(src); m; m = def.exec(src)) {
    const open = src.indexOf("{", m.index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.push([open, i]);
        break;
      }
    }
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

describe("켠 위험 가전 추적을 푸는 길(구조)", () => {
  it("src/act/track.ts: hot·끄기 안내를 지우는 코드는 releaseIfOff·handOver·nextReminder 안에만, 가전 이력은 cycleEnded 안에서만 본다", () => {
    expect(releaseLeaks(readFileSync(join(ROOT, "src", "act", "track.ts"), "utf8")), WHY).toEqual([]);
  });

  it("과거 실수(79ff269의 track.ts: onAnswer·onHeard·reminderTick·advance가 「완료」·말·만료·끄기 단계 넘김으로 풀었다)에서는 실패한다", () => {
    const old = readFileSync(join(ROOT, "tests", "fixtures", "release", "track-79ff269.txt"), "utf8");
    const leaks = releaseLeaks(old).join("\n");
    expect(leaks).toMatch(/this\.reminder = null/);
    expect(leaks).toMatch(/hot\.delete\(/);
    expect(leaks).toMatch(/offSince\(/);
  });
});
