// Matter 허브 지연 로더: Matter 허브를 고를 때만 matter.js(src/devices/matter/matterHub.ts)를 읽는다. 서버를 띄울 때는 읽지 않는다(tests/start.test.ts).
// devices 입구는 이 로더만 내고 matterHub.ts는 내보내지 않는다.

/** matterHub.ts 모듈을 읽는다. 파일이 없으면 import 오류를 그대로 던진다(src/server/hubFactory.ts가 MemoryHub로 대신한다). */
export const loadMatterHub = () => import("./matterHub.js") as unknown as Promise<Record<string, unknown>>;
