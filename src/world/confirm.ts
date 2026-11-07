// 등장·사라짐 확인: 같은 쪽이 need(key)장 연속일 때만 인정한다(사람 2장, 물건 3장. 출처는 docs/provenance.md).
// 사라짐은 그 자리가 시야 안인 프레임만 센다. 시야 밖 프레임은 셈을 멈춘다(늘리지도 지우지도 않음).
// 셈하던 키는 candidates에 없어도 매 장 다시 본다: 한 장이라도 끊기면 셈을 지운다.
export interface ConfirmEvent { key: string; kind: "appeared" | "gone"; atMs: number }

export class Confirmer {
  private readonly on = new Set<string>();
  private readonly streak = new Map<string, number>();
  constructor(private readonly need: (key: string) => number) {}

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
  }

  /** seen: 이 프레임에서 본 것. candidates: 셈할 다른 것(있다고 인정한 것). inView: 그 자리가 시야 안인가. */
  observe(atMs: number, seen: ReadonlySet<string>, candidates: Iterable<string>, inView: (key: string) => boolean): ConfirmEvent[] {
    const out: ConfirmEvent[] = [];
    for (const key of new Set([...candidates, ...seen, ...this.streak.keys()])) {
      const now = seen.has(key);
      if (now === this.on.has(key)) {
        this.streak.delete(key);
        continue;
      }
      if (!now && !inView(key)) continue;
      const n = (this.streak.get(key) ?? 0) + 1;
      if (n < this.need(key)) {
        this.streak.set(key, n);
        continue;
      }
      this.streak.delete(key);
      if (now) this.on.add(key);
      else this.on.delete(key);
      out.push({ key, kind: now ? "appeared" : "gone", atMs });
    }
    return out;
  }
}
