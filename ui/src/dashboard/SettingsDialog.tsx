import { Bot, CalendarDays, FlaskConical, House, Plug, Server, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { DayView } from "../../../src/contract/reflection.ts";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "../components/ui/item";
import { QRCode } from "../components/ui/qr-code";
import { Status, StatusIndicator, StatusLabel } from "../components/ui/status";
import type { HubState } from "../lib/hub";
import { dayText } from "./clock";
import { RW } from "./reflection-words";
import { WORDS } from "./words";

/** 운영 모드 칩: 시험 모드 default, 실제 제어 warning. */
const MODE: Record<HubState["mode"], { text: string; variant: "default" | "warning" }> = {
  test: { text: "시험 모드", variant: "default" },
  live: { text: "실제 제어", variant: "warning" },
};

/** 설정 창 한 줄(Item sm): 아이콘, 이름, 오른쪽에 지금 상태. */
function Row({ icon: I, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <Item size="sm" role="listitem" className="flex-nowrap">
      <ItemMedia><I className="size-4" aria-hidden="true" /></ItemMedia>
      <ItemContent>
        <ItemDescription>{label}</ItemDescription>
      </ItemContent>
      <ItemActions className="min-w-0">{children}</ItemActions>
    </Item>
  );
}

/** 날짜 줄: 왼쪽은 지금 시스템 날짜와 상태, 오른쪽은 「하루 마치기」. 하루 마치기를 켠 서버(day.finish)에서만 보인다.
 *  확인 창은 설정 창과 같은 Dialog 부품이다(대시보드에서 닿는 부품은 받은 글 크기만 쓴다: Alert Dialog는 커지는 글 토큰이라 npm run lint가 막는다). 
 *  반성 중(하루 마치기 중이거나 반성 화면이 도는 동안)에는 누른 날과 「밤 반성 중」이고 단추가 꺼진다. */
function FinishDayRow({ day, reflecting, failed, onFinish }: { day: DayView; reflecting: DayView | null; failed: boolean; onFinish: (day: string) => void }) {
  const [ask, setAsk] = useState(false);
  const busy = day.closing || reflecting !== null;
  const shown = reflecting ?? day;
  const state = busy ? RW.closing : failed ? RW.finishFailed : day.shift > 0 ? RW.skipped(day.shift) : null;
  return (
    <Row icon={CalendarDays} label={RW.dayLine(dayText(shown.today), state)}>
      <Button size="sm" disabled={busy} onClick={() => setAsk(true)}>{RW.finish}</Button>
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{RW.ask}</DialogTitle>
            <DialogDescription>{RW.askLine}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{RW.cancel}</Button></DialogClose>
            <Button onClick={() => { setAsk(false); onFinish(day.today); }}>{RW.finish}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Row>
  );
}

/**
 * 연결·운영 상태와 폰 홈 QR을 보여 준다.
 * 상태를 보이고, 하루 마치기(FINISH_DAY=1인 서버)만 누를 수 있다. 입력칸이 없고, 모드를 바꾸는 일은 설정 화면에서 한다. Esc·바깥 누르기·닫기 단추로 닫힌다.
 */
export function SettingsDialog({ hub, day = null, reflecting = null, failed = false, onFinish }: {
  hub: HubState;
  /** 시스템 날짜 상태(day 메시지). 하루 마치기를 켠 서버면 날짜 줄이 보인다. */
  day?: DayView | null;
  /** 반성 화면이 도는 동안 누른 날의 날짜 상태(넘긴 뒤에도 재생이 끝날 때까지). */
  reflecting?: DayView | null;
  /** 마지막 하루 마치기 요청이 실패했다. */
  failed?: boolean;
  onFinish?: (day: string) => void;
}) {
  const mode = MODE[hub.mode];
  return (
    <DialogContent aria-describedby={undefined} className="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>설정</DialogTitle>
      </DialogHeader>
      <ItemGroup role="list" aria-label="허브 상태">
        <Row icon={Plug} label="연결">
          <Status role="status" variant={hub.connected ? "success" : "error"}>
            <StatusIndicator live={hub.connected} />
            <StatusLabel>{hub.connected ? "실시간 연결됨" : "연결 끊김"}</StatusLabel>
          </Status>
        </Row>
        <Row icon={FlaskConical} label="운영 모드">
          <Status variant={mode.variant}>{mode.text}</Status>
        </Row>
        <Row icon={Server} label="허브"><ItemTitle>{hub.hub}</ItemTitle></Row>
        <Row icon={Bot} label="에이전트"><ItemTitle>{hub.agent}</ItemTitle></Row>
        <Row icon={House} label="집"><ItemTitle>{hub.home}</ItemTitle></Row>
        {day?.finish && onFinish && <FinishDayRow day={day} reflecting={reflecting} failed={failed} onFinish={onFinish} />}
      </ItemGroup>
      {hub.phoneUrl ? (
        <Item variant="muted" className="flex-nowrap">
          <ItemMedia>
            <QRCode value={hub.phoneUrl} size={132} variant="squares" aria-label="폰 연결 QR" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>{WORDS.connectApp}</ItemTitle>
            <ItemDescription className="break-all">{hub.phoneUrl}</ItemDescription>
          </ItemContent>
        </Item>
      ) : <ItemDescription>{WORDS.appQrUnavailable}</ItemDescription>}
    </DialogContent>
  );
}
