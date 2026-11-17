// clock.ts — 노드 시계. 실제 시계는 Date.now·setInterval, 가상 시계(재생·시험)는 advanceTo로 시각을 당기며 그 사이 타이머를 시각 차례로 부른다.
// 타이머 하나를 부를 때마다 settle(재생 장벽)을 기다린 뒤 다음으로 간다: 비동기 타이머 일과 그 일이 낸 메시지가 끝나기 전에 시계가 넘어가지 않는다.
export interface Clock { now(): number; every(ms: number, fn: () => void): () => void }

export const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => { const h = setInterval(fn, ms); h.unref?.(); return () => clearInterval(h); },
};

export class VirtualClock implements Clock {
  #now: number;
  readonly #timers = new Set<{ ms: number; next: number; fn: () => void }>();
  constructor(start = 0) { this.#now = start; }
  now(): number { return this.#now; }
  set(ms: number): void { if (ms > this.#now) this.#now = ms; }
  every(ms: number, fn: () => void): () => void {
    const t = { ms, next: this.#now + ms, fn };
    this.#timers.add(t);
    return () => this.#timers.delete(t);
  }
  async advanceTo(ms: number, settle: () => Promise<void> = async () => {}): Promise<void> {
    for (;;) {
      const due = [...this.#timers].filter((t) => t.next <= ms).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.#now = due.next;
      due.next += due.ms;
      due.fn();
      await settle();
    }
    this.set(ms);
  }
}
