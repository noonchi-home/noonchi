// 폰 표시 영상의 순수 계산(ui/src/phone/core/video.js): 영상 크기, 코덱 후보, 패킷, 보내기 관문.
import { describe, expect, it } from "vitest";
import { parsePacket } from "../src/phone/packet.js";
import { codecCandidates, createBacklogWatch, createSendGate, videoPacket, videoSize } from "../ui/src/phone/core/video.js";

describe("영상 크기", () => {
  it("긴 변 1280·짧은 변 720 안으로 줄이고 16 배수로 맞춘다(세로·가로 그대로)", () => {
    expect(videoSize(1080, 2340)).toEqual({ width: 592, height: 1280 }); // 세로 19.5:9 폰
    expect(videoSize(2340, 1080)).toEqual({ width: 1280, height: 592 });
    expect(videoSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(videoSize(1440, 1440)).toEqual({ width: 720, height: 720 });
  });

  it("카메라보다 키우지 않는다", () => {
    expect(videoSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(videoSize(360, 780)).toEqual({ width: 352, height: 768 }); // 16 배수로 올리면 카메라보다 커져 내린다
  });

  it("긴 변을 바꿀 수 있다(?vlong=)", () => {
    expect(videoSize(1080, 2340, { long: 1920, short: 1080 })).toEqual({ width: 880, height: 1920 });
  });
});

describe("코덱 후보", () => {
  it("크기에 맞는 가장 낮은 레벨부터, 레벨마다 Constrained Baseline → Main → High", () => {
    expect(codecCandidates(592, 1280).slice(0, 3)).toEqual(["avc1.42E01F", "avc1.4D401F", "avc1.64001F"]);
    expect(codecCandidates(720, 1280)[0]).toBe("avc1.42E01F"); // 3600 매크로블록 = 레벨 3.1 한도
    expect(codecCandidates(880, 1920)[0]).toBe("avc1.42E028");
    expect(codecCandidates(592, 1280)).toContain("avc1.640028");
  });
});

describe("영상 패킷", () => {
  it("서버 parsePacket이 그대로 읽는다", () => {
    const body = new Uint8Array([0, 0, 0, 1, 0x65, 0x88]);
    const bytes = videoPacket({ kind: "video", key: true, ts: 33_333, width: 592, height: 1280 }, body);
    expect(parsePacket(Buffer.from(bytes))).toEqual({ video: { kind: "video", key: true, ts: 33_333, width: 592, height: 1280 }, data: Buffer.from(body) });
  });
});

describe("인코더 밀림 감시", () => {
  it("2초 동안 시도의 절반 넘게 밀리면 한 번 알리고, 다음 판단은 다시 2초 뒤", () => {
    let t = 0;
    const w = createBacklogWatch({ windowMs: 2000, minAttempts: 20, ratio: 0.5, now: () => t });
    for (let i = 0; i < 30; i++) {
      w.attempt(i % 3 !== 0); // 2/3 밀림
      t += 33;
    }
    expect(w.check()).toBe(false); // 아직 2초가 안 됨
    for (let i = 0; i < 40; i++) {
      w.attempt(i % 3 !== 0);
      t += 33;
    }
    expect(w.check()).toBe(true);
    expect(w.check()).toBe(false); // 알린 뒤 창을 새로 시작
  });

  it("밀림이 절반 아래거나 시도가 적으면 알리지 않는다", () => {
    let t = 0;
    const w = createBacklogWatch({ windowMs: 2000, minAttempts: 20, ratio: 0.5, now: () => t });
    for (let i = 0; i < 70; i++) {
      w.attempt(i % 4 === 0); // 1/4 밀림
      t += 33;
    }
    expect(w.check()).toBe(false);
    const few = createBacklogWatch({ windowMs: 2000, minAttempts: 20, ratio: 0.5, now: () => t });
    for (let i = 0; i < 10; i++) {
      few.attempt(true);
      t += 300;
    }
    expect(few.check()).toBe(false);
  });
});

describe("보내기 관문", () => {
  it("처음은 키프레임, 그 뒤 2초마다 키프레임", () => {
    const g = createSendGate({ keyMs: 2000 });
    expect(g.beforeEncode(0, 0)).toEqual({ keyFrame: true });
    expect(g.beforeEncode(0, 33)).toEqual({ keyFrame: false });
    expect(g.beforeEncode(0, 1999)).toEqual({ keyFrame: false });
    expect(g.beforeEncode(0, 2000)).toEqual({ keyFrame: true });
  });

  it("처음 키프레임 앞에 설정을 보내고, 설정이 바뀌면 다시 보낸다", () => {
    const g = createSendGate();
    g.beforeEncode(0, 0);
    expect(g.onChunk(true, 0)).toEqual({ send: true, config: true });
    expect(g.onChunk(false, 0)).toEqual({ send: true, config: false });
    g.configChanged();
    expect(g.onChunk(true, 0)).toEqual({ send: true, config: true });
  });

  it("와이파이 버퍼가 넘치면 인코딩을 쉬고, 다음 프레임은 키프레임으로 다시 시작한다", () => {
    const g = createSendGate({ maxBuffered: 1000, keyMs: 2000 });
    g.beforeEncode(0, 0);
    g.onChunk(true, 0);
    expect(g.beforeEncode(5000, 33)).toBeNull();
    expect(g.beforeEncode(0, 66)).toEqual({ keyFrame: true });
  });

  it("보낼 때 버퍼가 넘치면 그 청크를 버리고, 키프레임 전 델타도 버린다", () => {
    const g = createSendGate({ maxBuffered: 1000, keyMs: 2000 });
    g.beforeEncode(0, 0);
    expect(g.onChunk(true, 0)).toMatchObject({ send: true });
    expect(g.onChunk(false, 5000)).toEqual({ send: false, config: false });
    expect(g.onChunk(false, 0)).toEqual({ send: false, config: false }); // 앞 델타를 잃어 풀 수 없다
    expect(g.beforeEncode(0, 100)).toEqual({ keyFrame: true });
    expect(g.onChunk(true, 0)).toEqual({ send: true, config: false });
    expect(g.onChunk(false, 0)).toEqual({ send: true, config: false });
  });

  it("다시 연결하면(reset) 설정과 키프레임부터 다시 보낸다", () => {
    const g = createSendGate({ keyMs: 2000 });
    g.beforeEncode(0, 0);
    g.onChunk(true, 0);
    g.reset();
    expect(g.onChunk(false, 0)).toEqual({ send: false, config: false });
    expect(g.beforeEncode(0, 50)).toEqual({ keyFrame: true });
    expect(g.onChunk(true, 0)).toEqual({ send: true, config: true });
  });
});
