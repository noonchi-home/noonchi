# 안 보이는 대상 찾으러 가까이 가기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**쉬운 요약:** 지금은 PAM이 「컵 치우기」를 골라도 검사가 컵을 못 보면 「대상 물건이 보이지 않아 실행하지 않아요」로 끝난다. 앞으로는 끝내지 않고, 그 컵을 마지막으로 본 자리로 폰을 든 사람을 보낸다(「식탁으로 가 주세요」). 도착하면 그 자리를 가까이 다시 보고, 컵이 확인되면 그 계획을 그대로 이어 간다. 한도 안에 못 찾으면 지금 글로 닫고 그 자리는 60초 쉰다. 사용자에게는 묻지 않는다. 확인 전 컵(4초 이어 보이지 못한 후보)이 남긴 자리도 「마지막으로 본 자리」로 쓴다. 2026-11-17 머그 실제 녹화에서 컵이 한 번도 확인되지 않아(후보가 500ms 만에 잊힘) 멈춘 것이 이 때문이다.

**Goal:** 대상이 안 보이거나 낡아 검사가 막을 때, 들려 나갔거나 치운 것이 아니면 거절하지 않는다. 마지막으로 본 자리로 가까이 가서 다시 보고, 찾으면 계획을 잇는다.

**Architecture:**
- World State가 확인 전 후보의 마지막 자리(`sightings`)를 2분 둔다.
- 순수 함수 `lostTarget`(`src/act/tasks.ts`)이 「찾으러 갈 자리」를 고른다.
- 실행 추적의 새 부분 `Finder`(`src/act/track/find.ts`)가 가기 → 가까이 보기 → 사진 기다리기를 한다.
- 폰 명령 줄·막힘·지킴·되풀이 읽기는 내용물 보류와 같은 코드(`src/act/track/phone-line.ts`, `contents.ts`에서 떼어 냄)를 쓴다.
- 계획 전 검사가 막으면 판단을 붙잡고(계획 밖 칸 `find:<번호>`), 실행 전 검사가 막으면 계획을 붙잡는다(계획의 명령 줄).

**Tech Stack:** Node 22 TypeScript, Vitest, 가짜 World State·가짜 보기 담당(`tests/act-track.test.ts` 방식).

**Spec:** 사용자 결정(2026-11-17): 「대상 물건이 안 보이면 실행 안 함으로 끝내지 말고, 마지막으로 본 자리로 가까이 가서 다시 본다」. 내용물 계획 `docs/superpowers/plans/2026-11-17-cup-contents.md` Task 16·17(가까이 가서 보기 규칙).

## 조사한 사실 (cb07b65, 2026-11-17 머그 실제 녹화 `wide-mug.real`)

- PAM이 14초·28초·43초에 「컵 치우기」를 골랐지만 모두 계획 전 검사(`checkDecision`)가 `no_target`으로 막았다.
- 그 판 World State에는 확인된 컵이 한 번도 없었다(끝에 물건 0개).
  - 사람이 마실 때 YOLO가 컵을 0.47로 잡았지만, 물건 등장은 4초 이어 보여야 한다.
  - 사람이 나간 뒤 컵만 보인 장면은 3~6초뿐이고, 마지막 장면에서 머그가 작아 감지되지 않았다(대시보드 「감지 없음」).
- 확인 전 후보는 500ms 넘게 못 보면 잊힌다(`src/world/state/objects.ts`, `EVIDENCE_GAP_MS`). 그래서 「마지막으로 본 자리」가 남지 않는다.
- 확인된 물건은 사라짐 뒤 10분(`GONE_KEEP_MS`) 자리가 남는다. 들고 감 보호(`carried`)와 치운 것(`putAway`)은 이미 따로 안다.
- 가까이 보기(`lookContents`, 위에서 보기 아님)는 그 자리를 잘라 YOLO로 보고, YOLO 1장과 VLM 사실 하나면 새 확인 물건을 만든다. 작은 머그를 2배로 키워 보므로 전체 사진보다 잘 잡는다.
- 영상 페이지는 go 명령이면 대상 쪽으로 `near_m`×0.8까지 걷는다. 단계 영상은 대상 id에 낱말이 든 칸을 고른다(`go:table`이면 `dining_table_978b20c7`).

