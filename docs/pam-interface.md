# PAM 연결 형식 (noonchi ↔ PAM 서비스)

noonchi 서버가 PAM 서비스(`services/pam/`)를 부르는 형식이다. PAM에는 사진을 넘기지 않는다. World State가 YOLO(감지·관절)와 VLM 결과를 합친 관찰 텍스트를 넘긴다.

| 누가 | 하는 일 |
|---|---|
| noonchi | 폰 엔진 프레임이 오는 동안 5초마다 그때 관찰 텍스트로 부른다(`PAM_TRIGGER=periodic` 기본, `PAM_PERIOD_MS`). 프레임이 10초 넘게 안 오거나 사람 없음·등장 사라짐 없음이 30분이면 멈춘다. `event`면 World State에 의미 있는 변화가 있을 때 |
| PAM 서비스 | 그 관찰에서 무엇을 할지(계기·행동)는 PAM의 FSM 기억으로 정한다 |
| noonchi | 관찰 텍스트를 만든다: 시각이 붙은 줄 + `[지속]` 오래 이어진 사실 + `[때]` 날짜·요일·하루 때 + `[눈]` 클로이드 눈이 있는 방 이름(`src/world/text.ts`). 글은 [World State 낱말 표](world-vocabulary.md)의 한국어 글이다 |
| PAM 서비스 | 논문 프롬프트에 관찰 텍스트를 넣어 PAM LLM을 부르고 원문을 돌려준다 |
| noonchi | 원문을 다시 검사하고, 실행 전 검사를 거쳐 실행한다 |

## 판단 `POST {PAM_URL}/predict` (`pam-predict/2`)

요청:

```json
{
  "contract": "pam-predict/2",
  "final_time": "2026-11-07T21:00:08.000+09:00",
  "observation_text": "21:00:01 사람 보임\n21:00:02 컵 cup_1 보임\n21:00:02 VLM: 사람이 식탁 옆에 서 있고 컵이 식탁 위에 있다\n21:00:02 사람 서 있음\n21:00:02 컵 cup_1 식탁 위\n21:00:04 사람 안 보임\n21:00:04 VLM: 식탁 위에 빈 컵이 있다\n21:00:04 컵 cup_1 비어 있음\n[지속] 컵 cup_1 자리 모름: 21:00:00부터 8초째, 마지막 확인 21:00:04\n[지속] 컵 cup_1 식탁 위: 21:00:02부터 6초째\n[지속] 컵 cup_1 비어 있음(짐작): 21:00:04부터 4초째\n[지속] 사람 안 보임: 21:00:04부터 4초째\n[때] 11월 7일 토요일 밤\n[눈] 클로이드 눈: 주방",
  "memory_kind": "fsm",
  "memory": { "initial_state": "drinking", "states": [ ... ] },
  "tasks": ["컵 치우기", "사용자에게 물어보기"]
}
```

답(HTTP 200, PAM `parse_prediction` 모양):

```json
{ "status": "valid", "raw_response": "{...}", "prediction": { "observation": "...", "reasoning": "...", "task_index": 0 }, "selected_action": "컵 치우기", "errors": [] }
```

## 반성 `POST {PAM_URL}/reflect` (`pam-reflect/2`)

요청:

```json
{ "contract": "pam-reflect/2", "day": "2026-11-07", "memory_kind": "fsm", "memory": { ... },
  "observation_text": "하루 관찰 텍스트", "action_summary": "하루 행동 요약", "feedback": "사용자 피드백 또는 null" }
```

답: `{ "status": "valid", "raw_response": "...", "memory": { ... }, "errors": [] }`

## 상태 `GET {PAM_URL}/health`

`{ "ok": true, "llm": { "base_url", "model", "reachable" }, "limits": { "max_model_len", "predict_input_bytes", "reflect_input_bytes" } }`

## 규칙

