# 두 지점 지정·측정으로 폰과 트윈 맞추기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 트윈에서 거실 창틀 A와 반대편 벽 B를 지정·저장하고 실제 두 지점에 폰을 대어 기록하면, 거리 비교 후 폰 위치·방향·높이가 트윈에 동기화되게 한다.

**Architecture:** twin-home이 집별 기준점 정의와 현재 폰 AR 세션의 측정 상태를 관리한다. twin-studio 뷰어는 선택 모드에서 실제 표면 좌표를 반환하며, PC 대시보드가 이름·높이를 편집하고 localhost API로 저장한다. 폰은 동일 AR 공간에서 두 접촉점의 viewer pose 표본을 보내며, 서버가 접촉 오프셋과 높이를 반영한 강체 변환 후보를 계산하고 사용자의 적용 후 기존 eye/사진/focus 경로에 연결한다.

**Tech Stack:** 현재 Node.js ≥22, TypeScript, zod, ws, Vitest · 브라우저 ES 모듈/WebXR · 기존 three.js와 `node --test`. 새 npm 의존성 없음.

**Spec:** `docs/designs/phone-contact-calibration.md` — 먼저 읽는다. 앞선 외부 reviewer의 검토문은 작업공간 `outputs/phone-calibration-review.txt`에 있다.

## Global Constraints

- 거리 단위는 m. 평면 위치 `[x,y]`는 three.js `[x,h,y]`에 대응한다.
- 한 집에 저장된 기준점 쌍은 첫 버전에서 **한 쌍**이다.
- 저장 위치: `runtime/homes/<homeId>/phone-calibration.json`. 원본 floorplan·scene 파일을 덮어쓰지 않는다.
- 정의 저장과 AR 맞춤 적용을 분리한다. 새 AR 세션에 이전 변환을 재사용하지 않는다.
- 폰 서버에는 설정용 REST를 추가하지 않는다.
- 폰 측정치가 트윈과 다르다고 트윈의 축척·벽 위치를 자동으로 바꾸지 않는다.
- 이전 바닥 조준 방식은 별도 모드로 유지한다.
- 기기 오프셋 프로필이 근사라면 적용 후에도 **근사 맞춤**으로 표시한다.
- 기기 제어·승인 정책, 판단 엔진, 원본 집 생성 파이프라인은 변경 대상이 아니다.
- 실제 코드에 손대기 전 각 작업의 실패 테스트를 확인한다. 현재 문서는 계획이며 아래 체크박스는 아직 실행하지 않았다.

## 작업 시작 시 주의

2026-11-02 확인 시 twin-home의 `src/phone/{server,session}.ts`, `src/server/start.ts`, 폰 UI와 일부 테스트/문서에 기존 미커밋 변경이 있었다. twin-studio에도 별도 변경이 있다. 실행 때 `git status --short`와 관련 diff를 다시 읽고 그 변경을 보존한다. 저장소 전체 add/reset/checkout을 하지 않는다. 각 저장소 커밋은 해당 작업 파일만 명시한다.

## 파일 구조와 경계

모든 경로는 작업공간 `C:/Users/ABC/Desktop/소웨공` 기준이다. 아래 명령은 별도 표기가 없으면 `twin-home`에서 실행한다.

| 파일 | 책임 |
|---|---|
| 신규 `twin-home/src/phone/calibration.ts` | 정의·기기 프로필·관측·결과 타입과 zod 검사, geometryHash |
| 신규 `twin-home/src/phone/calibrationStore.ts` | 집별 원자적 저장, revision 충돌, 구조 불일치 상태·구독 |
| 신규 `twin-home/src/phone/contact.ts` | 표본→접촉점, 안정성 검사, 정렬 후보와 거리 계산 |
| 수정 `twin-home/src/phone/align.ts` | 기존 바닥 solver 유지, 기존 변환/회전 재사용 |
| 수정 `twin-home/src/phone/session.ts` | AR ID·epoch, 측정 후보/적용, 정의 변경과 초기화 |
| 수정 `twin-home/src/phone/server.ts` | 활성 폰 소켓 소유권·WS 프로토콜·정의 전송 |
| 수정 `twin-home/src/phone/packet.ts` | 사진 헤더의 촬영 당시 AR 공간·정의 revision 검사 |
| 수정 `twin-home/src/server/{app,start}.ts` | 설정 REST, store 연결, 상태 이벤트 |
| 신규 `twin-home/web/calibration.js` | PC 기준점 편집·거리 결과 UI와 viewer 통신 |
| 수정 `twin-home/web/{index.html,style.css,app.js}` | 패널 자리, 기능 초기화와 상태 이벤트 연결 |
| 신규 `twin-home/web/phone/contact-capture.js` | 예약·정지 표본·취소 순수 상태기계 |
| 수정 `twin-home/web/phone/{phone.js,index.html,phone.css}` | AR lifecycle, 예약·완료음, 결과 확인/적용 |
| 신규 `twin-studio/apartment/viewer/calibration.mjs` | 선택 메시지/표면 좌표 검사와 거리 표시 데이터 |
| 수정 `twin-studio/apartment/viewer/main.mjs` | 별도 선택 모드, raycast, A/B 표시, 메시지 브리지 |
| 수정 `twin-studio/apartment/viewer/live.mjs` | 보정 무효화 상태를 실제 눈 마커·focus 제거에 연결 |
| 신규/수정 두 저장소의 관련 테스트 | 아래 작업별로 명시 |

## 공통 인터페이스

`calibration.ts`에서 아래 이름을 내보낸다. 브라우저 모듈은 같은 필드의 JSDoc을 쓰며 서버 구현을 브라우저로 번들하지 않는다.

