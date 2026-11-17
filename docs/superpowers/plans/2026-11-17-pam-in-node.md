# PAM을 Node 안으로 Implementation Plan

> **쉬운 요약**
> 1. PAM 파이썬 서버(`services/pam`, FastAPI)를 없애고, 판단(predict)·반성(reflect)을 Node 서버 안 함수로 옮겨요. 옮긴 코드와 논문 프롬프트는 `src/brain/pam/` 한 폴더에 모아요.
> 2. 논문 프롬프트·해시표(`source_map.json`)·출처 문서는 바이트 그대로 옮기고, 프롬프트 해시가 표와 다르면 시험이 실패해요.
> 3. 지우기 전에 Python으로 「정답 파일」을 만들어 두고, 같은 입력이면 TS가 글자 하나까지 같은 메시지·같은 전송 본문·같은 답 검사 결과를 내는지 시험해요.
> 4. 시험의 가짜 PAM 서버는 가짜 LLM 서버로 바꾸고, compose·CI·스크립트에서 pam 서비스를 지워요.
> 5. 실제 모델은 부르지 않아요(비용 0). 묶음마다 커밋·push해요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PAM 서비스(HTTP)를 없애고 `PamClient`(predict·reflect·limits)를 같은 모양 그대로 Node 안 함수로 바꾼다. 결과(메시지·LLM 요청 본문·답 검사)는 지금 Python과 바이트까지 같다.

**Architecture:** `src/brain/pam/`이 Python `services/pam`의 `pam/`(계약·메시지·시나리오)과 `noonchi_pam/`(요청 모양·프롬프트·문맥 길이·LLM·설정)을 그대로 옮긴 TS다. 요청 모양은 zod(입력 모양 검사 도구)로, LLM 호출은 openai SDK(OpenAI 호환 주소를 부르는 공식 도구)로 한다. 모드(mock·live)에 따라 바뀌는 PAM LLM 주소·모델·키·제공자 칸은 `src/infer/endpoints.ts` 한곳에서 고른다(같은 구조 규칙). `decide.ts`·`history/reflect.ts`는 import 경로만 바뀐다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, openai 7.32.0, Vitest(시험 도구), 가짜 LLM 서버(`tests/helpers/pam.ts`), 정답 파일을 만들 때만 Python 3.13(`services/pam/requirements-test.lock`).

**Spec:** 사용자 결정(2026-11-17, 조정자 전달): PAM 서비스를 없애고 판단·반성을 Node로 옮긴다. 옮긴 코드·논문 프롬프트·source_map·출처 문서는 `src/brain/pam/` 한 폴더에 둔다. AI 담당(박석준·김준형)이 앞으로 그 폴더를 고친다. 계약 설명 `docs/pam-interface.md`, 저장소 설명 `docs/reference.md` 「PAM 서비스」.

## 정한 것 (2026-11-17)

1. **까닭:** PAM은 상태가 없고(stateless), Node가 이미 SQLite를 읽고, Python만 되는 의존성이 없다(FastAPI·pydantic·httpx·표준 라이브러리, 토큰은 바이트÷3 추정).
2. **한 폴더:** `src/brain/pam/`에 TS 코드, `prompts/`(논문 프롬프트 일곱 개·`source_map.json`), `config/`(`paper.json`·`openrouter.json`), `scenarios/noonchi/`(`scenario.json`·`tasks.json`), `PROVENANCE.md`, `THIRD_PARTY.md`, 안내 `README.md`를 둔다. 데이터 파일은 한 바이트도 바꾸지 않는다.
3. **`PamClient` 모양은 그대로:** `predict(r)`·`reflect(r, kind)`·`limits()`. 생성자만 `{ url }` 대신 `{ settings }`를 받는다. 오류 갈래도 그대로다.

   | 예전 HTTP | 새 오류(모두 `ContractError`의 자식, 마지막만 아님) | `decide.ts`가 보는 것 |
   |---|---|---|
   | 400 요청이 계약에 안 맞음·사진 칸 | `PamRequestError` | 판단 실패 |
   | 413 문맥 길이 넘음(LLM에 보내지 않음) | `PamBudgetError` | 판단 실패 |
   | 200 `status: "invalid"`(답이 계약에 안 맞음, 대기와 다름) | `PamAnswerError` | 판단 실패 |
   | 502 LLM 연결 실패·HTTP 오류·잘린 답·모양 틀림 | `PamLinkError` | PAM 연결 끊김 |

