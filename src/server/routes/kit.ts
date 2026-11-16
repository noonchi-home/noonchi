// 나눈 API 경로 파일(routes/*)이 함께 쓰는 것: 경로 등록 도구(RouteKit), 오류(HttpError), 본문 읽기(readJson). 경로는 app.ts가 차례대로 등록시킨다(도메인 나누기 2.6).
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { Agent, Policy } from "../../agent/index.js";
import type { DeviceHub } from "../../contract/devices.js";
import type { AppOptions } from "../app.js";
import type { MatterInfoView } from "./devices.js";

const MAX_BODY = 1 << 20;

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export const KO_ERRORS = z.locales.ko().localeError;

function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "요청 본문은 JSON 객체여야 합니다.");
  return v as Record<string, unknown>;
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "요청 본문이 너무 큽니다(최대 1MB).");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return record(JSON.parse(text));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "요청 본문 JSON을 읽지 못했습니다.");
  }
}

export type Handler = (req: IncomingMessage, url: URL, params: string[]) => Promise<unknown>;

/** 경로 묶음이 받는 것: 등록 함수와 앱 설정·허브·에이전트·정책, 앱이 닫혔는지, 본문 집 확인, Matter 정보. */
export interface RouteKit {
  route: (method: string, pattern: RegExp, handler: Handler, status?: (body: unknown) => number) => void;
  opts: AppOptions;
  hub: DeviceHub;
  agent: Agent | undefined;
  policy: Policy;
  /** 앱이 닫혔는가(집을 바꾸는 중). */
  closed: () => boolean;
  /** 설정 화면이 보낸 집이 지금 집인가(아니면 HttpError). */
  sameHome: (body: Record<string, unknown>) => void;
  /** 허브가 MatterHub면 그 정보. */
  matterInfo: () => MatterInfoView | undefined;
}