```ts
import type { Alignment, Plan2, Quat, Vec3 } from "./align.js";
export type TargetId = "a" | "b";
export interface CalibrationTarget {
  id: TargetId;
  label: string;
  source: { kind: "wall" | "window"; id: string };
  roomId: string;
  position: Plan2;
  heightM: number;
}
export interface CalibrationDefinition {
  version: 1;
  revision: number;
  homeId: string;
  geometryHash: string;
  label: string;
  targets: [CalibrationTarget, CalibrationTarget];
  updatedAt: string;
}
export type CalibrationInput = Pick<CalibrationDefinition, "label" | "targets">;
export interface CalibrationSnapshot {
  revision: number;
  definition: CalibrationDefinition | null;
  stale: boolean;
}
export interface ContactProfile {
  id: string;
  label: string;
  offsetM: Vec3;
  accuracy: "verified" | "approximate";
  orientation: "portrait" | "landscape-left" | "landscape-right";
}
export interface PoseSample {
  frameTimeMs: number;
  position: Vec3;
  orientation: Quat;
  tracking: "ok" | "limited";
}
export interface ContactObservation {
  id: TargetId;
  point: Vec3;
  sampleCount: number;
  spreadM: number;
  angleSpreadDeg: number;
}
export interface ContactCandidate {
  id: string;
  definitionRevision: number;
  profileId: string;
  accuracy: "verified" | "approximate";
  alignment: Alignment;
  twinHorizontalM: number;
  measuredHorizontalM: number;
  twinStraightM: number;
  measuredStraightM: number;
  mismatchM: number;
  floorMismatchM: number;
  acceptable: boolean;
  reasons: string[];
}
```

WS 추가 계약: 접촉 모드의 모든 메시지에 `arSessionId`와 `spaceEpoch`가 필수다.

```ts
type SpaceKey = { arSessionId: string; spaceEpoch: number };
type ContactMessage =
  | ({ type: "ar_hello"; mode: "contact" | "floor"; takeover: boolean } & SpaceKey)
  | ({ type: "contact_record"; recordId: string; definitionRevision: number; profileId: string;
       id: TargetId; samples: PoseSample[] } & SpaceKey)
  | ({ type: "contact_apply"; candidateId: string } & SpaceKey)
  | ({ type: "contact_retry"; id: TargetId } & SpaceKey)
  | ({ type: "ar_end" } & SpaceKey);
// 기존 pose 메시지에도 SpaceKey와 단조 증가하는 frameTimeMs를 추가한다.
// profile과 정의는 calibration_definition에서 읽는다.
```

서버 기록 응답은 `{type:"contact_recorded", recordId, arSessionId, spaceEpoch, definitionRevision, id, ok, error?}`로 명시한다. 성공 응답 뒤 갱신된 contact_status도 보낸다. 서버가 모르는 공간/정의의 record도 입력의 상관 ID를 넣은 실패 응답을 주되 상태는 바꾸지 않는다. 폰이 기록 예약 중인지는 로컬 capture 상태로만 관리하며 서버 phase에 recording을 추가하지 않는다.

구현 주석·UI는 기존에 맞춰 한국어로 통일한다. 이 절의 프로토콜 변경은 `docs/plan.md`에도 반영한다.

## Task 1: 기준점 정의·검사·저장

**Files:** 신규 `src/phone/calibration.ts`, `src/phone/calibrationStore.ts`, `tests/helpers/calibration.ts`, `tests/phone-calibration-store.test.ts`; 수정 `docs/plan.md`.

**Interfaces:**
- `geometryHash(plan: unknown): string`: rooms/walls/windows의 ID 정렬과 수치 좌표·floor_z만 해시한다.
- `loadContactProfiles(path?: string): ContactProfile[]`: 방향별 내장 근사 프로필과 지정 로컬 JSON의 실측 프로필을 읽는다. 누락 경로/잘못된 JSON/중복 ID/허용 범위를 벗어난 offset은 한국어 오류다.
- `parseCalibrationInput(raw: unknown, context: {rooms: Map<string,{label:string;floorM:number;ceilingM:number}>; sourceIds: Set<string>}): CalibrationInput`: 실패 시 한국어 오류를 던진다.
- `CalibrationStore({runtimeDir, homeId, geometryHash, context, now?})`.
- `snapshot(): CalibrationSnapshot`.
- `save(input: CalibrationInput, expectedRevision: number): CalibrationDefinition`, `reset(expectedRevision: number): void`, `subscribe(fn: () => void): () => void`.
- 서버가 homeId/geometryHash/revision/updatedAt을 만든다. 외부 입력값으로 저장 경로를 만들지 않는다.

- [ ] **Step 1: 공통 fixture와 실패 테스트를 쓴다.**

```ts
// tests/helpers/calibration.ts
import type { CalibrationDefinition, ContactProfile, PoseSample } from "../../src/phone/calibration.js";
export const PROFILE: ContactProfile = {
  id: "test-phone", label: "테스트 폰", offsetM: [0, 0, 0],
  accuracy: "verified", orientation: "landscape-left",
};
export function definition(): CalibrationDefinition {
  return {
    version: 1, revision: 1, homeId: "oneroom", geometryHash: "a".repeat(64),
    label: "거실 창문 ↔ 반대편 벽", updatedAt: "2026-11-02T00:00:00.000Z",
    targets: [
      { id: "a", label: "창틀 표시", source: { kind: "window", id: "w1" }, roomId: "room", position: [0, 0], heightM: 1.2 },
      { id: "b", label: "반대편 표시", source: { kind: "wall", id: "wall2" }, roomId: "room", position: [4, 0], heightM: 1.2 },
    ],
  };
}
export function samples(position: [number, number, number]): PoseSample[] {
  return Array.from({ length: 61 }, (_, i) => ({
    frameTimeMs: i * (1000 / 60), position: [...position],
    orientation: [0, 0, 0, 1], tracking: "ok",
  }));
}
```

테스트에서는 `mkdtempSync`와 `afterEach`로 임시 저장소를 관리한다. fixture의 0 오프셋은 인공 좌표 테스트 전용이며 실제 기기 프로필의 검증을 대신하지 않는다.

```ts
it("서버 재시작 뒤 정의만 남고 revision 충돌은 거절한다", () => {
  const store = new CalibrationStore(options);
  const { label, targets } = definition();
  const saved = store.save({ label, targets }, 0);
  expect(new CalibrationStore(options).snapshot().definition).toEqual(saved);
  expect(() => store.save({ label, targets }, 0)).toThrow(/다른 화면|revision/);
});
```

위 `options`는 각 테스트의 임시 폴더와 fixture home/hash, `rooms=new Map([["room",{label:"방",floorM:0,ceilingM:3}]])`, `sourceIds=new Set(["window:w1","wall:wall2"])`으로 구성한다. 추가 사례: 같은 A/B ID, NaN/Infinity, 짧은 기준선, 없는 방/벽, 해당 방 바닥 아래·천장 초과 높이, 잘못된 JSON, 다른 home/hash, 저장 실패 시 기존 파일 유지, reset/revision 충돌과 재시작 후 tombstone 유지. 음수 바닥(-0.1m)의 방에서 heightM=-0.05m는 허용하고 -0.11m는 거절하는 fixture도 넣는다.

