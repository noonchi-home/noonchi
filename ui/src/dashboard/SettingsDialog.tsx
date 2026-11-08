import { Bot, FlaskConical, House, Plug, Server, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "../components/ui/item";
import { QRCode } from "../components/ui/qr-code";
import { Status, StatusIndicator, StatusLabel } from "../components/ui/status";
import type { HubState } from "./hub";

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

/**
 * 설정 창 내용(21st.dev Dialog). 연결 상태, 시험 모드·실제 제어, 허브, 에이전트, 지금 집 이름, 폰 연결 QR(폰 주소가 있을 때), 「집 다시 설정하기」(설정 화면으로 감).
 * 상태를 보이기만 한다. 입력칸이 없고, 모드를 바꾸는 일은 설정 화면에서 한다. Esc·바깥 누르기·닫기 단추로 닫힌다.
 */
export function SettingsDialog({ hub }: { hub: HubState }) {
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
      </ItemGroup>
      {hub.phoneUrl && (
        <Item variant="muted" className="flex-nowrap">
          <ItemMedia>
            <QRCode value={hub.phoneUrl} size={132} variant="squares" aria-label="폰 연결 QR" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>폰 카메라로 찍으세요</ItemTitle>
            <ItemDescription className="break-all">{hub.phoneUrl}</ItemDescription>
          </ItemContent>
        </Item>
      )}
      <DialogFooter>
        <Button asChild>
          <a href={hub.setupHref}>집 다시 설정하기</a>
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