- 두 계약 모두 사진 칸이 없다. 모르는 칸이 오면 400이다. noonchi는 보내기 전에 사진 칸·`data:image` 값을 막는다(`assertTextOnly`).
- 칸 상한: 판단 관찰 텍스트 20,000자, 반성 관찰 텍스트 100,000자·행동 요약 50,000자·피드백 8,000자.
- `status: "invalid"`는 대기(−1)와 다른 판단 실패다.
- 판단 프롬프트는 논문 프롬프트(`services/pam/prompts/paper/`)를 고치지 않고 `services/pam/scenarios/noonchi/scenario.json`대로 바꿔 쓴다: 입력 설명 문장, 공간 문장, 그리고 기억 규칙 쓰는 법(논문의 「기억은 참고일 뿐, 조건이 맞지 않아도 써도 된다」 대신 「규칙 조건(사람이 있거나 없음·하는 일·컵 상태)이 모두 맞을 때만 쓰고, (짐작) 값은 확인되지 않은 것」). 논문 재현 경로(시나리오 없이 만드는 판단 메시지)는 원본 문장 그대로다.
- PAM LLM 주소: `INFERENCE_MODE`가 고른다(mock: OpenRouter `qwen/qwen3.5-27b` provider alibaba, live: 같은 서버 vLLM, 모델 이름 `pam`). `PAM_LLM_BASE_URL`·`PAM_LLM_MODEL`이 앞선다.
- 전송 값은 `services/pam/config/openrouter.json`이다: max_tokens 판단 2048·반성 16384, 시간 제한 120초, `stream: false`. mock은 provider alibaba 고정과 문맥 압축 끔(`plugins`)을 더 보낸다. 잘린 답(`finish_reason`이 `stop`이 아님)과 LLM 오류는 502다.
- 문맥 길이: `PAM_MAX_MODEL_LEN`(기본 32768, vLLM `--max-model-len`과 같은 값). `입력 추정 + max_tokens`가 넘으면 413이고 LLM을 부르지 않는다. `GET /health`의 `limits`(`predict_input_bytes`, `reflect_input_bytes`)가 바뀌는 글(관찰 텍스트·행동 요약·피드백·기억 JSON)에 쓸 수 있는 UTF-8 바이트 수다. noonchi는 반성 전에 이 값을 읽어 하루 요약을 줄인다.
- 제한 시간: 판단 `PAM_TIMEOUT_MS`(기본 30000), 반성 300초.
- 연결 실패·시간 초과·5xx는 `PamLinkError`(PAM 연결 끊김으로 기록), 400·413·답 형식 오류는 `ContractError`(판단 실패)다.
- 기억: 반성으로 고친 기억은 다음 날부터 쓴다. 그날 판단은 그날 처음 정한 기억 판본만 쓴다(논문 `config/paper.json`의 `memory_lifecycle`).

## 박석준과 맞출 것

1. 입력 설명 문장·공간 문장과 관찰 텍스트의 언어·형식.
2. 판단 규칙 문장의 책상(desk) 표현: 「the person sets it down on the desk」를 집에 맞게 바꿀지. 지금은 논문 문장 그대로다.
3. 행동 목록. 지금은 `컵 치우기`, `사용자에게 물어보기`.
4. live PAM LLM 모델(Qwen3.5-27B 4비트 / 7B급).

## 시험

- 서비스: `npm run heavy -- services\pam\.venv\Scripts\python.exe -m pytest services/pam -q`(가짜 OpenAI 호환 서버 사용)
- noonchi 쪽: `tests/pam-text-only.test.ts`, `tests/brain-pam.test.ts`(시험용 PAM 자리 `tests/helpers/pam.ts`)
- 두뇌를 키 없이 PAM에 붙이기: `npx tsx scripts/fake-openai.ts --port 8500`, PAM 서비스를 `INFERENCE_MODE=live PAM_LLM_BASE_URL=http://127.0.0.1:8500/v1`로 띄우고 `BRAIN=1 PAM_URL=http://127.0.0.1:8300`
