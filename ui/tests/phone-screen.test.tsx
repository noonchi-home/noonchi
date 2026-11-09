// 실제 폰 화면(PhoneScreen.tsx): 실제 폰은 에이전트의 손이다. AR 중 위에는 미어캣(설정 단추)과 지금 할 명령 한 줄만,
// 아래에는 명령이 있을 때만 엄지 자리 카드 하나(비전 상태 한 줄, 그 바로 아래 「완료」나 답 단추). 설정은 미어캣을 누르면 열린다.
// 큰 단추(말하기·사진·끝내기)·상태 줄·fps·⋯ 메뉴·「나중에」·판단 말풍선은 없다. 일이 멈추는 문제는 모달과 고치는 단추, 추적 약함은 비전 상태 줄에만.
// 글 크기는 부품 원래 크기(단추 label 토큰, 큰 글 토큰 없음), 누르는 것은 48px(h-12·size-12). 세로가 기본 배치이고 가로는 landscape:로만 바꾼다.
import { act as flush, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SHOTS, SHOT_NAMES } from "../src/phone/fixtures";
import { PhoneScreen } from "../src/phone/PhoneScreen";
import type { PhoneActions, PhoneView, Support } from "../src/phone/state";

const actions = (): PhoneActions => ({
  startAr: vi.fn(), startPlace: vi.fn(), startFromSpot: vi.fn(), confirmStart: vi.fn(), endSetup: vi.fn(),
  setSettings: vi.fn(), micOn: vi.fn(), say: vi.fn(), confirm: vi.fn(), answer: vi.fn(),
});
function show(view: PhoneView) {
  const act = actions();
  const r = render(<PhoneScreen view={view} act={act} />);
  const overlay = r.container.querySelector<HTMLElement>("[data-phone-overlay]")!;
  const zone = (name: string) => overlay.querySelector<HTMLElement>(`[data-phone-zone=${name}]`);
  return { act, overlay, o: within(overlay), zone, ...r };
}
const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
const AR_SHOTS = SHOT_NAMES.filter((n) => SHOTS[n].view.ar);

describe("처음 화면", () => {
  it("마스코트·제목·AR 지원 줄·시작 위치 안내 하나·AR 시작. 덮개는 숨어 있다", async () => {
    const { act, overlay, container } = show(SHOTS.intro.view);
    expect(overlay.hidden).toBe(true);
    const mascot = container.querySelector('img[src="/brand/mascot@1x.webp"]')!;
    expect(words(mascot)).toContain("landscape:hidden");
    expect(screen.getByRole("heading", { name: "클로이드의 눈" })).toBeInTheDocument();
    expect(screen.getByText("준비됐어요. 폰을 세로로 들고 시작 위치에서 AR을 시작하세요.")).toHaveAttribute("data-support", "ready");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["거실·복도 테이블 앞에 서서 거실·복도 TV수납장 쪽을 보고 여기서 시작을 눌러요"]);
    await userEvent.click(screen.getByRole("button", { name: "AR 시작" }));
    expect(act.startAr).toHaveBeenCalledOnce();
  });

  it("시작 위치를 아직 정하지 않은 집이면 설정 화면에서 정하라고 안내한다", () => {
    show(SHOTS["intro-nostart"].view);
    expect(screen.getByText("준비됐어요. 폰을 세로로 들고 AR을 시작하세요.")).toHaveAttribute("data-support", "ready");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["먼저 설정 화면에서 시작 위치를 정해 주세요"]);
  });

  it("처음 화면의 승인 대기도 답마다 단추 하나", async () => {
    const { act, container } = show({ ...SHOTS.intro.view, pending: SHOTS.approve.view.pending });
    const list = within(container.querySelector("main")!).getByText("현관문: 현관문 잠금 해제").closest("[data-slot=item]")!;
    const buttons = within(list as HTMLElement).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["승인", "거절"]);
    await userEvent.click(buttons[1]!);
    expect(act.confirm).toHaveBeenCalledWith("t1", "reject");
  });

  it("누르고 말하기 단추는 없고 글 입력만. 보내면 say하고 칸을 비운다. 답 줄은 role=status", async () => {
    const { act } = show({ ...SHOTS.intro.view, reply: "에이전트가 연결되지 않았어요." });
    expect(screen.queryByRole("button", { name: /말하기/ })).toBeNull();
    expect(screen.getByText("에이전트가 연결되지 않았어요.").closest("[role=status]")).not.toBeNull();
    const input = screen.getByRole("textbox", { name: "클로이드에게 할 말" });
    await userEvent.type(input, "불 꺼줘{Enter}");
    expect(act.say).toHaveBeenCalledWith("불 꺼줘");
    expect(input).toHaveValue("");
  });

  it.each([
    [{ kind: "checking" }, "AR 지원을 확인하는 중…", true],
    [{ kind: "insecure" }, "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.", true],
    [{ kind: "no-ar" }, "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.", true],
    [{ kind: "failed", message: "NotAllowedError" }, "AR을 시작하지 못했어요: NotAllowedError", false],
  ] as [Support, string, boolean][])("%o: 까닭을 보이고, 시작 실패만 다시 누를 수 있다", (support, text, disabled) => {
    show({ ...SHOTS.intro.view, support });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AR 시작" }).hasAttribute("disabled")).toBe(disabled);
  });
});

