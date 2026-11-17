// 등장·사라짐 확인: 같은 쪽이 시간으로 이어질 때만 인정한다. 프레임 간격(2초든 100ms든)과 상관없이 같은 촬영 시각에 같은 사건이 난다.
// need(key)는 2초 간격일 때의 장 수(사람 2장, 물건 3장. 출처는 docs/provenance.md)이고, 한 장은 EVIDENCE_STEP_MS(2초)어치다:
// - 등장: 처음 본 뒤 (appearNeed − 1) × 2초 동안 이어 보임. appearNeed를 주지 않으면 need다(World State는 사람·물건 모두 2장, 2초).
// - 사라짐: 마지막으로 본 뒤 그 자리가 시야 안인데 못 본 시간이 need × 2초(사람 4초, 물건 6초). 시야 밖 프레임은 셈을 멈춘다(늘리지도 지우지도 않음).
// - 프레임 한 장의 시간은 앞 프레임과의 간격이고 2초를 넘지 않는다(오래 비었다가 온 한 장이 바로 인정되지 않게).
// - 끊김: 반대쪽 프레임이 왔을 때 셈하던 쪽을 마지막으로 본 지 EVIDENCE_GAP_MS(500ms) 이상이면 셈을 지운다. 그보다 짧으면(100ms 간격에서 한두 장 놓침)
//   끊지 않고 시간만 더하며, 셈하던 쪽 시간이 절반 이상이어야 인정한다.
// 셈하던 키는 candidates에 없어도 매 장 다시 본다. 그 키의 보임 판단보다 옛 프레임(skip)은 그 키에 넣지 않는다.
export interface ConfirmEvent { key: string; kind: "appeared" | "gone"; atMs: number }

/** 프레임 한 장이 내는 근거 시간의 상한이자 need 한 장의 시간(옛 엔진 프레임 간격). VLM 프레임 간격(VLM_FRAME_MS)과 따로 둔다. */
export const EVIDENCE_STEP_MS = 2000;
/** 셈하던 쪽을 이만큼 못 보면 끊긴 것으로 본다. */
export const EVIDENCE_GAP_MS = 500;

interface Streak {
  /** 셈을 시작한 뒤 흐른 시간(시야 밖 프레임 빼고). */
  total: number;
  /** 그 가운데 셈하던 쪽 프레임의 시간. */
  agree: number;
  /** 셈하던 쪽을 마지막으로 본 촬영 시각. */
  lastAgreeAt: number;
}

export class Confirmer {
  private readonly on = new Set<string>();
  private readonly streak = new Map<string, Streak>();
  /** 키마다 마지막으로 넣은 프레임의 촬영 시각(있다고 인정했거나 세는 중인 키만). */
  private readonly lastAt = new Map<string, number>();
  /** stepMs: need 한 장의 시간이자 프레임 한 장이 내는 근거 시간의 상한(기본 EVIDENCE_STEP_MS). appearNeed: 등장 장 수(없으면 need). */
  constructor(private readonly need: (key: string) => number, private readonly stepMs: number = EVIDENCE_STEP_MS, private readonly appearNeed: (key: string) => number = need) {}

  present(key: string): boolean {
    return this.on.has(key);
  }

  /** 세는 중인 키 수. */
  get pending(): number {
    return this.streak.size;
  }

  /** 잊은 키(World State에서 지운 물체)의 상태와 셈을 지운다. */
  forget(key: string): void {
    this.on.delete(key);
    this.streak.delete(key);
    this.lastAt.delete(key);
  }

  /** 셈 없이 있다고 인정하고 그 키의 셈을 지운다(가까이 보기가 새 촬영으로 본 물건, src/world/state/closer.ts applyCloser). */
  mark(key: string): void {
    this.on.add(key);
    this.streak.delete(key);
  }

  /** seen: 이 프레임에서 본 것. candidates: 셈할 다른 것(있다고 인정한 것). inView: 그 자리가 시야 안인가.
   *  skip: 이 프레임을 넣지 않을 키(그 키의 보임 판단보다 옛 촬영). 그 키는 셈을 늘리지도 지우지도 않는다. */
  observe(atMs: number, seen: ReadonlySet<string>, candidates: Iterable<string>, inView: (key: string) => boolean, skip?: (key: string) => boolean): ConfirmEvent[] {
    const out: ConfirmEvent[] = [];
    for (const key of new Set([...candidates, ...seen, ...this.streak.keys()])) {
      if (skip?.(key)) continue;
      const prev = this.lastAt.get(key);
      const w = prev === undefined ? this.stepMs : Math.min(Math.max(0, atMs - prev), this.stepMs);
      const now = seen.has(key);
      const on = this.on.has(key);
      const s = this.streak.get(key);
      if (now === on) {
        // 셈하던 쪽의 반대(지금 상태 그대로)를 봤다: 끊겼으면 지우고, 아니면 시간만 더한다
        if (s) {
          if (atMs - s.lastAgreeAt >= EVIDENCE_GAP_MS) this.streak.delete(key);
          else s.total += w;
        }
        this.touch(key, atMs);
        continue;
      }
      if (!now && !inView(key)) {
        this.touch(key, atMs);
        continue;
      }
      // 등장은 처음 본 장부터, 사라짐은 마지막으로 본 장부터 잰다
      const next: Streak = s ? { total: s.total + w, agree: s.agree + w, lastAgreeAt: atMs } : { total: now ? 0 : w, agree: now ? 0 : w, lastAgreeAt: atMs };
      const needMs = (now ? this.appearNeed(key) - 1 : this.need(key)) * this.stepMs;
      if (next.total < needMs || next.agree * 2 < next.total) {
        this.streak.set(key, next);
        this.lastAt.set(key, atMs);
        continue;
      }
      this.streak.delete(key);
      if (now) this.on.add(key);
      else this.on.delete(key);
      this.touch(key, atMs);
      out.push({ key, kind: now ? "appeared" : "gone", atMs });
    }
    return out;
  }

  /** 마지막 프레임 시각을 적는다. 인정하지도 세지도 않는 키는 남기지 않는다. */
  private touch(key: string, atMs: number): void {
    if (this.on.has(key) || this.streak.has(key)) this.lastAt.set(key, atMs);
    else this.lastAt.delete(key);
  }
}