- [ ] **Step 2: 실패를 확인한다.** `npm.cmd test -- tests/phone-calibration-store.test.ts` → 신규 모듈 부재/미구현 동작으로 FAIL.
- [ ] **Step 3: 스키마와 store를 구현한다.** 이름 1~80자, 좌표 절댓값 ≤1000m, 선택한 방의 `floorM ≤ heightM ≤ ceilingM`, A/B 수평 간격 ≥0.5m를 검사한다. heightM 자체에 0 이상 제약을 두지 않는다. `version:1`, 유한수, 정확히 a/b 한 개씩, 알려진 source/room만 받는다. 저장은 동일 폴더 임시파일→rename이며 저장 성공 뒤 메모리/구독을 갱신한다.

```ts
// calibrationStore.ts의 파일 저장 핵심. envelope는 definition|null과 revision을 보관한다.
const tmp = `${this.path}.${process.pid}.tmp`;
mkdirSync(dirname(this.path), { recursive: true });
try {
  writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n", { encoding: "utf8", flag: "w" });
  renameSync(tmp, this.path);
} finally {
  if (existsSync(tmp)) unlinkSync(tmp);
}
```

reset은 definition=null인 envelope를 새 revision으로 저장한다. 이전 revision이 다시 유효해지는 ABA 충돌을 방지한다. 손상 파일은 자동 삭제/재작성하지 않고 설정 오류와 복구 액션을 노출한다.

내장 프로필 ID는 `approx-portrait`, `approx-landscape-left`, `approx-landscape-right`이고 각각 offsetM=[0,0,0], accuracy=approximate다. 실제 오프셋이 없다는 명시적 근사이며 기기 위치가 물리 접촉점과 같다고 주장하지 않는다. 외부 JSON은 `ContactProfile[]`이며 offset 각 축은 유한수·절댓값 1m 이하, id/label은 비어 있지 않아야 한다. 별도 사용자가 검증하지 않은 입력을 UI에서 verified로 자동 승격하지 않는다. 개발자 상세 오프셋 변경은 새 프로필 ID를 만들어 외부 파일에 기록하고 재시작하는 방식으로 제한한다. 런타임 임의 프로필 업로드 API를 만들지 않는다. 위 로더·오류·내장 근사 상태도 store 테스트 파일에서 검사한다.

접촉 기준은 선택 화면 방향에서 폰 전면 테두리의 상단 오른쪽 모서리다. offsetM은 viewer의 +X 오른쪽, +Y 위, -Z 시선 기준에서 이 부위까지의 벡터다. 프로필 문서와 폰의 그림에 같은 부위를 표시한다. 기종/케이스/화면 방향별 실측 전에는 accuracy=verified로 등록하지 않는다.
- [ ] **Step 4: 위 테스트와 `npm.cmd run typecheck`를 통과시킨다.** 구조 해시는 가구 이동 시 같고 벽/창/단차 변경 시 다른지 확인한다.
- [ ] **Step 5: 변경 파일만 검토하고 커밋한다.** `feat: persist home phone calibration targets`.

## Task 2: 접촉점 계산·측정 품질·정렬 후보

**Files:** 신규 `src/phone/contact.ts`, `tests/phone-contact.test.ts`; 기존 `src/phone/align.ts` 함수 재사용.

**Interfaces:**
- `observeContact(id: TargetId, samples: PoseSample[], profile: ContactProfile): ContactObservation`.
- `solveContactCalibration(definition, a: ContactObservation, b: ContactObservation, profile, maxMismatchM=0.3): ContactCandidate`. ID는 호출 시 새 UUID로 만든다.
- 관측 실패는 throw, 정렬 품질 실패는 `acceptable:false`와 reasons를 반환한다. 결과를 숨기지 않고 재기록을 유도한다.

- [ ] **Step 1: 높이와 회전 오프셋 회귀 테스트를 쓴다.**

```ts
it("벽에서 1.2m 높이로 기록해도 폰 높이를 0m로 만들지 않는다", () => {
  const d = definition();
  const a = observeContact("a", samples([0, 1.2, 0]), PROFILE);
  const b = observeContact("b", samples([4, 1.2, 0]), PROFILE);
  const candidate = solveContactCalibration(d, a, b, PROFILE);
  expect(candidate.acceptable).toBe(true);
  expect(candidate.measuredHorizontalM).toBeCloseTo(4);
  expect(candidate.alignment.floorY).toBeCloseTo(0);
  expect(toTwin([2, 1.5, 1], [0, 0, 0, 1], candidate.alignment).height_m).toBe(1.5);
});
```

추가 사례: 두 높이가 다른 점, 30° 회전+이동된 AR, 반대 벽에서 돌아선 폰과 비영 오프셋, q/-q 동치, 단위가 아닌/영 quaternion, tracking limited, 표본 시간 역전·중복·150ms 초과 공백, 15개 미만, 1초 미만, 움직임/회전 초과, 수평 기준선 0.5m 미만, 거리/바닥 원점 불일치, 근사 프로필 품질 전달. 거리 차이가 작아도 동일한 방향의 위치 오류를 검출하지 못한다는 한계도 테스트 이름/문서로 남긴다.
- [ ] **Step 2: `npm.cmd test -- tests/phone-contact.test.ts`로 FAIL을 확인한다.**
- [ ] **Step 3: 각 표본을 접촉점으로 변환하고 강체 정렬을 구현한다.** 검사 후 quaternion을 정규화하고, `abs(dot(q0,qi))`로 각도 편차를 구한다. 표본 수 상한은 120, 시간 span은 1~2초로 제한한다.

```ts
const points = samples.map((s) => {
  const r = rotate3(normalizeQuaternion(s.orientation), profile.offsetM);
  return s.position.map((v, i) => v + r[i]!) as Vec3;
});
// meanVec3(points)로 contact point를 얻는다. 위치/회전 퍼짐도 같은 표본으로 검사한다.
const floorA = a.point[1] - definition.targets[0].heightM;
const floorB = b.point[1] - definition.targets[1].heightM;
const base = solveAlignment(
  { ar: [a.point[0], 0, a.point[2]], plan: definition.targets[0].position },
  { ar: [b.point[0], 0, b.point[2]], plan: definition.targets[1].position },
);
const rb = rotate2(base.theta, [b.point[0], b.point[2]]);
const alignment = {
  ...base,
  tx: (base.tx + definition.targets[1].position[0] - rb[0]) / 2,
  ty: (base.ty + definition.targets[1].position[1] - rb[1]) / 2,
  floorY: (floorA + floorB) / 2,
};
```

