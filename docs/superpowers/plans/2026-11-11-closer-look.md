# 가까이 보기 계획 (관찰 모드)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 설계에서 바꿀 점

정한 설계(관찰 모드가 고름, 서버에서 잘라 봄, 멈춘 단계 A·판단 전 B, 기록, 시험)는 그대로 둔다. 코드 때문에 아래만 바꾼다.

1. **잘라 본 사진 한 장으로는 새 물건이 생기지 않는다.** 물건 등장은 3장 연속이어야 하고(`src/world/state.ts:116`, `src/world/confirm.ts:27-47`), 확인 전 물건은 다음 프레임에 안 보이면 잊는다(`state.ts:337-339`). 전체 사진은 싱크대 안 컵을 못 보니 한 장으로는 놓기 조건이 참이 될 수 없다. → 고리의 최근 엔진 프레임 3장(프레임마다 자기 자세·투영)을 같은 자리로 잘라 감지하고, 세 번을 촬영 순서대로 한 번에(다른 프레임이 끼지 않게) World State에 넣는다. VLM은 마지막 한 장만 본다.
2. **잘라 본 프레임을 보통 프레임처럼 넣으면 잘라낸 밖이 망가진다.** 시야 안인데 안 보인 물건을 사라짐으로 세고 사람은 늘 시야 안으로 본다(`state.ts:305-307`). 이번에 안 보인 키의 등장 셈을 지우고(`confirm.ts:31-34`), 확인 전 물건을 잊고(`state.ts:337-339`), 잘린 사람 상자 아래를 발로 본다(`state.ts:299-303`, `:373`). → `applyDetections(frame, dets, undefined, { region })`: 본 것과, 트윈 자리를 그 프레임에 찍은 점이 잘라 본 상자 안인 것만 센다. 사람 자리·방·관절은 보지 않는다.
3. **가까이 봐서 찾은 물건은 다음 전체 사진 3장(약 6초) 뒤 사라짐이 된다.** 전체 사진의 감지기는 그 물건을 못 본다. VLM 「싱크대 안」 답보다 사라짐이 먼저 올 수 있다. → 가까이 봐서만 찾은 물건은 30초(`CLOSER_HOLD_MS`) 동안 전체 사진에서 안 보여도 사라짐·시야 밖으로 세지 않는다.
4. **VLM 상자는 VLM이 보는 사진의 픽셀이다.** 엔진 프레임 픽셀로 옮긴 상자는 World State·대시보드에만 쓴다. 프레임 절반을 잘라 프레임 크기로 키운 JPEG 한 장을 감지기와 VLM이 같이 쓴다. 감지기는 그 사진을 640 레터박스로 넣으므로 2배 확대와 같다(`src/brain/detector.ts:305-319`).
5. **VLM 풀은 창(최근 5장)을 보낸다**(`src/observe/pipeline.ts:135`). → 잘라 본 사진은 「2배로 잘라 키운 사진」 한 줄과 함께 혼자 같은 풀로 보낸다. 동시 상한·시간 한도·비용 셈은 그대로다. 그 답은 장면 요약(`state.ts:473-480`)을 바꾸지 않는다(장면 일부라서).
6. **자리(싱크대·식탁)는 배치 가운데가 아니라 윗면 가운데를 본다.** 실행 추적의 자리(`locate`, `src/server/home.ts:303`)는 배치 상자 가운데이고, 싱크대는 높이 약 0.45m다. 영상 모드에서 걸은 자세(대상 0.6m 앞, 높이 1.4m, 아래 25°, 세로 시야 60°, `ui/src/phone/core/video-ar.js:59-60`)에서는 그 점이 화면 가운데보다 약 33° 아래라 사진 밖이다. 윗면(약 0.9m)은 약 15° 아래로 사진 안이다.
7. **대시보드에 추론 목록 칸이 없다.** 리듀서(`ui/src/dashboard/data.ts:39-44`)는 판단과 상자 있는 observe만 쓰고 execution은 버린다. → 화면 부품을 새로 만들지 않는다. (가) 말풍선 카드 한 줄 「싱크대를 가까이 보고 있어요.」(`src/act/say.ts`)를 쓰고, (나) 잘라 본 감지를 엔진 프레임 픽셀 상자로 observe 기록에 실어 폰 칸이 상자를 그리게 한다. 기록 줄은 `/api/history`와 판정 도구에 나온다.
8. **기록 이름은 `look`이다.** `observe`는 이미 엔진 프레임 기록(`src/contract/events.ts:94`)이라 헷갈린다. BrainLog와 기록 종류 모두 `look`으로 쓴다.
9. **에이전트 LLM 비용은 지금 어디서도 세지 않는다**(`scripts/video-check.ts:505` 「PAM·계획 비용 빠짐」). → 공급자 응답 사용량(`StepResult.usage`)을 더해 관찰 모드 비용만 센다(`/api/brain`의 `look`). 잘라 본 VLM은 같은 풀이라 `vlm.costUsd`에 들어가고, `closer.costUsd`로도 따로 보인다.
10. **B에 상한을 둔다.** 같은 컵에 새 id가 자주 붙는다(`runtime/videos/home-idle.20261111-200004.timeline.md`의 cup_3·6·7·9). → 물건마다 30초에 더해 B 전체로 10초에 한 번만 부른다. 이미 싱크대 안인 물건(`putAway`, `src/act/tasks.ts:43`)은 보지 않는다. A가 오면 B는 관찰 모드를 부르는 중일 때만 끊는다. B가 이미 잘라 보는 중이면 A를 받지 않고, 실행 추적이 다음 tick에 다시 부른다.
11. **Anthropic은 도구를 강제할 수 없다.** 생각이 늘 켜져 있어 auto만 쓴다(`src/agent/providers/anthropic.ts:77-78`). → 도구를 안 부르거나 틀린 도구·인자를 내면 까닭을 주고 한 번 더 묻는다(최대 2차례). 그래도 틀리면 기다리기로 적는다.

**목표:** 비전이 판단할 만큼 못 볼 때 에이전트(관찰 모드)가 스스로 고른다. 폰의 마지막 엔진 프레임을 서버에서 2배로 잘라 같은 YOLO·VLM으로 다시 보거나(look_closer), 실제 폰으로 사람에게 가까이 비춰 달라고 하거나(ask_person), 기다린다(wait). 컵 치우기 놓기 단계가 전체 사진에서 싱크대 안 컵을 못 봐도 가까이 보기로 넘어가야 한다.

**구조:**
- 관찰 모드(`src/agent/observer.ts`)는 계획 모드와 같은 공급자(`createProvider`, `.env` `OPENAI_MODEL=gpt-5.4-mini`)를 쓴다. 호출마다 새 대화에서 도구 하나만 고르고, 실행은 하지 않는다.
- 가까이 보기(`ObservationPipeline.closer`)는 고리 최근 3장마다 대상 트윈 자리를 그 프레임에 찍는다. 프레임 절반 크기로 잘라 프레임 크기로 키우고 감지한 뒤, 상자를 엔진 프레임 픽셀로 옮긴다. World State에는 잘라 본 상자 안만 세며 세 번을 한 번에 넣는다. 마지막 장만 VLM 풀에 혼자 보내고, 그 답은 보통 프레임과 같은 `applyScene`으로 들어간다.
- 실행 추적(`src/act/track.ts`)은 집기·놓기 단계가 8초 넘게 안 끝나면 A를 부르고(단계마다 3번까지), 사람 부탁(`askCloser`)은 같은 계획·단계 id로 글만 바꿔 다시 보낸다.
- 보기 담당(`src/act/look.ts`)은 A·B를 한 번에 하나만 돌린다(A 먼저). B는 판단 타이머(250ms)에서 행동 대상 종류 물건의 볼 면(`TaskSpec.look`, 컵은 contents)을 모를 때 부르며 PAM 호출을 막지 않는다. 고를 때마다 `look` 기록을 하나 남긴다.
- 화면은 말풍선 카드 한 줄과 폰 칸 상자만 바뀐다(새 부품 없음). 판정 도구는 「가까이 보기」 줄과 비용을 보인다.

