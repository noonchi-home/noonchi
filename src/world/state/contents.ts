// World State의 내용물(컵·병·그릇 안) 갱신기 하나(ContentsBook): 전체 사진 VLM 답(facts.ts)·가까이 본 VLM 답(closer.ts)·마시기 따르기 사건(people.ts)·
// 계획의 따르기 단계 창이 모두 여기로 온다. 물건의 facts.contents는 여기서만 쓴다.
// - 확인: 서로 다른 원본 프레임 사진에서 같은 값이 CONTENTS_CONFIRM.photos장, 처음과 마지막 촬영이 spanMs 이상, 이웃 사진 사이 gapMs 이하로 이어지면 확인 값.
//   같은 원본 프레임은 한 장이다(잘라 본 답이 전체 사진 답보다 앞선다). 「안이 안 보임」 답은 후보가 아니다. 확인을 받치는 사진 목록도 쌓는 사진 안이다.
//   가까이 본 답이 넣은 값의 closer_ms는 같은 값이 이어지는 동안 남는다.
//   확인 값을 받치던 사진이 같은 원본 프레임의 잘라 본 답으로 반대가 되면 바뀐 근거로 다시 세어, 다 이어진 묶음이 없으면 확인을 거둔다.
// - 확인 값은 행동으로만 바꾼다: 사건(마시기·따르기)·계획의 따르기 단계 창이 「다시 확인 필요」로 열고(이전 값은 보관, 그 전에 찍힌 사진은 버림) 그 뒤 다 이어진 값이 새 확인 값이다.
//   창이 아니면 반대 값 한 장은 무시하고, conflict장 이어지면 확인 값을 짐작으로 낮춘다(실행에서 모름). 그 충돌은 기억해, 반대 묶음이 공백으로 끊겨도
//   같은 값의 새 사진(가장 새 사진)이 오기 전에는 확인됨으로 되살리지 않는다. 다 이어져도 확인 값은 바꾸지 않는다. 창 안에서는 다 이어진 값이 바꾼다.
//   앞서 연 때보다 먼저(같은 때 포함) 찍힌 사건(대기열에서 늦게 나온 관절 결과)은 버린다.
// - 확인된 불투명(body opaque) 컵은 VLM 내용물 답을 쓰지 않고 「안이 안 보임」(확인됨)이다.
// - 세대(gen)는 확인 값이 정해지거나 바뀌거나 거둬지거나 다시 열릴 때 오른다.
// - 변화 줄: 확인은 판단 계기(meaningful), 다시 열림은 계기 아닌 줄 하나, 짐작 변화는 줄을 내지 않는다.
import type { WorldChange, WorldFact } from "../../contract/world.js";
import { CHANGE_TEXT } from "../labels.js";
import type { StateOf } from "../vocab.js";
import { Part, type Obj } from "./core.js";

/** 확인: 사진 수·처음과 마지막 사이·이웃 사진 사이 최대 공백(ms). conflict: 확인 값과 반대 값이 이만큼 이어지면 짐작으로 낮춘다. keep: 쌓는 사진 수. past: 보관하는 이전 확인 값 수. */
export const CONTENTS_CONFIRM = { photos: 3, spanMs: 4000, gapMs: 6000, conflict: 2, keep: 12, past: 3 } as const;

export type Sure = "empty" | "has_contents";
type Value = StateOf<"contents">;
interface Photo { frame: string; at: number; value: Value; crop: boolean }
/** 다시 연 까닭: 마시기 사건, 따르기 사건, 계획의 따르기 단계. */
export type AgainWhy = "drink" | "pour" | "step";
export interface ContentsState {
  /** 확인 값. frames: 그 값을 확인한 사진들의 원본 프레임. */
  sure: { value: Sure; sinceMs: number; atMs: number; frames: string[] } | null;
  /** 연 뒤 받은 사진(촬영 순, 최근 keep장). */
  photos: Photo[];
  /** 이보다 앞서 찍힌 사진·사건은 받지 않는다(다시 연 때). */
  from: number;
  /** 계획의 따르기 단계 동안: 다 이어진 값이 확인 값을 바꾼다. */
  window: boolean;
  /** 후보 충돌: 확인 값과 반대 값이 conflict장 이어졌고, 그 뒤 같은 값의 새 사진이 아직 없다(확인 값을 짐작으로 둔다). */
  doubt: boolean;
  gen: number;
  past: { value: Sure; atMs: number }[];
}

