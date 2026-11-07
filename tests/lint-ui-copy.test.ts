// 화면 글 검사(scripts/lint-ui-copy.ts): 생각 과정·구현 설명이 화면에 들어가면 실패한다. 예시는 실제로 화면에 들어갔던 글이다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COPY_TARGETS, blurbSlots, copyFiles, copyRules, fileCopy, htmlCopy, jsCopy, lintUiCopy, tsxCopy } from "../scripts/lint-ui-copy.js";

const webDir = fileURLToPath(new URL("../web/", import.meta.url));
const uiDir = fileURLToPath(new URL("../ui/src/", import.meta.url));

describe("화면 글 규칙", () => {
  it("실제로 들어갔던 글을 잡는다", () => {
    expect(copyRules("집 → 가전 → 위치 동기화 → 대시보드")).toEqual(["흐름 나열"]);
    expect(copyRules("설정에서 고른 집(twin-studio homes.json)")).toEqual(["괄호 설명", "구현 이름"]);
    expect(copyRules("검색해서 추가한 가전만 가상(트윈 시뮬레이터 값)으로 상태를 읽어요. 추가하지 않은 가전은 신호 없음이라 상태를 「모름」으로 두고, 클로이드가 사진이나 질문으로 알아내요.")).toEqual(["괄호 설명", "긴 설명"]);
    expect(copyRules("폰 카메라 실시간 · 엔진 입력 아님")).toEqual(["구현 이름"]);
    expect(copyRules("폰 AR 서버가 꺼져 있어요. PHONE_PORT를 주고 서버를 켜면 폰 카메라 화면이 여기에 보여요.")).toContain("구현 이름");
    expect(blurbSlots('<span class="sub">트윈 · 클로이드의 눈 · 추론 과정</span>').map((s) => s.text)).toEqual(["sub"]);
    expect(blurbSlots('el("p", { class: "help" }, "건너뛰어도 돼요.")').map((s) => s.text)).toEqual(["help"]);
  });

  it("할 일·상태만 있는 짧은 글은 통과한다", () => {
    for (const ok of ["어느 집을 쓸까요?", "모두 추가 (…)", "추가 3 · 신호 없음 62", "폰이 연결되지 않았어요.", "아직 추가한 가전이 없어요. 위에서 검색해서 추가하세요."]) {
      expect(copyRules(ok)).toEqual([]);
    }
    expect(blurbSlots('<p class="subtle-x touch-pos">미지정</p>')).toEqual([]);
  });
});

describe("화면 글 꺼내기", () => {
  it("HTML: 주석·script는 빼고, <b> 같은 꾸밈 태그는 풀어서 한 문단으로", () => {
    const got = htmlCopy('<!-- 주석 → -->\n<p class="x">추가한 <b>가상</b> 가전</p>\n<script>const a = "스크립트";</script>\n<input placeholder="가전 검색">\n<span id="home" class="badge" title="설정에서 고른 집(twin-studio homes.json)">집 -</span>');
    expect(got.map((c) => c.text).sort()).toEqual(["가전 검색", "설정에서 고른 집(twin-studio homes.json)", "집 -", "추가한 가상 가전"]);
  });

  it("JS: 주석·console·정규식은 빼고 문자열과 템플릿 글을 꺼낸다", () => {
    const src = [
      "// 주석 → 은 화면 글이 아니다",
      'const re = /["가]/g;',
      'console.warn("개발 로그 → 무시");',
      'el("p", {}, `${n}개 찾았어요`);',
      'const s = "보내기";',
    ].join("\n");
    expect(jsCopy(src).map((c) => c.text)).toEqual(["…개 찾았어요", "보내기"]);
  });
});

