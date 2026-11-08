// 폰 화면 뿌리(PhoneApp): 제어(controller.ts)의 상태를 그대로 그리고, 화면 단추가 서버로 말을 보낸다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoneController } from "../src/phone/controller";
import { PhoneApp } from "../src/phone/PhoneApp";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, any>[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: any) => void) { (this.on[t] ??= []).push(f); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

const made: { close(): void }[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); });

describe("폰 화면 뿌리(PhoneApp)", () => {
  it("상태 메시지가 오면 첫 안내에 기준점 이름, AR이 없으면 까닭, 글을 보내면 서버로 say", async () => {
    const c = createPhoneController({
      location: { protocol: "http:", host: "127.0.0.1:8521", search: "" }, Socket: FakeSocket, Recognition: null,
      speak: () => {}, secure: true, xr: { isSessionSupported: async () => false },
    });
    made.push(c);
    render(<PhoneApp controller={c} />);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.push({ type: "status", mode: "floor", revision: 1, anchors: [{ id: "a", label: "거실 창가", recorded: false }], aligned: false, mismatch_m: null });
    });
    const main = within(screen.getByRole("main"));
    expect(main.getAllByRole("listitem")[0]).toHaveTextContent("거실 창가 바닥에 차례로 조준점을 맞추고 지점 기록을 눌러요");
    expect(await main.findByText("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.")).toBeInTheDocument();
    await userEvent.type(main.getByRole("textbox", { name: "클로이드에게 할 말" }), "TV 켜줘");
    await userEvent.click(main.getByRole("button", { name: "보내기" }));
    expect(FakeSocket.last.sent).toContainEqual({ type: "say", text: "TV 켜줘" });
    expect(main.getByText('🎙 "TV 켜줘" … 생각 중').closest("[role=status]")).not.toBeNull();
  });
});