4. **설정·환경 변수 이름은 `settings.py`와 같다:** `INFERENCE_MODE`, `PAM_LLM_PROVIDER`(mock에서 `openai`만), `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL`, `PAM_LLM_API_KEY`, `PAM_LLM_TIMEOUT_S`(기본 120), `PAM_MAX_MODEL_LEN`(기본 32768, 반성 출력 16384보다 커야 함), `OPENROUTER_API_KEY`, `VLLM_API_KEY`, `OPENAI_API_KEY`. OpenRouter는 provider `alibaba` 고정·다른 공급자로 넘기지 않음·문맥 압축 끔, max_tokens 판단 2048·반성 16384. `.env` 파일은 열지 않고 이름은 코드에서만 읽는다.
5. **없어지는 것:** `PAM_URL`, `PAM_HOST_PORT`, `CHECK_PAM_PORT`, compose `pam` 서비스·`noonchi`의 `depends_on: pam`, PAM 이미지(`services/pam/Dockerfile`), CI `pam` 일, PAM `/health`. `/api/health`의 `ready.pam`은 VLM과 같은 모양 `{ base_url, model, key, reachable }`이 되고 `reachable`은 `GET {PAM LLM 주소}/models`(30초 캐시)다.
6. **그대로 두는 것:** `PAM_TIMEOUT_MS`(판단 한 번 제한, 기본 30000). 판단은 이것과 `PAM_LLM_TIMEOUT_S` 가운데 짧은 쪽, 반성은 `PAM_LLM_TIMEOUT_S`로 끊는다. 계약 이름 `pam-predict/2`·`pam-reflect/2`는 `PamClient` 입력 모양 이름으로 남는다.
7. **TS가 받는 시각 꼴:** `YYYY-MM-DDTHH:MM[:SS[.f…]](Z|±HH:MM)`. Python(pydantic)과 같게 `isoformat()` 꼴로 바꿔 메시지에 쓴다(`.000` 빼기, 소수 초 6자리, `Z`·`-00:00` → `+00:00`, 초가 없으면 `:00`). pydantic이 더 받아 주던 숫자 시각·띄어쓰기·`+0900` 꼴은 받지 않는다(Node는 보내지 않는다). 반성 날짜는 `YYYY-MM-DD`만 받는다.
8. **글자 수는 Python처럼 센다:** 요청 글 길이 상한(관찰 20000·반성 관찰 100000·행동 요약 50000·피드백 8000)은 코드 포인트로 센다(이모지 한 개 = 1). 「비었다」는 Python `str.strip()`과 같은 공백 목록으로 본다.
9. **답 검사는 Python `json.loads`와 같다:** 중복 키(안쪽 객체가 먼저 닫히는 차례), `NaN`·`Infinity` 상수, `1.0`·`1e0` 같은 소수 꼴 정수, `__proto__` 키, 앞뒤 공백, BOM을 Python과 같게 다룬다. 검사 글(`incorrect fields (missing=[...], extra=[...])`, `duplicate key '…'`)도 Python과 같다. JSON 문법 오류 글만 다르다(`JSON syntax error at char N`).
10. **정답 파일(fixture):** 지우기 전에 Python으로 만들어 커밋한다(`tests/fixtures/pam-golden/`). 메시지·전송 본문은 `toMatchFileSnapshot`으로 바이트까지 비교한다. 나중에 프롬프트를 일부러 바꾸면 `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 쓰고 차이를 보고 커밋한다.
11. **옮기지 않는 것:** 사진 경로 함수(`pam/messages.py`의 `build_predictor_messages`·`build_reflector_messages`·`_frame_content`), 사진 기록 목록 검사(`validate_observation_records`), 시나리오 기억 파일 읽기(`load_scenario_memory`, `memory_files`가 비어 있음), Python 시험 보조(`conftest._retry_efault`). 모두 부르는 곳이 없다. 논문 원문 프롬프트는 그대로 옮기고, 「원문에는 REFERENCE 문장이 있다」는 원문 파일로 시험한다.

## 조사한 사실 (2026-11-17, `refactor/pam-in-node` cb07b65)

| 사실 | 자리 |
|---|---|
| Node `PamClient`가 HTTP로 `/predict`·`/reflect`·`/health`를 부르고, 400·413은 `ContractError`, 그 밖 오류는 `PamLinkError` | `src/brain/pam.ts` |
| `PamClient`를 만드는 곳 둘: 판단(`PAM_TIMEOUT_MS`), 반성 | `src/server/home/act.ts:81-83`, `src/server/start.ts:160` |
| `ready.pam`이 PAM `/health`를 매번 부른다 | `src/server/ready.ts:25-43`, `src/contract/events.ts:231` |
| `INFERENCE_MODE`는 `src/infer/endpoints.ts`만 읽어야 한다 | `tests/same-structure.test.ts:23` |
| 기반층(`src/infer/`)은 도메인을 import하면 안 된다 | `scripts/lint-domains.ts:177,226` |
| Node에 이미 `validateTasks`·`validateMemory`·`validatePrediction`·`parsePrediction`이 있다. 검사 글 꼴과 `1.0`·`NaN`·중복 키 차례가 Python과 다르다 | `src/brain/decision.ts:15-160` |
| 가짜 PAM 서버를 쓰는 곳: 시험 18개 파일 35곳, 스크립트 2개 | `tests/helpers/pam.ts`, `scripts/video-check.ts`, `scripts/twin3d/e2e-dashboard.ts` |
| `PAM_URL`을 쓰는 시험·스크립트 26개 | `grep -rln PAM_URL tests scripts` |
| 시험은 실제 OpenAI·OpenRouter·Anthropic으로 가는 `fetch`를 막는다 | `tests/setup/no-real-ai.ts` |
| CI는 push마다 돈다. `pam` 일이 `pytest services/pam`과 PAM 이미지를 빌드한다 | `.github/workflows/ci.yml:3-5,41-57` |
| httpx 0.28.1은 JSON을 `separators=(",",":")`·`ensure_ascii=False`로 보낸다 = `JSON.stringify` | 확인: `httpx.Request(json=…).content` |
| Node 22.15는 `JSON.parse` reviver 셋째 인자(`source`)를 준다 | 확인: `node -e` |
| pydantic은 `"…21:00+09:00"` → `21:00:00+09:00`, `.1234567` → `.123456`, `-00:00` → `+00:00`, `Z` → `+00:00`, `+24:00`·`T24:00`·`:60` 거절 | 확인: pydantic 2.13 |
| 이 PC의 Python: `py -3.13`(anaconda), `core.autocrlf=true` | `py -0p`, `git config` |

## Global Constraints

- 서버·PAM은 띄우지 않는다. 실제 모델은 부르지 않는다(비용 0). 모든 LLM 호출은 가짜 서버나 `fetchImpl`로 받는다.
- 무거운 일은 하나씩: 시험은 `npm run heavy -- <명령>`. 작은 시험 파일 하나는 빈 메모리 2.6GB까지, e2e·typecheck·전체 시험은 3GB 이상에서만.
- force·amend·bare `git stash` 금지. 영어 커밋 메시지, attribution 없음. 내 파일만 경로로 `git add`(`.gitignore`·`.ignore`의 graft 변경은 커밋하지 않는다).
- docs 저장소와 `twin-home-split` worktree는 고치지 않는다.
- 논문 프롬프트(`prompts/paper/*.txt`)와 `source_map.json`은 바이트 그대로다.
- 저장소 규칙 표(`CLAUDE.md`)를 지킨다: mock·live 같은 구조(가짜는 `tests/helpers/`에만, 같은 주소 자리에 붙는 가짜 서버), 도메인 경계(`scripts/lint-domains.ts`), PAM에는 사진을 넘기지 않음, 바깥 글 자르기는 `headWithin`만.
- 묶음마다: 실패하는 시험 먼저 → 구현 → 통과 → 커밋 → push → 해시 보고.

---

## File Structure

| 파일 | 맡는 일 | 옮겨 온 곳 |
|---|---|---|
| `src/brain/pam/README.md` | AI 담당 안내: 어디를 고치면 무엇이 바뀌는지, 시험 | 새로 |
| `src/brain/pam/PROVENANCE.md`, `THIRD_PARTY.md` | 출처 | `services/pam/` 그대로 |
| `src/brain/pam/prompts/paper/*.txt`, `prompts/source_map.json` | 논문 프롬프트·해시표 | 그대로 |
| `src/brain/pam/config/paper.json`, `openrouter.json` | 논문 설정·전송 설정 | 그대로 |
| `src/brain/pam/scenarios/noonchi/scenario.json`, `tasks.json` | 노닌치 바꾸기·행동 목록 | 그대로 |
| `src/brain/pam/py.ts` | Python과 같은 글 다루기(`repr`, 목록 `repr`, `strip()` 빈 글, 코드 포인트 정렬) | 새로 |
| `src/brain/pam/pyjson.ts` | Python `json.loads`(중복 키·상수 거절)와 같은 엄격 읽기 | `pam/contracts.py`·`prompt.py` 훅 |
| `src/brain/pam/paper.ts` | 논문 설정·프롬프트 읽기(해시 검사)·자리 끼워 넣기 | `pam/messages.py` |
| `src/brain/pam/scenario.ts` | 시나리오 읽기·프롬프트 바꾸기 | `pam/scenarios.py` |
| `src/brain/pam/errors.ts` | `PamRequestError`·`PamBudgetError`·`PamAnswerError`·`PamLinkError` | 새로(HTTP 상태 대신) |
| `src/brain/pam/request.ts` | 요청 모양(zod), 시각 꼴 | `noonchi_pam/contracts.py` |
| `src/brain/pam/prompt.ts` | 판단·반성 메시지 만들기 | `noonchi_pam/prompt.py` |
| `src/brain/pam/answer.ts` | 답 검사(`parsePrediction`·`parseMemory`) | `pam/contracts.py`, `noonchi_pam/prompt.py` |
| `src/brain/pam/budget.ts` | 토큰 추정·문맥 길이 검사·입력 한도 | `noonchi_pam/budget.py` |
| `src/brain/pam/settings.ts` | 전송 값(max_tokens·시간 제한·문맥 길이) | `noonchi_pam/settings.py` |
| `src/brain/pam/llm.ts` | openai SDK로 chat completions 한 번 | `noonchi_pam/llm.py` |
| `src/brain/pam/client.ts` | `PamClient`·`PamDecision`·`assertTextOnly` | `src/brain/pam.ts` |
| `src/brain/pam/index.ts` | 이 폴더의 입구 | 새로 |
| `src/infer/endpoints.ts` | PAM LLM 모드 표(`PAM_PRESETS`·`PAM_PROVIDERS`), `Endpoints.pam` | `settings.py` `PRESETS`·`PROVIDERS` |
| `src/brain/decision.ts` | 기억 모양·seed·`validateTasks`·`validateMemory`·`validatePrediction`(검사 글 Python 꼴) | 그대로, `parsePrediction`·`findDuplicateKey`만 `answer.ts`로 |
| `tests/helpers/pam.ts` | 가짜 PAM LLM 서버(OpenAI 호환), 메시지에서 요청 값 되읽기 | 가짜 PAM 서버 대신 |
| `tests/fixtures/pam-golden/` | Python 정답 파일 | 새로 |

지우는 것: `services/pam/` 전부, `src/brain/pam.ts`.

## Python 시험 → TS 시험

| Python | TS |
|---|---|
| `test_prompts.py` 해시 읽기·LF·`.gitattributes`·논문 설정·노닌치 문장 다섯·원문 REFERENCE 문장 | `tests/pam-prompts.test.ts` |
| `test_v2.py` 사진 칸·시간대·계약 이름·크기 상한·메시지 내용·list 프롬프트·반성 메시지 | `tests/pam-request.test.ts` |
| `test_v2.py` `parse_memory` 엄격 | `tests/pam-answer.test.ts` |
| `test_contracts.py` 행동 목록·기억·판단 답 | `tests/pam-answer.test.ts` |
| `test_contracts.py` 사진 기록 목록 | 옮기지 않음(정한 것 11) |
| `test_budget.py` 셋 | `tests/pam-budget.test.ts` |
| `test_app.py` 판단 모양·사진 칸 400·나쁜 기억은 보내지 않음·invalid는 대기와 다름·502·반성·413 | `tests/pam-golden.test.ts` 「요청 결과」, `tests/brain-pam.test.ts` |
| `test_app.py` 모드 표·openai 칸·모르는 공급자·모르는 모드·두 모드 같은 칸·반성 max_tokens | `tests/pam-llm.test.ts`, `tests/pam-golden.test.ts` 「설정」·「전송 본문」 |
| `test_app.py` `/health` 둘 | `tests/health-ready.test.ts` 「PAM LLM 주소 응답」 |
| `test_efault_retry.py` | 옮기지 않음(정한 것 11). Node는 `fetchRetry`가 EFAULT를 다시 보낸다 |

---

### Task 1: Python 정답 파일

**Files:**
- Create: `services/pam/tests/make_golden.py`(Task 6에서 `services/pam`과 함께 지운다)
- Create: `tests/fixtures/pam-golden/inputs.json`, `tests/fixtures/pam-golden/out/*`
- Modify: `.gitattributes`(정답 파일 바이트 고정)

**Interfaces:**
- Produces: `inputs.json`의 칸 `predict`·`reflect`(`{id, request}`), `parse`(`{id, raw, tasks}`), `memory`(`{id, raw, kind}`), `requests`(`{id, route, body, llm: {status, json}}`), `settings`(`{id, env}`), `limits`(env 목록).
- Produces: `out/<id>.messages.json`(`{messages, generation}`, `json.dumps(indent=2, ensure_ascii=False)` + `\n`), `out/<id>.wire.txt`(전송 세 갈래), `out/tokens.json`, `out/adaptation.json`, `out/parse.json`, `out/memory.json`, `out/requests.json`, `out/limits.json`, `out/settings.json`. JSON 문법 오류는 `"<json>"`으로 적는다.

- [ ] **Step 1: 입력 파일을 만든다(스크래치패드 스크립트, 커밋하지 않음)**

`<scratchpad>/make-pam-inputs.ts`를 저장소 뿌리에서 `npx tsx <scratchpad>/make-pam-inputs.ts`로 한 번 돌린다.

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const { CUP_FSM_MEMORY, CUP_MEMORY, CUP_TASKS } = await import(pathToFileURL(join(repo, "src/brain/decision.ts")).href);
const { TASK_NAMES } = await import(pathToFileURL(join(repo, "src/act/tasks.ts")).href);

const MEMORY = { initial_state: "drinking", states: [
  { id: "drinking", description: "마시는 중", rules: [], next: [{ to: "left_cup", on: "컵을 두고 떠남" }] },
  { id: "left_cup", description: "컵을 두고 자리를 비움", rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }], next: [] }] };
const ODD = { initial_state: "s", states: [{ id: "s", description: "{tasks_block} $& \\ \"따옴표\" 🍜", rules: [{ trigger: "{fsm_block} $1", action: "컵 치우기" }], next: [] }] };
const OBS = ["21:00:00 사람 보임", "21:00:04 사람이 말함: 「아 덥다 🍜」", "[지속] 컵 cup_1 식탁 위 · 비어 있음", "[눈] 거실\t소파 앞 \\ \"x\""].join("\n");
const P = { contract: "pam-predict/2", final_time: "2026-11-07T21:00:08.000+09:00", observation_text: OBS, memory_kind: "fsm", memory: CUP_FSM_MEMORY, tasks: [...TASK_NAMES] };
const R = { contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: CUP_FSM_MEMORY,
  observation_text: "07:58:02 사람 보임\n08:10:40 사람이 말함: 「컵 치워 줘」", action_summary: "08:10:40 컵 치우기 부탁", feedback: "다 마신 뒤에만 치워 줘" };
const ok = (i: string | number) => `{"observation":"o","reasoning":"r","task_index":${i}}`;
const answer = (content: unknown, finish: unknown = "stop") => ({ status: 200, json: { choices: [{ message: { content }, finish_reason: finish }] } });
const T = ["컵 치우기", "사용자에게 물어보기"];
const { feedback: _f, ...R_NO_FEEDBACK } = R;
const BIG = { initial_state: "s", states: [{ id: "s", description: "d", next: [],
  rules: Array.from({ length: 300 }, (_, i) => ({ trigger: "가".repeat(100) + i, action: "컵 치우기" })) }] };

const inputs = {
  predict: [
    ["p-fsm-seed", {}],
    ["p-list", { memory_kind: "list", memory: CUP_MEMORY, tasks: [...CUP_TASKS], final_time: "2026-11-07T21:00:08+09:00" }],
    ["p-frac", { final_time: "2026-11-07T21:00:08.123+09:00", memory: MEMORY }],
    ["p-z", { final_time: "2026-11-07T12:00:08.000Z", memory: MEMORY }],
    ["p-neg", { final_time: "2026-11-07T07:00:08-05:30", memory: MEMORY }],
    ["p-nosec", { final_time: "2026-11-07T21:00+09:00", memory: MEMORY }],
    ["p-longfrac", { final_time: "2026-11-07T21:00:08.1234567+09:00", memory: MEMORY }],
    ["p-utc-minus", { final_time: "2026-11-07T12:00:08-00:00", memory: MEMORY }],
    ["p-odd", { memory: ODD, tasks: ["컵 치우기", "$1 묻기"] }],
    ["p-max", { observation_text: "가".repeat(19_999) + "🍜", memory: MEMORY, tasks: ["컵 치우기"] }],
  ].map(([id, over]) => ({ id, request: { ...P, ...(over as object) } })),
  reflect: [
    ["r-fsm", {}], ["r-null", { feedback: null }], ["r-empty", { feedback: "" }],
    ["r-list", { memory_kind: "list", memory: CUP_MEMORY }], ["r-odd", { memory: ODD, action_summary: "Summary:\n$& \\" }],
  ].map(([id, over]) => ({ id, request: { ...R, ...(over as object) } })),
  parse: Object.entries({
    "valid-0": ok(0), "valid-wait": ok(-1), "valid-1": ok(1), "minus-zero": ok("-0"), "spaces": ` \n${ok(0)}\t\r\n`,
    "fenced": "```json\n" + ok(0) + "\n```", "prose": "답: " + ok(0), "trailing": ok(0) + " x", "empty": "", "bom": "\ufeff" + ok(0),
    "dup-top": `{"observation":"o","reasoning":"r","task_index":0,"task_index":-1}`,
    "dup-nested-first": `{"observation":"o","observation":{"x":1,"x":2},"reasoning":"r","task_index":0}`,
    "dup-quote": `{"it's":1,"it's":2}`, "dup-korean": `{"관찰":1,"관찰":2}`,
    "nan": ok("NaN"), "inf": ok("Infinity"), "neg-inf": ok("-Infinity"), "nan-then-syntax": `{"task_index":NaN,`,
    "float": ok("1.0"), "exp": ok("1e0"), "bool": ok("true"), "string-index": ok('"0"'), "out": ok(2), "below": ok(-2), "huge": ok("1e400"),
    "extra": `{"observation":"o","reasoning":"r","task_index":0,"x":1}`, "missing": `{"observation":"o","reasoning":"r"}`,
    "proto": `{"observation":"o","reasoning":"r","task_index":0,"__proto__":1}`,
    "blank": `{"observation":" ","reasoning":"r","task_index":0}`, "ideo-space": `{"observation":"\\u3000","reasoning":"r","task_index":0}`,
    "unit-sep": `{"observation":"\\u001f","reasoning":"r","task_index":0}`, "bom-text": `{"observation":"\\ufeff","reasoning":"r","task_index":0}`,
    "array": "[]", "null": "null", "number": "1.5", "control": `{"observation":"a\nb","reasoning":"r","task_index":0}`,
    "surrogate": `{"observation":"\\ud800","reasoning":"r","task_index":0}`,
  }).map(([id, raw]) => ({ id, raw, tasks: T })),
  memory: [
    ["fsm", JSON.stringify(CUP_FSM_MEMORY), "fsm"], ["list", JSON.stringify(CUP_MEMORY), "list"],
    ["fenced", "```json\n{}\n```", "list"], ["dup", '{"rules": [], "rules": []}', "list"],
    ["nan", '{"rules": [{"trigger": "a", "action": NaN}]}', "list"], ["array", "[]", "list"], ["extra", '{"rules": [], "x": 1}', "list"],
    ["kind-mismatch", JSON.stringify(CUP_MEMORY), "fsm"],
    ["unknown-state", JSON.stringify({ initial_state: "a", states: [{ id: "a", description: "d", rules: [], next: [{ to: "b", on: "o" }] }] }), "fsm"],
    ["dup-state", JSON.stringify({ initial_state: "a", states: [{ id: "a", description: "d", rules: [], next: [] }, { id: "a", description: "e", rules: [], next: [] }] }), "fsm"],
    ["no-initial", JSON.stringify({ initial_state: "z", states: [{ id: "a", description: "d", rules: [], next: [] }] }), "fsm"],
    ["number-trigger", '{"rules":[{"trigger":1,"action":"a"}]}', "list"], ["float-trigger", '{"rules":[{"trigger":1.5,"action":"a"}]}', "list"],
    ["empty-states", '{"initial_state":"a","states":[]}', "fsm"], ["blank-action", '{"rules":[{"trigger":"t","action":"\\u2003"}]}', "list"],
    ["proto", '{"rules":[],"__proto__":{}}', "list"],
  ].map(([id, raw, kind]) => ({ id, raw, kind })),
  requests: [
    ["ok", "predict", P, answer(ok(-1))],
    ["frames", "predict", { ...P, frames: [{ image: { base64: "AAAA" } }] }], ["image-url", "predict", { ...P, image_url: "data:image/jpeg;base64,AAAA" }],
    ["no-tz", "predict", { ...P, final_time: "2026-11-07T21:00:08" }], ["old-contract", "predict", { ...P, contract: "pam-predict/1" }],
    ["bad-time", "predict", { ...P, final_time: "2026-11-07T24:00:00+09:00" }],
    ["empty-text", "predict", { ...P, observation_text: "" }], ["long-text", "predict", { ...P, observation_text: "가".repeat(20_001) }],
    ["no-tasks", "predict", { ...P, tasks: [] }], ["blank-task", "predict", { ...P, tasks: [" "] }], ["number-task", "predict", { ...P, tasks: [1] }],
    ["bad-memory", "predict", { ...P, memory: { initial_state: "x", states: [] } }], ["kind-none", "predict", { ...P, memory_kind: "none" }],
    ["memory-array", "predict", { ...P, memory: [] }], ["over-context", "predict", { ...P, memory: BIG }],
    ["fenced-answer", "predict", P, answer("```json\n{}\n```")], ["truncated", "predict", P, answer("{", "length")],
    ["no-finish", "predict", P, answer(ok(-1), null)], ["http-500", "predict", P, { status: 500, json: { error: "x" } }],
    ["http-429", "predict", P, { status: 429, json: { error: "x" } }], ["shape", "predict", P, { status: 200, json: { unexpected: true } }],
    ["null-content", "predict", P, answer(null)],
    ["reflect-ok", "reflect", R, answer(JSON.stringify(CUP_FSM_MEMORY))], ["reflect-null-feedback", "reflect", { ...R, feedback: null }],
    ["reflect-no-feedback-key", "reflect", R_NO_FEEDBACK], ["reflect-photos", "reflect", { ...R, photos: [] }],
    ["reflect-long-feedback", "reflect", { ...R, feedback: "가".repeat(8_001) }], ["reflect-long-obs", "reflect", { ...R, observation_text: "가".repeat(100_001) }],
    ["reflect-long-summary", "reflect", { ...R, action_summary: "가".repeat(50_001) }], ["reflect-empty-summary", "reflect", { ...R, action_summary: "" }],
    ["reflect-bad-day", "reflect", { ...R, day: "2026-13-01" }], ["reflect-over-context", "reflect", { ...R, observation_text: "가".repeat(90_000), feedback: null }],
    ["reflect-invalid-answer", "reflect", R, answer("not json")], ["reflect-wrong-kind-answer", "reflect", R, answer('{"rules":[]}')],
  ].map(([id, route, body, llm]) => ({ id, route, body, llm: llm ?? (route === "predict" ? answer(ok(-1)) : answer(JSON.stringify(CUP_FSM_MEMORY))) })),
  settings: [
    ["mock", {}], ["mock-key", { OPENROUTER_API_KEY: "k" }], ["live", { INFERENCE_MODE: "live" }],
    ["live-len", { INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "24576" }], ["live-len-small", { INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "16384" }],
    ["openai", { PAM_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }], ["gemini", { PAM_LLM_PROVIDER: "gemini" }],
    ["live-openai", { INFERENCE_MODE: "live", PAM_LLM_PROVIDER: "openai" }], ["replay", { INFERENCE_MODE: "replay" }],
    ["override", { INFERENCE_MODE: "live", PAM_LLM_BASE_URL: "http://x:1/v1//", PAM_LLM_MODEL: "m", PAM_LLM_API_KEY: "a", VLLM_API_KEY: "b", PAM_LLM_TIMEOUT_S: "30" }],
    ["blank", { INFERENCE_MODE: " live ", PAM_LLM_MODEL: "  ", PAM_LLM_PROVIDER: " " }], ["vllm-key", { INFERENCE_MODE: "live", VLLM_API_KEY: "v" }],
  ].map(([id, env]) => ({ id, env })),
  limits: [{}, { INFERENCE_MODE: "live" }, { INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "20000" }, { INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "24576" }],
};
mkdirSync(join(repo, "tests/fixtures/pam-golden/out"), { recursive: true });
writeFileSync(join(repo, "tests/fixtures/pam-golden/inputs.json"), JSON.stringify(inputs, null, 2) + "\n");
```

- [ ] **Step 2: 정답 생성기를 쓴다**

`services/pam/tests/make_golden.py`:

```python
"""옮기기 전 Python PAM의 정답 파일(tests/fixtures/pam-golden/out)을 만든다. 한 번만 돌린다. 실제 모델은 부르지 않는다(httpx MockTransport)."""
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from noonchi_pam.app import create_app  # noqa: E402
from noonchi_pam.budget import estimate_tokens, limits  # noqa: E402
from noonchi_pam.contracts import PredictRequest, ReflectRequest  # noqa: E402
from noonchi_pam.llm import LlmClient  # noqa: E402
from noonchi_pam.prompt import _adapted, build_predict_messages, build_reflect_messages, parse_memory  # noqa: E402
from noonchi_pam.settings import Settings  # noqa: E402
from pam.contracts import _reject_constant, _unique_object, parse_prediction  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DIR = REPO / "tests" / "fixtures" / "pam-golden"
OUT = DIR / "out"
JSON_ERR = "<json>"
TRANSPORTS = {"mock": {"OPENROUTER_API_KEY": "k"}, "live": {"INFERENCE_MODE": "live"},
              "openai": {"PAM_LLM_PROVIDER": "openai", "OPENAI_API_KEY": "k"}}
OK_REPLY = {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def dump(path: Path, value, ascii: bool = False) -> None:
    """메시지 파일은 글자 그대로(TS toMatchFileSnapshot과 바이트 비교). 검사 결과(parse·memory)는 단독 대리 문자(\\ud800)가 들어
    UTF-8로 쓸 수 없으므로 ascii=True로 이스케이프한다(TS는 JSON.parse한 값으로 비교한다)."""
    write(path, json.dumps(value, ensure_ascii=ascii, indent=2) + "\n")


def wire(env: dict, built: dict, role: str) -> str:
    sent = []

    def handler(req):
        sent.append(f"POST {req.url}\nauthorization: {req.headers.get('authorization', '-')}\n\n{req.content.decode('utf-8')}")
        return httpx.Response(200, json=OK_REPLY)
    LlmClient(Settings.from_env(env), transport=httpx.MockTransport(handler)).complete(built["messages"], built["generation"], role=role)
    return sent[0]


def messages(cases, build, model, role, tokens):
    for case in cases:
        built = build(model(**case["request"]))
        dump(OUT / f"{case['id']}.messages.json", {"messages": built["messages"], "generation": built["generation"]})
        write(OUT / f"{case['id']}.wire.txt", "".join(f"=== {t} ===\n{wire(env, built, role)}\n" for t, env in TRANSPORTS.items()))
        tokens[case["id"]] = estimate_tokens(built["messages"])


def is_json_error(raw: str) -> bool:
    try:
        json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except json.JSONDecodeError:
        return True
    except Exception:
        return False
    return False


def main() -> None:
    inputs = json.loads((DIR / "inputs.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    tokens: dict = {}
    messages(inputs["predict"], build_predict_messages, PredictRequest, "predictor", tokens)
    messages(inputs["reflect"], build_reflect_messages, ReflectRequest, "reflector", tokens)
    dump(OUT / "tokens.json", tokens)

    adaptation = {}
    for pid in ("predictor_fsm", "predictor_list", "reflector_fsm_update", "reflector_list_update"):
        a = _adapted(pid)[1]
        adaptation[pid] = {"applied": [{k: c[k] for k in ("old", "new", "reason", "occurrences")} for c in a["applied_changes"]],
                           "adapted_template_sha256": a["adapted_template_sha256"]}
    dump(OUT / "adaptation.json", adaptation)

    parse = []
    for c in inputs["parse"]:
        r = parse_prediction(c["raw"], c["tasks"])
        if is_json_error(c["raw"]):
            r["errors"] = [JSON_ERR]
        parse.append({"id": c["id"], "result": r})
    dump(OUT / "parse.json", parse, ascii=True)

    memory = []
    for c in inputs["memory"]:
        try:
            memory.append({"id": c["id"], "ok": True, "memory": parse_memory(c["raw"], c["kind"])})
        except ValueError as e:
            decode = isinstance(e, json.JSONDecodeError) or isinstance(e.__cause__, json.JSONDecodeError)
            memory.append({"id": c["id"], "ok": False, "error": JSON_ERR if decode else str(e)})
    dump(OUT / "memory.json", memory, ascii=True)

    requests = []
    for c in inputs["requests"]:
        sent = []

        def handler(req, c=c):
            sent.append(1)
            return httpx.Response(c["llm"]["status"], json=c["llm"]["json"])
        s = Settings.from_env({"INFERENCE_MODE": "live"})
        r = TestClient(create_app(s, LlmClient(s, transport=httpx.MockTransport(handler)))).post(f"/{c['route']}", json=c["body"])
        requests.append({"id": c["id"], "status": r.status_code,
                         "answer": r.json()["status"] if r.status_code == 200 else None, "sent": len(sent)})
    dump(OUT / "requests.json", requests)

    dump(OUT / "limits.json", [{"env": env, "limits": limits(Settings.from_env(env))} for env in inputs["limits"]])

    settings = []
    for c in inputs["settings"]:
        try:
            settings.append({"id": c["id"], "settings": asdict(Settings.from_env(c["env"]))})
        except ValueError as e:
            settings.append({"id": c["id"], "error": str(e)})
    dump(OUT / "settings.json", settings)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 잠금 파일 판으로 돌린다**

```bash
SCRATCH="<scratchpad>"
py -3.13 -m venv "$SCRATCH/pamvenv"
"$SCRATCH/pamvenv/Scripts/python.exe" -m pip install --require-hashes -r services/pam/requirements-test.lock
cd services/pam && "$SCRATCH/pamvenv/Scripts/python.exe" tests/make_golden.py
```

Expected: `tests/fixtures/pam-golden/out/`에 `.messages.json` 15개, `.wire.txt` 15개, JSON 7개. 내려받기가 안 되면 멈추고 보고한다(시스템 Python은 pydantic 판이 달라 쓰지 않는다).

- [ ] **Step 4: 정답을 눈으로 확인한다**

`out/requests.json`에서 `frames`·`image-url`·`no-tz`·`old-contract`·`bad-memory`가 400·`sent: 0`, `over-context`·`reflect-over-context`가 413·`sent: 0`, `truncated`·`http-500`·`shape`·`null-content`가 502, `fenced-answer`·`reflect-invalid-answer`가 200·`invalid`인지 본다. `p-frac.messages.json`의 시각 줄이 `2026-11-07T21:00:08.123000+09:00`인지 본다.

- [ ] **Step 5: 바이트 고정 줄을 넣는다**

`.gitattributes`에 한 줄을 더한다.

```
tests/fixtures/pam-golden/** -text
```

- [ ] **Step 6: 기존 Python 시험이 그대로 도는지 본다**

Run: `cd services/pam && "$SCRATCH/pamvenv/Scripts/python.exe" -m pytest -q`
Expected: 모두 통과(`make_golden.py`는 시험으로 모이지 않는다).

- [ ] **Step 7: 커밋·push**

```bash
git add .gitattributes services/pam/tests/make_golden.py tests/fixtures/pam-golden
git commit -m "test(pam): capture Python golden outputs before the Node port"
git push -u origin refactor/pam-in-node
```

---

### Task 2: 파일 옮기기 · 논문 프롬프트 읽기 · 해시 시험

**Files:**
- Create(복사, 바이트 그대로): `src/brain/pam/{PROVENANCE.md,THIRD_PARTY.md}`, `src/brain/pam/prompts/paper/*.txt`(7), `src/brain/pam/prompts/source_map.json`, `src/brain/pam/config/{paper.json,openrouter.json}`, `src/brain/pam/scenarios/noonchi/{scenario.json,tasks.json}`
- Create: `src/brain/pam/py.ts`, `src/brain/pam/pyjson.ts`, `src/brain/pam/paper.ts`, `src/brain/pam/scenario.ts`
- Modify: `.gitattributes`, `tests/pam-scenario.test.ts:7`, `tests/act-tasks.test.ts:18-19`, `src/act/tasks.ts:2`(주석 경로)
- Test: `tests/pam-prompts.test.ts`

`services/pam`은 Task 6까지 그대로 둔다(push마다 CI `pam` 일이 돌므로 Python이 계속 통과해야 한다).

**Interfaces:**
- Produces(`py.ts`): `isPyBlank(s: string): boolean`, `byCodePoint(a: string, b: string): number`, `pyRepr(s: string): string`, `pyList(xs: string[]): string`.
- Produces(`pyjson.ts`): `class PyFloat { value: number }`, `type PyJsonReason`, `class PyJsonFail extends Error { reason }`, `readPyJson(raw: string): unknown`, `unwrapFloats(v: unknown): unknown`.
- Produces(`paper.ts`): `PAM_DIR: string`, `PROMPT_IDS`, `type PromptId`, `PLACEHOLDER: RegExp`, `readStrictJson(path, o?: { keepFloats?: boolean }): unknown`, `loadPaperConfig(dir?): PaperConfig`, `loadPrompt(id: string, dir?): { text: string; source: Record<string, unknown> }`, `render(template, values): string`.
- Produces(`scenario.ts`): `interface Scenario`, `loadScenario(path): Scenario`, `loadScenarioTasks(s): string[]`, `adaptPrompt(template, s): { text: string; adaptation: Adaptation }`, `interface Adaptation { applied: {old,new,reason,occurrences}[]; adapted_template_sha256: string }`.

- [ ] **Step 1: 데이터 파일을 복사한다**

```bash
mkdir -p src/brain/pam/prompts/paper src/brain/pam/config src/brain/pam/scenarios/noonchi
cp services/pam/PROVENANCE.md services/pam/THIRD_PARTY.md src/brain/pam/
cp services/pam/prompts/paper/*.txt src/brain/pam/prompts/paper/
cp services/pam/prompts/source_map.json src/brain/pam/prompts/
cp services/pam/config/paper.json services/pam/config/openrouter.json src/brain/pam/config/
cp services/pam/scenarios/noonchi/scenario.json services/pam/scenarios/noonchi/tasks.json src/brain/pam/scenarios/noonchi/
```

`.gitattributes`에 더한다(Python 쪽 두 줄은 Task 6에서 지운다).

```
src/brain/pam/prompts/** -text
src/brain/pam/prompts/paper/*.txt text eol=lf
```

- [ ] **Step 2: 실패하는 시험을 쓴다**

`tests/pam-prompts.test.ts`:

```ts
// 옮긴 논문 프롬프트(src/brain/pam/prompts)가 source_map 해시와 같고, 논문 설정이 그대로이고, 노닌치 바꾸기가 맞는지 본다.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAM_DIR, PROMPT_IDS, loadPaperConfig, loadPrompt } from "../src/brain/pam/paper.js";
import { adaptPrompt, loadScenario } from "../src/brain/pam/scenario.js";

const map = JSON.parse(readFileSync(join(PAM_DIR, "prompts", "source_map.json"), "utf8")) as { prompts: Record<string, { file: string; sha256: string }> };
const SCENARIO = loadScenario(join(PAM_DIR, "scenarios", "noonchi", "scenario.json"));
const adapted = (id: string) => adaptPrompt(loadPrompt(id).text, SCENARIO);
const REFERENCE = "Treat the memory as a REFERENCE, not as a strict matcher.";
const STRICT = "Fire a memory rule only when EVERY condition in its trigger holds in the latest observations";

describe("논문 프롬프트", () => {
  it("프롬프트 파일 일곱 개의 sha256이 source_map.json과 같다(프롬프트를 바꾸면 source_map 해시도 같이 고친다)", () => {
    expect(Object.keys(map.prompts).sort()).toEqual([...PROMPT_IDS].sort());
    for (const [id, s] of Object.entries(map.prompts)) {
      expect(createHash("sha256").update(readFileSync(join(PAM_DIR, s.file))).digest("hex"), id).toBe(s.sha256);
    }
  });

  it("해시 검사로 읽는다. 한 바이트라도 다르면 읽기가 실패한다", () => {
    for (const id of PROMPT_IDS) expect(loadPrompt(id).source.id).toBe(id);
    const dir = mkdtempSync(join(tmpdir(), "pam-"));
    cpSync(join(PAM_DIR, "prompts"), join(dir, "prompts"), { recursive: true });
    const f = join(dir, map.prompts.predictor_fsm!.file);
    writeFileSync(f, readFileSync(f, "utf8") + " ");
    expect(() => loadPrompt("predictor_fsm", dir)).toThrow("Paper prompt hash mismatch: predictor_fsm");
    expect(() => loadPrompt("predictor_x")).toThrow("Unknown paper prompt: predictor_x");
  });

  it("프롬프트 파일은 LF만 쓰고, .gitattributes가 줄끝을 고정한다", () => {
    const files = readdirSync(join(PAM_DIR, "prompts", "paper"));
    expect(files).toHaveLength(7);
    for (const n of files) expect(readFileSync(join(PAM_DIR, "prompts", "paper", n)).includes(13), n).toBe(false);
    const lines = readFileSync(".gitattributes", "utf8").split(/\r?\n/);
    expect(lines).toContain("src/brain/pam/prompts/** -text");
    expect(lines).toContain("src/brain/pam/prompts/paper/*.txt text eol=lf");
  });

  it("논문 설정이 그대로다", () => {
    const c = loadPaperConfig();
    expect(c.model).toBe("Qwen3.5-27B");
    expect(c.predictor).toMatchObject({ temperature: 0.3, enable_thinking: false });
    expect(c.reflector).toMatchObject({ temperature: 0.3, enable_thinking: true });
  });

  it("논문 원문 판단 프롬프트에는 REFERENCE 문장이 있다. 노닌치 바꾸기만 그 문장을 STRICT로 바꾼다", () => {
    for (const id of ["predictor_fsm", "predictor_list"]) {
      expect(loadPrompt(id).text, id).toContain(REFERENCE);
      expect(loadPrompt(id).text, id).not.toContain(STRICT);
      const t = adapted(id).text;
      expect(t, id).not.toContain(REFERENCE);
      expect(t, id).not.toContain("you may fire it even when the trigger phrasing");
      expect(t, id).toContain(STRICT);
      expect(t, id).toContain("a rule whose trigger says the user left does not fire while the person is visible");
      expect(t, id).toContain("(짐작)");
    }
  });

  it("노닌치 판단 지시문: 보관 자리(싱크대·냉장고)와 가전 목표 줄", () => {
    const t = adapted("predictor_fsm").text;
    expect(t).toContain("- The designated storage area: the kitchen sink, where used cups, bottles and bowls are put. Drinks such as water and cola are kept in the fridge.");
    expect(t).not.toContain("corner of the desk");
    expect(t).toContain("- operating home appliances the person habitually operates by hand, such as turning on the living-room air conditioner when they sit down to watch TV.");
    expect(t).toContain("- etc. –- any helpful action that is grounded in observed behavior.");
  });

  it("노닌치 반성 지시문: 우리 행동 이름을 쓰고 손으로 다룬 가전도 다시 적는다", () => {
    const t = adapted("reflector_fsm_update").text;
    expect(t).not.toContain("Pick up <object>");
    expect(t).not.toContain("RE-STATE the pick-and-place actions");
    expect(t).toContain("appliance operations");
    expect(t).toContain("- action: exactly one of these task names, copied character for character: ");
    expect(t).toContain("Never add, move, rewrite or remove rules for them.");
  });

  it("새 바꾸기 다섯은 반성 지시문에서 한 번씩 맞고, 옛 바꾸기는 지금처럼 맞는다", () => {
    const { adaptation } = adapted("reflector_fsm_update");
    const applied = new Map(adaptation.applied.map((c) => [c.old, c.occurrences]));
    for (const c of SCENARIO.prompt_replacements.slice(0, 5)) expect(applied.get(c.old), c.reason).toBe(1);
    const before = adaptPrompt(loadPrompt("reflector_fsm_update").text, { ...SCENARIO, prompt_replacements: SCENARIO.prompt_replacements.slice(5) });
    for (const c of before.adaptation.applied) expect(applied.has(c.old), c.reason).toBe(true);
  });
});
```

`tests/pam-scenario.test.ts:7`과 `tests/act-tasks.test.ts:18-19`의 경로를 `src/brain/pam/scenarios/noonchi/…`로 바꾼다(제목의 `services/pam/…`도).

- [ ] **Step 3: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-prompts.test.ts`
Expected: FAIL(`src/brain/pam/paper.js`가 없다)

- [ ] **Step 4: `py.ts`를 쓴다**

```ts
// Python과 같은 글 다루기: repr(str), 문자열 목록 repr, str.strip()이 비우는 글, 코드 포인트 순 정렬(sorted).
// 검사 글을 Python PAM과 바이트까지 같게 두어 옮기기 전후 기록을 대조한다.
const PY_SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");

/** Python `not s.strip()`. */
export const isPyBlank = (s: string): boolean => PY_SPACE.test(s);

