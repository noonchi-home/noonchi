# PAM (판단·반성)

판단(predict)과 반성(reflect)을 서버 안 함수로 해요. 예전 Python PAM 서비스를 옮긴 TypeScript예요. 출처는 `PROVENANCE.md`·`THIRD_PARTY.md`에 있어요.

- 부르는 길: `PamClient`(`client.ts`) → 요청 모양 검사(`request.ts`) → 메시지 만들기(`prompt.ts`) → 문맥 길이 검사(`budget.ts`) → PAM LLM 한 번(`llm.ts`) → 답 검사(`answer.ts`).
- PAM LLM은 `INFERENCE_MODE`가 골라요: `openai`(개발, OpenAI `gpt-5.4-mini`, `OPENAI_API_KEY`) · `vllm`(AWS 같은 서버 vLLM `http://vllm-pam:8000/v1`, 모델 이름 `pam`). 시험은 가짜 LLM 서버를 써요.
- OpenRouter 길은 2026-11-17에 뺐어요.

## 어디를 고치면 무엇이 바뀌나요

| 바꾸고 싶은 것 | 고칠 파일 | 같이 볼 시험 |
|---|---|---|
| 프롬프트 글(논문 원문) | `prompts/paper/*.txt` + `prompts/source_map.json`의 `sha256` | `tests/pam-prompts.test.ts`, `tests/pam-golden.test.ts` |
| 프롬프트 글(노닌치용 바꾸기) | `scenarios/noonchi/scenario.json`의 `prompt_replacements` | `tests/pam-prompts.test.ts`, `tests/pam-scenario.test.ts`, `tests/pam-golden.test.ts` |
| 판단·반성 메시지 만들기 | `prompt.ts` | `tests/pam-request.test.ts`, `tests/pam-golden.test.ts` |
| 요청 모양(칸·글 길이·시각 꼴) | `request.ts` | `tests/pam-request.test.ts` |
| 답 검사 | `answer.ts`, `pyjson.ts` | `tests/pam-answer.test.ts`, `tests/pam-golden.test.ts` |
| 문맥 길이·입력 한도 | `budget.ts` | `tests/pam-budget.test.ts` |
| 모델·주소·전송 칸·사용량 | `llm.ts`, `settings.ts`, `config/transport.json`, `src/infer/endpoints.ts`(모드별 주소) | `tests/pam-llm.test.ts` |
| 판단 부르기(언제·무엇을 넘기나) | `src/brain/decide.ts` | `tests/world-decide.test.ts`, `tests/brain-pam.test.ts` |
| 기억 모양(사람 상태 FSM: 상태·화살표)·seed 기억·후보 FSM 검사 | `src/brain/decision.ts` | `tests/brain-decision.test.ts`, `tests/pam-answer.test.ts` |
| 판단 답(`pam-predict/3`: state·from·next_index → 서버가 행동을 정함) | `answer.ts`, `src/brain/decide.ts` | `tests/pam-answer.test.ts`, `tests/world-decide.test.ts` |
| 밤 흐름(덩어리 기록 → 반성 → 검사 → 시각 찾기 → 채택 검사 → 저장) | `src/brain/history/night.ts`, `night.ts`(메시지), `marks.ts`, `adopt.ts`, `memoryCheck.ts`, `scenarios/noonchi/chunking.txt`·`marking.txt`·`memory_check.txt` | `tests/history-night.test.ts`, `tests/pam-adopt.test.ts`, `tests/pam-marks.test.ts`, `tests/pam-memory-check.test.ts` |
| 기억 판본·습관 거르기 | `src/brain/history/reflect.ts`, `src/brain/history/habits.ts` | `tests/history-reflect.test.ts`, `tests/history-habits.test.ts` |
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
2. 메시지·전송 바이트·토큰 추정·입력 한도(`limits.json`)가 바뀌므로 `tests/pam-golden.test.ts`도 실패해요. `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 한꺼번에 쓰고, `git diff tests/fixtures/pam-golden`로 바뀐 글을 확인한 뒤 같이 커밋해요.
3. 프롬프트 파일은 LF 줄끝이어야 해요(`.gitattributes`가 고정해요).
