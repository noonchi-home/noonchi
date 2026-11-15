// 실제 폰 화면(에이전트의 손). 처음 화면: 마스코트(세로에서만)·제목·AR 지원 줄·시작 위치 안내·AR 시작, 답 줄·승인 대기(답마다 단추 하나)·글 입력.
// AR 덮개(DOM 오버레이 뿌리): 맨 아래 canvas(명령 대상 고리·화면 밖 세모, 물건 자리 맞추기 때만 조준점), 위 줄(왼쪽 위 미어캣 = 설정 단추, 그 옆 지금 명령 한 줄),
// 엄지 자리(명령·질문·승인·시작 위치 맞추기·물건 자리 맞추기가 있을 때만 카드 하나: 비전 상태 한 줄, 그 바로 아래 답 단추). 설정과 문제 모달(연결 끊김·마이크 꺼짐·시작 위치 없음)은
// Alert Dialog를 덮개 뿌리 안에 띄운다(AR 중에는 그 안만 보인다). 세로가 기본 배치이고, 가로면 엄지 자리를 오른쪽 아래로 옮기고(landscape:) 설정 모달 단추 줄은 모달 폭 안에서 줄을 바꾼다(sm:flex-wrap). 폰은 세로·가로 어느 쪽으로 들어도 된다.
// 부품은 ui/src/components/ui의 21st.dev 부품만 쓰고 여기서는 배치만 한다. 글 크기는 부품 원래 크기, 누르는 것은 48px(h-12·size-12).
// 명령 답 단추 묶음은 명령(계획 id:단계 id)마다 새로 그린다. 단추는 누르기 시작할 때의 명령을 잡고, 손을 뗄 때 지금 명령과 다르면 보내지 않는다.
import { MessageSquare } from "lucide-react";
import { useCallback, useRef, useState, type FormEvent, type Ref } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { Status, StatusIndicator } from "@/components/ui/status";
import type { ApprovalAnswer } from "../../../src/contract/phone.ts";
import {
  handOf, PROBLEM_TEXT, problemOf, RESTART_FROM_SPOT, settingsRows, START_BUTTON, supportText,
  type Choice, type Hand, type Pending, type PhoneActions, type PhoneView, type Problem, type Tone,
} from "./state";

/** 상태 줄 색: Status 부품 variant. */
const TONE: Record<Tone, "default" | "success" | "warning" | "error"> = { plain: "default", ok: "success", warn: "warning", error: "error" };

export interface PhoneScreenProps {
  view: PhoneView;
  act: PhoneActions;
  overlayRef?: Ref<HTMLDivElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export function PhoneScreen({ view, act, overlayRef, canvasRef }: PhoneScreenProps) {
  // 모달은 덮개 뿌리 안에 그린다: 뿌리 요소를 상태로도 들고 있는다
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    setRoot(el);
    assign(overlayRef, el);
  }, [overlayRef]);
  return (
    <>
      <Intro view={view} act={act} />
      <Overlay view={view} act={act} root={root} attach={attach} canvasRef={canvasRef} />
    </>
  );
}

function TalkForm({ act }: { act: PhoneActions }) {
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.say(draft);
    setDraft("");
  };
  return (
    <form className="flex gap-2" autoComplete="off" onSubmit={submit}>
      <Input className="h-12 min-w-0 flex-1" maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="예: TV 켜줘 / 냉장고 위치 여기로 맞춰줘" aria-label="클로이드에게 할 말" />
      <Button type="submit" variant="outline" className="h-12">보내기</Button>
    </form>
  );
}

/** 답마다 단추 하나: 첫 답이 주 단추(default), 나머지는 outline. variant를 식으로 고르면 부품 lint가 "outline"을 class로 본다. press: 누르기 시작(pointerdown). */
function ChoiceButtons({ choices, pick, grow, press }: { choices: Choice[]; pick: (id: string) => void; grow?: boolean; press?: () => void }) {
  const size = grow ? "h-12 flex-1" : "h-12";
  return (
    <>
      {choices.map((c, i) => (i === 0
        ? <Button key={c.id} className={size} onPointerDown={press} onClick={() => pick(c.id)}>{c.label}</Button>
        : <Button key={c.id} variant="outline" className={size} onPointerDown={press} onClick={() => pick(c.id)}>{c.label}</Button>))}
    </>
  );
}

