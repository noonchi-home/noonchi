// 테스트용 눈 영상 스트림(GET /api/eye/video) 읽기. 화면 쪽 파서(web/eye-video.js)로 메시지를 자른다.
import { get, type IncomingMessage } from "node:http";
import { createStreamParser, type StreamMessage } from "../../web/eye-video.js";

export interface VideoReader {
  res: IncomingMessage;
  got: StreamMessage[];
  ended: Promise<void>;
  /** 조건에 맞는 메시지가 n개 모일 때까지 기다린다. */
  waitFor(pred: (m: StreamMessage) => boolean, n?: number, ms?: number): Promise<StreamMessage[]>;
  close(): void;
}

/** http.get. 이 PC의 Windows는 127.0.0.1 connect가 가끔 EFAULT로 실패해 다시 시도한다(src/shared/net.ts). */
export async function readVideo(url: string): Promise<VideoReader> {
  let res: IncomingMessage;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await new Promise<IncomingMessage>((ok, fail) => get(url, ok).on("error", fail));
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== "EFAULT" || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
  const parser = createStreamParser();
  const got: StreamMessage[] = [];
  const waiters: (() => void)[] = [];
  res.on("data", (c: Buffer) => {
    got.push(...parser.push(new Uint8Array(c)));
    for (const w of waiters.splice(0)) w();
  });
  const ended = new Promise<void>((r) => { res.once("end", () => r()); res.once("close", () => r()); });
  return {
    res, got, ended,
    waitFor(pred, n = 1, ms = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`영상 메시지를 기다리다 시간 초과(받은 것: ${got.map((m) => m.header.type).join(",")})`)), ms);
        const check = () => {
          const hits = got.filter(pred);
          if (hits.length >= n) {
            clearTimeout(timer);
            resolve(hits);
          } else waiters.push(check);
        };
        check();
      });
    },
    close: () => res.destroy(),
  };
}
