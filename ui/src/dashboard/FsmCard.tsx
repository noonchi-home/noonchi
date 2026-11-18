import { useLayoutEffect, useMemo, useRef } from "react";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { CardFrame } from "../components/ui/card-frame";
import { ItemTitle } from "../components/ui/item";
import { LineDrawSvg, type LineTone } from "../components/ui/line-draw-svg";
import { Separator } from "../components/ui/separator";
import { Status } from "../components/ui/status";
import { FSM } from "../lib/tokens";
import { cn } from "../lib/utils";
import { fsmLayout, type FsmLabel, type FsmLine, type FsmNode, type FsmNow, type FsmView } from "./fsm";
import { EASE, useReducedMotionNow } from "./motion";

/** 상태가 바뀔 때 판이 옮겨 가고 빨간 점이 선을 지나는 시간(ms), 앞 상태 원의 흐림(opacity). */
export const FSM_MOVE_MS = 700;
const PREV_FADE = 0.5;
const TONE: Record<FsmLine["kind"], LineTone> = { edge: "fsmEdge", out: "fsmOut", taken: "fsmTaken" };
const WIDTH: Record<FsmLine["kind"], number> = { edge: FSM.edge.width, out: FSM.out.width, taken: FSM.taken.width };
/** 글 자리 맞춤: 위 글은 아래 끝 가운데, 아래 글은 위 끝 가운데, 왼쪽 글은 오른쪽 끝 가운데가 그 자리다. */
const ANCHOR: Record<FsmLabel["side"], string> = { above: "translate(-50%, -100%)", below: "translate(-50%, 0)", left: "translate(-100%, -50%)" };

/** 가운데 (x, y) 반지름 r 원 path. */
const circle = (x: number, y: number, r: number) => `M${x} ${y - r}A${r} ${r} 0 1 1 ${x} ${y + r}A${r} ${r} 0 1 1 ${x} ${y - r}Z`;
/** 판 옮김: 지금 상태 가운데를 카드 가운데에. */
const panOf = (box: { width: number; height: number }, f: { x: number; y: number }) => `translate(${box.width / 2 - f.x}px, ${box.height / 2 - f.y}px)`;

/** 선 하나(21st.dev Line Draw SVG 한 장에 path 하나: 선, 화살촉). 굵기는 카드 배율(view.width)로 키운다. */
function Line({ line, view }: { line: FsmLine; view: FsmView }) {
  const w = view.width(WIDTH[line.kind]);
  return (
    <div data-fsm-line={line.kind} data-from={line.from} data-to={line.to} className="absolute left-0 top-0">
      <LineDrawSvg tone={TONE[line.kind]} path={line.d} strokeWidth={w} width={1} height={1} className="absolute left-0 top-0" />
      <LineDrawSvg tone={TONE[line.kind]} path={line.arrow} strokeWidth={w} width={1} height={1} className="absolute left-0 top-0" />
    </div>
  );
}

/** 선 글(21st.dev Status): 막 지나온 선은 brand, 그 밖은 기본. 둘째 줄(sub, 로봇 행동)이 있으면 두 줄. */
function Label({ line }: { line: FsmLine }) {
  const l = line.label!;
  return (
    <div data-fsm-label={line.kind} className="absolute" style={{ left: l.x, top: l.y, transform: ANCHOR[l.side] }}>
      <Status variant={line.kind === "taken" ? "brand" : "default"} className={l.sub ? "flex-col items-center gap-0" : undefined}>
        <span>{l.text}</span>
        {l.sub && <span>{l.sub}</span>}
      </Status>
    </div>
  );
}

/** 원 안: 위 이름(큰 원이면 21st.dev ItemTitle, 부품 원래 글 text-sm), 가운데 줄(21st.dev Separator), 아래 그 상태에서 하는 일(Avatar 글 text-xs). 둘 다 두 줄까지. */
function Face({ name, does, big }: { name: string; does: string; big: boolean }) {
  return (
    <div className="flex flex-col items-center px-2">
      {big ? <ItemTitle className="line-clamp-2 block break-keep text-balance">{name}</ItemTitle> : <span className="line-clamp-2 break-keep text-balance">{name}</span>}
      <Separator className="my-1 w-3/5" />
      <span className="line-clamp-2 break-keep text-balance">{does}</span>
    </div>
  );
}

/**
 * 상태 원(21st.dev Avatar size state 두 겹): 아래 겹은 기본 바탕, 위 겹은 brand 바탕(LG 빨강)이고 지금 상태에서만 보인다(opacity). 아래는 그 상태에서 하는 일(fsm.ts).
 * 원 둘레 테는 Line Draw SVG 원이다. 앞 상태는 흐리다.
 */
