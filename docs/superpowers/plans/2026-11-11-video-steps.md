# 영상 모드 단계 영상 계획 (컵 치우기 네 단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 영상 모드에서 명령이 오면 사람이 그 명령을 따르는 영상으로 바꿔 튼다. 「완료」를 누르지 않아도 시스템이 비전·폰 위치로 단계를 넘기는지, 트윈(눈 자리·컵)이 따라 바뀌는지 판정한다.

**구조:**
- 실제 폰에 가는 사람 단계 명령에 단계 종류(`kind`: go·pick·place)를 싣는다.
- 폰 영상 모드 주소에 `step=<종류>:<대상 낱말>:<영상>`을 여러 개 붙인다. 명령의 종류가 같고 대상 id에 낱말이 들어 있으면, 1.5초 뒤 그 영상으로 바꿔 튼다.
- go 단계 영상을 트는 동안 폰 자세가 대상 쪽으로 초당 0.8m 걸어가 대상 0.6m 앞에서 멈추고 대상을 본다. 영상에는 위치 추적이 없어 자세를 페이지가 옮긴다.
- 판정 도구가 1초마다 `/api/world`를 읽어 트윈 줄(눈 방·자리, 컵 자리·놓인 곳)을 시각표에 넣고, 끝에 대시보드 사진을 남긴다.

**기술:** Node 22 TypeScript 서버, React 폰(`ui/`), Vitest, 헤드리스 크롬(CDP), ffmpeg(단계 영상 만들기만).

**출처:** 사용자 11-11 「AI가 지시한 행동 다음에 이어질만한 것들도 영상 가져와서 제대로 지시하고 확인하고 트윈 동기화 하는지도 해보자」

## 지켜야 할 것

- 저장소 `CLAUDE.md` 규칙 표 전부. 특히 mock·live 같은 구조, 규칙으로 계획 만드는 코드 없음, 화면 글 규칙, 무거운 일은 `npm run heavy`로 하나씩.
- 실제 모델 비용은 이번 일 전체 1달러 안(지금까지 약 $0.15).
- 단계 영상은 `runtime/videos/`에 두고 커밋하지 않는다.
- 단계를 넘기는 판단은 서버(실행 추적·World State 조건)가 한다. 폰 페이지는 영상과 자세만 바꾼다.

## 단계 영상 (Pexels, 720×1280 25fps로 맞춤)

| 단계 | 영상 | 원본 |
|---|---|---|
| go 식탁 | `go-table.mp4` | `cup-empty.mp4` 마지막 장면을 3초 동안 1.6배로 다가가게 키움 + 20초 멈춤 |
| pick 컵 | `pick-cup.mp4` | Pexels 10568206 0~3.0초(손이 같은 빈 컵을 듦) + 3.0초 장면 15초 멈춤 |
| go 싱크대 | `go-sink.mp4` | Pexels 5965451(바닥을 보며 걷는 1인칭) + 10초 멈춤 |
| place 싱크대 | `place-sink.mp4` | Pexels 19548448 3~10초(싱크대 수전 아래 머그) + 20초 멈춤 |

YOLO 확인(이 저장소 감지기): pick 장면 컵 0.92~0.94·손 0.42~0.72, place 장면 컵 0.86~0.90. Pexels에 「컵을 싱크대에 내려놓는」 영상이 없어 place는 수전 아래 머그로 한다. 싱크대 안으로 볼지는 VLM이 정한다.

---

### Task 1: 명령에 단계 종류 싣기

**Files:**
- Modify: `src/contract/phone.ts` (`PhoneStepKind`, `PhoneCommand.kind?`)
- Modify: `src/act/track.ts` `show()`
- Test: `tests/act-track.test.ts`

**Interfaces:**
- Produces: `export type PhoneStepKind = "go" | "pick" | "place"`, `PhoneCommand.kind?: PhoneStepKind`(사람 단계 명령에만, 질문·승인·알림에는 없음). 폰 서버 `wire`는 spread로 그대로 넘긴다.

- [ ] **Step 1: 실패 시험.** `tests/act-track.test.ts` 컵 치우기 네 명령 시험에 보낸 명령의 `kind`가 차례로 `go, pick, go, place`이고, 승인 질문 명령에는 `kind`가 없음을 더한다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/act-track.test.ts` → kind undefined로 실패.
- [ ] **Step 3: 구현.**

```ts
// src/contract/phone.ts
/** 사람 단계 종류: 가기·집기·놓기. */
export type PhoneStepKind = "go" | "pick" | "place";
// PhoneCommand 안
  /** 사람 단계 명령의 단계 종류. 질문·승인·알림에는 없다. 영상 모드가 단계 영상을 고를 때 쓴다. */
  kind?: PhoneStepKind;