**기술:** Node 22 TypeScript 서버, jpeg-js, Vitest, 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`).

**출처:** 사용자 11-11 요청. 판단할 만큼 못 보면 에이전트가 스스로 더 가까이 보거나 사람에게 가까이 찍어 달라고 한다. 근거: 사용자 영상의 싱크대 안 유리컵은 360×640 전체 사진에서 0.11이거나 안 잡히지만, 서버에서 2배로 잘라 보면 0.70~0.75로 잡힌다.

## 지켜야 할 것

- 저장소 `CLAUDE.md` 규칙 표 전부. 특히 다음을 지킨다.
  - mock·live는 같은 구조로 돈다. 관찰 모드는 같은 공급자, VLM은 같은 추론 주소다.
  - 시험 대역은 `tests/helpers/`에 둔다. 모델은 같은 OpenAI 주소 자리의 가짜 서버로 둔다.
  - `src`에 규칙으로 계획 만드는 코드와 `Mock`·`Scripted`·`Fake`·`Rule` 클래스를 두지 않는다.
  - PAM에는 사진을 넘기지 않는다. 가까이 본 것도 World State 글로만 간다.
  - 대시보드에는 추론·판단만 보이고 입력창은 없다.
  - 화면 글 규칙을 지킨다. `LOOK_TEXT`·`SAY_TEXT`는 `npm run lint` 대상이다.
  - 화면 부품은 21st.dev 것만 쓴다(이번에는 화면 코드를 바꾸지 않는다).
  - 무거운 일은 `npm run heavy`로 하나씩 돌린다.
- 사람 부탁 글은 「주세요」로 끝나고 화면 글 규칙(`src/plan/copy.ts` `copyRules`)에 맞아야 한다. 클로이드가 스스로 하는 말로 쓰지 않는다.
- 시험은 파일 하나도 `npm run heavy -- npx vitest run tests/<파일>.test.ts`로 돌린다.
- 커밋 전 `trail check`.
- 실제 모델 비용은 이번 일 전체 1달러 안이다. 관찰 모드 한 번은 약 $0.002, 잘라 본 VLM 한 장은 약 $0.0005다.

## 정한 값

| 값 | 크기 | 자리 |
|---|---|---|
| 멈춘 단계 기준 `stallMs` | 8초(단계 시작 뒤, 앞 부름 뒤) | `TRACK_DEFAULTS` |
| 단계마다 부름 `stallMax` | 3번 | `TRACK_DEFAULTS` |
| 잘라 볼 프레임 `CLOSER_FRAMES` | 3장(가장 새 프레임에서 3.5 × `engineMs` 안) | `src/observe/pipeline.ts` |
| 배율 `CLOSER_ZOOM` | 2(너비·높이 절반을 잘라 프레임 크기로) | `src/observe/crop.ts` |
| 사진 안 여유 `LOOK_MARGIN` | NDC 0.25 | `src/observe/crop.ts` |
| 가까이 본 물건 지킴 `CLOSER_HOLD_MS` | 30초 | `src/world/state.ts` |
| B 물건마다 `objectGapMs` / 전체 `gapMs` | 30초 / 10초 | `LOOK_DEFAULTS` |
| 관찰 모드 차례·시간 한도 | 2차례·15초·출력 1000토큰 | `OBSERVER_DEFAULTS` |
| 말풍선 가까이 보기 줄 `SAY_LOOK_MS` | 6초 | `src/act/say.ts` |

## 파일 지도

| 파일 | 하는 일 하나 |
|---|---|
| `src/agent/agent.ts` | `StepOptions.requireTool`, `StepUsage`, `StepResult.usage` 계약 |
| `src/agent/providers/openai.ts`·`anthropic.ts` | 도구 하나 꼭 부르기와 응답 사용량 |
| `src/world/place.ts` | `pixelOf`: 트윈 점 → 엔진 프레임 픽셀 |
| `src/observe/crop.ts` (새) | 가까이 보기 자르기 셈과 `LookSpot` |
| `src/world/confirm.ts` | 등장·사라짐 셈에서 볼 키만 고르기(`only`) |
| `src/world/state.ts` | 잘라 본 상자 안만 세는 감지 넣기와 가까이 본 물건 지킴, 요약을 바꾸지 않는 장면 넣기 |
| `src/observe/ring.ts` | `EngineFrame.crop` 표시 |
| `src/observe/scene.ts` | 잘라 본 사진 앞 한 줄 `CLOSER_NOTE` |
| `src/observe/pipeline.ts` | `closer(spot)` 실행, `latest()`, 상태 `closer` |
| `src/contract/events.ts` | `CloserResult`·`LookTool`·`LookTrigger`·BrainLog `look`·observe `closer` |
| `src/agent/planInput.ts` | `worldLines` 내보내기 |
| `src/agent/observer.ts` (새) | 관찰 모드: 상황 글 → 도구 하나, 검사, 비용 |
| `src/act/track.ts` | 멈춘 집기·놓기 단계 알림(A)과 사람 부탁 다시 보내기 |
| `src/act/tasks.ts` | `TaskSpec.look`·`lookTargets` |
| `src/act/look.ts` (새) | A·B 한 번에 하나, 고른 도구 실행, `look` 기록 |
| `src/plan/labels.ts` | `LOOK_TEXT`, `SAY_TEXT.closer` |
| `src/act/say.ts` | 말풍선 카드의 가까이 보기 줄 |
| `src/contract/history.ts`·`src/history/db.ts`·`src/history/recorder.ts` | 기록 종류 `look` |
| `src/server/home.ts` | 묶기: 관찰 모드·보기 담당·판단 타이머·`/api/brain` |
| `scripts/video-check.ts` | 「가까이 보기」 줄과 비용 줄 |
| `scripts/fake-openai.ts` | `respond`가 Promise도 받기(시험에서 답을 붙잡기) |
| `tests/helpers/camera.ts` (새) | 시험 카메라 `LOOK_VIEW`, 사진 `frameJpeg`, `engineFrame` |
| `tests/helpers/detectors.ts` | `cropAware`: 엔진 사진은 full, 잘라 키운 사진은 crop 감지 |
| `tests/helpers/observer.ts` (새) | 관찰 모드 가짜 서버 대본 |
| `tests/helpers/look.ts` (새) | `testCloser`, `closerVlmReply` |

---

### Task 1: 공급자에서 도구 하나 꼭 부르기와 사용량

**Files:**
- Modify: `src/agent/agent.ts:35-50`, `src/agent/providers/openai.ts:62-73`, `src/agent/providers/anthropic.ts:71-88`
- Test: `tests/agent.test.ts` 「공급자 배선(가짜 API)」

**Interfaces:**
- Produces:
  - `StepOptions.requireTool?: boolean`. forceTool이 먼저이고, allowTools false면 무시한다.
  - `export interface StepUsage { model: string; input: number; cached: number; output: number }`
  - `StepResult.usage?: StepUsage`

- [ ] **Step 1: 실패 시험.** 「도구를 꼭 부르게 하면(requireTool) openai는 required·병렬 끔, anthropic은 auto·병렬 끔. forceTool이 먼저다. 응답 사용량을 돌려준다」.
  - openai 가짜 응답에 `usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 7, total_tokens: 107 }`를 싣는다. → 본문 `{ tool_choice: "required", parallel_tool_calls: false }`, 결과 `usage` `{ model: "gpt-5.5", input: 100, cached: 40, output: 7 }`.
  - `forceTool`과 함께 주면 `{ type: "function", name }`.
  - anthropic `usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 5 }` → 본문 `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, `usage` `{ model: "claude-opus-5-5", input: 15, cached: 5, output: 3 }`.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/agent.test.ts`
- [ ] **Step 3: 구현.**

```ts
// src/agent/providers/openai.ts step()
const one = opts.allowTools && (opts.forceTool !== undefined || opts.requireTool === true);
const res = await this.client.responses.create({
  model: this.model, instructions: opts.system, input: s.items,
  tools: opts.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: toolJsonSchema(t), strict: false })),
  tool_choice: !opts.allowTools ? "none" : opts.forceTool ? { type: "function" as const, name: opts.forceTool } : opts.requireTool ? "required" : "auto",
  ...(one ? { parallel_tool_calls: false } : {}),
  ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
}, opts.signal ? { signal: opts.signal } : undefined);
// ...
const u = res.usage;
return { text: res.output_text ?? "", calls, ...(u ? { usage: { model: res.model, input: u.input_tokens, cached: u.input_tokens_details?.cached_tokens ?? 0, output: u.output_tokens } } : {}) };
```

```ts
// src/agent/providers/anthropic.ts step()
tool_choice: !opts.allowTools ? { type: "none" } : opts.forceTool || opts.requireTool ? { type: "auto", disable_parallel_tool_use: true } : { type: "auto" },
// 응답 뒤, 세 갈래 return 모두 usage를 싣는다
const cached = res.usage.cache_read_input_tokens ?? 0;
const usage = { model: res.model, input: res.usage.input_tokens + cached + (res.usage.cache_creation_input_tokens ?? 0), cached, output: res.usage.output_tokens };
```

- [ ] **Step 4: 통과 확인.** 같은 명령, 그리고 `npm run heavy -- npx vitest run tests/agent-planner.test.ts`
- [ ] **Step 5: 커밋** `feat(agent): let a step require one tool call and return token usage`

### Task 2: 자르기 셈

**Files:**
- Modify: `src/world/place.ts` (`ndc` 옆, `:73-81`)
- Create: `src/observe/crop.ts`, `tests/helpers/camera.ts`
- Test: `tests/observe-crop.test.ts`

**Interfaces:**
- Produces:
  - `pixelOf(view: CameraView, point: [number, number, number], size: { width: number; height: number }): [number, number] | null`. 카메라 뒤면 null이고, 그림 밖이어도 낸다.
  - `crop.ts`:
    - `CLOSER_ZOOM = 2`, `LOOK_MARGIN = 0.25`
    - `type Box = [number, number, number, number]`
    - `interface LookSpot { id: string; label: string; position: [number, number, number] }`
    - `cropBox(center: [number, number], size, zoom?): Box`
    - `toFrameBox(box: Box, crop: Box, out: { width; height }): Box`
    - `cropJpeg(src: Buffer, crop: Box, out: { width; height }, quality?): Buffer`
  - `tests/helpers/camera.ts`:
    - `LOOK_VIEW: CameraView`: 트윈 (0, 1.5, 0)에서 +x를 보고 45° 아래, 90° 정사각 투영. `tests/world-place.test.ts`와 같다.
    - `LOOK_SIZE = { width: 480, height: 360 }`
    - `frameJpeg(i: number, rects?: Box[]): Buffer`: 밝기가 i마다 다른 회색에 흰 네모.
    - `engineFrame(id, atMs, o?)`

- [ ] **Step 1: 실패 시험.**
  - `pixelOf(LOOK_VIEW, [1.5, 0, 0], LOOK_SIZE)`와 `pixelOf(LOOK_VIEW, [0.6, 0.9, 0], LOOK_SIZE)`는 둘 다 약 `[240, 180]`이다. 둘 다 그림 가운데 광선 위의 점이다. `[-2, 0, 0]`은 null이다.
  - `cropBox([240, 180], LOOK_SIZE)` = `[120, 90, 240, 180]`. `[10, 10]` → `[0, 0, 240, 180]`, `[470, 350]` → `[240, 180, 240, 180]`(그림 안으로 붙임).
  - `toFrameBox([220, 160, 40, 20], [120, 90, 240, 180], LOOK_SIZE)` = `[230, 170, 20, 10]`. 그 상자 아래 가운데 (240, 180)으로 `placeBox`를 하면 다시 `[1.5, 0, 0]`이다(왕복).
  - `cropJpeg(frameJpeg(1, [[170, 140, 20, 10]]), [120, 90, 240, 180], LOOK_SIZE)`를 풀면 480×360이다. (120, 110) 화소는 200보다 밝고(흰 네모가 2배로 [100, 100, 40, 20]), (20, 20)은 160보다 어둡다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/observe-crop.test.ts`
- [ ] **Step 3: 구현.**

```ts
// src/world/place.ts
/** 트윈 점의 엔진 프레임 픽셀 [x, y](placeBox와 같은 NDC 방향). 카메라 뒤면 null. 그림 밖이어도 낸다. */
export function pixelOf(view: CameraView, point: V3, size: { width: number; height: number }): [number, number] | null {
  const n = ndc(view, point);
  return n ? [((n[0] + 1) / 2) * size.width, ((1 - n[1]) / 2) * size.height] : null;
}
```

```ts
// src/observe/crop.ts
// 가까이 보기 자르기(src/observe/pipeline.ts closer): 트윈 자리 → 엔진 프레임 픽셀 → 프레임 1/zoom 크기 상자(그림 안으로 붙임) → 잘라 프레임 크기로 키운 사진,
// 그 사진의 상자 → 엔진 프레임 픽셀. 키운 사진 한 장을 감지기와 VLM이 같이 본다.
import jpeg from "jpeg-js";

export type Box = [number, number, number, number];
type Size = { width: number; height: number };
/** 가까이 볼 곳: id·이름과 트윈 자리 [x, 높이, y]. */
export interface LookSpot { id: string; label: string; position: [number, number, number] }
export const CLOSER_ZOOM = 2;
/** 대상 점이 이만큼(NDC) 화면 밖이어도 사진 안으로 본다(자르는 상자는 그림 안으로 붙인다). */
export const LOOK_MARGIN = 0.25;

export function cropBox(center: [number, number], size: Size, zoom = CLOSER_ZOOM): Box {
  const w = Math.round(size.width / zoom), h = Math.round(size.height / zoom);
  const x = Math.min(size.width - w, Math.max(0, Math.round(center[0] - w / 2)));
  const y = Math.min(size.height - h, Math.max(0, Math.round(center[1] - h / 2)));
  return [x, y, w, h];
}

export function toFrameBox(box: Box, crop: Box, out: Size): Box {
  const sx = crop[2] / out.width, sy = crop[3] / out.height;
  return [crop[0] + box[0] * sx, crop[1] + box[1] * sy, box[2] * sx, box[3] * sy];
}

/** 쌍선형(픽셀 가운데 기준, 끝은 붙임)으로 crop을 out 크기로 키운 JPEG. JPEG 크기가 out과 다르면 던진다(헤더와 다른 사진). */
export function cropJpeg(src: Buffer, crop: Box, out: Size, quality = 90): Buffer {
  const img = jpeg.decode(src, { useTArray: true, formatAsRGBA: true });
  if (img.width !== out.width || img.height !== out.height) throw new Error(`사진 크기가 헤더와 다릅니다(${img.width}×${img.height})`);
  const [cx, cy, cw, ch] = crop;
  const dst = new Uint8Array(out.width * out.height * 4);
  const at = (x: number, y: number) => ((cy + y) * img.width + cx + x) * 4;
  for (let y = 0; y < out.height; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y + 0.5) * (ch / out.height) - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < out.width; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) * (cw / out.width) - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), wx = fx - x0;
      const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1), o = (y * out.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = img.data[a + k]! + (img.data[b + k]! - img.data[a + k]!) * wx;
        const bottom = img.data[c + k]! + (img.data[d + k]! - img.data[c + k]!) * wx;
        dst[o + k] = Math.round(top + (bottom - top) * wy);
      }
      dst[o + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data: dst, width: out.width, height: out.height }, quality).data);
}
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/world-place.test.ts`
- [ ] **Step 5: 커밋** `feat(observe): add crop math for a closer look`

