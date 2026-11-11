# 약한 후보 다시 보기 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엔진 프레임 전체 사진에서 확신이 모자란 물건 후보(0.1 이상, 그 종류 `minScore` 미만)를 2배로 잘라 같은 YOLO로 다시 보고, 그 종류 기준을 넘으면 그 프레임 감지로 받는다.

**Architecture:** 관찰 흐름(`src/observe/pipeline.ts` `drain`)이 전체 사진 감지 뒤 약한 후보를 최대 3개 골라 `cropBox`·`cropJpeg`(`src/observe/crop.ts`)로 잘라 다시 감지한다. 받은 감지는 엔진 프레임 픽셀 상자로 옮겨 원래 후보 자리에 넣고, 그 뒤는 보통 감지와 같다(World State 3장 연속 등장, VLM 상자 목록). 가까이 보기(`closer`)는 그대로 둔다.

**Tech Stack:** Node 22 TypeScript 서버, onnxruntime-node YOLO26n, jpeg-js, Vitest.

**Spec:** 사용자 11-12 요청 「0.4 이하의 물체가 확실하지 않으면 그 주변만 크롭해서 다시 확인」. 근거(`runtime/videos/home-place.mp4` 19장, n 모델): 컵을 내려놓는 동안 유리컵이 「컵 0.12~0.20」·「병 0.13」 후보로 나오고, 그 둘레 2배 자르기에서 컵 0.38~0.61(7/19장 0.4 이상). 컵이 놓인 뒤에는 후보가 거의 없다(가까이 보기가 맡음). 같이 쓰면 13/19장. VLM이 놓친 물건 상자를 내는 안은 상자가 약 40px 어긋나 2/9장만 확인돼 넣지 않는다.

## Global Constraints

- 저장소 `CLAUDE.md` 규칙 표 전부(mock·live 같은 구조, src에 규칙 기반 판단·`Mock`류 클래스 없음, 시험 대역 `tests/helpers/`, PAM에 사진 없음).
- 다시 보는 후보: 역할 `object`(사람·가전 설비·장면 아님), 점수 0.1 이상 그 종류 `minScore` 미만, 점수 높은 차례로 프레임마다 최대 3개(`RECHECK_MAX`).
- 받는 조건: 잘라 본 사진의 감지 중 역할 `object`, 그 종류 `minScore` 이상, 잘라 본 상자 경계에 닿지 않음(`onCropEdge`), 엔진 프레임 픽셀로 옮긴 상자가 후보 상자와 IoU 0.3 이상. 여럿이면 점수 높은 것 하나. 종류는 다시 본 감지의 종류다(병 후보 → 컵).
- 못 받은 후보와 0.25(지금 감지기 기준) 미만 감지는 지금처럼 다음 단계에 넘기지 않는다. 0.25 이상 감지는 지금과 같다.
- 시험은 파일 하나도 `npm run heavy -- npx vitest run tests/<파일>.test.ts`.

## 정한 값

| 값 | 크기 | 자리 |
|---|---|---|
| 다시 볼 후보 하한 `RECHECK_MIN` | 0.1 | `src/observe/pipeline.ts` |
| 프레임마다 다시 볼 후보 수 `RECHECK_MAX` | 3 | `src/observe/pipeline.ts` |
| 받는 IoU `RECHECK_IOU` | 0.3 | `src/observe/pipeline.ts` |
| 배율 | 2(`CLOSER_ZOOM`) | `src/observe/crop.ts` |

---

### Task 1: 약한 후보 다시 보기

**Files:**
- Modify: `src/observe/pipeline.ts`(`drain`, 상태 `recheck`), `src/brain/detector.ts`(감지기 하한을 0.1로 내리되 넘기는 감지는 그대로 두는 방법: 하한 0.1로 받고 pipeline이 0.25 미만을 거름, 또는 `DetectResult.weak`로 따로), `src/contract/events.ts`(`/api/brain` 상태 형)
- Test: `tests/observe-recheck.test.ts`(새), 대역은 `tests/helpers/detectors.ts`

**Interfaces:**
- Produces: `PipelineStatus.recheck: { tried: number; found: number; ms: number | null }`(`/api/brain`), 상수 `RECHECK_MIN`·`RECHECK_MAX`·`RECHECK_IOU`.

- [ ] **Step 1: 실패 시험.**
  - 전체 사진 감지가 「병 0.13 [135,287,85,84]」, 잘라 본 사진 감지가 그 자리 「컵 0.56」이면 그 프레임 World State 입력에 컵 0.56(엔진 프레임 픽셀 상자)이 들어가고, 3장 연속이면 컵이 등장한다. VLM 상자 목록에도 컵이 있다.
  - 사람·가전 설비 후보, 0.1 미만, 종류 기준 이상 감지는 다시 보지 않는다(감지기 호출 수로 확인).
  - 후보가 넷이면 점수 높은 셋만 다시 본다.
  - 잘라 본 감지가 경계에 닿거나 IoU 0.3 미만이면 받지 않고, 그 후보는 넘기지 않는다.
  - 감지기 오류는 그 후보만 버린다(프레임 감지는 그대로).
  - `/api/brain` `recheck`의 tried·found가 센다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/observe-recheck.test.ts`
- [ ] **Step 3: 구현.** 위 조건대로. 0.25 이상 감지의 지금 흐름(World State·VLM·위치 맞추기 `onDetected`)은 바꾸지 않는다.
- [ ] **Step 4: 통과 확인.** 같은 명령, `npx tsc --noEmit -p .`, `npm run lint`, 전체 `npm run heavy -- npx vitest run`
- [ ] **Step 5: 커밋** `feat(observe): recheck weak object candidates with a 2x crop on each engine frame`

### Task 2: 문서·판정 도구

- [ ] `docs/reference.md` 관찰 흐름 절에 한 문단(후보 조건, 받는 조건, 값), `/api/brain` `recheck`.
- [ ] `scripts/video-check.ts` 비용 줄에 「다시 보기 n번 중 m번 받음」(있을 때). 시험 `tests/video-check.test.ts`.
- [ ] 커밋 `docs: describe the weak candidate recheck`

### 실제 판정(메인 세션)

- [ ] 서버·PAM 새로 띄우고 `npm run heavy -- npx tsx scripts/video-check.ts --clip home-idle.mp4 --step go:table:home-go-table.mp4 --step pick:cup:home-pick.mp4 --step go:sink:home-go-sink.mp4 --step place:sink:home-place.mp4 --expect-after 27.8`. 목표: 놓기 단계 4/4. `/api/brain` `detect_ms`·`recheck.ms`로 속도를 본다.