```

```ts
// src/act/track.ts show()
r.sent = {
  type: "command", id: r.plan.view.id, step: step.id, ...,
  ...(human ? { kind: step.kind as PhoneStepKind } : {}),
};
```

- [ ] **Step 4: 통과 확인.** 같은 명령 + `tests/phone-server.test.ts`·`tests/noonchi-e2e.test.ts`·`tests/mokryeon-e2e.test.ts`(명령 모양을 견주는 곳이 있으면 kind를 더한다).
- [ ] **Step 5: 커밋** `feat(act): send the step kind with each human step command`

### Task 2: 폰 영상 모드 단계 영상·걷기

**Files:**
- Modify: `ui/src/phone/core/video-ar.js`, `ui/src/phone/core/video-ar.d.ts`, `ui/src/phone/core/video-math.js`, `ui/src/phone/controller.ts`
- Test: `ui/tests/phone-video.test.ts`

**Interfaces:**
- Consumes: `PhoneCommand.kind`, `PhoneCommand.target.ar`
- Produces:
  - `videoParams(params).steps: { kind: string; word: string; clipUrl: string }[]`, `.reactMs`(기본 1500, `?react=`초×1000)
  - `video-math.js`: `yawPitchQuat(yawRad: number, pitchDeg: number): [x,y,z,w]`, `walkGoal(from: [x,y,z], target: [x,y,z], stopM: number): { goal: [x,y,z]; yaw: number } | null`
  - `createVideoAr(...).command(cmd: PhoneCommand): void`
  - `window.__noonchiVideo.clips: { video_ms: number; clip: string }[]`
  - `videoTime()`는 바꾼 영상을 이어 센다(앞 영상들 시각 + 지금 영상 currentTime).

- [ ] **Step 1: 실패 시험** (`ui/tests/phone-video.test.ts`, 대역 영상 `fakeVideo`를 영상마다 하나씩 만든다)
  - `videoParams`가 `step=go:table:go-table.mp4`를 `{ kind: "go", word: "table", clipUrl: "/phone/videos/go-table.mp4" }`로 읽고, 모양이 틀린 값은 버린다.
  - go 명령(대상 `dining_table_1`, ar [0, 0.75, -1.5])이 오면 1.5초 뒤 `go-table.mp4` 영상을 만들어 튼다. 그 전에는 안 바꾼다.
  - 바꾼 뒤 자세가 초당 0.8m로 대상 쪽으로 가고, 대상에서 0.6m 앞([0, 1.4, -0.9])에서 멈춘다. 시선 yaw는 대상 쪽, pitch는 그대로다. 그 뒤 엔진 프레임 머리의 position도 새 자리다.
  - pick 명령은 영상만 바꾸고 자리는 그대로다.
  - 같은 id·step 명령이 비전 줄만 바뀌어 다시 와도 한 번만 바꾼다. 맞는 step이 없는 명령은 안 바꾼다.
  - 바꾼 뒤 `videoTime()`은 앞 영상 시각에서 이어지고, `record.clips`에 바꾼 시각과 이름이 남고, `record.ended`는 false로 돌아간다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npm --prefix ui run test -- tests/phone-video.test.ts`
- [ ] **Step 3: 구현.**

```js
// video-math.js
/** yaw(라디안, AR y축, 0이면 −z를 봄) 뒤 pitch(도). */
export function yawPitchQuat(yaw, pitchDeg) {
  const p = pitchQuat(pitchDeg);
  const h = yaw / 2;
  const y = [0, Math.sin(h), 0, Math.cos(h)];
  return mulQuat(y, p);
}
/** from에서 target 쪽으로 가서 target stopM 앞(바닥 평면)에서 멈출 자리와 target을 보는 yaw. 이미 그 안이면 null. */
export function walkGoal(from, target, stopM) {
  const dx = target[0] - from[0];
  const dz = target[2] - from[2];
  const d = Math.hypot(dx, dz);
  if (d <= stopM) return null;
  const k = (d - stopM) / d;
  return { goal: [from[0] + dx * k, from[1], from[2] + dz * k], yaw: Math.atan2(-dx, -dz) };
}
```