## 정한 것

1. **찾으러 갈 때:** 계획 전 검사가 `no_target`, 실행 전 검사가 `no_target`·`stale`로 막고, 그 행동에 대상 종류가 있고, 찾으러 갈 자리(2)가 있을 때.
   - 그때는 실패로 닫지 않고 붙잡는다. 실행 기록은 「<대상>을 찾으러 가요」다.
   - 찾을 자리가 없으면 지금처럼 그 글로 닫는다.
2. **찾으러 갈 자리**(`lostTarget`, 가장 새 것 하나):
   - 확인된 그 종류 물건 가운데 지금 보이지 않거나(시야 밖·사라짐) 낡은 것(최근 10초 안에 못 봄). 마지막 자리가 있어야 한다.
   - 확인 전 후보의 마지막 자리(`sightings`, 2분 안).
   - 빼는 것: 치운 것(`putAway`: 싱크대 안·놓기로 끝냄), 들고 감 보호(`carried`)였던 물건, 그 자리를 60초 안에 찾아보고 못 찾은 것.
   - 손에 든 채 본 후보 자리는 내려놓은 자리가 아닐 수 있다. 같은 후보의 손에 없던 자리가 있으면 그것을 쓴다. 없으면 손에 든 자리라도 간다(「마지막으로 본 자리」).
   - 근거: 사용자 결정은 「마지막으로 본 자리」다. 들려 나간 것이 확실한 것(`carried`)과 치운 것만 뺀다.
3. **후보 자리 남기기**(World State):
   - 확인 전 후보를 잊을 때 트윈 자리가 있으면 `sightings`에 남긴다: 종류·자리·면 id·면 이름·마지막 본 때·손에 있었는가.
   - 2분(`SIGHTING_KEEP_MS`)이 지나거나, 같은 종류 확인 물건이 0.5m 안에 등장하면 지운다. 종류마다 최근 4개까지다.
   - 받는 감지는 지금과 같다(종류마다 최소 신뢰도 이상). 기준을 낮추지 않는다.
4. **찾기 차례**(`Finder`): `go → look → settle → found | over`.
   - **go:** 폰 눈과 그 자리의 수평 거리가 `FIND.nearM`(1.0m) 밖이면 go 명령을 보낸다. 안이면 보내지 않고 look으로 간다.
     - 글: 자리에 면이 있으면 계획의 가기와 같은 글(「식탁으로 가 주세요」, `STEP_TEXT["go:가기"]`·`placeName`), 없으면 「<대상> 있던 곳으로 가 주세요」.
     - 종류 go, `near_m` 1.0, 대상은 면이 있으면 그 면 id, 없으면 그 자리(id는 확인 물건 id 또는 `find:<종류>`). 단추 없음, 소리로 읽기, 비전 줄은 거리.
     - 1.0m 근거: 그 자리를 전체 사진에 크게 담을 거리다. 계획의 가기 끝(1.2m)보다 가깝고, 내용물 가까이 가기(0.5m)처럼 팔을 뻗을 필요는 없다.
   - **look:** 명령을 거두고 그 자리를 가까이 본다(`lookContents`, 위에서 보기 아님, 자리 = 그 마지막 자리). 보기 담당이 바쁘면 3초(`CONTENTS_HOLD.lookWaitMs`) 뒤 건너뛴다.
   - **settle:** 가까이 본 뒤 4초(`CONTENTS_HOLD.settleMs`) 사진을 기다린다.
   - **found:** 그 자리 0.5m(`FIND.matchM`) 안에 그 종류의 있는(present) 물건이 3초(`STALE_MS`) 안에 보였고, 치운 것·손에 있음이 아니다.
     - 계획 전: 찾는 동안 받은 같은 행동의 가장 새 판단으로 계획 전 검사를 다시 하고 계획을 만든다.
     - 실행 전: 그 계획의 실행 전 검사를 다시 한다(`tryStart`). 내용물을 모르면 그다음은 지금 있는 내용물 보류다.
   - **over:** settle이 끝나도 못 찾으면 지금 글(「대상 물건이 보이지 않아 실행하지 않아요」·낡음 글)로 닫는다. 그 자리(종류·자리)는 60초(`FIND.retryMs`) 다시 가지 않는다.