`normalizeQuaternion(q)`와 `meanVec3(points)`는 같은 파일의 내부 함수로 정의한다. 후보 거리 4종과 floorMismatch를 코드에 명시적으로 계산하며 축척을 바꾸는 변수를 추가하지 않는다.
- [ ] **Step 4: 신규 테스트와 기존 `tests/phone-align.test.ts`, `npm.cmd run typecheck`를 통과시킨다.**
- [ ] **Step 5: 변경 파일을 검토하고 커밋한다.** `feat: solve contact calibration with known target heights`.

## Task 3: AR 세션·후보 적용·폰 소켓 소유권

**Files:** 수정 `src/phone/{session,server,packet}.ts`, `tests/phone-session.test.ts`, `tests/phone-server.test.ts`, `tests/phone-packet.test.ts`, `tests/focus.test.ts`; 신규 `tests/phone-contact-session.test.ts`.

**Interfaces:**
- `PhoneSessionOptions`에 `calibration?: CalibrationSnapshot`, `profiles?: ContactProfile[]` 추가.
- `session.replaceCalibration(snapshot: CalibrationSnapshot): void` → revision·stale·definition을 함께 갱신하고 후보·관측·정렬·last 초기화.
- `session.invalidate(reason: string): void`, `session.calibrationStatus(): ContactStatus` 추가.
- `ContactStatus = {type:"contact_status"; definitionRevision:number; mode:"contact"|"floor"|null; aligned:boolean; phase:"unconfigured"|"ready"|"review"|"aligned"|"invalid"; recorded:TargetId[]; candidate:ContactCandidate|null; reason?:string}`. aligned는 모드와 관계없이 현재 실제 적용 변환의 유효 여부다. floor의 바닥점 보정 성공 시에도 aligned=true, phase=aligned가 된다.
- `PhoneServer.replaceCalibration(snapshot: CalibrationSnapshot)`, `PhoneServer.calibrationStatus`, `PhoneServerOptions.calibration`, `PhoneServerOptions.profiles`, `PhoneServerOptions.onCalibrationStatus` 연결.
- `PhoneStatus` 기존 필드는 바닥 모드 호환용으로 보존하고 접촉 상태는 별도 메시지로 보낸다.

- [ ] **Step 1: 같은 공간 식별자와 적용 대기를 실패 테스트로 고정한다.**

```ts
it("두 기록 후 review이고 명시적 적용 뒤에만 aligned가 된다", () => {
  const s = new PhoneSession(legacyTargets, { calibration: { definition: definition(), revision: 1, stale: false }, profiles: [PROFILE] });
  s.handle({ type: "ar_hello", arSessionId: "s1", spaceEpoch: 0, mode: "contact", takeover: false });
  for (const [id, p] of [["a", [0, 1.2, 0]], ["b", [4, 1.2, 0]]] as const) {
    s.handle({ type: "contact_record", recordId: `record-${id}`, arSessionId: "s1", spaceEpoch: 0,
      definitionRevision: 1, profileId: PROFILE.id, id, samples: samples([...p]) });
  }
  expect(s.aligned).toBe(false);
  const candidate = s.calibrationStatus().candidate!;
  s.handle({ type: "contact_apply", arSessionId: "s1", spaceEpoch: 0, candidateId: candidate.id });
  expect(s.aligned).toBe(true);
});
```

`legacyTargets`는 기존 테스트와 동일한 정확히 두 `AnchorTarget`를 fixture 정의의 position에서 만든다. 새 테스트에서 import와 fixture를 명시한다. 추가 검증: 서로 다른 세션/epoch 기록 결합 금지, revision 변경, retry로 후보/기존 alignment 제거, 부적합 후보 apply 거부, 이전 candidate ID 재사용 거부, end/reset, 새 hello, 근사 품질, 두 번째 폰 takeover 거부/명시 허용, 오래된 소켓·binary photo 차단, 같은 WS 재연결 보존과 서버 재시작 초기화.
- [ ] **Step 2: `npm.cmd test -- tests/phone-contact-session.test.ts tests/phone-server.test.ts` → 해당 신규 시나리오 FAIL 확인.**
- [ ] **Step 3: 프로토콜 검사와 상태 전이를 구현한다.**

```ts
// contact_record 처리 순서. 실패한 입력은 기존 관측을 부분 갱신하지 않는다.
this.requireCurrentSpace(msg);
this.requireDefinitionRevision(msg.definitionRevision);
const profile = this.requireProfile(msg.profileId);
const observation = observeContact(msg.id, msg.samples, profile);
this.recordContact(observation, profile);
// recordContact는 첫 표본의 profileId를 고정하고 A/B가 모두 있을 때 후보를 만든다.
// requireCurrentSpace/requireDefinitionRevision/requireProfile/recordContact는 PhoneSession의 private 메서드다.
```

`contact_apply`는 현재 revision/profile/space의 최신 acceptable 후보 ID만 허용한다. 새 AR hello 시 기존 상태를 지우고, 동일 ID+epoch의 재접속만 유지한다. **현재 활성 소켓이 같은 arSessionId와 정확히 epoch+1을 보내면 자체 reset으로 허용하고 기록·맞춤을 지운다.** 동일 epoch hello는 멱등이며 과거 epoch와 다른 소켓의 epoch 증가는 거절한다. 같은 활성 소켓의 새 AR ID·epoch=0도 자체 새 세션으로 허용하되 종료된 ID의 재진입을 거절한다. 이 분기는 다른 공간의 busy/takeover 판정보다 먼저 실행하고 Task6 reset listener와 함께 테스트한다. 기존 floor 모드의 anchor도 hello가 확인된 활성 소켓에서만 받도록 실제 폰과 기존 WS 테스트를 함께 갱신한다. pose 누락 ID를 접촉 모드에서 허용하지 않는다.

PhoneSession의 legacy targets는 0개 또는 2개를 허용한다. 0개일 때 contact 정의/설정은 동작하되 floor 모드 hello와 anchor 기록만 한국어 오류로 거절한다. 1개는 구성 오류다. 기존 생성자의 “항상 두 개” 테스트는 이 새 계약으로 갱신한다.