describe("위: 미어캣과 지금 명령만", () => {
  it("명령이 있으면 왼쪽 위 미어캣(설정 단추)과 그 옆 명령 한 줄. 처음 화면은 숨는다", () => {
    const { overlay, zone } = show(SHOTS["pick-cup"].view);
    expect(overlay.hidden).toBe(false);
    expect(screen.queryByRole("heading", { name: "클로이드의 눈" })).toBeNull();
    const top = zone("top")!;
    const kids = [...top.children];
    expect(kids).toHaveLength(2);
    const meerkat = within(top).getByRole("button", { name: "설정" });
    expect(kids[0]).toBe(meerkat);
    expect(meerkat.querySelector("[data-shape=logo]")).not.toBeNull();
    expect(kids[1]).toHaveTextContent(/^컵을 들어 주세요$/);
    expect(kids[1]!.querySelector("[data-phone-text=명령]")).toHaveTextContent("컵을 들어 주세요");
    expect(within(top).getAllByRole("button")).toHaveLength(1);
  });

  it("명령이 없으면 미어캣만, 엄지 자리 카드도 없다", () => {
    const { zone } = show(SHOTS.idle.view);
    expect([...zone("top")!.children].map((el) => el.getAttribute("aria-label"))).toEqual(["설정"]);
    expect(zone("thumb")).toBeNull();
  });

  it("네 명령이 차례로 위 한 줄에 뜬다", () => {
    const texts = (["go-table", "pick-cup", "go-sink", "put-cup"] as const).map((n) => {
      const { zone, unmount } = show(SHOTS[n].view);
      const t = zone("top")!.textContent;
      unmount();
      return t;
    });
    expect(texts).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
  });
});