5. **같은 규칙은 같은 코드로**(내용물 보류 Task 16·17과 같다, `phone-line.ts`로 떼어 함께 쓴다):
   - 막힘: 맞춘 눈이 지금 것이 아님(추정 눈, 2초 넘게 안 옴), 판본이 맞는 폰 없음, 끄기 안내, 승인 대기, 폰 대화, 계획의 질문. 막히면 명령을 거두고, 풀리면 새 번호 단계 id로 다시 보낸다. 막힌 채 30초(`holdMs`)면 over.
   - 명령마다 30초(`PEEK.stepMs`) 한도, `repeatMs`마다 다시 읽기, 비전 줄 `visionMs`.
   - 확인 물건을 찾는 동안은 보기 지킴(`guardObject`)을 걸고 차례가 끝나면 푼다. 후보 자리는 지킬 물건이 없다.
   - 명령 id: 계획 전은 계획 밖 칸 `find:<번호>`(단계 `find:<번호>:go:<번호>`), 실행 전은 계획 id(단계 `<계획>:find:<자리 id>:go:<번호>`). 단추가 없어 「완료」는 받지 않는다. 늦게 온 말·화면은 단계 id가 달라 버린다.
   - 「그만」: 계획 전 찾기는 거두고 그 자리를 60초 쉰다. 실행 전은 지금처럼 계획을 그만둔다.
6. **붙잡은 동안 판단:** 같은 행동 판단은 「<대상>을 찾는 중이에요」로 기록만 하고 가장 새 판단으로 바꿔 둔다. 다른 행동의 계획을 받으면 계획 밖 찾기를 거둔다(`dropIdle`과 같은 자리). 계획 밖 찾기와 계획 밖 가까이 가서 보기는 동시에 돌지 않는다(찾기가 먼저).
7. **묻지 않는다:** 폰 질문을 만들지 않는다. 명령은 모두 「주세요」로 끝난다.
8. **영상 모드:** 바꾸지 않는다. 녹화는 `--step go:table:wide-mug-go-table.mp4`(찾기 go가 식탁으로 감)와 지난번 단계 영상 그대로다. 후보 자리에 면이 없으면 `go:cup`도 같은 영상으로 둔다. `wide-mug-pick-cup.mp4`는 「안을 본 뒤 들어 올림」이라 집기 단계에 쓰고, 위에서 비추기에는 쓰지 않는다(컵 치우기는 내용물을 보지 않는다).

## 정한 값

| 이름 | 값 | 자리 |
|---|---|---|
| 후보 자리 두는 시간 | 2분 | `SIGHTING_KEEP_MS` |
| 후보 자리 수 | 종류마다 4개 | `SIGHTING_MAX` |
| 찾기 가기 끝 | 폰 눈과 그 자리 수평 1.0m 안 | `FIND.nearM` |
| 찾았다고 보는 거리 | 그 자리 0.5m 안 | `FIND.matchM` |
| 같은 자리 다시 찾기 | 60초 뒤 | `FIND.retryMs` |
| 명령 한도·막힘 한도·보기 기다림·사진 기다림 | 30초·30초·3초·4초 | `PEEK.stepMs`·`CONTENTS_HOLD` |

## Global Constraints

- worktree `C:\Users\ABC\Desktop\소웨공\twin-home-split`, 브랜치 `refactor/domain-split`. 내 파일만 경로로 add한다. `.gitignore`·`.ignore`는 커밋하지 않는다. 영어 커밋, attribution 없음, force·amend 금지. 묶음마다 커밋·push.
- 시험은 `npm run heavy -- <명령>`으로 하나씩. 남은 메모리 3GB 밑이면 기다린다.
- 저장소 `CLAUDE.md` 규칙 표를 따른다: 도메인 경계(world는 act를 가져오지 않음), 명령은 「주세요」, 새 화면 자리 없음(지금 명령 줄·계획 밖 칸만), 영상 모드 같은 구조, mock·live 같은 구조, 화면 글 규칙(60자 아래, 상태와 할 일만).
- 서버·크롬은 마지막 녹화 때만 켠다. 실제 모델은 녹화 한 번만.