서버는 `activeSocket`과 해당 공간 key를 추적한다. 같은 key로 재연결하면 이전 소켓의 pose/사진 처리를 차단한다. 다른 key의 hello는 busy로 응답하고, `takeover:true`일 때만 상태를 비우고 교체한다. 알 수 없는 key의 종료 메시지가 활성 세션을 지우면 안 된다. 사진 바이너리는 소유 소켓의 현재 공간에서만 `session.eyeFor`를 사용한다. `FrameHeader`와 HeaderSchema에 `arSessionId`, `spaceEpoch`, `definitionRevision`을 추가해 활성 세션/정의와 대조한다. 접촉 모드에서는 모두 필수다. 같은 소켓의 새 epoch hello 뒤에 도착한 이전 epoch 사진도 거절하는 테스트를 넣는다. 표준 frame도 공간이 다르면 버려 오래된 카메라 화면의 역전을 막는다.

상태 변화마다 `onCalibrationStatus`를 보내 대시보드가 오래된 마커를 회색 처리하도록 한다. 원래 사진·focus·here 동작은 적용된 alignment를 계속 사용한다.
- [ ] **Step 4: 위 테스트, `tests/phone-session.test.ts`, `tests/focus.test.ts`, `npm.cmd run typecheck`를 통과시킨다.**
- [ ] **Step 5: 해당 파일만 커밋한다.** `feat: scope phone calibration to an active AR space`.

## Task 4: 설정 REST·서버 시작·상태 방송

**Files:** 수정 `src/server/{app,start}.ts`, `tests/phone-start.test.ts`; 신규 `tests/phone-calibration-api.test.ts`.

**Interfaces:**
- `AppOptions.calibration?: CalibrationStore`.
- GET `{ok:true, revision, definition, stale, rooms:[{id,label,floorM,ceilingM}], runtime:ContactStatus|null}`. rooms는 store.context.rooms에서 생성하며 기존 `/api/rooms` 응답을 확장했다고 가정하지 않는다.
- POST body `{expectedRevision, label, targets}`, 결과 `{ok:true, revision, definition}`.
- POST reset body `{expectedRevision}`, 결과 `{ok:true, revision, definition:null}`.
- `AppOptions.phoneCalibrationStatus?: () => ContactStatus|null`는 시작 순서의 순환 참조를 막는 callback이다.
- `start.ts`는 `loadContactProfiles(env.PHONE_CONTACT_PROFILES_FILE)` 결과를 `createPhoneServer({profiles})`로 넘기고, phone server가 이를 PhoneSession에 전달한다. WS의 `{type:"calibration_definition", revision, definition, stale, profiles}`는 최초 접속·hello ack·정의 변경 때 보낸다. `ContactStatus`의 후보는 profileId와 accuracy를 포함하므로 PC도 동일한 근사 여부를 표시한다.
- `/events` 초기 동기화 및 변경 시 `{type:"phone_calibration", revision, definition, stale, runtime}`.

- [ ] **Step 1: 기존 layout-server 패턴으로 임시 store+MemoryHub 앱을 만들고 실패 테스트를 쓴다.** 다음 테스트의 `startCalibrationApp()`은 새 파일 안에 정의하며 임시 폴더·fixture context·`makeHome()`·`fetchRetry()`·`openWebSocket()`을 사용하고 afterEach에서 닫는다.

```ts
it("저장 후 폰 정의를 바꾸고 이전 revision 저장을 거절한다", async () => {
  const { url } = await startCalibrationApp();
  const { label, targets } = definition();
  const request = () => fetchRetry(url + "/api/phone/calibration", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: 0, label, targets }),
  });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(409);
});
```

기타 사례: GET 초기/저장/재시작, JSON 오류 400, 미설정 기능 404, 다른 출처 POST 403, 폰 포트의 설정 REST 404, WS 초기상태/저장 후 정의 전송, stale hash는 적용 불가, PHONE_PORT 없이 기준점 편집 가능, 변경 시 session invalidate, 집별 경로 분리.

GET의 rooms에 방 label과 정확한 floorM/ceilingM이 포함되는지 검사한다. 음수 바닥 방을 포함한 응답을 Task6 UI draft 테스트에서도 같은 fixture로 사용한다.
- [ ] **Step 2: `npm.cmd test -- tests/phone-calibration-api.test.ts tests/phone-start.test.ts`의 신규 FAIL 확인.**
- [ ] **Step 3: route를 구현하고 시작 시 store를 한 번 구성한다.**

```ts
route("POST", /^\/api\/phone\/calibration$/, async (req) => {
  const body = await readJson(req);
  const store = requireCalibration();
  const input = parseCalibrationInput(body, store.context);
  const definition = store.save(input, requireRevision(body.expectedRevision));
  return { ok: true, revision: definition.revision, definition };
});
```

`requireCalibration()`은 AppOptions 부재시 HttpError(404), `requireRevision(raw)`는 0 이상 정수만 반환한다. store의 충돌 오류는 HttpError(409)로 매핑한다. `store.context`는 readonly getter로 제공한다. 초기 실행은 `start.ts`의 선택 home과 scene plan으로 context/hash를 만들며 PHONE_PORT가 없어도 편집 API를 연다. 각 room의 floorM은 floor_z(기본0), ceilingM은 해당 scene의 천장 절대 높이다. 구독자는 저장 후 `phone?.replaceCalibration(store.snapshot())`과 앱 broadcast를 수행한다. 종료 시 store/phone/status 구독을 해제한다.

기존 `loadAnchorTargets` 실패는 기본 바닥 기준점만 비활성화한다. 접촉 정의가 없더라도 targets=[]로 폰 서버와 설정 화면을 열고, 새 사용자 정의를 저장할 수 있게 한다. scene 자체가 없어 트윈을 그릴 수 없으면 기존 build 안내를 보여준다. 기본 ar_anchors가 없고 scene만 있는 집의 접촉 설정·서버 시작 테스트를 추가한다.
- [ ] **Step 4: 위 테스트와 `npm.cmd run typecheck`를 통과시킨다.**
- [ ] **Step 5: 해당 파일을 커밋한다.** `feat: expose local phone calibration settings`.

## Task 5: 트윈 표면 A·B 선택과 표시

**Files:** 신규 `twin-studio/apartment/viewer/calibration.mjs`, `apartment/viewer/test/calibration.test.mjs`; 수정 `apartment/viewer/main.mjs`, `apartment/viewer/live.mjs`, `apartment/viewer/test/live.test.mjs`.

