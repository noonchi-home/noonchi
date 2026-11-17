// clock.ts — 노드 시계. 실제 시계는 Date.now·setInterval·setTimeout, 가상 시계(재생·시험)는 advanceTo로 시각을 당기며 그 사이 타이머(되풀이·한 번)를 시각 차례로 부른다.
// 타이머 하나를 부를 때마다 settle(재생 장벽)을 기다린 뒤 다음으로 간다: 비동기 타이머 일과 그 일이 낸 메시지가 끝나기 전에 시계가 넘어가지 않는다.
export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  /** ms 뒤 한 번(통로의 다시 주기). */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => { const h = setInterval(fn, ms); h.unref?.(); return () => clearInterval(h); },
  after: (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
};

type Timer = { ms: number; next: number; fn: () => void; once: boolean };

export class VirtualClock implements Clock {
  #now: number;
  readonly #timers = new Set<Timer>();
  constructor(start = 0) { this.#now = start; }
  now(): number { return this.#now; }
  set(ms: number): void { if (ms > this.#now) this.#now = ms; }
  every(ms: number, fn: () => void): () => void {
    return this.#add({ ms, next: this.#now + ms, fn, once: false });
  }
  after(ms: number, fn: () => void): () => void {
    return this.#add({ ms, next: this.#now + ms, fn, once: true });
  }
  #add(t: Timer): () => void {
    this.#timers.add(t);
    return () => this.#timers.delete(t);
  }
  async advanceTo(ms: number, settle: () => Promise<void> = async () => {}): Promise<void> {
    for (;;) {
      const due = [...this.#timers].filter((t) => t.next <= ms).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.#now = due.next;
      if (due.once) this.#timers.delete(due);
      else due.next += due.ms;
      due.fn();
      await settle();
    }
    this.set(ms);
  }
}
