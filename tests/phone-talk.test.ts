// 늘 듣기(talk.js createListener): 크롬 음성 인식(ko-KR)을 이어서 켜 두고, 끝나면 다시 켠다. 끝난 말만 한 번씩 보낸다.
// 폰이 소리로 읽는 동안(pause)은 끄고 resume으로 다시 켠다. 마이크 권한이 없으면 denied로 멈추고, start()를 다시 부르면 새로 켠다.
// speak는 다 읽으면(끝·오류) done을 부른다. 음성 합성이 없거나 글이 비면 바로 done.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createListener, createPressToTalk, recognition, speak } from "../ui/src/phone/core/talk.js";

type Result = { isFinal: boolean; 0: { transcript: string }; length: 1 };
class FakeRec {
  static all: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = true;
  maxAlternatives = 0;
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;
  results: Result[] = [];
  constructor() { FakeRec.all.push(this); }
  start() { this.started += 1; }
  stop() { this.onend?.(); }
  abort() { this.aborted += 1; this.onend?.(); }
  /** continuous 인식처럼 결과를 쌓고, 바뀐 첫 자리(resultIndex)부터 알린다. */
  hear(transcript: string, isFinal = true) {
    const i = this.results.length;
    this.results.push({ isFinal, 0: { transcript }, length: 1 });
    this.onresult?.({ resultIndex: i, results: this.results });
  }
}
const last = () => FakeRec.all.at(-1)!;

function make() {
  const log: string[] = [];
  const heard: string[] = [];
  const l = createListener(FakeRec as never, { onState: (s) => log.push(s), onHeard: (t) => heard.push(t) }, { restartMs: 300 });
  return { l, log, heard };
}

