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

**Spec:** Codex 설계 검토(6798761 P2 일곱, afe8293 P2 넷 반영). 사용자 결정(2026-11-17): 「대상 물건이 안 보이면 실행 안 함으로 끝내지 말고, 마지막으로 본 자리로 가까이 가서 다시 본다」. 내용물 계획 `docs/superpowers/plans/2026-11-17-cup-contents.md` Task 16·17(가까이 가서 보기 규칙).

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

1. **찾으러 갈 때:**
   - 계획 전: 계획 전 검사가 `no_target`이나 `in_sink`로 막았는데 찾을 자리(2)가 있을 때. `in_sink`도 받는 까닭: 지금 검사는 싱크대에 치운 컵이 하나라도 남으면 다른 후보가 있어도 `in_sink`를 낸다(`src/act/check.ts` 50줄). 찾을 자리는 치운 것을 빼고 고르므로 둘을 갈라 준다.
   - 실행 전: 실행 전 검사가 `no_target`·`stale`로 막았을 때, **막은 그 대상 물건 하나만** 찾는다. 검사는 막은 물건 id를 결과에 싣는다(`CheckResult.object`, `unknown_contents`와 같은 칸).
   - 실행 전 검사의 `in_sink`를 가른다: 지금은 계획 대상이 World State에 없거나 사라졌을 때 다른 컵이 하나라도 치워져 있으면 `in_sink`를 낸다(`src/act/check.ts` 75줄). 앞으로 `in_sink`는 **막은 그 대상 자신**이 치운 것(`putAway`, 놓기로 끝낸 기억 포함)일 때만이고, 다른 컵이 치워진 것은 상관하지 않고 `no_target`(막은 id)이다. 계획 전 검사의 `in_sink`는 그대로 두고 찾을 자리로 가른다(위).
   - 그때는 실패로 닫지 않고 붙잡는다. 실행 기록은 「<대상>을 찾으러 가요」다. 찾을 자리가 없으면 지금처럼 그 글로 닫는다.
2. **찾을 자리**(`lostTarget({ world, cls, placed, now, freshMs, objectId?, resting })`, 가장 새 것 하나):
   - 신선도 기준(`freshMs`)은 막은 검사의 기준을 그대로 받는다: 계획 전 10초(`PRECHECK_FRESH_MS`), 실행 전 3초(`STALE_MS`). 그 기준보다 오래 못 본 확인 물건(시야 밖·사라짐·낡음)이 대상이다. 4~10초 된 컵도 실행 전에는 찾는다.
   - `objectId`를 주면(실행 전) 그 물건의 마지막 자리만 쓴다.
   - 주지 않으면(계획 전) 그 종류 확인 물건과 확인 전 후보의 마지막 자리(`sightings`, 2분 안) 가운데 가장 새 것.
   - 빼는 것: 치운 것(`putAway`: 싱크대 안·놓기로 끝냄), 들고 감 보호(`carried`)였던 물건, 쉬는 자리(60초 안에 찾아보고 못 찾음, `resting`).
   - 손에 든 채 본 후보 자리는 내려놓은 자리가 아닐 수 있다. 같은 후보의 손에 없던 자리가 있으면 그것을 쓴다. 없으면 손에 든 자리라도 간다(「마지막으로 본 자리」).
3. **후보 자리 남기기**(World State):
   - 확인 전 후보를 잊을 때 트윈 자리가 있으면 `sightings`에 남긴다: 종류·자리·면 id·면 이름·마지막 본 때·손에 있었는가.
   - 2분(`SIGHTING_KEEP_MS`)이 지나거나, 같은 종류 확인 물건이 0.5m 안에 등장하면 지운다. 종류마다 최근 4개까지다.
   - 받는 감지는 지금과 같다(종류마다 최소 신뢰도 이상). 기준을 낮추지 않는다.
