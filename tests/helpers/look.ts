// 가까이 보기 시험 대역: 가짜 OpenAI(scripts/fake-openai.ts)의 VLM 답.
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