`createVideoAr` 안: `position`·`orientation`·`view`를 바뀌는 값으로 두고 `setPose(p, q)`로 함께 바꾼다. `command(cmd)`는 `steps`에서 `kind`가 같고 `cmd.target?.id`에 `word`가 든 첫 칸을 찾아, 처음 보는 `id:step`이면 `reactMs` 뒤 `swap(clipUrl)`과(go면) `walk = { goal, yaw, speed: 0.8 }`을 건다. `sendPose`(100ms마다)가 걷기를 한 칸 옮긴다. `swap`은 새 영상을 만들어 틀고, 앞 영상 시각을 `offset`에 더하고, `ended`를 풀고, `record.clips`에 남기고, 앞 영상을 닫는다. 영상 크기가 다르면 투영을 다시 만든다.

controller `onMessage` command 갈래에 `ar.command?.(m)`를 더한다(`PhoneAr` 형에 선택 칸).

- [ ] **Step 4: 통과 확인.** 같은 명령, 그리고 `npm run heavy -- npm --prefix ui test`·`npm run lint`·`npm run heavy -- npm --prefix ui run build`.
- [ ] **Step 5: 커밋** `feat(phone): switch to a step clip on each command and walk the pose for go steps in the video mode`

### Task 3: 판정 도구 단계 영상·트윈 줄

**Files:**
- Modify: `scripts/video-check.ts`
- Test: `tests/video-check.test.ts`

**Interfaces:**
- Consumes: `record.clips`, `GET /api/world`(`WorldView.eye`·`objects`)
- Produces:
  - `--step <종류>:<낱말>:<영상>` 여러 번 → 폰 주소 `&step=…`. `--step`이 있으면 `--done-after` 기본 0(누르지 않음).
  - `twinRows(prev: TwinSeen | null, world: WorldView, t0: number): { rows: Row[]; seen: TwinSeen }`: 눈 방이 바뀌거나 0.5m 넘게 옮기면 「눈 <방> (x, y)」, 컵마다 상태·놓인 곳(place 사실)·면·방이 바뀌면 「컵 <id> <면 또는 방> · <place 이름>」.
  - `Kind`에 「트윈」·「영상」을 더한다.
  - 단계 판정 줄: 첫 계획 단계 중 끝난 수와 누른 단추 수(「단계 4개 중 4개를 비전·위치로 넘김 · 누른 단추 0번」), 마지막 트윈 눈 방·컵 놓인 곳.
  - 끝에 대시보드(`<api>/`)를 같은 크롬 새 탭(1280×800)으로 열어 사진 `runtime/videos/<영상>.<시각>.twin.png`.
  - 영상이 끝난 뒤에는 계획이 닫히거나 30초가 지날 때까지 더 본다(두 모드 같음). 영상이 다시 시작되면(단계 영상) 끝 시각을 지운다.

- [ ] **Step 1: 실패 시험** (`tests/video-check.test.ts`): `twinRows`가 (1) 처음 부르면 눈·컵 줄을 내고 (2) 같은 값이면 줄이 없고 (3) 눈이 다른 방으로 가면 한 줄 (4) 컵 place가 on_table → in_hand → in_sink로 바뀌면 줄마다 하나 (5) 새 id 컵(cup_9)이 싱크대에 생기면 한 줄. `timeline`이 `record.clips`를 「영상」 줄로 넣는다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/video-check.test.ts`
- [ ] **Step 3: 구현** (위 Produces 그대로).
- [ ] **Step 4: 통과 확인.** 같은 명령 + `npm run heavy -- npx tsx scripts/video-check.ts --clip cup-demo.mp4 --fake`(앞 동작 그대로).
- [ ] **Step 5: 커밋** `feat(video): add step clips, twin rows and a dashboard shot to the video checker`

### Task 4: 단계 영상 만들기·실제 판정·문서

- [ ] **Step 1: 단계 영상 네 개 만들기** (ffmpeg, 위 표). 각 영상 YOLO 컵 확인.
- [ ] **Step 2: 실제 판정** (서버·PAM을 새로 띄움):
  `npm run heavy -- npx tsx scripts/video-check.ts --clip cup-empty.mp4 --step go:table:go-table.mp4 --step pick:cup:pick-cup.mp4 --step go:sink:go-sink.mp4 --step place:sink:place-sink.mp4 --expect-after 31`
- [ ] **Step 3: 결과 확인:** 단계마다 끝난 까닭(비전·위치), 트윈 줄, 대시보드 사진. 비용.
- [ ] **Step 4: 문서.** README 영상 모드 절·`docs/reference.md`에 `step=`·`react=`·`--step`. SSOT 9.6·12, HJO-10 티켓, 11-11 Daily, 변경이력.
- [ ] **Step 5: 커밋** `docs: describe step clips in the video mode and the checker`
