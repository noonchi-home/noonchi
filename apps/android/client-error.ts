import type { ClientErrorReport } from "../../src/contract/client-error";
import type { ConnectedHub } from "./connected-hub";

export const CLIENT_ERROR_PATH = "/api/mobile/client-error";
const MESSAGE_LIMIT = 1000;
const STACK_LIMIT = 4000;

const cut = (text: string | null | undefined, limit: number) => text ? text.slice(0, limit) : null;

/** Error는 "TypeError: …"처럼 이름까지. 글로 바꿀 수 없는 값(Object.create(null))도 던지지 않는다. */
function describe(error: unknown): string {
  try {
    return String(error);
  } catch {
    return "Error";
  }
}

/** 허브로 보낼 오류 보고. 스택·부품 줄은 앞 4,000자, 오류 글은 앞 1,000자까지. */
export function clientErrorReport(error: unknown, componentStack: string | null | undefined, appVersion: string, atMs: number): ClientErrorReport {
  return {
    message: cut(describe(error), MESSAGE_LIMIT) || "Error",
    stack: cut(error instanceof Error ? error.stack : null, STACK_LIMIT),
    component_stack: cut(componentStack, STACK_LIMIT),
    app_version: appVersion,
    at_ms: atMs,
  };
}

/** 허브에 보낸다. 허브 주소가 틀리거나 보내지 못해도 조용히 버린다(오류를 다시 내지 않는다). */
export async function reportClientError(connect: () => Pick<ConnectedHub, "write">, report: ClientErrorReport): Promise<void> {
  try {
    await connect().write(CLIENT_ERROR_PATH, report);
  } catch {
    // 보고는 덤이다: 실패해도 화면은 이미 「다시 시도」를 보여 주고 있다.
  }
}
