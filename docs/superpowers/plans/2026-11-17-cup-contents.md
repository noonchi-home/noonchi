# 컵 내용물: 확인 규칙 · 마시기 사건 · 불투명 컵 · 말로 묻기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컵 안 내용물을 사진 한 장으로 바꾸지 않는다. 새 값은 서로 다른 VLM 사진 3장·4초가 이어지거나 사람이 말로 답할 때만 정하고, 확인된 값은 마시기·따르기 같은 행동으로만 다시 연다. 불투명 컵은 VLM 내용물 답을 쓰지 않는다. 내용물이 필요한 행동인데 모르면 실행을 붙잡고 가까이 본 뒤 폰이 소리로 「컵 비었어요?」를 묻고 말로 받은 답을 World State에 넣는다.

**Architecture:** World State에 내용물 갱신기 하나(`src/world/state/contents.ts` `ContentsBook`)를 둔다. 전체 사진 VLM 답·가까이 본 사진 VLM 답·사람 답·마시기 따르기 사건·계획의 따르기 단계가 모두 이 갱신기로 들어가고, 갱신기가 물건의 `facts.contents`(확인됨이면 믿어도 되는 값)와 내용물 세대(`contents_gen`)를 쓴다. 실행 쪽은 `facts.contents`가 확인됨일 때만 값으로 쓴다(조건 `factIs`·실행 전 검사·판단 전 보기 B). 실행 전 검사가 내용물을 몰라 막은 계획은 실행 추적의 내용물 보류(`src/act/track/contents.ts` `ContentsHold`)가 붙잡아 가까이 보기 → 사진 기다리기 → 말 질문 차례로 푼다. 질문은 지금 명령 줄(승인 질문과 같은 `Run.asking` 자리)로 보내고 단추 없이 말로만 받는다. 계획이 없을 때는 판단 전 보기 B가 가까이 본 뒤에도 모르거나 불투명한 컵을 같은 명령 줄의 계획 밖 질문(`TrackCore.idleAsk`)으로 묻는다.

**Tech Stack:** Node 22 TypeScript, zod, Vitest, 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`), 시험용 PAM 자리(`tests/helpers/pam.ts`).

**Spec:** 사용자가 정한 것(2026-11-17) 1~3번과 Codex 설계 검토를 받은 설계(이 계획을 부탁한 글). 구현명세서 `docs` 저장소 `01_Product/구현명세서 SSOT.md` 6.1·6.2·6.3·6.6·6.12절. 저장소 설명 `docs/reference.md` 「관찰 흐름」.

## 정한 것 (2026-11-17)

1. **판단 전 보기 B 끝에도 묻는다(묶음 11).** PAM 시나리오 지시문은 「(짐작)·모름 값이면 규칙을 쓰지 않는다」라(`services/pam/scenarios/noonchi/scenario.json`), 불투명 머그는 PAM이 물·콜라를 고르지 않고 대기한다. 보류된 행동에만 물으면 그 장면에서 질문도 물·콜라도 나오지 않는다. 사용자는 「모르면 사람에게 말로 묻기」를 원했다.
   - 묻는 때(모두): 가까이 봐도 못 정했거나(B가 그 세대에 가까이 본 뒤 4초) 불투명 컵이다, 행동 목록에 내용물 행동(`want`)이 있다, 열린·만드는 계획(코치 포함)·끄기 안내·승인 대기가 없다, 위치를 맞췄다, 사람이 보인다.
   - 계획이 없어 질문 문맥은 실행 추적의 계획 밖 질문 칸(`TrackCore.idleAsk`, 명령 id `ask:<번호>`)이다. 답·늦은 답·한 번만·답 없음 규칙은 보류 질문(묶음 8)과 같다. 계획이 시작되거나 막는 것이 생기면 질문을 지운다.
   - 보류된 행동의 질문(묶음 7~8)은 그대로 둔다.
2. 「컵 그대로 두기」(계획 없는 행동)는 내용물을 모르면 묻지 않고 「안을 몰라 실행하지 않아요」로 기록만 한다(아무것도 안 하는 행동이라 물을 까닭이 없다).
3. 실행 전 검사의 내용물은 들고 있음·낡음 뒤에 본다(들고 있는 컵은 묻지 않는다). 보류하는 동안 컵이 낡으면 실행 추적이 보류를 이어 간다. 계획이 따르는 컵은 전부 본다.
4. 계획 전 검사는 맞는 컵이 하나라도 있으면 통과하고, 다 확인된 반대 값일 때만 막는다.
5. 따르기 사건은 감지 마스크로 본다(사용자 확인): 병 마스크 긴 축(주성분)과 중력 방향의 각, 「컵 위」는 두 마스크를 중력 좌표에 비춘 범위. 마스크가 없거나 작거나 둥글거나 카메라 자세가 없으면 보지 않는다.
6. 질문 단계 id에는 물을 때마다 오르는 번호를 싣는다(앞 질문의 늦은 답을 막음). 폰 대화(말 요청 에이전트 처리 중·끝난 뒤 10초) 동안은 묻지 않는다.

## 조사한 사실 (2026-11-17, `refactor/domain-split` 8afca05)

- VLM 사실은 `SceneFacts.answer`(`src/world/state/facts.ts`)가 면마다 넣는다. 같은 값이 두 번이면 확인됨이고, 다른 값 한 장이 오면 그대로 바뀐다(확인된 값도). 가까이 본 답(`src/world/state/closer.ts applyCloserScene`)도 같은 `answer`를 부른다. 원본 프레임·대상·면마다 한 번만 센다.
- 내용물 값은 `empty`·`has_contents`·`contents_unknown`(낱말 표 `src/world/vocab.ts`). VLM 스키마 enum과 프롬프트 값 목록이 여기서 나온다(`src/observe/scene.ts`).
- 조건 `factIs`(`src/world/conditions.ts`)는 확인됨·짐작을 가리지 않는다. 따르기 단계 끝 조건 `{"object": cup, "follow": true, "facts": {"contents": "has_contents"}}`(`src/agent/planInput.ts`)이 짐작 한 장으로도 참이 된다.
- 실행 전 검사(`src/act/check.ts`)는 대상이 보이는지·치웠는지·낡았는지·들고 있는지만 본다. 내용물은 보지 않는다. `tryStart`(`src/act/track/start.ts`)가 판단을 받을 때·계획을 받을 때·승인 답 뒤에 `check`를 다시 부른다.
- 판단 전 보기 B(`src/act/look.ts tick`)는 볼 면 값이 없거나 「안이 안 보임」일 때만 부른다. 짐작 값이면 부르지 않는다.
- 관절(`src/world/pose.ts`)은 손목·어깨·엉덩이·무릎만 쓴다. 얼굴 점(코 0·눈 1·2·귀 3·4)은 읽지 않는다. 손에 듦은 `heldBy`(손목-상자 거리 ≤ scale × 0.35)다.
- 승인 질문·시간 초과 질문은 `Run.asking`(`src/act/track/approval.ts Asking`)으로 지금 명령 줄에 뜨고, 말 답은 `Answers.onHeard`가 `at`(말할 때 떠 있던 명령)이 맞을 때만 받는다(`src/act/track/answers.ts`). 답 단추는 `choicesOf`가 정한다.
- 소리 등급은 `talkGrade`(`src/act/talk-grade.ts`) 한 곳이다. 답 단추가 「완료」 말고 있으면 `question`이다. 단추 없는 질문은 지금 등급이 없다.
- 실행 추적은 맞춘 폰 눈만 받는다(`onEye`, 추정 눈은 버림). `core.eye`가 있으면 위치를 맞춘 것이다.
- 관찰 흐름의 변화 방송 `publish`(`src/observe/pipeline.ts`)는 private이다. 폰 쪽 답으로 World State를 바꾸면 방송할 길이 없다.
- `tests/cup-branches-e2e.test.ts` 물 채우기는 가짜 PAM이 「비어 있음」 글(짐작 포함)만 보고 고르고, 따르기 단계가 VLM 「내용물 있음」으로 「완료」 없이 넘어가는 것을 본다. 맞추기 전이라 폰 눈이 없다.

## Global Constraints

- worktree `C:\Users\ABC\Desktop\소웨공\twin-home-split`, 브랜치 `refactor/domain-split`. 같은 worktree에서 다른 에이전트가 `twin/` 데이터와 그 시험을 고친다: `twin/`과 그 시험 파일은 건드리지 않는다. `docs/world-vocabulary.md`를 다시 만들 때 이 집 가전 표가 내가 바꾸지 않은 `twin/` 때문에 바뀌면 그 부분은 커밋하지 않는다.
- 커밋은 내 파일만 경로를 적어 `git add <파일…>`(`git add -A` 금지). `.gitignore`·`.ignore`는 커밋하지 않는다. 커밋 메시지는 영어, attribution 줄 없음. 묶음마다 커밋하고 `git push origin refactor/domain-split`(force·amend 금지).
- 시험·빌드는 `npm run heavy -- <명령>`으로 하나씩. 남은 메모리가 3GB 밑이면 기다린다. 서버(8200·8210)·PAM(8300)은 띄우지 않는다. 실제 모델 호출 없음. `.env`는 읽지 않는다.
- 저장소 `CLAUDE.md` 규칙 표 전부. 특히:
  - mock·live 같은 구조: 새 길에 모드 갈래 없음. 가짜는 `tests/helpers/`에만.
  - 도메인 경계(`scripts/lint-domains.ts`): world는 act를 가져오지 않는다. 말 답 표는 공용 표 `src/act/prompts.ts`, 행동 조건은 공용 표 `src/act/tasks.ts`.
  - 실제 폰 명령은 사람에게 하는 말이고 「주세요」로 끝난다. 질문은 「?」로 끝난다(「컵 비었어요?」).
  - 영상 모드 같은 구조: 실행 추적·폰 묶음에 영상 갈래를 두지 않는다.
  - 새 화면 자리 만들지 않기: 질문은 지금 명령 줄(`Run.asking`·`r.sent`)로만 간다.
  - 화면 글 규칙: 서버 글(`src/act/labels.ts`·`src/act/prompts.ts`·`src/world/labels.ts`·`src/world/vocab.ts`)은 60자 아래, 화살표·괄호 없음, 상태와 할 일만.
  - 바깥 글 자르기는 `headWithin`만.
  - 승인 규칙 그대로: 질문은 승인 질문을 덮지 않고, 승인 답(승인·거절)과 섞지 않는다.
- PAM 지시문(논문 프롬프트·시나리오)은 바꾸지 않는다. 관찰 텍스트의 내용물 줄 표기만 맞춘다.
- 질문·답은 말로만: 질문 명령의 `choices`는 빈 목록(단추 없음), 등급 `question`, 답은 `Answers.onHeard` 한 길.

## 정한 값

| 이름 | 값 | 자리 |
|---|---|---|
| 확인 사진 수 | 서로 다른 원본 프레임 3장 | `CONTENTS_CONFIRM.photos` |
| 확인 시간 | 첫 사진과 마지막 사진 촬영 4초 이상 | `CONTENTS_CONFIRM.spanMs` |
| 최대 관측 공백 | 이웃 사진 사이 6초 넘으면 처음부터 | `CONTENTS_CONFIRM.gapMs` |
| 후보 충돌 | 확인 값과 반대 값이 최신 사진에서 2장 넘게 이어짐 | `CONTENTS_CONFIRM.conflict` |
| 입에 댐 | 든 컵 상자와 얼굴 점 거리 ≤ scale × 0.5 | `MOUTH_NEAR` |
| 기운 병 | 든 병 상자 가로/세로 ≥ 0.8, 컵 위쪽 가까이 | `POUR_TILT` |
| 보류: 가까이 보기 기다림 | 3초 | `CONTENTS_HOLD.lookWaitMs` |
| 보류: 사진 기다림 | 가까이 본 뒤 4초 | `CONTENTS_HOLD.settleMs` |
| 보류 한도(묻지 못할 때) | 30초 | `CONTENTS_HOLD.holdMs` |
| 답 없음 뒤 다시 묻기 | 같은 컵 60초 뒤 | `CONTENTS_HOLD.retryMs` |
| 질문 답 기다림 | 2분(승인 질문과 같은 `askMs`), 30초마다 다시 읽음 | `TRACK_DEFAULTS` |

## File Structure

| 파일 | 일 |
|---|---|
| `src/act/prompts.ts` | 내용물 질문 말 답 표 `CONTENTS_CHOICES`, `contentsAnswer` |
| `src/world/vocab.ts`, `src/world/vocab-doc.ts`, `scripts/world-vocab-doc.ts`, `docs/world-vocabulary.md`, `src/observe/scene.ts`, `src/world/conditions.ts` | 면 `body`(속이 비침·불투명) |
| `src/world/state/contents.ts`(새로) | 내용물 갱신기 `ContentsBook` |
| `src/world/state/core.ts`, `facts.ts`, `closer.ts`, `world.ts`, `src/contract/world.ts`, `src/world/labels.ts` | 갱신기 잇기, 공개 API(`answerContents`·`contentsAction`), 보기 칸(`contents_gen`·`contents_past`·`WorldFact.by`), 변화 글 |
| `src/world/pose.ts`, `src/world/sip.ts`(새로), `src/world/state/people.ts` | 얼굴 점, 마시기·따르기 사건 |
| `src/world/conditions.ts`, `src/world/text.ts` | 내용물 조건은 확인됨만, 관찰 텍스트 표기 |
| `src/act/tasks.ts`, `src/act/check.ts`, `src/act/labels.ts`, `src/act/look.ts` | 행동 조건 `want`, 검사, B |
| `src/act/track/contents.ts`(새로), `core.ts`, `start.ts`, `approval.ts`, `answers.ts`, `steps.ts`, `tracker.ts`, `src/act/ask-step.ts`(새로), `src/act/talk-grade.ts`, `src/act/say.ts` | 보류·질문·답, 따르기 창 |
| `src/act/look.ts`, `src/observe/pipeline.ts`, `src/server/home/act.ts` | 보류의 가까이 보기, 방송 길, 잇기 |
| `src/act/track/contents.ts`, `core.ts`(`idleAsk`), `answers.ts`, `tracker.ts`(`tasks`·`lookedIdle`), `src/act/look.ts`(`looked`), `src/server/home/act.ts` | 계획 밖 질문(B 끝에 묻기, 묶음 11) |
| `tests/contents-answer.test.ts`(새로), `tests/world-contents.test.ts`(새로), 기존 시험 | 시험 |
| `docs/reference.md` | 저장소 설명 |

---

### Task 1: 말 답 맞추기(말 시험 먼저) · 규칙 표 한 줄

**Files:**
- Create: `tests/contents-answer.test.ts`, `tests/voice-answers.test.ts`
- Modify: `src/act/prompts.ts`, `src/act/tasks.ts`(`matchChoice` whole), `CLAUDE.md`(규칙 표 한 줄)

**Interfaces:**
- Produces:

```ts
// src/act/prompts.ts
/** 내용물 질문의 답 하나: 맞으면 그 값. */
export interface ContentsChoice extends ActionChoice { value: "empty" | "has_contents" }
export const CONTENTS_CHOICES: readonly ContentsChoice[];
/** 폰에서 들은 말 → 내용물 답(없으면 null). 말 전체가 받는 답 문장일 때만. */
export function contentsAnswer(text: string): ContentsChoice | null;
/** 실제 폰 질문의 답 묶음 전부(말 답 시험이 본다). 새 질문 답 묶음은 여기에 더한다. */
export const QUESTION_CHOICES: Readonly<Record<string, readonly ActionChoice[]>>;
```

- [ ] **Step 1: 실패하는 말 시험**

```ts
// tests/contents-answer.test.ts
// 내용물 질문(「컵 비었어요?」)의 말 답: 폰은 소리로 묻고 사람은 말로 답한다(단추 없음). 말 전체가 받는 답 문장일 때만 받는다
// (앞의 응·네·어, 「아니」 뒤 남음 답, 끝의 요는 된다). 부분 일치로 「시간 없어」「비어 있지 않아」를 빈 컵으로 읽지 않는다.
import { describe, expect, it } from "vitest";
import { CONTENTS_CHOICES, contentsAnswer } from "../src/act/prompts.js";

const value = (t: string) => contentsAnswer(t)?.value ?? null;

describe("내용물 질문의 말 답", () => {
  it.each([
    "비었어", "비었어요", "다 마셨어", "다 마셨어요.", "없어", "물 없어요", "텅 비었어", "비어 있어", "하나도 없어", "안 남았어", "다 먹었어",
    "응", "네", "네 비었어요", "어 다 마셨어",
  ])("「%s」는 비어 있음", (t) => expect(value(t)).toBe("empty"));

  it.each([
    "남았어", "아직 있어", "조금 있어", "좀 남았어요", "있어", "반쯤 남았어", "안 비었어", "아직 안 마셨어", "덜 마셨어",
    "아니", "아니요", "아니 남았어", "아뇨 아직 있어요", "안 비어 있어",
  ])("「%s」는 내용물 있음", (t) => expect(value(t)).toBe("has_contents"));

  it.each([
    "", "TV 켜 줘", "라면 먹을래", "응 그래서 내일", "완료", "마셨어", "시간 없어", "비어 있지 않아", "다 마셨어? 아니", "아니 비었어",
    "물 마실래", "컵 어디 있어", "있어 봐", "없어진 줄 알았어", "그만해",
  ])("「%s」는 답이 아니다", (t) => expect(value(t)).toBeNull());

  it("답마다 읽어 줄 글이 있고(서버 글 규칙: 60자 아래, 괄호·화살표 없음) 답 id가 겹치지 않는다", () => {
    for (const c of CONTENTS_CHOICES) {
      expect(c.reply).toBe("알겠어요");
      expect(c.label.length).toBeLessThan(60);
      expect(c.label).not.toMatch(/[()→]/);
      expect(c.whole).toBe(true);
    }
    expect(new Set(CONTENTS_CHOICES.map((c) => c.id)).size).toBe(CONTENTS_CHOICES.length);
  });
});
```

```ts
// tests/voice-answers.test.ts
// 실제 폰 질문은 말로 답할 수 있다(단추는 보조). 질문 답 묶음(src/act/prompts.ts QUESTION_CHOICES)마다 답 하나하나를 그 글자(label)로 말하면
// 그 답으로 맞아야 한다(src/act/tasks.ts matchChoice, 실행 추적 onHeard와 같은 길). 2026-11-17 이전 matchChoice는 「네」 한 마디를 앞말로 지워
// yes_no 질문에 말로 답할 수 없었다: 그 실수에서 이 시험이 실패한다.
import { describe, expect, it } from "vitest";
import { ASK_CHOICES, QUESTION_CHOICES } from "../src/act/prompts.js";
import { matchChoice } from "../src/act/tasks.js";