/** Python sorted()의 문자열 차례(코드 포인트). */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k]!.codePointAt(0)! - y[k]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** Python repr(str). */
export function pyRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    if (ch === "\\" || ch === q) out += `\\${ch}`;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch !== " " && NOT_PRINTABLE.test(ch)) {
      const c = ch.codePointAt(0)!;
      out += c <= 0xff ? `\\x${hex(c, 2)}` : c <= 0xffff ? `\\u${hex(c, 4)}` : `\\U${hex(c, 8)}`;
    } else out += ch;
  }
  return out + q;
}

/** Python repr(list[str]). */
export const pyList = (xs: string[]): string => `[${xs.map(pyRepr).join(", ")}]`;
```

- [ ] **Step 5: `pyjson.ts`를 쓴다**

```ts
// Python json.loads(raw, object_pairs_hook=중복 키 거절, parse_constant=상수 거절)와 같은 차례·같은 결과로 읽는다.
// - 중복 키는 객체가 닫힐 때 본다(안쪽 객체가 먼저). NaN·Infinity·-Infinity는 상수 오류, 그 밖 문법 오류는 syntax.
// - 소수점·지수가 있는 수는 PyFloat로 둔다: Python은 1.0을 float로 읽어 정수 칸(task_index) 검사에서 거절한다.
// - 숫자는 ASCII, 문자열 안 제어 문자는 거절(Python strict=True). __proto__도 보통 키로 둔다.
export class PyFloat {
  constructor(readonly value: number) {}
}
export type PyJsonReason = { kind: "syntax"; at: number } | { kind: "duplicate"; key: string } | { kind: "constant"; value: "NaN" | "Infinity" | "-Infinity" };
export class PyJsonFail extends Error {
  constructor(readonly reason: PyJsonReason) {
    super(reason.kind === "syntax" ? `JSON syntax error at char ${reason.at}` : reason.kind === "duplicate" ? `duplicate key: ${reason.key}` : `nonstandard constant: ${reason.value}`);
  }
}

const WS = /[ \t\n\r]*/y;
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const WORDS = [["null", null], ["true", true], ["false", false]] as const;
const CONSTANTS = ["NaN", "Infinity", "-Infinity"] as const;

export function readPyJson(raw: string): unknown {
  let i = 0;
  const skip = () => {
    WS.lastIndex = i;
    WS.exec(raw);
    i = WS.lastIndex;
  };
  const fail = (): never => {
    throw new PyJsonFail({ kind: "syntax", at: i });
  };
  const string = (): string => {
    STRING.lastIndex = i;
    const m = STRING.exec(raw) ?? fail();
    i = STRING.lastIndex;
    return JSON.parse(m[0]) as string;
  };
  const build = (pairs: [string, unknown][]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [k, v] of pairs) {
      if (seen.has(k)) throw new PyJsonFail({ kind: "duplicate", key: k });
      seen.add(k);
      Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  const object = (): Record<string, unknown> => {
    i++;
    const pairs: [string, unknown][] = [];
    skip();
    if (raw[i] === "}") {
      i++;
      return build(pairs);
    }
    for (;;) {
      skip();
      if (raw[i] !== '"') fail();
      const key = string();
      skip();
      if (raw[i] !== ":") fail();
      i++;
      pairs.push([key, value()]);
      skip();
      if (raw[i] === ",") { i++; continue; }
      if (raw[i] === "}") { i++; return build(pairs); }
      fail();
    }
  };
  const array = (): unknown[] => {
    i++;
    const out: unknown[] = [];
    skip();
    if (raw[i] === "]") { i++; return out; }
    for (;;) {
      out.push(value());
      skip();
      if (raw[i] === ",") { i++; continue; }
      if (raw[i] === "]") { i++; return out; }
      fail();
    }
  };
  const value = (): unknown => {
    skip();
    const c = raw[i];
    if (c === '"') return string();
    if (c === "{") return object();
    if (c === "[") return array();
    for (const [w, v] of WORDS) if (raw.startsWith(w, i)) { i += w.length; return v; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(raw);
    if (m) {
      i = NUMBER.lastIndex;
      const n = Number(m[0]);
      return m[1] || m[2] ? new PyFloat(n) : n === 0 ? 0 : n;
    }
    for (const w of CONSTANTS) if (raw.startsWith(w, i)) throw new PyJsonFail({ kind: "constant", value: w });
    return fail();
  };
  const v = value();
  skip();
  if (i !== raw.length) fail();
  return v;
}

/** PyFloat를 보통 수로 푼다(설정·해시표 읽기). */
export function unwrapFloats(v: unknown): unknown {
  if (v instanceof PyFloat) return v.value;
  if (Array.isArray(v)) return v.map(unwrapFloats);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrapFloats(x)]));
  return v;
}
```

- [ ] **Step 6: `paper.ts`를 쓴다(`pam/messages.py`의 `read_json`·`load_paper_config`·`load_prompt`·`_render`)**

```ts
// 논문 설정·프롬프트를 읽는다. 프롬프트는 source_map.json의 sha256과 같을 때만 읽는다(한 바이트라도 다르면 실패).
// 자리 끼워 넣기는 한 번만 훑어서, 끼워 넣은 기억 JSON 안의 중괄호는 그대로 둔다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { repoPath } from "../../shared/paths.js";
import { ContractError } from "../decision.js";
import { byCodePoint, pyList } from "./py.js";
import { PyFloat, PyJsonFail, readPyJson, unwrapFloats } from "./pyjson.js";

/** 이 폴더(프롬프트·설정·시나리오). 파일 자리(import.meta.url)는 src/shared/paths.ts만 쓴다(도메인 검사). */
export const PAM_DIR = repoPath("src/brain/pam/");
export const PROMPT_IDS = ["predictor_no_memory", "predictor_list", "predictor_fsm", "reflector_list_build", "reflector_list_update", "reflector_fsm_build", "reflector_fsm_update"] as const;
export type PromptId = (typeof PROMPT_IDS)[number];
export const PLACEHOLDER = /\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}/g;

export interface RoleConfig { temperature: number; enable_thinking: boolean }
export interface PaperConfig { model: string; predictor: RoleConfig; reflector: RoleConfig }

/** utf-8-sig로 읽고 중복 키·NaN 같은 상수를 거절한다. */
export function readStrictJson(path: string, o: { keepFloats?: boolean } = {}): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ContractError(`Cannot read JSON ${path}: ${(e as Error).message}`);
  }
  if (text.startsWith("\ufeff")) text = text.slice(1);
  try {
    const v = readPyJson(text);
    return o.keepFloats ? v : unwrapFloats(v);
  } catch (e) {
    if (!(e instanceof PyJsonFail)) throw e;
    const r = e.reason;
    const why = r.kind === "duplicate" ? `Duplicate JSON key: ${r.key}` : r.kind === "constant" ? `Invalid JSON constant: ${r.value}` : e.message;
    throw new ContractError(`Cannot read JSON ${path}: ${why}`);
  }
}

const EXPECTED: Record<"predictor" | "reflector", Record<string, number | boolean | ["float", number]>> = {
  predictor: { temperature: ["float", 0.3], enable_thinking: false, frame_count: 5, frame_stride_seconds: 2, interval_seconds: 1 },
  reflector: { temperature: ["float", 0.3], enable_thinking: true, frame_count: 200 },
};

/** 논문 설정(config/paper.json)이 논문 값 그대로인지 보고 읽는다. 값의 Python 타입(float·int·bool)까지 같아야 한다. */
export function loadPaperConfig(dir = PAM_DIR): PaperConfig {
  const c = readStrictJson(join(dir, "config", "paper.json"), { keepFloats: true }) as Record<string, unknown>;
  if (!c || typeof c !== "object" || c.model !== "Qwen3.5-27B") throw new ContractError("The paper profile must use Qwen3.5-27B.");
  for (const [role, want] of Object.entries(EXPECTED)) {
    const got = c[role] as Record<string, unknown> | undefined;
    if (!got || typeof got !== "object" || Array.isArray(got)) throw new ContractError(`Paper settings for ${role} must be an object.`);
    for (const [k, w] of Object.entries(want)) {
      const a = got[k];
      const same = Array.isArray(w) ? a instanceof PyFloat && a.value === w[1] : typeof w === "number" ? typeof a === "number" && a === w : a === w;
      if (!same) throw new ContractError(`Paper setting differs: ${role}.${k}`);
    }
  }
  return unwrapFloats(c) as PaperConfig;
}

export function loadPrompt(id: string, dir = PAM_DIR): { text: string; source: Record<string, unknown> } {
  if (!(PROMPT_IDS as readonly string[]).includes(id)) throw new ContractError(`Unknown paper prompt: ${id}`);
  const map = readStrictJson(join(dir, "prompts", "source_map.json")) as { prompts: Record<string, { file: string; sha256: string }> };
  const src = map.prompts[id]!;
  const path = resolve(dir, src.file);
  const rel = relative(resolve(dir, "prompts", "paper"), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ContractError("A paper prompt must be under prompts/paper.");
  const raw = readFileSync(path);
  if (createHash("sha256").update(raw).digest("hex") !== src.sha256) throw new ContractError(`Paper prompt hash mismatch: ${id}`);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(raw), source: { id, ...src } };
}

/** 자리를 한 번만 훑어 바꾼다. 템플릿이 쓰는 자리와 준 값의 이름이 같아야 한다. */
export function render(template: string, values: Record<string, string>): string {
  const needed = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!));
  const given = Object.keys(values);
  if (needed.size !== given.length || given.some((k) => !needed.has(k))) {
    throw new ContractError(`Prompt substitution mismatch: expected ${pyList([...needed].sort(byCodePoint))}`);
  }
  return template.replace(PLACEHOLDER, (_m, name: string) => values[name]!);
}
```

- [ ] **Step 7: `scenario.ts`를 쓴다(`pam/scenarios.py`)**

```ts
// 시나리오(scenarios/noonchi/scenario.json)의 글자 바꾸기를 논문 프롬프트에 적용한다. 논문 파일은 바꾸지 않는다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ContractError, validateTasks } from "../decision.js";
import { isPyBlank } from "./py.js";
import { readStrictJson } from "./paper.js";

export interface Replacement { old: string; new: string; reason: string }
export interface Scenario {
  id: string; tasks_file: string; memory_files: Record<string, string>; prompt_replacements: Replacement[];
  action_labels_ko?: string[]; configPath: string; configSha256: string;
}
export interface Adaptation { applied: (Replacement & { occurrences: number })[]; adapted_template_sha256: string }

const nonblank = (v: unknown): v is string => typeof v === "string" && !isPyBlank(v);

export function loadScenario(path: string): Scenario {
  const full = resolve(path);
  const v = readStrictJson(full) as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContractError("Scenario configuration must be an object.");
  for (const k of ["id", "tasks_file"]) if (!nonblank(v[k])) throw new ContractError(`Scenario requires ${k}.`);
  if (!v.memory_files || typeof v.memory_files !== "object" || Array.isArray(v.memory_files)) throw new ContractError("Scenario requires memory_files.");
  const changes = v.prompt_replacements;
  if (!Array.isArray(changes) || !changes.length) throw new ContractError("Scenario requires documented prompt substitutions.");
  for (const c of changes) {
    if (!c || typeof c !== "object" || !["old", "new", "reason"].every((k) => nonblank((c as Record<string, unknown>)[k]))) {
      throw new ContractError("Each scenario change needs old, new, and reason strings.");
    }
  }
  return { ...(v as unknown as Scenario), configPath: full, configSha256: createHash("sha256").update(readFileSync(full)).digest("hex") };
}

function scenarioFile(s: Scenario, name: "tasks_file"): string {
  const root = dirname(s.configPath);
  const path = resolve(root, s[name]);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ContractError("Scenario data files must remain within the scenario directory.");
  return path;
}

export function loadScenarioTasks(s: Scenario): string[] {
  const tasks = validateTasks(readStrictJson(scenarioFile(s, "tasks_file")));
  const labels = s.action_labels_ko;
  if (labels !== undefined && (!Array.isArray(labels) || labels.length !== tasks.length || labels.some((l) => !nonblank(l)))) {
    throw new ContractError("Korean action labels must correspond one-to-one with the task list.");
  }
  return tasks;
}

/** 바꾸기를 차례로 적용하고 몇 번 맞았는지 남긴다. 하나도 안 맞으면 실패. 바꿀 글의 `$`는 그대로 둔다(함수로 바꾼다). */
export function adaptPrompt(template: string, s: Pick<Scenario, "prompt_replacements">): { text: string; adaptation: Adaptation } {
  let text = template;
  const applied: Adaptation["applied"] = [];
  for (const c of s.prompt_replacements) {
    const occurrences = text.split(c.old).length - 1;
    if (occurrences) {
      text = text.replaceAll(c.old, () => c.new);
      applied.push({ old: c.old, new: c.new, reason: c.reason, occurrences });
    }
  }
  if (!applied.length) throw new ContractError("No scenario substitutions matched this paper prompt.");
  return { text, adaptation: { applied, adapted_template_sha256: createHash("sha256").update(text, "utf8").digest("hex") } };
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-prompts.test.ts tests/pam-scenario.test.ts tests/act-tasks.test.ts tests/domain-boundaries.test.ts`
Expected: PASS(`import.meta.url`은 `src/shared/paths.ts`만 쓴다)

- [ ] **Step 9: 커밋·push**

```bash
git add .gitattributes src/brain/pam tests/pam-prompts.test.ts tests/pam-scenario.test.ts tests/act-tasks.test.ts src/act/tasks.ts
git commit -m "feat(pam): copy paper prompts into src/brain/pam and load them with hash checks"
git push
```

---

### Task 3: 요청 모양 · 메시지 · 답 검사 · 문맥 길이

**Files:**
- Create: `src/brain/pam/errors.ts`, `src/brain/pam/request.ts`, `src/brain/pam/prompt.ts`, `src/brain/pam/answer.ts`, `src/brain/pam/budget.ts`
- Modify: `src/brain/decision.ts`(검사 글 Python 꼴, `isPyBlank`, `parsePrediction`·`findDuplicateKey` 빼기), `tests/brain-decision.test.ts`(판단 답 시험을 `pam-answer`로 옮김)
- Test: `tests/pam-request.test.ts`, `tests/pam-answer.test.ts`, `tests/pam-budget.test.ts`, `tests/pam-golden.test.ts`(메시지·토큰·바꾸기·답 검사·기억 검사·입력 한도)

**Interfaces:**
- Consumes: Task 2 `render`, `loadPrompt`, `loadPaperConfig`, `adaptPrompt`, `loadScenario`, `loadScenarioTasks`, `PAM_DIR`, `PLACEHOLDER`, `readPyJson`, `PyJsonFail`, `pyRepr`, `pyList`, `byCodePoint`, `isPyBlank`.
- Produces(`errors.ts`): `PamRequestError`, `PamBudgetError`, `PamAnswerError`(모두 `extends ContractError`), `PamLinkError extends Error`.
- Produces(`request.ts`): `type PredictRequest = { contract: "pam-predict/2"; final_time: string; observation_text: string; memory_kind: "list"|"fsm"; memory: Record<string, unknown>; tasks: string[] }`, `type ReflectRequest = { contract: "pam-reflect/2"; day: string; memory_kind; memory; observation_text: string; action_summary: string; feedback: string | null }`, `predictRequest(body: unknown): PredictRequest`, `reflectRequest(body: unknown): ReflectRequest`, `pyIsoformat(s: string): string | null`.
- Produces(`prompt.ts`): `type PamMessage = { role: "system"; content: string } | { role: "user"; content: { type: "text"; text: string }[] }`, `interface Generation { temperature: number; enable_thinking: boolean }`, `adaptedTemplate(id: PromptId): string`, `adaptation(id: PromptId): Adaptation`, `buildPredictMessages(r: PredictRequest): { messages: PamMessage[]; generation: Generation }`, `buildReflectMessages(r: ReflectRequest): 같은 모양`, 상수 `PREDICT_TIME`, `PREDICT_LOG`, `REFLECT_LOG`, `REFLECT_MEMORY`, `REFLECT_SUMMARY`, `REFLECT_FEEDBACK`.
- Produces(`answer.ts`): `interface ParsedPrediction`, `parsePrediction(raw, tasks): ParsedPrediction`, `type ParsedMemory = { ok: true; memory: PamMemory } | { ok: false; error: string }`, `parseMemory(raw, kind): ParsedMemory`.
- Produces(`budget.ts`): `PER_MESSAGE = 8`, `RESERVE = 256`, `estimateTokens(ms: PamMessage[]): number`, `checkBudget(ms, maxTokens, maxModelLen): void`, `interface PamLimits { max_model_len; predict_input_bytes; reflect_input_bytes }`, `pamLimits(s: { maxModelLen: number; maxTokens: { predictor: number; reflector: number } }): PamLimits`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/pam-golden.test.ts`(이 묶음에서는 메시지·토큰·바꾸기·답 검사·기억 검사·입력 한도. 전송 본문·설정·요청 결과는 Task 4에서 더한다):

```ts
// 옮기기 전 Python PAM이 만든 정답(tests/fixtures/pam-golden/out)과 TS 결과를 비교한다.
// 메시지는 바이트까지 같다(toMatchFileSnapshot). 프롬프트를 일부러 바꿨으면 `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 쓰고 차이를 본다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adaptation, buildPredictMessages, buildReflectMessages, estimateTokens, pamLimits, parseMemory, parsePrediction, predictRequest, reflectRequest } from "../src/brain/pam/index.js";