const SURE: ReadonlySet<string> = new Set<Sure>(["empty", "has_contents"]);
const isSure = (v: string): v is Sure => SURE.has(v);

interface Streak { value: Sure; count: number; first: number; last: number; frames: string[] }
/** 확인 가능 값 사진(촬영 순)을 같은 값이 이웃 gapMs 안으로 이어진 묶음들로 나눈다. */
function streaks(photos: readonly Photo[]): Streak[] {
  const out: Streak[] = [];
  for (const p of photos) {
    if (!isSure(p.value)) continue;
    const cur = out.at(-1);
    if (cur && cur.value === p.value && p.at - cur.last <= CONTENTS_CONFIRM.gapMs) Object.assign(cur, { count: cur.count + 1, last: p.at, frames: [...cur.frames, p.frame] });
    else out.push({ value: p.value, count: 1, first: p.at, last: p.at, frames: [p.frame] });
  }
  return out;
}
/** 최신 사진의 묶음. 없으면 null. */
const streakOf = (photos: readonly Photo[]): Streak | null => streaks(photos).at(-1) ?? null;
const complete = (s: Streak | null): s is Streak => !!s && s.count >= CONTENTS_CONFIRM.photos && s.last - s.first >= CONTENTS_CONFIRM.spanMs;

/** 내용물 갱신기. */
export class ContentsBook extends Part {
  private state(obj: Obj): ContentsState {
    return (obj.contents ??= { sure: null, photos: [], from: Number.NEGATIVE_INFINITY, window: false, doubt: false, gen: 0, past: [] });
  }

  private opaque(obj: Obj): boolean {
    const b = obj.facts.body;
    return b?.value === "opaque" && b.certainty === "confirmed";
  }

  private keepPast(s: ContentsState): void {
    if (s.sure) s.past = [{ value: s.sure.value, atMs: s.sure.atMs }, ...s.past].slice(0, CONTENTS_CONFIRM.past);
  }