### Task 3: 잘라 본 한 번은 상자 안만 세고, 가까이 본 물건은 지킨다

**Files:**
- Modify: `src/world/confirm.ts:27-47`, `src/world/state.ts` (`Obj` `:49-66`, `create` `:156-165`, `visible` `:185-189`, `applyDetections` `:254-368`)
- Test: `tests/world-confirm.test.ts`, `tests/world-closer.test.ts`

**Interfaces:**
- Consumes: `pixelOf`(Task 2)
- Produces:
  - `Confirmer.observe(atMs, seen, candidates, inView, only?: (key: string) => boolean)`. only가 거짓인 키는 셈을 늘리지도 지우지도 않는다.
  - `export interface DetectionsOptions { region?: [number, number, number, number] }`
  - `applyDetections(frame, dets, poses?, o?: DetectionsOptions)`
  - `export const CLOSER_HOLD_MS = 30_000`

- [ ] **Step 1: 실패 시험.**
  - `tests/world-confirm.test.ts`: only로 뺀 키는 셈이 그대로다. 세던 키도 지워지지 않는다.
  - `tests/world-closer.test.ts`는 `LOOK_VIEW`·`engineFrame`, 바닥만 쓴다. 상자 R = `[120, 90, 240, 180]`이다.
    1. 상자 밖 컵(감지 [60, 300, 40, 20])을 보통 3장으로 확인한다. 보통 2장에서 안 보이면 R 한 번에서 안 보여도 아직 있다. 다음 보통 1장에서 사라짐이 된다(R은 셈을 늘리지도 지우지도 않음).
    2. 사람이 보통 2장으로 보인 뒤 R 세 번에 사람이 없어도 사람은 보인다.
    3. 상자 밖 컵을 보통 2장으로 세는 중(확인 전) R 한 번이 와도 잊지 않는다. 다음 보통 1장에 보이면 등장이다.
    4. R 안 컵(감지 [230, 170, 20, 10]) 세 번 → cup_1 등장이다. 같은 자리를 보통 프레임이 보면 같은 cup_1이다(새 id 없음).
    5. 4 뒤 보통 3장에서 안 보여도 cup_1은 그대로다. 31초 뒤 보통 3장에서 안 보이면 사라짐이다.
    6. 확인된 R 안 컵이 R 세 번 안 보이면 사라짐이다.
    7. R에 사람 상자가 잡혀도 사람 자리·방은 바뀌지 않는다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/world-closer.test.ts`
- [ ] **Step 3: 구현.**

```ts
// src/world/confirm.ts observe 시작
for (const key of new Set([...candidates, ...seen, ...this.streak.keys()])) {
  if (only && !only(key)) continue; // 가까이 보기: 본 것과 잘라 본 상자 안 자리만 본다
  // ...그대로
```

```ts
// src/world/state.ts
/** 가까이 봐서만 찾은 물건은 전체 사진에서 안 보여도 이만큼(ms) 사라짐·시야 밖으로 세지 않는다(전체 사진의 감지기는 그 물건을 못 본다). */
export const CLOSER_HOLD_MS = 30_000;
/** 가까이 보기 한 번(src/observe/pipeline.ts closer): 잘라 본 상자(엔진 프레임 픽셀 [x, y, w, h]). */
export interface DetectionsOptions { region?: [number, number, number, number] }
// Obj에 더함: fullAt·closerAt(전체 사진·가까이 보기로 마지막에 본 촬영 시각, 처음 null)

private visible(obj: Obj, view: EngineFrame["view"], atMs: number): boolean | null {
  if (obj.closerAt !== null && obj.closerAt > (obj.fullAt ?? Number.NEGATIVE_INFINITY) && atMs - obj.closerAt <= CLOSER_HOLD_MS) return null;
  if (!view) return true;
  if (!obj.position) return null;
  return inView(view, obj.position);
}

/** 트윈 자리를 그 프레임에 찍은 점이 잘라 본 상자 안이면 true. 밖이거나 자리·카메라를 모르면 null(이번 셈에서 뺀다). */
private inRegion(obj: Obj | undefined, frame: EngineFrame, region: [number, number, number, number]): true | null {
  if (!obj?.position || !frame.view) return null;
  const p = pixelOf(frame.view, obj.position, frame);
  return p && p[0] >= region[0] && p[0] <= region[0] + region[2] && p[1] >= region[1] && p[1] <= region[1] + region[3] ? true : null;
}

applyDetections(frame: EngineFrame, dets: Detection[], poses?: Pose[], o: DetectionsOptions = {}) {
  const region = o.region ?? null;
  // ...
  // 사람 감지: ids.set(tmp, PERSON); seen.add(PERSON); if (!region) people.push(d);  (잘린 상자는 자리·수에 쓰지 않는다)
  // 물건 감지 끝: if (region) obj.closerAt = Math.max(obj.closerAt ?? at, at); else obj.fullAt = Math.max(obj.fullAt ?? at, at);
  // if (seen.has(PERSON) && !region) { last_seen_ms·count·locatePerson 그대로 }
  const present = [...this.objects.values()].filter((x) => x.confirmed && x.status !== "gone").map((x) => x.id);
  const candidates = this.person.visible && !region ? [...present, PERSON] : present;
  const only = region ? (key: string) => seen.has(key) || (key !== PERSON && this.inRegion(this.objects.get(key), frame, region) === true) : undefined;
  const events = this.confirmer.observe(at, seen, candidates,
    (key) => key === PERSON || (region ? this.inRegion(this.objects.get(key), frame, region) : this.visible(this.objects.get(key)!, view, at)) === true, only);
  // ... 상태 줄
  for (const obj of this.objects.values()) {
    if (!obj.confirmed) {
      if (!seen.has(obj.id) && (!region || this.inRegion(obj, frame, region))) this.forget(obj.id); // 가까이 보기는 상자 안 것만 잊는다
      continue;
    }
    // gone 처리 그대로
    const vis = seen.has(obj.id) ? true : region ? this.inRegion(obj, frame, region) : this.visible(obj, view, at);
    // 이하 그대로(region이면 vis는 true·null뿐이라 시야 밖으로 바꾸지 않는다)
  }
  // 사람 방 그대로(region이면 locatePerson을 부르지 않아 nextRoom이 없다)
  if (poses && !region) this.applyPose(at, poses, boxes, changes);
  return { changes, ids };
}
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/world-state.test.ts tests/world-confirm.test.ts tests/act-track.test.ts`
- [ ] **Step 5: 커밋** `feat(world): count a cropped pass only inside its crop and hold objects found closer`

### Task 4: 잘라 본 사진은 혼자, 요약은 그대로

**Files:**
- Modify: `src/observe/ring.ts:7-21`, `src/observe/scene.ts:55-65`, `src/world/state.ts:470-480`
- Test: `tests/observe-scene.test.ts`, `tests/world-state.test.ts`

**Interfaces:**
- Produces:
  - `EngineFrame.crop?: [number, number, number, number]`: 가까이 보기로 잘라 키운 사진이면 잘라 낸 자리(원래 엔진 프레임 픽셀).
  - `export const CLOSER_NOTE = "This photo is one spot of the latest phone photo, cut out and enlarged 2x. Report only what is visible in it."`
  - `analyzeScene(vlm, frames, dets, signal?, note?: string)`: note가 있으면 texts 맨 앞에 둔다.
  - `applyScene(frameId, capturedAtMs, scene, ids, o?: { summary?: boolean })`: `summary: false`면 장면 요약과 vlm 변화를 건드리지 않는다.

- [ ] **Step 1: 실패 시험.**
  - note를 주면 요청 글이 note 다음 `Detections:` 차례다.
  - `summary: false`면 앞 요약이 그대로이고 vlm 변화가 없지만, 사실은 들어간다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/observe-scene.test.ts tests/world-state.test.ts`
- [ ] **Step 3: 구현.**

```ts
// scene.ts analyzeScene
texts: [...(note ? [note] : []), `Detections: ${JSON.stringify(dets.map((d) => ({ id: d.id, class: d.class, box: d.box.map(Math.round) })))}`],
// state.ts applyScene
if (o.summary !== false && capturedAtMs >= this.summaryAt) { /* 그대로 */ }
```

- [ ] **Step 4: 통과 확인.** 같은 명령
- [ ] **Step 5: 커밋** `feat(observe): analyze a crop alone with a note and keep the scene summary`

### Task 5: 가까이 보기 실행(관찰 흐름)

**Files:**
- Modify: `src/observe/pipeline.ts` (`VlmPool` `:133-144`, `analyze` `:204-226`, `status` `:264-271`, `close` `:280-287`), `src/contract/events.ts:93-97`
- Modify: `tests/helpers/detectors.ts`
- Create: `tests/helpers/look.ts`
- Test: `tests/observe-closer.test.ts`

**Interfaces:**
- Consumes: Task 2~4
- Produces:
  - `events.ts`:
    - `type CloserMiss = "no_frame" | "no_view" | "out_of_view" | "no_detector" | "error" | "closed"`
    - `interface CloserFound { id: string | null; cls: DetLabel; score: number; facts: string[] }`
    - `type CloserResult = { ok: true; frame_id: string; captured_at_ms: number; crop: [number, number, number, number]; frames: number; found: CloserFound[]; summary: string | null; vlm: "ok" | VlmMissing } | { ok: false; why: CloserMiss }`
    - observe 기록에 `closer?: [number, number, number, number]`
  - `pipeline.ts`:
    - `CLOSER_FRAMES = 3`
    - `interface LatestFrame { view: CameraView | null; capturedAtMs: number; width: number; height: number }`
    - `ObservationPipeline.latest(): LatestFrame | null`
    - `closer(spot: LookSpot): Promise<CloserResult>`
    - `PipelineStatus.closer: { looks: number; failed: number; costUsd: number }`
  - `tests/helpers/detectors.ts`: `cropAware(engine: Set<string>, o: { full?: Detection[]; crop: Detection[] }): ScriptedDetector`. engine은 엔진 사진의 sha256이다.
  - `tests/helpers/look.ts`: `closerVlmReply(state = "in_sink"): (body) => string | null`. `CLOSER_NOTE`가 든 장면 요청이면 컵마다 그 state를 답하고, 아니면 null(기본 답).

- [ ] **Step 1: 실패 시험** (`tests/observe-closer.test.ts`)
  - 준비:
    - 가짜 OpenAI(`reply: closerVlmReply()`), `VlmClient`.
    - World State 면은 싱크대 `{ id: "sink_1", label: "싱크대", center: [0.6, 0], top: 0.9, radius: 0.5 }`.
    - 감지기 `cropAware(shas, { crop: [cup 0.72 [220, 160, 40, 20]] })`.
    - 엔진 프레임 e1~e3을 2초 간격으로 넣는다(`LOOK_VIEW`, `frameJpeg(i)`).
  - `closer({ id: "sink_1", label: "싱크대", position: [0.6, 0.9, 0] })`:
    - `{ ok: true, frames: 3, crop: [120, 90, 240, 180], found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: ["in_sink"] }], vlm: "ok" }`
    - World State에 컵이 하나다(cup_1, present, 면 sink_1, place in_sink).
    - VLM 마지막 요청은 사진 1장이고 글에 `CLOSER_NOTE`와 `"box":[220,160,40,20]`가 있다.
    - observe 기록 `frame_id: "e3.c1"`, `boxes: [{ label: "cup", score: 0.72, box: [230, 170, 20, 10] }]`, `frame: { width: 480, height: 360 }`, `closer: [120, 90, 240, 180]`.
    - 장면 요약은 그대로다.
    - `status().closer.looks` 1.
  - 프레임 셋을 더 넣고 다시 보면 컵은 여전히 cup_1 하나다.
  - 실패:
    - 프레임 없음 → `no_frame`.
    - view null 프레임 → `no_view`.
    - 대상 `[-2, 0, 0]` → `out_of_view`.
    - 감지기 null → `no_detector`.
    - `close()` 뒤 → `closed`.
    - 나가 있는 가까이 보기는 close 때 VLM 답 없음으로 끝난다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/observe-closer.test.ts`
- [ ] **Step 3: 구현.**

```ts
// pipeline.ts 생성자: 잘라 본 사진은 혼자 보내고, 답이 오면 기다리는 closer에 넘긴다
this.pool = new VlmPool({
  maxInflight: o.config.vlmMaxInflight, timeoutMs: o.config.vlmTimeoutMs,
  analyze: (f, d, signal) => analyzeScene(o.vlm, f.crop ? [f] : this.ring.window(f, windowFrames, windowFrames * o.config.engineMs), d, signal, f.crop ? CLOSER_NOTE : undefined),
  onResult: (r) => {
    if (this.closed) return;
    const ids = this.idsOf.get(r.frameId) ?? new Map<string, string>();
    this.idsOf.delete(r.frameId);
    const answer = this.answers.get(r.frameId);
    this.answers.delete(r.frameId);
    // 잘라 본 사진의 답은 장면 일부라 장면 요약을 바꾸지 않는다
    const changes = r.scene ? o.world.applyScene(r.frameId, r.capturedAtMs, r.scene, ids, { summary: !answer }) : o.world.applyMissing(r.frameId, r.capturedAtMs, { vlm: r.missing! });
    o.emit({ type: "observe", at_ms: this.clock.now(), frame_id: r.frameId, captured_at_ms: r.capturedAtMs, yolo: null, vlm: r.scene?.summary ?? null, ...(r.missing ? { vlm_missing: r.missing } : {}) });
    this.publish(changes);
    answer?.(r);
  },
});
```

```ts
// pipeline.ts
/** 가까이 보기에 쓰는 최근 엔진 프레임 수: 물건 등장 확인 장수(3장)와 같아 한 번에 새 물건을 확인할 수 있다. */
export const CLOSER_FRAMES = 3;
export interface LatestFrame { view: CameraView | null; capturedAtMs: number; width: number; height: number }

private readonly answers = new Map<string, (r: VlmResult) => void>();
private closerSeq = 0;
private readonly closerCount = { looks: 0, failed: 0, costUsd: 0 };

latest(): LatestFrame | null {
  const f = this.ring.frames().at(-1);
  return f ? { view: f.view, capturedAtMs: f.capturedAtMs, width: f.width, height: f.height } : null;
}

/** 가까이 보기: 고리의 최근 프레임(CLOSER_FRAMES장, 가장 새 프레임에서 3.5 × engineMs 안, 대상이 사진 안)마다 spot을 그 프레임 자세·투영으로 찍어
 *  프레임 절반으로 잘라 키우고 같은 감지기로 본다. 상자를 엔진 프레임 픽셀로 옮겨 촬영 순서대로 한 번에 World State에 넣고(잘라 본 상자 안만 센다),
 *  마지막 장만 VLM 풀에 혼자 보낸다. 같은 촬영 시각·자세라 같은 자리 물건은 같은 id다. */
async closer(spot: LookSpot): Promise<CloserResult> {
  if (this.closed) return { ok: false, why: "closed" };
  const detector = this.o.detector;
  if (!detector) return this.closerMiss("no_detector");
  const ring = this.ring.frames();
  const newest = ring.at(-1);
  if (!newest) return this.closerMiss("no_frame");
  if (!newest.view) return this.closerMiss("no_view");
  if (!inView(newest.view, spot.position, LOOK_MARGIN)) return this.closerMiss("out_of_view");
  const span = (CLOSER_FRAMES + 0.5) * this.o.config.engineMs;
  const picked = ring.filter((f) => f.view && newest.capturedAtMs - f.capturedAtMs <= span && inView(f.view, spot.position, LOOK_MARGIN)).slice(-CLOSER_FRAMES);
  const passes: { frame: EngineFrame; crop: Box; jpeg: Buffer; dets: Detection[] }[] = [];
  try {
    for (const frame of picked) {
      const center = pixelOf(frame.view!, spot.position, frame);
      if (!center) continue;
      const crop = cropBox(center, frame);
      const jpeg = cropJpeg(frame.jpeg, crop, frame);
      const r = await detector.detect(jpeg);
      passes.push({ frame, crop, jpeg, dets: r.detections.filter((d) => this.o.world.accepts(d)) });
    }
  } catch {
    return this.closerMiss("error");
  }
  if (this.closed) return { ok: false, why: "closed" };
  if (!passes.length) return this.closerMiss("out_of_view");
  // 촬영 순서대로 한 번에(await 없이) 넣는다: 사이에 다른 프레임이 끼면 등장 셈이 끊긴다
  const seq = ++this.closerSeq;
  let last!: (typeof passes)[number] & { id: string; ids: Map<string, string> };
  for (const p of passes) {
    const id = `${p.frame.id}.c${seq}`;
    const full = p.dets.map((d) => ({ ...d, box: toFrameBox(d.box, p.crop, p.frame) }));
    const { changes, ids } = this.o.world.applyDetections({ ...p.frame, id }, full, undefined, { region: p.crop });
    this.publish(changes);
    last = { ...p, id, ids };
  }
  this.o.emit({
    type: "observe", at_ms: this.clock.now(), frame_id: last.id, captured_at_ms: last.frame.capturedAtMs, yolo: yoloText(last.dets), vlm: null,
    boxes: last.dets.map(({ label, score, box }) => ({ label, score, box: toFrameBox(box, last.crop, last.frame) })),
    frame: { width: last.frame.width, height: last.frame.height }, closer: last.crop,
  });
  this.idsOf.set(last.id, last.ids);
  const answered = new Promise<VlmResult>((resolve) => this.answers.set(last.id, resolve));
  // VLM은 잘라 키운 사진 한 장이고 상자는 그 사진 픽셀이다
  this.pool.submit({ ...last.frame, id: last.id, jpeg: last.jpeg, sha256: sha256(last.jpeg), crop: last.crop },
    last.dets.map((d, i) => ({ id: `d${i + 1}`, class: d.label, box: d.box, score: d.score })));
  const r = await answered;
  this.closerCount.looks++;
  this.closerCount.costUsd += r.costUsd;
  const said = new Map<string, string[]>();
  for (const ob of r.scene?.observations ?? []) said.set(ob.object_id, [...(said.get(ob.object_id) ?? []), ob.state]);
  return {
    ok: true, frame_id: last.id, captured_at_ms: last.frame.capturedAtMs, crop: last.crop, frames: passes.length,
    found: last.dets.map((d, i) => ({ id: last.ids.get(`d${i + 1}`) ?? null, cls: d.label, score: Math.round(d.score * 100) / 100, facts: said.get(`d${i + 1}`) ?? [] })),
    summary: r.scene?.summary ?? null, vlm: r.missing ?? "ok",
  };
}

private closerMiss(why: CloserMiss): CloserResult {
  this.closerCount.failed++;
  return { ok: false, why };
}
// close(): pool.stop() 뒤 for (const [id, a] of this.answers) a({ frameId: id, capturedAtMs: 0, scene: null, missing: "error", costUsd: 0 }); this.answers.clear();
// status(): closer: { ...this.closerCount, costUsd: Math.round(this.closerCount.costUsd * 1e5) / 1e5 }
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/observe-pipeline.test.ts tests/observe-vlm-pool.test.ts`
- [ ] **Step 5: 커밋** `feat(observe): look closer by cropping the latest engine frames and merging through the same path`

### Task 6: 관찰 모드

**Files:**
- Create: `src/agent/observer.ts`, `tests/helpers/observer.ts`
- Modify: `src/agent/planInput.ts:59` (`worldLines`를 export), `src/contract/events.ts` (`LookTool`·`LookTrigger`), `scripts/fake-openai.ts:56-63` (respond가 Promise도 받음)
- Test: `tests/agent-observer.test.ts`, `tests/fake-openai.test.ts`

**Interfaces:**
- Consumes: `StepOptions.requireTool`·`usage`(Task 1), `LookSpot`(Task 2), `estimateCostUsd`(`src/infer/cost.ts`), `copyRules`(`src/plan/copy.ts`)
- Produces:
  - `events.ts`: `type LookTool = "look_closer" | "ask_person" | "wait"`, `type LookTrigger = "stalled" | "unknown_fact"`
  - `observer.ts`:
    - `OBSERVER_PROMPT`, `OBSERVER_DEFAULTS = { maxRounds: 2, timeoutMs: 15_000, maxOutputTokens: 1000 }`
    - `interface ObserveSituation { trigger: LookTrigger; goal: string; stuckMs: number | null; spots: (LookSpot & { inView: boolean })[]; world: WorldView; earlier: { atMs: number; tool: LookTool; target: string | null; text: string }[]; tools: readonly LookTool[]; nowMs: number }`
    - `type ObserveChoice = { tool: "look_closer"; target: string; reason: string } | { tool: "ask_person"; text: string; reason: string } | { tool: "wait"; reason: string; invalid?: string }`
    - `observerInput(s): string`, `observerTools(tools): ToolDef[]`
    - `class Observer { constructor(o: { provider: LlmProvider; maxRounds?; timeoutMs?; maxOutputTokens? }); decide(s, signal?): Promise<ObserveChoice>; status(): { calls: number; costUsd: number } }`
  - `tests/helpers/observer.ts`:
    - `isObserving(body)`
    - `type ObserveScript = (input: string, round: number) => LlmTurn | undefined`
    - `observerRespond(script)`
    - `startFakeObserver(script, o?: { reply?; gate?: () => Promise<void> })`: `{ env, provider(), bodies(), close() }`. 차례 셈은 `planTurn`(`tests/helpers/planner.ts:62-73`)을 쓴다.

- [ ] **Step 1: 실패 시험** (`tests/agent-observer.test.ts`, `OPENAI_MODEL=gpt-5.4-mini`인 가짜 서버)
  - 요청 모양: `instructions === OBSERVER_PROMPT`, `tool_choice: "required"`, `parallel_tool_calls: false`, 도구 이름은 그 상황의 tools다. 입력 글에 `[확인할 것]`, 「단계가 시작된 지 12초」, `- sink_1 싱크대 · 지금 사진 안`, World State 줄(`- 물건 cup_1 컵 ·`), `[앞서 한 일]`이 있다.
  - `look_closer sink_1` → `{ tool: "look_closer", target: "sink_1" }`.
  - 없는 id나 사진 밖 id → 까닭을 담은 도구 결과(function_call_output)를 받은 둘째 차례의 답을 쓴다.
  - ask_person 글이 「주세요」로 안 끝나거나 괄호가 있으면 다시 묻는다. B(tools에 ask_person 없음)에서 ask_person은 거절한다.
  - 글만 두 번 → `{ tool: "wait", invalid }`.
  - 비용: 가짜 사용량(input 10, output 5) → `status()` `{ calls: 1, costUsd: (10 * 0.75 + 5 * 4.5) / 1e6 }`.
  - `fake-openai.test.ts`: respond가 Promise를 돌려도 답한다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/agent-observer.test.ts tests/fake-openai.test.ts`
- [ ] **Step 3: 구현.**

```ts
// src/agent/observer.ts
// 에이전트 관찰 모드: 비전이 판단할 만큼 못 볼 때 도구 하나(look_closer·ask_person·wait)를 고른다. 계획 모드(src/agent/planner.ts)와 같은 공급자(createProvider).
// 호출마다 새 대화. OpenAI는 도구를 꼭 부르게(required) 하고, Anthropic은 강제가 안 돼 글만 내면 한 번 더 묻는다(최대 maxRounds). 틀린 도구·인자는 까닭을 돌려주고 다시 받는다.
// 도구를 실행하지 않는다: 고른 것만 돌려주고 실행은 src/act/look.ts가 한다. 시험은 같은 OpenAI 공급자를 가짜 서버에 붙인다(tests/helpers/observer.ts).
export const OBSERVER_PROMPT = `너는 이 집 스마트홈 에이전트의 관찰 모드다. 비전(YOLO 감지 + VLM)이 판단할 만큼 잘 보지 못할 때 도구 하나를 골라 부른다.

도구
- look_closer: 폰이 보낸 마지막 사진들에서 target 자리 둘레를 2배로 잘라 같은 감지기·VLM으로 다시 본다. 결과는 World State에 들어간다. target은 [가까이 볼 곳]에서 「지금 사진 안」인 id만 쓴다.
- ask_person: 사람에게 폰으로 가까이 비춰 달라고 부탁한다. 지금 명령 대신 폰에 뜨고 소리로 읽는다. text는 「주세요」로 끝나는 짧은 부탁이다(예: 싱크대 안이 보이게 폰을 가까이 대 주세요). 클로이드가 스스로 하는 말로 쓰지 않는다.
- wait: 아무것도 하지 않고 다음 사진을 기다린다.

고르는 법
- 대상이 지금 사진 안이고 아직 가까이 보지 않았으면 look_closer.
- 대상이 사진 밖이거나 가까이 봐도 못 찾았으면 ask_person(쓸 수 있을 때).
- 사람이 아직 하는 중으로 보이거나 방금 부탁했으면 wait.
- [앞서 한 일]과 같은 일을 같은 결과로 되풀이하지 않는다.
- reason은 왜 그 도구인지 한국어 한 문장. 도구는 하나만 부르고 답 글은 쓰지 않는다.`;

const REASON = z.string().min(1).max(200).describe("왜 이 도구를 고르는지 한국어 한 문장");
const ARGS = {
  look_closer: z.object({ target: z.string().min(1).describe("[가까이 볼 곳]의 id 하나, 지금 사진 안"), reason: REASON }),
  ask_person: z.object({ text: z.string().min(1).max(60).describe("사람에게 하는 짧은 부탁, 「주세요」로 끝남"), reason: REASON }),
  wait: z.object({ reason: REASON }),
} satisfies Record<LookTool, z.ZodObject<z.ZodRawShape>>;
const ABOUT: Record<LookTool, { title: string; description: string }> = {
  look_closer: { title: "가까이 보기", description: "마지막 사진들에서 target 자리를 2배로 잘라 같은 감지기·VLM으로 다시 봅니다. 결과는 World State에 들어갑니다." },
  ask_person: { title: "사람에게 부탁", description: "실제 폰의 지금 명령 자리에 부탁 글을 띄우고 소리로 읽습니다." },
  wait: { title: "기다리기", description: "아무것도 하지 않고 다음 사진을 기다립니다." },
};
export const observerTools = (tools: readonly LookTool[]): ToolDef[] => tools.map((name) => ({
  name, ...ABOUT[name], schema: ARGS[name], readOnly: true, run: async () => ({ ok: false, error: "관찰 모드 도구는 src/act/look.ts가 실행합니다" }),
}));

export function observerInput(s: ObserveSituation): string {
  const sec = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}초`;
  return [
    `[확인할 것] ${s.goal}`,
    s.stuckMs === null ? "- 판단 전에 이 사실을 더 잘 보면 좋다" : `- 단계가 시작된 지 ${sec(s.stuckMs)} 지났는데 끝난 조건이 아직 참이 아니다`,
    "[가까이 볼 곳]",
    ...(s.spots.length ? s.spots.map((p) => `- ${p.id} ${p.label} · ${p.inView ? "지금 사진 안" : "지금 사진 밖"}`) : ["- 없음"]),
    "[World State]", ...worldLines(s.world),
    "[앞서 한 일]",
    ...(s.earlier.length ? s.earlier.map((e) => `- ${sec(s.nowMs - e.atMs)} 전 ${e.tool}${e.target ? ` ${e.target}` : ""} · ${e.text}`) : ["- 없음"]),
    `[쓸 수 있는 도구] ${s.tools.join(", ")}`,
  ].join("\n");
}