describe("실제 폰 질문은 말로 답할 수 있다", () => {
  it.each(Object.entries(QUESTION_CHOICES))("%s: 답마다 그 글자로 말하면 그 답이다", (_, choices) => {
    for (const c of choices) expect(matchChoice(c.label, choices)?.id, c.label).toBe(c.id);
  });
  it("묶음에는 지금 쓰는 질문 답이 다 있다(물어보기 답 묶음·승인·다시 묻기·내용물)", () => {
    expect(Object.keys(QUESTION_CHOICES).sort()).toEqual(["again", "approve", "clear_keep", "contents", "yes_no"]);
    expect(QUESTION_CHOICES.yes_no).toBe(ASK_CHOICES.yes_no);
  });
  it("「응」「네」만으로는 승인이 아니다(승인 말에 없음)", () => {
    expect(matchChoice("응", QUESTION_CHOICES.approve!)).toBeNull();
    expect(matchChoice("응 승인", QUESTION_CHOICES.approve!)?.id).toBe("approve");
  });
});
```

- [ ] **Step 2: 시험을 돌려 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/contents-answer.test.ts tests/voice-answers.test.ts`
Expected: FAIL (`CONTENTS_CHOICES`·`contentsAnswer`·`QUESTION_CHOICES`가 없음). 묶음을 더한 뒤에도 `yes_no`의 「네」가 실패하는지 본다(지금 실수를 잡는지).

- [ ] **Step 3: 구현**

```ts
// src/act/prompts.ts 끝에 더한다
import { matchChoice } from "./tasks.js"; // tasks.ts는 prompts.ts를 타입으로만 가져와 고리가 아니다. lint-domains가 고리를 말하면 contentsAnswer를 tasks.ts로 옮긴다

/** 내용물 질문의 답 하나: 맞으면 그 값. */
export interface ContentsChoice extends ActionChoice { value: "empty" | "has_contents" }
const OK = "알겠어요";
/** 받는 빈 컵 답 문장(띄어쓰기 없이). 말 전체가 이 문장이어야 한다(앞의 응·네·어, 끝의 요는 된다). */
const EMPTY_SAID = ["비었어", "비어있어", "다비었어", "텅비었어", "다마셨어", "다먹었어", "없어", "물없어", "하나도없어", "안남았어", "남은거없어", "남은게없어", "컵비었어"];
/** 받는 남음 답 문장. 앞에 「아니」「아뇨」가 붙어도 된다. */
const HAS_SAID = ["남았어", "남아있어", "아직있어", "조금있어", "좀있어", "있어", "물있어", "반쯤남았어", "조금남았어", "좀남았어", "아직남았어", "많이남았어", "안비었어", "안비어있어", "아직안마셨어", "덜마셨어"];
/** 내용물 질문(「컵 비었어요?」)의 말 답. 단추는 없다(폰은 말로만 묻고 말로만 받는다). 모두 말 전체가 답일 때만(whole) 맞는다. */
export const CONTENTS_CHOICES: readonly ContentsChoice[] = [
  { id: "empty", value: "empty", label: "비었어요", words: EMPTY_SAID, reply: OK, whole: true },
  { id: "has", value: "has_contents", label: "남았어요", words: [...HAS_SAID, ...HAS_SAID.map((w) => `아니${w}`), ...HAS_SAID.map((w) => `아뇨${w}`)], reply: OK, whole: true },
  { id: "yes", value: "empty", label: "네", words: ["네", "응", "예", "맞아"], reply: OK, whole: true },
  { id: "no", value: "has_contents", label: "아니요", words: ["아니", "아니요", "아뇨"], reply: OK, whole: true },
];

/** 폰에서 들은 말 → 내용물 답(없으면 null). */
export const contentsAnswer = (text: string): ContentsChoice | null => matchChoice(text, CONTENTS_CHOICES) as ContentsChoice | null;

/** 실제 폰 질문의 답 묶음 전부: 물어보기 답 묶음(ASK_CHOICES), 승인, 시간 초과 다시 묻기, 내용물. tests/voice-answers.test.ts가 답마다 말로 맞는지 본다. */
export const QUESTION_CHOICES: Readonly<Record<string, readonly ActionChoice[]>> = { ...ASK_CHOICES, approve: APPROVE, again: AGAIN, contents: CONTENTS_CHOICES };
```

`src/act/tasks.ts matchChoice`의 whole 맞추기는 앞말(`LEAD`: 응·어·네·예·자·이제)을 지운 글만 봐서 「네」「응」 한 마디가 빈 글이 되어 맞지 않는다(지금 `ASK_CHOICES.yes_no`도 같다). 앞말을 지우기 전 글도 본다:

```ts
const hit = (c: ActionChoice, w: string) => (c.whole ? TAIL.some((t) => core === squash(w) + t || said === squash(w) + t) : said.includes(squash(w)));
```

저장소 `CLAUDE.md` 규칙 표에 한 줄 더한다(사용자가 「단추로 누르게 하지 말고 말로」를 두 번 바로잡음):

```markdown
| 실제 폰 질문은 말로 답할 수 있다(단추는 보조). 새 질문은 지금 명령 줄로 보내고 그 답 말을 실행 추적 `choicesOf`에 둬 `onHeard`가 받는다. 답 묶음은 `src/act/prompts.ts` `QUESTION_CHOICES`에 더한다. | `tests/voice-answers.test.ts`(묶음마다 답 하나하나를 그 글자로 말하면 그 답인지, 지금 질문 답 묶음이 다 있는지. 2026-11-17 전 「네」를 앞말로 지워 말로 답할 수 없던 실수에서 실패)·`tests/contents-answer.test.ts`(내용물 질문 말 답과 부정문·상관없는 말). 묶음에 넣지 않은 새 질문은 못 잡는다(질문을 만들 때 `QUESTION_CHOICES`에 넣는다). |
```

- [ ] **Step 4: 시험 통과·lint**

Run: `npm run heavy -- npx vitest run tests/contents-answer.test.ts tests/voice-answers.test.ts tests/act-tasks.test.ts tests/act-track.test.ts`, `npm run heavy -- npm run lint`
Expected: PASS. 틀린 말이 있으면 받는 문장 목록만 고친다(시험 표는 고치지 않는다).

- [ ] **Step 5: 커밋·푸시**

```bash
git add tests/contents-answer.test.ts tests/voice-answers.test.ts src/act/prompts.ts src/act/tasks.ts CLAUDE.md
git commit -m "feat(act): match whole spoken answers to the cup contents question and check every phone question by voice"
git push origin refactor/domain-split
```

---

### Task 2: 낱말 표에 컵 면 「속이 비침·불투명」

**Files:**
- Modify: `src/world/vocab.ts`, `src/world/vocab-doc.ts`, `scripts/world-vocab-doc.ts`(FACET 이름표), `docs/world-vocabulary.md`(만든 표), `src/observe/scene.ts`, `src/world/conditions.ts`(`ALL_FACETS`)
- Test: `tests/world-vocab.test.ts`, `tests/world-state-vocab.test.ts`, `tests/observe-scene.test.ts`

**Interfaces:**
- Produces: `Facet`에 `"body"`, `StateKey`에 `"see_through"`·`"opaque"`. 컵·병·그릇(`VESSEL`) 면에 `body`.

- [ ] **Step 1: 실패하는 시험**

`tests/world-state-vocab.test.ts`에 더한다:

```ts
it("컵·병·그릇에는 몸통 면(속이 비침·불투명)이 있고 VLM 값 목록에 그 설명이 들어간다", () => {
  for (const cls of ["cup", "bottle", "bowl"] as const) expect(CLASSES[cls].facets).toContain("body");
  expect(STATES.see_through).toMatchObject({ facet: "body", label: "속이 비침", for: ["object"] });
  expect(STATES.opaque).toMatchObject({ facet: "body", label: "불투명", for: ["object"] });
  expect(SCENE_STATES).toEqual(expect.arrayContaining(["see_through", "opaque"]));
  expect(SCENE_PROMPT).toMatch(/Cup, bottle and bowl sides: see_through \(.+\), opaque \(.+\)\./);
});
```

`tests/world-conditions.test.ts`에 더한다: `parseCondition({ object: "cup_1", facts: { body: "opaque" } })`가 통과하고 `checkCondition`이 빈 목록, `{ object: "book_1", facts: { body: "opaque" } }`는 `book에 없는 면: body`.

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/world-state-vocab.test.ts tests/world-conditions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/world/vocab.ts
export type Facet = "place" | "contents" | "body" | "open" | "use" | "screen" | "posture" | "holding" | "activity" | "moment";
const VESSEL = ["place", "contents", "body", "use"] as const;
// STATES의 contents_unknown 다음
see_through: { facet: "body", label: "속이 비침", for: ["object"], hint: "clear or translucent sides that show the drink level, like a glass or clear plastic cup" },
opaque: { facet: "body", label: "불투명", for: ["object"], hint: "sides you cannot see through, like a ceramic mug, can or paper cup" },
```

```ts
// src/observe/scene.ts SCENE_PROMPT 「Objects.」 줄의 Contents 다음
`Cup, bottle and bowl sides: ${values("body", "object")}.`
```

```ts
// src/world/conditions.ts
const ALL_FACETS = ["place", "contents", "body", "open", "use", "screen", "posture", "holding", "activity", "moment"] as const satisfies readonly Facet[];
```

`src/world/vocab-doc.ts` `STATE_DOC`에 `see_through: { how: "옆면으로 안이 비쳐 보일 때", example: "유리컵이라 남은 물 높이가 보인다." }`, `opaque: { how: "옆면으로 안이 안 보일 때", example: "흰 머그라 옆에서는 안을 알 수 없다." }`. `scripts/world-vocab-doc.ts` `FACET`에 `body: "몸통"`. 그리고 `npm run heavy -- npx tsx scripts/world-vocab-doc.ts`로 문서 표를 다시 쓴다. `git diff docs/world-vocabulary.md`에서 이 집 가전 표가 바뀌었으면(다른 에이전트의 `twin/` 변경) 그 줄은 되돌리고 낱말 줄만 남긴다.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/world-state-vocab.test.ts tests/world-conditions.test.ts tests/world-vocab.test.ts tests/observe-scene.test.ts`, `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
Expected: PASS. `tests/world-vocab.test.ts`가 사실 수·면 수를 적어 두었으면 53개·10면으로 고친다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/world/vocab.ts src/world/vocab-doc.ts scripts/world-vocab-doc.ts docs/world-vocabulary.md src/observe/scene.ts src/world/conditions.ts tests/world-state-vocab.test.ts tests/world-conditions.test.ts tests/world-vocab.test.ts tests/observe-scene.test.ts
git commit -m "feat(world): add the see-through and opaque body facet for cups, bottles and bowls"
git push origin refactor/domain-split
```

---

### Task 3: 내용물 갱신기(확인 규칙 · 후보 충돌 · 불투명 · 사람 답 · 따르기 창)

**Files:**
- Create: `src/world/state/contents.ts`, `tests/world-contents.test.ts`
- Modify: `src/world/state/core.ts`(`Obj.contents`, `core.contents`), `src/world/state/facts.ts`(내용물 면은 갱신기로, body 뒤 다시 계산), `src/world/state/closer.ts`(가까이 본 답도 갱신기로), `src/world/state/world.ts`(공개 API·보기 칸), `src/contract/world.ts`(`WorldFact.by`, `WorldObject.contents_gen`·`contents_past`), `src/world/labels.ts`(변화 글)
- Test 고침: `tests/world-state.test.ts`·`tests/world-closer.test.ts`의 내용물 기대(두 번이면 확인됨 → 3장·4초). 일반 규칙(같은 원본 프레임 한 번, 잘라 본 답 먼저)을 보던 시험은 면을 `place`·`open`으로 바꾸고, 내용물 규칙 시험은 새 파일로 옮긴다.

**Interfaces:**
- Produces:

```ts
// src/contract/world.ts
export interface WorldFact { value: string; at_ms: number; since_ms: number; certainty: "confirmed" | "inferred"; closer_ms?: number;
  /** person: 사람이 말로 답한 값(src/world/state/contents.ts). 칸이 없으면 VLM·관절. */
  by?: "person" }
// WorldObject에 더한다
/** 내용물 세대: 확인 값이 정해지거나 바뀌거나 다시 열릴 때마다 오른다. 내용물을 쌓은 적 없으면 칸이 없다(0으로 본다). 질문·사람 답이 이 세대에 묶인다. */
contents_gen?: number;
/** 보관한 이전 확인 값(최근 것부터 3개). */
contents_past?: { value: "empty" | "has_contents"; by: "vlm" | "person"; at_ms: number }[];

// src/world/state/world.ts WorldState
/** 사람이 말로 답한 내용물. 물건이 없거나 세대가 지금과 다르면(늦은 답) null. */
answerContents(id: string, value: "empty" | "has_contents", atMs: number, gen: number): WorldChange[] | null;
/** 계획의 따르기 단계 창: on이면 확인 값을 보관하고 다시 열어(그 뒤 사진만) 다 이어진 값이 확인 값을 바꾸게 한다. off면 닫는다(값은 둔다). 물건이 없으면 false. */
contentsAction(id: string, atMs: number, on: boolean): boolean;

// src/world/state/contents.ts
export const CONTENTS_CONFIRM: { photos: 3; spanMs: 4000; gapMs: 6000; conflict: 2; keep: 12; past: 3 };
export class ContentsBook extends Part {
  see(obj: Obj, frameId: string, atMs: number, value: StateOf<"contents">, crop: boolean): { changes: WorldChange[]; changed: boolean };
  answer(obj: Obj, value: Sure, atMs: number, gen: number): WorldChange[] | null;
  reopen(obj: Obj, atMs: number, why: "drink" | "pour" | "step"): WorldChange[];
  window(obj: Obj, atMs: number, on: boolean): void;
  settle(obj: Obj): boolean; // facts.contents를 다시 쓴다. 바뀌었으면 true
}
```

- [ ] **Step 1: 실패하는 시험**

