// 컵 안 보기 단계(위에서 비추기, src/act/track/steps.ts topStep)를 처음부터 끝까지 보는 시험 도우미(가짜 서버 e2e):
// 맞춘 폰이 컵 입구 바로 위에서 내려다본 엔진 프레임(진짜 JPEG), 잘라 키운 위 사진의 그릇 감지, 위에서 보기 VLM 답(TOP_NOTE가 든 요청).
// 맞춤은 AR = 트윈(tests/helpers/align.ts 기본 변환)이라 컵의 트윈 자리 [x, 높이, y]를 그대로 AR 자리로 쓴다.
import jpeg from "jpeg-js";
import { join } from "node:path";
import type WebSocket from "ws";
import type { RunningServer } from "../../src/server/start.js";
import { alignOnServer } from "./align.js";
import type { CameraView, Detection } from "../../src/contract/observe.js";
import { encodeFramePacket } from "../../src/phone/packet.js";
import { sha256 } from "../../src/observe/ring.js";
import { TOP_NOTE } from "../../src/observe/scene.js";
import { LOOK_SIZE, frameJpeg, viewLooking } from "./camera.js";
import { det } from "./detectors.js";

type V3 = [number, number, number];
/** 90° 시야 투영(열 우선, tests/helpers/camera.ts와 같다). */
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const textOf = (content: unknown): string => (Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === "text" ? p.text ?? "" : "")).join("\n") : String(content ?? ""));

/** 진짜 JPEG이면 그 크기, 아니면(시험이 보내는 짧은 가짜 사진) null. */
function jpegSize(b: Buffer): { width: number; height: number } | null {
  try {
    const img = jpeg.decode(b, { useTArray: true });
    return { width: img.width, height: img.height };
  } catch {
    return null;
  }
}

/** contents: 위에서 본 컵 안(기본 비어 있음). */
export function topLook(o: { contents?: "empty" | "has_contents" } = {}) {
  const tops = new Set<string>();
  let n = 0;
  return {
    /** 컵(트윈 자리) 입구 위 0.4m, 수평 2cm 뒤에서 내려다본 엔진 프레임 한 장(맞춘 폰 자세·투영, 지금 촬영 시각). */
    packet(cup: V3): Buffer {
      const origin: V3 = [cup[0] - 0.02, cup[1] + 0.4, cup[2]];
      const view = viewLooking(origin, cup);
      // 모서리 흰 네모: 가운데를 잘라 키운 사진(같은 회색 한 장)이 위 사진과 같은 사진이 되지 않게
      const img = frameJpeg(1000 + ++n, [[0, 0, 8, 8]]);
      tops.add(sha256(img));
      return encodeFramePacket({ kind: "engine", width: LOOK_SIZE.width, height: LOOK_SIZE.height, position: origin, orientation: view.orientation, tracking: "ok",
        projection: PROJECTION, captured_at: Date.now(), time_err_ms: 0 }, img);
    },
    /** 감지: 위 엔진 사진은 감지 없음(위에서는 YOLO가 컵을 못 잡는다), 잘라 키운 위 사진(진짜 JPEG)은 가운데 그릇, 그 밖은 base. */
    detect(base: (b: Buffer) => Detection[]): (b: Buffer) => Detection[] {
      return (b) => {
        if (tops.has(sha256(b))) return [];
        const size = jpegSize(b);
        return size ? [det("bowl", 0.8, [size.width * 0.3, size.height * 0.3, size.width * 0.4, size.height * 0.4])] : base(b);
      };
    },
    /** 가짜 VLM: 위에서 보기 요청(TOP_NOTE)이면 d1 내용물로 답하고, 아니면 null(그 시험의 답으로). */
    reply(body: any): string | null {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const text = (Array.isArray(body.messages) ? body.messages : []).map((m: { content: unknown }) => textOf(m.content)).join("\n");
      if (!text.includes(TOP_NOTE)) return null;
      return JSON.stringify({ scene: "kitchen", observations: [{ object_id: "d1", state: o.contents ?? "empty" }], summary: "위에서 본 컵" });
    },
  };
}

type Msg = Record<string, any>;
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const ORIENTATION: [number, number, number, number] = [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)];
const EYE: [number, number, number] = [8.04, 1.5, 2.7 + 1.5];
export const CUP_BOX: [number, number, number, number] = [220, 160, 40, 20];
const until = async (ok: () => boolean, what: string) => {
  for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
  throw new Error(`5초 안에 오지 않음: ${what}`);
};
/** 위치를 맞추고 맞춘 눈 자세를 보낸다. */
export async function alignPhone(srv: RunningServer, ws: WebSocket, phone: Msg[], dash: Msg[]): Promise<void> {
  await alignOnServer(srv.url, (t) => ws.send(t), join(srv.twin.dir, "apartment", "scene.json"), [EYE[0], EYE[2]]);
  await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
  ws.send(JSON.stringify({ type: "pose", position: EYE, orientation: ORIENTATION, tracking: "ok" }));
  await until(() => dash.some((m) => m.type === "eye"), "눈");
}
/** 엔진 프레임 한 장: 컵 안 보기 중이면(above, 컵 자리) 컵 위에서 내려다본 사진, 아니면 맞춘 눈 사진. */
export const SINK_VIEW = viewLooking([5.8, 1.65, 4.15], [5.8, 0.9, 2.65]);
export const frameOf = (top: ReturnType<typeof topLook>, above: V3 | null, n: number, view?: CameraView) => above ? top.packet(above)
  : encodeFramePacket({ kind: "engine", width: 480, height: 360, position: view?.origin ?? EYE, orientation: view?.orientation ?? ORIENTATION, tracking: "ok", projection: PROJECTION, captured_at: Date.now(), time_err_ms: 0 },
    Buffer.from([0xff, 0xd8, n % 256, n >> 8]));
/** 대시보드가 받은 마지막 World State의 그 컵 자리. */
export const cupPos = (dash: Msg[], id: string): [number, number, number] => dash.filter((m) => m.type === "world").at(-1)!.world.objects.find((o: Msg) => o.id === id).position;
