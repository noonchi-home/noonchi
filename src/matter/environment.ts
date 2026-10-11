// matter.js 실행 환경 도우미: 노드별 저장 폴더, 로그 수준, 문자열 길이 제한.

import { Environment, Filesystem, Logger, LogLevel, StorageService } from "@matter/main";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type MatterLogLevel = "debug" | "info" | "notice" | "warn" | "error" | "fatal";

const LEVELS: Record<MatterLogLevel, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  notice: LogLevel.NOTICE,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  fatal: LogLevel.FATAL,
};

/**
 * matter.js 로그 수준(전역). 인자가 없으면 MATTER_LOG_LEVEL 환경 변수, 그것도 없으면 error.
 * matter.js는 기본으로 INFO를 찍어 화면이 넘치므로 낮춘다.
 */
export function setMatterLogLevel(level?: MatterLogLevel): void {
  const fromEnv = process.env.MATTER_LOG_LEVEL?.toLowerCase() as MatterLogLevel | undefined;
  const chosen = level ?? (fromEnv && fromEnv in LEVELS ? fromEnv : "error");
  Logger.level = LEVELS[chosen];
}

/**
 * matter.js는 기본으로 SIGINT/SIGTERM을 잡아 자기 런타임(노드들)을 닫는다. 노드 수명은 MatterHub가 관리하고
 * 종료 신호는 앱(server/main.ts)이 처리하므로 끈다. MATTER_RUNTIME_SIGNALS를 주면 그 값을 따른다.
 */
export function releaseProcessSignals(): void {
  if (process.env.MATTER_RUNTIME_SIGNALS === undefined) Environment.default.vars.set("runtime.signals", false);
}

export type StorageDriver = "file" | "sqlite";

/**
 * matter.js 저장소 드라이버(전역, 노드를 만들기 전에 정한다).
 * 기본 sqlite: file 드라이버는 속성 하나가 파일 하나라 65개 기기 컨트롤러 캐시가 파일 3천 개가 넘고,
 * Windows에서 종료 때 캐시를 쓰는 데 10초 넘게 걸린다(sqlite는 파일 하나, 1초 미만).
 * Node 22의 node:sqlite는 실험 기능이라 처음 열 때 ExperimentalWarning이 한 줄 나온다.
 * MATTER_STORAGE_DRIVER 환경 변수가 있으면 matter.js가 이미 적용했으므로 건드리지 않는다.
 */
export function setStorageDriver(driver?: StorageDriver): void {
  const chosen = driver ?? (process.env.MATTER_STORAGE_DRIVER ? undefined : "sqlite");
  if (chosen) Environment.default.get(StorageService).configuredDriver = chosen;
}

/**
 * 저장 폴더가 dir인 matter.js 환경. 노드 저장소는 <dir>/<노드 id>에 생긴다.
 * 기본 환경(Environment.default)의 서비스(네트워크·mDNS·암호)는 그대로 물려받고 파일 시스템만 바꾼다.
 */
export function nodeEnvironment(name: string, dir: string): Environment {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const env = new Environment(name, Environment.default);
  // 기본 환경의 Node.js 파일 시스템 구현을 같은 클래스로 새로 만든다(@matter/nodejs를 직접 의존하지 않기 위해)
  const FilesystemImpl = Environment.default.get(Filesystem).constructor as new (path: string) => Filesystem;
  env.set(Filesystem, new FilesystemImpl(root));
  return env;
}

/** UTF-8 바이트 길이 제한(Matter 문자열 속성은 바이트 기준). 글자 중간에서 자르지 않는다. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch, "utf8") > maxBytes) break;
    out += ch;
  }
  return out;
}

/** matter.js endpoint id로 쓸 수 있는 문자열(영문·숫자·_·-). */
export function endpointId(deviceId: string): string {
  return deviceId.replace(/[^A-Za-z0-9_-]/g, "_");
}