4. **찾기 차례**(`Finder`): `go → aim → look → found | over`.
   - **명령 대상**: 이름은 그 자리의 면 이름(없으면 대상 이름), **좌표는 찾을 자리 그대로**다(면 가운데가 아니다). id는 확인 물건 id, 후보면 `find_<종류>`(단계 영상 낱말 `cup` 등이 든다).
   - **go**: 폰 눈과 찾을 자리의 수평 거리가 `FIND.nearM`(1.0m) 밖이면 보낸다. 안이면 보내지 않고 aim으로 간다.
     - 글은 면이 있으면 계획의 가기와 같은 꼴(「식탁으로 가 주세요」, `STEP_TEXT["go:가기"]`), 없으면 「<대상> 있던 곳으로 가 주세요」. 종류 go, `near_m` 1.0, 단추 없음, 소리로 읽기, 비전 줄은 거리.
     - 1.0m 근거: 그 자리를 전체 사진에 크게 담을 거리다. 계획의 가기 끝(1.2m)보다 가깝고, 내용물 가까이 가기(0.5m)처럼 팔을 뻗을 필요는 없다.
   - **aim**: 도착만으로 카메라가 그 자리를 비추지는 않는다. 「<면> 위를 비춰 주세요」(면이 없으면 「<대상> 있던 곳을 비춰 주세요」, 종류 do, 대상 = 찾을 자리)를 보낸다.
     - 끝: 가까이 보기가 그 자리를 지금 볼 수 있다(`ObservePipeline.spotReady(자리, since)`). 판정은 가까이 보기와 **같은 프레임 고르기 함수**(`closerFrames(자리)`, `closer()`에서 떼어 냄: 가장 새 프레임이 `closerStaleMs` 안, 가장 새 VLM 프레임에서 `closerSpanMs` 안이고 그 자리가 사진 안인 장 최대 5장, 서로 다른 장 3장 이상)를 쓰고, 고른 장이 모두 비추기를 보낸 뒤 찍혔을 때만 참이다. 그래서 aim이 끝난 바로 뒤 가까이 보기는 `no_fresh_frames`가 되지 않는다.
     - 내용물 보류의 위에서 비추기와 같은 규칙(사람에게 하는 명령, 「주세요」, 단추 없음, 비전으로 넘김)이다. 영상 모드는 do면 대상 쪽을 바라보므로 바꾸지 않는다.
   - **look**: 명령을 거두고 그 자리를 가까이 본다. 보기 담당의 같은 물건 30초 건너뛰기(`objectGapMs`, `src/act/look.ts` 130줄)를 찾기에는 쓰지 않는다(`ContentsLook.force`). 보기 담당이 바쁘면 3초 뒤 다시 부탁한다.
   - **found 판정은 tick마다 바로 한다**(가까이 보기를 기다리지 않고, 그 뒤 사진 기다림 안에서도):
     - 찾을 자리 0.5m(`FIND.matchM`) 안에 그 종류의 있는 물건이 있고, 막은 검사의 신선도(`freshMs`) 안에 보였고, 치운 것·손에 있음이 아니다.
     - 0.5m 안에 둘 이상이면 찾을 자리에 가장 가까운 하나. 둘이 0.1m 안으로 붙어 가를 수 없으면 아직 못 찾은 것으로 보고 이어 본다.
     - 찾았지만 신선도를 넘었으면(가까이 보기의 사진이 몇 초 옛것) 그 자리를 새 사진으로 다시 가까이 본다(aim의 끝 조건부터). 다시 하기는 전체 기한(아래 over) 안에서만 한다.
   - **이어 가기**:
     - 계획 전: 찾는 동안 받은 같은 행동의 가장 새 판단으로 계획 전 검사를 다시 하고 계획을 만든다.
     - 실행 전, 찾은 물건이 **막은 그 id**면 `tryStart`로 실행 전 검사를 다시 한다(내용물을 모르면 그다음은 내용물 보류).
     - 실행 전, 찾은 물건이 **다른 id**면(같은 종류 새 물건) 계획의 물건 id가 옛것이라 검사가 계속 옛 id를 본다. 그래서 계획을 「찾은 뒤 다시 판단」으로 닫고 같은 행동 15초 셈에서 뺀다(`ungap`, 「가까이 본 뒤 다시 판단」과 같은 길). 다음 판단이 새 id로 계획한다.
   - **over**: 다음 가운데 하나면 막은 검사의 글(「대상 물건이 보이지 않아 실행하지 않아요」·낡음 글)로 닫는다. 그 자리(종류·자리)는 60초(`FIND.retryMs`) 다시 가지 않는다.
     - 명령 하나가 30초(`PEEK.stepMs`) 안에 끝나지 않음.
     - 가까이 본 뒤 사진 기다림 4초가 지나도 못 찾음(낡은 발견이면 위처럼 다시 하기).
     - **찾기를 시작한 때부터 60초(`FIND.totalMs`)**: 다시 하기·다시 보내기로 늘어나지 않는다. VLM 답이 계속 늦어 낡은 발견이 되풀이돼도 여기서 끝난다.