describe("TSX 글 꺼내기", () => {
  it("JSX 글의 흐름 나열·괄호 설명을 잡는다", () => {
    const src = `export const A = () => <p className="x">집 → 가전 → 위치 동기화 → 대시보드</p>;\nexport const B = () => <span title="엔진 입력 아님">눈</span>;`;
    const texts = tsxCopy(src).map((c) => c.text);
    expect(texts).toContain("집 → 가전 → 위치 동기화 → 대시보드");
    expect(texts).toContain("엔진 입력 아님");
    expect(copyRules("집 → 가전 → 위치 동기화 → 대시보드")).toContain("흐름 나열");
  });

  it("JSX 식 안의 화살표 함수(=>)는 글이 아니다", () => {
    expect(tsxCopy(`const f = () => <b>{items.map((x) => x)}</b>;`)).toEqual([]);
    expect(tsxCopy(`const f = () => <p>{items.map((x) => <b key={x}>{x}</b>)}개 남음</p>;`).map((c) => c.text)).toEqual(["…개 남음"]);
  });

  it("JSX 글: {식}은 「…」로, 꾸밈 태그는 풀어서 한 덩어리로, 식 안 문자열·JSX도 꺼낸다", () => {
    const src = [
      "const C = ({ n, on }: { n: number; on: boolean }) => (",
      '  <section aria-label="가전 목록">',
      "    {/* 주석 → 은 화면 글이 아니다 */}",
      "    <p>추가한 <b>가상</b> 가전 {n}개</p>",
      '    {on ? <span>켜짐</span> : "꺼짐"}',
      '    <p>집 {"→"} 가전</p>',
      '    <Step label="집 고르기" hint={`${n}단계`} />',
      "    <p>Don't 걱정 // 주석 아님</p>",
      "  </section>",
      ");",
    ].join("\n");
    expect(tsxCopy(src).map((c) => c.text).sort()).toEqual(
      ["가전 목록", "추가한 가상 가전 …개", "켜짐", "꺼짐", "집 → 가전", "집 고르기", "…단계", "Don't 걱정 // 주석 아님"].sort(),
    );
  });

  it("TS 꺾쇠(제네릭·비교)는 JSX로 보지 않는다", () => {
    const src = [
      'const [s, setS] = useState<string>("대기");',
      "const ok = a < b && c > d;",
      'const m = new Map<string, number>(); const t = "상태";',
    ].join("\n");
    expect(tsxCopy(src).map((c) => c.text)).toEqual(["대기", "상태"]);
  });

  it("JSX 글의 줄 번호", () => {
    expect(tsxCopy("const A = () => (\n  <div>\n    <p>지금 상태</p>\n  </div>\n);")).toEqual([{ text: "지금 상태", line: 3 }]);
  });
});

describe("web/(폰)과 ui/src 전체", () => {
  it("ui/src의 .tsx·.ts를 본다(.d.ts·tests/는 뺀다)", () => {
    const files = copyFiles([webDir, uiDir]);
    expect(files.some((f) => f.endsWith(".tsx"))).toBe(true);
    expect(files.some((f) => /\.d\.ts$|[\\/]tests[\\/]/.test(f))).toBe(false);
  });

  it("화면 글 검사에 걸리는 곳이 없다(npm run lint)", () => {
    const problems = lintUiCopy(COPY_TARGETS);
    expect(problems.map((p) => `${p.file}:${p.line} [${p.rule}] ${p.text}`)).toEqual([]);
  });
});

describe("서버가 화면에 그대로 내보내는 계획 글(src/plan/labels.ts)", () => {
  const labels = fileURLToPath(new URL("../src/plan/labels.ts", import.meta.url));
  const worldLabels = fileURLToPath(new URL("../src/world/labels.ts", import.meta.url));
  const historyLabels = fileURLToPath(new URL("../src/history/labels.ts", import.meta.url));
  it("npm run lint가 web/·ui/src와 함께 본다", () => {
    expect(COPY_TARGETS).toEqual([webDir, uiDir, labels, worldLabels, historyLabels]);
    expect(copyFiles([labels])).toEqual([labels]);
  });
  it("World State 글(src/world/labels.ts)도 꺼내 검사한다. 괄호·화살표는 템플릿 글에도 없다", () => {
    const texts = fileCopy(worldLabels, readFileSync(worldLabels, "utf8")).map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["사람", "컵", "식탁 위", "… 보임…", "… 시야 밖", "요청이 몰려 VLM 분석 없음", "감지 오류로 YOLOX 분석 없음", "요청이 몰려 YOLOX·VLM 분석 없음"]));
    expect(lintUiCopy([worldLabels])).toEqual([]);
    expect(texts.filter((t) => /[()→]/.test(t))).toEqual([]);
  });
  it("기록 글(src/history/labels.ts)도 꺼내 검사한다. 괄호·화살표는 템플릿 글에도 없다", () => {
    const texts = fileCopy(historyLabels, readFileSync(historyLabels, "utf8")).map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["실제 모드", "진행 중", "판단 실패: …"]));
    expect(lintUiCopy([historyLabels])).toEqual([]);
    expect(texts.filter((t) => /[()→]/.test(t))).toEqual([]);
  });
  it("단계·목표·기기 동작 글을 꺼낸다", () => {
    const texts = fileCopy(labels, readFileSync(labels, "utf8")).map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["식탁으로 가기", "컵 치우기", "켜기"]));
  });
  it("파일 하나를 줘도 검사한다", () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-home-labels-"));
    try {
      const file = join(dir, "labels.ts");
      writeFileSync(file, 'export const STEP_LABEL = { goTable: "식탁 → 싱크대" };\n', "utf8");
      expect(lintUiCopy([file]).map((p) => p.rule)).toEqual(["흐름 나열"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
