type Screen =
  | { kind: "launch" }
  | { kind: "scan"; message?: string }
  | { kind: "checking" }
  | { kind: "dashboard"; url: string; opening: boolean; message?: string };

type DashboardView = { active: boolean; cameraEpoch: number; screen: Screen };
type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};
type Dependencies = {
  connect: (raw: string, options?: { signal?: AbortSignal }) => Promise<string>;
  open: (url: string, options: { signal: AbortSignal }) => Promise<void>;
  clock?: Clock;
  /** 로딩 화면을 보이는 최소 시간(기본 MIN_LAUNCH_MS). */
  minLaunchMs?: number;
};

/** 로딩 화면은 앱이 켜진 뒤 최소 2초 보인다. 준비가 더 걸리면 준비된 때 넘어간다. */
export const MIN_LAUNCH_MS = 2_000;

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function createDashboardFlow(deps: Dependencies, active = true) {
  const clock = deps.clock ?? systemClock;
  const launchedAt = clock.now();
  const minLaunchMs = deps.minLaunchMs ?? MIN_LAUNCH_MS;
  let launchTimer: unknown;
  let view: DashboardView = { active, cameraEpoch: 0, screen: { kind: "launch" } };
  let operation: AbortController | undefined;
  const listeners = new Set<() => void>();

  function update(changes: Partial<DashboardView>) {
    view = { ...view, ...changes };
    for (const listener of listeners) listener();
  }

  function acceptsCamera(epoch: number) {
    return view.active && view.cameraEpoch === epoch && view.screen.kind === "scan" && !view.screen.message;
  }

  return {
    view: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** 앱이 준비됐다. 켜진 지 minLaunchMs가 안 됐으면 그때까지 로딩 화면을 둔다. */
    finishLaunch() {
      if (view.screen.kind !== "launch" || launchTimer !== undefined) return;
      const leave = () => { if (view.screen.kind === "launch") update({ screen: { kind: "scan" } }); };
      const wait = launchedAt + minLaunchMs - clock.now();
      if (wait > 0) launchTimer = clock.setTimeout(leave, wait);
      else leave();
    },
    /** 앱이 닫힐 때 남은 로딩 타이머를 치운다. */
    dispose() {
      if (launchTimer !== undefined) clock.clearTimeout(launchTimer);
      launchTimer = undefined;
    },
    setActive(next: boolean) {
      if (view.active === next) return;
      if (!next) {
        operation?.abort();
        operation = undefined;
        let screen = view.screen;
        if (screen.kind === "checking") screen = { kind: "scan", message: "QR 확인을 중단했어요. 다시 찍어 주세요." };
        if (screen.kind === "dashboard" && screen.opening) screen = { ...screen, opening: false };
        update({ active: false, cameraEpoch: view.cameraEpoch + 1, screen });
      } else update({ active: true });
    },
    async scan(raw: string, epoch: number) {
      if (!acceptsCamera(epoch)) return;
      const current = new AbortController();
      operation = current;
      update({ screen: { kind: "checking" } });
      let url: string;
      try {
        url = await deps.connect(raw, { signal: current.signal });
      } catch (error) {
        if (operation !== current) return;
        operation = undefined;
        const message = error instanceof Error && error.message ? error.message : "QR을 확인하지 못했어요. 다시 찍어 주세요.";
        update({ screen: { kind: "scan", message } });
        return;
      }
      if (operation !== current || !view.active) return;
      operation = undefined;
      update({ screen: { kind: "dashboard", url, opening: false } });
    },
    cameraFailed(epoch: number) {
      if (acceptsCamera(epoch)) update({ screen: { kind: "scan", message: "카메라를 열지 못했어요. 다시 시도해 주세요." } });
    },
    retryScan() {
      if (!view.active) return;
      const screen = view.screen;
      if (screen.kind === "scan" || (screen.kind === "dashboard" && !screen.opening)) {
        update({ screen: { kind: "scan" }, cameraEpoch: view.cameraEpoch + 1 });
      }
    },
    async startAr() {
      const screen = view.screen;
      if (!view.active || screen.kind !== "dashboard" || screen.opening) return;
      const { url } = screen;
      const current = new AbortController();
      operation = current;
      update({ screen: { kind: "dashboard", url, opening: true } });
      let message: string | undefined;
      try {
        await deps.open(url, { signal: current.signal });
      } catch (error) {
        message = error instanceof Error && error.message ? error.message : "클로이드를 열지 못했어요. 다시 시도해 주세요.";
      }
      if (operation !== current) return;
      operation = undefined;
      update({ screen: { kind: "dashboard", url, opening: false, ...(message ? { message } : {}) } });
    },
  };
}
