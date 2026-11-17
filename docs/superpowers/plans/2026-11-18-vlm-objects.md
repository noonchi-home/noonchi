# 상태 동기화는 VLM으로만 (YOLO는 미니맵 표시용) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**쉬운 요약:**
1. 지금은 World State의 사람·물건 등장·자리·사라짐·자세·손에 듦을 YOLO가 0.1초마다 바꾸고, VLM은 그 감지에 사실만 단다. 그래서 YOLO가 컵을 못 잡으면 VLM이 컵을 봐도 컵이 없는 것이 된다(가로 유리컵·머그 실제 판).
2. 사용자 결정: 상태 동기화는 VLM으로만 한다. YOLO의 쓸모는 셋이다: 대시보드 미니맵 상자, 폰 위치 맞추기(가구 기준점), 쓰러짐 감지(빠른 자세).
   - 쓰러짐만 World State에 들어가는 예외 길 하나로 둔다. 다른 YOLO 감지는 World State로 들어가지 못하게 구조로 막는다.
3. VLM 장면 답이 사람·물건 목록(종류·상자·자세·하는 일·몸통·내용물)을 내고, World State는 그 목록만으로 바뀐다. 가까이 보기의 「찾은 것」도 VLM 답으로 채운다.
4. YOLO(0.1초)에서 VLM(2초 + 답 1.8초)으로 바뀌어 반응이 늦어진다. 구간별 숫자와 줄이는 법을 아래에 적는다.

**Goal:** 가로 영상 세 개(wide-glass·wide-tall·wide-mug)가 끝까지 통과한다. World State는 VLM 답으로만 바뀐다.

**Architecture:**
- 장면 VLM 답(`scene_observation`)에 `people`·`objects` 목록을 더한다.
  - 사람: 상자, 자세, 하는 일, 순간, 손에 든 물건.
  - 물건(가전 설비 포함): 종류, 상자, 면 값(자리·몸통·내용물·열림·쓰는 중·화면).
  - `observations`(감지 번호에 다는 사실)는 없앤다.
- World State는 VLM 상자 아랫변 가운데를 지금 YOLO와 같은 투영(`placePoint`)으로 트윈 자리로 바꾸고, VLM 사진 간격 기준의 확정·사라짐 규칙으로 넣는다.
- YOLO 감지는 관찰 흐름에서 대시보드 `seen`(미니맵)과 폰 위치 맞추기(`landmarks`)로만 간다.
- 관절은 쓰러짐 신호 하나로만 World State에 들어간다(`applyFall`). World State 입구 `applyDetections`·`applyPose`를 없애 구조로 막는다.

**Tech Stack:** Node 22 TypeScript, zod 4, Vitest, 가짜 VLM(`scripts/fake-openai.ts`). 실제 모델은 부르지 않는다(실제 판은 조정자가 돌린다).

**Spec:** 사용자 결정(2026-11-18):
- 「상태 동기화는 VLM으로만 써. YOLO는 그냥 미니맵 표시용」, 「트윈 성능(속도) 최우선」, 목표 「가로 영상 세 개가 끝까지 통과」.
- 이어서 정한 것: 「코치 모드에서 긴급 상황, 예를 들어 서 있다가 갑자기 쓰러지는 자세를 포착하면 보호자에게 전화하는 걸 만들어야 해. YOLO는 이거(위치 맞추기)랑 그거(쓰러짐)로 쓴다고 생각해」. 폰 위치 맞추기 기준점은 YOLO로 남긴다.
- 앞 결정의 「YOLO 약한 감지로 확정」, 「YOLO는 사람·자세·추적 담당」은 버린다(조정자 전달).

## 조사한 사실

**가로 유리컵 실제 판**(`demo-backup/wide-glass.base.timeline.md`, 기록 DB look 결과):
- YOLO가 13.2초에 컵을 한 번 잡았고, 영상 끝에 붙잡은 장면에서 다시 못 잡아 19.7초에 「사라짐」이 됐다.
- 찾기의 가까이 보기 두 번 모두 `found: []`이었다. 그런데 VLM 요약은 「A metallic/opaque cup sits on a surface in front of a curtain」·「a transparent, cup-like container…」였다.
- `found`는 YOLO 감지로만 채운다(`src/observe/pipeline.ts` `look`). 잘라 본 칸이 240×135로 작아 YOLO가 못 잡았다.

