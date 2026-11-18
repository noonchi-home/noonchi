// 시험용 시계 고정: 전역 Date를 바꿔 지금이 at(ms)에서 시작해 실제 시간만큼 흐르게 한다. 서버 코드는 그대로 Date를 읽는다(「오늘」 셈은 바꾸지 않는다).
// 돌려받은 함수를 부르면 원래 Date로 돌아간다. 같은 프로세스 안(시험이 띄운 서버 포함)에만 든다.
export function fixClock(at: number): () => void {
  const Real = globalThis.Date;
  const offset = at - Real.now();
  const now = () => Real.now() + offset;
  function Fixed(this: unknown, ...args: unknown[]): Date | string {
    // new 없이 부르면(Date()) 지금 시각 글이다
    if (!new.target) return new Real(now()).toString();
    return args.length === 0 ? Reflect.construct(Real, [now()], new.target) : Reflect.construct(Real, args, new.target);
  }
  Object.setPrototypeOf(Fixed, Real);
  Fixed.prototype = Real.prototype;
  const fixed = Fixed as unknown as DateConstructor;
  Object.defineProperty(fixed, "now", { value: now, writable: true, configurable: true });
  globalThis.Date = fixed;
  return () => {
    globalThis.Date = Real;
  };
}
