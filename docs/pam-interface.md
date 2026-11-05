# PAM 연결 형식 (twin-home 클로이드 두뇌 ↔ 박석준 PAM)

twin-home 두뇌가 PAM 예측기(predictor)를 HTTP로 부를 때의 입력·결과 형식이다. 한 카메라, FSM 기억 기준이다. 결과는 PAM `parse_prediction` 결과와 같은 모양이다. 박석준과 정하면서 바꾼다.

## 역할 나누기

| 누가 | 하는 일 |
|---|---|
| twin-home 두뇌 | 언제 PAM을 부를지 정한다. 컵을 두고 자리를 비운 것이 확인됐을 때만 부른다(YOLO 5초 + VLM 사람 없음) |
| twin-home 두뇌 | 사진을 모은다. 한 카메라 5장, 2초 간격(t−8, t−6, t−4, t−2, t초) |
| twin-home 두뇌 | 장면 밖 근거를 붙인다. 컵 안 요청 답 사진과 VLM이 확신한 컵 안 |
| PAM | 무엇을 도울지 하나 고른다: `task_index`, −1은 대기 |
| twin-home 두뇌 | 행동 직전 다시 확인한다. 실행은 지금 모두 모의다 |

## 요청

`POST {PAM_URL}`(예: `http://127.0.0.1:8300/predict`), `Content-Type: application/json`

```json
{
  "contract": "pam-predict/1",
  "camera": "single",
  "final_frame_time": "2026-11-04T21:00:08.000+09:00",
  "frames": [
    { "timestamp": "2026-11-04T21:00:00.000+09:00", "image": { "mime_type": "image/jpeg", "base64": "..." } },
    { "timestamp": "2026-11-04T21:00:02.000+09:00", "image": { "mime_type": "image/jpeg", "base64": "..." } },
    { "timestamp": "2026-11-04T21:00:04.000+09:00", "image": { "mime_type": "image/jpeg", "base64": "..." } },
    { "timestamp": "2026-11-04T21:00:06.000+09:00", "image": { "mime_type": "image/jpeg", "base64": "..." } },
    { "timestamp": "2026-11-04T21:00:08.000+09:00", "image": { "mime_type": "image/jpeg", "base64": "..." } }
  ],
  "memory_kind": "fsm",
  "memory": { "initial_state": "drinking", "states": [ ... ] },
  "tasks": ["컵 치우기", "사용자에게 물어보기"],
  "evidence": [
    {
      "kind": "cup_contents", "value": "empty", "certain": true,
      "timestamp": "2026-11-04T21:00:07.400+09:00", "source": "request_answer_photo",
      "image": { "mime_type": "image/jpeg", "base64": "..." }
    }
  ]
}
```

- **`frames`:** 정확히 5장, 시각이 2초씩 늘어난다. 시각은 2초 격자의 이름 시각이고, 실제 사진은 그 자리 ±0.5초 안에서 고른다. 시간대가 꼭 있다. PAM `_frame_content(frames, 5, stride=2)` 규칙과 같고, 좌우 두 장이 아니라 한 장이다.
- **`memory`:** PAM `validate_memory(memory, "fsm")` 모양이다. 지금은 임시 컵 기억 `CUP_FSM_MEMORY`(`src/brain/decision.ts`)를 보낸다: `drinking` → `left_cup`. 실제 기억은 PAM 반성기가 만든 것을 쓴다.
- **`tasks`:** 순서가 있는 작업 목록이다. `task_index`가 이 순서를 가리킨다.
- **`evidence`(새로 더함):** 5장 격자 밖의 근거다. 지금은 컵 안(`cup_contents`)만 보낸다.
  - `value`: `empty`(빈 컵) / `not_empty`(음료 남음)
  - `source`: `request_answer_photo`(폰 요청 답 사진) / `scene_frame`(장면 사진)
  - VLM이 확신했을 때만 보낸다. 사진이 5장 격자에 들지 않으면 PAM이 컵 안을 알 수 없어서 따로 보낸다. 근거가 없으면 빈 배열이다.

## 답

HTTP 200, PAM `parse_prediction` 결과 그대로:

```json
{
  "status": "valid",
  "raw_response": "{\"observation\": \"...\", \"reasoning\": \"...\", \"task_index\": 0}",
  "prediction": { "observation": "...", "reasoning": "...", "task_index": 0 },
  "selected_action": "컵 치우기",
  "errors": []
}
```

- 원문(`raw_response`)을 고치지 않고 그대로 준다. 우리 쪽이 원문을 다시 검사해, `prediction`·`selected_action`이 원문과 다르면 실패로 본다.
- 형식이 틀린 답은 `status: "invalid"`, `prediction: null`, `errors`에 이유를 담는다. **invalid는 대기(−1)와 다르다.** 우리 쪽은 판단 실패로 기록하고 아무것도 하지 않는다.
- 요청이 계약에 맞지 않으면 HTTP 400 `{ "error": "..." }`를 준다(사진 수·간격·시간대·기억 모양).
- 제한 시간은 기본 20초다(`PAM_TIMEOUT_MS`). 넘기면 판단 실패다.

## 박석준과 정할 것

1. 한 카메라 버전의 프롬프트에 `evidence`를 어떻게 넣을지. 이미지로 붙일지, 글로 붙일지, 둘 다일지.
2. FSM 기억의 언어. PAM 예시는 영어이고, 지금 임시 기억과 작업 이름은 한국어다.
3. 서버를 띄울 곳과 키. OpenRouter `qwen/qwen3.5-27b`, `OPENROUTER_API_KEY`가 필요하다.
4. 작업 목록 확정. 지금은 `컵 치우기`, `사용자에게 물어보기` 두 개다.

## 시험

- 모의 PAM 서버: `npx tsx scripts/pam-mock-server.ts --port 8300`. 이 계약대로 요청을 검사하고 규칙으로 답한다: 근거가 빈 컵이면 컵 치우기, 음료가 남았으면 대기, 근거가 없으면 물어보기.
- 두뇌를 모의 PAM에 붙이기: `BRAIN=1 BRAIN_DECISION=pam PAM_URL=http://127.0.0.1:8300/predict`
- 시험 코드: `tests/brain-pam.test.ts`