**가로 머그 실제 판**(`demo-backup/wide-mug.real3.timeline.md`):
- VLM은 「only the cup on the table is visible」·「A small cup sits on the table/stand near the center」라고 봤다.
- YOLO가 흰 머그를 못 잡아 컵이 생기지 않았고, PAM의 「컵 치우기」 4번이 모두 「대상 물건이 보이지 않아」로 막혔다.

**지금 VLM 호출:**
- 2초마다(`VLM_FRAME_MS`) 최근 5장, 답 약 1.8초, 입력 약 2,100토큰, 동시 4개(`VLM_MAX_INFLIGHT`). 숫자는 구현명세서 6.1.
- 실제 판 한 번 약 $0.00042(wide-mug real3: 27장 $0.0113).

**지금 확정·사라짐**(`src/world/confirm.ts`, `src/world/state/core.ts`):
- 사람·물건 등장 2초 이어 보임, 사라짐은 시야 안에서 사람 4초·물건 6초 못 봄. YOLO 프레임은 0.1초 간격.
- 확인 전 후보는 0.5초 못 보면 잊는다.

## YOLO가 World State를 바꾸는 곳과 정한 것

| # | 지금(YOLO 길) | 코드 | 정한 것 | 근거 |
|---|---|---|---|---|
| 1 | 물건 등장·자리·사라짐 | `objects.ts` `applyDetections`·`Confirmer` | **VLM으로**: `objects` 목록의 상자 → 자리, VLM 사진 기준 확정·사라짐(아래) | 사용자 결정. 실제 판 두 번 모두 VLM이 본 컵을 YOLO가 놓침 |
| 2 | 사람 등장·사라짐·수 | `objects.ts`·`people.ts` `locatePerson` | **VLM으로**: `people` 목록 | 같음 |
| 3 | 사람 자리·방 | `people.ts` `locatePerson`(상자 바닥 → 트윈) | **VLM으로**: 사람 상자 바닥 → 같은 투영 | 투영 길은 그대로 쓴다 |
| 4 | 사람 자세(관절) | `people.ts` `applyPose`, `pose.ts` | **VLM으로**: `posture`(지금도 VLM 값이 있음). 관절이 VLM 답을 덮는 규칙(`poseHolds`)은 쓰러짐 의심 동안 막는 부분만 남기고 삭제 | VLM이 이미 같은 값을 답한다 |
| 5 | 손에 듦(관절 손목 + 상자) | `people.ts` `heldIds`·`posedInHand` | **VLM으로**: 사람의 `holding`과 물건 자리 `in_hand` | 같음 |
| 6 | 들고 감 보호(`carried`: 관절 손 + 움직임) | `objects.ts` `track`·`carried` | **VLM으로 줄여서**: 사람이 사라질 때 마지막 VLM 답에서 손에 든 물건은 다음 VLM이 그 물건을 다른 자리에서 볼 때까지 손에 있음으로 둔다. 움직임 자취(`trail`)는 뺀다 | 0.1초 자취는 VLM 간격에서 뜻이 없다. 지키려던 것(들고 나간 컵이 식탁 컵으로 남음)은 VLM 손에 듦으로 지킨다 |
| 7 | 쓰러짐 의심(관절 기울기 3초) | `fall.ts`·`people.ts` | **YOLO 유지(예외 길 하나)**: 쓰러짐 신호(`FALL_*`, 중력 보정, 침대·소파 빼기)는 지금 그대로. 관찰 흐름이 가장 확실한 한 사람의 관절·상자로 `applyFall` 하나만 부른다(아래 「쓰러짐 예외 길」) | 사용자 결정: 긴급 상황은 빠른 자세로 잡는다. VLM 2초 간격이면 평균 4.8초로 늦어진다 |
| 8 | 마시기·따르기 사건(관절 + 마스크) | `sip.ts`, `contents.ts` `reopen` | **VLM으로**: 사람 `moment`(마심·따름, 지금 VLM 값)로 내용물을 다시 연다 | VLM이 여러 장 사이 순간을 이미 답한다 |
| 9 | 컵 크기(`size_m`, 위에서 보기 판정이 씀) | `objects.ts` `sizeOf` | **VLM으로**: VLM 상자를 픽셀로 바꿔 같은 `sizeOf` | 투영 길은 그대로 쓴다 |
| 10 | 가전 설비 보임·카메라로 본 가전 상태 | `devices.ts` `fixture`·`sight` | **VLM으로**: `objects`에 가전 설비 종류도 넣고 그 면 값(열림·쓰는 중·화면)으로 | 지금도 상태 값은 VLM이 답한다. 보임만 YOLO였다 |
| 11 | 가까이 보기 합치기(잘라 본 장의 YOLO) | `closer.ts` `applyCloser` | **VLM으로**: 잘라 본 사진의 VLM 답 `objects` 상자 → 원래 프레임 → 자리. `found`도 그것으로 | 유리컵 판 원인 |
| 12 | 위에서 보기 컵 확인(잘라 본 장의 YOLO로 「옮겨짐」 판정) | `pipeline.ts` `lookTop`·`topDropOf` | **VLM으로**: 위에서 본 VLM 답의 컵 상자(d1 칸 자리와 겹치나)로 | 같은 이유 |
| 13 | 빠른 프레임(VLM 프레임 사이)의 자리·보임 고치기 | `pipeline.ts` `analyze` 빠른 프레임 | **뺀다**: World State는 VLM 프레임에서만 바뀐다 | 사용자 결정 |
| 14 | YOLO 분석 없음 셈·변화(`yolo_missing`) | `world.ts` `applyMissing` | **World State에서 뺀다**: 관찰 흐름 상태(`/api/brain`)에만 남긴다 | World State 입력이 아니게 됨 |
| 15 | `frame_ms`(YOLO가 본 마지막 프레임) | `world.ts` `view` | **VLM으로**: VLM 답을 넣은 마지막 프레임의 촬영 시각 | 「사람 안 보임이 지금도 맞나」를 VLM 기준으로 |
| 16 | 사람 여럿(`crowdAt`) | `objects.ts` | **VLM으로**: `people` 목록 수 | — |
| 17 | 대시보드 미니맵 물체 모양(`seen`) | `pipeline.ts` `onSeen` | **YOLO 그대로** | 사용자 결정(YOLO는 미니맵용) |
| 18 | 폰 위치 맞추기 기준점(가구 상자, `onDetected` → `phone.landmarks`) | `src/phone/sync` | **YOLO 그대로**(사용자 결정) | World State 사실이 아니라 카메라 자세 맞추기다. VLM 간격(2초)으로는 맞추기 정확도가 떨어진다 |