beforeEach(() => { FakeRec.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("늘 듣기(createListener)", () => {
  it("start: ko-KR로 이어서 듣고, 끝난 말만 한 번씩 보낸다", () => {
    const { l, log, heard } = make();
    l.start();
    const rec = last();
    expect([rec.lang, rec.continuous, rec.interimResults, rec.maxAlternatives, rec.started]).toEqual(["ko-KR", true, false, 1, 1]);
    rec.hear(" 다 했어 ");
    rec.hear("컵", false);
    rec.hear("TV 켜줘");
    expect(heard).toEqual(["다 했어", "TV 켜줘"]);
    expect(log).toEqual(["on"]);
  });

  it("인식이 끝나면 300ms 뒤 새로 켠다. stop() 뒤에는 다시 켜지 않는다", () => {
    const { l, log } = make();
    l.start();
    last().stop();
    vi.advanceTimersByTime(299);
    expect(FakeRec.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeRec.all).toHaveLength(2);
    expect(last().started).toBe(1);
    l.stop();
    expect(last().aborted).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(FakeRec.all).toHaveLength(2);
    expect(log).toEqual(["on", "off"]);
  });

  it("pause: 듣기를 끊고 resume까지 켜지 않는다. resume이면 새로 켠다", () => {
    const { l, log, heard } = make();
    l.start();
    const rec = last();
    l.pause();
    expect(rec.aborted).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(FakeRec.all).toHaveLength(1);
    rec.hear("완료");
    expect(heard).toEqual(["완료"]);
    l.resume();
    expect(FakeRec.all).toHaveLength(2);
    expect(last().started).toBe(1);
    expect(log).toEqual(["on", "paused", "on"]);
  });

  it.each(["not-allowed", "service-not-allowed", "audio-capture"])("%s: 마이크 꺼짐(denied)으로 멈추고, start()를 다시 부르면 새로 켠다", (error) => {
    const { l, log } = make();
    l.start();
    last().onerror!({ error });
    last().onend!();
    vi.advanceTimersByTime(5000);
    expect(FakeRec.all).toHaveLength(1);
    l.start();
    expect(FakeRec.all).toHaveLength(2);
    expect(log).toEqual(["on", "denied", "on"]);
  });

  it("다른 오류(소리 없음·네트워크)는 끝난 뒤 다시 켠다", () => {
    const { l, log } = make();
    l.start();
    last().onerror!({ error: "no-speech" });
    last().onend!();
    vi.advanceTimersByTime(300);
    expect(FakeRec.all).toHaveLength(2);
    expect(log).toEqual(["on"]);
    l.stop();
  });

  it("켜기가 실패하면 300ms 뒤 다시 켠다", () => {
    let fail = true;
    class Busy extends FakeRec { override start() { if (fail) throw new Error("busy"); super.start(); } }
    const l = createListener(Busy as never, { onState: () => {}, onHeard: () => {} }, { restartMs: 300 });
    l.start();
    fail = false;
    vi.advanceTimersByTime(300);
    expect(FakeRec.all).toHaveLength(2);
    expect(last().started).toBe(1);
    l.stop();
  });

  it("음성 인식이 없는 브라우저는 null", () => {
    expect(recognition({})).toBeNull();
    expect(recognition({ webkitSpeechRecognition: FakeRec })).toBe(FakeRec);
  });
});

describe("소리로 읽기(speak)", () => {
  it("음성 합성이 없거나 글이 비면 바로 done", () => {
    const done = vi.fn();
    speak("컵을 들어 주세요", done);
    expect(done).toHaveBeenCalledOnce();
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn() });
    speak("", done);
    expect(done).toHaveBeenCalledTimes(2);
  });

  it("앞 소리를 끊고 ko-KR 1.05배로 읽고, 다 읽거나 오류가 나면 done", () => {
    const said: { text: string; lang: string; rate: number; onend: () => void; onerror: () => void }[] = [];
    const synth = { cancel: vi.fn(), speak: (u: (typeof said)[number]) => said.push(u) };
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; rate = 1; onend = () => {}; onerror = () => {}; constructor(readonly text: string) {} });
    const done = vi.fn();
    speak("식탁으로 가 주세요", done);
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(said.map((u) => [u.text, u.lang, u.rate])).toEqual([["식탁으로 가 주세요", "ko-KR", 1.05]]);
    expect(done).not.toHaveBeenCalled();
    said[0]!.onend();
    expect(done).toHaveBeenCalledOnce();
    speak("컵을 들어 주세요", done);
    said[1]!.onerror();
    expect(done).toHaveBeenCalledTimes(2);
  });
});

class PressRec {
  static last: PressRec;
  lang = "";
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  constructor() { PressRec.last = this; }
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

describe("누르고 말하기(createPressToTalk)", () => {
  it("누르면 ko-KR로 듣고, 들은 글을 15초 줄로, 떼면 그 글을 보낸다. 듣는 중에 또 눌러도 새로 만들지 않는다", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(PressRec as never, h);
    talk.down();
    const rec = PressRec.last;
    expect([rec.lang, rec.interimResults, rec.maxAlternatives, rec.started]).toEqual(["ko-KR", true, 1, 1]);
    talk.down();
    expect(PressRec.last).toBe(rec);
    rec.onresult!({ results: [[{ transcript: "TV " }], [{ transcript: "켜줘" }]] });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 🎙 TV 켜줘 15000", "멈춤", "보냄 TV 켜줘"]);
  });

  it("아무 말도 없으면 보내지 않는다. 마이크 권한이 없으면 허용하라고, 다른 오류는 그 이름", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(PressRec as never, h);
    talk.down();
    PressRec.last.onerror!({ error: "not-allowed" });
    PressRec.last.onerror!({ error: "network" });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.", "줄 음성 인식 오류: network", "멈춤"]);
  });

  it("시작이 실패하면 그 까닭을 보이고 듣지 않는다", () => {
    class Busy extends PressRec { override start() { throw new Error("busy"); } }
    const { log, h } = hooks();
    createPressToTalk(Busy as never, h).down();
    expect(log).toEqual(["줄 음성 인식을 시작하지 못했어요: busy"]);
  });

});
