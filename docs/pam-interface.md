# PAM 연결 형식 (noonchi 안 판단·반성)

판단·반성은 noonchi 서버 안 함수 `PamClient`(`src/brain/pam/`)다. 띄울 서비스가 없다. PAM에는 사진을 넘기지 않는다. World State가 YOLO(감지·관절)와 VLM 결과를 합친 관찰 텍스트를 넘긴다. 고칠 곳 안내는 `src/brain/pam/README.md`.

| 누가 | 하는 일 |
|---|---|
| 판단 호출(`src/brain/decide.ts`) | 폰 엔진 프레임이 오는 동안 5초마다 그때 관찰 텍스트로 부른다(`PAM_TRIGGER=periodic` 기본, `PAM_PERIOD_MS`). 프레임이 10초 넘게 안 오거나 사람 없음·등장 사라짐 없음이 30분이면 멈춘다. `event`면 World State에 의미 있는 변화가 있을 때 |
| 관찰 글(`src/world/text.ts`) | 시각이 붙은 줄 + `[지속]` 오래 이어진 사실 + `[때]` 날짜·요일·하루 때 + `[눈]` 클로이드 눈이 있는 방 이름. 글은 [World State 낱말 표](world-vocabulary.md)의 한국어 글이다 |
| `PamClient` | 논문 프롬프트에 관찰 텍스트를 넣어 PAM LLM을 부르고, 답을 검사해 돌려준다. 무엇을 할지는 사람 상태 FSM 기억의 화살표로 정한다 |
| 판단 호출 | PAM 답의 화살표 행동이 지금 행동 목록에 있으면 그 행동, 없으면 대기(서버가 정한다) |
| 실행(`src/act/`) | 실행 전 검사를 거쳐 실행한다 |

## 판단 `PamClient.predict` (`pam-predict/3`)

입력(`contract`는 `PamClient`가 붙인다):

```json
{
  "final_time": "2026-11-07T21:00:08.000+09:00",
  "observation_text": "21:00:01 사람 보임\n21:00:01 컵 cup_1 보임\n21:00:02 VLM: 사람이 식탁 옆에 서 있고 컵이 식탁 위에 있다\n21:00:02 사람 서 있음\n21:00:02 컵 cup_1 식탁 위\n21:00:04 사람 안 보임\n21:00:04 VLM: 식탁 위에 빈 컵이 있다\n[지속] 컵 cup_1 자리 모름: 21:00:00부터 8초째, 마지막 확인 21:00:04\n[지속] 컵 cup_1 식탁 위: 21:00:02부터 6초째\n[지속] 컵 cup_1 비어 있음(짐작): 21:00:04부터 4초째\n[지속] 사람 안 보임: 21:00:04부터 4초째\n[때] 11월 7일 토요일 밤\n[눈] 클로이드 눈: 주방",
입력: `{ "day": "2026-11-07", "memory_kind": "fsm", "memory": { ... }, "observation_text": "하루 관찰 텍스트", "action_summary": "하루 행동 요약", "feedback": "사용자 피드백 또는 null" }`
  "memory_kind": "fsm",
  "memory": { "initial_state": "away", "states": [ ... ] },
  "tasks": ["컵 치우기", "사용자에게 물어보기"],
  "last_state": "drinking"
}
```

- `memory`(fsm): 사람 상태 FSM. 상태마다 `id`·`description`·`activity`(World State 사람 하는 일 값)·`next`(화살표 `{ to, on, when?, action? }`, `to`는 상태 id 또는 `"*"`). 처음 상태는 `away`(자리에 없음). 안 하기는 화살표 없음이다.
- `last_state`: 직전 판단의 사람 상태(처음이면 `null`, PAM은 처음 상태로 본다). 행동이 아직 시작되지 않은 화살표가 있으면 15초 동안 그 출발 상태다.

답: `{ "observation": "...", "reasoning": "...", "state": "away", "from": "drinking", "next_index": 0 }`

- `state`: 지금 사람 상태 id. 기억에 없는 활동이면 임시 상태 `~<하는 일 값>`. `from`: 이번에 일어난 화살표가 나간 상태(없으면 `null`). `next_index`: 그 상태 `next`의 번호(없으면 −1). 화살표는 직전 상태(`last_state`, `null`이면 처음 상태)에서만 나간다: `from`이 직전 상태가 아니면 틀린 답이다. `next_index`가 −1이면 `from`에 직전 상태가 와도 화살표 없음으로 읽는다(모델이 직전 상태를 적어 오는 일이 있다. 그 밖의 상태면 틀린 답).
- `"*"` 화살표는 출발 상태를 떠나기만 하면 켜진다. 이름 있는 도착 화살표는 `state`가 그 상태여야 한다. 임시 상태에서 나가는 화살표는 없다.
- 행동은 서버가 정한다: 그 화살표 `action`이 지금 행동 목록에 있으면 그 번호(`task_index`), 아니면 −1(대기). list 기억이면 예전처럼 `task_index`를 답한다.
- 메시지의 시각 줄은 Python `isoformat()` 꼴로 바꿔 쓴다(`2026-11-07T21:00:08+09:00`).