### 쓰러짐 예외 길(YOLO → World State는 여기 하나)

- `WorldState.applyFall(at, signal: FallSignal | null)`
  - `FallSignal`은 그 프레임의 가장 확실한 한 사람의 관절·상자·프레임 크기·카메라다. `null`은 사람 관절 없음이다.
  - 지금 `people.ts` `applyPose`의 쓰러짐 부분(`fallPose`·`FallWatch.see`·침대·소파 빼기·`fall_suspected` 자세와 의미 있는 변화 한 줄)만 옮긴다.
  - 손에 듦·자세(서 있음·앉아 있음·누워 있음)·들고 감은 하지 않는다(VLM이 한다).
- 쓰러짐 의심인 동안 VLM 자세 답이 그 자세를 지우지 않는 지금 규칙(`poseHolds`의 쓰러짐 부분)은 남긴다. 그 밖의 관절 우선 규칙은 없앤다.
- 사람 등장·사라짐은 VLM이 정한다. 쓰러짐 신호는 VLM이 사람을 아직 확정하지 않았어도 「쓰러짐 의심」 변화를 낸다(긴급이라 기다리지 않는다).
- **구조로 막기:** `src/world/`에서 계약의 `Detection`·`Pose`(YOLO 출력 타입)를 쓰는 파일은 `src/world/fall.ts`·`src/world/pose.ts`(쓰러짐 계산)와 `applyFall`이 있는 파일 하나뿐이다.
  - 새 시험 `tests/world-yolo-gate.test.ts`가 그 밖의 파일에서 그 타입을 import하면 실패한다.
  - 지금 `objects.ts`·`people.ts`·`devices.ts` 실제 줄로 실패를 확인한다.
  - 관찰 흐름은 YOLO 감지를 `seen`·`landmarks`·`applyFall` 셋에만 넘긴다(`tests/observe-yolo-routes.test.ts`).

## 장면 VLM 답 모양

```json
{
  "scene": "kitchen",
  "people": [{ "id": "p1", "box": [0.42, 0.18, 0.2, 0.7], "posture": "standing", "activity": "drinking", "moment": "drank", "holding": "o1" }],
  "objects": [{ "id": "o1", "cls": "cup", "box": [0.55, 0.40, 0.05, 0.07], "facts": ["in_hand", "has_contents", "body_opaque"] }],
  "summary": "…"
}
```