/** 도구 호출 하나 → 고른 것, 틀리면 까닭 글. */
function checkChoice(call: ToolCall, s: ObserveSituation): ObserveChoice | string {
  const name = call.name as LookTool;
  if (!s.tools.includes(name)) return `이번에는 ${s.tools.join("·")}만 부릅니다`;
  const a = ARGS[name].safeParse(call.args);
  if (!a.success) return `${name} 인자가 맞지 않습니다: ${a.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "(전체)"} ${i.message}`).join("; ")}`;
  const reason = String(a.data.reason).trim();
  if (name === "look_closer") {
    const spot = s.spots.find((p) => p.id === a.data.target);
    if (!spot) return `[가까이 볼 곳]에 없는 id입니다: ${String(a.data.target)}`;
    if (!spot.inView) return `${spot.id}는 지금 사진 밖이라 가까이 볼 수 없습니다`;
    return { tool: name, target: spot.id, reason };
  }
  if (name === "ask_person") {
    const text = String(a.data.text).trim();
    if (!/주세요$/.test(text)) return "text는 사람에게 하는 부탁이라 「주세요」로 끝나야 합니다. 예: 싱크대 안이 보이게 폰을 가까이 대 주세요";
    const hit = copyRules(text);
    if (hit.length) return `text가 화면 글 규칙(${hit.join(", ")})에 맞지 않습니다`;
    return { tool: name, text, reason };
  }
  return { tool: "wait", reason };
}

const NUDGE = "답 글 대신 도구 하나를 부르세요.";
const NO_CALL = "도구를 부르지 않음";

export class Observer {
  private calls = 0;
  private cost = 0;
  constructor(private readonly o: { provider: LlmProvider; maxRounds?: number; timeoutMs?: number; maxOutputTokens?: number }) {}

  /** 고른 도구 하나. signal이 끊기거나 timeoutMs가 지나면 공급자 요청을 끊고 던진다. */
  async decide(s: ObserveSituation, signal?: AbortSignal): Promise<ObserveChoice> {
    const ac = new AbortController();
    const stop = () => ac.abort();
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, this.o.timeoutMs ?? OBSERVER_DEFAULTS.timeoutMs);
    timer.unref?.();
    try {
      return await this.loop(s, ac.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  private async loop(s: ObserveSituation, signal: AbortSignal): Promise<ObserveChoice> {
    const { provider } = this.o;
    const state = provider.createState();
    provider.addUserMessage(state, observerInput(s));
    const tools = observerTools(s.tools);
    let why = NO_CALL;
    for (let round = 0; round < (this.o.maxRounds ?? OBSERVER_DEFAULTS.maxRounds); round++) {
      signal.throwIfAborted();
      const r = await provider.step(state, { system: OBSERVER_PROMPT, tools, allowTools: true, requireTool: true, signal, maxOutputTokens: this.o.maxOutputTokens ?? OBSERVER_DEFAULTS.maxOutputTokens });
      this.calls++;
      if (r.usage) this.cost += estimateCostUsd(r.usage.model, { prompt: r.usage.input, completion: r.usage.output, cached: r.usage.cached });
      if (!r.calls.length) { why = NO_CALL; provider.addUserMessage(state, NUDGE); continue; }
      const c = checkChoice(r.calls[0]!, s);
      if (typeof c !== "string") return c;
      why = c;
      provider.addToolResults(state, r.calls.map((call) => ({ call, content: JSON.stringify({ ok: false, error: c }), isError: true, result: { ok: false, error: c } })));
    }
    return { tool: "wait", reason: why, invalid: why };
  }

  status(): { calls: number; costUsd: number } {
    return { calls: this.calls, costUsd: Math.round(this.cost * 1e6) / 1e6 };
  }
}
```