const DIR = new URL("./fixtures/pam-golden/", import.meta.url);
const inputs = JSON.parse(readFileSync(new URL("inputs.json", DIR), "utf8"));
const out = (name: string) => JSON.parse(readFileSync(new URL(`out/${name}`, DIR), "utf8"));
const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const JSON_ERR = /^JSON syntax error at char \d+$/;
const norm = (e: string) => (JSON_ERR.test(e) ? "<json>" : e);
const MAX = { maxModelLen: 32768, maxTokens: { predictor: 2048, reflector: 16384 } };

async function sameFile(name: string, text: string) {
  expect(existsSync(new URL(`out/${name}`, DIR)), `정답 파일 ${name}`).toBe(true);
  await expect(text).toMatchFileSnapshot(`./fixtures/pam-golden/out/${name}`);
}

describe("Python과 같은 결과", () => {
  it("판단 메시지·토큰 추정", async () => {
    for (const c of inputs.predict) {
      const built = buildPredictMessages(predictRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      expect(estimateTokens(built.messages), c.id).toBe(out("tokens.json")[c.id]);
    }
  });

  it("반성 메시지·토큰 추정", async () => {
    for (const c of inputs.reflect) {
      const built = buildReflectMessages(reflectRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      expect(estimateTokens(built.messages), c.id).toBe(out("tokens.json")[c.id]);
    }
  });

  it("노닌치 바꾸기 적용 결과", () => {
    const want = out("adaptation.json") as Record<string, unknown>;
    for (const id of Object.keys(want)) expect(adaptation(id as never), id).toEqual(want[id]);
  });

  it("판단 답 검사(parse_prediction)", () => {
    const got = inputs.parse.map((c: { id: string; raw: string; tasks: string[] }) => {
      const r = parsePrediction(c.raw, c.tasks);
      return { id: c.id, result: { ...r, errors: r.errors.map(norm) } };
    });
    expect(got).toEqual(out("parse.json"));
  });

  it("반성 답 검사(parse_memory)", () => {
    const got = inputs.memory.map((c: { id: string; raw: string; kind: "list" | "fsm" }) => {
      const r = parseMemory(c.raw, c.kind);
      return r.ok ? { id: c.id, ok: true, memory: r.memory } : { id: c.id, ok: false, error: norm(r.error) };
    });
    expect(got).toEqual(out("memory.json"));
  });

  it("입력 한도(limits)", () => {
    const len = (env: Record<string, string>) => Number(env.PAM_MAX_MODEL_LEN?.trim() || 32768);
    const got = inputs.limits.map((env: Record<string, string>) => ({ env, limits: pamLimits({ ...MAX, maxModelLen: len(env) }) }));
    expect(got).toEqual(out("limits.json"));
  });
});
```

`tests/pam-request.test.ts`(`test_v2.py`):

```ts
// pam-predict/2·pam-reflect/2 요청 모양: 사진 칸이 없고, 논문 판단 규칙 문장은 그대로 두고 사진 자리에 관찰 텍스트를 넣는다.
import { describe, expect, it } from "vitest";
import { PamRequestError, buildPredictMessages, buildReflectMessages, predictRequest, pyIsoformat, reflectRequest } from "../src/brain/pam/index.js";

const MEMORY = { initial_state: "drinking", states: [
  { id: "drinking", description: "마시는 중", rules: [], next: [{ to: "left_cup", on: "컵을 두고 떠남" }] },
  { id: "left_cup", description: "컵을 두고 자리를 비움", rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }], next: [] }] };
const LIST = { rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }] };
const P = { contract: "pam-predict/2", final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "21:00:00 사람 보임\n21:00:04 사람 안 보임",
  memory_kind: "fsm", memory: MEMORY, tasks: ["컵 치우기", "사용자에게 물어보기"] };
const R = { contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: MEMORY, observation_text: "07:58:02 사람 보임",
  action_summary: "08:10:40 컵 치우기 부탁", feedback: "다 마신 뒤에만 치워 줘" };
const texts = (b: ReturnType<typeof buildReflectMessages>) => (b.messages[1]!.content as { text: string }[]).map((p) => p.text).join("\n");

describe("요청 모양", () => {
  it("사진 칸·시간대 없는 시각·옛 계약 이름은 PamRequestError", () => {
    for (const bad of [{ ...P, frames: [{ image: { base64: "AAAA" } }] }, { ...P, image: "data:image/jpeg;base64,AAAA" },
      { ...P, final_time: "2026-11-07T21:00:08" }, { ...P, contract: "pam-predict/1" }]) {
      expect(() => predictRequest(bad)).toThrow(PamRequestError);
    }
  });

  it("반성 글 크기 상한(코드 포인트)과 모르는 칸", () => {
    for (const [k, n] of [["observation_text", 100_001], ["action_summary", 50_001], ["feedback", 8_001]] as const) {
      expect(() => reflectRequest({ ...R, [k]: "가".repeat(n) }), k).toThrow(PamRequestError);
    }
    expect(() => reflectRequest({ ...R, photos: [] })).toThrow(PamRequestError);
    expect(predictRequest({ ...P, observation_text: "가".repeat(19_999) + "🍜" }).observation_text).toHaveLength(20_001);
  });

  it("시각은 Python isoformat 꼴로 바꾼다", () => {
    expect(pyIsoformat("2026-11-07T21:00:08.000+09:00")).toBe("2026-11-07T21:00:08+09:00");
    expect(pyIsoformat("2026-11-07T21:00:08.5+09:00")).toBe("2026-11-07T21:00:08.500000+09:00");
    expect(pyIsoformat("2026-11-07T21:00:08.1234567+09:00")).toBe("2026-11-07T21:00:08.123456+09:00");
    expect(pyIsoformat("2026-11-07T12:00:08Z")).toBe("2026-11-07T12:00:08+00:00");
    expect(pyIsoformat("2026-11-07T12:00:08-00:00")).toBe("2026-11-07T12:00:08+00:00");
    expect(pyIsoformat("2026-11-07T21:00+09:00")).toBe("2026-11-07T21:00:00+09:00");
    for (const bad of ["2026-11-07T21:00:08", "2026-11-07T24:00:00+09:00", "2026-11-07T21:00:60+09:00", "2026-02-30T21:00:00+09:00", "2026-11-07T21:00:08+24:00"]) {
      expect(pyIsoformat(bad), bad).toBeNull();
    }
  });
});

describe("메시지", () => {
  it("판단: 판단 규칙 문장은 그대로, 사진 자리에 관찰 텍스트", () => {
    const built = buildPredictMessages(predictRequest(P));
    const system = built.messages[0]!.content as string;
    const user = built.messages[1]!.content as { type: string; text: string }[];
    expect(system).toContain("If the person is holding or touching an object, the robot cannot perform any");
    expect(system).toContain("action on that object until the person sets it down on the desk.");
    expect(system).not.toContain("camera frames");
    expect(system).not.toContain("back-facing cameras");
    expect(system).toContain("a home with a dining table");
    expect(system).not.toContain("personal desk");
    expect(system).toContain("0: 컵 치우기\n1: 사용자에게 물어보기");
    expect(system).toContain(JSON.stringify(MEMORY, null, 2));
    expect(system).not.toMatch(/\{(window|fsm_block)\}/);
    expect(user.every((p) => p.type === "text")).toBe(true);
    expect(user[0]!.text).toBe("Wall-clock time of the final observation: 2026-11-07T21:00:08+09:00");
    expect(user[1]!.text).toContain("21:00:04 사람 안 보임");
    expect(built.generation).toEqual({ temperature: 0.3, enable_thinking: false });
  });

  it("list 기억은 list 프롬프트를 쓴다", () => {
    const system = buildPredictMessages(predictRequest({ ...P, memory_kind: "list", memory: LIST })).messages[0]!.content as string;
    expect(system).toContain("flat list of production rules");
    expect(system).toContain(JSON.stringify(LIST, null, 2));
    expect(buildReflectMessages(reflectRequest({ ...R, memory_kind: "list", memory: LIST })).messages[0]!.content).not.toContain("Today's video");
  });

  it("반성: 하루 관찰·요약·피드백, 피드백이 없거나 비면 넣지 않는다", () => {
    const built = buildReflectMessages(reflectRequest(R));
    expect(built.messages[0]!.content).not.toContain("Today's video");
    expect(texts(built)).toContain("07:58:02 사람 보임");
    expect(texts(built)).toContain("Summary:\n08:10:40 컵 치우기 부탁");
    expect(texts(built)).toContain("Human feedback:\n다 마신 뒤에만 치워 줘");
    expect(built.generation).toEqual({ temperature: 0.3, enable_thinking: true });
    for (const feedback of [null, ""]) expect(texts(buildReflectMessages(reflectRequest({ ...R, feedback })))).not.toContain("Human feedback");
  });
});
```

`tests/pam-answer.test.ts`(`test_contracts.py`·`test_v2.py` `parse_memory`, 지금 `brain-decision.test.ts`의 판단 답 시험을 옮겨 온다):

```ts
// 답 검사: 완전한 JSON 객체만 받고, 고치지 않고, invalid는 대기(-1)와 구분한다. 검사 글은 Python PAM과 같다.
import { describe, expect, it } from "vitest";
import { validateMemory, validatePrediction, validateTasks } from "../src/brain/decision.js";
import { parseMemory, parsePrediction } from "../src/brain/pam/index.js";

const T = ["컵 치우기", "사용자에게 물어보기"];
const MEMORY = { initial_state: "active", states: [
  { id: "active", description: "A person is using a workspace.", rules: [{ trigger: "A spare tool is needed.", action: "Offer the spare tool." }], next: [{ to: "done", on: "The person leaves the workspace." }] },
  { id: "done", description: "The workspace is empty.", rules: [], next: [] }] };

describe("행동 목록·기억", () => {
  it("행동 목록은 비지 않은 배열이고 글은 Python strip() 기준으로 비지 않는다", () => {
    expect(validateTasks(T)).toEqual(T);
    for (const bad of [[], [""], [" "], ["\u3000"], ["\x1f"], [1], "a"]) expect(() => validateTasks(bad)).toThrow();
    expect(validateTasks(["\ufeff"])).toEqual(["\ufeff"]);
  });

  it("기억: 빈 규칙·끝 상태를 받고, 받은 것을 바꾸지 않는다", () => {
    const copy = structuredClone(MEMORY);
    expect(validateMemory(copy, "fsm")).toEqual(MEMORY);
    expect(copy).toEqual(MEMORY);
  });

  it("기억: 상태 id 중복·모르는 상태·모양 틀림은 Python과 같은 글로 실패", () => {
    const dup = { ...MEMORY, states: [MEMORY.states[0]!, { ...MEMORY.states[1]!, id: "active" }] };
    expect(() => validateMemory(dup, "fsm")).toThrow("memory.states[1].id: duplicate state identifier 'active'");
    const unknown = { ...MEMORY, states: [{ ...MEMORY.states[0]!, next: [{ to: "nowhere", on: "x" }] }, MEMORY.states[1]!] };
    expect(() => validateMemory(unknown, "fsm")).toThrow("memory.states[0].next[0].to: unknown state identifier 'nowhere'");
    expect(() => validateMemory({ ...MEMORY, label: "x" }, "fsm")).toThrow(`memory: incorrect fields (missing=[], extra=["'label'"])`);
    expect(() => validateMemory({ rules: [] }, "fsm")).toThrow("memory: incorrect fields (missing=['initial_state', 'states'], extra=[\"'rules'\"])");
  });
});

describe("판단 답", () => {
  it("행동 번호를 행동 이름으로, 원문은 그대로 남긴다", () => {
    const raw = '{"observation":"o","reasoning":"r","task_index":1}';
    expect(parsePrediction(raw, T)).toEqual({ status: "valid", raw_response: raw, prediction: { observation: "o", reasoning: "r", task_index: 1 }, selected_action: "사용자에게 물어보기", errors: [] });
  });

  it("대기(-1)는 invalid가 아니다", () => {
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":-1}', T)).toMatchObject({ status: "valid", selected_action: null });
  });

  it("틀린 행동 번호는 대기가 되지 않는다(1.0·1e0·true·범위 밖)", () => {
    for (const i of ["2", "-2", "1.0", "1e0", "true", '"0"']) {
      const r = parsePrediction(`{"observation":"o","reasoning":"r","task_index":${i}}`, T);
      expect(r, i).toMatchObject({ status: "invalid", prediction: null, selected_action: null });
    }
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: 2 }, T)).toThrow("prediction.task_index: expected an integer from -1 to 1");
  });

  it("엄격한 JSON: 중복 키(안쪽 먼저)·상수·고치기 없음", () => {
    expect(parsePrediction('{"observation":"o","observation":{"x":1,"x":2},"reasoning":"r","task_index":0}', T).errors).toEqual(["response JSON: duplicate key 'x'"]);
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":NaN}', T).errors).toEqual(["response JSON: nonstandard numeric constant 'NaN'"]);
    for (const raw of ["```json\n{}\n```", '답: {"observation":"o","reasoning":"r","task_index":0}', "", "[]"]) expect(parsePrediction(raw, T).status, raw).toBe("invalid");
  });

  it("칸이 정확히 셋이고 글이 비지 않는다", () => {
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":0,"x":1}', T).errors).toEqual([`prediction: incorrect fields (missing=[], extra=["'x'"])`]);
    expect(parsePrediction('{"observation":" ","reasoning":"r","task_index":0}', T).errors).toEqual(["prediction.observation: expected a nonempty string"]);
  });
});

describe("반성 답", () => {
  it("완전한 JSON 기억만 받는다", () => {
    expect(parseMemory(JSON.stringify(MEMORY), "fsm")).toEqual({ ok: true, memory: MEMORY });
    expect(parseMemory('{"rules": [], "rules": []}', "list")).toEqual({ ok: false, error: "duplicate key: rules" });
    expect(parseMemory('{"rules": [{"trigger": "a", "action": NaN}]}', "list")).toEqual({ ok: false, error: "nonstandard constant: NaN" });
    for (const raw of ["```json\n{}\n```", "[]"]) expect(parseMemory(raw, "list").ok, raw).toBe(false);
  });
});
```

`tests/pam-budget.test.ts`(`test_budget.py`):

```ts
// 문맥 길이 검사: limits()가 알리는 반성 입력 한도 안의 요청은 통과하고, 넘으면 거절한다.
import { describe, expect, it } from "vitest";
import { PamBudgetError, buildReflectMessages, checkBudget, pamLimits, reflectRequest } from "../src/brain/pam/index.js";

const MEMORY = { initial_state: "drinking", states: [
  { id: "drinking", description: "마시는 중", rules: [], next: [{ to: "left_cup", on: "컵을 두고 떠남" }] },
  { id: "left_cup", description: "컵을 두고 자리를 비움", rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }], next: [] }] };
const S = { maxModelLen: 32768, maxTokens: { predictor: 2048, reflector: 16384 } };
const reflect = (obs: string, actions: string) => buildReflectMessages(reflectRequest({ contract: "pam-reflect/2", day: "2026-11-07",
  memory_kind: "fsm", memory: MEMORY, observation_text: obs, action_summary: actions, feedback: null })).messages;

describe("문맥 길이", () => {
  it("알린 한도 안의 글은 max_tokens와 함께 들어간다", () => {
    const room = pamLimits(S).reflect_input_bytes - Buffer.byteLength(JSON.stringify(MEMORY, null, 2));
    const obs = ("가".repeat(30) + "\n").repeat(Math.floor((room * 0.7) / 91));
    const actions = ("나".repeat(30) + "\n").repeat(Math.floor((room * 0.3) / 91));
    expect(() => checkBudget(reflect(obs, actions), S.maxTokens.reflector, S.maxModelLen)).not.toThrow();
  });

  it("넘으면 PamBudgetError", () => {
    expect(() => checkBudget(reflect("가".repeat(40_000), "나"), S.maxTokens.reflector, S.maxModelLen)).toThrow(PamBudgetError);
  });

  it("한도는 문맥 길이를 따른다", () => {
    const small = pamLimits({ ...S, maxModelLen: 20_000 });
    const big = pamLimits(S);
    expect(small.max_model_len).toBe(20_000);
    expect(small.reflect_input_bytes).toBeGreaterThan(0);
    expect(small.reflect_input_bytes).toBeLessThan(big.reflect_input_bytes);
  });
});
```

`tests/brain-decision.test.ts`: `parsePrediction`·`findDuplicateKey` 시험 블록(`:51-61`)을 지우고 import에서 뺀다. `toThrow(/incorrect fields/)`는 그대로 통과한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts tests/pam-request.test.ts tests/pam-answer.test.ts tests/pam-budget.test.ts`
Expected: FAIL(`src/brain/pam/index.js`가 없다)

- [ ] **Step 3: `decision.ts`의 검사 글을 Python 꼴로 바꾼다**

```ts
import { byCodePoint, isPyBlank, pyList, pyRepr } from "./pam/py.js";

function object(value: Json, fields: string[], path: string): Record<string, Json> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) {
    throw new ContractError(`${path}: expected an object`);
  }
  const actual = Object.keys(value);
  const missing = fields.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !fields.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, Json>;
}

function text(value: Json, path: string): string {
  if (typeof value !== "string" || isPyBlank(value)) throw new ContractError(`${path}: expected a nonempty string`);
  return value;
}
```

`validateMemory`의 두 글을 `duplicate state identifier ${pyRepr(id)}`, `unknown state identifier ${pyRepr(to)}`로 바꾼다. `findDuplicateKey`·`ParsedPrediction`·`parsePrediction`을 지운다. 머리 주석의 `services/pam/pam/contracts.py`를 `src/brain/pam/answer.ts`로 바꾼다.

- [ ] **Step 4: `errors.ts`를 쓴다**

```ts
// PAM 오류 갈래(예전 HTTP 상태 대신). 앞 셋은 ContractError라 판단 실패로, PamLinkError는 PAM 연결 끊김으로 기록된다.
import { ContractError } from "../decision.js";

/** 요청이 pam-predict/2·pam-reflect/2 모양에 안 맞음·사진 칸(예전 400). LLM에 보내지 않는다. */
export class PamRequestError extends ContractError {}
/** 입력 추정 토큰 + 출력 상한이 문맥 길이를 넘음(예전 413). LLM에 보내지 않는다. */
export class PamBudgetError extends ContractError {}
/** LLM 답이 계약에 안 맞음(예전 200 invalid). 대기(-1)와 다르다. */
export class PamAnswerError extends ContractError {}
/** LLM에 닿지 않음·HTTP 오류·잘린 답·chat completions 모양 아님(예전 502). */
export class PamLinkError extends Error {}
```

- [ ] **Step 5: `request.ts`를 쓴다(`noonchi_pam/contracts.py`)**

