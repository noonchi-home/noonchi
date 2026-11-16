# 생각 말풍선 두 줄·미니맵 줄이기 Implementation Plan

> **For agentic workers:** 아래 차례대로 TDD로 한다(실패하는 시험 확인 → 구현 → 통과). 체크박스(`- [ ]`)로 진행을 적는다.

**Goal:** PAM이 행동을 고른 판단의 생각을 작은 모델로 「본 것」·「그래서」 두 줄로 고쳐 대시보드 생각 말풍선에 보이고, 말풍선을 키운 만큼 미니맵을 줄인다.

**Architecture:** 서버 `src/brain/thought.ts`가 판단 기록을 낸 뒤 따로 모델을 부르고(판단·계획은 기다리지 않음), 두 줄이 오면 `/events`에 `{type:"thought", id, seen, why}`를 보낸다(기록 DB에는 넣지 않음, 접속 때 다시 보냄). 모델은 VLM과 같은 OpenAI 호환 통로(`src/infer/`)에 모델 이름만 `THOUGHT_MODEL`(mock `gpt-5.4-nano`, live `vlm`)로 바꿔 보낸다. 대시보드는 판단 id가 같은 두 줄만 쓰고, 없으면 원래 생각을 보인다.

**Tech Stack:** TypeScript(Node 서버), React+Vite(ui), vitest, 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`).

**Spec:** 사용자 요청 「PAM 생각을 읽기 좋은 형태로 가공하고, 미니맵을 줄이고, 말풍선 크기를 키우자」(2026-11-16)와 그 작업 지시.

## Global Constraints

- 화면 부품은 21st.dev 받은 코드만(ThoughtBubble·Status). 화면 코드는 배치만, 꾸밈 class 없음. 글 크기는 부품 원래 크기(text-sm·text-xs).
- 말풍선 크기는 고정이다. 단계·생각이 바뀔 때 움직이는 것은 transform·opacity만.
- mock·live는 같은 구조. 시험의 모델은 같은 주소 자리에 붙는 가짜 서버.
- 도메인 의존 표(`scripts/lint-domains.ts`): brain은 infer·contract·shared만 더 쓴다.
- 바깥 글을 자를 때는 `headWithin`.
- 원래 reasoning은 판단 기록에 그대로 남는다.

### Task 1: 생각 모델 주소

**Files:** Modify `src/infer/endpoints.ts`, `src/infer/inference.ts`, `.env.example`, `compose.yaml`, `src/server/start.ts`. Test `tests/infer-endpoints.test.ts`.

**Produces:** `VlmEndpoint.thoughtModel: string`, `createInference(env).thought: OpenAICompatClient`.

- [ ] 실패 시험: mock `thoughtModel`은 `gpt-5.4-nano`, live는 `vlm`, `THOUGHT_MODEL`이 있으면 그 이름. `createInference().thought`가 VLM 주소에 그 모델로 보낸다.
- [ ] 구현 → 통과.

### Task 2: 두 줄 쓰기와 보내기(`src/brain/thought.ts`)

**Files:** Create `src/brain/thought.ts`, `tests/helpers/thought.ts`, `tests/brain-thought.test.ts`. Modify `src/brain/index.ts`, `src/contract/events.ts`, `scripts/fake-openai.ts`.

**Produces:** `ThoughtWriter.write({observation, reasoning, action}): Promise<ThoughtLines|null>`, `thoughtFeed({writer, send}): { decision(e), last() }`, 계약 `ThoughtEvent { type:"thought"; id; seen; why }`.

- [ ] 실패 시험: 가짜 서버 답으로 두 줄, 요청은 글만(사진 없음)·스키마 `thought_lines`, 같은 생각은 한 번만 부름(동시에 와도), 실패·늦음·영어 낱말이면 null이고 실패는 기억하지 않음, 따옴표는 뺌. feed는 대기·실패 판단에 보내지 않고, 늦게 온 앞 판단의 두 줄은 버리고, 판단 처리가 모델 답을 기다리지 않는다.
- [ ] 구현 → 통과.

### Task 3: 서버 연결

**Files:** Modify `src/server/home.ts`, `src/server/app.ts`. Test `tests/noonchi-e2e.test.ts`.

- [ ] 실패 시험: 모델 답을 붙잡아 둔 동안에도 첫 명령이 나가고, 놓으면 대시보드에 판단 id의 두 줄이 온다. 새로 붙은 대시보드는 판단 다음에 두 줄을 replay로 받는다. 기록 DB 판단 줄의 reasoning은 원래 글이다.
- [ ] 구현 → 통과.

### Task 4: 대시보드 자료·말풍선·배치

**Files:** Modify `ui/src/lib/messages.ts`, `ui/src/dashboard/data.ts`, `ui/src/dashboard/ThoughtCard.tsx`, `ui/src/dashboard/words.ts`, `ui/src/dashboard/layout.ts`, `scripts/twin3d/fake-run.ts`(→ `ui/src/dashboard/fake-run.json`). Test `ui/tests/dashboard/{data,layout,screen,steps,wiring}.test.*`.

- [ ] 실패 시험: 판단 id가 같은 두 줄만 생각에 붙음(hello면 지움). 두 줄이면 「본 것」·「그래서」 이름표 칩과 줄마다 두 줄 높이에서 자르고, 없으면 원래 생각을 네 줄 높이에서 자름. 말풍선 420×156 고정. 원래 생각 → 두 줄은 opacity·transform으로만 바뀜. 미니맵 너비 340/1280, 1920×1080·1440×900 겹침 없음.
- [ ] 구현 → 통과.

### Task 5: 문서·전체 검증·화면 확인·커밋

- [ ] `docs/reference.md` 환경 변수 표·대시보드 줄·`/events` 설명.
- [ ] `npm run lint`, `npm test`(heavy), `npm run ui:build`, 헤드리스 크롬 1920×1080 사진.
- [ ] 내 파일만 `git add <파일>` 후 커밋(푸시 안 함).