- 상자는 그 사진 너비·높이의 비율이다(가까이 보기는 잘라 키운 사진 기준). 범위 밖·넓이 0은 버린다.
- 종류 enum은 낱말 표의 사람·물건·가전 설비, 면 값 enum은 지금 `SCENE_STATES`에서 만든다.
- 가림(`not_visible`) 대신 목록에 없으면 안 보인 것이다.
- YOLO 감지 목록은 VLM에 넘기지 않는다. 입력이 줄고 VLM이 YOLO에 끌려가지 않는다.
- 가까이 보기·위에서 보기도 같은 스키마다.

## 확정·사라짐 규칙(VLM 사진 기준)

| 대상 | 등장(확정) | 사라짐 | 자리 |
|---|---|---|---|
| 사람 | VLM 사진 1장 | 시야 안 VLM 사진 2장 이어 없음 | 매 VLM 답 |
| 물건 | VLM 사진 2장이 같은 자리(그 종류 거리 안). 가까이 보기 VLM 1장은 바로 확정(사람이 그 자리를 비춤) | 시야 안 VLM 사진 3장 이어 없음 | 매 VLM 답(자리 고친 촬영보다 새면) |
| 후보 보관 | VLM 두 장 사이 + 1초(기본 5초, 가까이 보는 차례 1초면 3초) | — | — |
| 가전 설비 | VLM 사진 1장 | 물건과 같음 | — |

- 「이어 없음」은 VLM 사진 장 수로 센다. 사람이 보이는 동안 VLM 간격이 1초로 줄면 시간도 준다.
- 시야 밖(트윈 자리가 카메라 밖) 사진은 세지 않는다(지금 규칙).
- 사람 1장 확정의 근거: 사람은 VLM이 거의 놓치지 않고, 2장을 기다리면 등장 반응이 2초 더 늦다. 물건은 VLM이 작은 물건을 지어낼 수 있어 2장이다.

## 반응 시간(사용자 최우선: 성능)

가정: VLM 사진 간격 2초(사람이 보이는 동안 1초: 줄이는 법 1), VLM 답 1.8초(구현명세서 6.1), YOLO 한 장 0.15초(실제 감지 144~218ms). 사건은 두 사진 사이 아무 때나 난다(평균 간격의 절반을 기다림).

| 구간 | 지금(YOLO 0.1초) | 바뀐 뒤 그대로(2초) | 줄인 뒤(1초 + 짧은 스키마) |
|---|---|---|---|
| 사람 등장 | 약 2.2초(2초 이어 보임) | 0~2 + 1.8 = 평균 2.8초(1장) | 평균 2.8초(사람이 보이기 전이라 2초 간격). 짧은 스키마로 답 1.3초면 2.3초 |
| 사람 사라짐 | 약 4.2초(4초 못 봄) | 0~2 + 2 + 1.8 = 평균 4.8초(2장) | 0~1 + 1 + 1.3 = 평균 2.8초 |
| 물건 확정 | 약 2.2초 | 0~2 + 2 + 1.8 = 평균 4.8초(2장) | 사람이 보이면 평균 2.8초, 안 보이면 4.3초 |
| 물건 사라짐 | 약 6.2초 | 0~2 + 4 + 1.8 = 평균 6.8초(3장) | 사람이 보이면 평균 3.8초 |
| 물건 자리 바뀜(옮김) | 약 0.2초 | 평균 2.8초 | 평균 1.8초 |
| 손에 듦·마심 | 관절 3장에 1장, 약 0.5초 | 평균 2.8초 | 평균 1.8초 |
| 폰 위치 맞추기 | YOLO 기준점 | **YOLO 유지: 그대로** | 같음 |
| 쓰러짐 의심 | 넘어짐 + 누운 채 3초, 약 3.2초 | **YOLO 유지: 약 3.2초 그대로** | 같음 |
| 가까이 보기 결과 | 자르기 + YOLO + VLM, 약 2초 | VLM만, 약 1.8초(자르기 YOLO 0.15초 빠짐) | 같음 |
| 대시보드 미니맵 | 0.1초(YOLO) | 그대로 | 그대로 |

### 줄이는 법(근거와 함께)