5. **같은 규칙은 같은 코드로**(내용물 보류 Task 16·17과 같다, `phone-line.ts`로 떼어 함께 쓴다):
   - 막힘: 맞춘 눈이 지금 것이 아님(추정 눈, 2초 넘게 안 옴), 판본이 맞는 폰 없음, 끄기 안내, 승인 대기, 폰 대화, 계획의 질문. 막히면 명령을 거두고, 풀리면 새 번호 단계 id로 다시 보낸다. 막힌 채 30초(`holdMs`)면 over.
   - 명령마다 30초(`PEEK.stepMs`) 한도, `repeatMs`마다 다시 읽기, 비전 줄 `visionMs`.
   - 확인 물건을 찾는 동안은 보기 지킴(`guardObject`)을 걸고 차례가 끝나면 푼다. 후보 자리는 지킬 물건이 없다.
   - 명령 id: 계획 전은 계획 밖 칸 `find:<번호>`(단계 `find:<번호>:<go|aim>:<번호>`), 실행 전은 계획 id(단계 `<계획>:find:<자리 id>:<go|aim>:<번호>`). 단추가 없어 「완료」는 받지 않는다. 늦게 온 말·화면은 단계 id가 달라 버린다.
   - 「그만」: 계획 전 찾기는 거두고 그 자리를 60초 쉰다. 실행 전은 지금처럼 계획을 그만둔다.
6. **붙잡은 동안 판단:** 같은 행동 판단은 「<대상>을 찾는 중이에요」로 기록만 하고 가장 새 판단으로 바꿔 둔다. 다른 행동의 계획을 받으면 계획 밖 찾기를 거둔다(`dropIdle`과 같은 자리). 계획 밖 찾기와 계획 밖 가까이 가서 보기는 동시에 돌지 않는다(찾기가 먼저).
7. **묻지 않는다:** 폰 질문을 만들지 않는다. 명령은 모두 「주세요」로 끝난다.
8. **영상 모드:** 지금 영상 페이지는 맞는 단계 영상 칸이 없으면 자세도 바꾸지 않는다(`ui/src/phone/core/video-ar.js` `command`, 641~642줄 `if (!first) return`). 그러면 단계 영상이 없는 찾기 aim(do)·go가 자세를 옮기지 않아 끝나지 않는다. 실제 모드에서는 사람이 모든 명령대로 폰을 움직이므로, **자세 흉내를 단계 영상과 떼어** 맞는 칸이 없어도 대상이 있는 사람 단계 명령이면 `reactMs` 뒤 자세를 옮긴다(go는 `near_m`×0.8까지 걷기, `view: "above"`는 위에서 비추기, 그 밖 do·pick·place는 바라보기). 칸이 있으면 지금처럼 영상을 바꿀 때 함께 옮긴다.
   - 새 줄에는 갈래 표시 `영상 모드: 자세 흉내`를 단다(`tests/video-mode-parity.test.ts`가 본다). 소리·명령·답·완료 판단은 바꾸지 않는다.
   - 녹화는 찾기 go용 `--step go:cup:wide-mug-go-table.mp4`(대상 id에 `cup`이 든다)에 지난번 단계 영상(`go:table`·`pick:cup`·`go:sink`·`place:sink`)을 그대로 둔다. aim은 단계 영상 없이 자세만 바라보기로 옮긴다.
   - `wide-mug-pick-cup.mp4`는 「안을 본 뒤 들어 올림」이라 집기 단계에 쓰고, 위에서 비추기에는 쓰지 않는다(컵 치우기는 내용물을 보지 않는다).

## 정한 값