**Interfaces:**
- 부모→뷰어 `{type:"calibration_pick", requestId, slot:"a"|"b", roomId}` / `{type:"calibration_cancel"}` / `{type:"calibration_markers", targets}`.
- 뷰어→부모 `{type:"calibration_picked", requestId, slot, point:[x,h,y], source:{kind,id}, roomId}` 또는 `{type:"calibration_pick_error", requestId, reason}`.
- 순수 모듈 exports: `validPickRequest(message): boolean`, `pickResult({requestId,slot,point,source,roomId}): object|null`, `markerDistance(targets): {horizontalM:number;straightM:number}|null`.
- `window.aptViewer.setCalibrationMarkers(targets)`는 표시를 갱신하고 데이터만 반환한다. 기존 edit/export 함수는 변경하지 않는다.
- `window.aptViewer.invalidateEye()`는 eyeState=null, eyeMarker.visible=false와 clearFocus()를 적용한다. `createLiveSync`에 `onCalibration` callback을 추가하고 phone_calibration을 전달한다. `startLive`는 runtime이 없거나 runtime.aligned=false일 때 invalidateEye를 호출한다. 접촉 여부와 관계없이 실제 변환의 aligned를 기준으로 하고 기존 floor 맞춤 성공 마커를 지우지 않는 회귀 테스트를 넣는다. 서버가 해당 상태를 최초 동기화해 새 iframe도 일관되게 시작한다.