```ts
// scripts/fake-openai.ts (respond 형만 넓힌다)
respond?: (body: any) => FakeResponse | null | Promise<FakeResponse | null>;
const r = (await o.respond?.(body)) ?? { text: "가짜 답" };
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/agent-planner.test.ts tests/same-structure.test.ts`
- [ ] **Step 5: 커밋** `feat(agent): add the observation mode that picks look_closer, ask_person or wait`

### Task 7: 멈춘 집기·놓기 단계(A)와 사람 부탁 다시 보내기

**Files:**
- Modify: `src/act/track.ts` (`TrackerOptions` `:46-78`, `TRACK_DEFAULTS` `:81`, `Run` `:90-97`, `tick` `:239-254`, `activate` `:397-413`)
- Test: `tests/act-track.test.ts`. `:233`의 `TRACK_DEFAULTS` 기대값을 고친다.

**Interfaces:**
- Consumes: `LookSpot`(Task 2), `Condition`(`src/world/conditions.ts`)
- Produces:
  - `export interface Stall { planId: string; stepId: string; kind: "pick" | "place"; label: string; command: string; until: Condition; stuckMs: number; looks: number; spots: LookSpot[] }`
  - `TrackerOptions.stalled?: (s: Stall) => boolean`(받았으면 true), `stallMs?`, `stallMax?`
  - `TRACK_DEFAULTS` += `stallMs: 8000, stallMax: 3`
  - `ExecutionTracker.askCloser(planId: string, stepId: string, text: string): boolean`