| 이름 | 값 | 자리 |
|---|---|---|
| 후보 자리 두는 시간 | 2분 | `SIGHTING_KEEP_MS` |
| 후보 자리 수 | 종류마다 4개 | `SIGHTING_MAX` |
| 찾기 가기 끝 | 폰 눈과 그 자리 수평 1.0m 안 | `FIND.nearM` |
| 찾았다고 보는 거리 | 그 자리 0.5m 안(가장 가까운 하나, 0.1m 안 둘이면 못 가름) | `FIND.matchM`·`FIND.splitM` |
| 비추기 끝 | 가까이 보기와 같은 프레임 고르기(`closerFrames`)가 되고, 고른 장이 모두 비추기 뒤 | `spotReady` |
| 신선도 | 계획 전 10초, 실행 전 3초(막은 검사 기준) | `PRECHECK_FRESH_MS`·`STALE_MS` |
| 찾기 전체 기한 | 시작부터 60초(다시 하기로 늘지 않음) | `FIND.totalMs` |
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
| `src/act/tasks.ts`(`lostTarget`), `src/act/check.ts`(막은 물건 id를 `no_target`·`stale` 결과에) | Task 2 찾을 자리 |
| `src/act/track/phone-line.ts`(새), `src/act/track/contents.ts` | Task 3 명령 줄 떼어 내기(동작 그대로) |
| `src/act/track/find.ts`(새), `src/act/track/{core,start,tracker,answers}.ts`, `src/act/labels.ts`(`FIND_TEXT`·`EXEC_TEXT.finding`·`EXEC_TEXT.findingSame`) | Task 4 계획 전 찾기 · Task 5 실행 전 찾기 |
| `src/act/look.ts`(`ContentsLook.force`), `src/observe/pipeline.ts`(`spotReady`), `src/server/home/act.ts`(`spotReady` 이음) | 강제 다시 보기·비추기 끝 |
| `ui/src/phone/core/video-ar.js`, `ui/tests/…video…`(영상 페이지 시험), `tests/video-mode-parity.test.ts` | Task 5b 영상 모드 자세 흉내 |
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

### Task 2: 찾을 자리 `lostTarget`·막은 물건 id

