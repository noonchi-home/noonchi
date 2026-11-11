// 가까이 보기 시험 대역: 가짜 OpenAI(scripts/fake-openai.ts)의 VLM 답, 보기 담당 시험의 가까이 보기 자리(testCloser).
import type { CloserResult } from "../../src/contract/events.js";
import type { LookSpot } from "../../src/observe/crop.js";
import { CLOSER_NOTE } from "../../src/observe/scene.js";

const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === "text" ? p.text ?? "" : "")).join("\n") : "";

/** 가까이 본 사진의 요약. */
export const CLOSER_SUMMARY = "가까이 본 장면";

/** 가짜 OpenAI reply: CLOSER_NOTE가 든 장면 요청이면 감지마다 state를 답하고(요약 CLOSER_SUMMARY), 아니면 null(기본 답). */
export function closerVlmReply(state = "in_sink"): (body: any) => string | null {
  return (body) => {
    if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
    const text = (Array.isArray(body.messages) ? body.messages : []).map((m: { content: unknown }) => textOf(m.content)).join("\n");
    if (!text.includes(CLOSER_NOTE)) return null;
    const m = /Detections: (\[.*\])/.exec(text);
    const dets: { id: string }[] = m ? JSON.parse(m[1]!) : [];
    return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state })), summary: CLOSER_SUMMARY });
  };
}

/** 싱크대에서 컵 하나를 찾은 가까이 보기 결과(VLM 답 싱크대 안). */
export const CLOSER_FOUND: CloserResult = {
  ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3,
  found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], summary: CLOSER_SUMMARY, vlm: "ok",
};

export interface TestCloser {
  /** 받은 자리와 신호(부른 순서). */
  calls: { spot: LookSpot; signal: AbortSignal | undefined }[];
  /** 다음 부름이 돌려줄 결과. */
  result: CloserResult;
  /** 다음 부름부터 release까지 답을 붙잡는다. */
  hold(): void;
  /** 붙잡은 부름에 r(없으면 result)로 답하고 붙잡기를 그만둔다. */
  release(r?: CloserResult): void;
  closer(spot: LookSpot, signal?: AbortSignal): Promise<CloserResult>;
}

/** 보기 담당(src/act/look.ts) 시험의 가까이 보기 자리: 받은 자리·신호를 남기고 정한 결과를 돌려준다. */
export function testCloser(result: CloserResult = CLOSER_FOUND): TestCloser {
  let holding = false;
  let held: ((r?: CloserResult) => void) | null = null;
  const t: TestCloser = {
    calls: [], result,
    hold: () => { holding = true; },
    release: (r) => {
      holding = false;
      const h = held;
      held = null;
      h?.(r);
    },
    closer: (spot, signal) => {
      t.calls.push({ spot, signal });
      if (!holding) return Promise.resolve(t.result);
      return new Promise((ok) => { held = (r) => ok(r ?? t.result); });
    },
  };
  return t;
}
