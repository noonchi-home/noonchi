# PAM decision and reflection interface

`PamClient` runs inside the NOONCHI server. It sends the model timestamped observation text produced by World State. Camera images are processed by the observation pipeline. For prompt sources, settings, and regression tests, see the [PAM implementation guide](../src/brain/pam/README.md).

## Prediction — `PamClient.predict` (`pam-predict/3`)

In periodic mode the server schedules decisions while the phone supplies engine frames. The default interval is one second for nano and mini models and five seconds for other models. `PAM_PERIOD_MS` overrides the interval. Event mode uses meaningful World State changes. The observation text contains the latest events, ongoing facts, local date and time, and the phone's room. The following example uses the actual Korean observation format. `PamClient` adds the contract identifier.

```json
{
  "final_time": "2026-11-07T21:00:08.000+09:00",
  "observation_text": "21:00:01 사람 보임\n21:00:01 컵 cup_1 보임\n21:00:02 VLM: 사람이 식탁 옆에 서 있고 컵이 식탁 위에 있다\n21:00:02 사람 서 있음\n21:00:02 컵 cup_1 식탁 위\n21:00:04 사람 안 보임\n21:00:04 VLM: 식탁 위에 빈 컵이 있다\n[지속] 컵 cup_1 자리 모름: 21:00:00부터 8초째, 마지막 확인 21:00:04\n[지속] 컵 cup_1 식탁 위: 21:00:02부터 6초째\n[지속] 컵 cup_1 비어 있음(짐작): 21:00:04부터 4초째\n[지속] 사람 안 보임: 21:00:04부터 4초째\n[때] 11월 7일 토요일 밤\n[눈] 클로이드 눈: 주방",
  "memory_kind": "fsm",
  "memory": {
    "initial_state": "away",
    "states": [
      {"id":"away","description":"Nobody is in view.","activity":[],"next":[{"to":"drinking","on":"The person starts drinking."}]},
      {"id":"drinking","description":"The person is drinking.","activity":["drinking"],"next":[{"to":"away","on":"The person leaves.","action":"컵 치우기"}]}
    ]
  },
  "tasks": ["컵 치우기", "사용자에게 물어보기"],
  "last_state": "drinking"
}
```

- An FSM state has an `id`, `description`, `activity`, and `next` transitions of the form `{ to, on, when?, action? }`. A destination may be a state ID or `"*"`. The initial state is `away`.
- `last_state` is the previous decision's state, or `null` at startup. While an action is pending, its source state can be held for up to 15 seconds.
- A response includes `observation`, `reasoning`, `state`, `from`, and `next_index`. For example, `{"observation":"…","reasoning":"…","state":"away","from":"drinking","next_index":0}` identifies the first transition out of `drinking`.
- An unlisted activity uses a temporary state prefixed with `~`. A transition must leave the previous state, or the initial state when `last_state` is null. With `next_index: -1`, `from` may be null or the previous state. Named destinations must match `state`. A wildcard can fire when leaving its source state. Temporary states have no outgoing transitions.
- The server maps the selected transition to an available task. If no action applies, it waits (`task_index: -1`). In list-memory mode the model returns `task_index` directly. Execution rechecks the target and conditions before the first command.
- Prompt timestamps use ISO format with an explicit time zone, for example `2026-11-07T21:00:08+09:00`.

## Reflection — `PamClient.reflect` (`pam-reflect/3`)

Inputs are `day`, `memory_kind`, `memory`, `observation_text`, `action_summary`, and optional feedback. For `fsm_candidates`, reflection proposes a candidate FSM with `initial_state` and `states`. States contain activity transitions and rules of the form `{ to, action, candidates: [{ on, when? }] }`. Statistical adoption checks determine which learned triggers enter the executable FSM. The process preserves user-defined habits. With list memory, the request uses `memory_kind: "list"` and the reply is a new rules list.

| Nightly operation | Prompt file | Result |
|---|---|---|
| `checkMemory` | `memory_check.txt` | Checks the meaning of states, conditions, and merges. On rejection the server retries reflection once with feedback. |
| `chunk` | `chunking.txt` | Returns ordered, non-overlapping `{ start, end, text }` activity chunks using timestamps from that day's records. |
| `mark` | `marking.txt` | Returns trigger times, action times, and intervals when the person could not be seen. |

An adopted memory takes effect the following day. Each day's decisions use the version pinned for that day.

## Input limits and errors

`PamClient.limits()` returns `max_model_len`, `predict_input_bytes`, and `reflect_input_bytes`. The byte budgets cover dynamic prompt content: observations, action summaries, feedback, and serialized memory. Prediction accepts up to 20,000 observation characters. Reflection caps observations at 100,000, summaries at 50,000, and feedback at 8,000. Both interfaces reject photo fields and inline image data before contacting the model.

| Error | Meaning |
|---|---|
| `PamRequestError` | Input validation failed, for example an unknown field, invalid memory, missing time zone, or excessive text length. |
| `PamBudgetError` | The estimated input plus the output allowance exceeds the model's context window. |
| `PamAnswerError` | The model returned an answer that violates the contract. A valid decision to wait is distinct from this error. |
| `PamLinkError` | Connection failure, HTTP error, timeout, malformed transport response, or a truncated completion. |

The first three extend `ContractError`. `INFERENCE_MODE` selects OpenAI or vLLM. `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL`, and `PAM_LLM_API_KEY` override the endpoint settings. The GPU deployment serves the PAM model as `pam`.

The transport uses non-streaming requests and does not retry a completion. Its output allowances are 2,048 tokens for prediction and 16,384 for reflection. `PAM_LLM_TIMEOUT_S` defaults to 120 seconds including the response body. Prediction also observes `PAM_TIMEOUT_MS` (default 30,000 ms). Records can include usage even for invalid or truncated completions: model, prompt tokens, completion tokens, cached tokens, and cost in USD when a price is available.

## Reproducibility

The original paper prompts remain in `src/brain/pam/prompts/paper/`. Scenario-specific changes are defined in `src/brain/pam/scenarios/noonchi/scenario.json`. The golden fixtures compare the Node implementation with messages, transport payloads, and validation results from the original Python implementation. Additional tests cover request limits, text-only input, memory validation, marking, statistical adoption, reflection, and nightly persistence.