function Node({ n, view }: { n: FsmNode; view: FsmView }) {
  const { r } = view;
  const big = view.k > 1.2;
  return (
    <div data-fsm-state={n.id} data-now={n.now || undefined} data-prev={n.prev || undefined} className="absolute" style={{ left: n.x - r, top: n.y - r, width: 2 * r, height: 2 * r, opacity: n.prev ? PREV_FADE : 1 }}>
      <LineDrawSvg tone="fsmRing" path={circle(r, r, r + 0.5)} strokeWidth={view.width(FSM.ring.width)} width={1} height={1} className="absolute left-0 top-0" />
      <Avatar size="state" style={{ width: 2 * r, height: 2 * r }}>
        <AvatarFallback><Face name={n.name} does={n.does} big={big} /></AvatarFallback>
      </Avatar>
      <div data-fsm-fill className="absolute inset-0" style={{ opacity: n.now ? 1 : 0 }}>
        <Avatar size="state" style={{ width: 2 * r, height: 2 * r }}>
          <AvatarFallback tone="brand"><Face name={n.name} does={n.does} big={big} /></AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

/**
 * 메시지 상자 오른쪽 FSM 카드(21st.dev Card 틀): 습관 FSM 상태 그림(fsm.ts fsmLayout)을 담은 판을 옮겨 지금 상태를 카드 가운데에 둔다.
 * 지금 상태가 바뀌면 판이 새 상태로 옮겨 가고(transform) 새 상태 원이 빨갛게 찬다(opacity). 막 일어난 전이(fsm.from)가 있으면 빨간 점이 그 선을 따라가고
 * (transform 자리 여럿) 앞 상태 원은 흐려진다(opacity).
 * 움직임 줄이기면 바로 바꾼다. 보기만 한다. 크기(box)만 받고 자리는 놓는 쪽이 정한다(className: 메시지 상자 안 flex 칸, 또는 화면 위 독립 카드 absolute 자리).
 */
export function FsmCard({ fsm, box, className, style }: {
  fsm: FsmNow | null;
  box: { width: number; height: number };
  /** 놓는 자리 class(배치 class만). */
  className?: string;
  /** 독립 카드로 놓을 때 자리(left·top). */
  style?: { left?: number; top?: number };
}) {
  const reduced = useReducedMotionNow();
  const view = useMemo(() => (fsm ? fsmLayout(fsm, box) : null), [fsm, box.width, box.height]);
  const pan = view ? panOf(box, view.focus) : "none";
  const world = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const shown = useRef<{ pan: string; cur: string | null } | null>(null);

  useLayoutEffect(() => {
    const was = shown.current;
    const cur = fsm?.state ?? null;
    shown.current = { pan, cur };
    const el = world.current;
    if (!was || !view || reduced || was.cur === cur || !el || typeof el.animate !== "function") return;
    const timing: KeyframeAnimationOptions = { duration: FSM_MOVE_MS, easing: EASE };
    const a: Animation[] = [el.animate([{ transform: was.pan }, { transform: pan }], timing)];
    // 빨간 점은 막 일어난 전이가 방금 그린 상태에서 온 것일 때만(대기·그대로 두기로 바뀐 상태는 선을 켜지 않는다)
    const taken = view.lines.find((l) => l.kind === "taken" && l.from === was.cur);
    if (taken && dot.current) {
      const frames: Keyframe[] = taken.track.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)`, opacity: 1 }));
      a.push(dot.current.animate([...frames, { ...frames.at(-1)!, opacity: 0 }], { duration: FSM_MOVE_MS, easing: "linear" }));
    }
    const fill = cur ? el.querySelector<HTMLElement>(`[data-fsm-state="${cur}"] [data-fsm-fill]`) : null;
    if (fill) a.push(fill.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], timing));
    const from = taken ? el.querySelector<HTMLElement>(`[data-fsm-state="${was.cur}"]`) : null;
    if (from) a.push(from.animate([{ opacity: 1 }, { opacity: PREV_FADE }], timing));
    return () => { for (const x of a) x.cancel(); };
  }, [pan, fsm?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // 습관 그림을 받기 전(첫 판단 전)이면 카드를 두지 않는다
  if (!view) return null;
  const dotSize = view.width(FSM.dotSize);
  return (
    <CardFrame data-fsm-card className={cn("relative overflow-hidden", className)} style={{ ...style, width: box.width, height: box.height }}>
      <div ref={world} data-fsm-world className="absolute left-0 top-0 will-change-transform" style={{ transform: pan }}>
        {view.lines.map((l) => <Line key={l.id} line={l} view={view} />)}
        {view.loop && <Line line={view.loop} view={view} />}
        {view.nodes.map((n) => <Node key={n.id} n={n} view={view} />)}
        {view.lines.filter((l) => l.label).map((l) => <Label key={l.id} line={l} />)}
        {view.loop?.label && <Label line={view.loop} />}
        <div ref={dot} data-fsm-dot className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <LineDrawSvg tone="fsmDot" path={circle(0, 0, dotSize / 4)} strokeWidth={dotSize / 2} width={1} height={1} className="absolute left-0 top-0" />
        </div>
      </div>
    </CardFrame>
  );
}
