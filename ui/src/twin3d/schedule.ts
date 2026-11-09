// 그리기 차례: 바뀔 때만 그린다. 같은 그림 안의 여러 request는 한 번이고, draw가 true를 돌려주면(움직이는 중) 다음 그림을 한 번 더 부른다.
type Raf = (cb: (now: number) => void) => number;
type Caf = (id: number) => void;

export class RenderLoop {
  frames = 0;
  private id: number | null = null;
  private stopped = false;

  constructor(
    private readonly draw: (now: number) => boolean,
    private readonly raf: Raf = (cb) => requestAnimationFrame(cb),
    private readonly caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  request(): void {
    if (this.stopped || this.id !== null) return;
    this.id = this.raf(this.tick);
  }

  stop(): void {
    this.stopped = true;
    if (this.id !== null) this.caf(this.id);
    this.id = null;
  }

  private readonly tick = (now: number): void => {
    this.id = null;
    if (this.stopped) return;
    this.frames++;
    if (this.draw(now)) this.request();
  };
}
