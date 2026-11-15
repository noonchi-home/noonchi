// 영상 모드(폰 페이지 ?clip=)는 카메라 입력만 다르고 지시·완료 판단·트윈 반영은 실제 모드와 같다(마이크 듣기만 끈다).
// 구조 검사: 영상 모드 갈래가 있는 코드 줄마다 그 줄이나 바로 위 줄에 허용 목록 표시 `영상 모드: <갈래>`가 있어야 한다.
// 허용 갈래: 카메라 입력(영상을 프레임으로 씀·WebXR 없이 시작·영상 연결 표시), 자세 흉내(고정 시작 자세·go 걷기), 단계 영상, held(붙잡은 장면),
// 시험 기록(window.__noonchiVideo), 듣기 끔. 소리 읽기·명령·승인·완료 판단·트윈 반영을 영상 모드에서 따로 두면 표시를 달 수 없어 실패한다.
// 영상 모드 갈래가 없어야 하는 파일(소리·실행 추적·서버 묶음·폰 화면)에 갈래가 생겨도 실패한다.
// 영상 모드인지 아는 길은 하나다: 주소의 clip은 video-ar.js의 videoParams만 읽고(ui/src 모든 파일), 그 값은 controller.ts의 `const video` 한 이름으로만
// 받으며 다른 이름으로 넘기지 않는다(별칭이 생기면 갈래를 좇을 수 없다). 허용 표시만으로는 막을 수 없는 동작 차이는
// ui/tests/phone-mode-parity.test.ts가 같은 대본을 실제 모드·영상 모드로 돌려 견준다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = ["카메라 입력", "자세 흉내", "단계 영상", "held", "시험 기록", "듣기 끔"] as const;
const WHY = "영상 모드는 카메라 입력만 다르고 지시·완료 판단·트윈 반영은 실제 모드와 같다(듣기만 끔)";