## 반성 `PamClient.reflect` (`pam-reflect/3`)

입력: `{ "day": "2026-11-07", "memory_kind": "fsm_candidates", "memory": { 후보 FSM }, "observation_text": "덩어리 기록(덩어리마다 사람 상태)", "action_summary": "하루 행동 요약과 지난 검사 결과", "feedback": "사용자 피드백 또는 null" }`

답: 후보 FSM(`{ "initial_state", "states" }`, 상태마다 행동 없는 화살표 `next`와 (출발 상태, 행동)마다 조건 후보 1~3개 `rules: [{ to, action, candidates: [{ on, when? }] }]`). 배우는 행동(컵 치우기·에어컨 켜기) 후보만 채택 검사를 거쳐 로봇 FSM 화살표가 된다. 사용자가 정한 습관 화살표는 반성이 고치지 않고, 있던 상태 id·후보 글은 바꾸지 않는다. `list` 기억이면 `memory_kind: "list"`에 새 `{ "rules" }`.

## 밤 흐름의 다른 부르기(같은 PAM LLM 통로)

| 부르기 | 지시문 | 답 |
|---|---|---|
| 기억 뜻 검사 `PamClient.checkMemory` | `scenarios/noonchi/memory_check.txt` | `{ ok, items: [{ kind: "state"\|"condition"\|"merge", ref, ok, why }] }`. 거절이면 까닭을 피드백에 붙여 한 번 다시 반성한다 |
| 덩어리 기록 `PamClient.chunk` | `scenarios/noonchi/chunking.txt` | `{ chunks: [{ start, end, text }] }`(시각은 그날 기록 줄의 시각, 차례대로 겹치지 않음, `validateChunks`) |
| 시각 찾기 `PamClient.mark` | `scenarios/noonchi/marking.txt` | `{ candidates: [{ state, candidate, times }], actions: [{ action, times }], unseen: [{ start, end }] }`(물은 것마다 꼭 한 번, `validateMarks`) |

## 입력 한도 `PamClient.limits()`

`{ "max_model_len", "predict_input_bytes", "reflect_input_bytes" }`: 바뀌는 글(관찰 텍스트·행동 요약·피드백·기억 JSON)에 쓸 수 있는 UTF-8 바이트 수. `PAM_MAX_MODEL_LEN`에서 센다. 반성은 이 값으로 하루 요약을 줄인다.

## 오류

| 오류 | 언제 | 기록 |
|---|---|---|
| `PamRequestError` | 입력이 계약에 안 맞음(모르는 칸·사진 칸·시간대 없는 시각·글 길이·틀린 기억). LLM에 보내지 않는다 | 판단 실패 |
| `PamBudgetError` | `입력 추정 + max_tokens`가 문맥 길이를 넘음. LLM에 보내지 않는다 | 판단 실패 |
| `PamAnswerError` | LLM 답이 계약에 안 맞음(대기 −1과 다르다) | 판단 실패 |
| `PamLinkError` | LLM 연결 실패·HTTP 오류·시간 초과·잘린 답(`finish_reason`이 있고 `stop`도 `null`도 아님, 칸이 없으면 받음)·답 모양 틀림 | PAM 연결 끊김 |

`PamRequestError`·`PamBudgetError`·`PamAnswerError`는 `ContractError`다.

## 규칙