## File Structure

| 파일 | 일 |
|---|---|
| `src/contract/world.ts`, `src/world/state/{core,objects,world}.ts` | Task 1 후보 자리 `sightings` |
| `src/act/tasks.ts`(`lostTarget`), `tests/act-tasks…`(있는 시험 파일에) | Task 2 찾으러 갈 자리 |
| `src/act/track/phone-line.ts`(새), `src/act/track/contents.ts` | Task 3 명령 줄 떼어 내기(동작 그대로) |
| `src/act/track/find.ts`(새), `src/act/track/{core,start,tracker,answers}.ts`, `src/act/labels.ts`(`FIND_TEXT`·`EXEC_TEXT.finding`·`EXEC_TEXT.findingSame`) | Task 4 계획 전 찾기 · Task 5 실행 전 찾기 |
| `src/server/home/act.ts` | 이음(있는 `lookContents`·`guardObject`·`precheck`을 그대로 넘김) |
| `docs/reference.md` | Task 6 문서 |

---

### Task 1: 후보 자리 `sightings`

**Files:** `src/contract/world.ts`(`WorldView.sightings?: { cls; position; surface; surface_label; at_ms; in_hand }[]`), `src/world/state/core.ts`, `src/world/state/objects.ts`, `src/world/state/world.ts`(view), Test: `tests/world-objects…`(있는 World State 시험 파일)

- [ ] **Step 1: 실패하는 시험**
  - 트윈 자리가 있는 컵 후보를 2초 보이다 끊기면 500ms 뒤 물건은 잊히고 `sightings`에 컵·자리·면 이름·마지막 본 때가 남는다.
  - 2분이 지나면 사라진다. 종류마다 4개까지다.
  - 같은 자리에서 컵이 4초 이어 보여 등장하면 그 자리 0.5m 안 sighting이 지워진다.
  - 관절로 든 채 끊긴 후보는 `in_hand: true`, 손에 없던 자리가 있으면 그 자리를 남긴다.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: 통과 확인** → **Step 5: 커밋** `feat(world): keep the last place of a cup candidate that was never confirmed`

### Task 2: 찾으러 갈 자리 `lostTarget`

