// 폰 화면(클로이드의 눈). 처음 화면: 마스코트·제목·AR 지원 줄·안내 둘·AR 시작, 대화(답 줄·승인 대기·누르고 말하기·글 입력).
// AR 덮개(DOM 오버레이 뿌리): 조준점·초점 그림(canvas), 위 상태 줄·보낸 장 수·⋯, 판단 줄, 사진 요청, 행동 부탁, 기준점 단추, 큰 단추 셋, 승인 대기, 알림, ⋯ 메뉴.
// AR 중에는 덮개만 보이므로 글 입력은 ⋯ 메뉴에 둔다. 판단 줄·알림·사진 요청은 위 줄, 누르는 승인 대기·행동 부탁·기준점 단추는
// 아래 엄지 자리(큰 단추 위)에 쌓는다. 두 칸 모두 가운데 조준점을 비키고, 엄지 자리는 넘치면 그 칸만 스크롤한다.
// 가로로 돌리면 큰 단추가 오른쪽 세로 줄로 가고, 엄지 자리는 조준점 왼쪽, 위 줄은 조준점 오른쪽으로 간다.
// 부품은 ui/src/components/ui의 21st.dev 부품만 쓰고(components.json F1~F15), 여기서는 배치만 한다.
import { Bot, Camera, Ellipsis, MessageSquare, Mic, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useState, type Dispatch, type FormEvent, type PointerEvent as ReactPointerEvent, type Ref, type SetStateAction } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { Status, StatusLabel } from "@/components/ui/status";
import { anchorLabel, anchorNames, supportText, wouldLine, type BrainAction, type Pending, type PhoneActions, type PhoneView, type TalkSpot } from "./state";

/** AR 위 큰 단추(말하기·사진·끝내기): 76×64px, 아이콘 위·이름 아래. */
const BIG = "h-16 w-[76px] flex-col gap-0.5 px-1";

export interface PhoneScreenProps {
  view: PhoneView;
  act: PhoneActions;
  overlayRef?: Ref<HTMLDivElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
}

export function PhoneScreen({ view, act, overlayRef, canvasRef }: PhoneScreenProps) {
  // 처음 화면과 ⋯ 메뉴의 글 입력이 같은 글을 이어 쓴다(옮기기 전에는 같은 입력칸을 옮겼다)
  const [draft, setDraft] = useState("");
  return (
    <>
      <Intro view={view} act={act} draft={draft} setDraft={setDraft} />
      <Overlay view={view} act={act} draft={draft} setDraft={setDraft} overlayRef={overlayRef} canvasRef={canvasRef} />
    </>
  );
}

/** 누르는 동안 듣고, 떼거나 손가락이 벗어나면 멈춘다. 길게 눌러도 메뉴가 뜨지 않게 한다. */
function hold(act: PhoneActions, spot: TalkSpot) {
  return {
    onPointerDown: (e: ReactPointerEvent) => { e.preventDefault(); act.talkDown(spot); },
    onPointerUp: () => act.talkUp(spot),
    onPointerCancel: () => act.talkUp(spot),
    onPointerLeave: () => act.talkUp(spot),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
}

type DraftProps = { act: PhoneActions; draft: string; setDraft: Dispatch<SetStateAction<string>> };

function TalkForm({ act, draft, setDraft }: DraftProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.say(draft);
    setDraft("");
  };
  return (
    <form className="flex gap-2" autoComplete="off" onSubmit={submit}>
      <Input className="h-12 min-w-0 flex-1" maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="예: TV 켜줘 / 냉장고 위치 여기로 맞춰줘" aria-label="클로이드에게 할 말" />
      <Button type="submit" variant="outline" size="touch" className="h-12">보내기</Button>
    </form>
  );
}

function PendingList({ items, act }: { items: Pending[]; act: PhoneActions }) {
  return (
    <Card className="flex flex-col gap-1.5 p-1.5">
      {items.map((p) => (
        <Item key={p.token} size="sm">
          <ItemContent><ItemTitle>{p.deviceLabel}: {p.reason}</ItemTitle></ItemContent>
          <ItemActions>
            <Button size="touch" className="h-12" onClick={() => act.confirm(p.token)}>승인</Button>
            <Button variant="outline" size="touch" className="h-12" onClick={() => act.cancel(p.token)}>취소</Button>
          </ItemActions>
        </Item>
      ))}
    </Card>
  );
}

