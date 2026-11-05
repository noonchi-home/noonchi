import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest globals를 쓰지 않으므로 Testing Library가 스스로 지우지 못한다. 시험마다 그린 화면을 내린다.
afterEach(() => { cleanup(); });

// jsdom에는 matchMedia가 없다. 움직임 줄이기를 켠 화면으로 본다(부품이 Element.animate를 부르지 않는다).
// node 환경 시험(@vitest-environment node)에는 window가 없으니 건너뛴다.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: query.includes("prefers-reduced-motion"), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList;
}

// motion 움직임은 바로 끝난 상태로 그린다(처음 opacity 0에 머물지 않게).
import { MotionGlobalConfig } from "motion/react";
MotionGlobalConfig.skipAnimations = true;
