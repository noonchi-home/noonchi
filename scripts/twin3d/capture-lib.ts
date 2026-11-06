// capture.ts가 쓰는 작은 도우미(시험할 수 있게 따로 둔다).

/** p가 ms 안에 끝나지 않으면 오류. 끝나면 타이머를 끈다(남은 타이머가 캡처 프로세스를 붙잡지 않게). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`시간 초과(${ms / 1000}초): ${label}`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** 옛 뷰어(window.aptViewer)에서 보기 하나를 맞추는 식. overview·room:<id>만 된다. */
export function legacyView(spec: string): string {
  if (spec === "overview") return "window.aptViewer.focusRoom(null)";
  const room = /^room:(.+)$/.exec(spec)?.[1];
  if (room) return `window.aptViewer.focusRoom(${JSON.stringify(room)})`;
  throw new Error(`옛 화면은 overview·room:<id>만 돼요: ${spec}`);
}