- [ ] **Step 1: 실패 시험** (`setup({ stalled })`, 컵 계획)
  - 식탁 가기를 「완료」로 넘긴 뒤 집기 단계에서:
    - 7.999초 tick에는 부르지 않는다.
    - 8초에 한 번 부른다(`stepId` `plan:pam-1:2`, `kind: "pick"`, `spots: [{ id: "cup_1", label: "컵", position: [2, 0.75, 1] }]`, `command: "컵을 들어 주세요"`).
    - 바로 다음 tick에는 없고, 16·24초에 다시 부른다. 32초에는 없다(3번까지).
  - 가기 단계는 20초가 지나도 부르지 않는다. 물어보기·기기·기다리기 단계와 until 없는 사람 단계도 부르지 않는다.
  - `stalled`가 false를 돌려주면 세지 않고 다음 tick에 다시 부른다.
  - 다음 단계로 가면 셈과 기준 시각을 다시 잡는다. 놓기 단계 spots는 cup_1과 `{ id: "sink_1", label: "싱크대", position: [5, 0.9, 1] }`이다.
  - `askCloser("plan:pam-1", "plan:pam-1:2", "컵이 보이게 가까이 비춰 주세요")`:
    - 같은 `id`·`step`·`kind: "pick"`·`choices: [완료]`·`target`으로 `text`만 바뀌고 `speak: true`다.
    - 30초 뒤 다시 읽을 때도 새 글이다.
    - 비전 상태만 바뀐 명령도 새 글을 지킨다.
    - 다른 단계·계획·물어보기 중이면 false이고 아무것도 보내지 않는다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/act-track.test.ts`
- [ ] **Step 3: 구현.**

```ts
// Run에 더함: looks: number; lookAt: number;   activate()의 Object.assign에 looks: 0, lookAt: Number.NEGATIVE_INFINITY
// tick(): 시간 초과 검사 뒤, repeat 앞
if (now > r.deadline) return this.timeout(r, step);
this.stall(r, step, now);
if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask") this.repeat(r, now);

/** 집기·놓기 단계의 끝난 조건이 stallMs 넘게 참이 되지 않으면(단계 시작 뒤, 앞 부름 뒤) 관찰 모드를 부른다. 단계마다 stallMax번까지, 받은 것만 센다. */
private stall(r: Run, step: AgentStep, now: number): void {
  if (!this.o.stalled || (step.kind !== "pick" && step.kind !== "place") || !step.until || !r.sent || r.asking) return;
  if (r.looks >= this.cfg.stallMax || now - r.stepAt < this.cfg.stallMs || now - r.lookAt < this.cfg.stallMs) return;
  const s: Stall = {
    planId: r.plan.view.id, stepId: step.id, kind: step.kind, label: step.label, command: r.sent.text, until: step.until,
    stuckMs: now - r.stepAt, looks: r.looks, spots: this.spots(r, step, this.o.world()),
  };
  if (!this.o.stalled(s)) return;
  r.looks++;
  r.lookAt = now;
}

/** 가까이 볼 곳: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때). */
private spots(r: Run, step: AgentStep, world: WorldView): LookSpot[] {
  const out: LookSpot[] = [];
  const id = step.object ?? step.target;
  const obj = id ? ours(r, id, world).find((o) => o.status !== "gone" && o.position) : undefined;
  if (obj?.position) out.push({ id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position });
  const at = step.target ? this.o.locate?.(step.target) : undefined;
  if (step.target && at && step.target !== obj?.id && step.target !== step.object) out.push({ id: step.target, label: this.placeName(step.target), position: at.position });
  return out;
}

/** 관찰 모드의 사람 부탁(ask_person): 지금 그 계획의 그 사람 단계면 같은 id·단계로 글만 바꿔 다시 보낸다(소리로 읽음). 그 뒤 다시 읽기·비전 상태도 이 글이다. */
askCloser(planId: string, stepId: string, text: string): boolean {
  const r = this.run;
  const step = r ? this.stepOf(r) : undefined;
  if (this.stopped || !r || r.state !== "running" || r.asking || !r.sent || !step || r.plan.view.id !== planId || step.id !== stepId || !HUMAN_KINDS.includes(step.kind)) return false;
  r.spokeAt = this.clock.now();
  r.sent = { ...r.sent, text, speak: true };
  this.o.toPhone(r.sent);
  return true;
}
```

영상 모드는 단계 영상을 `id:step`으로 한 번만 바꾸므로(`ui/src/phone/core/video-ar.js:411`) 새 단계로 보지 않는다. 명령 기록(`video-ar.js:80-85`)에는 글이 달라 한 줄이 남는다.

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/agent-planner.test.ts tests/noonchi-e2e.test.ts`
- [ ] **Step 5: 커밋** `feat(act): call the observer when a pick or place step stalls and resend the step with the person ask`

### Task 8: 보기 담당(A·B 한 번에 하나, 기록)

**Files:**
- Create: `src/act/look.ts`
- Modify: `src/act/tasks.ts:14-22` (`look`·`lookTargets`), `src/plan/labels.ts` (`LOOK_TEXT`), `src/contract/events.ts` (BrainLog `look`·`LookResult`)
- Create: `tests/helpers/look.ts`(`testCloser`), Test: `tests/act-look.test.ts`, `tests/act-tasks.test.ts`

**Interfaces:**
- Consumes: `Observer`(Task 6), `closer`·`latest`(Task 5), `Stall`·`askCloser`(Task 7)
- Produces:
  - `TaskSpec.look?: readonly Facet[]`. 「컵 치우기」는 `["contents"]`이다. `lookTargets(): { cls: ObjClass; facets: readonly Facet[] }[]`
  - `type LookResult = CloserResult | { sent: boolean }`
  - BrainLog `{ type: "look"; at_ms: number; trigger: LookTrigger; target: string | null; tool: LookTool; reason: string; text: string; result: LookResult | null; plan_id?: string; step_id?: string }`
  - `LOOK_TEXT`:
    - `closer(place, seen)` → 「싱크대 쪽을 가까이 봄 · 컵 보임」
    - `seen(names)` → 「컵 보임」, 없으면 「찾은 것 없음」
    - `miss[CloserMiss]`, `vlmMissing` 「VLM 답 없음」
    - `asked(text)` → 「가까이 비춰 달라고 부탁함 · …」, `notSent` 「단계가 바뀌어 부탁하지 않음」
    - `waited(place)` → 「싱크대 쪽은 기다림」
  - `LOOK_DEFAULTS = { objectGapMs: 30_000, gapMs: 10_000, frameFreshMs: 10_000, keep: 5 }`
  - `class Looker`:
    - `constructor(o: LookerOptions)`
    - `stalled(s: Stall): boolean`, `tick(): void`
    - `status(): { calls: number; costUsd: number; looks: number; asks: number; waits: number }`
    - `stop(): void`, `idle(): Promise<void>`
  - `LookerOptions`:
    - `{ observer: Pick<Observer, "decide" | "status">; closer(spot: LookSpot): Promise<CloserResult>; frame(): LatestFrame | null; world(): WorldView;`
    - `askPerson(planId, stepId, text): boolean; emit(l: BrainLog): void; targets(): readonly { cls: ObjClass; facets: readonly Facet[] }[];`
    - `aim?(spot: LookSpot): [number, number, number]; onLook?(spot: LookSpot): void; clock?; objectGapMs?; gapMs? }`

- [ ] **Step 1: 실패 시험** (`tests/act-look.test.ts`)
  - 준비: 진짜 `Observer`를 `startFakeObserver`에 붙인다. `frame()`은 `{ view: LOOK_VIEW, capturedAtMs: now, width: 480, height: 360 }`이다. 컵 cup_1은 `[1.5, 0, 0]` present이고 사실이 없다.
  - B 부름:
    - tick 한 번 → 관찰 요청 하나(tools `look_closer, wait`, 입력에 `cup_1`·「지금 사진 안」)와 `look` 기록 하나(`trigger: "unknown_fact"`, 대본 wait → 「컵 쪽은 기다림」).
    - 29초에는 없고, 30초에는 있다.
    - 다른 컵(cup_2)이어도 10초 안이면 없다.
  - B를 부르지 않는 경우: contents가 empty, status out_of_view, 이미 in_sink, 대상 종류가 아님(book), 프레임이 10초 넘게 낡음, view 없음.
  - A 먼저:
    - B 요청을 `gate`로 붙잡은 채 `stalled(stall)`을 부르면 true다. B 요청은 끊기고 B 기록은 없다. A 대본 `ask_person` → `askPerson("plan:pam-1", "plan:pam-1:4", "싱크대 안이 보이게 폰을 가까이 대 주세요")`이 불리고, 기록 「가까이 비춰 달라고 부탁함 · 싱크대 안이 보이게 폰을 가까이 대 주세요」(`plan_id`·`step_id`)가 남는다.
    - A가 도는 동안 `stalled`는 false이고 tick은 아무것도 하지 않는다.
    - B가 잘라 보는 중(`testCloser`를 붙잡음)이면 `stalled`는 false다.
  - look_closer:
    - 대본 `look_closer sink_1` → `closer`가 `aim`이 준 윗면 자리로 불린다.
    - 기록 「싱크대 쪽을 가까이 봄 · 컵 보임」의 `result.found`, `onLook`이 한 번 불린다.
    - 같은 단계의 다음 요청 입력 `[앞서 한 일]`에 그 글과 `cup_1 0.72 in_sink`가 있다.
  - 관찰 모드가 실패(가짜 서버 닫음)하면 「… 쪽은 기다림」 기록(`reason` 「관찰 모드 호출 실패: …」)이 남는다.
  - `tests/act-tasks.test.ts`: `lookTargets()` = `[{ cls: "cup", facets: ["contents"] }]`.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/act-look.test.ts tests/act-tasks.test.ts`
- [ ] **Step 3: 구현.**

```ts
// src/act/look.ts
// 관찰 모드 부르기(src/agent/observer.ts)와 고른 도구 실행. 한 번에 하나만 돈다.
// A 멈춘 단계(실행 추적 stalled): 집기·놓기 단계가 안 끝남 → look_closer·ask_person·wait.
// B 판단 전 보기(판단 타이머 tick): 행동 대상 종류 물건이 사진 안에 있는데 볼 면(TaskSpec.look)을 모름 → look_closer·wait. PAM 판단을 막지 않는다.
// A가 먼저다: B가 관찰 모드를 부르는 중이면 끊고 A를 돌린다. B가 잘라 보는 중이면 A를 받지 않는다(실행 추적이 다음 tick에 다시 부른다).
// 고를 때마다 look 기록 하나. look_closer 결과는 관찰 흐름이 World State에 넣는다(다음 PAM 판단과 단계 조건이 그것을 본다).
export const LOOK_DEFAULTS = { objectGapMs: 30_000, gapMs: 10_000, frameFreshMs: 10_000, keep: 5 } as const;

