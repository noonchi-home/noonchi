// 누르고 말하기(talk.js): 누르면 크롬 음성 인식(ko-KR)으로 듣고, 들은 글을 15초 줄로 보이고, 떼면 그 글을 보낸다.
import { describe, expect, it } from "vitest";
import { createPressToTalk, recognition } from "../ui/src/phone/core/talk.js";

class FakeRec {
  static last: FakeRec;
  lang = "";
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  constructor() { FakeRec.last = this; }
  start() { this.started += 1; }
  stop() { this.onend?.(); }
}

function hooks() {
  const log: string[] = [];
  return {
    log,
    h: {
      onListening: (on: boolean) => log.push(on ? "듣는 중" : "멈춤"),
      onLine: (text: string, ms?: number) => log.push(`줄 ${text}${ms ? ` ${ms}` : ""}`),
      onHeard: (text: string) => log.push(`보냄 ${text}`),
    },
  };
}

describe("누르고 말하기(talk.js)", () => {
  it("누르면 ko-KR로 듣고, 들은 글을 15초 줄로, 떼면 그 글을 보낸다. 듣는 중에 또 눌러도 새로 만들지 않는다", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(FakeRec as never, h);
    talk.down();
    const rec = FakeRec.last;
    expect([rec.lang, rec.interimResults, rec.maxAlternatives, rec.started]).toEqual(["ko-KR", true, 1, 1]);
    talk.down();
    expect(FakeRec.last).toBe(rec);
    rec.onresult!({ results: [[{ transcript: "TV " }], [{ transcript: "켜줘" }]] });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 🎙 TV 켜줘 15000", "멈춤", "보냄 TV 켜줘"]);
  });

  it("아무 말도 없으면 보내지 않는다. 마이크 권한이 없으면 허용하라고, 다른 오류는 그 이름", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(FakeRec as never, h);
    talk.down();
    FakeRec.last.onerror!({ error: "not-allowed" });
    FakeRec.last.onerror!({ error: "network" });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.", "줄 음성 인식 오류: network", "멈춤"]);
  });

  it("시작이 실패하면 그 까닭을 보이고 듣지 않는다", () => {
    class Busy extends FakeRec { override start() { throw new Error("busy"); } }
    const { log, h } = hooks();
    createPressToTalk(Busy as never, h).down();
    expect(log).toEqual(["줄 음성 인식을 시작하지 못했어요: busy"]);
  });

  it("음성 인식이 없는 브라우저는 null", () => {
    expect(recognition({})).toBeNull();
    expect(recognition({ webkitSpeechRecognition: FakeRec })).toBe(FakeRec);
  });
});