/** 명령·질문의 답 단추: 누르기 시작할 때의 명령(계획 id:단계 id)을 잡고, 손을 뗄 때(click) 지금 명령과 다르면 보내지 않는다. 묶음은 명령마다 새로 그린다(key). */
function CommandChoices({ id, step, choices, act, now }: { id: string; step: string; choices: Choice[]; act: PhoneActions; now: () => string }) {
  const pressed = useRef<string | null>(null);
  const key = `${id}:${step}`;
  const pick = (c: string) => {
    const at = pressed.current ?? key;
    pressed.current = null;
    if (at !== key || now() !== key) return;
    act.answer(id, step, c);
  };
  return <ChoiceButtons grow choices={choices} press={() => { pressed.current = key; }} pick={pick} />;
}

function PendingList({ items, act }: { items: Pending[]; act: PhoneActions }) {
  return (
    <Card className="flex flex-col gap-1.5 p-1.5">
      {items.map((p) => (
        <Item key={p.token} size="sm">
          <ItemContent><ItemTitle>{p.deviceLabel}: {p.reason}</ItemTitle></ItemContent>
          <ItemActions><ChoiceButtons choices={p.choices} pick={(id) => act.confirm(p.token, id as ApprovalAnswer)} /></ItemActions>
        </Item>
      ))}
    </Card>
  );
}