/** 영상 모드 갈래를 찾는 자리: 파일과 그 파일에서 영상 모드를 가리키는 말. skip은 갈래가 아닌 줄(모드를 읽는 선언). */
const SITES: { file: string; pattern: RegExp; skip?: RegExp }[] = [
  { file: "ui/src/phone/controller.ts", pattern: /\bvideo\b/, skip: /const video = videoParams\(params\);|^import / },
  { file: "ui/src/phone/state.ts", pattern: /\bautoStart\b/ },
  { file: "ui/src/phone/core/link.js", pattern: /\bvideo\b/ },
  { file: "src/phone/server.ts", pattern: /videoSession\(|engineHeader\(/ },
  { file: "src/phone/session.ts", pattern: /\.fixed\b/ },
  { file: "src/sync/aligner.ts", pattern: /fixStart\(|"video"/ },
  { file: "src/observe/pipeline.ts", pattern: /\.held\b/ },
];
/** 영상 모드 갈래가 없어야 하는 파일. */
const NONE: { file: string; pattern: RegExp }[] = [
  { file: "ui/src/phone/core/talk.js", pattern: /\bvideo\b|__noonchiVideo|\?clip/ },
  { file: "ui/src/phone/PhoneScreen.tsx", pattern: /\bvideo\b|__noonchiVideo|\?clip/ },
  { file: "src/act/track.ts", pattern: /\bvideo\b|videoSession|\.fixed\b/ },
  { file: "src/server/home.ts", pattern: /\bvideo\b|videoSession|\.fixed\b/ },
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

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
/** 그 줄의 허용 표시(`영상 모드: <갈래>`, 갈래 뒤는 글자가 아님). 없거나 허용 밖이면 null. */
const tagOf = (line: string) => ALLOWED.find((a) => new RegExp(`영상 모드: ${a}(?![가-힣A-Za-z])`).test(line)) ?? null;

/** 표시가 없거나 허용 밖인 영상 모드 갈래 줄(파일:줄 글). */
export function untaggedVideoBranches(file: string, source: string, pattern: RegExp, skip?: RegExp): string[] {
  const code = stripComments(source).split("\n");
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  code.forEach((c, i) => {
    if (!pattern.test(c) || (skip && skip.test(c))) return;
    if (!tagOf(lines[i] ?? "") && !tagOf(lines[i - 1] ?? "")) out.push(`${file}:${i + 1}: ${(lines[i] ?? "").trim()}`);
  });
  return out;
}

/** 주소의 clip을 읽는 코드(URLSearchParams get·has·getAll, ?clip=·&clip= 글). */
const CLIP_READ = /\.(?:get|has|getAll)\(\s*["'`]clip["'`]\s*\)|[?&]clip=/;
/** 영상 모드 값을 다른 이름으로 받거나 함수에 그대로 넘기는 코드(삼항·if·속성 읽기는 아님). */
const ALIAS = /\b(?:const|let|var)\s+\w+\s*=\s*video\b(?!\s*\?)|[^\w.]=\s*video\s*;|(?<!\bif\s?)\(\s*video\s*[,)]|,\s*video\s*[,)]/;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
});
const UI_FILES = () => walk(join(ROOT, "ui", "src")).map((p) => relative(ROOT, p).replace(/\\/g, "/"));

/** 함수 몸통 범위(정의 줄의 첫 { 부터 짝이 맞는 } 까지). */
function bodyOf(src: string, name: string): [number, number] | null {
  const m = new RegExp(String.raw`function\s+${name}\s*\(`).exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return [open, i];
  }
  return null;
}

/** clip을 videoParams 밖에서 읽는 줄(파일:줄 글). */
export function clipReadsOutside(file: string, source: string): string[] {
  const code = stripComments(source);
  const body = file.endsWith("phone/core/video-ar.js") ? bodyOf(code, "videoParams") : null;
  const out: string[] = [];
  let pos = 0;
  code.split("\n").forEach((line, i) => {
    const at = pos;
    pos += line.length + 1;
    if (!CLIP_READ.test(line)) return;
    if (body && at >= body[0] && at <= body[1]) return;
    out.push(`${file}:${i + 1}: ${source.split(/\r?\n/)[i]!.trim()}`);
  });
  return out;
}

/** 영상 모드 값의 별칭·그대로 넘기기 줄. */
export function videoAliases(file: string, source: string): string[] {
  return stripComments(source).split("\n").flatMap((line, i) => (ALIAS.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}

describe("영상 모드인지 아는 길은 하나다", () => {
  it("주소의 clip은 video-ar.js videoParams만 읽는다(ui/src 모든 파일)", () => {
    const bad = UI_FILES().flatMap((f) => clipReadsOutside(f, read(f)));
    expect(bad, WHY).toEqual([]);
  });

  it("videoParams는 controller.ts의 const video 하나로만 받고, 그 값을 다른 이름으로 받거나 함수에 그대로 넘기지 않는다", () => {
    const calls = UI_FILES().flatMap((f) => stripComments(read(f)).split("\n").flatMap((line, i) =>
      /\bvideoParams\(/.test(line) && !/function\s+videoParams\(/.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []));
    expect(calls.map((c) => c.replace(/:\d+:/, ":"))).toEqual(["ui/src/phone/controller.ts: const video = videoParams(params);"]);
    expect(videoAliases("ui/src/phone/controller.ts", read("ui/src/phone/controller.ts")), WHY).toEqual([]);
  });

  it("검사는 videoParams 밖의 clip 읽기와 영상 모드 값 별칭을 잡는다", () => {
    expect(clipReadsOutside("ui/src/phone/x.ts", 'const testing = new URLSearchParams(location.search).has("clip");')).toHaveLength(1);
    expect(clipReadsOutside("ui/src/phone/controller.ts", '  url: phoneSocketUrl(deps.location, video ? params.get("clip") : null),')).toHaveLength(1);
    expect(clipReadsOutside("ui/src/phone/core/video-ar.js", 'export function videoParams(params) {\n  const clip = params.get("clip");\n}\nconst again = params.get("clip");'))
      .toEqual(['ui/src/phone/core/video-ar.js:4: const again = params.get("clip");']);
    expect(videoAliases("c.ts", "const v = video;\nspeakFor(video);\nmode(1, video);\nif (video) go();\nconst x = video ? 1 : 2;\ncreate({ ...video, a });")).toEqual([
      "c.ts:1: const v = video;", "c.ts:2: speakFor(video);", "c.ts:3: mode(1, video);",
    ]);
  });
});

describe("영상 모드는 카메라 입력만 다르다", () => {
  it("영상 모드 갈래는 허용 목록(카메라 입력·자세 흉내·단계 영상·held·시험 기록·듣기 끔)뿐이다", () => {
    const bad = SITES.flatMap((s) => untaggedVideoBranches(s.file, read(s.file), s.pattern, s.skip));
    expect(bad, WHY).toEqual([]);
  });

  it("소리·폰 화면·실행 추적·서버 묶음에는 영상 모드 갈래가 없다", () => {
    const bad = NONE.flatMap((s) => stripComments(read(s.file)).split("\n").flatMap((c, i) => (s.pattern.test(c) ? [`${s.file}:${i + 1}`] : [])));
    expect(bad, WHY).toEqual([]);
  });

  it("검사는 예전처럼 영상 모드에서 소리 읽기를 끄는 갈래를 잡는다", () => {
    const old = [
      "  const video = videoParams(params);",
      "  // 영상 모드: 카메라 입력",
      "  const ar = video ? createVideoAr() : createAr();",
      "  const speak = video ? (_text: string, done: () => void) => done() : deps.speak ?? speakAloud;",
    ].join("\n");
    expect(untaggedVideoBranches("controller.ts", old, /\bvideo\b/, /const video = videoParams\(params\);/)).toEqual([
      "controller.ts:4: const speak = video ? (_text: string, done: () => void) => done() : deps.speak ?? speakAloud;",
    ]);
  });
});