1. **사람이 보이는 동안 VLM 1초:** 사람이 있을 때 일이 빨리 바뀐다(마심·들고 감·나감). 비용은 그 동안 2배다(아래). `VLM_FRAME_MS_ACTIVE`(기본 1000), 사람이 안 보이면 지금 `VLM_FRAME_MS`(2000).
2. **짧은 스키마:** 출력이 답 시간의 대부분이다. 칸 이름을 짧게(`p`·`o`·`b`·`f`), 바뀐 면 값만, 요약 한 문장. 지금 출력은 요약 두 문장 + 사실 줄이다. 목표: 사람 하나 + 물건 둘에 약 120토큰. 실제 판에서 `/api/brain` VLM 평균 시간으로 잰다(조정자).
3. **상자만 묻는 가벼운 호출(다음 단계 제안):** 사람이 보이는 동안 1초 호출을 최근 1장·상자와 종류만 묻는 호출로 바꾸고, 사실·요약은 2초 호출에 둔다. 입력 약 2,100 → 약 500토큰(사진 1장)이라 답이 빠르고 싸다. 이 계획은 1·2만 하고, 3은 실제 판 숫자를 본 뒤 정한다.
4. **YOLO 감지 목록을 VLM에 넘기지 않음:** 입력이 감지 줄만큼 준다(이 계획에서 함께).
5. **동시 요청:** 1초 간격 + 답 1.3~1.8초면 동시 2개다. 지금 상한 4라 막히지 않는다.

## 비용(gpt-5.4-nano, 입력 $0.2/M·출력 $1.25/M)

| 항목 | 지금 | 바뀐 뒤(2초) | 줄인 뒤(사람이 보이는 동안 1초) |
|---|---|---|---|
| 호출 수 | 시간당 1,800 | 1,800 | 사람이 보이는 시간이 반이면 2,700 |
| 한 번 입력 | 약 2,100토큰 | 약 2,100 − 감지 줄(약 50) + 스키마(약 150) = 약 2,200 | 같음 |
| 한 번 출력 | 사실·요약(추정 약 70토큰, 한 번 $0.00042에서 입력 몫을 뺀 값) | 목록 포함 약 120~200토큰 | 짧은 스키마 약 120토큰 |
| 한 번 비용 | 약 $0.00042 | 약 $0.00059~0.00069 | 약 $0.00059 |
| 시간당 | 약 $0.76(구현명세서는 $0.90) | 약 $1.06~1.24 | 약 $1.59 |

추정이다(출력 토큰 수는 실제 답으로 잰다). 가까이 보기 VLM은 지금과 같은 수다(YOLO 자르기만 빠짐).

## 순서

**묶음 ①: 가까이 보기 「찾은 것」을 VLM 답으로(먼저 구현)**

- Task 1(스키마): 가까이 보기·위에서 보기 VLM 답에 `objects`(종류·상자·면 값). 가짜 VLM 대본에 물건 칸. 시험: `parseScene`이 범위 밖 상자·모르는 종류를 버림, 스키마 enum이 낱말 표와 같음.
- Task 2(World State): 잘라 본 사진의 VLM 물건 상자 → 원래 프레임 픽셀(`x = cx + bx·cw`) → `placePoint`.
  - 맞는 물건(사라진 것 포함)을 지금 `closeGroup` 규칙으로 고치고, 없으면 확인 물건을 만든다.
  - `found`에 넣는다(`via: "vlm"`).
  - 시험(wide-glass 재현): 잘라 본 장에 YOLO 감지가 없어도 VLM이 컵 상자를 답하면, 사라진 cup_19가 「보임」으로 돌아오고 `found`에 든다. 사람 상자 안의 물건(사람이 보이는 동안)은 넣지 않는다.
- Task 3(e2e): 컵이 사라진 뒤 찾기 가까이 보기 → 가짜 VLM 컵 상자 → 계획이 첫 단계로 이어짐.

**묶음 ②: 장면 VLM 물건으로 후보·확정·사라짐(YOLO 물건 길 끊기)**

- Task 4: 장면 스키마 `objects`(가전 설비 포함), YOLO 감지 목록을 VLM에 넘기지 않음.
- Task 5: World State `applyScene`이 물건을 넣는다(위 확정·사라짐 표). `applyDetections`의 물건·가전 설비 갈래를 없앤다. 시험:
  - 머그 재현: YOLO 감지 없이 VLM 두 장이 같은 자리 컵 → 확정.
  - 유리컵 재현: 붙잡은 장면에서 VLM이 계속 컵을 말하면 사라지지 않음.
  - VLM 세 장 이어 없으면 사라짐. 시야 밖 장은 세지 않음.
  - 가전 설비 1장 확정.
