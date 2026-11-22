// 규칙 맥락(요일·시각 칸). 맥락은 코드가 붙이고 반성 모델(PAM)은 모른다(2026-11-22 사용자 결정: 맥락 없음 → 하나 → 둘).
// 요일 dow는 월요일 0 … 일요일 6, 시각 칸 slot은 3시간 간격 0~7(0=0~3시, 6=18~21시, 7=21~24시). 시각은 자정부터 초.
import type { Ctx } from "../contract/pam.js";
import type { FsmEdge, FsmMemory } from "./decision.js";

export const DOW_COUNT = 7;
export const SLOT_COUNT = 8;
export const SLOT_SECONDS = 3 * 3600;
const DOW_TEXT = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"] as const;

/** 자정부터 초 → 3시간 칸(0~7). 하루 끝(86400초)은 마지막 칸으로 센다. */
export const slotOf = (secondsFromMidnight: number): number => Math.min(SLOT_COUNT - 1, Math.max(0, Math.floor(secondsFromMidnight / SLOT_SECONDS)));
/** YYYY-MM-DD → 요일(월요일 0). 날짜 글 자체가 그 지역의 날짜이므로 시간대와 상관없다. */
export const dowOfDay = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** 그 요일·시각 칸이 맥락에 맞는가. 맥락에 없는 칸은 상관없다. */
export const ctxMatches = (ctx: Ctx, dow: number, slot: number): boolean =>
  (ctx.dow === undefined || ctx.dow === dow) && (ctx.slot === undefined || ctx.slot === slot);

/** 두 맥락이 같은 요일·시각에 함께 맞을 수 있는가. 한 칸이라도 둘 다 정해져 있고 값이 다르면 겹치지 않는다. */
export const ctxOverlap = (a: Ctx, b: Ctx): boolean =>
  !(a.dow !== undefined && b.dow !== undefined && a.dow !== b.dow) && !(a.slot !== undefined && b.slot !== undefined && a.slot !== b.slot);

/** 맥락 칸 수(하나 단계 = 1, 둘 단계 = 2). */
export const ctxSize = (c: Ctx): number => (c.dow !== undefined ? 1 : 0) + (c.slot !== undefined ? 1 : 0);

/** 화면 글: 「토요일」, 「18~21시」, 「토요일 18~21시」. */
export function ctxText(c: Ctx): string {
  const parts: string[] = [];
  if (c.dow !== undefined) parts.push(DOW_TEXT[c.dow] ?? `요일 ${c.dow}`);
  if (c.slot !== undefined) parts.push(`${c.slot * 3}~${c.slot * 3 + 3}시`);
  return parts.join(" ");
}

/** 같은 열쇠(JSON)로 맥락을 구분한다. 맥락이 없으면 null. */
export const ctxKey = (c: Ctx | undefined | null): string | null => (c && ctxSize(c) ? JSON.stringify([c.dow ?? null, c.slot ?? null]) : null);

/** 기록 시간대(분)로 본 지금 요일(월요일 0)과 3시간 시각 칸. */
export function ctxNow(nowMs: number, offsetMinutes: number): { dow: number; slot: number } {
  const local = nowMs + offsetMinutes * 60_000;
  const dow = (new Date(local).getUTCDay() + 6) % 7;
  const sec = Math.floor((((local % 86_400_000) + 86_400_000) % 86_400_000) / 1000);
  return { dow, slot: slotOf(sec) };
}

const trigOf = (e: FsmEdge) => JSON.stringify([e.on, e.when ?? null]);

/** 낮 판단이 PAM에 보내는 기억: 지금 요일·시각에 맞는 맥락 화살표만 맥락 칸 없이 남기고, 맞는 맥락 화살표가 있는 사건·조건의 맥락 없는 화살표(배우기 전의 묻기)는 뺀다
 *  (맥락 있는 쪽이 이긴다). 맞는 맥락 화살표가 같은 사건·조건·행동으로 겹치면 첫 것만 둔다. 맥락 화살표가 하나도 없으면 같은 객체를 돌려준다.
 *  화살표 번호(next_index)는 이 걸러낸 기억 기준이므로 PAM 호출·답 해석·목표 미리 세우기가 같은 기억을 써야 한다(src/brain/decide.ts tick). */
export function contextView(memory: FsmMemory, now: { dow: number; slot: number }): FsmMemory {
  if (!memory.states.some((s) => s.next.some((e) => e.ctx))) return memory;
  return {
    ...memory,
    states: memory.states.map((s) => {
      const won = new Set(s.next.filter((e) => e.ctx && ctxMatches(e.ctx, now.dow, now.slot)).map(trigOf));
      const seen = new Set<string>();
      const next: FsmEdge[] = [];
      for (const e of s.next) {
        if (e.ctx) {
          if (!ctxMatches(e.ctx, now.dow, now.slot)) continue;
          const key = JSON.stringify([trigOf(e), e.action]);
          if (seen.has(key)) continue;
          seen.add(key);
          const { ctx: _ctx, ...plain } = e;
          next.push(plain);
        } else if (!won.has(trigOf(e))) next.push(e);
      }
      return { ...s, next };
    }),
  };
}