interface Job {
  trigger: LookTrigger; key: string; goal: string; stuckMs: number | null; spots: LookSpot[]; tools: LookTool[];
  planId?: string; stepId?: string; abort: AbortController; phase: "observer" | "act";
}
type Earlier = ObserveSituation["earlier"][number];

export class Looker {
  private job: Job | null = null;
  private readonly running = new Set<Promise<void>>();
  private readonly lookedAt = new Map<string, number>();
  private readonly earlier = new Map<string, Earlier[]>();
  private readonly count = { looks: 0, asks: 0, waits: 0 };
  private lastB = Number.NEGATIVE_INFINITY;
  private stopped = false;
  private readonly clock: { now(): number };
  private readonly cfg: { objectGapMs: number; gapMs: number };
  constructor(private readonly o: LookerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.cfg = { objectGapMs: o.objectGapMs ?? LOOK_DEFAULTS.objectGapMs, gapMs: o.gapMs ?? LOOK_DEFAULTS.gapMs };
  }

  stalled(s: Stall): boolean {
    if (this.stopped) return false;
    if (this.job) {
      if (this.job.trigger === "stalled" || this.job.phase !== "observer") return false;
      this.job.abort.abort();
      this.job = null;
    }
    this.start({
      trigger: "stalled", key: `${s.planId}:${s.stepId}`, goal: `${s.label} 단계 · 지금 명령 「${s.command}」 · 끝난 조건 ${JSON.stringify(s.until)}`,
      stuckMs: s.stuckMs, spots: s.spots, tools: ["look_closer", "ask_person", "wait"], planId: s.planId, stepId: s.stepId,
    });
    return true;
  }

  tick(): void {
    if (this.stopped || this.job) return;
    const now = this.clock.now();
    if (now - this.lastB < this.cfg.gapMs) return;
    const latest = this.o.frame();
    if (!latest?.view || now - latest.capturedAtMs > LOOK_DEFAULTS.frameFreshMs) return;
    const wants = this.o.targets();
    for (const o of wants.length ? this.o.world().objects : []) {
      const want = wants.find((t) => t.cls === o.cls);
      if (!want || o.status !== "present" || !o.position || putAway(o)) continue;
      if (now - (this.lookedAt.get(o.id) ?? Number.NEGATIVE_INFINITY) < this.cfg.objectGapMs) continue;
      const facet = want.facets.find((f) => { const v = o.facts[f]?.value; return !v || UNKNOWN_STATES.includes(v as StateKey); });
      if (!facet) continue;
      const spot: LookSpot = { id: o.id, label: OBJECT_NAME[o.cls] ?? o.cls, position: o.position };
      if (!inView(latest.view, this.aim(spot), LOOK_MARGIN)) continue;
      this.lastB = now;
      this.start({ trigger: "unknown_fact", key: o.id, goal: `${spot.label} ${o.id}의 ${facet}을 모름 · 판단 전에 더 잘 보기`, stuckMs: null, spots: [spot], tools: ["look_closer", "wait"] });
      return;
    }
  }

  private aim(spot: LookSpot): [number, number, number] {
    return this.o.aim?.(spot) ?? spot.position;
  }

  private start(j: Omit<Job, "abort" | "phase">): void {
    const job: Job = { ...j, abort: new AbortController(), phase: "observer" };
    this.job = job;
    const now = this.clock.now();
    for (const p of job.spots) this.lookedAt.set(p.id, now);
    const p: Promise<void> = this.run(job).catch(() => {}).finally(() => {
      if (this.job === job) this.job = null;
      this.running.delete(p);
    });
    this.running.add(p);
  }

  private async run(job: Job): Promise<void> {
    const latest = this.o.frame();
    const spots = job.spots.map((p) => {
      const position = this.aim(p);
      return { ...p, position, inView: !!latest?.view && inView(latest.view, position, LOOK_MARGIN) };
    });
    const situation: ObserveSituation = {
      trigger: job.trigger, goal: job.goal, stuckMs: job.stuckMs, spots, world: this.o.world(), earlier: this.earlier.get(job.key) ?? [], tools: job.tools, nowMs: this.clock.now(),
    };
    let choice: ObserveChoice;
    try {
      choice = await this.o.observer.decide(situation, job.abort.signal);
    } catch (e) {
      if (job.abort.signal.aborted || this.stopped) return;
      choice = { tool: "wait", reason: `관찰 모드 호출 실패: ${describeError(e)}`.slice(0, 200), invalid: "error" };
    }
    if (job.abort.signal.aborted || this.stopped) return;
    job.phase = "act";
    const spot = choice.tool === "look_closer" ? spots.find((p) => p.id === choice.target)! : spots[0] ?? null;
    let text: string;
    let detail = "";
    let result: LookResult | null = null;
    if (choice.tool === "look_closer") {
      this.o.onLook?.(spot!);
      const r = await this.o.closer({ id: spot!.id, label: spot!.label, position: spot!.position }).catch((): CloserResult => ({ ok: false, why: "error" }));
      result = r;
      this.count.looks++;
      text = LOOK_TEXT.closer(spot!.label, closerText(r));
      if (r.ok) detail = r.found.map((f) => `${f.id ?? f.cls} ${f.score} ${f.facts.join(" ")}`.trim()).join(", ");
    } else if (choice.tool === "ask_person") {
      const sent = !!job.planId && !!job.stepId && this.o.askPerson(job.planId, job.stepId, choice.text);
      result = { sent };
      this.count.asks++;
      text = sent ? LOOK_TEXT.asked(choice.text) : LOOK_TEXT.notSent;
    } else {
      this.count.waits++;
      text = LOOK_TEXT.waited(spot?.label ?? "");
    }
    if (this.stopped) return;
    const at = this.clock.now();
    const target = spot?.id ?? null;
    const list = [...(this.earlier.get(job.key) ?? []), { atMs: at, tool: choice.tool, target, text: detail ? `${text} · ${detail}` : text }];
    this.earlier.set(job.key, list.slice(-LOOK_DEFAULTS.keep));
    this.o.emit({
      type: "look", at_ms: at, trigger: job.trigger, target, tool: choice.tool, reason: choice.reason, text, result,
      ...(job.planId ? { plan_id: job.planId, step_id: job.stepId } : {}),
    });
  }

  status() { return { ...this.o.observer.status(), ...this.count }; }
  stop(): void { this.stopped = true; this.job?.abort.abort(); }
  async idle(): Promise<void> { while (this.running.size) await Promise.all([...this.running]); }
}

/** 가까이 본 결과 한 마디: 찾은 물건 이름(사람·가전 설비는 빼고), 못 봤으면 까닭, VLM 답이 없으면 덧붙인다. */
function closerText(r: CloserResult): string {
  if (!r.ok) return LOOK_TEXT.miss[r.why];
  const seen = LOOK_TEXT.seen(r.found.filter((f) => CLASSES[f.cls as ClassKey]?.role === "object").map((f) => OBJECT_NAME[f.cls] ?? f.cls));
  return r.vlm === "ok" ? seen : `${seen} · ${LOOK_TEXT.vlmMissing}`;
}
```

```ts
// src/plan/labels.ts
/** 관찰 모드 기록 글(src/act/look.ts, 기록 종류 look). */
export const LOOK_TEXT = {
  closer: (place: string, seen: string) => `${place} 쪽을 가까이 봄 · ${seen}`,
  seen: (names: readonly string[]) => (names.length ? `${[...new Set(names)].join("·")} 보임` : "찾은 것 없음"),
  miss: { no_frame: "사진이 없어 못 봄", no_view: "카메라를 맞추기 전이라 못 봄", out_of_view: "사진 밖이라 못 봄", no_detector: "감지기가 없어 못 봄", error: "감지 오류로 못 봄", closed: "멈춰서 못 봄" },
  vlmMissing: "VLM 답 없음",
  asked: (text: string) => `가까이 비춰 달라고 부탁함 · ${text}`,
  notSent: "단계가 바뀌어 부탁하지 않음",
  waited: (place: string) => `${place} 쪽은 기다림`,
};
```

- [ ] **Step 4: 통과 확인.** 같은 명령, 그리고 `npm run lint`(새 글)와 `npm run typecheck`
- [ ] **Step 5: 커밋** `feat(act): run one observer call at a time for stalled steps and unknown facts`

### Task 9: 흐름 시험(놓기 단계가 가까이 보기로 넘어감)

**Files:**
- Test: `tests/look-flow.test.ts` (새)

**Interfaces:**
- Consumes: Task 2~8. 진짜 `WorldState`·`ObservationPipeline`·`ExecutionTracker`·`Planner`·`Observer`·`Looker`를 쓴다.
- 가짜 OpenAI 하나에 붙인다: `respond: (b) => plannerRespond(CUP_SCRIPTS)(b) ?? observerRespond(() => [["look_closer", { target: "sink_1", reason: "싱크대 안을 더 보려고" }]])(b)`, `reply: closerVlmReply()`.

- [ ] **Step 1: 실패 시험.**
  - 「놓기 단계에서 전체 사진은 싱크대 안 컵을 못 봐도, 8초 뒤 관찰 모드가 고른 가까이 보기가 세 장에서 컵을 찾고 VLM이 싱크대 안이라 답해 「완료」 없이 계획이 끝난다」
  - 카메라는 `LOOK_VIEW`이고 면은 싱크대 `center [0.6, 0], top 0.9`, `locate(sink_1) = { label: "싱크대", position: [0.6, 0.9, 0] }`이다. 평면도는 `smallFloor`, 승인은 미리 받아 둔다. 감지기는 `cropAware`, 시계 하나를 넷이 같이 쓴다.
  - 차례:
    1. 엔진 프레임 3장(컵 [60, 300, 40, 20]) → cup_1.
    2. 판단 → 계획 → 1~3단계 「완료」.
    3. 놓기 단계에서 컵 없는 엔진 프레임 3장(2초 간격) → cup_1 사라짐.
    4. 시계 +8초 → `tracker.tick()` → `looker.idle()`.
  - 기대:
    - 마지막 폰 메시지가 `command_clear`이고 실행 기록이 `done`이다.
    - World State cup_2의 place는 in_sink다.
    - `look` 기록 하나: `trigger: "stalled"`, `tool: "look_closer"`, 「싱크대 쪽을 가까이 봄 · 컵 보임」.
    - 4단계 「완료」는 누르지 않았다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/look-flow.test.ts`. 앞 Task가 다 들어가 있으면 바로 통과할 수 있다. 그때는 `stalled`를 빼고 돌려 4단계가 안 끝나는지 먼저 본다.
- [ ] **Step 3: 구현.** 시험만 있다. 실패하면 `systematic-debugging`으로 원인을 찾는다. 셈을 바꿔 맞추지 않는다.
- [ ] **Step 4: 통과 확인.** 같은 명령
- [ ] **Step 5: 커밋** `test(look): place step passes by a closer look when full frames miss the cup`

### Task 10: 기록 종류 look

**Files:**
- Modify: `src/contract/history.ts:7-9`, `src/history/db.ts:11-13`, `src/history/recorder.ts:55-86`
- Test: `tests/history-db.test.ts`, `tests/history-api.test.ts`

