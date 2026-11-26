// 트윈 뷰어 모듈(twin/apartment/viewer/*.mjs, vite 별칭 @viewer) 가운데 대시보드 트윈이 쓰는 것의 타입.
// 노드·객체는 three를 가져오지 않는 순수 함수라 unknown으로 받는다.

declare module "@viewer/walls.mjs" {
  export function furnitureAction(entry: { id: string; type?: string }, doorIds: ReadonlySet<string>): "hide" | "none" | null;
  export function cameraHeading(p: number[], t: number[]): [number, number];
  export function upperVisible(
    w: { kind?: string; faces?: { room?: string; normal: number[] }[] },
    o: { mode?: string; heading: [number, number]; focus?: string | null },
  ): boolean;
  export function cutAction(e: unknown, upper: Map<string, boolean>, cut: number, wallOf?: Map<string, string>): "hide" | "clip" | "none";
  export function collectWalls(root: unknown, planWalls?: unknown[]): {
    id: string; kind: string; faces: unknown[]; node: unknown; lower: unknown; upper: { visible: boolean } | null;
  }[];
}

declare module "@viewer/states.mjs" {
  export interface StateContext {
    lights: Set<unknown>;
    lit: Set<unknown>;
    lightOf: WeakMap<object, unknown>;
    skipped: Set<unknown>;
    spins: Map<unknown, unknown>;
  }
  export function createContext(o?: {
    makeLight?: ((spec: Record<string, unknown>) => unknown) | null;
    maxLights?: number;
    placeLight?: ((light: unknown, anchor: unknown) => void) | null;
    releaseLight?: ((light: unknown) => void) | null;
  }): StateContext;
  export function collectTargets(root: unknown): unknown;
  export function attrValues(states: unknown, attrs: unknown, attr: string): unknown[];
  export function defaultValue(states: unknown, attrs: unknown, attr: string): unknown;
  export function applyState(ctx: StateContext, targets: unknown, states: unknown, attrs: unknown, state: unknown): { missing: string[] };
  export function applyAttr(ctx: StateContext, targets: unknown, attr: string, spec: unknown, value: unknown): { missing: string[] };
  export function tickSpins(ctx: StateContext, dt: number): void;
}

declare module "@viewer/scene.mjs" {
  export function statesOf(entry: unknown, node: unknown): Record<string, { default?: unknown; effects?: Record<string, unknown[]> }>;
  export function parseProp(value: unknown): Record<string, unknown> | null;
  /** 개별 GLB(gltf.scene)에서 파일 이름과 같은 최상위 노드. 없으면 던진다. */
  export function assetRoot<T extends { children: { name: string }[] }>(gltfScene: T, assetPath: string): T["children"][number];
}

declare module "@viewer/live.mjs" {
  export function createLiveSync(o: {
    viewer: {
      getAttrs(id: string): Record<string, unknown[]> | null | undefined;
      getState(id: string): Record<string, unknown>;
      setState(id: string, attr: string, value: unknown): void;
    };
    send: (id: string, attr: string, value: unknown) => Promise<{ status?: number; json?: unknown; ok?: boolean }>;
    onNotice?: (n: unknown) => void;
    onStats?: (s: unknown) => void;
    onEye?: (eye: unknown) => void;
    onLayout?: (msg: unknown) => void;
    onFocus?: (focus: unknown) => void;
  }): { handleMessage(msg: unknown): void; userChange(id: string, attr: string, value: unknown): void; setConnected(on: boolean): void; stats(): Record<string, unknown> };
}

declare module "@viewer/layout.mjs" {
  /** move 메시지에서 고른 값(movePatch). */
  export interface MovePatch { position: [number, number, number]; rotation: [number, number, number]; room?: string; plan?: Record<string, unknown> }
  /** 메시지를 ops.move·add·remove로 넘기고 그 결과를 돌려준다. 모르는 메시지·틀린 위치는 null. add 객체는 normalizeObject로 채운 것. */
  export function routeLayout<M, A, R>(msg: unknown, ops: { move(id: string, patch: MovePatch): M; add(object: Record<string, unknown> & { id: string; position: [number, number, number] }): A; remove(id: string): R }): M | A | R | null;
  export function normalizeObject(object: Record<string, unknown>): Record<string, unknown>;
  export function boxSpec(object: Record<string, unknown>): { size: [number, number, number]; center: [number, number, number] };
}