function Intro({ view, act }: { view: PhoneView; act: PhoneActions }) {
  const spot = view.sync?.start ?? null;
  const canStart = view.support.kind === "ready" || view.support.kind === "failed";
  return (
    <main hidden={view.ar} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-4 px-4 pt-6 pb-4">
      {/* 가로로 들면 마스코트 그림을 숨겨 AR 시작 단추가 첫 화면에 들어오게 한다 */}
      <img src="/brand/mascot@1x.webp" alt="" width={55} height={96} className="mx-auto my-2.5 h-24 w-auto landscape:hidden" />
      <Card>
        <CardHeader>
          <CardTitle>클로이드의 눈</CardTitle>
          <CardDescription role="status" data-support={view.support.kind}>{supportText(view.support, spot !== null)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex list-decimal flex-col gap-2 ps-5">
            {spot
              ? <li>{spot.label}에 서서 {spot.facing || "정한 방향"} 쪽을 보고 <b>{START_BUTTON}</b>을 눌러요</li>
              : <li>먼저 설정 화면에서 시작 위치를 정해 주세요</li>}
          </ol>
        </CardContent>
        <CardFooter>
          <Button className="h-12 w-full" disabled={!canStart} onClick={act.startAr}>AR 시작</Button>
        </CardFooter>
      </Card>
      <section aria-label="클로이드와 대화" className="flex flex-col gap-2">
        {view.reply !== null && (
          <Alert role="status" aria-live="polite"><MessageSquare /><AlertDescription>{view.reply}</AlertDescription></Alert>
        )}
        {!view.ar && view.pending.length > 0 && <PendingList items={view.pending} act={act} />}
        {!view.ar && <TalkForm act={act} />}
      </section>
    </main>
  );
}

/** 엄지 자리 답 단추: 승인 대기는 그 토큰과 답으로 승인, 명령·질문은 그 명령의 id·step으로 답한다(누르는 중 명령이 바뀌면 보내지 않는다). */
function Answers({ hand, act }: { hand: Hand; act: PhoneActions }) {
  const t = hand.thumb!;
  // 손을 뗄 때 볼 지금 명령(그린 뒤 바뀐 명령까지)
  const shown = useRef("");
  shown.current = t.kind === "command" ? `${t.command.id}:${t.command.step}` : "";
  if (t.kind === "start") return <Button className="h-12 flex-1" onClick={act.confirmStart}>{START_BUTTON}</Button>;
  if (t.kind === "place") return <Button className="h-12 flex-1" onClick={act.endSetup}>완료</Button>;
  if (t.kind === "pending") return <ChoiceButtons grow choices={t.item.choices} pick={(c) => act.confirm(t.item.token, c as ApprovalAnswer)} />;
  const { id, step, choices } = t.command;
  return <CommandChoices key={`${id}:${step}`} id={id} step={step} choices={choices} act={act} now={() => shown.current} />;
}

/** 미어캣(설정 단추)과 설정 모달: 연결·듣기·위치(·기준) 상태, 물건 자리 맞추기, 닫기, 시작 위치가 있으면 「시작 위치에서 다시 맞추기」(주 단추).
 *  닫으면 미어캣으로 초점이 돌아온다. */
function Settings({ view, act, root, open }: { view: PhoneView; act: PhoneActions; root: HTMLElement | null; open: boolean }) {
  return (
    <AlertDialog open={open} onOpenChange={act.setSettings}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="설정" className="size-12 shrink-0 p-0">
          <Avatar shape="logo" className="size-10"><AvatarImage src="/brand/face-128.png" alt="" /></Avatar>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent container={root} aria-describedby={undefined} className="motion-reduce:animate-none">
        <AlertDialogHeader><AlertDialogTitle>설정</AlertDialogTitle></AlertDialogHeader>
        <ItemGroup>
          {settingsRows(view).map((r) => (
            <Item key={r.name} size="sm" role="listitem">
              <ItemContent><ItemTitle>{r.name}</ItemTitle></ItemContent>
              <ItemActions><Status variant={TONE[r.tone]}>{r.value}</Status></ItemActions>
            </Item>
          ))}
        </ItemGroup>
        {/* 좁은 화면에서는 아래부터 쌓인다(뒤 단추가 위): 시작 위치에서 다시 맞추기, 물건 자리 맞추기, 닫기 차례로 보인다. 간격은 footer gap 하나(닫기의 mt-2를 뺀다).
            넓은 화면(가로로 든 폰)에서는 한 줄로 놓되 모달 폭을 넘으면 줄을 바꾼다: 옆으로 넘치면 상태 칩이 잘린다 */}
        <AlertDialogFooter className="gap-2 sm:flex-wrap sm:space-x-0">
          <AlertDialogCancel className="mt-0 h-12">닫기</AlertDialogCancel>
          <AlertDialogAction variant="outline" className="h-12" onClick={act.startPlace}>물건 자리 맞추기</AlertDialogAction>
          {view.sync?.start && <AlertDialogAction className="h-12" onClick={act.startFromSpot}>{RESTART_FROM_SPOT}</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 일이 멈추는 문제 모달: 제목과 고치는 단추(연결 끊김·시작 위치 없음은 단추 없이, 다시 붙거나 시작 위치가 생기면 닫힌다). 닫히는 동안에도 마지막 글을 보인다. */
function ProblemDialog({ problem, act, root }: { problem: Problem | null; act: PhoneActions; root: HTMLElement | null }) {
  const [last, setLast] = useState<Problem | null>(problem);
  if (problem !== null && problem !== last) setLast(problem);
  const shown = problem ?? last;
  const text = shown ? PROBLEM_TEXT[shown] : null;
  const fix = act.micOn;
  return (
    <AlertDialog open={problem !== null}>
      <AlertDialogContent container={root} aria-describedby={undefined} className="motion-reduce:animate-none">
        <AlertDialogHeader><AlertDialogTitle>{text?.title}</AlertDialogTitle></AlertDialogHeader>
        {text?.fix && (
          <AlertDialogFooter><AlertDialogAction className="h-12" onClick={fix}>{text.fix}</AlertDialogAction></AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Overlay({ view, act, root, attach, canvasRef }: { view: PhoneView; act: PhoneActions; root: HTMLElement | null; attach: (el: HTMLDivElement | null) => void; canvasRef?: Ref<HTMLCanvasElement> }) {
  const hand = handOf(view);
  const problem = view.ar ? problemOf(view) : null;
  return (
    <div ref={attach} hidden={!view.ar} data-phone-overlay="" className="fixed inset-0">
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" />
      {/* 위 줄: 왼쪽 위 미어캣(늘), 그 옆 지금 할 명령 한 줄(있을 때만). 상태 표시줄 아래에서 시작한다(안전 영역, 없으면 28px + 8px) */}
      <div data-phone-zone="top" className="fixed inset-x-0 top-0 flex items-start gap-2 px-4 pt-[calc(max(env(safe-area-inset-top),28px)+8px)]">
        <Settings view={view} act={act} root={root} open={view.ar && view.settingsOpen && problem === null} />
        {hand.top !== null && (
          <LiquidGlass mode="opaque" radius={16} role="status" aria-live="polite" className="min-w-0 flex-1" contentClassName="px-3.5 py-3">
            <p data-phone-text="명령" className="break-keep">{hand.top}</p>
          </LiquidGlass>
        )}
      </div>
      {/* 엄지 자리: 비전 상태 한 줄, 그 바로 아래 답 단추. 세로는 맨 아래 폭 전체, 가로는 오른쪽 아래 */}
      {hand.thumb && (
        <div data-phone-zone="thumb" className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] left-4 landscape:left-auto landscape:w-[min(360px,calc(50vw-40px))]">
          <LiquidGlass mode="opaque" radius={16} contentClassName="flex flex-col gap-2 p-2.5">
            {hand.vision && (
              <Status variant={TONE[hand.vision.tone]} className="max-w-full whitespace-normal">
                <StatusIndicator />
                <span data-phone-text="비전 상태" className="break-keep">{hand.vision.text}</span>
              </Status>
            )}
            <div className="flex gap-2"><Answers hand={hand} act={act} /></div>
          </LiquidGlass>
        </div>
      )}
      <ProblemDialog problem={problem} act={act} root={root} />
    </div>
  );
}