function Intro({ view, act, draft, setDraft }: { view: PhoneView } & DraftProps) {
  const names = anchorNames(view.mode, view.anchors);
  const canStart = view.support.kind === "ready" || view.support.kind === "failed";
  return (
    <main hidden={view.ar} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-4 px-4 pt-6 pb-4">
      <img src="/brand/mascot@1x.webp" alt="" width={55} height={96} className="mx-auto my-2.5 h-24 w-auto" />
      <Card>
        <CardHeader>
          <CardTitle>클로이드의 눈</CardTitle>
          <CardDescription role="status" data-support={view.support.kind}>{supportText(view.support)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex list-decimal flex-col gap-2 ps-5">
            {view.mode === "touch"
              ? <li>{names} 바로 아래 바닥에 조준점을 맞추고 <b>기록</b>을 눌러요. 초록이면 닿은 거예요</li>
              : <li>{names} 바닥에 차례로 조준점을 맞추고 <b>지점 기록</b>을 눌러요</li>}
            <li>물건 아래 바닥을 조준하고 <b>말하기</b>를 누른 채 "냉장고 여기로"라고 말해요</li>
          </ol>
        </CardContent>
        <CardFooter>
          <Button size="touch" className="h-12 w-full" disabled={!canStart} onClick={act.startAr}>AR 시작</Button>
        </CardFooter>
      </Card>
      <section aria-label="클로이드와 대화" className="flex flex-col gap-2">
        {view.reply !== null && (
          <Alert role="status" aria-live="polite"><MessageSquare /><AlertDescription>{view.reply}</AlertDescription></Alert>
        )}
        {!view.ar && view.pending.length > 0 && <PendingList items={view.pending} act={act} />}
        {view.speech && (
          <Button size="touch" variant={view.listening === "intro" ? "destructive" : "default"} className="h-12 w-full gap-2 touch-none select-none" {...hold(act, "intro")}>
            <Mic />{view.listening === "intro" ? "듣는 중… 손을 떼면 보내요" : "누르고 말하기"}
          </Button>
        )}
        {!view.ar && <TalkForm act={act} draft={draft} setDraft={setDraft} />}
      </section>
    </main>
  );
}

function ActionCard({ action, act }: { action: BrainAction; act: PhoneActions }) {
  const would = wouldLine(action.would);
  return (
    <Card className="w-full">
      <CardHeader className="p-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Status variant="warning" size="touch"><TriangleAlert className="size-4" />모의</Status>
          {action.text}
        </CardTitle>
      </CardHeader>
      {would && <CardContent className="px-4 pb-2">{would}</CardContent>}
      <CardFooter className="gap-2 p-4 pt-0">
        {/* 첫 선택이 주 단추(default), 나머지는 outline. variant를 식으로 고르면 부품 lint가 "outline"을 class로 본다 */}
        {action.choices.map((c, i) => {
          const pick = () => act.brainReply(action.id, c.id);
          return i === 0
            ? <Button key={c.id} size="touch" className="h-12 flex-1" onClick={pick}>{c.label}</Button>
            : <Button key={c.id} size="touch" variant="outline" className="h-12 flex-1" onClick={pick}>{c.label}</Button>;
        })}
      </CardFooter>
    </Card>
  );
}

function Overlay({ view, act, draft, setDraft, overlayRef, canvasRef }: { view: PhoneView; overlayRef?: Ref<HTMLDivElement>; canvasRef?: Ref<HTMLCanvasElement> } & DraftProps) {
  const pending = view.ar && view.pending.length > 0;
  const anchors = view.anchors && !view.aligned ? view.anchors : [];
  return (
    <div ref={overlayRef} hidden={!view.ar} data-phone-overlay="" className="fixed inset-0">
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" />
      <div className="fixed inset-x-0 top-0 flex items-center gap-2 px-4 pt-2">
        <Status variant="scrim" size="touch" role="status" title={view.status.title} className="min-w-0 flex-1">
          <StatusLabel className="truncate">{view.status.text}</StatusLabel>
        </Status>
        <Status variant="scrim" size="touch" title="최근 2초 동안 대시보드로 보낸 화면 장 수" className="tabular-nums">{view.fps}</Status>
        <LiquidGlass mode="opaque" className="shrink-0">
          <Button variant="ghost" size="touch" aria-label="메뉴" aria-expanded={view.menuOpen} aria-controls="phone-menu" className="size-12 px-0" onClick={() => act.setMenu(!view.menuOpen)}>
            <Ellipsis />
          </Button>
        </LiquidGlass>
      </div>
      {/* 위 줄: 판단 줄·알림·사진 요청. 누르는 것이 없고, 조준점 위(세로)·오른쪽(가로)에서 잘린다 */}
      <div data-phone-zone="top" className="pointer-events-none fixed inset-x-4 top-16 flex max-h-[calc(50dvh-86px)] flex-col items-center gap-2 overflow-hidden landscape:left-[calc(50vw+24px)] landscape:right-24 landscape:max-h-[calc(100dvh-76px)]">
        {view.brainLine !== null && (
          <Status variant="scrim" size="touch" role="status" aria-live="polite" className="w-full">
            <Bot className="size-4" /><StatusLabel className="min-w-0 truncate">{view.brainLine}</StatusLabel>
          </Status>
        )}
        {view.toast !== null && (
          <LiquidGlass mode="opaque" role="status" aria-live="polite" className="max-w-full" contentClassName="px-3.5 py-2 text-center">
            {view.toast}
          </LiquidGlass>
        )}
        {view.request && (
          <Alert variant="brand" size="lg"><Camera /><AlertTitle>{view.request.text}</AlertTitle></Alert>
        )}
      </div>
      {/* 엄지 자리: 승인 대기·행동 부탁·기준점 단추를 큰 단추 위에 쌓는다. 조준점 아래(세로)·왼쪽(가로)까지만 크고 넘치면 스크롤한다 */}
      {(pending || view.action || anchors.length > 0) && (
        <div data-phone-zone="thumb" className="fixed inset-x-4 bottom-24 flex max-h-[calc(50dvh-120px)] flex-col gap-2 overflow-y-auto landscape:right-[calc(50vw+24px)] landscape:bottom-3 landscape:max-h-[calc(100dvh-76px)]">
          {pending && <PendingList items={view.pending} act={act} />}
          {view.action && <ActionCard action={view.action} act={act} />}
          {anchors.map((a) => (
            <Button key={a.id} variant="outline" size="touch" className="h-12 w-full shrink-0 justify-start" onClick={() => act.recordAnchor(a.id)}>
              {anchorLabel(view.mode, a)}
            </Button>
          ))}
        </div>
      )}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] flex justify-center gap-3.5 landscape:inset-x-auto landscape:right-2.5 landscape:bottom-auto landscape:top-1/2 landscape:-translate-y-1/2 landscape:flex-col landscape:gap-2.5">
        {view.speech && (
          <Button size="touch" variant={view.listening === "ar" ? "destructive" : "default"} aria-label="누르고 말하기" className={`${BIG} touch-none select-none`} {...hold(act, "ar")}>
            <Mic className="size-6" />{view.listening === "ar" ? "듣는 중" : "말하기"}
          </Button>
        )}
        <Button size="touch" variant="outline" aria-label="사진 찍기" className={BIG} onClick={act.takePhoto}>
          <Camera className="size-6" />{view.request ? "컵 안" : "사진"}
        </Button>
        <Button size="touch" variant="outline" aria-label="끝내기" className={BIG} onClick={act.stopAr}>
          <Square className="size-6" />끝내기
        </Button>
      </div>
      <LiquidGlass id="phone-menu" hidden={!view.menuOpen} mode="opaque" radius={16}
        className="fixed right-4 top-16 max-h-[calc(100dvh-140px)] w-[min(380px,calc(100vw-32px))] overflow-auto landscape:right-24 landscape:max-h-[calc(100dvh-56px)]"
        contentClassName="flex flex-col gap-2 p-2.5">
        {view.ar && <TalkForm act={act} draft={draft} setDraft={setDraft} />}
        <Button variant="outline" size="touch" className="h-12 gap-2" onClick={act.resetAnchors}><RotateCcw />기준점 다시 찍기</Button>
        <Card><CardContent className="p-2"><pre className="m-0 whitespace-pre-wrap">{view.perfDetail}</pre></CardContent></Card>
        <Button variant="outline" size="touch" className="h-12" onClick={() => act.setMenu(false)}>닫기</Button>
      </LiquidGlass>
    </div>
  );
}