```ts
// tests/world-contents.test.ts
// 내용물 갱신기(src/world/state/contents.ts): 새 값은 서로 다른 사진 3장·4초(이웃 사진 6초 안)이거나 사람 답. 확인 값은 행동(사건·따르기 단계)으로만 다시 연다.
import { describe, expect, it } from "vitest";
import { WorldState } from "../src/world/state/world.js";
import { sha256 } from "../src/observe/ring.js";
import type { Detection, EngineFrame } from "../src/contract/observe.js";
import { det } from "./helpers/detectors.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);

/** 컵 하나를 1~3초에 등장 확인한 World State와 도우미. say: 그 초의 전체 사진 VLM 답, crop: 그 초 원본 프레임을 잘라 본 VLM 답. */
function scene() {
  const w = ws();
  let ids = new Map<string, string>();
  for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [cup]).ids;
  const obs = (states: string[]) => ({ scene: "k", observations: states.map((state) => ({ object_id: "d1", state })), summary: "s" });
  const say = (i: number, ...states: string[]) => w.applyScene(`e${i}`, i * 1000, obs(states), ids);
  const crop = (i: number, ...states: string[]) => w.applyCloserScene(`e${i}`, i * 1000, obs(states), ids);
  const cupNow = () => w.view(99_000).objects[0]!;
  const lines = (c: { kind: string; text: string; meaningful: boolean }[]) => c.filter((x) => x.kind === "state").map((x) => [x.text, x.meaningful]);
  return { w, say, crop, cupNow, lines };
}

describe("내용물 확인", () => {
  it("같은 값이 서로 다른 사진 3장이고 처음과 마지막이 4초 넘게 이어져야 확인됨이다. 그 전은 짐작이고 변화 줄이 없다", () => {
    const s = scene();
    expect(s.lines(s.say(1, "empty"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred", since_ms: 1000 });
    s.say(2, "empty");
    s.say(3, "empty"); // 3장이지만 2초
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    expect(s.lines(s.say(5, "empty"))).toEqual([["컵 cup_1 비어 있음", true]]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", since_ms: 1000, at_ms: 5000 });
    expect(s.cupNow().contents_gen).toBe(1);
  });

  it("같은 원본 프레임은 한 장으로 센다(전체 사진과 잘라 본 답, 같은 답을 두 번)", () => {
    const s = scene();
    s.say(1, "empty"); s.crop(1, "empty"); s.say(1, "empty");
    s.say(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    s.say(6, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("같은 원본 프레임이면 잘라 본 답이 전체 사진 답보다 앞선다(오는 차례와 상관없이)", () => {
    const s = scene();
    s.crop(1, "has_contents"); s.say(1, "empty"); s.say(3, "has_contents"); s.say(5, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  });

  it("확인을 받치던 사진이 같은 원본 프레임의 잘라 본 답으로 반대가 되면 바뀐 근거로 다시 센다: 다 이어진 묶음이 없으면 확인을 거둔다(세대 +1)", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    expect(s.cupNow()).toMatchObject({ contents_gen: 1, facts: { contents: { value: "empty", certainty: "confirmed" } } });
    s.crop(3, "has_contents");
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, facts: { contents: { value: "empty", certainty: "inferred" } } });
    // 받치는 사진이 다시 다 이어지면 확인
    s.say(6, "empty"); s.say(9, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("이웃 사진 사이가 6초 넘으면 처음부터 센다", () => {
    const s = scene();
    s.say(1, "empty"); s.say(2, "empty"); s.say(9, "empty"); s.say(10, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred", since_ms: 9000 });
    s.say(13, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "confirmed", since_ms: 9000 });
  });

  it("확인된 값은 반대 값 한 장으로 바뀌지 않는다. 반대 값이 두 장 넘게 이어지면 짐작으로 낮추고(실행에서 모름) 다 이어져도 바꾸지 않는다. 같은 값이 다시 오면 확인됨", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    s.say(6, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    s.say(7, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    for (const i of [9, 11, 13]) expect(s.lines(s.say(i, "has_contents"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    expect(s.cupNow().contents_gen).toBe(1);
    s.say(14, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("안이 안 보임 답은 후보가 아니다: 확인을 끊지 않고, 아무 값도 없을 때만 짐작 「안이 안 보임」이다", () => {
    const s = scene();
    s.say(1, "contents_unknown");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "inferred" });
    s.say(2, "empty"); s.say(3, "contents_unknown"); s.say(4, "empty"); s.say(6, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
});

describe("사람 답", () => {
  it("지금 세대의 답은 확인 값(출처 사람)이고 판단 계기다. 그 뒤 VLM 답은 받지 않는다. 늦은 세대의 답은 버린다", () => {
    const s = scene();
    s.say(1, "has_contents");
    const gen = s.cupNow().contents_gen ?? 0;
    expect(s.w.answerContents("cup_1", "empty", 6000, gen + 1)).toBeNull();
    expect(s.w.answerContents("cup_9", "empty", 6000, gen)).toBeNull();
    expect(s.w.answerContents("cup_1", "empty", 6000, gen)).toEqual([expect.objectContaining({ kind: "state", subject: "cup_1", text: "컵 cup_1 비어 있음 · 사람이 답함", meaningful: true })]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", by: "person", since_ms: 6000 });
    for (const i of [7, 9, 11, 13]) s.say(i, "has_contents");
    s.say(5, "has_contents"); // 답 앞에 찍힌 늦은 사진
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", by: "person", certainty: "confirmed" });
    expect(s.w.answerContents("cup_1", "has_contents", 14_000, gen)).toBeNull(); // 같은 질문의 두 번째 답
  });
});

describe("불투명 컵", () => {
  it("불투명이 확인되면 VLM 내용물 답을 쓰지 않고 「안이 안 보임」(확인됨)이다. 사람 답은 받는다", () => {
    const s = scene();
    s.say(1, "opaque", "has_contents"); s.say(2, "opaque");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    for (const i of [3, 5, 7]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    s.w.answerContents("cup_1", "empty", 8000, s.cupNow().contents_gen ?? 0);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", by: "person" });
  });
  it("불투명 한 장(짐작)으로는 VLM 답을 버리지 않는다", () => {
    const s = scene();
    s.say(1, "opaque", "empty"); s.say(3, "empty"); s.say(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
});

describe("따르기 창(계획의 따르기 단계)", () => {
  it("열면 확인 값을 보관하고 짐작으로 낮춘다(세대 +1). 연 뒤 찍힌 사진만 쓰고, 창 안에서는 다 이어진 반대 값이 확인 값을 바꾼다. 닫아도 값은 남는다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    expect(s.w.contentsAction("cup_1", 6000, true)).toBe(true);
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, contents_past: [{ value: "empty", by: "vlm", at_ms: 5000 }] });
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    s.say(5, "has_contents"); // 연 앞에 찍힘: 버림
    for (const i of [7, 9]) s.say(i, "empty");
    s.say(11, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    for (const i of [12, 14]) s.say(i, "has_contents");
    expect(s.lines(s.say(16, "has_contents"))).toEqual([["컵 cup_1 내용물 있음", true]]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    s.w.contentsAction("cup_1", 17_000, false);
    for (const i of [18, 20, 22]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    expect(s.w.contentsAction("cup_9", 1, true)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/world-contents.test.ts`
Expected: FAIL (`answerContents`·`contentsAction` 없음, 두 번이면 확인됨)

- [ ] **Step 3: 갱신기 구현**

```ts
// src/world/state/contents.ts
// World State의 내용물(컵·병·그릇 안) 갱신기 하나: 전체 사진 VLM 답(facts.ts)·가까이 본 VLM 답(closer.ts)·사람 답·마시기 따르기 사건(people.ts)·
// 계획의 따르기 단계 창이 모두 여기로 온다. 물건의 facts.contents는 여기서만 쓴다.
// - 확인: 서로 다른 원본 프레임 사진에서 같은 값이 CONTENTS_CONFIRM.photos장, 처음과 마지막 촬영이 spanMs 이상, 이웃 사진 사이 gapMs 이하로 이어지면 확인 값.
//   같은 원본 프레임은 한 장이다(잘라 본 답이 전체 사진 답보다 앞선다). 「안이 안 보임」 답은 후보가 아니다.
// - 확인 값은 행동으로만 바꾼다: 사건·창이 「다시 확인 필요」로 열고(이전 값은 보관, 그 전에 찍힌 사진은 버림) 그 뒤 다 이어진 값이 새 확인 값이다.
//   열린 창이 아니면 반대 값 한 장은 무시하고, conflict장 넘게 이어지면 확인 값을 짐작으로 낮춘다(실행에서 모름). 다 이어져도 확인 값은 바꾸지 않는다.
// - 사람 답은 확인 값(출처 사람)이다. 다음 사건 전까지 VLM 답을 받지 않는다. 답은 지금 세대일 때만 받는다(늦은 답은 null).
// - 확인된 불투명(body opaque) 컵은 VLM 답을 쓰지 않고 「안이 안 보임」(확인됨)이다. 사람 답이 앞선다.
// - 세대(gen)는 확인 값이 정해지거나 바뀌거나 다시 열릴 때 오른다. 변화 줄: 확인·사람 답은 판단 계기, 다시 열림은 계기 아닌 줄, 짐작 변화는 줄 없음.
import type { WorldChange, WorldFact } from "../../contract/world.js";
import { CHANGE_TEXT } from "../labels.js";
import type { StateOf } from "../vocab.js";
import { Part, type Obj } from "./core.js";

export const CONTENTS_CONFIRM = { photos: 3, spanMs: 4000, gapMs: 6000, conflict: 2, keep: 12, past: 3 } as const;

export type Sure = "empty" | "has_contents";
type Value = StateOf<"contents">;
interface Photo { frame: string; at: number; value: Value; crop: boolean }
export interface ContentsState {
  /** 확인 값. frames: 그 값을 확인한 사진들의 원본 프레임(사람 답이면 빈 목록). */
  sure: { value: Sure; by: "vlm" | "person"; sinceMs: number; atMs: number; frames: string[] } | null;
  photos: Photo[];
  /** 이보다 앞서 찍힌 사진은 받지 않는다(다시 연 때·사람 답 때). */
  from: number;
  window: boolean;
  gen: number;
  past: { value: Sure; by: "vlm" | "person"; atMs: number }[];
}
const SURE: ReadonlySet<string> = new Set<Sure>(["empty", "has_contents"]);
const isSure = (v: string): v is Sure => SURE.has(v);

interface Streak { value: Sure; count: number; first: number; last: number; frames: string[] }
/** 확인 가능 값 사진(촬영 순)을 같은 값이 이웃 gapMs 안으로 이어진 묶음들로 나눈다. */
function streaks(photos: readonly Photo[]): Streak[] {
  const out: Streak[] = [];
  for (const p of photos) {
    if (!isSure(p.value)) continue;
    const cur = out.at(-1);
    if (cur && cur.value === p.value && p.at - cur.last <= CONTENTS_CONFIRM.gapMs) Object.assign(cur, { count: cur.count + 1, last: p.at, frames: [...cur.frames, p.frame] });
    else out.push({ value: p.value, count: 1, first: p.at, last: p.at, frames: [p.frame] });
  }
  return out;
}
/** 최신 사진의 묶음. 없으면 null. */
const streakOf = (photos: readonly Photo[]): Streak | null => streaks(photos).at(-1) ?? null;
const complete = (s: Streak | null) => !!s && s.count >= CONTENTS_CONFIRM.photos && s.last - s.first >= CONTENTS_CONFIRM.spanMs;

export class ContentsBook extends Part {
  private state(obj: Obj): ContentsState {
    return (obj.contents ??= { sure: null, photos: [], from: Number.NEGATIVE_INFINITY, window: false, gen: 0, past: [] });
  }

  private opaque(obj: Obj): boolean {
    const b = obj.facts.body;
    return b?.value === "opaque" && b.certainty === "confirmed";
  }

  private keepPast(s: ContentsState): void {
    if (s.sure) s.past = [{ value: s.sure.value, by: s.sure.by, atMs: s.sure.atMs }, ...s.past].slice(0, CONTENTS_CONFIRM.past);
  }

  see(obj: Obj, frameId: string, atMs: number, value: Value, crop: boolean): { changes: WorldChange[]; changed: boolean } {
    const s = this.state(obj);
    if (s.sure?.by === "person" || atMs < s.from || this.opaque(obj)) return { changes: [], changed: false };
    const same = s.photos.findIndex((p) => p.frame === frameId);
    const replaced = same >= 0 ? s.photos[same]! : null;
    if (replaced) {
      if (replaced.crop && !crop) return { changes: [], changed: false };
      s.photos.splice(same, 1);
    }
    s.photos.push({ frame: frameId, at: atMs, value, crop });
    s.photos.sort((a, b) => a.at - b.at);
    if (s.photos.length > CONTENTS_CONFIRM.keep) s.photos.splice(0, s.photos.length - CONTENTS_CONFIRM.keep);
    // 확인 값을 받치던 사진이 다른 값으로 바뀌었다(같은 원본 프레임의 잘라 본 답): 바뀐 근거로 다시 셈해 다 이어진 묶음이 없으면 확인을 거둔다
    if (s.sure?.by === "vlm" && replaced && replaced.value !== value && s.sure.frames.includes(frameId)
      && !streaks(s.photos).some((x) => x.value === s.sure!.value && complete(x))) {
      s.sure = null;
      s.gen++;
    }
    const changes: WorldChange[] = [];
    const run = streakOf(s.photos);
    if (run && complete(run)) {
      if (!s.sure || (s.sure.value !== run.value && s.window)) {
        this.keepPast(s);
        s.sure = { value: run.value, by: "vlm", sinceMs: run.first, atMs: run.last, frames: run.frames };
        s.gen++;
        changes.push({ kind: "state", at_ms: atMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.core.name(obj), run.value) });
      } else if (s.sure.value === run.value) Object.assign(s.sure, { atMs: Math.max(s.sure.atMs, run.last), frames: [...new Set([...s.sure.frames, ...run.frames])] });
    }
    return { changes, changed: this.settle(obj) };
  }

  answer(obj: Obj, value: Sure, atMs: number, gen: number): WorldChange[] | null {
    const s = this.state(obj);
    if (s.gen !== gen) return null;
    this.keepPast(s);
    Object.assign(s, { sure: { value, by: "person", sinceMs: atMs, atMs, frames: [] }, photos: [], from: atMs, gen: s.gen + 1 });
    this.settle(obj);
    return [{ kind: "state", at_ms: atMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.contentsAnswered(this.core.name(obj), value) }];
  }

  reopen(obj: Obj, atMs: number, why: "drink" | "pour" | "step"): WorldChange[] {
    const s = this.state(obj);
    // 사람 답·앞서 연 때보다 먼저(같은 때 포함) 찍힌 사건(대기열에서 늦게 나온 관절 결과)은 버린다
    if (atMs <= s.from) return [];
    const had = s.sure;
    this.keepPast(s);
    Object.assign(s, { sure: null, from: Math.max(s.from, atMs), gen: s.gen + 1 });
    s.photos = s.photos.filter((p) => p.at >= atMs);
    this.settle(obj);
    // 확인 값이 있다가 열렸을 때만 줄 하나(입에 댄 채 몇 장 이어져도 한 줄)
    return had ? [{ kind: "state", at_ms: atMs, subject: obj.id, meaningful: false, text: CHANGE_TEXT.contentsAgain(this.core.name(obj), why) }] : [];
  }

  window(obj: Obj, atMs: number, on: boolean): void {
    if (on) this.reopen(obj, atMs, "step");
    this.state(obj).window = on;
  }

  /** facts.contents를 지금 상태로 다시 쓴다(사람 답 > 불투명 > 확인 값(반대 후보가 이어지면 짐작) > 후보 짐작 > 보관 값 짐작 > 「안이 안 보임」 짐작). 바뀌었으면 true. */
  settle(obj: Obj): boolean {
    // 내용물 답이 한 번도 없어도 불투명이 확인되면 「안이 안 보임」을 둔다
    const s = obj.contents ?? (this.opaque(obj) ? this.state(obj) : null);
    if (!s) return false;
    const before = obj.facts.contents;
    const next = this.effective(obj, s);
    if (next) obj.facts.contents = next;
    else delete obj.facts.contents;
    return before?.value !== next?.value || before?.certainty !== next?.certainty || before?.since_ms !== next?.since_ms;
  }

  private effective(obj: Obj, s: ContentsState): WorldFact | undefined {
    const sure = s.sure;
    if (sure?.by === "person") return { value: sure.value, at_ms: sure.atMs, since_ms: sure.sinceMs, certainty: "confirmed", by: "person" };
    const body = obj.facts.body;
    if (this.opaque(obj)) return { value: "contents_unknown", at_ms: body!.at_ms, since_ms: body!.since_ms, certainty: "confirmed" };
    const run = streakOf(s.photos);
    if (sure) {
      const against = !!run && run.value !== sure.value && run.count >= CONTENTS_CONFIRM.conflict;
      return { value: sure.value, at_ms: sure.atMs, since_ms: sure.sinceMs, certainty: against ? "inferred" : "confirmed" };
    }
    if (run) return { value: run.value, at_ms: run.last, since_ms: run.first, certainty: "inferred" };
    const last = s.past[0];
    if (last) return { value: last.value, at_ms: last.atMs, since_ms: last.atMs, certainty: "inferred" };
    const unknown = s.photos.at(-1);
    return unknown ? { value: unknown.value, at_ms: unknown.at, since_ms: unknown.at, certainty: "inferred" } : undefined;
  }
}
```

- [ ] **Step 4: 잇기**

`src/world/state/core.ts`: `Obj`에 `contents: ContentsState | null`(만들 때 null), `WorldCore`에 `contents!: ContentsBook`. `world.ts` 생성자에서 `core.contents = new ContentsBook(core)`.

`src/world/state/facts.ts applyScene` 관찰 고리에서 `facet` 계산 뒤:

```ts
if (target.kind === "object" && facet === "contents") {
  const obj = core.objects.get(id)!;
  const { changes: c } = core.contents.see(obj, frameId, capturedAtMs, value as StateOf<"contents">, false);
  if (obj.confirmed && obj.status !== "gone") changes.push(...c);
  continue;
}
```

같은 고리에서 `body` 답을 받은 물건은(값이 그대로여도: 두 번째 같은 값이 확인됨으로 올린다) `answer` 앞에서 모아 두고 고리 끝에 `core.contents.settle(obj)`를 부른다(불투명이 확인되면 「안이 안 보임」으로).

`src/world/state/closer.ts applyCloserScene` 관찰 고리에서 `facet === "contents"`면 `core.contents.see(obj, sourceFrameId, capturedAtMs, value, true)`를 부르고, `changed`면 `obj.closerRev.contents = (obj.closerRev.contents ?? 0) + 1`, `obj.facts.contents = { ...obj.facts.contents!, closer_ms: capturedAtMs }`, 줄은 `changes`를 그대로 더한다(`answer`는 부르지 않는다). body면 위와 같이 `settle`.

`src/world/state/world.ts`:

```ts
answerContents(id: string, value: "empty" | "has_contents", atMs: number, gen: number): WorldChange[] | null {
  const obj = this.core.objects.get(id);
  return obj ? this.core.contents.answer(obj, value, atMs, gen) : null;
}
contentsAction(id: string, atMs: number, on: boolean): boolean {
  const obj = this.core.objects.get(id);
  if (!obj) return false;
  this.core.contents.window(obj, atMs, on);
  return true;
}
```

`view`의 물건에 `...(x.contents ? { contents_gen: x.contents.gen, ...(x.contents.past.length ? { contents_past: x.contents.past.map((p) => ({ value: p.value, by: p.by, at_ms: p.atMs })) } : {}) } : {})`.

`src/world/labels.ts CHANGE_TEXT`:

```ts
/** 사람이 말로 답한 내용물(판단 계기). */
contentsAnswered: (name: string, value: string) => `${name} ${STATE_TEXT[value] ?? value} · ${ANSWERED}`,
/** 마시기·따르기 사건이나 따르기 단계로 내용물을 다시 확인한다(판단 계기 아님). */
contentsAgain: (name: string, why: "drink" | "pour" | "step") => `${name} ${AGAIN_WHY[why]} · 내용물 다시 확인`,
// 파일 위쪽
/** 사람이 말로 답한 값의 꼬리(변화 줄·[지속] 줄). */
export const ANSWERED = "사람이 답함";
const AGAIN_WHY = { drink: "입에 댐", pour: "따르는 모습", step: "따르기 단계" } as const;
```

- [ ] **Step 5: 시험 통과·기존 시험 맞추기**

Run: `npm run heavy -- npx vitest run tests/world-contents.test.ts tests/world-state.test.ts tests/world-closer.test.ts`
Expected: 새 시험 PASS. `world-state.test.ts:68-83`·`world-closer.test.ts`에서 내용물 두 번 = 확인됨을 기대하던 줄은 새 규칙(3장·4초, 짐작 변화는 줄 없음)으로 고치거나, 같은 원본 프레임 규칙을 보던 시험은 면을 `open`(책 `book` 감지) 또는 `place`로 바꾼다. 고친 줄마다 무엇을 보는 시험인지는 그대로 둔다.

- [ ] **Step 6: 타입·lint**