describe("아래: 엄지 자리 카드(비전 상태 바로 아래 「완료」)", () => {
  it("비전 상태 줄이 「완료」 바로 위에 있고, 「완료」는 받은 명령의 id·step으로 답한다", async () => {
    const { act, zone } = show(SHOTS["pick-cup"].view);
    const thumb = zone("thumb")!;
    const vision = within(thumb).getByText("컵 · 식탁 위");
    const done = within(thumb).getByRole("button", { name: "완료" });
    expect(within(thumb).getAllByRole("button")).toEqual([done]);
    const visionBox = vision.closest("[data-slot=status]")!;
    expect(visionBox.nextElementSibling!.contains(done)).toBe(true);
    expect(visionBox.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visionBox).toHaveAttribute("data-variant", "default");
    await userEvent.click(done);
    expect(act.answer).toHaveBeenCalledWith("plan:pam-1", "plan:pam-1:2", "done");
  });

  it("질문: 위에 질문, 아래에 답 단추(비전 상태 줄 없음). 첫 답이 주 단추", async () => {
    const { act, zone } = show(SHOTS.question.view);
    expect(zone("top")!).toHaveTextContent("컵을 치울까요?");
    const thumb = zone("thumb")!;
    expect(thumb.querySelector("[data-slot=status]")).toBeNull();
    const [clear, keep] = within(thumb).getAllByRole("button");
    expect([clear!.textContent, keep!.textContent]).toEqual(["치워 주세요", "그대로 둬요"]);
    expect(words(clear!)).toContain("bg-primary");
    expect(words(keep!)).toContain("border-input");
    await userEvent.click(keep!);
    expect(act.answer).toHaveBeenCalledWith("plan:pam-2", "plan:pam-2:1", "keep");
  });

  it("승인 대기(가전): 위에 「기기: 까닭」, 아래 답마다 단추 하나. 누르면 그 토큰과 답으로 답한다. 답은 승인·거절 둘", async () => {
    const { act, zone } = show(SHOTS.approve.view);
    expect(zone("top")!).toHaveTextContent("현관문: 현관문 잠금 해제");
    const thumb = zone("thumb")!;
    const buttons = within(thumb).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["승인", "거절"]);
    expect(words(buttons[0]!)).toContain("bg-primary");
    expect(words(buttons[1]!)).toContain("border-input");
    for (const gone of ["이번만", "앞으로도", "하지 마", "취소"]) expect(within(thumb).queryByRole("button", { name: gone })).toBeNull();
    for (const b of buttons) await userEvent.click(b);
    expect(vi.mocked(act.confirm).mock.calls).toEqual([["t1", "approve"], ["t1", "reject"]]);
  });

  it("처음 하는 계획의 승인: 위에 「컵 치우기를 할까요?」, 아래 승인·거절 두 단추(비전 상태 줄 없음). 누르면 그 명령의 id·step으로 답한다", async () => {
    const { act, zone } = show(SHOTS["approve-task"].view);
    expect(zone("top")!).toHaveTextContent(/^컵 치우기를 할까요\?$/);
    const thumb = zone("thumb")!;
    expect(thumb.querySelector("[data-slot=status]")).toBeNull();
    const buttons = within(thumb).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["승인", "거절"]);
    for (const b of buttons) await userEvent.click(b);
    expect(vi.mocked(act.answer).mock.calls).toEqual([["plan:pam-3", "plan:pam-3:approve", "approve"], ["plan:pam-3", "plan:pam-3:approve", "reject"]]);
  });

  it("추적이 약하면 모달 없이 비전 상태 줄이 「추적이 약해요」(경고)", () => {
    const { zone } = show(SHOTS.weak.view);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const line = within(zone("thumb")!).getByText("추적이 약해요").closest("[data-slot=status]")!;
    expect(line).toHaveAttribute("data-variant", "warning");
    expect(within(zone("thumb")!).getByRole("button", { name: "완료" })).toBeInTheDocument();
  });

  it("시작 위치 맞추기: 위는 「<자리>에 서서 <보는 쪽> 쪽을 봐 주세요」, 아래는 「여기서 시작」 하나. 문제 모달은 없다", async () => {
    const { act, zone } = show(SHOTS.start.view);
    expect(zone("top")!).toHaveTextContent(/^거실·복도 테이블 앞에 서서 거실·복도 TV수납장 쪽을 봐 주세요$/);
    const buttons = within(zone("thumb")!).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["여기서 시작"]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.click(buttons[0]!);
    expect(act.confirmStart).toHaveBeenCalledOnce();
  });

  it("맞추는 중(어림)에는 명령의 비전 상태 줄 앞에 「위치 맞추는 중」. 문제 모달은 없다", () => {
    const { zone } = show(SHOTS.aligning.view);
    expect(within(zone("thumb")!).getByText("위치 맞추는 중 · 컵 · 식탁 위")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("물건 자리 맞추기: 위는 「여기」 말하기 안내, 「완료」로 끝낸다", async () => {
    const { act, zone } = show(SHOTS.place.view);
    expect(zone("top")!).toHaveTextContent('물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요');
    await userEvent.click(within(zone("thumb")!).getByRole("button", { name: "완료" }));
    expect(act.endSetup).toHaveBeenCalledOnce();
  });
});

describe("없앤 것", () => {
  it.each(AR_SHOTS)("%s: 큰 단추·상태 줄·fps·⋯ 메뉴·나중에·사진 요청·판단 말풍선이 없다", (name) => {
    const { overlay } = show(SHOTS[name].view);
    const names = [...overlay.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    for (const gone of ["누르고 말하기", "말하기", "사진 찍기", "사진", "끝내기", "메뉴", "나중에", "치웠어요", "보내기"]) expect(names, name).not.toContain(gone);
    expect(overlay.querySelector("#phone-menu, [data-phone-mascot], [data-phone-zone=bubble], input, [role=tooltip]")).toBeNull();
    expect(overlay.textContent).not.toMatch(/fps|맞춤 ✓|맞추기 전|모의|클로이드라면|클로이드 주목/);
  });
});

describe("미어캣: 설정", () => {
  function Live({ start, act }: { start: PhoneView; act: PhoneActions }) {
    const [view, setView] = useState(start);
    return <PhoneScreen view={view} act={{ ...act, setSettings: (open) => { act.setSettings(open); setView((v) => ({ ...v, settingsOpen: open })); } }} />;
  }

  it("미어캣을 누르면 설정(연결·듣기·위치·기준)이 열리고, 닫으면 미어캣으로 초점이 돌아온다", async () => {
    const act = actions();
    render(<Live start={SHOTS["pick-cup"].view} act={act} />);
    const meerkat = screen.getByRole("button", { name: "설정" });
    await userEvent.click(meerkat);
    const dialog = screen.getByRole("alertdialog", { name: "설정" });
    expect(dialog.closest("[data-phone-overlay]")).not.toBeNull();
    expect(within(dialog).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["연결됨", "듣기켜짐", "위치맞음 · 3cm", "기준시작 위치 · 물건 2 · 벽 84점"]);
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["닫기", "물건 자리 맞추기", "시작 위치에서 다시 맞추기"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(vi.mocked(act.setSettings).mock.calls).toEqual([[true], [false]]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "설정" }));
  });

  it("설정 모달 세 단추 사이는 footer gap(8px) 하나뿐: 「닫기」에 부품의 mt-2가 남지 않는다", () => {
    show(SHOTS.settings.view);
    const dialog = within(screen.getByRole("alertdialog", { name: "설정" }));
    for (const name of ["닫기", "물건 자리 맞추기", "시작 위치에서 다시 맞추기"]) expect(dialog.getByRole("button", { name }).className.split(/\s+/), name).not.toContain("mt-2");
  });

  it("「시작 위치에서 다시 맞추기」가 주 단추, 「물건 자리 맞추기」는 보조. 시작 위치가 없는 집이면 다시 맞추기가 없다", () => {
    show(SHOTS.settings.view);
    const buttons = within(screen.getByRole("alertdialog", { name: "설정" })).getAllByRole("button");
    expect(words(buttons[2]!)).toContain("bg-primary");
    expect(words(buttons[1]!)).toContain("border-input");
  });

  it("시작 위치가 없는 집의 설정에는 「시작 위치에서 다시 맞추기」가 없다", () => {
    show({ ...SHOTS.settings.view, sync: { ...SHOTS.settings.view.sync!, start: null } });
    expect(within(screen.getByRole("alertdialog", { name: "설정" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["닫기", "물건 자리 맞추기"]);
  });

  it.each([["시작 위치에서 다시 맞추기", "startFromSpot"], ["물건 자리 맞추기", "startPlace"]] as const)("설정의 「%s」", async (label, fn) => {
    const { act } = show(SHOTS.settings.view);
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "설정" })).getByRole("button", { name: label }));
    expect(act[fn]).toHaveBeenCalledOnce();
  });
});

