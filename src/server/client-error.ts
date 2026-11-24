// 앱(apps/android) 화면 오류 받기: POST /api/mobile/client-error(계약 src/contract/client-error.ts).
// 시연 폰은 adb로 로그를 볼 수 없어서 앱이 잡은 렌더 오류를 허브 서버 로그로 읽는다. 껍데기 서버(shell.ts)가 받아서 집을 바꾸는 중에도 남는다.
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { ClientErrorAccepted, ClientErrorReport } from "../contract/client-error.js";
import { HttpError, readJson } from "./routes/kit.js";

export const CLIENT_ERROR_PATH = "/api/mobile/client-error";
const MAX_BODY = 16 * 1024;
const PER_MINUTE = 10;
const MINUTE_MS = 60_000;
/** Date가 나타낼 수 있는 가장 늦은 때(ms). 넘으면 toISOString이 던진다. */
const LATEST_MS = 8.64e15;

// 다섯 칸만 받는다(모르는 칸이 있으면 거절): 사진·개인 정보가 실려 오지 않게.
const REPORT: z.ZodType<ClientErrorReport> = z.strictObject({
  message: z.string().min(1).max(1000),
  stack: z.string().max(4000).nullable(),
  component_stack: z.string().max(4000).nullable(),
  app_version: z.string().min(1).max(40),
  at_ms: z.number().int().min(0).max(LATEST_MS),
});

/** 줄바꿈·제어 문자를 빈칸으로: 받은 글이 로그 머리 줄을 나누거나 터미널을 바꾸지 못하게. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
const block = (text: string) => text.split(/\r?\n/).map(oneLine).filter(Boolean).map((line) => `    ${line}`).join("\n");

/** 서버 로그 글: 머리 한 줄([앱 오류] …) 뒤에 스택·부품 줄. */
export function clientErrorLog(report: ClientErrorReport): string {
  const head = `[앱 오류] ${oneLine(report.message)} · 앱 ${oneLine(report.app_version)} · 폰 시각 ${new Date(report.at_ms).toISOString()}`;
  const parts = [head];
  if (report.stack?.trim()) parts.push("  stack:", block(report.stack));
  if (report.component_stack?.trim()) parts.push("  component_stack:", block(report.component_stack));
  return parts.join("\n");
}

/** 받는 함수. 분당 10건(거절된 요청도 센다)을 넘으면 429, 본문이 16KB를 넘으면 413, 모양이 다르면 400. */
export function clientErrorReceiver(opts: { log: (line: string) => void; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let recent: number[] = [];
  return async (req: IncomingMessage): Promise<ClientErrorAccepted> => {
    const at = now();
    recent = recent.filter((t) => at - t < MINUTE_MS);
    if (recent.length >= PER_MINUTE) throw new HttpError(429, "앱 오류 보고가 너무 잦아요. 1분 뒤 다시 보내 주세요.");
    recent.push(at);
    const body = await readJson(req, MAX_BODY);
    const parsed = REPORT.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "앱 오류 보고 모양이 맞지 않아요.");
    opts.log(clientErrorLog(parsed.data));
    return { ok: true };
  };
}
