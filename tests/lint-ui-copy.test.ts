// 화면 글 검사(scripts/lint-ui-copy.ts): 생각 과정·구현 설명이 화면에 들어가면 실패한다. 예시는 실제로 화면에 들어갔던 글이다.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blurbSlots, copyRules, htmlCopy, jsCopy, lintUiCopy } from "../scripts/lint-ui-copy.js";

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

describe("web/ 전체", () => {
  it("화면 글 검사에 걸리는 곳이 없다(npm run lint)", () => {
    const problems = lintUiCopy(fileURLToPath(new URL("../web/", import.meta.url)));
    expect(problems.map((p) => `web/${p.file}:${p.line} [${p.rule}] ${p.text}`)).toEqual([]);
  });
});