  /** VLM 내용물 답 하나(crop: 잘라 본 사진). 변화 줄과 facts.contents가 바뀌었는지. */
  see(obj: Obj, frameId: string, atMs: number, value: Value, crop: boolean): { changes: WorldChange[]; changed: boolean } {
    const s = this.state(obj);
    if (atMs < s.from || this.opaque(obj)) return { changes: [], changed: false };
    const same = s.photos.findIndex((p) => p.frame === frameId);
    const replaced = same >= 0 ? s.photos[same]! : null;
    // 같은 원본 프레임은 한 장: 전체 사진 답 뒤에 온 잘라 본 답만 바꾼다(잘라 본 답이 앞선다). 그 밖의 두 번째 답은 버린다
    if (replaced) {
      if (replaced.crop || !crop) return { changes: [], changed: false };
      s.photos.splice(same, 1);
    }
    s.photos.push({ frame: frameId, at: atMs, value, crop });
    s.photos.sort((a, b) => a.at - b.at);
    if (s.photos.length > CONTENTS_CONFIRM.keep) s.photos.splice(0, s.photos.length - CONTENTS_CONFIRM.keep);
    // 확인 값을 받치던 사진이 다른 값으로 바뀌었다(같은 원본 프레임의 잘라 본 답): 바뀐 근거로 다시 세어 다 이어진 묶음이 없으면 확인을 거둔다
    const sure = s.sure;
    if (sure && replaced && replaced.value !== value && sure.frames.includes(frameId)
      && !streaks(s.photos).some((x) => x.value === sure.value && complete(x))) {
      Object.assign(s, { sure: null, doubt: false, gen: s.gen + 1 });
    }
    const changes: WorldChange[] = [];
    const run = streakOf(s.photos);
    if (complete(run)) {
      if (!s.sure || (s.sure.value !== run.value && s.window)) {
        this.keepPast(s);
        s.sure = { value: run.value, sinceMs: run.first, atMs: run.last, frames: run.frames };
        s.doubt = false;
        s.gen++;
        changes.push({ kind: "state", at_ms: atMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.core.name(obj), run.value) });
      } else if (s.sure.value === run.value) {
        Object.assign(s.sure, { atMs: Math.max(s.sure.atMs, run.last), frames: [...new Set([...s.sure.frames, ...run.frames])] });
      }
    }
    if (s.sure) {
      // 받치는 사진 목록은 쌓는 사진 안만 둔다(바뀐 근거로 다시 셀 때만 쓴다)
      const live = new Set(s.photos.map((p) => p.frame));
      s.sure.frames = s.sure.frames.filter((f) => live.has(f));
      // 후보 충돌: 가장 새 사진이 같은 값이면 풀고, 반대 값이 conflict장 이어지면 건다(공백으로 끊겨도 같은 값의 새 사진 전에는 풀지 않는다)
      const newest = s.photos.filter((p) => isSure(p.value)).at(-1);
      if (newest?.value === s.sure.value) s.doubt = false;
      else if (run && run.value !== s.sure.value && run.count >= CONTENTS_CONFIRM.conflict) s.doubt = true;
    }
    return { changes, changed: this.settle(obj) };
  }

  /** 사건(마시기·따르기)·따르기 단계: 확인 값을 보관하고 「다시 확인 필요」로 연다. 확인 값이 있다가 열렸을 때만 줄 하나(입에 댄 채 몇 장 이어져도 한 줄). */
  reopen(obj: Obj, atMs: number, why: AgainWhy): WorldChange[] {
    const s = this.state(obj);
    if (atMs <= s.from) return [];
    const had = s.sure;
    this.keepPast(s);
    Object.assign(s, { sure: null, from: atMs, doubt: false, gen: s.gen + 1 });
    s.photos = s.photos.filter((p) => p.at >= atMs);
    this.settle(obj);
    return had ? [{ kind: "state", at_ms: atMs, subject: obj.id, meaningful: false, text: CHANGE_TEXT.contentsAgain(this.core.name(obj), why) }] : [];
  }

  /** 계획의 따르기 단계 창: on이면 다시 열고 창을 둔다, off면 창만 닫는다(값은 둔다). */
  window(obj: Obj, atMs: number, on: boolean): void {
    if (on) this.reopen(obj, atMs, "step");
    this.state(obj).window = on;
  }

  /** facts.contents를 지금 상태로 다시 쓴다(불투명 > 확인 값(후보 충돌이면 짐작) > 후보 짐작 > 보관 값 짐작 > 「안이 안 보임」 짐작).
   *  값이 그대로면 closer_ms를 남긴다. 값이 새로 생기거나 바뀌거나 없어졌으면 true(가까이 보기 횟수·closer_ms는 이때만 바꾼다). */
  settle(obj: Obj): boolean {
    // 내용물 답이 한 번도 없어도 불투명이 확인되면 「안이 안 보임」을 둔다
    const s = obj.contents ?? (this.opaque(obj) ? this.state(obj) : null);
    if (!s) return false;
    const before = obj.facts.contents;
    const next = this.effective(obj, s);
    if (next) obj.facts.contents = before?.closer_ms !== undefined && before.value === next.value ? { ...next, closer_ms: before.closer_ms } : next;
    else delete obj.facts.contents;
    return before?.value !== next?.value;
  }

  private effective(obj: Obj, s: ContentsState): WorldFact | undefined {
    const sure = s.sure;
    const body = obj.facts.body;
    if (body && this.opaque(obj)) return { value: "contents_unknown", at_ms: body.at_ms, since_ms: body.since_ms, certainty: "confirmed" };
    const run = streakOf(s.photos);
    if (sure) return { value: sure.value, at_ms: sure.atMs, since_ms: sure.sinceMs, certainty: s.doubt ? "inferred" : "confirmed" };
    if (run) return { value: run.value, at_ms: run.last, since_ms: run.first, certainty: "inferred" };
    const last = s.past[0];
    if (last) return { value: last.value, at_ms: last.atMs, since_ms: last.atMs, certainty: "inferred" };
    const unknown = s.photos.at(-1);
    return unknown ? { value: unknown.value, at_ms: unknown.at, since_ms: unknown.at, certainty: "inferred" } : undefined;
  }
}
