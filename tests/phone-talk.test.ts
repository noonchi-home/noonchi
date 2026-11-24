// 늘 듣기(talk.js createListener): 크롬 음성 인식(ko-KR)을 이어서 켜 두고, 끝나면 다시 켠다. 끝난 말만 한 번씩 보낸다.
// 폰이 소리로 읽는 동안(pause)은 끄고 resume으로 다시 켠다. 마이크 권한이 없으면 denied로 멈추고, start()를 다시 부르면 새로 켠다.
// speak는 다 읽으면(끝·오류) done을 부른다. 음성 합성이 없거나 글이 비면 바로 done.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createListener, recognition, speak } from "../ui/src/phone/core/talk.js";

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
  onspeechstart: (() => void) | null = null;
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
  const l = createListener(FakeRec as never, { onState: (s) => log.push(s), onHeard: (t) => heard.push(t), onSpeechStart: () => heard.push("(말 시작)") }, { restartMs: 300 });
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

  it("말이 시작되면(인식 speechstart) onSpeechStart를 부른다: 그 말이 끝나 보내지기 전에", () => {
    const { l, heard } = make();
    l.start();
    last().onspeechstart?.();
    last().hear("완료");
    expect(heard).toEqual(["(말 시작)", "완료"]);
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
    expect(heard).toEqual([]);
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
  it("합성을 생성하거나 시작할 수 없어도 즉시 끝내 듣기로 돌아간다", () => {
    const done = vi.fn();
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: () => { throw new Error("speaker unavailable"); } });
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    speak("싱크대로 가 주세요", done);
    expect(done).toHaveBeenCalledTimes(1);
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    speak("싱크대로 가 주세요", done);
    expect(done).toHaveBeenCalledTimes(2);
  });
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