```ts
// pam-predict/2·pam-reflect/2 요청 모양(zod). 모르는 칸(사진 칸 포함)은 거절한다. 글 길이는 Python처럼 코드 포인트로 센다.
// 시각은 Python datetime.isoformat() 꼴로 바꿔 둔다: 메시지의 시각 줄이 Python과 같아야 한다.
import { z } from "zod";
import { ContractError, validateMemory, validateTasks } from "../decision.js";
import { PamRequestError } from "./errors.js";

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6})\d*)?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const realDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(2000, m - 1, d));
  return y >= 1 && m >= 1 && m <= 12 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && (m !== 2 || d !== 29 || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)));
};

/** 시간대 있는 ISO 시각 → Python isoformat 꼴. 아니면 null. */
export function pyIsoformat(s: string): string | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = "00", frac = "", z, sign, oh, om] = m;
  if (!realDay(+y!, +mo!, +d!) || +h! > 23 || +mi! > 59 || +sec > 59) return null;
  if (!z && (+oh! > 23 || +om! > 59)) return null;
  const off = z || (+oh! === 0 && +om! === 0) ? "+00:00" : `${sign}${oh}:${om}`;
  const micro = frac.padEnd(6, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}${micro === "000000" ? "" : `.${micro}`}${off}`;
}

const cp = (s: string) => [...s].length;
const text = (min: number, max: number) => z.string().refine((s) => cp(s) >= min && cp(s) <= max, { message: `${min}~${max}자여야 합니다` });
const kind = z.enum(["list", "fsm"]);
const memory = z.record(z.string(), z.unknown());

const PredictSchema = z.strictObject({
  contract: z.literal("pam-predict/2"),
  final_time: z.string().transform((s, ctx) => pyIsoformat(s) ?? (ctx.addIssue({ code: "custom", message: "시간대가 있는 ISO 시각이어야 합니다" }), z.NEVER)),
  observation_text: text(1, 20_000),
  memory_kind: kind,
  memory,
  tasks: z.array(z.string()).min(1),
});
const ReflectSchema = z.strictObject({
  contract: z.literal("pam-reflect/2"),
  day: z.string().refine((s) => { const m = DAY.exec(s); return !!m && realDay(+m[1]!, +m[2]!, +m[3]!); }, { message: "YYYY-MM-DD여야 합니다" }),
  memory_kind: kind,
  memory,
  observation_text: text(1, 100_000),
  action_summary: text(1, 50_000),
  feedback: text(0, 8_000).nullable().default(null),
});
export type PredictRequest = z.infer<typeof PredictSchema>;
export type ReflectRequest = z.infer<typeof ReflectSchema>;

function parse<T>(schema: z.ZodType<T>, body: unknown, check: (r: T) => void): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new PamRequestError(`PAM 요청이 계약에 맞지 않음: ${z.prettifyError(r.error)}`);
  try {
    check(r.data);
  } catch (e) {
    if (e instanceof ContractError) throw new PamRequestError(`PAM 요청이 계약에 맞지 않음: ${e.message}`);
    throw e;
  }
  return r.data;
}

/** 판단 요청: 모양 → 행동 목록 → 기억(Python build_predict_messages와 같은 차례). */
export const predictRequest = (body: unknown): PredictRequest =>
  parse(PredictSchema, body, (r) => { validateTasks(r.tasks); validateMemory(r.memory, r.memory_kind); });
/** 반성 요청: 모양 → 기억. */
export const reflectRequest = (body: unknown): ReflectRequest =>
  parse(ReflectSchema, body, (r) => { validateMemory(r.memory, r.memory_kind); });
```

- [ ] **Step 6: `prompt.ts`를 쓴다(`noonchi_pam/prompt.py`)**

```ts
// 논문 프롬프트로 판단·반성 메시지를 만든다. 판단 규칙은 그대로 두고 사진이 들어가던 자리에 관찰 텍스트를 넣는다.
import { join } from "node:path";
import { loadPaperConfig, loadPrompt, PAM_DIR, PLACEHOLDER, render, type PromptId } from "./paper.js";
import type { PredictRequest, ReflectRequest } from "./request.js";
import { adaptPrompt, loadScenario, loadScenarioTasks, type Adaptation } from "./scenario.js";

export type PamMessage = { role: "system"; content: string } | { role: "user"; content: { type: "text"; text: string }[] };
export interface Generation { temperature: number; enable_thinking: boolean }
export interface Built { messages: PamMessage[]; generation: Generation }

export const PREDICT_TIME = "Wall-clock time of the final observation: ";
export const PREDICT_LOG = "Observation log (oldest to newest):\n";
export const REFLECT_LOG = "Today's observations, provided as a chronological time-stamped log:\n";
export const REFLECT_MEMORY = "Current memory:\n";
export const REFLECT_SUMMARY = "\n\nSummary:\n";
export const REFLECT_FEEDBACK = "\n\nHuman feedback:\n";

const SCENARIO = loadScenario(join(PAM_DIR, "scenarios", "noonchi", "scenario.json"));
loadScenarioTasks(SCENARIO);
const adapted = new Map<PromptId, { text: string; adaptation: Adaptation }>();
const adapt = (id: PromptId) => adapted.get(id) ?? adapted.set(id, adaptPrompt(loadPrompt(id).text, SCENARIO)).get(id)!;

/** 노닌치 바꾸기를 적용한 프롬프트(가짜 LLM 서버가 요청을 되읽을 때도 쓴다). */
export const adaptedTemplate = (id: PromptId): string => adapt(id).text;
export const adaptation = (id: PromptId): Adaptation => adapt(id).adaptation;
const generation = (role: "predictor" | "reflector"): Generation => {
  const c = loadPaperConfig()[role];
  return { temperature: c.temperature, enable_thinking: c.enable_thinking };
};
const memoryJson = (m: unknown) => JSON.stringify(m, null, 2);

export function buildPredictMessages(r: PredictRequest): Built {
  const template = adaptedTemplate(`predictor_${r.memory_kind}`);
  const values: Record<string, string> = {
    n_tasks_minus_one: String(r.tasks.length - 1),
    tasks_block: r.tasks.map((t, i) => `${i}: ${t}`).join("\n"),
    [r.memory_kind === "list" ? "rules_block" : "fsm_block"]: memoryJson(r.memory),
  };
  const needed = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!));
  return {
    messages: [
      { role: "system", content: render(template, Object.fromEntries(Object.entries(values).filter(([k]) => needed.has(k)))) },
      { role: "user", content: [{ type: "text", text: PREDICT_TIME + r.final_time }, { type: "text", text: PREDICT_LOG + r.observation_text }] },
    ],
    generation: generation("predictor"),
  };
}

export function buildReflectMessages(r: ReflectRequest): Built {
  let text = REFLECT_MEMORY + memoryJson(r.memory) + REFLECT_SUMMARY + r.action_summary;
  if (r.feedback) text += REFLECT_FEEDBACK + r.feedback;
  return {
    messages: [
      { role: "system", content: adaptedTemplate(`reflector_${r.memory_kind}_update`) },
      { role: "user", content: [{ type: "text", text: REFLECT_LOG + r.observation_text }, { type: "text", text }] },
    ],
    generation: generation("reflector"),
  };
}
```

- [ ] **Step 7: `answer.ts`를 쓴다(`pam/contracts.py` `parse_prediction`, `noonchi_pam/prompt.py` `parse_memory`)**

```ts
// LLM 답 검사. 원문을 고치지 않는다: 완전한 JSON 객체만 받고(마크다운 울타리·앞뒤 글·중복 키·NaN 같은 상수 거절), invalid는 대기(-1)와 구분한다.
// 검사 글은 Python PAM과 같다. JSON 문법 오류 글만 다르다.
import type { Prediction } from "../../contract/pam.js";
import { ContractError, validateMemory, validatePrediction, type PamMemory } from "../decision.js";
import { pyRepr } from "./py.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";

export interface ParsedPrediction {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: Prediction | null;
  selected_action: string | null;
  errors: string[];
}

export function parsePrediction(raw: string, tasks: string[]): ParsedPrediction {
  const result: ParsedPrediction = { status: "invalid", raw_response: raw, prediction: null, selected_action: null, errors: [] };
  try {
    const prediction = validatePrediction(readPyJson(raw), tasks);
    result.status = "valid";
    result.prediction = prediction;
    result.selected_action = prediction.task_index === -1 ? null : tasks[prediction.task_index]!;
  } catch (e) {
    if (e instanceof PyJsonFail) {
      const r = e.reason;
      result.errors.push(r.kind === "duplicate" ? `response JSON: duplicate key ${pyRepr(r.key)}` : r.kind === "constant" ? `response JSON: nonstandard numeric constant ${pyRepr(r.value)}` : e.message);
    } else if (e instanceof ContractError) result.errors.push(e.message);
    else throw e;
  }
  return result;
}

export type ParsedMemory = { ok: true; memory: PamMemory } | { ok: false; error: string };

export function parseMemory(raw: string, kind: "list" | "fsm"): ParsedMemory {
  try {
    return { ok: true, memory: validateMemory(readPyJson(raw), kind) };
  } catch (e) {
    if (e instanceof PyJsonFail || e instanceof ContractError) return { ok: false, error: e.message };
    throw e;
  }
}
```

(`PyJsonFail` 글은 이미 `duplicate key: k`·`nonstandard constant: NaN`·`JSON syntax error at char N`이라 `parse_memory`와 같다.)

- [ ] **Step 8: `budget.ts`를 쓴다(`noonchi_pam/budget.py`)**

```ts
// 문맥 길이 검사: 입력 추정 토큰 + max_tokens ≤ max_model_len. 추정은 UTF-8 바이트 ÷ 3(한국어 한 글자를 1토큰으로 넉넉히 센다).
import { PamBudgetError } from "./errors.js";
import { buildPredictMessages, buildReflectMessages, type PamMessage } from "./prompt.js";
import { predictRequest, reflectRequest } from "./request.js";

export const PER_MESSAGE = 8;
export const RESERVE = 256;
export interface PamLimits { max_model_len: number; predict_input_bytes: number; reflect_input_bytes: number }
export interface BudgetSettings { maxModelLen: number; maxTokens: { predictor: number; reflector: number } }

const texts = (ms: PamMessage[]) => ms.flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.map((p) => p.text ?? "")));

export const estimateTokens = (ms: PamMessage[]): number =>
  texts(ms).reduce((n, t) => n + Math.ceil(Buffer.byteLength(t, "utf8") / 3), 0) + PER_MESSAGE * ms.length;

export function checkBudget(ms: PamMessage[], maxTokens: number, maxModelLen: number): void {
  const n = estimateTokens(ms);
  if (n + maxTokens > maxModelLen) throw new PamBudgetError(`입력이 문맥 길이를 넘음: 추정 ${n} + 출력 ${maxTokens} > ${maxModelLen}`);
}

/** 판단·반성 요청에서 바뀌는 글(관찰 텍스트·행동 요약·피드백·기억 JSON·행동 목록)에 쓸 수 있는 UTF-8 바이트 수. */
export function pamLimits(s: BudgetSettings): PamLimits {
  const empty = { initial_state: "s", states: [{ id: "s", description: "d", rules: [], next: [] }] };
  const p = buildPredictMessages(predictRequest({ contract: "pam-predict/2", final_time: "2026-01-01T00:00:00+09:00", observation_text: "x", memory_kind: "fsm", memory: empty, tasks: ["t"] })).messages;
  const r = buildReflectMessages(reflectRequest({ contract: "pam-reflect/2", day: "2026-01-01", memory_kind: "fsm", memory: empty, observation_text: "x", action_summary: "x", feedback: null })).messages;
  const room = (ms: PamMessage[], role: "predictor" | "reflector") => Math.max(0, (s.maxModelLen - s.maxTokens[role] - estimateTokens(ms) - RESERVE) * 3);
  return { max_model_len: s.maxModelLen, predict_input_bytes: room(p, "predictor"), reflect_input_bytes: room(r, "reflector") };
}
```

- [ ] **Step 9: `index.ts`를 쓴다(이 묶음 몫)**

```ts
// PAM(판단·반성): 예전 services/pam(Python)을 옮긴 서버 안 함수. 다른 파일은 이 입구로 가져온다. 안내는 README.md.
export { adaptation, adaptedTemplate, buildPredictMessages, buildReflectMessages, PREDICT_LOG, PREDICT_TIME, REFLECT_FEEDBACK, REFLECT_LOG, REFLECT_MEMORY, REFLECT_SUMMARY, type Generation, type PamMessage } from "./prompt.js";
export { parseMemory, parsePrediction, type ParsedMemory, type ParsedPrediction } from "./answer.js";
export { checkBudget, estimateTokens, pamLimits, type PamLimits } from "./budget.js";
export { PamAnswerError, PamBudgetError, PamLinkError, PamRequestError } from "./errors.js";
export { loadPaperConfig, loadPrompt, PAM_DIR, PROMPT_IDS, render, type PromptId } from "./paper.js";
export { predictRequest, pyIsoformat, reflectRequest, type PredictRequest, type ReflectRequest } from "./request.js";
```

- [ ] **Step 10: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts tests/pam-request.test.ts tests/pam-answer.test.ts tests/pam-budget.test.ts tests/brain-decision.test.ts tests/brain-pam.test.ts`
Expected: PASS. 정답과 다르면 정답 파일을 고치지 않고 TS를 고친다(차이는 `systematic-debugging`으로 원인을 찾는다).

- [ ] **Step 11: 커밋·push**

```bash
git add src/brain/pam src/brain/decision.ts tests/pam-golden.test.ts tests/pam-request.test.ts tests/pam-answer.test.ts tests/pam-budget.test.ts tests/brain-decision.test.ts
git commit -m "feat(pam): port request shapes, messages, answer checks and budget to TypeScript"
git push
```

---

### Task 4: 설정 · LLM 전송 · 새 `PamClient`

**Files:**
- Modify: `src/infer/endpoints.ts`(PAM LLM 모드 표, `Endpoints.pam`. `pamUrl`은 Task 5에서 지운다)
- Create: `src/brain/pam/settings.ts`, `src/brain/pam/llm.ts`, `src/brain/pam/client.ts`
- Modify: `src/brain/pam/index.ts`, `tests/same-structure.test.ts:16-21`, `tests/infer-endpoints.test.ts`
- Test: `tests/pam-llm.test.ts`, `tests/pam-golden.test.ts`(전송 본문·설정·요청 결과 더하기)

이 묶음에서는 새 `PamClient`(`src/brain/pam/client.ts`)가 옛 HTTP `PamClient`(`src/brain/pam.ts`)와 함께 있다. 서버는 아직 옛 것을 쓴다.

**Interfaces:**
- Consumes: Task 3 전부.
- Produces(`endpoints.ts`): `type PamThinking = "openrouter" | "chat_template" | "openai"`, `interface PamEndpoint extends ModelEndpoint { thinking: PamThinking }`, `PAM_PRESETS: Record<InferenceMode, PamPreset>`, `PAM_PROVIDERS: Record<"openai", PamPreset>`, `Endpoints.pam: PamEndpoint`.
- Produces(`settings.ts`): `interface PamSettings extends PamEndpoint { timeoutMs: number; maxTokens: { predictor: number; reflector: number }; maxModelLen: number }`, `pamSettings(env: Record<string, string | undefined>): PamSettings`.
- Produces(`llm.ts`): `class PamLlm { constructor(s: PamSettings, o?: { fetchImpl?: typeof fetch }); body(ms, g, role): Record<string, unknown>; complete(ms, g, role, timeoutMs): Promise<string> }`.
- Produces(`client.ts`): `PAM_PREDICT`, `PAM_REFLECT`, `assertTextOnly(body, path?)`, `class PamClient { constructor(o: { settings: PamSettings; timeoutMs?: number; fetchImpl?: typeof fetch }); limits(): Promise<PamLimits>; predict(r: Omit<PamPredictRequest, "contract">): Promise<Prediction>; reflect(r: Omit<PamReflectRequest, "contract">, kind: "list"|"fsm"): Promise<PamMemory> }`, `class PamDecision`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/pam-golden.test.ts`에 더한다:

```ts
import { PamAnswerError, PamBudgetError, PamClient, PamLinkError, PamLlm, PamRequestError, pamSettings, type Generation, type PamMessage } from "../src/brain/pam/index.js";
import { loadEndpoints } from "../src/infer/endpoints.js";

const TRANSPORTS = { mock: { OPENROUTER_API_KEY: "k" }, live: { INFERENCE_MODE: "live" }, openai: { PAM_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" } };

async function wire(env: Record<string, string>, built: { messages: PamMessage[]; generation: Generation }, role: "predictor" | "reflector") {
  let line = "";
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    line = `POST ${url}\nauthorization: ${auth ?? "-"}\n\n${init?.body}`;
    return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  }) as typeof fetch;
  await new PamLlm(pamSettings(env), { fetchImpl }).complete(built.messages, built.generation, role, 5000);
  return line;
}

describe("Python과 같은 전송", () => {
  it("판단·반성 LLM 요청(주소·authorization·본문 바이트)이 세 갈래 모두 같다", async () => {
    for (const [cases, build, role] of [[inputs.predict, (r: unknown) => buildPredictMessages(predictRequest(r)), "predictor"], [inputs.reflect, (r: unknown) => buildReflectMessages(reflectRequest(r)), "reflector"]] as const) {
      for (const c of cases) {
        const built = build(c.request);
        let text = "";
        for (const [t, env] of Object.entries(TRANSPORTS)) text += `=== ${t} ===\n${await wire(env, built, role)}\n`;
        await sameFile(`${c.id}.wire.txt`, text);
      }
    }
  });

  it("설정(모드 표·덮어쓰기·오류 글)", () => {
    const got = inputs.settings.map((c: { id: string; env: Record<string, string> }) => {
      try {
        const s = pamSettings(c.env);
        return { id: c.id, settings: { mode: loadEndpoints(c.env).mode, base_url: s.baseUrl, model: s.model, api_key: s.apiKey, thinking: s.thinking,
          extra: s.extraBody, timeout_s: s.timeoutMs / 1000, max_tokens: s.maxTokens, max_model_len: s.maxModelLen } };
      } catch (e) {
        return { id: c.id, error: (e as Error).message };
      }
    });
    expect(got).toEqual(out("settings.json"));
  });

  it("요청 결과: 400→PamRequestError, 413→PamBudgetError, 200 invalid→PamAnswerError, 502→PamLinkError, 보낸 횟수까지 같다", async () => {
    const got = [];
    for (const c of inputs.requests) {
      let sent = 0;
      const fetchImpl = (async () => { sent++; return Response.json(c.llm.json, { status: c.llm.status }); }) as typeof fetch;
      const pam = new PamClient({ settings: pamSettings({ INFERENCE_MODE: "live" }), fetchImpl });
      let status = 200;
      let answer: string | null = "valid";
      try {
        if (c.route === "predict") await pam.predict(c.body);
        else await pam.reflect(c.body, c.body.memory_kind);
      } catch (e) {
        if (e instanceof PamAnswerError) answer = "invalid";
        else {
          answer = null;
          if (e instanceof PamRequestError) status = 400;
          else if (e instanceof PamBudgetError) status = 413;
          else if (e instanceof PamLinkError) status = 502;
          else throw e;
        }
      }
      got.push({ id: c.id, status, answer, sent });
    }
    expect(got).toEqual(out("requests.json"));
  });
});
```

`tests/pam-llm.test.ts`(`test_app.py` 전송 시험 + SDK 차이):

```ts
// PAM LLM 전송: 모드는 주소·모델·키·제공자 칸만 바꾼다. 다시 묻지 않고(재시도 0), 넘겨주기(3xx)를 따라가지 않고, 키가 없으면 authorization을 보내지 않는다.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PamLinkError, PamLlm, pamSettings } from "../src/brain/pam/index.js";
import { PAM_PRESETS } from "../src/infer/endpoints.js";
import { listenRetry } from "../src/shared/net.js";

const X = [{ role: "user" as const, content: [{ type: "text" as const, text: "x" }] }];
const OFF = { temperature: 0.3, enable_thinking: false };
const ON = { temperature: 0.3, enable_thinking: true };
const OK = { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
function capture(reply: () => Response = () => Response.json(OK)) {
  const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return reply();
  }) as typeof fetch;
  return { sent, fetchImpl };
}
let close: (() => void) | undefined;
afterEach(() => { close?.(); close = undefined; });