Run: `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
Expected: PASS

- [ ] **Step 7: 커밋·푸시**

```bash
git add src/world/state/contents.ts src/world/state/core.ts src/world/state/facts.ts src/world/state/closer.ts src/world/state/world.ts src/contract/world.ts src/world/labels.ts tests/world-contents.test.ts tests/world-state.test.ts tests/world-closer.test.ts
git commit -m "feat(world): confirm cup contents only from 3 photos over 4s or a spoken answer"
git push origin refactor/domain-split
```

---

### Task 4: 마시기·따르기 사건(관절)

**Files:**
- Create: `src/world/sip.ts`
- Modify: `src/world/pose.ts`(`PoseInfo.face`, `toBox` 내보내기), `src/world/state/people.ts`(사건 → `core.contents.reopen`)
- Test: `tests/world-pose.test.ts`, `tests/world-contents.test.ts`

**Interfaces:**
- Consumes: Task 3 `ContentsBook.reopen(obj, atMs, why)`
- Produces:

```ts
// src/world/pose.ts
export interface PoseInfo { /* 있던 칸 */ face: Pt | null }
export const toBox: (p: Pt, b: Box) => number;
// src/world/sip.ts
export const MOUTH_NEAR = 0.5;
export const POUR_TILT = 0.8;
export function atMouth(people: readonly PoseInfo[], box: Box): boolean;
export function pouringInto(people: readonly PoseInfo[], bottle: Box, cup: Box): boolean;
```

- [ ] **Step 1: 실패하는 시험**

`tests/world-pose.test.ts`:

```ts
it("얼굴 점은 코·눈·귀 가운데 보이는 것의 평균이고, 없으면 null", () => {
  expect(describePose(standing({ 0: [130, 60, 0.9], 1: [126, 56, 0.9], 2: [134, 56, 0.2] })).face).toEqual([128, 58]);
  expect(describePose(standing()).face).toBeNull();
});
```

`tests/world-contents.test.ts`:

```ts
import { atMouth, pouringInto } from "../src/world/sip.js";
import { describePose } from "../src/world/pose.js";
import { standing } from "./helpers/poses.js";

// 서 있는 사람(어깨 너비 40, 몸통 100 → scale 60). 컵 상자 [220,160,40,20], 손목이 그 안이면 든 것이다
const CUP_BOX: [number, number, number, number] = [220, 160, 40, 20];
const drinker = describePose(standing({ 9: [230, 170, 0.9], 0: [240, 150, 0.9] }));
const waist = describePose(standing({ 9: [230, 170, 0.9], 0: [130, 40, 0.9] }));
const BOTTLE_TILT: [number, number, number, number] = [215, 100, 60, 40];
const BOTTLE_UP: [number, number, number, number] = [225, 70, 25, 70];
const pourer = describePose(standing({ 10: [240, 120, 0.9] }));