**Files:** `src/act/tasks.ts`, `src/act/check.ts`, Test: `tests/act-check.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - `checkPlan`이 `no_target`·`stale`이면 막은 물건 id(`object`)를 싣는다.
  - 계획 대상 컵이 사라졌고 다른 컵이 싱크대에 치워져 있으면 `in_sink`가 아니라 `no_target`(대상 id)이다. 대상 자신이 치운 것이면 `in_sink`다(지금 75줄 동작이 이 시험에서 실패하는지 먼저 본다).
  - 있는 컵이 `freshMs` 안에 보였으면 null. 실행 전 기준(3초)이면 5초 된 컵의 자리를 낸다(계획 전 10초면 null).
  - `objectId`를 주면 그 물건 자리만 낸다(다른 컵 자리가 더 새도).
  - 싱크대에 치운 컵과 식탁 위 sighting이 함께 있으면 sighting 자리를 낸다(계획 전 검사가 `in_sink`를 내는 경우).
  - 사라진 컵이 `carried`였거나 치운 것이면 뺀다. 쉬는 자리는 뺀다. 여럿이면 가장 새 것.
- [ ] Step 2~5, 커밋 `feat(act): pick the place to look for a target that is not seen`

### Task 3: 명령 줄 떼어 내기(동작 그대로)

**Files:** `src/act/track/phone-line.ts`(새: `Line`, `planLine`, `idleLine`, `phoneBlocked`, `eyeNow`, `sendLine`·`refreshLine`(비전 줄·되풀이 읽기)), `src/act/track/contents.ts`(이것을 씀)

- [ ] **Step 1:** 내용물 보류 시험(`tests/act-track.test.ts` 가까이 가서 보기 묶음)이 그대로인지 먼저 돌려 둔다.
- [ ] **Step 2:** 떼어 내고 같은 시험·`npm run lint`(도메인 경계)를 다시 돌린다. 동작은 바뀌지 않는다.
- [ ] 커밋 `refactor(act): share the phone command line of the closer peek`

### Task 4: 계획 전 찾기

**Files:** `src/act/track/find.ts`(`Finder`, `FIND`), `src/act/track/core.ts`(`finding` 칸), `src/act/track/start.ts`(계획 전 검사가 `no_target`·`in_sink`이고 찾을 자리가 있으면 `finder.start`), `src/act/track/tracker.ts`(tick에서 `finder.tick`, 옵션 `spotReady`), `src/act/track/answers.ts`(「그만」), `src/act/look.ts`(`force`), `src/observe/pipeline.ts`(`spotReady`), `src/act/labels.ts`(`FIND_TEXT`·`EXEC_TEXT.finding`·`EXEC_TEXT.findingSame`·`EXEC_TEXT.foundNew`), Test: `tests/act-track.test.ts`, 관찰 흐름 시험(spotReady)

- [ ] **Step 1: 실패하는 시험**(가짜 World State·가짜 보기 담당·가짜 `spotReady`)
  - 컵 치우기 판단, 확인된 컵 없음, 식탁 위 sighting → 실패 줄 없이 「컵을 찾으러 가요」, 명령 「식탁으로 가 주세요」(종류 go, `near_m` 1.0, 대상 좌표 = sighting 자리, `choices` []).
  - 싱크대에 치운 컵이 따로 있어(`in_sink`) 막혀도 sighting이 있으면 같다.
  - 폰 눈이 1.0m 안이면 「식탁 위를 비춰 주세요」(종류 do, 대상 = 그 자리). `spotReady`가 참이 되면 명령을 거두고 `lookContents({ force: true, spot: 그 자리 })`가 불린다.
  - 30초 안에 같은 물건을 본 보기 담당도 `force`면 실제로 다시 본다.
  - 기다리는 중 tick에 그 자리 0.5m 안에 있는 컵이 10초 안에 보이면 바로(사진 기다림 4초 전에) 같은 행동의 가장 새 판단으로 계획 모드가 불린다.
  - 0.5m 안 컵 둘이 0.1m 안으로 붙어 있으면 아직 찾지 않은 것으로 본다.
  - 못 찾으면 「대상 물건이 보이지 않아 실행하지 않아요」로 닫히고, 60초 안 같은 판단은 찾으러 가지 않고 바로 닫힌다.
  - 찾는 동안 같은 행동 판단은 「컵을 찾는 중이에요」로 기록만 한다. 다른 행동 계획을 받으면 찾기를 거둔다.
  - 폰 대화·승인 대기·끄기 안내면 거두고, 풀리면 새 단계 id로 다시 보낸다. 30초 막히면 닫힌다.
  - 「그만」이면 거두고 60초 쉰다. 명령 글은 모두 「주세요」로 끝나고 「?」가 없다.
  - sighting이 없으면 지금처럼 바로 닫힌다.
  - `spotReady`: `closerFrames`가 고른 장(그 자리가 사진 안, `closerSpanMs` 안, 3장 이상, 가장 새 장이 `closerStaleMs` 안)이 모두 비추기 뒤면 참. 2장, 비추기 전 장이 섞임, 간격을 두고 모여 가장 오래된 장이 `closerSpanMs` 밖이면 거짓. 참인 바로 뒤 `closer(그 자리)`가 `no_fresh_frames`가 아니다.
  - 찾기 시작부터 60초가 지나면 낡은 발견을 되풀이하는 중이어도 닫힌다(명령 한도 30초가 새로 시작돼도).
- [ ] Step 2~5, 커밋 `feat(act): go to the last place, point the phone and look again before giving up on an unseen target`

### Task 5: 실행 전 찾기

**Files:** `src/act/track/find.ts`, `src/act/track/start.ts`(`tryStart`: `no_target`·`stale`이고 막은 물건 id가 있으면 `finder.keep(r, id)`), Test: `tests/act-track.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - 계획 대상 컵이 5초 전에 마지막으로 보였으면(실행 전 기준 3초 넘음) 계획을 붙잡고 그 컵 자리로 가기 명령(계획 명령 줄, 단계 `<계획>:find:<컵>:go:<번호>`), 보기 지킴을 건다.
  - 막은 그 컵이 다시 보이면(3초 안) `tryStart`가 첫 단계를 보낸다(지킴 풂). 내용물을 모르면 그다음은 내용물 보류다.
  - 가까이 보기에서만 잡혀 신선도를 넘었으면 새 사진으로 다시 비추기·가까이 보기를 한다(3초 안이 될 때까지, 한도 안).
  - 0.5m 안에 다른 id의 같은 종류 컵만 생기면 계획을 「찾은 뒤 다시 판단」으로 닫고 같은 행동 15초 셈에서 뺀다.
  - 못 찾으면 낡음·없음 글로 닫힌다. 들고 감 보호(`carried`)·치운 것이면 찾지 않는다.
