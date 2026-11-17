// pending.ts — 요청 id 맞추기: 요청을 낼 때 열고, 답의 req가 열린 것일 때만 받는다(늦은 답·모르는 답은 버린다).
// 다른 요청끼리 세대 숫자를 견주지 않는다.
export class Pending<T> {
  readonly #open = new Map<string, T>();
  open(req: string, value: T): void { this.#open.set(req, value); }
  take(req: string): T | undefined {
    const v = this.#open.get(req);
    this.#open.delete(req);
    return v;
  }
  has(req: string): boolean { return this.#open.has(req); }
  clear(): void { this.#open.clear(); }
  get size(): number { return this.#open.size; }
}