**Interfaces:**
- Produces: `HistoryKind`에 `"look"`, `HISTORY_KINDS`에 `"look"`. 기록 줄 `{ kind: "look", subject: target, text, data: { trigger, target, tool, reason, result, plan_id, step_id } }`.

- [ ] **Step 1: 실패 시험.**
  - `subs.brain!({ type: "look", ... })` → `db.list({ kinds: ["look"] })[0]`가 `{ subject: "sink_1", text: "싱크대 쪽을 가까이 봄 · 컵 보임", data: { trigger: "stalled", tool: "look_closer", result: { ok: true } } }`와 맞는다.
  - `/api/history?kinds=look`은 200이다.
  - 하루 요약(`src/history/summary.ts`)에는 넣지 않는다(종류 목록 그대로).
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/history-db.test.ts tests/history-api.test.ts`
- [ ] **Step 3: 구현.**

```ts
// recorder.ts onBrain switch
case "look":
  db.add("look", l.at_ms, l.text, {
    subject: l.target ?? undefined,
    data: { trigger: l.trigger, target: l.target, tool: l.tool, reason: l.reason, result: l.result, plan_id: l.plan_id ?? null, step_id: l.step_id ?? null },
  });
  return;
```

- [ ] **Step 4: 통과 확인.** 같은 명령
- [ ] **Step 5: 커밋** `feat(history): record closer looks and person asks as look rows`

### Task 11: 말풍선 카드의 가까이 보기 줄

**Files:**
- Modify: `src/act/say.ts:17-34`, `src/plan/labels.ts:24-38`
- Test: `tests/act-say.test.ts`

**Interfaces:**
- Produces: `SAY_TEXT.closer(place)` → 「싱크대를 가까이 보고 있어요.」, `SAY_LOOK_MS = 6000`, `sayLine({ ..., look?: { place: string; atMs: number } | null })`

- [ ] **Step 1: 실패 시험.**
  - 계획이 있든 없든 `look`이 6초 안이면 「싱크대를 가까이 보고 있어요.」다.
  - 6초가 지나면 앞 글(명령·지켜보기)로 돌아간다.
  - 승인 질문 중에도 같다(질문 글은 대시보드에 안 보임).
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/act-say.test.ts`
- [ ] **Step 3: 구현.**

```ts
export const SAY_LOOK_MS = 6000;
export function sayLine({ plan, command, world, nowMs, look = null }: { plan: PlanView | null; command: PlannedCommandMessage | null; world: WorldView | null; nowMs: number; look?: { place: string; atMs: number } | null }): string {
  if (look && nowMs - look.atMs <= SAY_LOOK_MS) return SAY_TEXT.closer(look.place);
  // 이하 그대로
}
// labels.ts SAY_TEXT
closer: (place: string) => `${josa(place, "을/를")} 가까이 보고 있어요.`,
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run lint`
- [ ] **Step 5: 커밋** `feat(act): say the closer look on the dashboard card`

### Task 12: 서버에 묶기

**Files:**
- Modify: `src/server/home.ts` (`:126-137` 면, `:166-172` 공급자·계획, `:222`·`:253-258` 말풍선, `:285-307` 실행 추적, `:309-334` 관찰 흐름·타이머, `:350` 앱, `:447` 닫기)
- Test: `tests/observe-start.test.ts`

**Interfaces:**
- Consumes: Task 5~11
- Produces: `GET /api/brain`에 `closer: { looks, failed, costUsd }`와 `look: { calls, costUsd, looks, asks, waits } | null`.

- [ ] **Step 1: 실패 시험.** BRAIN=1 서버의 `/api/brain`에 `closer: { looks: 0, failed: 0, costUsd: 0 }`, `look: { calls: 0, costUsd: 0, looks: 0, asks: 0, waits: 0 }`가 있다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/observe-start.test.ts`
- [ ] **Step 3: 구현.**

```ts
// 관찰 모드(src/agent/observer.ts): 잘 못 볼 때 가까이 보기·사람 부탁·기다리기 중 하나. 말 요청·계획 모드와 같은 공급자
const observer = new Observer({ provider });
// 트윈 윗면: World State와 가까이 볼 점이 같이 쓴다
const surfaces = surfaceSource(layout?.editor);
// new WorldState({ surfaces, ... })
let looker: Looker | null = null;
let lookSay: { place: string; atMs: number } | null = null;
speak = () => {
  const text = sayLine({ plan: plans.current(), command, world: world?.view(nowMs()) ?? null, nowMs: Date.now(), look: lookSay });
  // 그대로
};
tracker = new ExecutionTracker({ /* 그대로 */ stalled: (s) => looker?.stalled(s) ?? false });
// pipeline 만든 뒤
looker = new Looker({
  observer, closer: (spot) => observed.closer(spot), frame: () => observed.latest(), world: () => world.view(now()),
  askPerson: (planId, stepId, text) => tracking.askCloser(planId, stepId, text), emit, targets: lookTargets, clock: ctx.brain?.clock,
  // 자리(싱크대·식탁)는 윗면 가운데를 본다: 배치 가운데는 걸은 자세에서 사진 밖일 수 있다
  aim: (spot) => { const s = surfaces().find((x) => x.id === spot.id); return s ? [s.center[0], s.top, s.center[1]] : spot.position; },
  onLook: (spot) => { lookSay = { place: spot.label, atMs: Date.now() }; speak(); },
});
const looking = looker;
decideTimer = setInterval(() => { observed.tick(); decide.tick(); tracking.tick(); looking.tick(); speak(); }, 250);
// createApp
brain: observe ? { status: () => ({ ...observe.status(), look: looker?.status() ?? null }) } : undefined,
// close 「관찰 흐름」: tracker?.stop(); looker?.stop(); planner.abort(); ...
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts tests/mokryeon-e2e.test.ts tests/vision-e2e.test.ts tests/video-mode-e2e.test.ts`, `npm run typecheck`. e2e에서 B가 가짜 서버에 관찰 요청을 보내 「가짜 답」 → 기다리기가 되는 것은 맞는 동작이다. 요청 수를 세는 시험이 깨지면 `isObserving` 요청을 빼고 센다.
- [ ] **Step 5: 커밋** `feat(server): wire the observation mode, the closer look and the look card`

### Task 13: 판정 도구의 「가까이 보기」 줄과 비용

**Files:**
- Modify: `scripts/video-check.ts` (`:47` 기록 종류, `:54` `Kind`, `:72-116` `timeline`, `:199` `BrainNow`, `:505` 비용 줄)
- Test: `tests/video-check.test.ts`

**Interfaces:**
- Produces:
  - `HISTORY_KINDS = "detection,decision,plan,execution,look"`, `Kind`에 「가까이 보기」.
  - `costLine(brain: BrainNow): string` → 「VLM 54장 · $0.0301 · 가까이 보기 1번 · 관찰 모드 2번 $0.0016 · 엔진 프레임 54장 · PAM·계획 비용 빠짐」.

- [ ] **Step 1: 실패 시험.**
  - `timeline`이 `look` 기록을 「가까이 보기」 줄로 넣는다(같은 글이 이어지면 묶음).
  - `costLine`이 `closer`·`look`이 없으면 앞 글 그대로, 있으면 위 모양이다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/video-check.test.ts`
- [ ] **Step 3: 구현.**

```ts
} else if (h.kind === "look") {
  raw.push({ ms, kind: "가까이 보기", text: h.text, n: 1, from: "look" });
}
type BrainNow = { frames?: number; vlm?: { sent?: number; costUsd?: number }; closer?: { looks?: number }; look?: { calls?: number; costUsd?: number } | null } | null;
export function costLine(brain: BrainNow): string {
  if (!brain?.vlm) return "VLM 비용 모름(/api/brain 없음)";
  const closer = brain.closer ? ` · 가까이 보기 ${brain.closer.looks ?? 0}번` : "";
  const look = brain.look ? ` · 관찰 모드 ${brain.look.calls ?? 0}번 $${(brain.look.costUsd ?? 0).toFixed(4)}` : "";
  return `VLM ${brain.vlm.sent ?? 0}장 · $${(brain.vlm.costUsd ?? 0).toFixed(4)}${closer}${look} · 엔진 프레임 ${brain.frames ?? 0}장 · PAM·계획 비용 빠짐`;
}
```

- [ ] **Step 4: 통과 확인.** 같은 명령, `npm run heavy -- npx tsx scripts/video-check.ts --clip cup-demo.mp4 --fake`(앞 동작 그대로, 「가까이 보기」 기다리기 줄이 생겨도 스스로 시험은 맞음)
- [ ] **Step 5: 커밋** `feat(video): show look rows and the observer cost in the checker`

### Task 14: 실제 판정·문서

- [ ] **Step 1: 전체 확인.** `npm run typecheck`, `npm run lint`, `npm run heavy -- npm test`
- [ ] **Step 2: 실제 판정.** 서버·PAM을 새로 띄우고(`.env` 그대로: VLM·PAM `gpt-5.4-nano`, 에이전트 `gpt-5.4-mini`) 돌린다.
  `npm run heavy -- npx tsx scripts/video-check.ts --clip home-idle.mp4 --step go:table:home-go-table.mp4 --step pick:cup:home-pick.mp4 --step go:sink:home-go-sink.mp4 --step place:sink:home-place.mp4 --expect-after 27.8`
- [ ] **Step 3: 결과 확인.** 놓기 단계 시작 약 8초 뒤 「가까이 보기 · 싱크대 쪽을 가까이 봄 · 컵 보임」, 「컵 내려놓기 끝남」, 단계 4/4, 누른 단추 0번, 비용 줄이 나와야 한다. 지금은 3/4다. 안 되면 셈을 바꾸기 전에 아래 차례로 본다.
  - 찾은 것 없음: `look` 기록 `result.crop`이 컵 자리와 맞는지 본다(`DATASET_COLLECT=1`로 엔진 프레임을 남겨 같은 자리를 잘라 본다).
  - 컵은 보이는데 단계가 안 끝남: VLM 사실이 in_sink가 아니면 VLM 판단이다(앞 판정: 수전 아래 머그를 손에 있음·식탁 위로 봄). 규칙으로 고치지 않고 적는다.
  - 판단 전 보기(B)가 식탁 컵 안을 보여 PAM이 컵 치우기를 안 고르면, 정보가 늘어서이지 고장이 아니다. 앞 판정 줄과 견줘 적는다.
- [ ] **Step 4: 문서.**
  - `docs/reference.md`: `/api/brain` `closer`·`look`(`:196`), `/api/history` 종류 `look`, BrainLog `look`·observe `closer`(`:430`), 관찰 흐름·실행 절에 「가까이 보기·관찰 모드」 한 절(A·B 기준, 3장·2배·윗면, 30초 지킴, 비용).
  - README 영상 판정 절에 「가까이 보기」 줄과 비용 줄.
- [ ] **Step 5: trail.** `trail note`로 실제 판정 결과(자른 자리, 점수, VLM 답, 걸린 시간, 비용)와 버린 길(한 장 자르기는 등장 3장 규칙 때문에 안 됨, 배치 가운데는 사진 밖)을 남긴다. `trail check`.
- [ ] **Step 6: 커밋** `docs: describe the closer look and the observation mode`