- 두 계약 모두 사진 칸이 없다. 사진 칸·`data:image` 값은 보내기 전에 막는다(`assertTextOnly`).
- 칸 상한(글자 수는 코드 포인트): 판단 관찰 텍스트 20,000자, 반성 관찰 텍스트 100,000자·행동 요약 50,000자·피드백 8,000자.
- 판단·반성 프롬프트는 논문 프롬프트(`src/brain/pam/prompts/paper/`)를 고치지 않고 `src/brain/pam/scenarios/noonchi/scenario.json`대로 바꿔 쓴다: 입력 설명 문장, 공간 문장, 사람 상태 FSM 쓰는 법(답 칸 `state`·`from`·`next_index`, 직전 상태, 화살표가 일어날 때), 반성의 후보 FSM 모양과 행동 목록. 논문 원문 프롬프트 파일은 그대로다. 기억 뜻 검사·덩어리 기록·시각 찾기 지시문은 이 저장소 글이다(논문 해시 대상 아님).
- PAM LLM 주소: `INFERENCE_MODE`가 고른다(`openai`: OpenAI `gpt-5.4-mini`, `vllm`: 같은 서버 vLLM, 모델 이름 `pam`). `PAM_LLM_BASE_URL`·`PAM_LLM_MODEL`·`PAM_LLM_API_KEY`가 앞선다.
- 전송 값은 `src/brain/pam/config/transport.json`이다: max_tokens 판단 2048·반성 16384, 시간 제한 120초(`PAM_LLM_TIMEOUT_S`, 본문 읽기까지 전체), `stream: false`. 다시 보내지 않는다.
- 제한 시간: 판단은 `PAM_TIMEOUT_MS`(기본 30000)와 `PAM_LLM_TIMEOUT_S` 가운데 짧은 쪽, 반성은 `PAM_LLM_TIMEOUT_S`.
- 사용량: 답을 받으면(틀린 답·잘린 답이어도) 판단·반성 기록에 `usage`(모델·입력·출력·캐시 토큰·비용 달러, 가격표에 없는 모델은 비용 null)를 남긴다.
- 기억: 반성으로 고친 기억은 다음 날부터 쓴다. 그날 판단은 그날 처음 정한 기억 판본만 쓴다(논문 `config/paper.json`의 `memory_lifecycle`).

## 박석준과 맞출 것

1. 입력 설명 문장·공간 문장과 관찰 텍스트의 언어·형식.
2. 판단 규칙 문장의 책상(desk) 표현: 「the person sets it down on the desk」를 집에 맞게 바꿀지. 지금은 논문 문장 그대로다.
3. 행동 목록(「컵 그대로 두기」를 뺐다: 안 하기는 화살표 없음).
4. vllm 모드 PAM LLM 모델(Qwen3.5-27B 4비트 / 7B급).
5. 계약 `pam-predict/3`(답 `state`·`from`·`next_index`, 요청 `last_state`, 임시 상태 `~<값>`)과 `pam-reflect/3`(후보 FSM `fsm_candidates`).
6. 기억 모양: 석준 님 상태 안 `rules`(trigger·action) 대신 사람 하는 일 상태와 화살표 `next`(on·when·action). 통과한 후보를 " or "로 한 트리거에 잇지 않고 화살표 하나씩 둔다(PAM 답이 화살표 번호로 하나를 가리킨다).
7. 채택 검사(`trigger_check.py` 그대로)에 더한 것: 답 칸 `answered`(「그대로 둬요」 답이 있는 창은 사람이 안 보였어도 본 것), 「치워 주세요」 답은 따라옴, 로봇이 그 일을 한 구간은 못 봄.
8. 덩어리 기록·시각 찾기 글(`chunking.txt`·`marking.txt`)을 집·사람 상태 FSM에 맞춘 것, 시각 검사를 고른 줄 간격 대신 그날 줄 시각 목록으로도 받는 것(`validateChunks`·`validateMarks`의 `within`).
9. 기억 뜻 검사(`memory_check.txt`)를 반성 뒤에 한 번 두는 것.

## 시험

- `tests/pam-golden.test.ts`(옮기기 전 Python과 같은 메시지·전송 본문·답 검사), `tests/pam-prompts.test.ts`(프롬프트 해시), `tests/pam-request.test.ts`, `tests/pam-answer.test.ts`, `tests/pam-budget.test.ts`, `tests/pam-llm.test.ts`, `tests/brain-pam.test.ts`, `tests/pam-text-only.test.ts`
- 밤 흐름: `tests/pam-adopt.test.ts`(채택 검사, 석준 님 시험 경우), `tests/pam-marks.test.ts`, `tests/pam-memory-check.test.ts`, `tests/history-night.test.ts`, `tests/history-reflect.test.ts`
- 시험용 PAM LLM 자리: `tests/helpers/pam.ts`(`startFakePamLlm`, 서버에는 `PAM_LLM_BASE_URL`로 붙인다)
- 두뇌를 키 없이 띄우기: `npx tsx scripts/fake-openai.ts --port 8500` 뒤 `BRAIN=1 PAM_LLM_BASE_URL=http://127.0.0.1:8500/v1 VLM_BASE_URL=http://127.0.0.1:8500/v1`