describe("마시기·따르기 사건", () => {
  it("입에 댐: 컵을 든 손목이 있고 얼굴 점이 컵 상자에서 scale × 0.5 안", () => {
    expect(atMouth([drinker], CUP_BOX)).toBe(true);
    expect(atMouth([waist], CUP_BOX)).toBe(false);
    expect(atMouth([describePose(standing({ 0: [240, 150, 0.9] }))], CUP_BOX)).toBe(false); // 들지 않음
  });
  it("따름: 든 병이 기울었고(가로/세로 0.8 이상) 컵 위쪽 가까이에서 가로로 겹친다", () => {
    expect(pouringInto([pourer], BOTTLE_TILT, CUP_BOX)).toBe(true);
    expect(pouringInto([describePose(standing({ 10: [237, 100, 0.9] }))], BOTTLE_UP, CUP_BOX)).toBe(false);
    expect(pouringInto([pourer], [400, 100, 60, 40], CUP_BOX)).toBe(false);
  });
  it("확인된 내용물 있음 컵을 입에 대면 「다시 확인 필요」로 열린다(이전 값 보관, 계기 아닌 줄 하나). 사건 앞에 찍힌 늦은 사진은 버리고 그 뒤 3장·4초가 새 값을 정한다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "has_contents");
    const person = det("person", 0.9, [80, 60, 200, 300], 0);
    const { changes } = s.w.applyDetections(frame(6), [person, cup], [standing({ 9: [230, 170, 0.9], 0: [240, 150, 0.9] })]);
    expect(changes.filter((c) => c.text.includes("내용물 다시 확인"))).toEqual([expect.objectContaining({ text: "컵 cup_1 입에 댐 · 내용물 다시 확인", meaningful: false })]);
    expect(s.cupNow()).toMatchObject({ contents_past: [{ value: "has_contents" }] });
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    s.w.applyDetections(frame(7), [person, cup], [standing({ 9: [230, 170, 0.9], 0: [240, 150, 0.9] })]); // 이어서 입에 댐: 줄 없음
    s.say(5, "empty"); // 사건 앞에 찍힌 늦은 답
    for (const i of [8, 10]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    s.say(12, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
  it("사람 답보다 먼저 찍힌 관절 사건(감지 대기열에서 늦게 나온 프레임)은 사람 답을 지우지 않고 세대도 올리지 않는다", () => {
    const s = scene();
    s.w.answerContents("cup_1", "empty", 6000, 0);
    const gen = s.cupNow().contents_gen;
    s.w.applyDetections(frame(5), [det("person", 0.9, [80, 60, 200, 300], 0), cup], [standing({ 9: [230, 170, 0.9], 0: [240, 150, 0.9] })]);
    expect(s.cupNow()).toMatchObject({ contents_gen: gen, facts: { contents: { value: "empty", certainty: "confirmed", by: "person" } } });
  });

  it("사람이 답한 값도 사건이 다시 연다", () => {
    const s = scene();
    s.w.answerContents("cup_1", "has_contents", 4000, 0);
    s.w.applyDetections(frame(6), [det("person", 0.9, [80, 60, 200, 300], 0), cup], [standing({ 9: [230, 170, 0.9], 0: [240, 150, 0.9] })]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    expect(s.cupNow().facts.contents?.by).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/world-pose.test.ts tests/world-contents.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/world/pose.ts describePose: 손목 다음
const FACE = [0, 1, 2, 3, 4] as const;
const facePts = FACE.map((i) => kp(k, i)).filter((x): x is Pt => x !== null);
const face: Pt | null = facePts.length ? [facePts.reduce((a, p) => a + p[0], 0) / facePts.length, facePts.reduce((a, p) => a + p[1], 0) / facePts.length] : null;
// info에 face를 넣는다. toBox는 export const로 바꾼다.
```

```ts
// src/world/sip.ts
// 마시기·따르기 사건(관절과 상자만 본다, 2026-11-17 설계). 사건은 확인된 내용물을 「다시 확인 필요」로 여는 데만 쓴다(src/world/state/contents.ts reopen).
// 얼굴 앞에 컵을 들거나 병을 들고 지나가거나 원근으로 겹쳐도 사건이 될 수 있다. 새 값은 사건이 아니라 그 뒤 사진(3장·4초)이나 사람 답이 정한다.
import { heldBy, toBox, type PoseInfo } from "./pose.js";

type Box = [number, number, number, number];
/** 얼굴 점이 든 물건 상자에서 사람 크기(scale) × 이만큼 안이면 입에 댄 것이다. */
export const MOUTH_NEAR = 0.5;
/** 병 상자의 가로/세로가 이만큼 이상이면 기운 병이다(세운 병은 0.3~0.5). */
export const POUR_TILT = 0.8;

/** 컵을 입에 댐: 그 상자를 든 손목이 있고 얼굴 점이 상자에서 scale × MOUTH_NEAR 안. */
export const atMouth = (people: readonly PoseInfo[], box: Box): boolean =>
  people.some((p) => p.face !== null && heldBy(p, box) !== null && toBox(p.face, box) <= p.scale * MOUTH_NEAR);

/** 병을 컵에 따름: 병을 들었고 기울었으며, 병이 컵보다 위에 있고 가로로 겹치며 병 아래가 컵 위에서 컵 높이 안. */
export function pouringInto(people: readonly PoseInfo[], bottle: Box, cup: Box): boolean {
  if (!people.some((p) => heldBy(p, bottle) !== null) || bottle[2] / Math.max(1, bottle[3]) < POUR_TILT) return false;
  const overlap = Math.min(bottle[0] + bottle[2], cup[0] + cup[2]) - Math.max(bottle[0], cup[0]);
  return overlap > 0 && bottle[1] < cup[1] && cup[1] - (bottle[1] + bottle[3]) <= cup[3];
}
```

```ts
// src/world/state/people.ts applyPose: held 목록을 만든 바로 뒤
const vessel = (o: Obj) => (CLASSES[o.cls].facets as readonly Facet[]).includes("contents");
const say = (obj: Obj, c: WorldChange[]) => { if (obj.confirmed && obj.status !== "gone") changes.push(...c); };
for (const { obj, box } of boxes) if (vessel(obj) && atMouth(people, box)) say(obj, core.contents.reopen(obj, at, "drink"));
for (const b of boxes.filter((x) => x.obj.cls === "bottle"))
  for (const c of boxes.filter((x) => x !== b && vessel(x.obj) && x.obj.cls !== "bottle")) if (pouringInto(people, b.box, c.box)) say(c.obj, core.contents.reopen(c.obj, at, "pour"));
```

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/world-pose.test.ts tests/world-contents.test.ts tests/world-state.test.ts tests/world-fall.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/world/sip.ts src/world/pose.ts src/world/state/people.ts tests/world-pose.test.ts tests/world-contents.test.ts
git commit -m "feat(world): reopen confirmed cup contents on drinking and pouring poses"
git push origin refactor/domain-split
```

---

### Task 5: 조건은 확인된 내용물만, 관찰 텍스트 표기

**Files:**
- Modify: `src/world/conditions.ts`(`factIs`), `src/world/text.ts`(사람 답 꼬리)
- Test: `tests/world-conditions.test.ts`, `tests/world-text.test.ts`

- [ ] **Step 1: 실패하는 시험**

`tests/world-conditions.test.ts`(이 파일의 World 만들기 도우미를 쓴다):

```ts
it("내용물 조건은 확인된 값만 참이다: 짐작이면 같은 값이어도 모름, 사람이 답한 값은 참. 다른 면의 짐작은 지금처럼 받는다", () => {
  const until = { object: "cup_1", follow: true, facts: { contents: "has_contents" } };
  const at = (certainty: "confirmed" | "inferred", by?: "person") => worldWith({ contents: { value: "has_contents", at_ms: 6000, since_ms: 6000, certainty, ...(by ? { by } : {}) } });
  expect(evaluate(until, at("inferred"), ctx)).toBeNull();
  expect(evaluate(until, at("confirmed"), ctx)).toBe(true);
  expect(evaluate(until, at("confirmed", "person"), ctx)).toBe(true);
  expect(evaluate({ object: "cup_1", facts: { place: "on_table" } }, worldWith({ place: { value: "on_table", at_ms: 6000, since_ms: 6000, certainty: "inferred" } }), ctx)).toBe(true);
  expect(evaluate({ not: until }, at("inferred"), ctx)).toBeNull();
});
```

(`worldWith(facts)`가 없으면 이 파일의 컵 하나 World 도우미에 facts 인자를 더한다. `ctx`는 `sinceMs: 5000, nowMs: 7000`.)

`tests/world-text.test.ts`:

```ts
it("사람이 답한 내용물 줄은 꼬리 「사람이 답함」, 불투명 컵은 「안이 안 보임」(짐작 아님)과 「불투명」 줄", () => {
  const text = textFromWorld(viewWith({ contents: { value: "empty", at_ms: 5000, since_ms: 5000, certainty: "confirmed", by: "person" } }), [], { nowMs: 9000, offsetMinutes: 0 });
  expect(text).toContain("[지속] 컵 cup_1 비어 있음: 00:00:05부터 4초째, 사람이 답함");
  const opaque = textFromWorld(viewWith({ body: { value: "opaque", at_ms: 5000, since_ms: 4000, certainty: "confirmed" }, contents: { value: "contents_unknown", at_ms: 5000, since_ms: 4000, certainty: "confirmed" } }), [], { nowMs: 9000, offsetMinutes: 0 });
  expect(opaque).toContain("[지속] 컵 cup_1 안이 안 보임: 00:00:04부터 5초째");
  expect(opaque).toContain("[지속] 컵 cup_1 불투명: 00:00:04부터 5초째");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/world-conditions.test.ts tests/world-text.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/world/conditions.ts factIs: if (f) 블록 맨 앞
// 내용물은 World State 갱신기(src/world/state/contents.ts)가 확인 규칙(3장·4초·사람 답)을 지킨 값만 확인됨으로 둔다. 짐작은 모름이다(따르기 끝 조건이 한 장으로 넘어가지 않게)
if (STATES[value].facet === "contents" && f.certainty !== "confirmed" && f.at_ms >= since) return null;
```

```ts
// src/world/text.ts 물건 사실 줄
lines.push(`${name} ${STATE_TEXT[f!.value] ?? f!.value}${f!.certainty === "inferred" ? `(${GUESS})` : ""}: ${at(f!.since_ms)}부터 ${lasting(o.nowMs - f!.since_ms)}${f!.by === "person" ? `, ${ANSWERED}` : ""}`);
```

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/world-conditions.test.ts tests/world-text.test.ts tests/pam-scenario.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/world/conditions.ts src/world/text.ts tests/world-conditions.test.ts tests/world-text.test.ts
git commit -m "feat(world): accept only confirmed contents in plan conditions and mark spoken answers in the PAM text"
git push origin refactor/domain-split
```

---

### Task 6: 행동 조건과 검사, 판단 전 보기 B

**Files:**
- Modify: `src/act/tasks.ts`(`TaskSpec.want`, `sureValue`·`wantOf`·`opaqueBody`), `src/act/check.ts`, `src/act/labels.ts`(`CHECK_TEXT`), `src/act/look.ts`(B)
- Test: `tests/act-tasks.test.ts`, `tests/act-check.test.ts`, `tests/act-look.test.ts`

**Interfaces:**
- Produces:

```ts
// src/act/tasks.ts
export interface TaskSpec { /* 있던 칸 */ want?: Partial<Record<Facet, StateKey>> }
/** 확인된 값: 사실이 확인됨이고 「모름」 값이 아니면 그 값, 아니면 null. */
export function sureValue(o: WorldObject, facet: Facet): StateKey | null;
/** 행동 조건(want)을 그 물건에 견준다. */
export function wantOf(spec: Pick<TaskSpec, "want">, o: WorldObject): { ok: true } | { ok: false; why: "mismatch" | "unknown"; facet: Facet };
/** 불투명이 확인된 물건(옆에서 안이 안 보임). */
export const opaqueBody: (o: WorldObject) => boolean;
// src/act/check.ts
export type CheckResult = { ok: true } | { ok: false; reason: CheckFail; text: string; carried?: true; object?: string };
// CHECK_TEXT에 contents_unknown·contents_mismatch
```

- [ ] **Step 1: 실패하는 시험**

`tests/act-tasks.test.ts`:

```ts
it("내용물을 보는 행동은 조건 값을 둔다(그대로 두기 = 내용물 있음, 채우기·콜라 = 비어 있음). 조건 면은 볼 면 안이다", () => {
  expect(TASKS["컵 그대로 두기"]!.want).toEqual({ contents: "has_contents" });
  expect(TASKS["컵에 물 채워 주기"]!.want).toEqual({ contents: "empty" });
  expect(TASKS["컵에 콜라 따라 주기"]!.want).toEqual({ contents: "empty" });
  for (const t of Object.values(TASKS)) for (const f of Object.keys(t.want ?? {})) expect(t.look).toContain(f);
});
it("wantOf: 확인된 같은 값 ok, 확인된 반대 값 mismatch, 짐작·안이 안 보임·없음 unknown", () => {
  const cupWith = (contents?: WorldFact) => ({ ...CUP, facts: contents ? { contents } : {} });
  const f = (value: string, certainty: "confirmed" | "inferred") => ({ value, at_ms: 1, since_ms: 1, certainty });
  const fill = TASKS["컵에 물 채워 주기"]!;
  expect(wantOf(fill, cupWith(f("empty", "confirmed")))).toEqual({ ok: true });
  expect(wantOf(fill, cupWith(f("has_contents", "confirmed")))).toEqual({ ok: false, why: "mismatch", facet: "contents" });
  expect(wantOf(fill, cupWith(f("empty", "inferred")))).toEqual({ ok: false, why: "unknown", facet: "contents" });
  expect(wantOf(fill, cupWith(f("contents_unknown", "confirmed")))).toEqual({ ok: false, why: "unknown", facet: "contents" });
  expect(wantOf(fill, cupWith())).toEqual({ ok: false, why: "unknown", facet: "contents" });
  expect(wantOf(TASKS["컵 치우기"]!, cupWith())).toEqual({ ok: true });
});
```

(`CUP`이 이 파일에 없으면 `tests/act-check.test.ts`의 `obj()`와 같은 모양으로 더한다.)

`tests/act-check.test.ts`(이 파일의 `base`·`obj` 그대로):

```ts
describe("행동 조건(내용물)", () => {
  const fill = (contents?: { value: string; certainty: "confirmed" | "inferred" }, over: Partial<WorldObject> = {}) => base({
    decision: { ...base().decision, action: "컵에 물 채워 주기" }, tasks: ["컵에 물 채워 주기", "컵 그대로 두기"],
    world: { ...base().world, objects: [obj({ facts: contents ? { contents: { ...contents, at_ms: 9_000, since_ms: 9_000 } } : {}, ...over })] },
  });
  const pre = (i: CheckInput) => checkDecision({ decision: i.decision, tasks: i.tasks, world: i.world });
  it("계획 전 검사: 확인된 반대 값이면 막고, 모르면 계획으로 넘긴다(실행 전 검사가 붙잡는다)", () => {
    expect(pre(fill({ value: "has_contents", certainty: "confirmed" }))).toEqual({ ok: false, reason: "contents_mismatch", text: CHECK_TEXT.contents_mismatch });
    expect(pre(fill({ value: "empty", certainty: "inferred" }))).toEqual({ ok: true });
    expect(pre(fill({ value: "empty", certainty: "confirmed" }))).toEqual({ ok: true });
  });
  it("계획 없는 행동(그대로 두기)은 모르면 계획 전 검사가 막는다(묻지 않는다)", () => {
    const keep = (c?: { value: string; certainty: "confirmed" | "inferred" }) => ({ ...fill(c), decision: { ...base().decision, action: "컵 그대로 두기" } });
    expect(pre(keep({ value: "has_contents", certainty: "inferred" }))).toMatchObject({ ok: false, reason: "contents_unknown" });
    expect(pre(keep({ value: "has_contents", certainty: "confirmed" }))).toEqual({ ok: true });
    expect(pre(keep({ value: "empty", certainty: "confirmed" }))).toMatchObject({ reason: "contents_mismatch" });
  });
  it("실행 전 검사: 계획의 대상 컵이 모르면 contents_unknown과 그 컵 id, 확인된 반대 값이면 contents_mismatch. 내용물이 낡음보다 먼저다", () => {
    expect(checkPlan(fill({ value: "empty", certainty: "inferred" }))).toEqual({ ok: false, reason: "contents_unknown", text: CHECK_TEXT.contents_unknown, object: "cup_1" });
    expect(checkPlan(fill({ value: "has_contents", certainty: "confirmed" }))).toMatchObject({ reason: "contents_mismatch" });
    expect(checkPlan(fill({ value: "empty", certainty: "confirmed" }))).toEqual({ ok: true });
    expect(checkPlan(fill({ value: "empty", certainty: "inferred" }, { last_seen_ms: 1_000 }))).toMatchObject({ reason: "contents_unknown" });
    expect(checkPlan(fill({ value: "empty", certainty: "confirmed" }, { last_seen_ms: 1_000 }))).toMatchObject({ reason: "stale" });
  });
});
```

`tests/act-look.test.ts`(이 파일의 도우미 그대로):

```ts
it("B: 볼 면이 짐작이면 부르고, 확인됨이면 부르지 않는다. 불투명이 확인된 컵은 내용물을 가까이 보지 않는다", async () => {
  const cases: { objects: WorldObject[]; calls: number }[] = [
    { objects: [cupAt({ facts: { contents: { ...fact("empty"), certainty: "inferred" } } })], calls: 1 },
    { objects: [cupAt({ facts: { contents: fact("empty") } })], calls: 0 },
    { objects: [cupAt({ facts: { contents: fact("contents_unknown"), body: fact("opaque") } })], calls: 0 },
    { objects: [cupAt({ facts: { contents: fact("contents_unknown"), body: { ...fact("opaque"), certainty: "inferred" } } })], calls: 1 },
  ];
  for (const c of cases) {
    const t = await setup({ script: () => [["wait", { reason: "다음 사진을 보려고" }]], objects: c.objects });
    t.looker.tick();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(c.calls);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/act-check.test.ts tests/act-look.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/act/tasks.ts TASKS
"컵 그대로 두기": { ...있던 칸, want: { contents: "has_contents" } },
"컵에 물 채워 주기": { ...있던 칸, want: { contents: "empty" } },
"컵에 콜라 따라 주기": { ...있던 칸, want: { contents: "empty" } },

export function sureValue(o: WorldObject, facet: Facet): StateKey | null {
  const f = o.facts[facet];
  return f && f.certainty === "confirmed" && !UNKNOWN_STATES.includes(f.value as StateKey) ? (f.value as StateKey) : null;
}
export function wantOf(spec: Pick<TaskSpec, "want">, o: WorldObject): { ok: true } | { ok: false; why: "mismatch" | "unknown"; facet: Facet } {
  for (const [facet, want] of Object.entries(spec.want ?? {}) as [Facet, StateKey][]) {
    const sure = sureValue(o, facet);
    if (sure === null) return { ok: false, why: "unknown", facet };
    if (sure !== want) return { ok: false, why: "mismatch", facet };
  }
  return { ok: true };
}
export const opaqueBody = (o: WorldObject) => o.facts.body?.value === "opaque" && o.facts.body.certainty === "confirmed";
```

(`UNKNOWN_STATES`·`StateKey`는 `../world/vocab.js`에서 가져온다.)

```ts
// src/act/labels.ts CHECK_TEXT
contents_unknown: "대상 물건 안을 몰라 실행하지 않아요",
contents_mismatch: "대상 물건 안이 맞지 않아 실행하지 않아요",
```

```ts
// src/act/check.ts checkDecision: 대상 검사 뒤
if (spec.want) {
  const o = targetOf(spec, i.world, i.placed);
  const w = o ? wantOf(spec, o) : { ok: true as const };
  if (!w.ok && (w.why === "mismatch" || spec.plan === false)) return fail(w.why === "mismatch" ? "contents_mismatch" : "contents_unknown");
}
// checkPlan: putAway 뒤, stale 앞
if (spec.want) {
  const w = wantOf(spec, o);
  if (!w.ok) return w.why === "mismatch" ? fail("contents_mismatch") : { ok: false, reason: "contents_unknown", text: CHECK_TEXT.contents_unknown, object: o.id };
}
```

```ts
// src/act/look.ts tick: 볼 면 고르기
const facet = want.facets.find((f) => sureValue(o, f) === null && !(f === "contents" && opaqueBody(o)));
```

(`unknown` 도우미는 지운다. 파일 머리 B 설명을 「볼 면이 확인되지 않았으면(없음·짐작·모름), 불투명 컵의 내용물은 빼고」로 고친다.)

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/act-check.test.ts tests/act-look.test.ts tests/act-track.test.ts`
Expected: PASS. `act-track.test.ts` 채우기 시험은 `fact()`가 확인됨이라 그대로 통과해야 한다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/act/tasks.ts src/act/check.ts src/act/labels.ts src/act/look.ts tests/act-tasks.test.ts tests/act-check.test.ts tests/act-look.test.ts
git commit -m "feat(act): check the wanted cup contents before planning, before the first step and before looking closer"
git push origin refactor/domain-split
```

---

### Task 7: 내용물 보류(가까이 보기 → 사진 기다리기)

**Files:**
- Create: `src/act/track/contents.ts`
- Modify: `src/act/track/core.ts`(`Run.hold`, `TrackCore.contents`), `src/act/track/start.ts`(`tryStart`), `src/act/track/steps.ts`(`finish`가 보류를 푼다), `src/act/track/tracker.ts`(만들기, `TrackerOptions.lookContents`, 내보내기), `src/act/look.ts`(`Looker.contents`)
- Test: `tests/act-track.test.ts`(새 describe), `tests/act-look.test.ts`

**Interfaces:**
- Consumes: Task 6 `CheckResult.object`, `opaqueBody`, `sureValue`
- Produces:

```ts
// src/act/track/contents.ts
export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000, retryMs: 60_000 } as const;
/** 보류의 가까이 보기 부탁(보기 담당 src/act/look.ts contents). done은 끝날 때 한 번(못 봐도). signal은 보류가 풀리면 끊긴다. */
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(): void }
/** over: 묻지 못한 채 holdMs가 지나 그만둠(같은 컵·세대면 다시 붙잡지 않는다). */
export interface Hold { objectId: string; gen: number; phase: "look" | "looking" | "settle" | "ask" | "over"; at: number; lookedAt: number; end: AbortController }
export class ContentsHold extends Part {
  /** 실행 전 검사가 내용물을 몰라 막았다: 보류를 한 걸음 진행한다. 아직 붙잡고 있으면 true, 그만두면 false(검사 실패로 닫힌다). */
  keep(r: Run, objectId: string): boolean;
  /** 보류를 푼다(검사 통과·계획 닫힘). */
  release(r: Run): void;
}
// TrackerOptions
/** 내용물 보류의 가까이 보기(src/act/look.ts contents). 받았으면 true. 없으면 가까이 보지 않고 사진만 기다린다. */
lookContents?: (h: ContentsLook) => boolean;
// src/act/look.ts
Looker.contents(h: ContentsLook): boolean;
```

- [ ] **Step 1: 실패하는 시험**

`tests/act-track.test.ts` 「실행 추적: 그 자리에서 하는 일(do, 채워 주기)」 describe **안에** 둔다(그 안의 `WATER`·`water`·`fillSetup`·`cup`·`world`를 같이 쓴다):

```ts
describe("실행 추적: 내용물 보류(실행 전 검사가 컵 안을 몰라 막은 계획)", () => {
  const fillDecision = { ...water, tasks: [WATER] };
  const inferred = (v: string) => ({ contents: { value: v, at_ms: 9_000, since_ms: 9_000, certainty: "inferred" as const } });
  const confirmed = (v: string) => ({ contents: { value: v, at_ms: 9_500, since_ms: 9_000, certainty: "confirmed" as const } });
  /** 컵 facts를 바꿔 가며 볼 World와 실제 checkPlan으로 검사하는 실행 추적. */
  function holdSetup(over: Parameters<typeof setup>[0] = {}) {
    let facts: WorldObject["facts"] = inferred("empty");
    const w = () => world([{ ...cup("present", undefined, 9_000), facts, contents_gen: 3 }]);
    const looks: ContentsLook[] = [];
    const s = fillSetup({
      w, lookContents: (h) => { looks.push(h); return true; },
      check: () => checkPlan({ decision: fillDecision, tasks: [WATER], plan: s.plans.current()!, world: w(), nowMs: s.clock.t, staleMs: 60_000, mode: "test" }),
      ...over,
    });
    return { ...s, looks, set: (f: WorldObject["facts"]) => { facts = f; } };
  }

  it("모르면 실패로 닫지 않고 그 컵을 가까이 본 뒤 4초 사진을 기다린다. 그사이 확인되면 첫 명령을 보낸다", async () => {
    const s = holdSetup();
    await s.decide(fillDecision);
    s.clock.t += 3_500; s.t.tick(); // recheckMs(3초)가 지나도 닫히지 않는다
    expect(s.exec().map((e) => e.state)).not.toContain("failed");
    expect(s.looks).toEqual([expect.objectContaining({ planId: "plan:pam-1", objectId: "cup_1" })]);
    expect(s.commands()).toEqual([]);
    s.looks[0]!.done();
    s.set(confirmed("empty"));
    s.clock.t += 500; s.t.tick();
    expect(s.spoken()).toEqual(["냉장고로 가 주세요"]);
  });

  it("확인된 반대 값이면 묻지 않고 그 이유로 닫는다", async () => {
    const s = holdSetup();
    s.set(confirmed("has_contents"));
    await s.decide(fillDecision);
    s.clock.t += 3_100; s.t.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.contents_mismatch });
    expect(s.looks).toEqual([]);
  });

  it("보기 담당이 바빠 받지 않으면 3초 뒤 가까이 보기 없이 사진을 기다리고, 묻지 못하면 30초 뒤 「안을 몰라」로 닫는다", async () => {
    const s = holdSetup({ lookContents: () => false });
    await s.decide(fillDecision);
    for (let i = 0; i < 150; i++) { s.clock.t += 250; s.t.tick(); } // 보류 30초 + 다시 보기 기한 3초
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.contents_unknown });
    expect(s.commands()).toEqual([]);
  });

  it("불투명이 확인된 컵은 가까이 보지 않는다. 그만두거나 계획이 닫히면 가까이 보기 신호가 끊긴다", async () => {
    const s = holdSetup();
    s.set({ ...inferred("contents_unknown"), body: { value: "opaque", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } });
    await s.decide(fillDecision);
    s.clock.t += 500; s.t.tick();
    expect(s.looks).toEqual([]);
    const t2 = holdSetup();
    await t2.decide(fillDecision);
    t2.heard("그만해");
    expect(t2.looks[0]!.signal.aborted).toBe(true);
  });
});
```

`tests/act-look.test.ts`:

```ts
describe("보기 담당: 내용물 보류의 가까이 보기(contents)", () => {
  it("다른 일이 없으면 관찰 모드 없이 그 컵을 가까이 보고 look 기록(계기 unknown_fact, 그 계획 id)과 done 한 번. 30초 안에 본 컵은 보지 않고 done만", async () => {
    const t = await setup({ script: () => [["wait", { reason: "x" }]] });
    let done = 0;
    const h = { planId: "plan:pam-1", objectId: "cup_1", spot: CUP, signal: new AbortController().signal, done: () => { done++; } };
    expect(t.looker.contents(h)).toBe(true);
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(0);
    expect(t.looked).toEqual([CUP]);
    expect(t.looks()).toEqual([expect.objectContaining({ trigger: "unknown_fact", tool: "look_closer", target: "cup_1", plan_id: "plan:pam-1" })]);
    expect(t.looks()[0]).not.toHaveProperty("step_id");
    expect(done).toBe(1);
    expect(t.looker.contents(h)).toBe(true);
    await t.looker.idle();
    expect(t.looked).toHaveLength(1);
    expect(done).toBe(2);
  });
  it("A가 도는 중이면 받지 않는다(false, done 없음)", async () => {
    let release!: () => void;
    const t = await setup({ script: () => [["wait", { reason: "x" }]], gate: () => new Promise<void>((r) => { release = r; }) });
    const a = stall();
    t.looker.stalled(a.s);
    let done = 0;
    expect(t.looker.contents({ planId: "plan:pam-1", objectId: "cup_1", spot: CUP, signal: new AbortController().signal, done: () => { done++; } })).toBe(false);
    release();
    await t.looker.idle();
    expect(done).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts -t "내용물 보류"`, `npm run heavy -- npx vitest run tests/act-look.test.ts -t contents`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/act/track/contents.ts
// 실행 추적의 내용물 보류(ContentsHold): 실행 전 검사가 행동 조건의 내용물을 몰라(contents_unknown) 막은 계획은 실패로 닫지 않고 붙잡는다.
// 차례: 가까이 보기(불투명 컵·자리를 모르는 컵이면 건너뜀, 보기 담당이 바쁘면 lookWaitMs 뒤 건너뜀) → 사진이 이어질 settleMs → 말로 묻기(ask, 묶음 8).
// 그사이 확인되면 실행 전 검사가 통과해 tryStart가 release하고 첫 단계로 간다. 확인된 반대 값이면 검사가 contents_mismatch로 막아 묻지 않는다.
// 컵의 내용물 세대가 바뀌면(마시기 사건·확인) 가까이 보기부터 다시 한다. 묻지 못한 채 holdMs가 지나면 그만둔다(검사 실패로 닫힘).
import type { LookSpot } from "../../observe/index.js";
import { OBJECT_NAME } from "../../world/labels.js";
import { opaqueBody } from "../tasks.js";
import { Part, type Run } from "./core.js";

export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000, retryMs: 60_000 } as const;
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(): void }
/** over: 묻지 못한 채 holdMs가 지나 그만둠(같은 컵·세대면 다시 붙잡지 않는다). */
export interface Hold { objectId: string; gen: number; phase: "look" | "looking" | "settle" | "ask" | "over"; at: number; lookedAt: number; end: AbortController }

export class ContentsHold extends Part {
  keep(r: Run, objectId: string): boolean {
    const now = this.clock.now();
    const o = this.o.world().objects.find((x) => x.id === objectId);
    const gen = o?.contents_gen ?? 0;
    let h = r.hold;
    if (h?.phase === "over" && h.objectId === objectId && h.gen === gen) return false;
    if (!h || h.objectId !== objectId || h.gen !== gen) {
      h?.end.abort();
      // 같은 컵이면 처음 붙잡은 때를 둔다(사건이 이어져도 holdMs 안에서 끝난다)
      h = r.hold = { objectId, gen, phase: "look", at: h?.objectId === objectId ? h.at : now, lookedAt: now, end: new AbortController() };
    }
    if (h.phase !== "looking" && now - h.at > CONTENTS_HOLD.holdMs) {
      h.end.abort();
      h.phase = "over";
      return false;
    }
    if (h.phase === "look") {
      const skip = !o?.position || opaqueBody(o) || !this.o.lookContents;
      const hold = h;
      if (!skip) {
        // 보기 담당이 받자마자 done을 부를 수 있으니 먼저 looking으로 둔다
        h.phase = "looking";
        const took = this.o.lookContents!({
          planId: r.plan.view.id, objectId, spot: { id: objectId, label: OBJECT_NAME[o!.cls] ?? o!.cls, position: o!.position! }, signal: h.end.signal,
          done: () => { if (r.hold === hold && hold.phase === "looking") Object.assign(hold, { phase: "settle", lookedAt: this.clock.now() }); },
        });
        if (!took) h.phase = "look";
      }
      if (h.phase === "look" && (skip || now - h.at >= CONTENTS_HOLD.lookWaitMs)) Object.assign(h, { phase: o && opaqueBody(o) ? "ask" : "settle", lookedAt: now });
    }
    if (h.phase === "settle" && now - h.lookedAt >= CONTENTS_HOLD.settleMs) h.phase = "ask";
    return true;
  }

  release(r: Run): void {
    r.hold?.end.abort();
    r.hold = null;
  }
}
```

```ts
// src/act/track/start.ts tryStart: c 계산 뒤
if (!c.ok) {
  if (c.reason === "in_hand" && c.carried) { r.since = this.clock.now(); return; }
  // 내용물을 몰라 막혔으면 보류가 붙잡는 동안 다시 보기 기한을 세지 않는다(src/act/track/contents.ts)
  if (c.reason === "contents_unknown" && c.object && this.core.contents.keep(r, c.object)) { r.since = this.clock.now(); return; }
  if (last) steps.finish(r, "failed", c.text);
  return;
}
this.core.contents.release(r);
```

`src/act/track/core.ts`: `Run`에 `hold: Hold | null`(만들 때 null, `start.ts planned`의 Run 글자에 `hold: null`), `TrackCore`에 `contents!: ContentsHold`. `steps.ts finish` 맨 앞에 `this.core.contents.release(r)`. `tracker.ts`: `core.contents = new ContentsHold(core)`, `TrackerOptions.lookContents`, `export type { ContentsLook } from "./contents.js"`.

```ts
// src/act/look.ts Looker
/** 내용물 보류의 가까이 보기(실행 추적 src/act/track/contents.ts): 관찰 모드 없이 그 컵을 바로 가까이 본다. 다른 일이 돌면 받지 않는다(false).
 *  objectGapMs 안에 본 컵은 다시 보지 않고 done만 부른다. 끝나면(못 봐도, 신호가 끊겨도) done 한 번. */
contents(h: ContentsLook): boolean {
  if (this.stopped || h.signal.aborted || this.job) return false;
  const now = this.clock.now();
  if (now - (this.lookedAt.get(h.objectId) ?? Number.NEGATIVE_INFINITY) < this.cfg.objectGapMs) {
    h.done();
    return true;
  }
  const abort = new AbortController();
  const job: Job = { trigger: "unknown_fact", key: `${h.planId}:contents`, goal: LOOK_TEXT.held(h.spot.label), stuckMs: null, spots: [h.spot], tools: ["look_closer"],
    planId: h.planId, abort, signal: AbortSignal.any([abort.signal, h.signal]), phase: "act" };
  this.lookedAt.set(h.objectId, now);
  this.job = job;
  const p: Promise<void> = this.closerOnly(job, h.spot).catch(() => {}).finally(() => {
    if (this.job === job) this.job = null;
    this.running.delete(p);
    h.done();
  });
  this.running.add(p);
  return true;
}

/** 관찰 모드 없이 가까이 보고 look 기록 하나(감지를 합치기 전에 끊기면 기록 없음). */
private async closerOnly(job: Job, spot: LookSpot): Promise<void> {
  this.o.onLook?.(spot);
  const r = await this.o.closer(spot, job.signal).catch((): CloserResult => ({ ok: false, why: "error" }));
  if (this.stopped || (!r.ok && r.why === "aborted")) return;
  this.count.looks++;
  this.record(job, { tool: "look_closer", reason: job.goal }, spot, LOOK_TEXT.closer(spot.label, closerText(r)), r,
    r.ok ? r.found.map((f) => `${f.id ?? f.cls} ${f.score} ${f.facts.join(" ")}`.trim()).join(", ") : "");
}
```

`src/act/labels.ts LOOK_TEXT`에 `held: (place: string) => `${place} 안을 몰라 가까이 봄``. `record`는 `job.stepId`가 없으면 `step_id` 칸을 싣지 않게 고친다(`...(job.planId ? { plan_id: job.planId, ...(job.stepId ? { step_id: job.stepId } : {}) } : {})`. 계약 `BrainLog` look의 `step_id`는 이미 선택 칸이다).

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts`, `npm run heavy -- npx vitest run tests/act-look.test.ts tests/act-track-release.test.ts tests/video-mode-parity.test.ts`, `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/act/track/contents.ts src/act/track/core.ts src/act/track/start.ts src/act/track/steps.ts src/act/track/tracker.ts src/act/look.ts src/act/labels.ts tests/act-track.test.ts tests/act-look.test.ts
git commit -m "feat(act): hold a plan whose cup contents are unknown, look closer and wait for photos"
git push origin refactor/domain-split
```

---

### Task 8: 말로 묻고 말로 받기

**Files:**
- Create: `src/act/ask-step.ts`
- Modify: `src/act/track/contents.ts`(ask·answered·lapsed·noAnswer), `src/act/track/approval.ts`(`Asking`에 contents), `src/act/track/core.ts`(`choicesOf`), `src/act/track/answers.ts`(onAnswer), `src/act/track/tracker.ts`(tick, `TrackerOptions.answerContents`·`approvalsWaiting`), `src/act/talk-grade.ts`, `src/act/say.ts`, `src/act/labels.ts`(질문 글·실행 글), `src/contract/phone.ts`(질문 대상 설명 한 줄)
- Test: `tests/act-track.test.ts`, `tests/talk-grade.test.ts`, `tests/act-say.test.ts`

**Interfaces:**
- Consumes: Task 1 `CONTENTS_CHOICES`·`ContentsChoice`, Task 7 `ContentsHold`
- Produces:

```ts
// src/act/ask-step.ts
/** 내용물 질문 명령의 단계 id: 계획·컵·내용물 세대에 묶는다. */
export const contentsStep: (planId: string, objectId: string, gen: number, seq: number) => string; // `${planId}:contents:${objectId}:${gen}:${seq}`, seq는 물을 때마다 새 번호
export const isContentsStep: (step: string) => boolean;
// src/act/track/approval.ts
export type Asking = { why: "plan" } | { why: "device"; token: string } | { why: "again" } | { why: "hand" } | { why: "contents"; objectId: string; gen: number };
// TrackerOptions
/** 사람이 말로 답한 내용물을 World State에 넣는다(src/world/state/world.ts answerContents). 세대가 지났으면 false. 없으면 답을 넣지 못한다. */
answerContents?: (objectId: string, value: "empty" | "has_contents", gen: number) => boolean;
/** 실제 폰에 승인 대기(가전·외부 연락)가 떠 있는가. 있으면 내용물 질문을 미룬다. */
approvalsWaiting?: () => boolean;
/** 실제 폰 대화를 쓰는 중인가(에이전트가 들은 말을 처리하는 중이거나 끝난 지 TALK_QUIET_MS 안). 그동안 내용물 질문을 하지 않고, 계획 밖 질문은 지운다. */
talking?: () => boolean;
// src/act/labels.ts
export const CONTENTS_TEXT: { ask: (item: string) => string }; // 「컵 비었어요?」
// EXEC_TEXT.contentsAsked: "안을 몰라 폰으로 물어봄"
```

- [ ] **Step 1: 실패하는 시험**

`tests/talk-grade.test.ts`:

```ts
it("내용물 질문(단추 없음)은 question이다(계획 안 질문·계획 밖 질문 모두)", () => {
  expect(talkGrade({ step: "plan:pam-1:contents:cup_1:3:1", choices: [] }, false)).toBe("question");
  expect(talkGrade({ step: "ask:2:contents:cup_1:0:2", choices: [] }, false)).toBe("question");
});
```

`tests/act-say.test.ts`: 내용물 질문 명령(`step: "plan:pam-1:contents:cup_1:3:1"`, 열린 계획)과 계획 밖 질문 명령(`id: "ask:2", step: "ask:2:contents:cup_1:0:2"`, 계획 없음)이 떠 있으면 `sayLine`이 둘 다 `SAY_TEXT.asked`.

`tests/act-track.test.ts`의 Task 7 describe에 더한다(`holdSetup` 그대로, `answerContents`를 넘겨 World를 바꾼다):

```ts
describe("실행 추적: 내용물 말 질문", () => {
  /** 보류가 묻는 차례까지 간 실행 추적: 위치를 맞췄고 가까이 보기는 받자마자 끝난다. answered는 World State에 넣은 답. */
  async function asking(over: Parameters<typeof setup>[0] = {}) {
    const answered: [string, string, number][] = [];
    let gen = 3;
    const s = holdSetup({
      lookContents: (h) => { h.done(); return true; },
      answerContents: (id, v, g) => { if (g !== gen) return false; answered.push([id, v, g]); gen++; s.set(v === "empty" ? confirmed("empty") : confirmed("has_contents")); return true; },
      ...over,
    });
    s.t.onEye([0, 0]);
    await s.decide(fillDecision);
    for (let i = 0; i < 20 && !s.commands().length; i++) { s.clock.t += 250; s.t.tick(); }
    return { ...s, answered, bump: () => { gen++; } };
  }

  it("가까이 봐도 모르면 지금 명령 줄에 「컵 비었어요?」를 단추 없이 소리로 묻는다(등급 question, 그 컵 고리)", async () => {
    const s = await asking();
    expect(s.last()).toEqual({ type: "command", id: "plan:pam-1", step: "plan:pam-1:contents:cup_1:3:1", text: "컵 비었어요?", vision: null, choices: [], target: expect.objectContaining({ id: "cup_1" }), speak: true, grade: "question" });
    expect(s.t.openCommand()).toMatchObject({ kind: "ask", text: "컵 비었어요?" });
    expect(s.exec().at(-1)).toMatchObject({ state: "planned", text: EXEC_TEXT.contentsAsked });
  });

  it("말 「다 마셨어」는 그 컵·세대로 World State에 넣고(출처 사람) 질문을 지운 뒤 바로 다시 검사해 첫 명령을 보낸다", async () => {
    const s = await asking();
    expect(s.heard("다 마셨어")?.value).toBe("empty");
    expect(s.answered).toEqual([["cup_1", "empty", 3]]);
    expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
  });

  it("말 「아직 있어」(확인된 반대 값)면 묻지 않고 「안이 맞지 않아」로 닫는다", async () => {
    const s = await asking();
    s.heard("아직 있어");
    s.clock.t += 3_100; s.t.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.contents_mismatch });
  });

  it("다른 명령에 온 말·질문과 상관없는 말은 답이 아니다. 세대가 바뀐 뒤의 답(늦은 답)은 넣지 않고 질문을 지운다", async () => {
    const s = await asking();
    expect(s.heard("비었어", { kind: "command", id: "plan:pam-1", step: "plan:pam-1:2", pending: [] })).toBeNull();
    expect(s.heard("TV 켜 줘")).toBeNull();
    s.bump(); // 마시기 사건으로 세대가 바뀜
    s.heard("비었어");
    expect(s.answered).toEqual([]);
  });

  it("세대가 바뀌거나 컵이 확인되면 떠 있는 질문을 지운다(command_clear). 같은 컵·세대는 한 번만 묻는다", async () => {
    const s = await asking();
    s.set(confirmed("empty"));
    s.clock.t += 250; s.t.tick();
    expect(s.phone.some((m) => m.type === "command_clear")).toBe(true);
    expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
  });

  it("2분 안에 답이 없으면 「답을 받지 못함」으로 닫고, 같은 컵은 60초 안에 다시 묻지 않는다", async () => {
    const s = await asking();
    s.clock.t += 121_000; s.t.tick();
    expect(s.exec().at(-1)).toMatchObject({ state: "failed", text: EXEC_TEXT.noAnswer });
    const n = s.commands().length;
    await s.decide({ ...fillDecision, id: "pam-2", seq: 2 });
    for (let i = 0; i < 40; i++) { s.clock.t += 250; s.t.tick(); }
    expect(s.commands().slice(n).filter((m) => /contents/.test(m.step))).toEqual([]);
  });

  it("위치를 맞추기 전·끄기 안내가 떠 있을 때·승인 대기가 있을 때·컵을 손에 들었을 때는 묻지 않는다", async () => {
    const noEye = holdSetup({ lookContents: (h) => { h.done(); return true; } });
    await noEye.decide(fillDecision);
    for (let i = 0; i < 40; i++) { noEye.clock.t += 250; noEye.t.tick(); }
    expect(noEye.commands()).toEqual([]);
    const pending = await asking({ approvalsWaiting: () => true });
    expect(pending.commands()).toEqual([]);
    const talk = await asking({ talking: () => true }); // 에이전트가 「아 덥다」를 처리하는 중
    expect(talk.commands()).toEqual([]);
  });

  it("「그만」이면 질문을 지우고 취소로 닫는다", async () => {
    const s = await asking();
    expect(s.heard("그만해")?.id).toBe("stop");
    expect(s.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
  });
});
```

(`heard`는 이 파일 `setup`의 도우미이고 받은 답의 `ActionChoice`를 돌려준다. 내용물 답은 `ContentsChoice`라 `value`가 있다. 손에 든 컵 경우는 `s.set({ ...inferred("empty"), place: { value: "in_hand", … confirmed } })`로 같은 틀에 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts -t "내용물"`, `npm run heavy -- npx vitest run tests/talk-grade.test.ts tests/act-say.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/act/ask-step.ts
// 내용물 질문 명령의 단계 id(src/act/track/contents.ts ask). 명령 id는 그 계획 id다. 컵 id와 내용물 세대를 실어 늦은 답(다른 컵·지난 세대)을 가른다.
// 소리 등급(src/act/talk-grade.ts)과 말풍선 카드(src/act/say.ts)가 이 모양으로 내용물 질문을 가른다.
export const contentsStep = (planId: string, objectId: string, gen: number, seq: number): string => `${planId}:contents:${objectId}:${gen}:${seq}`;
export const isContentsStep = (step: string): boolean => /:contents:[^:]+:\d+:\d+$/.test(step);
```

```ts
// src/act/talk-grade.ts: offStep 다음
if (isContentsStep(c.step)) return "question";
// src/act/say.ts: 끄기 안내 줄(isOffStep) 바로 다음, 계획 갈래 앞(계획 밖 질문도 같은 글)
if (command?.type === "command" && isContentsStep(command.step)) return SAY_TEXT.asked;
// src/act/track/core.ts choicesOf
if (r.asking?.why === "contents") return [...CONTENTS_CHOICES];
// src/act/track/answers.ts onAnswer: a?.why 갈래에
else if (a?.why === "contents") this.core.contents.answered(r, picked);
// 같은 함수의 질문 기한 지남(a && now - r.askAt > askMs)에서 a.why === "contents"면 this.core.contents.noAnswer(r) 뒤 닫는다
```

```ts
// src/act/labels.ts
/** 내용물 질문(src/act/track/contents.ts): 폰이 소리로 묻고 말로만 받는다. */
export const CONTENTS_TEXT = { ask: (item: string) => `${item} 비었어요?` };
// EXEC_TEXT
contentsAsked: "안을 몰라 폰으로 물어봄",
```

```ts
// src/act/track/contents.ts ContentsHold에 더한다
private readonly asked = new Set<string>();
private readonly quietUntil = new Map<string, number>();
/** 물을 때마다 오르는 번호(계획 안 질문·계획 밖 질문이 같이 쓴다): 단계 id에 실어 앞 질문의 늦은 답을 가른다. */
private askSeq = 0;

/** 폰 대화를 쓰는 중인가: 에이전트가 들은 말을 처리하는 중이거나 끝난 지 얼마 안 됨(src/server/home/phone.ts가 센다). */
private talking(): boolean {
  return this.o.talking?.() ?? false;
}

/** keep의 ask 차례: 물을 수 있으면 지금 명령 줄에 묻는다. 물을 수 없으면 그대로 기다린다(holdMs가 지나면 keep이 그만둔다). */
private ask(r: Run, h: Hold): void {
  const now = this.clock.now();
  const world = this.o.world();
  const o = world.objects.find((x) => x.id === h.objectId);
  const key = `${h.objectId}|${h.gen}`;
  const core = this.core;
  const can = !!o && o.status === "present" && !!core.eye && core.start.phoneOk() && !core.safety.offPending() && !core.safety.shownOff()
    && !(this.o.approvalsWaiting?.() ?? false) && !this.talking() && !r.asking && !r.sent && !this.asked.has(key) && now >= (this.quietUntil.get(h.objectId) ?? 0)
    && o.facts.place?.value !== "in_hand" && !holdsTarget(world, o.cls, true);
  if (!can) return;
  const name = OBJECT_NAME[o!.cls] ?? o!.cls;
  Object.assign(r, { asking: { why: "contents", objectId: h.objectId, gen: h.gen }, askAt: now, spokeAt: now });
  r.sent = {
    type: "command", id: r.plan.view.id, step: contentsStep(r.plan.view.id, h.objectId, h.gen, ++this.askSeq), text: CONTENTS_TEXT.ask(name), vision: null, choices: [],
    target: o!.position ? { id: o!.id, label: name, position: o!.position } : null, speak: true,
  };
  core.emit(r.plan.view.id, "planned", EXEC_TEXT.contentsAsked);
  core.answers.send(r.sent);
}

/** 말 답: 그 컵·세대로 World State에 넣는다(늦은 세대면 넣지 않음). 질문을 지우고 보류를 푼 뒤 바로 다시 검사한다. */
answered(r: Run, picked: ActionChoice): void {
  const a = r.asking;
  if (a?.why !== "contents") return;
  const value = (picked as ContentsChoice).value;
  const ok = this.o.answerContents?.(a.objectId, value, a.gen) ?? false;
  if (ok) this.asked.add(`${a.objectId}|${a.gen}`);
  r.asking = null;
  this.core.steps.clear(r);
  this.release(r);
  r.since = this.clock.now();
  this.core.start.tryStart(r, false);
}

/** 떠 있는 질문이 지났는가(컵이 없음·사라짐, 세대가 바뀜, 이제 확인됨): 지났으면 질문을 지우고 true(다시 검사한다). */
lapsed(r: Run): boolean {
  const a = r.asking;
  if (a?.why !== "contents") return false;
  const o = this.o.world().objects.find((x) => x.id === a.objectId);
  if (o && o.status !== "gone" && (o.contents_gen ?? 0) === a.gen && sureValue(o, "contents") === null) return false;
  r.asking = null;
  this.core.steps.clear(r);
  return true;
}

/** 답 없이 질문 기한이 지났다: 물어봄 끝으로 세지 않고, 그 컵은 retryMs 동안 다시 묻지 않는다. */
noAnswer(r: Run): void {
  const a = r.asking;
  if (a?.why === "contents") this.quietUntil.set(a.objectId, this.clock.now() + CONTENTS_HOLD.retryMs);
}
```

`keep`의 끝에 `if (h.phase === "ask") this.ask(r, h);`. `src/act/track/tracker.ts tick`의 `if (r.asking)` 블록 맨 앞:

```ts
if (r.asking.why === "contents") {
  if (core.contents.lapsed(r)) return core.start.tryStart(r, false);
  if (now - r.askAt > core.cfg.askMs) {
    core.contents.noAnswer(r);
    return steps.finish(r, "failed", EXEC_TEXT.noAnswer);
  }
  return steps.repeat(r, now);
}
```

`src/act/track/start.ts tryStart` 맨 앞: `if (r.asking) return;`(질문이 떠 있는 동안은 tick의 asking 갈래가 본다. 승인 답 뒤 `approvedPlan`이 `asking`을 지우고 부르므로 그대로다.)

`src/contract/phone.ts PhoneCommand.target` 설명: 「질문이면 null. 내용물 질문은 그 컵.」

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts tests/talk-grade.test.ts tests/act-say.test.ts tests/contents-answer.test.ts tests/act-track-release.test.ts tests/video-mode-parity.test.ts`, `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/act/ask-step.ts src/act/track/contents.ts src/act/track/approval.ts src/act/track/core.ts src/act/track/answers.ts src/act/track/tracker.ts src/act/track/start.ts src/act/talk-grade.ts src/act/say.ts src/act/labels.ts src/contract/phone.ts tests/act-track.test.ts tests/talk-grade.test.ts tests/act-say.test.ts
git commit -m "feat(act): ask the cup contents by voice on the command line and take the spoken answer"
git push origin refactor/domain-split
```

---

### Task 9: 따르기 창 · 서버 잇기 · 데모 흐름

**Files:**
- Modify: `src/act/track/steps.ts`(따르기 단계 창, 따라가는 id가 바뀌면 창도 옮김), `src/act/track/core.ts`(`Run.window`), `src/act/track/tracker.ts`(`TrackerOptions.contentsAction`), `src/observe/pipeline.ts`(`publish` 공개), `src/server/home/act.ts`(잇기), `src/server/home/core.ts`·`src/server/home/phone.ts`(폰 대화 사용 중 세기)
- Test: `tests/act-track.test.ts`(창, 실제 World State로 질문→답→계획), `tests/cup-branches-e2e.test.ts`·`tests/demo-e2e.test.ts`·`tests/noonchi-e2e.test.ts`·`tests/coach-e2e.test.ts`(그대로 통과)

**Interfaces:**
- Consumes: Task 3 `WorldState.answerContents`·`contentsAction`, Task 7·8 옵션
- Produces:

```ts
// TrackerOptions
/** 그 자리에서 하는 일 단계가 물건 안을 바꾸는 단계(끝 조건에 그 물건 내용물)일 때 창을 연다·닫는다(src/world/state/world.ts contentsAction). */
contentsAction?: (objectId: string, on: boolean) => void;
// src/observe/pipeline.ts
publish(changes: WorldChange[]): void; // private → public(관찰 흐름 밖에서 바꾼 World State 변화도 같은 길로 방송)
```

- [ ] **Step 1: 실패하는 시험**

`tests/act-track.test.ts` 「그 자리에서 하는 일(do, 채워 주기)」 describe에:

```ts
it("따르기 단계(끝 조건이 그 컵 내용물)가 되면 그 컵의 창을 열고, 단계가 끝나거나 계획이 닫히면 닫는다", async () => {
  const calls: [string, boolean][] = [];
  let w = world([tableCup(["empty", 9_000])]);
  const s = fillSetup({ w: () => w, contentsAction: (id, on) => calls.push([id, on]) });
  await s.decide(water);
  s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
  w = world([tableCup(["empty", 9_000]), bottle("in_hand", s.clock.t)], "holding_object", s.clock.t);
  s.t.onWorld();
  s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
  expect(calls).toEqual([["cup_1", true]]);
  s.t.onAnswer("plan:pam-1", "plan:pam-1:4", "done");
  expect(calls).toEqual([["cup_1", true], ["cup_1", false]]);
});

it("따르기 단계 도중 컵이 새 id로 이어지면 창도 새 컵으로 옮긴다(앞 컵 닫고 새 컵 엶)", async () => {
  const calls: [string, boolean][] = [];
  let w = world([tableCup(["empty", 9_000])]);
  const s = fillSetup({ w: () => w, contentsAction: (id, on) => calls.push([id, on]) });
  await s.decide(water);
  s.t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
  w = world([tableCup(["empty", 9_000]), bottle("in_hand", s.clock.t)], "holding_object", s.clock.t);
  s.t.onWorld();
  s.t.onAnswer("plan:pam-1", "plan:pam-1:3", "done");
  s.clock.t += 1_000;
  // 옛 컵은 사라지고 그 뒤 같은 종류 새 컵(cup_2)이 보인다: 실행 추적이 그 컵으로 잇는다
  w = world([{ ...tableCup(["empty", 9_000]), status: "gone" }, { ...tableCup(["empty", s.clock.t], s.clock.t), id: "cup_2", first_seen_ms: s.clock.t }]);
  s.t.onWorld();
  expect(calls).toEqual([["cup_1", true], ["cup_1", false], ["cup_2", true]]);
});
```

같은 describe에(실제 World State, 카메라 없음: 컵 자리를 몰라 가까이 보기는 건너뛴다):

```ts
it("불투명 컵: 물 채우기를 붙잡고 폰이 「컵 비었어요?」를 묻고, 말 「비었어」를 실제 World State에 넣은 뒤(출처 사람) 첫 명령을 보낸다", async () => {
  const ws = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
  const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
  for (let i = 1; i <= 3; i++) {
    const { ids } = ws.applyDetections(frame(i), [det("cup", 0.9, [220, 160, 40, 20], 41)]);
    ws.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state: "opaque" }, { object_id: "d1", state: "on_table" }], summary: "s" }, ids);
  }
  const s = fillSetup({ w: () => ws.view(s.clock.t),
    check: (d, p) => checkPlan({ decision: d, tasks: [WATER], plan: p, world: ws.view(s.clock.t), nowMs: s.clock.t, staleMs: 600_000, mode: "test" }),
    answerContents: (id, v, g) => ws.answerContents(id, v, s.clock.t, g) !== null, lookContents: (h) => { h.done(); return true; } });
  s.clock.t = 3_500;
  s.t.onEye([0, 0]);
  await s.decide({ ...water, tasks: [WATER], atMs: 0 });
  for (let i = 0; i < 20 && !s.commands().length; i++) { s.clock.t += 250; s.t.tick(); }
  expect(s.last()).toMatchObject({ text: "컵 비었어요?", choices: [], grade: "question" });
  s.heard("비었어");
  expect(ws.view(s.clock.t).objects[0]!.facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", by: "person" });
  expect(s.spoken().at(-1)).toBe("냉장고로 가 주세요");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts -t "창|불투명 컵"`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/act/track/steps.ts
/** 창을 열 물건: 그 자리에서 하는 일 단계이고 끝 조건이 그 물건 내용물을 보면 그 대상(계획 물건 id). 아니면 null. */
const windowOf = (step: AgentStep): string | null => (step.kind === "do" && step.until && factFacets(step.until).includes("contents") ? step.target : null);
// activate: Object.assign 뒤, 단계 종류 갈래 앞
this.window(r, windowOf(step));
// look: 지금 단계를 본 직후(조건을 보기 전) 따라가는 id가 바뀌었으면 창을 옮긴다
if (step.kind === "do") this.window(r, windowOf(step));

/** 따르기 창: 그 물건(지금 따라가는 World State id)의 창을 열고, 다른 단계가 되면 앞 창을 닫는다. */
private window(r: Run, objectId: string | null): void {
  const world = this.o.world();
  const id = objectId ? ours(r, objectId, world).find((o) => o.status !== "gone")?.id ?? null : null;
  if (r.window === id) return;
  if (r.window) this.o.contentsAction?.(r.window, false);
  r.window = id;
  if (id) this.o.contentsAction?.(id, true);
}
// finish 앞쪽(release 다음): this.window(r, null)
```

`Run`에 `window: string | null`(만들 때 null).

```ts
// src/observe/pipeline.ts: private publish → publish(공개), 설명 한 줄 「관찰 흐름 밖에서 바꾼 World State 변화(사람 답·따르기 창)도 이 길로 방송한다」
```

```ts
// src/server/home/act.ts ExecutionTracker 옵션에 더한다
// 사람이 말로 답한 내용물: 그 컵·세대일 때만 World State에 넣는다. 방송은 이 호출이 끝난 뒤(실행 추적 안에서 다시 들어가지 않게)
answerContents: (id, value, gen) => {
  const changes = world.answerContents(id, value, now(), gen);
  if (changes) queueMicrotask(() => core.pipeline?.publish(changes));
  return changes !== null;
},
// 따르기 단계 동안 그 컵의 창(그 뒤 사진만, 다 이어진 값이 확인 값을 바꿈)
contentsAction: (id, on) => { world.contentsAction(id, now(), on); },
// 내용물 보류의 가까이 보기는 보기 담당이 한 번에 하나
lookContents: (h) => core.looker?.contents(h) ?? false,
// 실제 폰에 승인 대기가 떠 있으면 내용물 질문을 미룬다(승인 질문을 덮지 않는다)
approvalsWaiting: () => core.agent.pending(PHONE_SESSION).length > 0,
// 폰 대화를 쓰는 중(에이전트가 들은 말을 처리하는 중이거나 끝난 지 TALK_QUIET_MS 안)이면 내용물 질문을 하지 않는다
talking: () => core.talk.inflight > 0 || core.nowMs() - core.talk.at < TALK_QUIET_MS,
```

```ts
// src/server/home/core.ts HomeCore
/** 실제 폰 대화(말 요청 에이전트) 사용: 처리 중인 말 수와 마지막으로 끝난 시각. 내용물 질문이 끼어들지 않게 본다. */
talk = { inflight: 0, at: Number.NEGATIVE_INFINITY };
// src/server/home/phone.ts
/** 폰 대화가 끝난 뒤 이만큼(ms) 내용물 질문을 하지 않는다(에이전트 답을 읽는 동안). */
export const TALK_QUIET_MS = 10_000;
// onSay: agent.chat 앞뒤(코치 관찰 모드로 넘긴 말은 세지 않는다)
core.talk.inflight++;
try { const r = await agent.chat(PHONE_SESSION, text, { heard: true }); … } finally { core.talk.inflight--; core.talk.at = core.nowMs(); }
```

잇기는 타입 검사와 e2e 넷으로 본다.

(`PHONE_SESSION`은 지금 `src/server/home/phone.ts`의 파일 안 상수다. 내보내 `act.ts`가 가져온다. `core.agent`가 `startAct` 때 없으면 `core.agent?.pending(...)`.)

- [ ] **Step 4: 통과 확인**

Run(하나씩):
- `npm run heavy -- npx vitest run tests/act-track.test.ts`
- `npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts`
- `npm run heavy -- npx vitest run tests/demo-e2e.test.ts`
- `npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts`
- `npm run heavy -- npx vitest run tests/coach-e2e.test.ts`

Expected: PASS. 물 채우기 e2e는 확인(3장·4초)과 따르기 창 확인 때문에 몇 초 늦지만 `pump` 한도(20초) 안이다. 실행 기록이 「판단·계획·실행 중·완료」 그대로여야 한다(맞추기 전이라 질문하지 않는다). 넘으면 `systematic-debugging`으로 까닭을 찾는다(시험 한도를 늘리지 않는다).

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/act/track/steps.ts src/act/track/core.ts src/act/track/tracker.ts src/observe/pipeline.ts src/server/home/act.ts src/server/home/phone.ts tests/act-track.test.ts
git commit -m "feat(server): wire spoken contents answers, the pour step window and the contents look into the home"
git push origin refactor/domain-split
```

---

### Task 10: 문서와 전체 검증

묶음 11(B 끝에 묻기)을 끝낸 뒤 마지막에 한다.

**Files:**
- Modify: `docs/reference.md`(「관찰 흐름」 World State·VLM·계획·검사·실행 줄, 「가까이 보기」, 판단 전 보기)

- [ ] **Step 1: docs/reference.md 고치기**(결론만, 바뀐 이력 글 없음)
  - World State 줄: 「VLM 사실은 … 같은 값이 두 번 이어지면 확인됨이다」 뒤에 내용물 예외(3장·4초·6초 공백, 같은 원본 프레임 한 장, 확인 값은 사건·따르기 단계로만 다시 열림, 반대 값 2장이면 짐작, 사람 답은 다음 사건까지, 불투명 확인이면 「안이 안 보임」).
  - 관절 줄: 입에 댐·기운 병 사건.
  - 계획·검사·실행 줄: 행동 조건(그대로 두기 내용물 있음, 채우기·콜라 비어 있음), 계획 전 검사는 반대 값만 막음, 실행 전 검사 내용물 모름 → 보류(가까이 보기 → 4초 → 「컵 비었어요?」 말 질문, 단추 없음, 2분, 60초 다시 묻지 않음, 위치 맞춘 뒤·끄기 안내·승인 대기 없을 때), 따르기 단계 창, 조건의 내용물은 확인됨만.
  - 판단 전 보기 B: 짐작도 모름으로 보고, 불투명 컵 내용물은 보지 않음. 계획이 없을 때 B가 가까이 본 뒤 4초에도 모르거나 불투명한 컵은 계획 밖 질문으로 묻는 때(정한 것 1의 조건)와 지우는 때.
- [ ] **Step 2: 전체 검증**(하나씩, 메모리 3GB 넘을 때)
  - `npm run heavy -- npm run typecheck`
  - `npm run heavy -- npm run lint`
  - `npm run heavy -- npx vitest run`(서버 전체. `twin/` 시험 실패는 다른 에이전트 작업이면 그 파일·까닭만 적고 넘긴다)
  - `npm run heavy -- npm --prefix ui test`
- [ ] **Step 3: 커밋·푸시**

```bash
git add docs/reference.md
git commit -m "docs: describe cup contents confirmation, events and the spoken contents question"
git push origin refactor/domain-split
```

- [ ] **Step 4: 구현명세서에서 바꿀 곳 목록을 보고한다**(고치지 않는다): 6.1의 4(사실 53개·면 10개), 6.1의 8(VLM 값 목록에 몸통 면), 6.2 사실·지금만 맞는 상태·관찰 텍스트 줄(내용물 확인 규칙·사건·사람 답 꼬리·불투명), 6.3 행동 목록(행동 조건), 계획 전·실행 전 검사(내용물), 실행 추적(보류·말 질문·따르기 창), 사용자에게 묻기 단락(내용물 질문은 단추 없이 말, 계획 밖 질문), 6.6 B(짐작도 모름, 불투명 제외, B 끝에 묻기)·보류의 가까이 보기, 6.12 노닌치 시나리오 설명(「(짐작)」 줄과 사람 답 꼬리).

---

### Task 11: 판단 전 보기 B 끝에 묻기(계획 밖 질문)

정한 것 1. 묶음 9 뒤, 묶음 10보다 먼저 한다.
- 불투명이 확인된 컵은 B가 가까이 보지 않으므로(묶음 6) B를 기다리지 않고 바로 묻는다. 불투명이 아니면 B가 그 세대에 가까이 본 뒤 4초가 지나야 묻는다.
- 계획 밖 질문은 자기 문맥(`TrackCore.idleAsk`)을 지금 명령 줄 길(openCommand·onAnswer·onHeard·「그만」)과 시간 초과·지우기에 잇는다. 물을 때마다 새 명령 id(`ask:<번호>`)와 단계 id(번호 포함)를 써 앞 질문의 늦은 답을 막는다.
- 폰 대화를 쓰는 중(에이전트가 들은 말을 처리하는 중이거나 끝난 지 10초 안)이면 묻지 않고, 떠 있는 질문은 대화·계획이 시작되면 지운다.

**Files:**
- Modify: `src/act/track/contents.ts`(idle·lookedIdle·idleAnswered·dropIdle), `src/act/track/core.ts`(`TrackCore.idleAsk`), `src/act/track/answers.ts`(openCommand·onAnswer·onHeard), `src/act/track/tracker.ts`(tick·`lookedIdle`·`TrackerOptions.tasks`), `src/act/look.ts`(`LookerOptions.looked`), `src/server/home/act.ts`(잇기)
- Test: `tests/act-track.test.ts`(새 describe, 파일 맨 위 `setup` 사용), `tests/act-look.test.ts`

**Interfaces:**
- Consumes: 묶음 6 `sureValue`·`opaqueBody`·`wantOf`, 묶음 8 `CONTENTS_CHOICES`·`contentsAnswer`·`contentsStep`·`CONTENTS_TEXT`·`answerContents`·`approvalsWaiting`, `ContentsHold`의 `asked`·`quietUntil`
- Produces:

```ts
// src/act/track/core.ts TrackCore
/** 계획 밖 내용물 질문(판단 전 보기 B 끝, src/act/track/contents.ts idle): 명령 id ask:<번호>, 그 컵·세대, 보낸 명령, 물은·읽은 시각. 없으면 null. */
idleAsk: { id: string; objectId: string; gen: number; sent: PlannedCommand; askAt: number; spokeAt: number } | null;
// TrackerOptions
/** 이번 판단에 보내는 행동 목록(src/act/tasks.ts tasksFor). 내용물 행동(want)이 있을 때만 계획 밖 질문을 한다. 없으면 묻지 않는다. */
tasks?: () => readonly string[];
// ExecutionTracker
/** 판단 전 보기 B가 그 컵을 가까이 봤다(src/act/look.ts looked). */
lookedIdle(objectId: string): void;
// LookerOptions
/** B가 가까이 보기를 마쳤다(자원 사정으로 못 본 것은 빼고). 그 물건 id. */
looked?: (objectId: string) => void;
```

- [ ] **Step 1: 실패하는 시험**

`tests/act-track.test.ts` 맨 끝(파일 위쪽 `setup`·`cup`·`world`·`decision` 사용):

```ts
describe("실행 추적: 계획 밖 내용물 질문(판단 전 보기 B 끝)", () => {
  const fact = (value: string) => ({ value, at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" as const });
  const OPAQUE = { body: fact("opaque"), contents: fact("contents_unknown") };
  const GUESS = { contents: { ...fact("empty"), certainty: "inferred" as const } };
  /** 사람이 보이고(먹는 중) 식탁에 컵 하나가 있는 집. tasks 기본은 눈치 모드 목록(내용물 행동 있음), 위치는 맞췄다. */
  function idleSetup(o: { facts?: WorldObject["facts"]; tasks?: string[]; eye?: boolean; person?: boolean; over?: Parameters<typeof setup>[0] } = {}) {
    let facts = o.facts ?? OPAQUE;
    const answered: [string, string, number][] = [];
    const s = setup({
      w: () => world([{ ...cup("present", "on_table", 9_000), facts: { ...facts, place: fact("on_table") }, contents_gen: 2 }], o.person === false ? undefined : "eating", 9_000),
      tasks: () => o.tasks ?? ["컵 치우기", "사용자에게 물어보기", "컵 그대로 두기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"],
      answerContents: (id, v, g) => { answered.push([id, v, g]); facts = { ...facts, contents: { ...fact(v), by: "person" as const } }; return true; },
      ...o.over,
    });
    if (o.eye !== false) s.t.onEye([0, 0]);
    const tick = (ms = 250) => { s.clock.t += ms; s.t.tick(); };
    return { ...s, answered, tick, set: (f: WorldObject["facts"]) => { facts = f; } };
  }

  it("계획이 없고 불투명 컵이면 지금 명령 줄에 「컵 비었어요?」를 단추 없이 소리로 묻고, 말 「비었어」를 그 컵·세대로 넣은 뒤 질문을 지운다", () => {
    const s = idleSetup();
    s.tick();
    // lookedIdle을 부르지 않았다: 불투명 컵은 B를 기다리지 않는다
    expect(s.last()).toEqual({ type: "command", id: "ask:1", step: "ask:1:contents:cup_1:2:1", text: "컵 비었어요?", vision: null, choices: [], target: expect.objectContaining({ id: "cup_1" }), speak: true, grade: "question" });
    expect(s.t.openCommand()).toMatchObject({ planId: "ask:1", kind: "ask", text: "컵 비었어요?" });
    expect(s.heard("비었어")?.id).toBe("empty");
    expect(s.answered).toEqual([["cup_1", "empty", 2]]);
    expect(s.last()).toEqual({ type: "command_clear", id: "ask:1" });
    expect(s.t.openCommand()).toBeNull();
  });

  it("불투명이 아니면 B가 그 세대에 가까이 본 뒤 4초가 지나야 묻는다", () => {
    const s = idleSetup({ facts: GUESS });
    s.tick();
    expect(s.commands()).toEqual([]);
    s.t.lookedIdle("cup_1");
    s.tick(3_500);
    expect(s.commands()).toEqual([]);
    s.tick(600);
    expect(s.last()).toMatchObject({ text: "컵 비었어요?" });
  });

  it("묻지 않는 때: 위치를 맞추기 전, 사람이 안 보임, 목록에 내용물 행동이 없음(코치 모드), 승인 대기, 이미 확인된 컵", () => {
    for (const o of [{ eye: false }, { person: false }, { tasks: ["라면 끓이기 알려 주기", "사용자에게 물어보기"] }, { over: { approvalsWaiting: () => true } }, { over: { talking: () => true } }, { facts: { contents: fact("empty") } }]) {
      const s = idleSetup(o);
      s.tick();
      expect(s.commands()).toEqual([]);
    }
  });

  it("폰 대화가 시작되면(에이전트가 「아 덥다」를 처리) 떠 있는 질문을 지우고, 대화가 끝난 뒤 새 번호로 다시 묻는다", () => {
    let talking = false;
    const s = idleSetup({ over: { talking: () => talking } });
    s.tick();
    expect(s.last()).toMatchObject({ id: "ask:1" });
    talking = true;
    s.tick();
    expect(s.last()).toEqual({ type: "command_clear", id: "ask:1" });
    expect(s.t.onHeard("비었어", { kind: "command", id: "ask:1", step: "ask:1:contents:cup_1:2:1", pending: [] })).toBeNull();
    talking = false;
    s.tick();
    expect(s.last()).toMatchObject({ id: "ask:2", step: "ask:2:contents:cup_1:2:2" });
    expect(s.t.onHeard("비었어", { kind: "command", id: "ask:1", step: "ask:1:contents:cup_1:2:1", pending: [] })).toEqual({ kind: "stale" });
    expect(s.answered).toEqual([]);
  });

  it("계획이 열려 있으면 묻지 않고, 떠 있는 질문은 계획이 시작되면 지운다(계획 명령이 그 자리를 덮어 지우기는 보내지 않는다)", async () => {
    const s = idleSetup();
    s.tick();
    expect(s.last()).toMatchObject({ id: "ask:1" });
    await s.decide(decision);
    s.tick();
    expect(s.t.openCommand()).toMatchObject({ planId: "plan:pam-1", text: "식탁으로 가 주세요" });
    expect(s.phone.some((m) => m.type === "command_clear" && m.id === "ask:1")).toBe(false);
    s.tick();
    expect(s.commands().filter((m) => m.id.startsWith("ask:"))).toHaveLength(1);
  });

  it("다른 명령에 온 말은 늦은 답이고, 「그만」은 질문을 지운다. 세대가 바뀌면 질문을 지운다", () => {
    const s = idleSetup();
    s.tick();
    expect(s.t.onHeard("비었어", { kind: "command", id: "plan:pam-9", step: "plan:pam-9:1", pending: [] })).toEqual({ kind: "stale" });
    expect(s.heard("그만해")?.id).toBe("stop");
    expect(s.last()).toEqual({ type: "command_clear", id: "ask:1" });
    expect(s.answered).toEqual([]);
  });

  it("2분 안에 답이 없으면 지우고(물어봄으로 세지 않음) 그 컵은 60초 동안 다시 묻지 않는다. 답한 컵·세대는 다시 묻지 않는다", () => {
    const s = idleSetup();
    s.tick();
    s.tick(120_100);
    expect(s.last()).toEqual({ type: "command_clear", id: "ask:1" });
    s.tick(30_000);
    expect(s.commands().filter((m) => m.speak && m.text === "컵 비었어요?")).toHaveLength(1);
    s.tick(31_000);
    expect(s.last()).toMatchObject({ id: "ask:2", text: "컵 비었어요?" });
    s.heard("아직 있어");
    s.set(OPAQUE); // 같은 세대로 다시 모름이 되어도
    s.tick(1_000);
    expect(s.last()).toEqual({ type: "command_clear", id: "ask:2" });
  });
});
```

(`setup`의 `heard`는 받은 답의 `ActionChoice`를 돌려준다. 계획 밖 질문의 답은 `CONTENTS_CHOICES` 하나라 `id`가 `empty`·`has` 등이다.)

`tests/act-look.test.ts` B describe에:

```ts
it("B가 가까이 보기를 마치면 looked(그 물건 id)를 부른다. 새 사진이 모자라 못 본 것은 부르지 않는다", async () => {
  const looked: string[] = [];
  const t = await setup({ script: () => [["look_closer", { target: "cup_1", reason: "안을 보려고" }]], objects: [cupAt({ facts: { contents: fact("contents_unknown") } })], options: { looked: (id) => looked.push(id) } });
  t.looker.tick();
  await t.looker.idle();
  expect(looked).toEqual(["cup_1"]);
  const w = await setup({ script: () => [["look_closer", { target: "cup_1", reason: "안을 보려고" }]], objects: [cupAt({ facts: { contents: fact("contents_unknown") } })], closer: testCloser({ ok: false, why: "no_fresh_frames" }), options: { looked: (id) => looked.push(id) } });
  w.looker.tick();
  await w.looker.idle();
  expect(looked).toEqual(["cup_1"]);
});
```

(`testCloser`가 결과를 받는 모양이 다르면 `tests/helpers/look.ts`의 모양에 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/act-track.test.ts -t "계획 밖"`, `npm run heavy -- npx vitest run tests/act-look.test.ts -t looked`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/act/track/contents.ts ContentsHold에 더한다(파일 머리 설명에 「계획이 없으면 B 끝에 묻기」 한 단락)
/** 판단 전 보기 B가 가까이 본 컵: 그때 세대와 시각. */
private readonly lookedB = new Map<string, { gen: number; at: number }>();

lookedIdle(objectId: string): void {
  const o = this.o.world().objects.find((x) => x.id === objectId);
  this.lookedB.set(objectId, { gen: o?.contents_gen ?? 0, at: this.clock.now() });
}

/** 묻지 않을 때: 멈춤·열린 계획·만드는 계획·위치 맞추기 전·폰 없음·끄기 안내·승인 대기·폰 대화 중·사람 안 보임·목록에 내용물 행동 없음. */
private idleBlocked(world: WorldView): boolean {
  const core = this.core;
  return core.stopped || !!core.open() || !!core.planning || !core.eye || !core.start.phoneOk() || core.safety.offPending() || !!core.safety.shownOff()
    || (this.o.approvalsWaiting?.() ?? false) || this.talking() || !world.person.visible || !this.wanting().length;
}

/** 목록의 내용물 행동(want가 있는 행동). */
private wanting(): TaskSpec[] {
  return (this.o.tasks?.() ?? []).map((n) => taskOf(n)).filter((t): t is TaskSpec => !!t?.want && !!t.target);
}

/** 물을 컵: 내용물 행동의 대상 종류이고, 보이고 자리를 알며, 치운 것·손에 든 것이 아니고, 볼 면을 모르고, 이 세대에 묻지 않았고 다시 묻기 대기가 아니며,
 *  불투명이 확인됐거나 B가 이 세대에 가까이 본 지 settleMs가 지났다. 여럿이면 가장 최근에 본 것. */
private idleTarget(world: WorldView, now: number): WorldObject | null {
  const wants = this.wanting();
  const placed = this.core.steps.placed();
  const hit = world.objects.filter((o) => {
    const facets = wants.filter((t) => t.target === o.cls).flatMap((t) => Object.keys(t.want!) as Facet[]);
    if (!facets.length || o.status !== "present" || !o.position || putAway(o, placed) || o.facts.place?.value === "in_hand" || holdsTarget(world, o.cls, true)) return false;
    const gen = o.contents_gen ?? 0;
    if (!facets.some((f) => sureValue(o, f) === null) || this.asked.has(`${o.id}|${gen}`) || now < (this.quietUntil.get(o.id) ?? 0)) return false;
    const b = this.lookedB.get(o.id);
    return opaqueBody(o) || (!!b && b.gen === gen && now - b.at >= CONTENTS_HOLD.settleMs);
  });
  return hit.sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
}

/** tick: 떠 있는 계획 밖 질문은 지났거나 막히면 지우고 repeatMs마다 다시 읽고 askMs가 지나면 지운다(그 컵은 retryMs 동안 다시 묻지 않음). 없으면 물을 컵이 있을 때 묻는다. */
idle(): void {
  const core = this.core;
  if (core.stopped) return;
  const now = this.clock.now();
  const world = this.o.world();
  const blocked = this.idleBlocked(world);
  const q = core.idleAsk;
  if (q) {
    const o = world.objects.find((x) => x.id === q.objectId);
    const lapsed = !o || o.status === "gone" || (o.contents_gen ?? 0) !== q.gen || sureValue(o, "contents") !== null;
    // 계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다
    if (lapsed || blocked) return this.dropIdle(!core.shown());
    if (now - q.askAt > this.cfg.askMs) {
      this.quietUntil.set(q.objectId, now + CONTENTS_HOLD.retryMs);
      return this.dropIdle(true);
    }
    if (now - q.spokeAt >= this.cfg.repeatMs) {
      q.spokeAt = now;
      core.answers.send({ ...q.sent, speak: true });
    }
    return;
  }
  if (blocked) return;
  const o = this.idleTarget(world, now);
  if (!o) return;
  const seq = ++this.askSeq;
  const id = `ask:${seq}`;
  const gen = o.contents_gen ?? 0;
  const name = OBJECT_NAME[o.cls] ?? o.cls;
  const sent: PlannedCommand = { type: "command", id, step: contentsStep(id, o.id, gen, seq), text: CONTENTS_TEXT.ask(name), vision: null, choices: [], target: { id: o.id, label: name, position: o.position! }, speak: true };
  core.idleAsk = { id, objectId: o.id, gen, sent, askAt: now, spokeAt: now };
  core.answers.send(sent);
}

/** 계획 밖 질문의 말 답: 그 컵·세대로 World State에 넣고(늦은 세대면 넣지 않음) 질문을 지운다. */
idleAnswered(picked: ActionChoice): void {
  const q = this.core.idleAsk;
  if (!q) return;
  if (this.o.answerContents?.(q.objectId, (picked as ContentsChoice).value, q.gen)) this.asked.add(`${q.objectId}|${q.gen}`);
  this.dropIdle(true);
}

/** 계획 밖 질문을 지운다. clear면 폰에 지우기를 보낸다. */
dropIdle(clear: boolean): void {
  const q = this.core.idleAsk;
  this.core.idleAsk = null;
  if (q && clear) this.core.answers.send({ type: "command_clear", id: q.id });
}
```

```ts
// src/act/track/answers.ts
// openCommand: const r = core.shown(); 다음
if (!r) {
  const q = core.idleAsk;
  return q ? { planId: q.id, stepId: q.sent.step, kind: "ask", text: q.sent.text, choices: [...CONTENTS_CHOICES] } : null;
}
// onAnswer: 끄기 안내 갈래 다음
const q = core.idleAsk;
if (q && !core.shown() && q.id === planId && q.sent.step === stepId) {
  const picked = CONTENTS_CHOICES.find((c) => c.id === choice);
  if (!picked) return false;
  core.contents.idleAnswered(picked);
  return true;
}
// onHeard: `if (r) { … }` 다음, 끝 「완료」 갈래 앞
const q = off ? null : core.idleAsk;
if (q) {
  if (matchChoice(text, [STOP])) {
    core.contents.dropIdle(true);
    return { kind: "answer", choice: STOP };
  }
  const picked = contentsAnswer(text);
  if (!picked) return null;
  if (at?.kind !== "command" || at.id !== q.id || at.step !== q.sent.step) return { kind: "stale" };
  this.onAnswer(q.id, q.sent.step, picked.id);
  return { kind: "answer", choice: picked };
}
```

```ts
// src/act/track/tracker.ts tick: safety.reminderTick() 다음(계획이 없어도 돈다)
if (!core.stopped) core.contents.idle();
// 공개 메서드
lookedIdle(objectId: string): void {
  this.core.contents.lookedIdle(objectId);
}
// stop(): core.stopped = true 앞에 core.contents.dropIdle(false)
```

```ts
// src/act/look.ts run(): look_closer 결과를 정한 뒤(counted 계산 다음)
// 판단 전 보기 B(계획 없음)가 가까이 보기를 마쳤다: 실행 추적이 그 컵을 계획 밖으로 물을지 본다(자원 사정으로 못 본 것은 빼고)
if (choice.tool === "look_closer" && job.trigger === "unknown_fact" && !job.planId && counted && spot) this.o.looked?.(spot.id);
```

```ts
// src/server/home/act.ts
// ExecutionTracker 옵션: 이번 판단에 보내는 행동 목록(내용물 행동이 있을 때만 계획 밖 질문)
tasks: () => tasksFor(core.assist()),
// startLooker의 Looker 옵션: B가 가까이 본 컵을 실행 추적에 알린다
looked: (id) => tracking.lookedIdle(id),
```

- [ ] **Step 4: 통과 확인**

Run(하나씩): `npm run heavy -- npx vitest run tests/act-track.test.ts`, `npm run heavy -- npx vitest run tests/act-look.test.ts tests/act-say.test.ts tests/talk-grade.test.ts tests/act-track-release.test.ts tests/video-mode-parity.test.ts`, 그리고 데모 e2e 넷(`demo-e2e`·`noonchi-e2e`·`coach-e2e`·`cup-branches-e2e`)을 하나씩. `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
Expected: PASS. e2e 넷은 위치를 맞추지 않아 계획 밖 질문이 나오지 않는다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add src/act/track/contents.ts src/act/track/core.ts src/act/track/answers.ts src/act/track/tracker.ts src/act/look.ts src/server/home/act.ts tests/act-track.test.ts tests/act-look.test.ts
git commit -m "feat(act): ask the cup contents by voice after the pre-decision look when no plan is open"
git push origin refactor/domain-split
```

## Self-Review

- 사용자가 정한 것 1(말로만): Task 1(말 시험 먼저), Task 8(단추 없음·등급 question·onHeard 한 길).
- 정한 것 2(마시기·따르기는 다시 열기만, 새 값은 3장·4초·공백 또는 사람 답): Task 3·4·9(따르기 창).
- 정한 것 3(폰 가장자리 세모): 손대지 않는다.
- 설계 ①: 한 장 무시·후보 충돌 모름·이전 값 보관·짐작은 조건 아님·행동마다 조건 값·확인된 반대 값은 묻지 않음 → Task 3·5·6·8.
- 실행 전 검사 P1·P2: checkDecision·checkPlan·승인 뒤(tryStart가 다시 부름)·until 내용물 확인됨 → Task 5·6·7.
- 사실 갱신 한곳·같은 원본 프레임 한 번·사람 답 우선·사건 전 늦은 답 버림 → Task 3·4.
- 이벤트 계기: 짐작 줄 없음, 확인·사람 답은 판단 계기 → Task 3.
- 불투명: 낱말 표·VLM 답 무시·사람 답만 → Task 2·3.
- 묻기: 내용물 때문에 보류된 행동, 가까이 본 뒤·불투명이면, 질문 문맥(계획 id·단계 id·세대), 늦은 답 버림, 끄기 안내·승인 질문 안 덮음, 등급, 한 컵 한 번·사건 뒤 다시·답 없음은 세지 않음, 위치 맞추기 전 안 물음 → Task 7·8.
- 정한 것 1(B 끝에 묻기): 계획 밖 질문 칸, 같은 답·늦은 답·한 번·답 없음 규칙, 열린·만드는 계획·코치·끄기 안내·승인 대기·폰 대화 중·위치 맞추기 전·사람 안 보임·내용물 행동 없음이면 안 물음, 계획·대화가 시작되면 지움 → Task 11.
- 설계 검토(2026-11-17, P2 일곱): ① 불투명 컵은 B 없이 바로 묻기 → Task 11 첫 시험. ② 계획 밖 질문을 명령 줄 길·시간 초과·「그만」에 잇고 물을 때마다 새 id → Task 8·11(`contentsStep`에 번호). ③ 폰 대화 사용 중 막기·대화 시작 때 지우기 → Task 8·9·11(`talking`). ④ 말 답은 문장 전체만, 부정문·상관없는 말 시험 → Task 1. ⑤ 사람 답보다 먼저 찍힌 사건 버림 → Task 3·4. ⑥ 받치던 사진이 바뀌면 확인을 다시 셈 → Task 3. ⑦ 따라가는 id가 바뀌면 창을 옮김 → Task 9.
- 규칙 표: 「실제 폰 질문은 말로 답할 수 있다」 줄과 막는 장치 `tests/voice-answers.test.ts`(지금 「네」 실수에서 실패) → Task 1.