describe("PAM LLM 전송", () => {
  it("mock 모드 표는 config/openrouter.json과 같다", () => {
    const t = JSON.parse(readFileSync("src/brain/pam/config/openrouter.json", "utf8"));
    expect(PAM_PRESETS.mock).toEqual({ baseUrl: t.endpoint.replace(/\/chat\/completions$/, ""), model: t.model, keyEnv: t.api_key_env, thinking: "openrouter",
      extraBody: { provider: t.provider, plugins: [{ id: "context-compression", enabled: false }] } });
    expect(pamSettings({}).maxTokens).toEqual(t.max_tokens);
    expect(pamSettings({}).timeoutMs).toBe(t.timeout_seconds * 1000);
  });

  it("두 모드가 같은 칸(model·messages·temperature·max_tokens·stream)을 보내고, 다른 것은 제공자 칸뿐이다", async () => {
    const c = capture();
    await new PamLlm(pamSettings({ OPENROUTER_API_KEY: "k" }), c).complete(X, OFF, "predictor", 5000);
    await new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, OFF, "predictor", 5000);
    const [mock, live] = c.sent;
    expect([mock!.url, mock!.auth]).toEqual(["https://openrouter.ai/api/v1/chat/completions", "Bearer k"]);
    expect([live!.url, live!.auth]).toEqual(["http://vllm-pam:8000/v1/chat/completions", null]);
    const shared = ["model", "messages", "temperature", "max_tokens", "stream"];
    expect(Object.keys(mock!.body).filter((k) => !shared.includes(k)).sort()).toEqual(["plugins", "provider", "reasoning"]);
    expect(Object.keys(live!.body).filter((k) => !shared.includes(k))).toEqual(["chat_template_kwargs"]);
    expect([mock!.body.max_tokens, live!.body.max_tokens, mock!.body.stream, live!.body.stream]).toEqual([2048, 2048, false, false]);
  });

  it("반성은 반성 max_tokens와 생각 켜기", async () => {
    const c = capture();
    await new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, ON, "reflector", 5000);
    expect(c.sent[0]!.body).toMatchObject({ max_tokens: 16384, chat_template_kwargs: { enable_thinking: true } });
  });

  it("openai 공급자는 max_completion_tokens·reasoning_effort, 생각을 켜면 temperature를 보내지 않는다", async () => {
    const c = capture();
    const llm = new PamLlm(pamSettings({ PAM_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }), c);
    await llm.complete(X, OFF, "predictor", 5000);
    await llm.complete(X, ON, "reflector", 5000);
    expect(c.sent.map((s) => s.body)).toEqual([
      { model: "gpt-5.4-mini", messages: X, max_completion_tokens: 2048, stream: false, reasoning_effort: "none", temperature: 0.3 },
      { model: "gpt-5.4-mini", messages: X, max_completion_tokens: 16384, stream: false, reasoning_effort: "medium" },
    ]);
  });

  it("모르는 공급자·live의 공급자·모르는 모드·작은 문맥 길이는 시작할 때 실패", () => {
    expect(() => pamSettings({ PAM_LLM_PROVIDER: "gemini" })).toThrow("PAM_LLM_PROVIDER=gemini: mock에서 openai만 됩니다");
    expect(() => pamSettings({ INFERENCE_MODE: "live", PAM_LLM_PROVIDER: "openai" })).toThrow(/PAM_LLM_PROVIDER/);
    expect(() => pamSettings({ INFERENCE_MODE: "replay" })).toThrow("mock 또는 live");
    expect(() => pamSettings({ INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "16384" })).toThrow(/PAM_MAX_MODEL_LEN/);
  });

  it("HTTP 오류는 다시 보내지 않고 PamLinkError(한 번만 보냄)", async () => {
    for (const status of [500, 429]) {
      const c = capture(() => Response.json({ error: "x" }, { status }));
      await expect(new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, OFF, "predictor", 5000)).rejects.toThrow(`PAM LLM HTTP ${status}`);
      expect(c.sent).toHaveLength(1);
    }
  });

  it("넘겨주기(3xx)는 따라가지 않는다", async () => {
    let hits = 0;
    const srv = createServer((req, res) => { hits++; res.writeHead(302, { location: "/elsewhere" }); res.end(); });
    const { port } = await listenRetry(srv, 0, "127.0.0.1");
    close = () => srv.close();
    const s = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1` });
    await expect(new PamLlm(s).complete(X, OFF, "predictor", 5000)).rejects.toThrow("PAM LLM HTTP 302");
    expect(hits).toBe(1);
  });

  it("응답 머리 뒤 본문이 멈춰도 제한 시간에 끊는다(전체 제한)", async () => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"choices":[');
    });
    const { port } = await listenRetry(srv, 0, "127.0.0.1");
    close = () => { srv.closeAllConnections(); srv.close(); };
    const s = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1` });
    const t0 = Date.now();
    await expect(new PamLlm(s).complete(X, OFF, "predictor", 300)).rejects.toBeInstanceOf(PamLinkError);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("닿지 않음·시간 초과는 PamLinkError", async () => {
    const down = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1" });
    await expect(new PamLlm(down).complete(X, OFF, "predictor", 5000)).rejects.toBeInstanceOf(PamLinkError);
    const hang = ((_u: string | URL, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
    await expect(new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), { fetchImpl: hang }).complete(X, OFF, "predictor", 200)).rejects.toBeInstanceOf(PamLinkError);
  });
});
```

`tests/same-structure.test.ts:16-21`을 바꾼다:

```ts
  it("두 모드의 차이는 VLM·PAM LLM 주소·모델·키·제공자 칸뿐이다", () => {
    const a = loadEndpoints({ INFERENCE_MODE: "mock" });
    const b = loadEndpoints({ INFERENCE_MODE: "live" });
    expect({ ...a, mode: "", vlm: {}, pam: {} }).toEqual({ ...b, mode: "", vlm: {}, pam: {} });
    expect(Object.keys(a.vlm)).toEqual(Object.keys(b.vlm));
    expect(Object.keys(a.pam)).toEqual(Object.keys(b.pam));
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-llm.test.ts tests/pam-golden.test.ts tests/same-structure.test.ts`
Expected: FAIL(`PamLlm`·`pamSettings`·`Endpoints.pam`이 없다)

- [ ] **Step 3: `endpoints.ts`에 PAM LLM 모드 표를 더한다(`settings.py` `PRESETS`·`PROVIDERS`)**

```ts
/** PAM LLM 생각 켜기·끄기 칸 모양: OpenRouter reasoning.enabled, vLLM chat_template_kwargs.enable_thinking, OpenAI reasoning_effort. */
export type PamThinking = "openrouter" | "chat_template" | "openai";
export interface PamEndpoint extends ModelEndpoint { thinking: PamThinking }
interface PamPreset { baseUrl: string; model: string; keyEnv: string; thinking: PamThinking; extraBody: Record<string, unknown> }

// mock 값은 src/brain/pam/config/openrouter.json과 같다(tests/pam-llm.test.ts). live 모델 이름 pam은 compose vllm-pam의 --served-model-name이다.
export const PAM_PRESETS: Record<InferenceMode, PamPreset> = {
  mock: { baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.5-27b", keyEnv: "OPENROUTER_API_KEY", thinking: "openrouter",
    extraBody: { provider: { order: ["alibaba"], allow_fallbacks: false, require_parameters: true }, plugins: [{ id: "context-compression", enabled: false }] } },
  live: { baseUrl: "http://vllm-pam:8000/v1", model: "pam", keyEnv: "VLLM_API_KEY", thinking: "chat_template", extraBody: {} },
};
/** mock에서 OpenRouter 대신 쓰는 PAM LLM 공급자(PAM_LLM_PROVIDER). VLM과 같은 OpenAI 모델·키다. */
export const PAM_PROVIDERS: Record<string, PamPreset> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY", thinking: "openai", extraBody: {} },
};
```

`Endpoints`에 `pam: PamEndpoint`를 더하고 `loadEndpoints`에서 고른다:

```ts
  const provider = v("PAM_LLM_PROVIDER");
  if (provider && (raw !== "mock" || !Object.hasOwn(PAM_PROVIDERS, provider))) {
    throw new Error(`PAM_LLM_PROVIDER=${provider}: mock에서 ${Object.keys(PAM_PROVIDERS).join(", ")}만 됩니다`);
  }
  const pp = provider ? PAM_PROVIDERS[provider]! : PAM_PRESETS[raw];
  // return 안:
    pam: {
      baseUrl: (v("PAM_LLM_BASE_URL") ?? pp.baseUrl).replace(/\/+$/, ""), model: v("PAM_LLM_MODEL") ?? pp.model,
      apiKey: v("PAM_LLM_API_KEY") ?? v(pp.keyEnv) ?? "", thinking: pp.thinking, extraBody: structuredClone(pp.extraBody),
    },
```

머리 주석의 「PAM LLM 주소는 PAM 서비스(services/pam/…)가 고른다」를 「PAM LLM 주소·모델·키·제공자 칸도 여기서 고른다(`PAM_LLM_*`). 전송 값은 `src/brain/pam/settings.ts`」로 바꾼다. `tests/infer-endpoints.test.ts`에 시험을 더한다: `PAM_LLM_BASE_URL`·`PAM_LLM_MODEL`·`PAM_LLM_API_KEY`가 앞서고 끝 `/`를 지운다, 키는 `PAM_LLM_API_KEY` → 모드 키 이름 → 빈 글 차례다.

- [ ] **Step 4: `settings.ts`를 쓴다**

```ts
// PAM LLM 전송 값: 모드가 고른 주소·모델·키·제공자 칸(src/infer/endpoints.ts) + max_tokens·시간 제한(config/openrouter.json) + 문맥 길이.
// PAM_LLM_TIMEOUT_S(기본 120초)는 LLM 한 번 전체 제한이다. PAM_MAX_MODEL_LEN(기본 32768)은 compose vllm-pam의 --max-model-len과 같은 값이고 반성 출력보다 커야 한다.
import { join } from "node:path";
import { loadEndpoints, type PamEndpoint } from "../../infer/endpoints.js";
import { PAM_DIR, readStrictJson } from "./paper.js";

type Env = Record<string, string | undefined>;
export interface PamSettings extends PamEndpoint { timeoutMs: number; maxTokens: { predictor: number; reflector: number }; maxModelLen: number }

const TRANSPORT = readStrictJson(join(PAM_DIR, "config", "openrouter.json")) as { timeout_seconds: number; max_tokens: { predictor: number; reflector: number } };

export function pamSettings(env: Env): PamSettings {
  const pam = loadEndpoints(env).pam;
  const get = (k: string) => env[k]?.trim() || undefined;
  const rawLen = get("PAM_MAX_MODEL_LEN") ?? "32768";
  if (!/^[+-]?\d+$/.test(rawLen)) throw new Error(`PAM_MAX_MODEL_LEN=${rawLen}: 정수여야 합니다`);
  const maxModelLen = Number(rawLen);
  const maxTokens = { ...TRANSPORT.max_tokens };
  if (maxModelLen <= Math.max(maxTokens.predictor, maxTokens.reflector)) throw new Error(`PAM_MAX_MODEL_LEN=${maxModelLen}: 반성 출력 ${maxTokens.reflector}보다 커야 합니다`);
  const rawTimeout = get("PAM_LLM_TIMEOUT_S");
  const timeoutS = rawTimeout === undefined ? TRANSPORT.timeout_seconds : Number(rawTimeout);
  if (!(timeoutS > 0)) throw new Error(`PAM_LLM_TIMEOUT_S=${rawTimeout}: 0보다 큰 초여야 합니다`);
  return { ...pam, timeoutMs: timeoutS * 1000, maxTokens, maxModelLen };
}
```

- [ ] **Step 5: `llm.ts`를 쓴다(`noonchi_pam/llm.py`)**

```ts
// OpenAI 호환 chat completions 한 번(openai SDK). 고치거나 다시 묻지 않는다(maxRetries 0). 잘린 답(finish_reason이 stop도 null도 아님)은 오류다.
// 요청 칸 model, messages, temperature, max_tokens, stream=false는 두 모드가 같다. 생각 칸은 mock(OpenRouter) reasoning.enabled, live(vLLM) chat_template_kwargs.enable_thinking.
// OpenAI(PAM_LLM_PROVIDER=openai)는 max_completion_tokens·reasoning_effort(none·medium)이고 생각을 켜면 temperature를 보내지 않는다.
// 키가 없으면 authorization을 보내지 않는다. 연결 단계 EFAULT만 다시 보낸다(fetchRetry). 넘겨주기(3xx)는 따라가지 않는다.
import OpenAI, { APIError } from "openai";
import { z } from "zod";
import { fetchRetry } from "../../shared/net.js";
import { checkBudget } from "./budget.js";
import { PamLinkError } from "./errors.js";
import type { Generation, PamMessage } from "./prompt.js";
import type { PamSettings } from "./settings.js";

type Role = "predictor" | "reflector";
const Reply = z.object({
  choices: z.array(z.object({ message: z.looseObject({}).refine((m) => "content" in m), finish_reason: z.unknown().optional() })).min(1),
});

export class PamLlm {
  private readonly client: OpenAI;

  constructor(private readonly s: PamSettings, o: { fetchImpl?: typeof fetch } = {}) {
    this.client = new OpenAI({
      apiKey: s.apiKey || "no-key", baseURL: s.baseUrl, maxRetries: 0, timeout: s.timeoutMs,
      fetch: (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (!s.apiKey) headers.delete("authorization");
        return fetchRetry(url instanceof Request ? url.url : url, { ...init, headers, redirect: "manual" }, { fetchImpl: o.fetchImpl });
      },
    });
  }

  body(messages: PamMessage[], g: Generation, role: Role): Record<string, unknown> {
    const s = this.s;
    if (s.thinking === "openai") {
      return { model: s.model, messages, max_completion_tokens: s.maxTokens[role], stream: false,
        reasoning_effort: g.enable_thinking ? "medium" : "none", ...(g.enable_thinking ? {} : { temperature: g.temperature }), ...s.extraBody };
    }
    const thinking = s.thinking === "openrouter" ? { reasoning: { enabled: g.enable_thinking } } : { chat_template_kwargs: { enable_thinking: g.enable_thinking } };
    return { model: s.model, messages, temperature: g.temperature, max_tokens: s.maxTokens[role], stream: false, ...thinking, ...s.extraBody };
  }

  async complete(messages: PamMessage[], g: Generation, role: Role, timeoutMs: number): Promise<string> {
    const body = this.body(messages, g, role);
    checkBudget(messages, this.s.maxTokens[role], this.s.maxModelLen);
    let reply: unknown;
    // SDK timeout은 응답 머리를 받으면 풀린다. 본문 읽기까지 이어지는 전체 제한은 따로 끊는 신호로 건다(본문이 멈춰도 끊긴다).
    const limit = AbortSignal.timeout(timeoutMs);
    try {
      reply = await this.client.chat.completions.create(body as never, { timeout: timeoutMs, signal: limit });
    } catch (e) {
      if (e instanceof PamLinkError) throw e;
      if (e instanceof APIError && typeof e.status === "number") throw new PamLinkError(`PAM LLM HTTP ${e.status}`);
      throw new PamLinkError(`PAM LLM 연결 실패: ${(e as Error).name}`);
    }
    const r = Reply.safeParse(reply);
    if (!r.success) throw new PamLinkError("PAM LLM 답 모양이 chat completions가 아님");
    const choice = r.data.choices[0]!;
    if (choice.finish_reason != null && choice.finish_reason !== "stop") throw new PamLinkError(`PAM LLM 답이 끝나지 않음: ${String(choice.finish_reason)}`);
    const content = (choice.message as { content: unknown }).content;
    if (typeof content !== "string") throw new PamLinkError("PAM LLM 답에 글이 없음");
    return content;
  }
}
```

`redirect: "manual"`이면 fetch가 302 응답을 그대로 돌려주고, SDK는 2xx가 아닌 응답을 `APIError(status 302)`로 던져 `PAM LLM HTTP 302`가 된다. SDK가 그렇게 하지 않으면 `fetch` 감싸개가 상태 300~399에서 `PamLinkError(\`PAM LLM HTTP ${status}\`)`를 던지고, `complete`의 `catch`는 `PamLinkError`를 그대로 다시 던진다. 시험 「넘겨주기(3xx)는 따라가지 않는다」가 기준이다.

- [ ] **Step 6: `client.ts`를 쓴다(`src/brain/pam.ts`를 바꾼 것)**

```ts
// 판단(pam-predict/2)·반성(pam-reflect/2)을 서버 안 함수로 한다. 계약은 docs/pam-interface.md(사진 칸 없음).
// 차례(Python PAM과 같다): 사진 칸 검사 → 요청 모양(PamRequestError) → 메시지 → 문맥 길이(PamBudgetError) → LLM(PamLinkError) → 답 검사(PamAnswerError).
import type { PamPredictContract, PamPredictRequest, PamReflectContract, PamReflectRequest, Prediction } from "../../contract/pam.js";
import { checkInput, validateMemory, type DecisionInput, type DecisionModel, type PamMemory } from "../decision.js";
import { parseMemory, parsePrediction } from "./answer.js";
import { pamLimits, type PamLimits } from "./budget.js";
import { PamAnswerError, PamRequestError } from "./errors.js";
import { PamLlm } from "./llm.js";
import { buildPredictMessages, buildReflectMessages } from "./prompt.js";
import { predictRequest, reflectRequest } from "./request.js";
import type { PamSettings } from "./settings.js";

export const PAM_PREDICT: PamPredictContract = "pam-predict/2";
export const PAM_REFLECT: PamReflectContract = "pam-reflect/2";
const IMAGE_KEY = /^(image|images|frames|image_url|base64|jpeg|png)$/i;

/** 어느 깊이든 사진 칸이나 data:image 값이 있으면 막는다. */
export function assertTextOnly(body: unknown, path = "body"): void {
  if (typeof body === "string") {
    if (/data:image\//i.test(body)) throw new PamRequestError(`${path}: PAM에는 사진을 넘기지 않습니다`);
    return;
  }
  if (Array.isArray(body)) {
    body.forEach((v, i) => assertTextOnly(v, `${path}[${i}]`));
    return;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (IMAGE_KEY.test(k)) throw new PamRequestError(`${path}.${k}: PAM에는 사진을 넘기지 않습니다`);
      assertTextOnly(v, `${path}.${k}`);
    }
  }
}

export class PamClient {
  private readonly llm: PamLlm;

  constructor(private readonly o: { settings: PamSettings; timeoutMs?: number; fetchImpl?: typeof fetch }) {
    this.llm = new PamLlm(o.settings, { fetchImpl: o.fetchImpl });
  }

  /** 판단·반성에 넣을 수 있는 UTF-8 바이트(문맥 길이 PAM_MAX_MODEL_LEN에서 계산). */
  async limits(): Promise<PamLimits> {
    return pamLimits(this.o.settings);
  }

  async predict(r: Omit<PamPredictRequest, "contract">): Promise<Prediction> {
    assertTextOnly(r);
    const req = predictRequest({ contract: PAM_PREDICT, ...r });
    const built = buildPredictMessages(req);
    assertTextOnly(built.messages);
    const raw = await this.llm.complete(built.messages, built.generation, "predictor", Math.min(this.o.timeoutMs ?? 30_000, this.o.settings.timeoutMs));
    const parsed = parsePrediction(raw, req.tasks);
    if (parsed.status !== "valid" || !parsed.prediction) throw new PamAnswerError(`PAM 답이 계약에 맞지 않음(대기와 다름): ${parsed.errors.join("; ") || "이유 없음"}`);
    return parsed.prediction;
  }

  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "list" | "fsm"): Promise<PamMemory> {
    assertTextOnly(r);
    const req = reflectRequest({ contract: PAM_REFLECT, ...r });
    const built = buildReflectMessages(req);
    assertTextOnly(built.messages);
    const raw = await this.llm.complete(built.messages, built.generation, "reflector", this.o.settings.timeoutMs);
    const parsed = parseMemory(raw, req.memory_kind);
    if (!parsed.ok) throw new PamAnswerError(`PAM 반성 실패: ${parsed.error}`);
    return validateMemory(parsed.memory, kind);
  }
}

export class PamDecision implements DecisionModel {
  readonly name = "pam";
  constructor(private readonly pam: PamClient) {}

  decide(input: DecisionInput): Promise<Prediction> {
    try {
      checkInput(input);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.pam.predict({ final_time: input.finalTime, observation_text: input.text, memory_kind: input.memoryKind, memory: input.memory, tasks: input.tasks });
  }
}
```

`index.ts`에 더한다:

```ts
export { assertTextOnly, PAM_PREDICT, PAM_REFLECT, PamClient, PamDecision } from "./client.js";
export { PamLlm } from "./llm.js";
export { pamSettings, type PamSettings } from "./settings.js";
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/pam-llm.test.ts tests/pam-golden.test.ts tests/same-structure.test.ts tests/infer-endpoints.test.ts`
Expected: PASS

Run(빈 메모리 3GB 이상): `npm run heavy -- npm run typecheck`
Expected: 오류 없음

- [ ] **Step 8: 커밋·push**

```bash
git add src/infer/endpoints.ts src/brain/pam tests/pam-llm.test.ts tests/pam-golden.test.ts tests/same-structure.test.ts tests/infer-endpoints.test.ts
git commit -m "feat(pam): add in-process PamClient with openai SDK transport and mode table"
git push
```

---

### Task 5: 서버를 새 `PamClient`로 · 시험 대역을 가짜 LLM으로

**Files:**
- Delete: `src/brain/pam.ts`
- Modify: `src/brain/decide.ts:8`, `src/brain/history/reflect.ts:3,9`, `src/brain/index.ts`, `src/server/home/act.ts:79-83`, `src/server/start.ts:56,160`, `src/server/ready.ts`, `src/server/app.ts:121`, `src/contract/events.ts:224-232`, `src/contract/pam.ts`(머리 주석, 쓰지 않게 된 `PamPredictResponse`·`PamReflectResponse` 지우기), `src/infer/endpoints.ts`(`pamUrl`·`DEFAULT_PAM_URL` 지우기), `src/world/text.ts:47`(주석)
- Modify: `tests/helpers/pam.ts`(가짜 PAM LLM 서버), `tests/helpers/server-child.ts:10`
- Modify(시험): `tests/brain-pam.test.ts`, `tests/pam-text-only.test.ts`, `tests/history-reflect.test.ts`, `tests/world-decide.test.ts`, `tests/health-ready.test.ts`, `tests/infer-endpoints.test.ts`, `tests/twin3d-dev.test.ts`, 그리고 `startFakePam`·`PAM_URL`을 쓰는 나머지(`agent-planner`, `agent`, `coach-e2e`, `cup-branches-e2e`, `demo-e2e`, `mokryeon-e2e`, `noonchi-e2e`, `observe-start`, `phone-start-api`, `phone-voice`, `video-mode-e2e`, `video-real-e2e`, `vision-e2e`, `added-devices`, `demo-setup`, `drawn-fixtures`, `no-frames-on-disk`, `server-lock`)
- Modify(스크립트): `scripts/video-check.ts:478-520`, `scripts/twin3d/e2e-dashboard.ts:16,74-102,202`, `scripts/twin3d/dev.ts:44-49`

**Interfaces:**
- Consumes: Task 4 `PamClient`, `pamSettings`, `adaptedTemplate`, `PREDICT_*`·`REFLECT_*` 상수.
- Produces(`tests/helpers/pam.ts`): `type PredictView = { role: "predict"; final_time: string; observation_text: string; memory_kind: "list"|"fsm"; memory: unknown; tasks: string[] }`, `type ReflectView = { role: "reflect"; memory_kind; memory; observation_text: string; action_summary: string; feedback: string | null }`, `type PamView = PredictView | ReflectView`, `interface FakePamLlm { url: string; bodies: PamView[]; calls: ("predict"|"reflect")[]; requests: Record<string, unknown>[]; close(): Promise<void> }`, `startFakePamLlm(o?: { predict?: (v: PredictView) => Pred | string; reflect?: (v: ReflectView) => unknown; status?: Partial<Record<"predict"|"reflect", number>> }): Promise<FakePamLlm>`, 그리고 지금의 `cupBranchPredict`·`coachPredict`·`demoPredict`(인자 `PredictView`).
- Produces(`ReadyView.pam`): `{ base_url: string; model: string; key: boolean; reachable: boolean }`.

- [ ] **Step 1: 가짜 PAM LLM 서버를 쓴다(실패하는 시험의 바탕)**

`tests/helpers/pam.ts`의 서버 부분을 바꾼다(`cupFacts`·`cupBranchPredict`·`coachPredict`·`demoPredict`·습관 규칙은 그대로 두고 인자 타입만 `PredictView`로).

```ts
// 시험용 PAM LLM 자리(OpenAI 호환 /v1/chat/completions, GET /v1/models): 서버 안 PamClient가 보낸 판단·반성 메시지를 되읽어
// 요청 값(관찰 텍스트·기억·행동 목록 등)으로 기록하고, 정해진 답 글을 낸다. 서버에는 PAM_LLM_BASE_URL=url로 붙인다.
import { createServer } from "node:http";
import { adaptedTemplate, PREDICT_LOG, PREDICT_TIME, REFLECT_FEEDBACK, REFLECT_LOG, REFLECT_MEMORY, REFLECT_SUMMARY } from "../../src/brain/pam/index.js";
import { listenRetry } from "../../src/shared/net.js";

type Pred = { observation: string; reasoning: string; task_index: number };
export type PredictView = { role: "predict"; final_time: string; observation_text: string; memory_kind: "list" | "fsm"; memory: unknown; tasks: string[] };
export type ReflectView = { role: "reflect"; memory_kind: "list" | "fsm"; memory: unknown; observation_text: string; action_summary: string; feedback: string | null };
export type PamView = PredictView | ReflectView;
export interface FakePamLlm { url: string; bodies: PamView[]; calls: PamView["role"][]; requests: Record<string, unknown>[]; close(): Promise<void> }
export interface FakePamLlmOptions {
  /** 판단 답(기본 대기 -1). 문자열이면 답 글 그대로. */
  predict?: (v: PredictView) => Pred | string;
  /** 반성 답(기본은 받은 기억 그대로). 문자열이면 답 글 그대로. */
  reflect?: (v: ReflectView) => unknown;
  /** 갈래별 HTTP 상태(예: { predict: 500 }). */
  status?: Partial<Record<PamView["role"], number>>;
}

const WAIT: Pred = { observation: "할 일이 보이지 않음", reasoning: "맞는 규칙이 없어 기다린다", task_index: -1 };
const PLACE = /\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}/;

/** 끼워 넣은 프롬프트에서 자리 값을 되읽는다(render의 거꾸로). 맞지 않으면 null. */
function unrender(template: string, text: string): Record<string, string> | null {
  const parts = template.split(new RegExp(PLACE.source, "g"));
  if (!text.startsWith(parts[0]!)) return null;
  let at = parts[0]!.length;
  const out: Record<string, string> = {};
  for (let k = 1; k < parts.length; k += 2) {
    const next = parts[k + 1]!;
    const end = k + 2 >= parts.length ? (text.endsWith(next) ? text.length - next.length : -1) : text.indexOf(next, at);
    if (end < at) return null;
    out[parts[k]!] = text.substring(at, end);
    at = end + next.length;
  }
  return out;
}

function view(body: { messages: { content: string | { text: string }[] }[] }): PamView {
  const system = body.messages[0]!.content as string;
  const parts = (body.messages[1]!.content as { text: string }[]).map((p) => p.text);
  for (const kind of ["fsm", "list"] as const) {
    const v = unrender(adaptedTemplate(`predictor_${kind}`), system);
    if (v) {
      return { role: "predict", memory_kind: kind, memory: JSON.parse(v[kind === "fsm" ? "fsm_block" : "rules_block"]!),
        tasks: v.tasks_block!.split("\n").map((l, i) => l.substring(`${i}: `.length)),
        final_time: parts[0]!.substring(PREDICT_TIME.length), observation_text: parts[1]!.substring(PREDICT_LOG.length) };
    }
    if (system === adaptedTemplate(`reflector_${kind}_update`)) {
      const t = parts[1]!;
      const s = t.indexOf(REFLECT_SUMMARY);
      const rest = t.substring(s + REFLECT_SUMMARY.length);
      const f = rest.indexOf(REFLECT_FEEDBACK);
      return { role: "reflect", memory_kind: kind, memory: JSON.parse(t.substring(REFLECT_MEMORY.length, s)), observation_text: parts[0]!.substring(REFLECT_LOG.length),
        action_summary: f < 0 ? rest : rest.substring(0, f), feedback: f < 0 ? null : rest.substring(f + REFLECT_FEEDBACK.length) };
    }
  }
  throw new Error("PAM 판단·반성 메시지가 아닙니다");
}

export async function startFakePamLlm(o: FakePamLlmOptions = {}): Promise<FakePamLlm> {
  const bodies: PamView[] = [];
  const calls: PamView["role"][] = [];
  const requests: Record<string, unknown>[] = [];
  const json = (res: import("node:http").ServerResponse, status: number, b: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(b));
  };
  const srv = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") return json(res, 200, { object: "list", data: [] });
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw) as Record<string, unknown> & { messages: never; model: string };
    requests.push(body);
    const v = view(body);
    bodies.push(v);
    calls.push(v.role);
    const status = o.status?.[v.role];
    if (status && status !== 200) return json(res, status, { error: { message: "가짜 오류" } });
    const answer = v.role === "predict" ? (o.predict?.(v) ?? WAIT) : o.reflect ? o.reflect(v) : v.memory;
    const content = typeof answer === "string" ? answer : JSON.stringify(answer);
    json(res, 200, { id: "fake", object: "chat.completion", created: 0, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  });
  const { port } = await listenRetry(srv, 0, "127.0.0.1");
  return { url: `http://127.0.0.1:${port}/v1`, bodies, calls, requests,
    close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}

/** 서버에 넘길 PAM LLM 환경(가짜 서버 주소, 실제 키 대신 가짜 키). */
export const pamLlmEnv = (pam: Pick<FakePamLlm, "url">) => ({ PAM_LLM_BASE_URL: pam.url, PAM_LLM_API_KEY: "fake-key" });
```

- [ ] **Step 2: 시험을 새 대역에 맞춘다(이 상태에서 실패한다)**

바꾸는 규칙:

| 지금 | 바꾼 뒤 |
|---|---|
| `startFakePam(o)` | `startFakePamLlm(o)`(`status: { "/predict": n }` → `status: { predict: n }`, `limits:` 옵션은 없앤다) |
| 서버 환경 `PAM_URL: pam.url` | `...pamLlmEnv(pam)` |
| 서버 환경 `PAM_URL: "http://127.0.0.1:9"`(PAM 끄기) | `PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1"` |
| `pam.paths`의 `"POST /predict"`·`"POST /reflect"` | `pam.calls`의 `"predict"`·`"reflect"` |
| `b.contract`가 `PAM_PREDICT`·`PAM_REFLECT` | `b.role`이 `"predict"`·`"reflect"` |
| 요청 칸 목록에 `contract` | `role`(`["final_time","memory","memory_kind","observation_text","role","tasks"]`) |
| 보낸 본문에 사진이 없는지(`pam.bodies`) | 실제 LLM 본문 `pam.requests`에 `/data:image\|base64\|"image_url"\|"type":"image/`가 없는지 |
| `sent.final_time === <Node 시각>` | `Date.parse(sent.final_time) === Date.parse(<Node 시각>)` |
| `new PamClient({ url })` | `new PamClient({ settings: pamSettings({ INFERENCE_MODE: "live", ...pamLlmEnv(pam) }) })` |
| 입력 한도를 가짜 `/health`로 정하던 시험(`history-reflect.test.ts` `LIMITS`) | `PAM_MAX_MODEL_LEN`으로 정한다: 한도 비교는 `await client.limits()`로 읽은 값, 「한도가 아주 큼」은 `PAM_MAX_MODEL_LEN: "4000000"` |
| `limits()`가 `/health`에 한도가 없으면 `ContractError`, 닿지 않으면 `PamLinkError` | `limits()`가 `PAM_MAX_MODEL_LEN`을 따른다(32768 → `max_model_len` 32768, 작은 값 → 반성 한도가 줄어든다) |

`tests/history-reflect.test.ts`의 손수 만든 PAM 서버(`startPam`)는 `startFakePamLlm({ reflect: () => memory })`로 바꾸고, `got`은 `pam.bodies`(반성 보기)로 읽는다.

`tests/brain-pam.test.ts`는 같은 제목을 유지하고 본문을 바꾼다: 판단 요청 값(`pam.bodies[0]`이 `{ role: "predict", final_time: "2026-11-07T21:00:08+09:00", … }`), 대기·행동 고르기, invalid 답은 `PamAnswerError`, 원문이 우리 검사에서 틀리면 `PamAnswerError`, 닿지 않으면 `PamLinkError`, `status: { predict: 502 }`는 `PamLinkError`, 계약 밖 요청은 `PamRequestError`(LLM에 보내지 않음), 시간 초과는 `PamLinkError`, 반성은 받은 기억을 검사해 돌려준다(`pam.bodies[0]`이 `{ role: "reflect", feedback: null }`).

`tests/pam-text-only.test.ts`: 사진 칸이면 `PamRequestError`로 보내기 전에 막히고(`pam.requests` 0개), 나간 LLM 본문(`pam.requests.at(-1)`)에 사진이 없고 사용자 글에 관찰 텍스트가 든다.

`tests/health-ready.test.ts`: 가짜 PAM `/health` 대신 `GET {PAM LLM}/models`를 본다. `ready.pam`은 `{ base_url, model: "q", key, reachable }`이고, PAM LLM이 닿지 않으면 `reachable: false`·`ok: false`다.

`tests/infer-endpoints.test.ts`: `PAM_URL` 시험 둘(`:22-26`, `:49-50`)을 지운다.

`tests/twin3d-dev.test.ts`·`scripts/twin3d/dev.ts`: `PAM_URL` → `PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1"`, 빈 키 목록에 `PAM_LLM_API_KEY`·`OPENROUTER_API_KEY`를 더한다.

`tests/helpers/server-child.ts:10`: `PAM_URL: "http://127.0.0.1:9"` → `PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1"`.

`scripts/video-check.ts`·`scripts/twin3d/e2e-dashboard.ts`: `startFakePam` → `startFakePamLlm`, `PAM_URL: pam.url` → `...pamLlmEnv(pam)`.

Run: `npm run heavy -- npx vitest run tests/brain-pam.test.ts tests/world-decide.test.ts`
Expected: FAIL(서버·`PamClient`가 아직 `url`을 받는다)

- [ ] **Step 3: 서버를 바꾼다**

`src/server/home/act.ts:79-83`:

```ts
  // 판단 호출(src/brain/decide.ts): World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM(src/brain/pam/)을 부른다.
  const pamTimeout = Number(env.PAM_TIMEOUT_MS);
  const decide = new Decider({
    pam: new PamClient({ settings: pamSettings(env), timeoutMs: Number.isFinite(pamTimeout) && pamTimeout > 0 ? pamTimeout : undefined }),
```

`src/server/start.ts:160`: `const pam = new PamClient({ settings: pamSettings(env) });`(`env`는 `:118`의 것). `:56` 주석의 `PAM_URL`을 `PAM_LLM_*`로 바꾼다.

`src/brain/index.ts`: `export { PamClient } from "./pam.js";` → `export { PamClient, pamSettings } from "./pam/index.js";`, 머리 주석 「PAM 서비스 연결」 → 「PAM(판단·반성)」.

`src/brain/decide.ts:8`: `import { PamLinkError, type PamClient } from "./pam/index.js";`. `src/brain/history/reflect.ts:9`: `import type { PamClient } from "../pam/index.js";`, `:3` 주석의 「PAM /health의 입력 한도」 → 「PamClient.limits()의 입력 한도」.

`src/server/ready.ts`:

```ts
// /api/health의 준비 상태: 추론 모드, VLM·PAM LLM 주소 응답(GET {base}/models, 30초 캐시),
// 에이전트 키와 주소 응답(openai GET {base}/models, anthropic GET {base}/v1/models, 30초 캐시), 기록 DB.
  const { vlm, pam, mode } = o.endpoints;
  // ...
    const bearer = (key: string): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});
    const [vlmOk, pamOk, agentOk] = await Promise.all([
      cache.check(`vlm:${vlm.baseUrl}`, () => reachable(`${vlm.baseUrl}/models`, { headers: bearer(vlm.apiKey), fetchImpl: o.fetchImpl })),
      cache.check(`pam:${pam.baseUrl}`, () => reachable(`${pam.baseUrl}/models`, { headers: bearer(pam.apiKey), fetchImpl: o.fetchImpl })),
      cache.check(`agent:${agent.provider}:${agent.baseUrl}`, agentProbe(agent, o.fetchImpl)),
    ]);
    // return 안:
      ok: vlmOk && pamOk && agentKey && agentOk && db, inference_mode: mode,
      pam: { base_url: pam.baseUrl, model: pam.model, key: pam.apiKey !== "", reachable: pamOk },
```

`src/contract/events.ts:224-232`: 「VLM·PAM LLM·에이전트·기록 DB가 모두 준비됐는가」, `pam: { base_url: string; model: string; key: boolean; reachable: boolean }`(주석 「PAM LLM(PAM_LLM_BASE_URL) 주소 응답」). `src/server/app.ts:121`: `pam: { base_url: "", model: "", key: false, reachable: false }`.

`src/infer/endpoints.ts`: `Endpoints.pamUrl`, `DEFAULT_PAM_URL`, `pamUrl:` 줄, 주석의 `PAM_URL`을 지운다.

`src/contract/pam.ts`: 머리 주석 「noonchi ↔ PAM 서비스(services/pam/)」 → 「PamClient(src/brain/pam/) 입력 모양」. `PamPredictResponse`·`PamReflectResponse`를 쓰는 곳이 없으면 지운다(`grep -rn "PamPredictResponse\|PamReflectResponse" src tests scripts ui`).

`src/world/text.ts:47`: 「PAM 서비스 pam-predict/2와 같다」 → 「pam-predict/2(src/brain/pam/request.ts)와 같다」.

`src/brain/pam.ts`를 지운다: `git rm src/brain/pam.ts`.

- [ ] **Step 4: 통과를 확인한다(작은 것부터 하나씩)**

```bash
npm run heavy -- npx vitest run tests/brain-pam.test.ts tests/pam-text-only.test.ts tests/history-reflect.test.ts tests/world-decide.test.ts tests/health-ready.test.ts tests/infer-endpoints.test.ts tests/twin3d-dev.test.ts
npm run heavy -- npx vitest run tests/agent.test.ts tests/agent-planner.test.ts tests/observe-start.test.ts tests/phone-start-api.test.ts tests/phone-voice.test.ts
npm run heavy -- npx vitest run tests/demo-e2e.test.ts
npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts
npm run heavy -- npx vitest run tests/coach-e2e.test.ts
npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts
npm run heavy -- npx vitest run tests/video-mode-e2e.test.ts tests/vision-e2e.test.ts tests/mokryeon-e2e.test.ts
```

Expected: 모두 PASS. e2e는 빈 메모리 3GB 이상에서 하나씩.

- [ ] **Step 5: 남은 자리를 찾는다**

Run: `grep -rn "PAM_URL\|startFakePam(\|pamUrl\|src/brain/pam.js\|\"/health\"" src tests scripts ui/src`
Expected: 아무것도 없음

- [ ] **Step 6: 커밋·push**

`git add`는 Step 1~5에서 바꾼 파일을 경로로 하나씩 적는다(`git status --short`로 확인, `.gitignore`·`.ignore`는 빼고).

```bash
git commit -m "refactor(pam): call PAM in-process and swap the fake PAM server for a fake PAM LLM"
git push
```

---

### Task 6: `services/pam`과 띄우는 설정 지우기

**Files:**
- Delete: `services/pam/`(전부, `tests/make_golden.py` 포함)
- Modify: `compose.yaml`, `.github/workflows/ci.yml:41-57`, `scripts/container-smoke.ts`, `.env.example`, `.gitattributes`, `.dockerignore`(`services/pam/.venv` 줄)
- Modify(시험): `tests/deploy-files.test.ts`, `tests/self-contained.test.ts`

**Interfaces:**
- Consumes: Task 5까지 전부.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/deploy-files.test.ts`의 pam 서비스 시험(`:82-94`의 pam 부분, `:122-131`의 pam 부분, `:134-165` PAM 이미지, `:182-184` CI pytest, `:191-192`·`:213`·`:263-265`의 `PAM_HOST_PORT`·`8300`)을 지우고 다음으로 바꾼다:

```ts
  it("compose에 pam 서비스가 없고, noonchi가 PAM LLM 설정을 받는다(판단·반성은 서버 안 함수)", () => {
    const c = composeFile();
    expect(c.services.pam).toBeUndefined();
    expect(c.services.noonchi.depends_on?.pam).toBeUndefined();
    const env = Object.keys(c.services.noonchi.environment ?? {});
    for (const k of ["PAM_LLM_PROVIDER", "PAM_LLM_BASE_URL", "PAM_LLM_MODEL", "PAM_LLM_API_KEY", "PAM_LLM_TIMEOUT_S", "PAM_MAX_MODEL_LEN", "OPENROUTER_API_KEY", "VLLM_API_KEY"]) expect(env, k).toContain(k);
    expect(env).not.toContain("PAM_URL");
  });

  it("저장소·CI에 Python PAM이 없다", () => {
    expect(existsSync("services/pam")).toBe(false);
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/pytest|services\/pam|noonchi-pam/);
  });