- [ ] Step 2~5, 커밋 `feat(act): hold a plan and look for its blocked target at the last place before closing it`

### Task 5b: 영상 모드 자세 흉내를 단계 영상과 떼기

**Files:** `ui/src/phone/core/video-ar.js`(`command`), 영상 페이지 시험(`ui/tests/` 영상 AR 시험 파일), `tests/video-mode-parity.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - 맞는 단계 영상 칸이 없는 do 명령(대상 있음)이 오면 `reactMs` 뒤 자세가 대상 쪽을 바라본다(지금은 그대로라 실패).
  - 칸이 없는 go 명령(`near_m` 1.0)이면 대상 0.8m 앞까지 걷는다. `view: "above"`면 위에서 비춘다.
  - 칸이 있으면 지금처럼 영상을 바꿀 때 함께 옮기고, 같은 명령이 다시 와도 다시 시작하지 않는다.
  - 새 명령·지우기(`command_clear`)면 예약된 자세 바꾸기를 멈춘다.
  - 질문·승인(대상 없음)은 자세를 바꾸지 않는다.
  - 새 줄에 `영상 모드: 자세 흉내` 표시가 있고 `tests/video-mode-parity.test.ts`·`ui/tests/phone-mode-parity.test.ts`가 그대로 통과한다.
- [ ] Step 2~5, 커밋 `fix(phone): move the video pose for a command even when no step clip matches`

### Task 6: 문서·검증·녹화

- [ ] `docs/reference.md` 「계획·검사·실행」에 찾기 한 단락. 커밋 `docs: describe going to the last place to find an unseen target`.
- [ ] `npm run lint`, act·world 시험, `npm --prefix ui test`(바뀐 것 없음 확인).
- [ ] 녹화(조정자 요청 형식): twin-home-run을 새 커밋으로 맞추고 ui 빌드, PAM·서버를 실제 모델로 띄우고 `--step go:cup:wide-mug-go-table.mp4 --step go:table:wide-mug-go-table.mp4 --step pick:cup:wide-mug-pick-cup.mp4 --step go:sink:wide-mug-go-sink.mp4 --step place:sink:wide-mug-place-sink.mp4 --fov 40 --pitch -10 --h 1.15 --record demo-backup --out demo-backup/wide-mug.real2.timeline.md`. 한 번만 돌리고 서버·크롬을 끈다.

## Self-Review

- 사용자 결정(끝내지 말고 마지막 자리로 가서 다시 봄): 정한 것 1·2·4.
- 머그 녹화의 실제 원인(확인 전 후보가 잊혀 자리 없음): 정한 것 3, Task 1.
- 폰 사용권·명령 id·늦은 답·보기 지킴을 새로 베끼지 않음: 정한 것 5, Task 3.
- 묻지 않음: 정한 것 7.
- Codex 검토(6798761): 신선도·막은 id(1·2), `in_sink`(1), 명령 좌표(4), 새 id·여럿(4), 강제 다시 보기(4 look), 비추기 명령·새 사진(4 aim), 즉시 판정·낡은 발견(4 found).
- Codex 재확인(afe8293): 영상 자세 흉내를 단계 영상과 뗌(8, Task 5b), 실행 전 `in_sink` 가르기(1, Task 2), aim 끝을 가까이 보기 프레임 고르기와 같게(4 aim), 찾기 전체 기한 60초(4 over).
- 남는 위험: 후보 자리가 손에 든 채 잰 자리면 식탁이 아닌 곳으로 갈 수 있다(정한 것 2, 손에 없던 자리를 먼저 씀). 가까이 봐도 작은 머그를 YOLO가 못 잡으면 못 찾고 닫힌다(그때는 녹화 결과로 보고).