describe("문제 모달", () => {
  it("시작 위치 없음: 「설정 화면에서 시작 위치를 정해 주세요」(단추 없음). 시작 위치가 생기면 닫힌다", () => {
    const act = actions();
    const { rerender } = render(<PhoneScreen view={SHOTS["no-start"].view} act={act} />);
    const dialog = screen.getByRole("alertdialog", { name: "설정 화면에서 시작 위치를 정해 주세요" });
    expect(dialog.closest("[data-phone-overlay]")).not.toBeNull();
    expect(within(dialog).queryAllByRole("button")).toEqual([]);
    rerender(<PhoneScreen view={SHOTS.start.view} act={act} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each([
    ["mic", "마이크가 꺼져 있어요", "마이크 켜기", "micOn"],
  ] as const)("%s: 「%s」와 고치는 단추 「%s」", async (name, title, fix, fn) => {
    const { act } = show(SHOTS[name].view);
    const dialog = screen.getByRole("alertdialog", { name: title });
    expect(dialog.closest("[data-phone-overlay]")).not.toBeNull();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([fix]);
    await userEvent.click(within(dialog).getByRole("button", { name: fix }));
    expect(act[fn]).toHaveBeenCalledOnce();
  });

  it("연결이 끊기면 「다시 연결하는 중」(단추 없음). 다시 붙으면 닫힌다", () => {
    const act = actions();
    const { rerender } = render(<PhoneScreen view={SHOTS.offline.view} act={act} />);
    const dialog = screen.getByRole("alertdialog", { name: "다시 연결하는 중" });
    expect(within(dialog).queryAllByRole("button")).toEqual([]);
    rerender(<PhoneScreen view={{ ...SHOTS.offline.view, connected: true }} act={act} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("문제가 생기면 설정은 닫히고 그 문제 모달만 뜬다", () => {
    show({ ...SHOTS.settings.view, listening: "denied" });
    expect(screen.getAllByRole("alertdialog").map((d) => d.textContent)).toEqual(["마이크가 꺼져 있어요마이크 켜기"]);
  });

  it("AR 밖(처음 화면)에서는 모달이 없다", () => {
    show({ ...SHOTS.intro.view, listening: "denied", connected: false, settingsOpen: true });
    expect(screen.queryAllByRole("alertdialog")).toEqual([]);
  });
});

describe("배치·글 크기", () => {
  it("세로가 기본: class에 portrait:가 없다. 위 줄과 엄지 자리는 옆 여백 16px, 엄지 자리는 맨 아래, 가로면 오른쪽 아래", () => {
    for (const name of AR_SHOTS) {
      const { overlay, unmount } = show(SHOTS[name].view);
      expect([...overlay.querySelectorAll("[class]")].flatMap(words).filter((w) => w.startsWith("portrait:")), name).toEqual([]);
      unmount();
    }
    const { zone } = show(SHOTS["pick-cup"].view);
    expect(words(zone("top")!)).toEqual(expect.arrayContaining(["fixed", "top-0", "px-4"]));
    expect(words(zone("thumb")!)).toEqual(expect.arrayContaining(["fixed", "left-4", "right-4", "bottom-[calc(env(safe-area-inset-bottom)+16px)]", "landscape:left-auto"]));
  });

  it("초점 그림 canvas는 맨 아래(위 줄·엄지 자리가 그 위). 조준점은 canvas에만 그린다", () => {
    const { overlay } = show(SHOTS["pick-cup"].view);
    expect(overlay.firstElementChild!.tagName).toBe("CANVAS");
    expect(overlay.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(words(overlay.firstElementChild!)).toContain("pointer-events-none");
  });

  it.each(AR_SHOTS)("%s: 단추 글은 부품 원래 크기(text-sm), 큰 글 토큰이 없고, 누르는 것은 48px", async (name) => {
    const { overlay } = show(SHOTS[name].view);
    await flush(async () => {});
    const roots = [overlay, ...document.querySelectorAll<HTMLElement>("[role=alertdialog]")];
    const all = roots.flatMap((r) => [r, ...r.querySelectorAll("[class]")]);
    expect(all.flatMap(words).filter((w) => ["text-headline", "text-display", "text-title", "text-far", "text-body"].includes(w)), name).toEqual([]);
    const buttons = roots.flatMap((r) => [...r.querySelectorAll("button")]);
    for (const b of buttons) {
      expect(words(b), `${name} ${b.textContent}`).toContain("text-sm");
      expect(words(b).some((w) => w === "h-12" || w === "size-12"), `${name} ${b.textContent}`).toBe(true);
    }
  });
});