- Task 6: 시험 장면 대본(대본 감지기 + 사실)을 가짜 VLM 답으로 바꾸는 도우미 `tests/helpers/vlm-scene.ts`. 데모 e2e 넷·영상 모드 셋이 그 도우미로 같은 흐름을 탄다. 기록 DB 같음 정답은 바뀌므로 바뀐 줄을 하나씩 보고 고쳐 쓴다(조정자에게 차이 목록을 보낸다).

**묶음 ③: 사람·자세·손에 듦·사건을 VLM으로(YOLO → World State 길 다 끊기)**

- Task 7: `people` 목록 → 사람 등장·사라짐·자리·방·자세·하는 일·손에 듦(표 2~5·16).
- Task 8: 마시기 사건·들고 감·컵 크기·가전 설비 상태(표 6·8~10·12)를 VLM으로.
- Task 9: 쓰러짐 예외 길 `applyFall`을 떼어 내고, `applyDetections`·`applyPose`를 World State 입구에서 없앤다. `tests/world-yolo-gate.test.ts`·`tests/observe-yolo-routes.test.ts`로 구조로 막는다(위 「쓰러짐 예외 길」). 쓰러짐 시험(`tests/world-fall*.test.ts`)은 `applyFall`로 그대로 통과한다.
- Task 10: 사람이 보이는 동안 VLM 1초(`VLM_FRAME_MS_ACTIVE`), 짧은 스키마. `tests/latency-world.test.ts` 같은 반응 시험(가짜 VLM 답 지연을 둔 사람 사라짐 반응)을 둔다.

각 묶음 끝: 데모 e2e 넷·영상 모드 셋·typecheck·lint, 커밋·push, 해시를 조정자에게. 실제 판은 조정자가 돌린다.

## 위험

| 위험 | 막는 것 |
|---|---|
| 반응이 늦어짐(위 표) | 사람이 보이는 동안 1초·짧은 스키마. 실제 판 시각표로 잰다 |
| VLM이 없는 물건을 지어냄 | 물건은 두 장 같은 자리여야 확정. 가까이 보기 1장은 사람이 그 자리를 비춘 때뿐 |
| VLM 상자가 덜 정확(작은 물건) | 바닥 점 투영 오차를 `errorM`에 남기고, 맞추기는 종류 거리 안 |
| YOLO가 쓰러짐 길로 World State에 새어 들어감 | 예외 길은 `applyFall` 하나, 받는 것은 쓰러짐 신호뿐. 두 구조 시험이 막는다 |
| 시험 대본을 모두 바꿔야 함 | 장면 대본 → 가짜 VLM 답 도우미 하나로 옮김(Task 6) |
| 다른 에이전트의 act/track·ui 변경과 충돌 | observe·VLM·world/state·contract·tests에 머문다. `src/act`는 `CloserFound.via`만 읽는다 |

## 쓰러짐 → 보호자 연락: 지금 코드가 이어진 곳(다음 일)

지금은 쓰러짐 의심이 보호자 연락으로 이어지지 않는다.
- YOLO 관절이 쓰러짐 의심이 되면 World State 사람 자세가 `fall_suspected`가 되고 의미 있는 변화 「쓰러짐 의심」 한 줄이 난다(`src/world/state/people.ts`).
- 대시보드 말풍선 카드가 다른 글보다 먼저 「사람이 쓰러진 것 같아요.」를 보인다(`src/act/say.ts`).
- 그 변화는 PAM 판단의 계기·관찰 텍스트에 들어가지만, PAM 행동 목록(`src/act/tasks.ts`)에는 연락 행동이 없다.
- 보호자 연락(`call_service` kind `guardian`, `src/agent/service.ts`)은 말로 시킨 요청에서 에이전트 도구로만 부른다. 부르면 늘 실제 폰으로 승인을 먼저 묻고, 받는 이는 등록부 `contacts.json`에서만 정한다(구현명세서 6.6).
- 그래서 지금은 쓰러짐을 보고 바로 거는 길도, 승인 질문을 내는 길도 없다. 코치 모드 긴급 상황 → 보호자 전화는 다음 일로 따로 계획한다.
