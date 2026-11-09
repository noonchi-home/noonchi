// capture.ts가 쓰는 작은 도우미(시험할 수 있게 따로 둔다).

/** p가 ms 안에 끝나지 않으면 오류. 끝나면 타이머를 끈다(남은 타이머가 캡처 프로세스를 붙잡지 않게). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`시간 초과(${ms / 1000}초): ${label}`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** 옛 뷰어: browser-check.mjs loaded(m)과 같은 준비 조건. */
const LEGACY_READY = "Boolean(window.aptViewer && (window.aptViewer.results.error || (window.aptViewer.results.mode === window.aptViewer.mode && !window.aptViewer.loading)))";

/**
 * 다 불러왔다고 보는 식(크롬에서 돌린다). 기본은 새 엔진(window.__twin3d.ready), legacy는 옛 뷰어(window.aptViewer).
 * selector(--ready)면 페이지 불러오기가 끝나고(document.readyState complete) 그 CSS 선택자에 맞는 요소가 있을 때: React 대시보드처럼 엔진 객체가 없는 페이지.
 */
export function readyCheck(o: { legacy?: boolean; selector?: string }): string {
  if (o.selector === undefined) return o.legacy ? LEGACY_READY : "Boolean(window.__twin3d?.ready)";
  if (o.legacy) throw new Error("--legacy와 --ready는 같이 쓰지 않아요");
  if (!o.selector.trim()) throw new Error("--ready에는 CSS 선택자를 넣어요");
  return `document.readyState === "complete" && Boolean(document.querySelector(${JSON.stringify(o.selector)}))`;
}

/** --ready 페이지에서 되는 스크립트 줄은 shot:<이름>·wait:<ms>뿐이다. 다른 줄은 엔진(window.__twin3d)이 있어야 해서 크롬을 띄우기 전에 멈춘다. */
export function pageStep(step: string): void {
  const cmd = step.split(":")[0];
  if (cmd !== "shot" && cmd !== "wait") throw new Error(`--ready 페이지는 shot·wait 줄만 돼요: ${step}`);
}

/** --script가 없을 때의 줄: --views 이름마다 엔진 페이지는 view+shot, --ready 페이지(page)는 shot 한 장. */
export function stepsOf(views: string[], page: boolean): string[] {
  return views.flatMap((v) => (page ? [`shot:${v}`] : [`view:${v}`, `shot:${v}`]));
}

/** 옛 뷰어(window.aptViewer)에서 보기 하나를 맞추는 식. overview·room:<id>만 된다. */
export function legacyView(spec: string): string {
  if (spec === "overview") return "window.aptViewer.focusRoom(null)";
  const room = /^room:(.+)$/.exec(spec)?.[1];
  if (room) return `window.aptViewer.focusRoom(${JSON.stringify(room)})`;
  throw new Error(`옛 화면은 overview·room:<id>만 돼요: ${spec}`);
}
