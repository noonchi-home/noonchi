import { createContext, useContext } from "react";
import type * as THREE_NS from "three";

/**
 * twin-studio 뷰어(window.aptViewer) 중 화면이 쓰는 부분. 원본: twin/apartment/viewer/main.mjs 맨 아래(twin-studio에서 복사).
 * 3D 객체는 이 THREE로만 만든다(three를 따로 불러 섞지 않는다). @types/three는 타입에만 쓴다.
 */
export interface AptViewer {
  THREE: typeof THREE_NS;
  scene: THREE_NS.Scene;
  /** 위에서 보는 정사영 카메라. */
  camera: THREE_NS.OrthographicCamera;
  /** CCTV 보기(view.cctv)일 때 그리는 원근 카메라. */
  cctvCamera: THREE_NS.PerspectiveCamera;
  renderer: THREE_NS.WebGLRenderer;
  /** 게터: 지금 불러오기(show)의 Promise. show() 전에는 이미 풀린 Promise다. */
  readonly ready: Promise<unknown>;
  /** 게터: show()가 도는 동안 true. */
  readonly loading: boolean;
  /** 게터: 보기 상태 복사본. focus는 고른 방 id, isolate는 초점 방만, showCeiling은 천장 보기. */
  readonly view: { cctv: boolean; focus: string | null; isolate: boolean; showCeiling: boolean; wallMode: WallMode };
  /** show()가 시작될 때 비우고, 끝나면 mode(성공) 또는 error(실패)를 채운다. */
  results: { mode?: string; error?: string };
  /** 장면의 모든 물건(부를 때마다 새로 만든다). */
  objects(): TwinObject[];
  node(id: string): THREE_NS.Object3D | null;
  hidden(id: string): boolean | null;
  setBadges(on: boolean): void;
  /** 벽 보기: full 온전히, auto 앞쪽 낮춤, low 모두 낮춤. 뷰어 막대의 벽 선택도 같이 바뀐다. */
  setWallMode(mode: WallMode): void;
  setFocus(focus: unknown): void;
  renderNow(): void;
}

export type WallMode = "full" | "auto" | "low";

/** objects() 한 줄 중 화면이 쓰는 부분. mount: floor·wall·ceiling·surface·opening, room: 방 id(없으면 null), type: 카탈로그 종류(dining_table 등). */
export type TwinObject = { id: string; room?: string | null; mount: string; category: string; type?: string; name?: string };

type Loadable = Pick<AptViewer, "ready" | "loading" | "results">;

const failed = () => new Error("3D 트윈을 불러오지 못했어요.");

/** 첫 장면 불러오기가 끝났으면 true. 실패했으면 던진다. */
function settled(v: Loadable): boolean {
  if (v.results?.error) throw failed();
  return !v.loading && typeof v.results?.mode === "string";
}

/**
 * win.aptViewer가 생기고 첫 장면을 다 불러올 때까지 기다린다.
 * 뷰어는 scene.json을 받기 전에 aptViewer를 먼저 만들고, 그때 ready는 이미 풀려 있다. 그래서 ready만 기다리지 않고
 * loading·results로 show()가 끝났는지 본다. timeoutMs는 뷰어가 없거나 아직 불러오기를 시작하지 않은 시간에만 센다.
 */
export async function waitForViewer(win: Window, timeoutMs = 15000): Promise<AptViewer> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = (win as Window & { aptViewer?: AptViewer }).aptViewer;
    if (v) {
      try {
        await v.ready;
      } catch {
        throw failed();
      }
      if (settled(v)) return v;
    }
    if (Date.now() > end) throw new Error("3D 트윈을 찾을 수 없어요.");
    await new Promise((r) => setTimeout(r, 100));
  }
}

export const ViewerContext = createContext<AptViewer | null>(null);
export const useViewer = () => useContext(ViewerContext);