```

(`composeFile`·`read`·`existsSync`는 그 파일이 이미 쓰는 도우미·import를 쓴다. 없으면 같은 파일의 compose 읽는 줄을 그대로 쓴다.)

`:122` 「noonchi는 서버 코드가 읽는 설정을 받는다」 시험은 남기고 pam 부분만 지운다. `:216-221` 키 없는 컨테이너 확인 시험은 `PAM_LLM_BASE_URL`이 가짜 서버를 가리키는 것을 그대로 본다.

`tests/self-contained.test.ts`:
- `:19`·`:24`의 `use: "services/pam/"`·`"services/pam/·twin/"` → `"src/brain/pam/"`·`"src/brain/pam/·twin/"`
- `:26`의 「저장소 안 폴더(. 또는 services/pam)」 → 「저장소 안 폴더(.)」
- `:77` 통과 예에서 `"services/pam/"`, `"    build: services/pam"`을 뺀다
- 새 시험: 「src·tests·scripts·compose·CI·.env.example에 `services/pam`·`PAM_URL`이 없다」

```ts
  it("옛 PAM 서비스 자리(services/pam·PAM_URL)를 쓰지 않는다", () => {
    const files = [...walk("src"), ...walk("tests").filter((f) => !f.includes("fixtures")), ...walk("scripts"), "compose.yaml", ".github/workflows/ci.yml", ".env.example", "Dockerfile"];
    for (const f of files.filter((x) => /\.(ts|ya?ml|example)$|Dockerfile$/.test(x) && !x.endsWith("self-contained.test.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/services\/pam|PAM_URL|PAM_HOST_PORT/);
    }
  });
```

(`walk`는 그 파일의 것을 쓰고, 없으면 `tests/same-structure.test.ts:11`의 `walk`를 그대로 옮긴다.)

Run: `npm run heavy -- npx vitest run tests/deploy-files.test.ts tests/self-contained.test.ts`
Expected: FAIL(`services/pam`·compose `pam`이 아직 있다)

- [ ] **Step 2: 지운다**

```bash
git rm -r services/pam
```

`compose.yaml`:
- 머리 주석 「noonchi(…), pam(CPU, PAM 서비스)」 → 「noonchi(CPU, 서버·YOLO 감지·관절·PAM 판단·반성)」.
- `noonchi.environment`에서 `PAM_URL`을 지우고, 지운 `pam` 서비스의 `environment` 목록(`PAM_LLM_PROVIDER`·`PAM_LLM_BASE_URL`·`PAM_LLM_MODEL`·`PAM_LLM_API_KEY`·`PAM_LLM_TIMEOUT_S`·`PAM_MAX_MODEL_LEN`·`OPENROUTER_API_KEY`·`VLLM_API_KEY`)을 noonchi에 없는 것만 더한다(값 비움, 비면 서버 기본값).
- `noonchi.depends_on`의 `pam`을 지운다(남는 것이 없으면 `depends_on` 줄째로).
- `pam:` 서비스 블록(`:136-160`)을 지운다.

`.github/workflows/ci.yml`: `pam:` 일(`:41-57`)을 지운다.

`scripts/container-smoke.ts`:
- `PORTS.pam`·`CHECK_PAM_PORT`·`PAM_HOST_PORT`·`PAM_URL`(`:9,31,51`)을 지운다.
- `compose up` 목록(`:137`)과 `logs`(`:220`)에서 `pam`을 뺀다. 닫힌 포트 확인(`:140`)에서 `PORTS.pam`을 뺀다.
- `:158` 확인을 `h.ready?.pam?.base_url !== FAKE || h.ready?.pam?.reachable !== true`로 바꾼다.
- `:170` 근처 PAM 서비스 직접 `POST /predict` 확인을 지운다.
- 머리 주석의 pam을 지운다.

`.env.example`: `PAM_URL`(`:55-56`)·`PAM_HOST_PORT`(`:157`) 칸과 설명을 지우고, 「PAM 서비스가 부르는 PAM LLM」 → 「서버(src/brain/pam)가 부르는 PAM LLM」으로 바꾼다.

`.gitattributes`: `services/pam/** -text`, `services/pam/prompts/paper/*.txt text eol=lf`를 지운다. `.dockerignore`: `services/pam/.venv`를 지운다.

- [ ] **Step 3: 통과를 확인한다**

```bash
npm run heavy -- npx vitest run tests/deploy-files.test.ts tests/self-contained.test.ts tests/pam-prompts.test.ts tests/pam-golden.test.ts
```

Expected: PASS(정답 파일은 `tests/fixtures/pam-golden`에 남아 TS 시험이 계속 본다)

- [ ] **Step 4: 커밋·push**

```bash
git add -u services/pam
git add compose.yaml .github/workflows/ci.yml scripts/container-smoke.ts .env.example .gitattributes .dockerignore tests/deploy-files.test.ts tests/self-contained.test.ts
git commit -m "chore(pam): remove the Python PAM service, its image, compose service and CI job"
git push
```

---

### Task 7: 문서 · 안내 · 규칙 표

**Files:**
- Create: `src/brain/pam/README.md`
- Modify: `docs/pam-interface.md`, `docs/reference.md`(`:44`, `:102-105`, `:125`, `:443`, `:470`, `:504`, `:509-524`), `docs/deploy.md`(`:3`, `:9`, `:88`, `:106-107`, `:122-123`, `:143`, `:150`), `README.md`(`:101`, `:140`), `CLAUDE.md`(규칙 표 `:15`, `:16`)

**Interfaces:**
- Consumes: 앞 묶음의 파일·시험 이름.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/self-contained.test.ts`의 새 시험(Task 6 Step 1) 대상에 `docs/reference.md`·`docs/deploy.md`·`docs/pam-interface.md`·`README.md`·`CLAUDE.md`·`src/brain/pam/README.md`를 더하고, `src/brain/pam/README.md`가 있는지 본다.

```ts
  it("문서에 옛 PAM 서비스 자리가 없고, src/brain/pam에 안내가 있다", () => {
    for (const f of ["docs/reference.md", "docs/deploy.md", "docs/pam-interface.md", "README.md", "CLAUDE.md", "src/brain/pam/README.md"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/services\/pam|PAM_URL|PAM_HOST_PORT|:8300/);
    }
    const guide = readFileSync("src/brain/pam/README.md", "utf8");
    for (const s of ["prompts/paper", "source_map.json", "prompt.ts", "answer.ts", "decide.ts", "decision.ts", "history/reflect.ts", "habits.ts", "src/world/text.ts", "src/act/tasks.ts", "npm test", "pam-golden", "-u"]) expect(guide, s).toContain(s);
  });
```

Run: `npm run heavy -- npx vitest run tests/self-contained.test.ts`
Expected: FAIL

- [ ] **Step 2: `src/brain/pam/README.md`를 쓴다**

```markdown
# PAM (판단·반성)

판단(predict)과 반성(reflect)을 서버 안 함수로 해요. 예전 Python 서비스(services/pam)를 옮긴 TypeScript예요. 출처는 `PROVENANCE.md`·`THIRD_PARTY.md`에 있어요.

## 어디를 고치면 무엇이 바뀌나요

| 바꾸고 싶은 것 | 고칠 파일 | 같이 볼 시험 |
|---|---|---|
| 프롬프트 글(논문 원문) | `prompts/paper/*.txt` + `prompts/source_map.json`의 `sha256` | `tests/pam-prompts.test.ts`, `tests/pam-golden.test.ts` |
| 프롬프트 글(노닌치용 바꾸기) | `scenarios/noonchi/scenario.json`의 `prompt_replacements` | `tests/pam-prompts.test.ts`, `tests/pam-scenario.test.ts`, `tests/pam-golden.test.ts` |
| 판단·반성 메시지 만들기 | `prompt.ts` | `tests/pam-request.test.ts`, `tests/pam-golden.test.ts` |
| 요청 모양(칸·글 길이·시각 꼴) | `request.ts` | `tests/pam-request.test.ts` |
| 답 검사 | `answer.ts`, `pyjson.ts` | `tests/pam-answer.test.ts`, `tests/pam-golden.test.ts` |
| 문맥 길이·입력 한도 | `budget.ts` | `tests/pam-budget.test.ts` |
| 모델·주소·전송 칸 | `llm.ts`, `settings.ts`, `config/openrouter.json`, `src/infer/endpoints.ts`(모드별 주소) | `tests/pam-llm.test.ts` |
| 판단 부르기(언제·무엇을 넘기나) | `src/brain/decide.ts` | `tests/world-decide.test.ts`, `tests/brain-pam.test.ts` |
| 기억 모양·seed 기억 | `src/brain/decision.ts` | `tests/brain-decision.test.ts`, `tests/pam-answer.test.ts` |
| 반성 흐름·습관 거르기 | `src/brain/history/reflect.ts`, `src/brain/history/habits.ts` | `tests/history-reflect.test.ts`, `tests/history-habits.test.ts` |
| 관찰 글(PAM이 받는 집 상태 글) | `src/world/text.ts` | `tests/world-text.test.ts` |
| 행동 목록 | `src/act/tasks.ts`(`scenarios/noonchi/tasks.json`과 같아야 해요) | `tests/act-tasks.test.ts`, `tests/pam-scenario.test.ts` |

## 시험

- 전체: `npm test`
- 하나만: `npx vitest run tests/pam-golden.test.ts`
- 이 PC에서는 `npm run heavy -- npx vitest run <파일>`로 하나씩 돌려요.
- 실제 모델은 부르지 않아요. 시험은 가짜 LLM 서버(`tests/helpers/pam.ts`)를 써요.

## 논문 프롬프트를 바꾸면

1. `tests/pam-prompts.test.ts`가 일부러 실패해요. 바꾼 파일의 해시를 `prompts/source_map.json`의 `sha256`에 같이 고쳐요.
   - 해시 보기: `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('src/brain/pam/prompts/paper/predictor_fsm.txt')).digest('hex'))"`
2. 메시지가 바뀌므로 `tests/pam-golden.test.ts`도 실패해요. `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 쓰고, `git diff tests/fixtures/pam-golden`로 바뀐 글을 확인한 뒤 같이 커밋해요.
3. 프롬프트 파일은 LF 줄끝이어야 해요(`.gitattributes`가 고정해요).
```

- [ ] **Step 3: 문서를 고친다**

`docs/pam-interface.md`: 「PAM 서비스 HTTP」를 「서버 안 함수 `PamClient`(`src/brain/pam/`)」로 바꾼다. 남기는 것: `pam-predict/2`·`pam-reflect/2` 입력 칸 표, 답(`Prediction`·기억) 모양, 사진 칸 없음. 바꾸는 것: 400·413·502 → 정한 것 3의 오류 표, `/health` 입력 한도 → `limits()`(`PAM_MAX_MODEL_LEN`에서 계산), 주소 `PAM_URL` → `PAM_LLM_*`.

`docs/reference.md`:
- `:44` 「brain/ PAM 서비스 연결, history/」 → 「brain/ pam/(판단·반성), history/(기록·반성)」
- `:102` `PAM_URL` 줄과 `:105` `PAM_HOST_PORT` 줄을 지운다. `:103-104`의 「PAM 서비스(`services/pam/`)가 부르는」 → 「서버(`src/brain/pam/`)가 부르는」.
- `:125` `PAM_TIMEOUT_MS` 설명: 「판단 한 번 제한 시간. `PAM_LLM_TIMEOUT_S`보다 길면 짧은 쪽」.
- `:443`·`:470`·`:504`의 「PAM 서비스(`PAM_URL`)」·「`GET /health`의 `reflect_input_bytes`」 → 「PAM(`src/brain/pam/`)」·「`PamClient.limits()`의 `reflect_input_bytes`」.
- `:509-524` 「PAM 서비스 (services/pam)」 절을 「PAM (src/brain/pam)」로 바꾼다: 판단·반성은 서버 안 함수, 띄울 것 없음, 고칠 곳은 `src/brain/pam/README.md`, 시험 이름.
- `/api/health` `ready.pam` 설명을 `{ base_url, model, key, reachable }`로.

`docs/deploy.md`: CPU 컨테이너 설명에서 PAM 서비스를 지우고 「noonchi가 PAM LLM(vllm-pam)을 부른다」, `:88` 「vLLM과 PAM 서비스가 같이 쓴다」 → 「vLLM과 서버가 같이 쓴다」, `:107` `curl …:8300/health` 줄 삭제, `:122-123` `ready.pam` 설명을 `pam.reachable`(PAM LLM 주소 응답)로, `:143` `docker build … services/pam` 삭제, `:150` 「PAM 서비스 판단(…)과 /health 입력 한도」 삭제.

`README.md`: `:101` 「판단 (services/pam) — PAM(Python)」 → 「판단 (src/brain/pam) — PAM: 관찰 글만 받아 행동을 고른다」, `:140` 「PAM 서비스를 띄우고」를 지우고 `BRAIN=1 …`만 남긴다.

`CLAUDE.md` 규칙 표:
- `:15` 막는 장치의 「`services/pam/tests/test_v2.py`·`test_app.py`(사진 칸이면 400)」 → 「`tests/pam-request.test.ts`·`tests/pam-golden.test.ts` 「요청 결과」(사진 칸이면 LLM에 보내기 전에 `PamRequestError`)」
- `:16` 「대신 쓸 폴더 `services/pam/`·`twin/`·`src/`」 → 「대신 쓸 폴더 `src/brain/pam/`·`twin/`·`src/`」

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/self-contained.test.ts tests/deploy-files.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋·push**

```bash
git add src/brain/pam/README.md docs/pam-interface.md docs/reference.md docs/deploy.md README.md CLAUDE.md tests/self-contained.test.ts
git commit -m "docs(pam): describe PAM as in-process functions and add a guide for the AI team"
git push
```

---

### Task 8: 검증

**Files:** 없음(고칠 것이 나오면 그 묶음으로 돌아가 실패 시험부터).

- [ ] **Step 1: 빈 메모리를 본다**

Run: `powershell -c "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"`
Expected: 3 이상(GB). 아니면 기다리거나 조정자에게 묻는다.

- [ ] **Step 2: 판단·반성 시험**

```bash
npm run heavy -- npx vitest run tests/pam-golden.test.ts tests/pam-prompts.test.ts tests/pam-request.test.ts tests/pam-answer.test.ts tests/pam-budget.test.ts tests/pam-llm.test.ts tests/brain-pam.test.ts tests/pam-text-only.test.ts tests/history-reflect.test.ts tests/world-decide.test.ts
```

Expected: PASS

- [ ] **Step 3: 데모 e2e 넷(하나씩)**

```bash
npm run heavy -- npx vitest run tests/demo-e2e.test.ts
npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts
npm run heavy -- npx vitest run tests/coach-e2e.test.ts
npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts
```

Expected: demo 7, noonchi 2, coach 3, cup-branches 3 통과

- [ ] **Step 4: 타입 검사·lint**

```bash
npm run heavy -- npm run typecheck
npm run heavy -- npm run lint
```

Expected: 오류 없음(도메인 경계·글 자르기 lint 포함)

- [ ] **Step 5: 전체 시험(빈 메모리 3GB 이상일 때만)**

Run: `npm run heavy -- npm test`
Expected: 루트·ui 모두 통과. 따로 돌리면 통과하는 흔들리는 시험(lint-text-cut 시간 초과, twin-assets)은 다시 하나씩 돌려 확인한다.

- [ ] **Step 6: 남은 자리 확인**

Run: `grep -rn "services/pam\|PAM_URL\|PAM_HOST_PORT" --include=*.ts --include=*.md --include=*.yaml --include=*.yml --include=.env.example . | grep -v node_modules | grep -v "docs/superpowers/" | grep -v "^./graft/"`
Expected: 아무것도 없음(옛 계획 문서 `docs/superpowers/`는 기록이라 그대로 둔다)

- [ ] **Step 7: 최종 보고**

조정자에게 묶음별 해시, 시험 결과(숫자), 아래 「SSOT에 알릴 것」을 보낸다. docs 저장소는 고치지 않는다.

---

## SSOT에 알릴 것 (구현명세서)

1. PAM 서비스(Python FastAPI, `services/pam`, 포트 8300)가 없어지고, 판단·반성은 noonchi 서버 안 함수(`src/brain/pam/`)다. 아키텍처 그림·배포 그림에서 pam 컨테이너를 뺀다.
2. 계약 `pam-predict/2`·`pam-reflect/2`는 HTTP가 아니라 `PamClient` 입력 모양이다. 오류: 요청 틀림(예전 400) `PamRequestError`, 문맥 넘침(413) `PamBudgetError`, 답 틀림(200 invalid) `PamAnswerError`, LLM 오류(502) `PamLinkError`.
3. 환경 변수: `PAM_URL`·`PAM_HOST_PORT` 삭제. `PAM_LLM_*`·`PAM_MAX_MODEL_LEN`·`OPENROUTER_API_KEY`·`VLLM_API_KEY`는 noonchi 서버가 읽는다. `PAM_LLM_TIMEOUT_S`는 LLM 한 번 전체 제한(예전은 소켓 단계별).
4. `/api/health` `ready.pam`: `{ url, reachable, llm }` → `{ base_url, model, key, reachable }`(PAM LLM `GET /models`).
5. 입력 한도: PAM `/health` `limits` → `PamClient.limits()`(같은 계산, `PAM_MAX_MODEL_LEN`).
6. 논문 프롬프트·source_map·출처 문서 위치: `src/brain/pam/`. AI 담당 안내는 `src/brain/pam/README.md`.
7. compose: `pam` 서비스 삭제, `noonchi`가 `vllm-pam`(live)·OpenRouter(mock)를 직접 부른다. CI: Python 일 삭제.

## 위험

| 위험 | 막는 것 |
|---|---|
| openai SDK가 httpx와 다른 머리글(`x-stainless-*`, `user-agent`)을 보낸다 | OpenRouter·vLLM은 머리글을 보지 않는다. 정답 비교는 주소·authorization·본문 바이트만 본다 |
| SDK가 다시 묻거나 넘겨주기를 따라간다 | `maxRetries: 0`, `redirect: "manual"`, 시험 「HTTP 오류는 다시 보내지 않고」·「넘겨주기(3xx)는 따라가지 않는다」 |
| SDK가 빈 키 대신 `OPENAI_API_KEY`를 읽어 vLLM에 보낸다 | 키를 늘 넘기고(`no-key`), 키가 없으면 `fetch` 감싸개가 authorization을 지운다. 시험 「두 모드가 같은 칸」의 live `auth: null` |
| `PAM_LLM_TIMEOUT_S` 뜻이 소켓 단계별 → 전체로 바뀐다 | 판단은 `PAM_TIMEOUT_MS`(30초)가 먼저 끊는다. 반성 120초는 논문 측정(약 1분)보다 길다. SSOT 3에 적는다 |
| SDK `timeout`은 응답 머리를 받으면 풀려, 본문이 멈추면 끝없이 기다린다 | 호출마다 `AbortSignal.timeout`을 `signal`로 넘겨 본문 읽기까지 끊는다. 시험 「응답 머리 뒤 본문이 멈춰도 제한 시간에 끊는다」 |
| pydantic이 받던 이상한 시각 꼴을 TS가 거절한다 | Node는 `isoWithOffset` 꼴만 보낸다. 정답 파일의 시각 일곱 꼴이 같다 |
| 정답 파일이 Windows 줄끝으로 바뀐다 | `.gitattributes` `tests/fixtures/pam-golden/** -text` |
| 시험이 기본 주소(openrouter.ai)를 부른다 | `tests/setup/no-real-ai.ts`가 막고, 서버 자식 환경(`server-child.ts`)·dev 스크립트가 닫힌 주소를 준다 |
| 가짜 LLM 서버가 메시지를 되읽지 못한다(프롬프트를 바꾼 뒤) | 되읽기는 `adaptedTemplate`을 그대로 써서 프롬프트가 바뀌어도 같이 따라간다 |

## Self-Review

- 조정자 요구 1(코드 옮기기·zod·openai SDK·PamClient 모양·설정 이름): Task 2·3·4. 2(논문 경로·해시 시험·Python 정답 바이트 비교): Task 1·2·3·4. 3(Python 시험 옮기기): 「Python 시험 → TS 시험」 표, Task 2·3·4·5. 4(지우기·가짜 LLM·문서·규칙 표): Task 5·6·7. 5(검증): Task 8. 6(SSOT 목록): 「SSOT에 알릴 것」. 추가 요구(한 폴더 `src/brain/pam/`·README·규칙 표 TS 시험 이름): File Structure, Task 7.
- 이름 맞춤: `predictRequest`·`reflectRequest`·`buildPredictMessages`·`buildReflectMessages`·`parsePrediction`·`parseMemory`·`pamLimits`·`pamSettings`·`PamLlm`·`PamClient`·`startFakePamLlm`·`pamLlmEnv`가 묶음 사이에서 같다.