- [ ] **Step 1: Node 테스트에서 좌표축·두 거리·유효하지 않은 클릭을 확인한다.**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { markerDistance, pickResult } from "../calibration.mjs";
test("서로 높이가 다른 점의 수평거리와 직선거리를 구분한다", () => {
  assert.deepEqual(markerDistance([
    { position: [0, 0], heightM: 1 },
    { position: [3, 0], heightM: 5 },
  ]), { horizontalM: 3, straightM: 5 });
  assert.equal(pickResult({ requestId: "r", slot: "a", point: [NaN, 0, 0], source: {kind:"wall",id:"w"}, roomId:"room" }), null);
});
```

- [ ] **Step 2: twin-studio에서 `node --test apartment/viewer/test/calibration.test.mjs` FAIL 확인.**
- [ ] **Step 3: 선택 모드와 브리지를 추가한다.** 일반 raycaster 클릭은 현재 `main.mjs:1131` 부근이다. 선택 모드일 때는 가전/TransformControls 처리 전에 별도 분기하고 return한다.

```js
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (validPickRequest(event.data)) beginCalibrationPick(event.data);
  else if (event.data?.type === "calibration_cancel") endCalibrationPick();
  else if (event.data?.type === "calibration_markers") setCalibrationMarkers(event.data.targets);
});
```

`beginCalibrationPick`는 현재 CCTV/벽 표시/선택 상태를 보관하고 CCTV를 종료, wall mode를 full로 바꾸며 TransformControls를 detach한다. `endCalibrationPick`는 원래 상태를 복구한다. 클릭 허용 root는 `collectWalls(...).node`와 plan.windows ID에 대응하는 window node다. `raycaster.intersectObjects(allowedRoots,true)`의 실제 point를 쓰되 visible/레이어/clip plane 밖인 결과를 건너뛴다. window node를 찾을 수 없으면 구체적으로 알리고 벽 면을 지정할 수 있게 한다. 카메라 드래그 >4px은 클릭으로 처리하지 않는다. 클릭된 표면의 x,z와 y를 보낸 뒤 일반 편집을 실행하지 않는다.

`setCalibrationMarkers`는 scene에 별도 Group을 두고 A/B 라벨·구·연결선을 그린다. 마커 자신은 raycast 대상이 아니다. material/geometry를 재사용·dispose하고 scene 모드 변경에도 새 content와 별개로 유지한다. Esc는 pick 취소를 우선하며 성공/취소 응답의 requestId를 유지한다.

선택에 앞서 PC 패널에서 roomId를 고른다. beginCalibrationPick은 가구·효과·천장 노드의 레이어/가시성을 보관 후 실제로 숨겨 가림벽을 몰래 선택하는 상황을 없앤다. 기존 clipping 상태도 기록·복원한다. 공용벽은 `collectWalls`의 faces와 선택 room polygon을 사용해 클릭 면 법선이 해당 방 내부를 향하는지 판정한다. 노드가 달라도 같은 공용벽 ID를 안정적으로 되찾고, room 대응이 없거나 모호하면 클릭 실패 사유를 반환한다. 바닥 폴리곤 경계 근처의 작은 수치오차만 5cm 범위로 허용하며 반대 방으로 자동 이동시키지 않는다. 창은 plan.windows의 room/wall 대응으로 검사한다.

live.test.mjs에는 `phone_calibration(runtime.phase=invalid)` 후 onCalibration 호출, 기존 eye 다음 무효화, 초기 상태 동기화를 추가한다. 브라우저 확인에서는 reset/takeover/정의 변경 뒤 실제 눈 마커와 focus 고리가 사라지는지 확인한다. 폰에도 같은 상태가 전달되며 focus-layer를 비운다.
- [ ] **Step 4: 신규 테스트와 `node --test apartment/viewer/test/*.test.mjs` 통과.** 실제 브라우저에서 벽 절단/창/가구 가림, Esc, CCTV 복구, 기존 가전 선택과 이동이 동작하는지 확인한다.
- [ ] **Step 5: twin-studio의 세 파일만 커밋한다.** `feat: pick phone calibration points in the twin viewer`.

## Task 6: PC 편집·폰 접촉 기록·결과 적용 UI

**Files:** 신규 `web/calibration.js`, `web/phone/contact-capture.js`, `tests/phone-contact-capture.test.ts`, `tests/calibration-ui.test.ts`; 수정 PC/폰 HTML·CSS·JS와 `tests/phone-server.test.ts` 정적 파일 확인.

**Interfaces:**
- `initCalibration({root, frame, api, onChanged})` → `{handleStatus(message), destroy()}`. root는 패널 DOM, frame은 twin iframe, api는 현재 app.js의 JSON 요청 함수를 전달한다.
- `createContactCapture({countdownMs=3000, stableMs=1000, timeoutMs=8000})` → `{arm(id,now), frame(sample), cancel(reason), state()}`. 완료 반환값 `{kind:"captured",id,samples}`; 실패 `{kind:"failed",reason}`; 진행 중 null. DOM/소리/WS는 이 모듈에 넣지 않는다.
- `createCalibrationDraft({definition,revision})` → `{setTarget(id,target), input(), dirty(), revision}`를 web/calibration.js에서 export하여 UI 상태를 DOM 없이 검사한다.

- [ ] **Step 1: 타이머 없이 입력 시각을 주입하는 실패 테스트를 쓴다.**

```ts
it("예약 전에 받은 표본을 기록하지 않고 취소 뒤 완료하지 않는다", () => {
  const c = createContactCapture({ countdownMs: 3000, stableMs: 1000, timeoutMs: 8000 });
  c.arm("a", 0);
  for (const s of samples([0, 1.2, 0])) expect(c.frame(s)).toBeNull();
  c.cancel("추적 중단");
  expect(c.state().phase).toBe("cancelled");
  expect(c.frame({ ...samples([0, 1.2, 0])[0], frameTimeMs: 4500 })).toBeNull();
});
```

추가 사례: 3초 뒤의 정상 1초 구간으로 1회만 완료, 위치/회전 불안정 시 구간 재시작, limited/숨김/WS 단절/화면 회전/정의 변경 시 취소, 8초 timeout, 오래된 프레임/쿼터니언 NaN, 취소 후 새 arm. UI draft는 저장 전 취소 시 기존값 보존, A/B 이름/높이 수정, revision conflict 때 사용자 입력 보존, 오류 후 버튼 복구를 검사한다.
- [ ] **Step 2: `npm.cmd test -- tests/phone-contact-capture.test.ts tests/calibration-ui.test.ts` FAIL 확인.**
- [ ] **Step 3: PC 패널을 구현한다.**

```html
<button type="button" id="calibration-open" aria-controls="calibration-panel">폰 위치 맞추기</button>
<section id="calibration-panel" aria-label="폰 위치 맞추기" hidden>
  <h2>두 기준점 지정</h2>
  <div data-target="a"></div><div data-target="b"></div>
  <output id="calibration-distance" aria-live="polite"></output>
  <button type="button" data-action="save">기준점 저장</button>
  <button type="button" data-action="cancel">취소</button>
  <button type="button" data-action="reset">기준점 삭제</button>
</section>
```

각 target에는 이름/방/높이 입력과 “트윈에서 A 지정” 버튼, 좌표 미세 조정 필드를 둔다. `initCalibration`은 첫 GET의 rooms를 roomId별 Map으로 보관한다. 높이 입력은 “이 방 바닥에서 높이(m)”로 표시하며, viewer의 절대 y에서 rooms[roomId].floorM을 빼 보여주고 저장 때 더한다. ceilingM도 이 GET에서 읽어 입력 범위를 안내한다. 방을 바꿀 때 이 변환을 다시 하며 표시값과 절대값을 섞지 않는다. HTML 문자열에 label을 삽입하지 않고 textContent를 쓴다. 선택 requestId와 `event.source===frame.contentWindow`·동일 origin을 검증한다. 같은 home/revision의 응답만 draft에 반영한다. iframe load 시 마커를 재전송하고 진행 pick은 취소한다. API 충돌이면 작성 중 입력을 보존하고 최신 저장을 불러와 비교하게 한다. geometry stale 상태에서는 재확인 저장을 요구한다.

PC 패널은 저장 정의의 A/B, 트윈 수평거리/직선거리를 표시한다. 접촉 결과가 오면 폰 측정 수평거리/직선거리·차이·높이 차이·근사 여부를 추가한다. “측정 성공”과 “맞춤 적용됨”을 구분한다.
- [ ] **Step 4: 폰 UI·AR lifecycle을 구현한다.**

```js
// 실제 AR 세션을 만들 때마다 실행한다.
let currentSpace = { arSessionId: crypto.randomUUID(), spaceEpoch: 0 };
space.addEventListener("reset", () => {
  capture.cancel("좌표 기준이 바뀌었어요");
  currentSpace = { ...currentSpace, spaceEpoch: currentSpace.spaceEpoch + 1 };
  send({ type: "ar_hello", ...currentSpace, mode: calibrationMode, takeover: false });
});
session.addEventListener("end", () => {
  capture.cancel("AR 종료");
  send({ type: "ar_end", ...currentSpace });
});
```

`capture=createContactCapture(...)`, `calibrationMode`는 시작 시 고른 contact/floor다. 정상 `getViewerPose(space)`에서 currentSpace+frameTimeMs를 pose에 붙이고 capture에도 전달한다. 완료한 samples는 새 recordId와 함께 `contact_record`로 보낸다. 현재 공간/revision/target/recordId와 모두 일치하는 `contact_recorded(ok=true)`를 받은 뒤에만 성공음을 낸다. 실패/늦은 ack는 성공 처리하지 않으며 버튼을 재활성화한다. 음향은 AR 시작 사용자 제스처에서 AudioContext를 준비한다. 진동 미지원/음향 불가면 보조 표시를 제공한다. 자동 전체 화면·가로 고정을 다시 추가하지 않는다. contact 모드는 시작 방향에 맞는 프로필을 선택하고 기록 도중 화면 방향이 바뀌면 취소한다.

contact 모드는 requiredFeatures를 `local, dom-overlay`로 하고 `hit-test,camera-access`는 optional로 요청한다. hit-test 활성화가 확인된 경우에만 source를 요청하고 reticle/“여기”를 켠다. floor 모드는 기존 required hit-test를 유지한다. 카메라 영상 부재는 보정 실패와 구분한다.

정의·높이·실물 접촉 부위 안내는 AR 시작 전에 보여준다. 미검증 기기는 명시적인 “근사 프로필 사용” 선택 후 진행한다. 개발자 상세의 오프셋은 읽기 전용이며 수정은 Task1 로컬 프로필 파일 절차를 따른다. profile ID가 바뀌면 A/B를 모두 재기록한다. AR 실행 중 무검증 기기를 자동 verified로 바꾸지 않는다. WS 재연결은 현재 AR이 살아 있을 때만 같은 공간으로 hello하며 종료 뒤 자동 재개하지 않는다. 다른 폰 busy 상태에는 “이 폰으로 연결”만 명시적으로 제공한다.

현재 `phone.js`의 `sendFrame`은 JPEG 인코딩 Promise가 끝난 뒤 전송한다. 새 헤더는 `grabber.grab` 시점의 공간 key/revision을 복사해 고정한다. 완료 callback은 현재 공간과 비교해 오래된 결과를 버리며 서버도 같은 검사를 한다. `web/phone/capture.js`의 `framePacket`은 전달받은 헤더를 그대로 쓰고 완료 시점의 전역 공간을 다시 읽지 않는다. 테스트에 사진 인코딩 중 reset/정의 변경 후 완료되는 사례를 추가한다.
- [ ] **Step 5: 테스트와 `npm.cmd run typecheck`를 통과시키고 브라우저에서 PC↔뷰어 연결 및 폰 모의 lifecycle을 확인한다.** 기존 phone-project/pipeline/packet 테스트도 실행한다.
- [ ] **Step 6: 해당 파일만 커밋한다.** `feat: guide target setup and timed phone contact capture`.

## Task 7: 전체 흐름·기존 기능 회귀·실폰 검증

**Files:** 신규 `tests/phone-contact-e2e.test.ts`, `docs/experiments/2026-11-02-phone-contact-calibration.md`; 수정 `README.md`, `docs/{plan,reference}.md`.

- [ ] **Step 1: MemoryHub 서버를 임시 runtime으로 시작하는 e2e 실패 테스트를 먼저 쓴다.** `startServer({env:{HUB:"memory",AGENT_PROVIDER:"mock",FOCUS:"1",PORT:"0",PHONE_PORT:"0",PHONE_HOST:"127.0.0.1",RUNTIME_DIR:temp},log:()=>{}})` 패턴을 쓴다. 실제 선택한 집의 room/source IDs를 사용하고 fixture home/hash를 운영 입력에 그대로 복사하지 않는다.

검증 순서: REST로 A/B 저장 → phone hello → A/B 표본 전송 → review 수신 → apply → pose 전송 → dashboard eye 수신 → height/position 검증 → photo/here/focus → WS 재연결 유지 → 새 AR 세션 초기화 → 서버 재시작 후 정의만 복원. 별도 테스트로 저장 후 revision 변경 및 두 폰의 stale socket binary 사진 처리를 검사한다.

focus 검증은 `POST /api/agent/chat`에 `{sessionId:"calibration-test",message:"TV 켜줘"}`를 보내 실제 mock action을 발생시키고, 반환된 TV ID가 폰 focus.targets 및 대시보드 focus에 포함되는지 확인한다. 정렬 무효화 뒤 폰 focus-layer와 viewer focus가 비워지는 것까지 검사한다. 선택 집에 TV가 없는 fixture는 이 테스트용으로 사용하지 않는다.
- [ ] **Step 2: `npm.cmd test -- tests/phone-contact-e2e.test.ts`로 통합의 빠진 연결을 확인한다.** 앞 작업이 이미 모두 연결했다면 통과 사실을 기록하고 실패를 만들려고 기능을 제거하지 않는다. 실제 실패가 있으면 systematic-debugging으로 원인을 좁힌다.
- [ ] **Step 3: 필요한 연결 수정 후 회귀 명령을 실행한다.**

```powershell
# twin-home
npm.cmd test -- tests/phone-calibration-store.test.ts tests/phone-contact.test.ts tests/phone-contact-session.test.ts tests/phone-calibration-api.test.ts tests/phone-contact-capture.test.ts tests/calibration-ui.test.ts tests/phone-contact-e2e.test.ts tests/phone-align.test.ts tests/phone-session.test.ts tests/phone-server.test.ts tests/phone-start.test.ts tests/phone-project.test.ts tests/phone-feed.test.ts tests/focus.test.ts tests/layout-server.test.ts
npm.cmd run typecheck
npm.cmd test
# twin-studio
node --test apartment/viewer/test/*.test.mjs
```

전체 테스트의 기존 실패가 있으면 baseline과 변경 영향을 구분해 보고한다. 그 실패를 숨기거나 이 기능과 무관한 소스를 정리하지 않는다.
- [ ] **Step 4: 실제 폰 실험을 수행한다.** 실측 A/B와 독립 C, 폰 모델/케이스/브라우저/방/조명/접촉 부위/오프셋 profile ID를 적는다. A/B 기준선 2~4m, 각 보정 5회, C 수평·높이·방향 오차와 두 점 기록 소요시간을 기록한다. A→B→A 및 1~2분 후 재방문, WS만 끊기, AR 재시작, 추적 상실도 확인한다. 목표는 수평10cm/높이5cm/방향3°/30초이며 측정 전 보장하지 않는다. 실제 폰 접근이 없으면 이 단계는 미실행으로 남기고 기능의 실폰 검증 완료를 주장하지 않는다.
- [ ] **Step 5: 사용자 문서·검증 결과를 정리하고 변경 파일만 커밋한다.** 문서에 기준점 저장과 AR 변환 재사용의 차이, 높이/단차, 거리 종류, 근사 프로필, 재기록 조건, 실제 폰 결과를 넣는다. 검증으로 얻은 비자명한 교훈이 코드/테스트/문서에 설명되지 않을 때에만 ce-compound로 별도 기록한다.

## 계획 자체의 검토 기준

- [x] 사용자 요구 `지점 직접 지정 → 실제 측정 → 거리 비교 → 적용 → 저장한 지점 재사용`마다 담당 작업이 있다.
- [x] 각 작업의 함수·타입·메시지 이름이 공통 인터페이스와 맞는다.
- [x] 바닥 높이·기기 오프셋·좌표계 변경·정의 revision·사진/marker stale 처리가 빠지지 않는다.
- [x] 폰 실험 전의 허용값과 정확도 목표를 보장값으로 표현하지 않는다.
- [x] 구현하지 않은 단계는 완료로 표시하지 않는다.

## 계획 검토 기록

독립 reviewer가 설계와 계획을 두 차례 검토했다. 1차의 연결 계약 9개를 수정했고 2차에서 모두 반영됐음을 확인받았다. 2차 추가 지적인 PC 높이 메타데이터 누락은 GET rooms 계약과 Task4/6의 입력·fixture 연결로 보완했다. 자기검토에서는 비동기 JPEG의 촬영 공간 식별과 floor 모드의 마커 호환성을 추가했다. 실제 구현과 폰 실험은 수행하지 않았다.

## 구현 인계

이 계획은 사용자와 합의한 A/B 접촉 방식을 구체화한 것이다. 실행 승인을 받으면 기존 개발 워크플로우의 TDD → 검증 → 필요 시 학습 기록 순서로 진행한다. 실행 스킬이 설치되지 않았다면 없는 스킬을 호출했다고 주장하지 말고, 이 체크리스트와 설치된 TDD/verification 스킬을 적용해 같은 세션에서 진행한다.