**Files:** `src/act/tasks.ts`, Test: `tests/act-check.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - 있는 컵이 보이고 10초 안이면 null.
  - 시야 밖 컵(자리 있음)이 있으면 그 자리(면 이름·확인 물건 id).
  - 사라진 컵이 `carried`였거나 치운 것이면 빼고, sighting만 있으면 그 자리.
  - 여럿이면 가장 새 것. 쉬는 자리(60초 안 못 찾음)는 뺀다.
- [ ] Step 2~5, 커밋 `feat(act): pick the place to look for a target that is not seen`

### Task 3: 명령 줄 떼어 내기(동작 그대로)

**Files:** `src/act/track/phone-line.ts`(새: `Line`, `planLine`, `idleLine`, `phoneBlocked`, `eyeNow`, `sendLine`·`refreshLine`(비전 줄·되풀이 읽기)), `src/act/track/contents.ts`(이것을 씀)

- [ ] **Step 1:** 내용물 보류 시험(`tests/act-track.test.ts` 가까이 가서 보기 묶음)이 그대로인지 먼저 돌려 둔다.
- [ ] **Step 2:** 떼어 내고 같은 시험·`npm run lint`(도메인 경계)를 다시 돌린다. 동작은 바뀌지 않는다.
- [ ] 커밋 `refactor(act): share the phone command line of the closer peek`

### Task 4: 계획 전 찾기

**Files:** `src/act/track/find.ts`(`Finder`, `FIND`), `src/act/track/core.ts`(`finding` 칸), `src/act/track/start.ts`(계획 전 검사 `no_target`이면 `finder.start`), `src/act/track/tracker.ts`(tick에서 `finder.tick`), `src/act/track/answers.ts`(「그만」), `src/act/labels.ts`, Test: `tests/act-track.test.ts`

- [ ] **Step 1: 실패하는 시험**(가짜 World State·가짜 보기 담당)
  - 컵 치우기 판단, 확인된 컵 없음, 식탁 위 sighting → 실패 줄 없이 「컵을 찾으러 가요」, 명령 「식탁으로 가 주세요」(종류 go, `near_m` 1.0, 대상 식탁 id, `choices` []).
  - 폰 눈이 1.0m 안이면 명령을 거두고 `lookContents`가 그 자리로 불린다.
  - 그 자리 0.5m 안에 있는 컵이 생기면 같은 행동의 가장 새 판단으로 계획 모드가 불린다.
  - 못 찾으면 사진 기다림 4초 뒤 「대상 물건이 보이지 않아 실행하지 않아요」로 닫히고, 60초 안 같은 판단은 찾으러 가지 않고 바로 닫힌다.
  - 찾는 동안 같은 행동 판단은 「컵을 찾는 중이에요」로 기록만 한다. 다른 행동 계획을 받으면 찾기를 거둔다.
  - 폰 대화·승인 대기·끄기 안내면 거두고, 풀리면 새 단계 id로 다시 보낸다. 30초 막히면 닫힌다.
  - 「그만」이면 거두고 60초 쉰다. 명령 글은 모두 「주세요」로 끝나고 「?」가 없다.
  - sighting이 없으면 지금처럼 바로 닫힌다.
- [ ] Step 2~5, 커밋 `feat(act): go to the last place and look again before giving up on an unseen target`

### Task 5: 실행 전 찾기

**Files:** `src/act/track/find.ts`, `src/act/track/start.ts`(`tryStart`: `no_target`·`stale`이면 `finder.keep(r)`), Test: `tests/act-track.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - 계획 대상 컵이 시야 밖·낡음이면 계획을 붙잡고 그 컵 마지막 자리로 가기 명령(계획 명령 줄, 단계 `<계획>:find:<컵>:go:<번호>`), 보기 지킴을 건다.
  - 다시 보이면 `tryStart`가 첫 단계를 보낸다(지킴 풂). 내용물을 모르면 그다음은 내용물 보류다.
  - 못 찾으면 지금 글로 닫힌다. 들고 감 보호(`carried`)·치운 것이면 찾지 않는다.
- [ ] Step 2~5, 커밋 `feat(act): hold a plan and look for its target at the last place before closing it`

### Task 6: 문서·검증·녹화

- [ ] `docs/reference.md` 「계획·검사·실행」에 찾기 한 단락. 커밋 `docs: describe going to the last place to find an unseen target`.
- [ ] `npm run lint`, act·world 시험, `npm --prefix ui test`(바뀐 것 없음 확인).
- [ ] 녹화(조정자 요청 형식): twin-home-run을 새 커밋으로 맞추고 ui 빌드, PAM·서버를 실제 모델로 띄우고 `--step go:table:wide-mug-go-table.mp4 --step go:cup:wide-mug-go-table.mp4 --step pick:cup:wide-mug-pick-cup.mp4 --step go:sink:wide-mug-go-sink.mp4 --step place:sink:wide-mug-place-sink.mp4 --fov 40 --pitch -10 --h 1.15 --record demo-backup --out demo-backup/wide-mug.real2.timeline.md`. 한 번만 돌리고 서버·크롬을 끈다.

## Self-Review

- 사용자 결정(끝내지 말고 마지막 자리로 가서 다시 봄): 정한 것 1·2·4.
- 머그 녹화의 실제 원인(확인 전 후보가 잊혀 자리 없음): 정한 것 3, Task 1.
- 폰 사용권·명령 id·늦은 답·보기 지킴을 새로 베끼지 않음: 정한 것 5, Task 3.
- 묻지 않음: 정한 것 7.
- 남는 위험: 후보 자리가 손에 든 채 잰 자리면 식탁이 아닌 곳으로 갈 수 있다(정한 것 2, 손에 없던 자리를 먼저 씀). 가까이 봐도 작은 머그를 YOLO가 못 잡으면 못 찾고 닫힌다(그때는 녹화 결과로 보고).
