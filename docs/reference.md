# twin-home 상세 설명

> 2026-10-11 기준 상세 문서다(예전 README). 이후 바뀐 점: 웹 화면의 기기 카드는 기본으로 숨기고 헤더의 "기기 카드" 버튼으로 연다. 조명을 켜고 끌 때 화면이 멈추던 문제는 twin-studio 뷰어가 광원을 미리 만든 풀에서 빌려 쓰도록 바꿔 해결했다([twin-studio apartment/README.md](https://github.com/2026-SWE/twin-studio/blob/main/apartment/README.md)).

twin-studio가 만든 아파트 트윈의 가전 65개를 **가상 Matter 기기**(matter.js 브리지)로 띄우고, 에이전트(LLM)에게 한국어로 요청해 켜고 끈다. 상태의 원천은 Matter 속성이고, 바뀐 상태는 웹 화면(WebSocket)과 **3D 트윈**(twin-studio 뷰어)에 실시간으로 반영된다. 3D 트윈에서 바꾼 상태도 승인 정책을 거쳐 twin-home으로 돌아온다.

계약 문서는 [`docs/plan.md`](plan.md)다. 인터페이스·형식을 바꾸려면 그 문서를 먼저 고친다.

![웹 화면: 기기 카드 | 3D 트윈 | 대화. "거실 불 켜고 TV 켜줘" 뒤](screenshot-3d.png)

*`npm start`(허브 matter · network)로 띄우고 헤드리스 Chrome으로 채팅에 "거실 불 켜고 TV 켜줘"를 입력해 찍었다. 가운데 3D 트윈(`/twin/viewer/?live=auto&embed=1`)에서 거실 TV 화면이 켜지고 "거실 TV 켜짐·거실 천장등 켜짐·플로어 스탠드 켜짐" 배지가 뜬다. 위쪽 칩은 뷰어의 실시간 연결 상태다.*

![웹 화면: "거실 불 켜고 TV 꺼줘" 뒤 거실 카드](screenshot.png)

*`npm start`(허브 matter · network)로 띄운 화면이다. 채팅에 "거실 불 켜고 TV 꺼줘"를 보내면 거실 천장등·플로어 스탠드가 켜지고(`onOff=true`) 거실 TV가 꺼진다(`onOff=false`). 헤드리스 Chrome으로 실제 클릭·입력해 찍었다.*

## 빠른 시작

Node 22.15. 트윈 결과물(뷰어·집·카탈로그)은 저장소 `twin/`에 있다. twin-studio에서 집을 다시 빌드했으면 `npx tsx scripts/twin-assets.ts --from <twin-studio 폴더>`로 `twin/`을 다시 채운다(`twin/SOURCE.json`에 twin-studio 커밋과 파일 sha256이 남는다).

```bash
npm install
npm --prefix ui install # 화면(React) 패키지
cp .env.example .env    # 키는 .env에만 넣는다(git에 올리지 않음). 에이전트는 OPENAI_API_KEY 또는 ANTHROPIC_API_KEY
npm start               # 화면을 빌드하고 http://127.0.0.1:8200  (허브 matter, network 전송)
```

서버 배포(AWS GPU 서버 한 대, `compose.yaml`, Tailscale)는 [`docs/deploy.md`](deploy.md)를 따른다. 이미지 확인: `docker build -t noonchi:check .` 뒤 `npx tsx scripts/container-smoke.ts`(키 없이 127.0.0.1:8500·8510에 띄워 보고 지운다).

브라우저로 <http://127.0.0.1:8200/>을 열고 채팅에 "거실 불 켜고 TV 꺼줘", "에어컨 24도로 맞춰줘", "현관문 열어줘"(승인 후 실행)를 입력한다. 가운데 3D 트윈에 바로 보인다(아래 "3D 트윈 연결").

## 구조

```
src/                    도메인 폴더(구현명세서 구성 단위, 도메인 나누기 설계 2.1). 다른 도메인은 index.ts(또는 browser.ts) 입구로만 가져온다
  contract/             공용 타입만(devices.ts: DeviceSpec·DeviceState·Command·DeviceHub, events·plan·phone·world 등)
  shared/ · infer/ · design/   공용 도우미, 외부 API 통로, 디자인 토큰(기반층)
  devices/              가상 가전·ThinQ: kinds.ts(가전 종류 등록부), mapping.ts(twin ↔ Matter 매핑), devices.ts(가전 만들기),
                        hub/(MemoryHub·SignalHub), matter/(MatterHub, 아래 "Matter"), thinq/
  layout/               배치 저장소: twin-files.ts(twin-studio 데이터 읽기 loadTwin), scene.ts, editor.ts(배치 보정), route.ts(경로 찾기)
  world/                World State(state/: world.ts 겉 클래스, core.ts 안쪽 공유 객체 WorldCore, objects·people·facts·closer·devices)와 PAM 관찰 텍스트(vocab.ts 낱말 표)
  phone/                실제 폰 서버·눈, sync/(위치 맞추기)
  observe/              관찰 흐름(YOLO 감지·VLM)
  brain/                pam/(PAM 판단·반성, 논문 프롬프트), history/(기록·반성)
  agent/                도구 호출 루프(agent.ts), 도구(tools.ts), 기기 찾기, 승인 정책(policy.ts), 공급자(providers/), 계획 모드(planTools.ts, 단계 규칙 plan-rules.ts), mcp/(MCP stdio 서버·REST 백엔드)
  act/                  판단·검사·실행 추적(track/: tracker.ts 겉 클래스, core.ts 안쪽 공유 객체 TrackCore, start·steps·approval·safety·answers·coach·use·goal)
  server/start.ts       시작 순서: twin 데이터 → 허브(대체 경로 포함) → 정책·에이전트 → HTTP/WS
  server/home/          집 하나의 실행 묶음: index.ts 조립·닫기 차례, core.ts 안쪽 공유 객체 HomeCore, devices·agent·phone·act·observe·say 도메인별 잇기
  server/hubFactory.ts  HUB 고르기, startHub(network 실패 → local → memory)
  server/app.ts         HTTP + WebSocket + 정적 파일. API 경로는 server/routes/(도메인별)
  server/main.ts        npm start 진입점(.env, 출력, 종료 신호)
ui/                     대시보드·설정·폰 화면(React+TypeScript, 빌드 결과 ui/dist/): ui/src/dashboard·twin(3d/)·phone·setup, 화면 공용 lib/·components/ui/
scripts/demo.ts         npm run demo
scripts/scenarios.ts    데모 시나리오(데모와 e2e 테스트가 함께 씀)
scripts/matter-smoke.ts Matter 연기 시험
tests/                  vitest (helpers/: 작은 집, REST·WS·MCP 도우미)
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm start` | 화면 빌드(`npm run ui:build`) 뒤 서버 실행(기본 포트 8200, 허브 matter/network). Ctrl+C로 정상 종료 |
| `npm run dev` | 화면 빌드 뒤 서버 실행 + 서버 파일이 바뀌면 재시작 |
| `npm run ui:dev` | 화면 개발 서버(5173, API는 8200으로 넘김) |
| `npm test` | vitest 전체(단위 + Matter 통합 + e2e, 실제 커미셔닝 포함) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` | 임의 포트에 서버(matter/local)를 띄워 시나리오 5개(6단계)를 REST·WS로 돌리고 표를 찍는다. 에이전트는 셸의 키로 실제 LLM을 부른다. 모두 통과면 종료 코드 0 |
| `npm run mcp` | MCP stdio 서버(실행 중인 서버의 REST를 부른다) |
| `npx tsx scripts/matter-smoke.ts` | Matter만: 커미셔닝 → 거실 TV·천장등 토글 → 상태 출력 |
| `npx tsx scripts/fake-openai.ts --port 8500` | 가짜 OpenAI 호환 서버(정해진 답, 밖으로 나가지 않음). 첫 줄에 `listening <포트>`. 모델 주소 자리(`VLM_BASE_URL`, `PAM_LLM_BASE_URL`, `OPENAI_BASE_URL`)에 `http://127.0.0.1:8500/v1`로 붙인다 |
| `npx tsx scripts/container-smoke.ts` | 키 없는 컨테이너 확인(noonchi·pam·가짜 서버, `docs/deploy.md` 7절) |

```bash
HUB=memory npm start                     # Matter 없이(빠름)
MATTER_TRANSPORT=local npm start         # Matter 데이터 모델은 쓰되 네트워크 없이
MATTER_TRANSPORT=network npm run demo    # 데모를 실제 커미셔닝으로(임시 저장 폴더·임의 포트)
HUB=memory npm run demo
```

## 환경 변수 (`.env.example`)

### main 합친 뒤 바꿀 것(옛 .env)

옛 값으로도 서버는 뜬다(막는 것은 PAM 값 둘뿐). 시작 로그의 `[경고]` 줄이 남은 옛 값을 알려 준다.

| 옛 값 | 지금 | 할 일 |
|---|---|---|
| `INFERENCE_MODE=mock` | `openai`로 읽고 시작 로그에 경고 | `openai`로 바꾸기 |
| `INFERENCE_MODE=live` | `vllm`으로 읽고 시작 로그에 경고 | `vllm`으로 바꾸기 |
| `ENGINE_FRAME_MS=2000`(1000 이상, `VLM_FRAME_MS` 없음) | VLM 간격으로 읽고 YOLO 프레임 간격은 기본 100ms, 시작 로그에 경고 | `VLM_FRAME_MS=2000`으로 옮기고 `ENGINE_FRAME_MS` 지우기 |
| `PAM_URL`·`PAM_LLM_PROVIDER`·`OPENROUTER_API_KEY` | 읽지 않음(PAM은 서버 안 `src/brain/pam/`) | 지우기 |
| `PAM_LLM_BASE_URL`=OpenRouter 주소 | 부르지 않고 PAM 준비 안 됨(`/api/health` `ready.pam.reason`), 시작 로그에 경고 | 지우기(openai는 `OPENAI_API_KEY`로 OpenAI를 부른다) |
| `PAM_LLM_MODEL`=OpenRouter 모델 이름 | 그 이름을 그대로 보낸다 | 지우기 |
| `PAM_MAX_MODEL_LEN` 16384 이하 | 시작을 막고 까닭과 맞는 값을 한 줄로 알린다 | 지우기(기본 32768) |
| `PAM_LLM_TIMEOUT_S` 0 이하 | 시작을 막고 까닭과 맞는 값을 한 줄로 알린다 | 지우기(기본 120초) |
| `THOUGHT_MODEL` | 읽지 않음(메시지 상자는 모델 없이 만든다) | 지우기 |
| (새) `REDIS_URL` | 있으면 Redis 통로, 없으면 메모리 통로 | compose는 `redis://redis:6379` |

### 변수

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `AGENT_PROVIDER` | (자동) | `openai` / `anthropic`. 비우면 `ANTHROPIC_API_KEY`가 있으면 anthropic, 없으면 openai. 키가 없어도 다른 공급자로 바꾸지 않는다: 시작 로그에 경고, 에이전트는 준비 안 됨(`/api/health` `ready.agent`)이고 대화가 실패한다 |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | `gpt-5.5`, `https://api.openai.com/v1` | OpenAI(Responses API). 시험·키 없는 확인은 `OPENAI_BASE_URL`을 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`)에 붙인다 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-opus-5-5` | Anthropic(Messages API) |
| `ANTHROPIC_EFFORT` | `low` | `low`…`max` |
| `ANTHROPIC_FALLBACKS` | (켬) | `off`면 서버 측 거절 대체를 끈다 |
| `TWIN_STUDIO_DIR` | `twin/` | 트윈 결과물 폴더(상대 경로는 실행 위치 기준) |
| `HOME_ID` | `homes.json`의 `default` | 불러올 집(twin-studio `homes.json`의 id, 예: `oneroom`) |
| `RUNTIME_DIR` | `runtime` | 실행 중 만든 파일의 바탕 폴더: 배치 수정본 `homes/<id>/edits.json`, 외부 연락 받는 이 `homes/<id>/contacts.json`·다시 보내기 기억 `homes/<id>/service-retry.json`(아래 「외부 연락」), 사진 `photos/`, 기록 DB `noonchi.db`(SQLite, 커밋하지 않음), 서버 잠금 `server.lock.db`(아래 「시작 순서」 0) |
| `HISTORY_TZ_MINUTES` | `540` | 기록 DB가 날짜(하루 요약·반성)를 나누는 시간대(분, -720~840). PAM 관찰 텍스트 시각도 이 시간대다. 틀린 값이면 시작하지 않는다 |
| `REFLECT_AT` | `23:30` | 매일 그날을 반성하는 시각(HH:MM, 기록 시간대). `off`면 끈다. 틀린 값이면 시작하지 않는다 |
| `PHOTO_RETENTION_DAYS`, `DATASET_RETENTION_DAYS` | `7`, `7` | 폰 사진 찍기 사진·시험 자료 보관 일(0보다 큰 숫자). 지나면 파일과 표 줄을 지운다. 틀린 값이면 시작하지 않는다 |
| `DATASET_COLLECT` | (끔) | `1`이면 엔진 프레임을 시험 자료로 `RUNTIME_DIR/dataset/<날짜>/`에 JPEG과 같은 이름의 `.json`(크기·자세·카메라)으로 쓴다 |
| `INFERENCE_MODE` | `openai` | `openai`(개발, VLM·PAM LLM 모두 OpenAI API) · `vllm`(GPU 서버, VLM은 같은 서버 vLLM `http://vllm-vlm:8000/v1`의 `vlm`, PAM LLM은 `http://vllm-pam:8000/v1`의 `pam`). 두 모드는 같은 코드 경로이고 주소·모델 이름·제공자 칸만 다르다. 예전 이름 `mock`은 `openai`로, `live`는 `vllm`으로 읽고 시작 로그에 경고 한 줄을 남긴다. 다른 값이면 시작하지 않는다 |
| `VLM_BASE_URL`, `VLM_MODEL`, `VLM_API_KEY`, `VLM_EXTRA_BODY` | 모드 기본값 | 따로 주면 모드 기본값 대신 쓴다(OpenAI 호환 주소). openai 기본: `https://api.openai.com/v1`·`gpt-5.4-mini`·`OPENAI_API_KEY`·`{"reasoning_effort":"none"}`, vllm 기본: `http://vllm-vlm:8000/v1`·`vlm`·`VLLM_API_KEY`·`{}` |
| `VLM_CLOSER_MODEL` | `VLM_MODEL`과 같음 | 가까이 보기 VLM 모델 이름. 같은 VLM 주소·키·요청 칸에 모델 이름만 바꿔 보낸다. 비용은 그 모델 가격으로 세고, 가격표(`src/infer/cost.ts`)에 없으면 모름 |
| `VLM_TIMEOUT_MS` | `20000` | 사진 한 장 VLM 분석 제한 시간(1000 이상) |
| `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL`, `PAM_LLM_API_KEY` | 모드 기본값 | 서버(`src/brain/pam/`)가 판단·반성에 부르는 PAM LLM(OpenAI 호환 주소). openai 기본: `https://api.openai.com/v1`·`gpt-5.4-mini`·`OPENAI_API_KEY`, vllm 기본: `http://vllm-pam:8000/v1`·`pam`·`VLLM_API_KEY` |
| `PAM_LLM_TIMEOUT_S`, `PAM_MAX_MODEL_LEN` | `120`, `32768` | PAM LLM 한 번 제한 시간(초), 문맥 길이(vLLM `--max-model-len`과 같은 값, 반성 출력 16384보다 커야 한다). 입력이 넘으면 LLM에 보내지 않고 판단 실패(`PamBudgetError`) |
| `PHONE_PORT`, `PHONE_HOST` | (끔), `0.0.0.0` | 폰 AR 서버(아래 "폰 AR") |
| `PHONE_URL` | (없음) | 폰에서 열 주소. 대시보드 QR에 맨 앞 주소가 나온다. 없으면 `tailscale serve`가 폰 포트로 잇는 https 주소, 그다음 와이파이 주소 |
| `PHONE_LAN_URLS` | `1` | `0`이면 폰 주소에 이 기계의 네트워크 주소(와이파이)를 넣지 않는다. compose는 `0`으로 둔다(컨테이너 안 주소는 밖에서 열 수 없다). 그때 폰 주소는 `PHONE_URL`뿐이다 |
| `PHONE_PHOTO_DIR` | `RUNTIME_DIR/photos` | 사진 폴더 |
| `PHONE_VIDEO_DIR` | 저장소 `runtime/videos`(컨테이너는 `/data/videos`) | 영상 모드 영상 폴더. `RUNTIME_DIR`(시연 폴더 포함)와 상관없이 이 폴더 하나에서 읽는다 |
| `BRAIN` | (끔) | `1`이면 폰 엔진 프레임으로 관찰 흐름(아래 "관찰 흐름")을 돌린다. `PHONE_PORT`가 있어야 한다. VLM·PAM LLM은 `INFERENCE_MODE`가 고른 주소로 부른다(openai는 `OPENAI_API_KEY`) |
| `ENGINE_FRAME_MS` | `100` | 엔진 프레임 간격(50 이상). 폰 서버가 상태 메시지로 폰에 알린다. 모든 엔진 프레임에 YOLO를 돌린다. `VLM_FRAME_MS` 없이 1000 이상이면 옛 뜻(VLM 간격)으로 읽고 YOLO 프레임 간격은 100이다(시작 로그에 경고) |
| `VLM_FRAME_MS` | `2000` | VLM 프레임 간격(`ENGINE_FRAME_MS` 이상). 앞 VLM 프레임보다 이만큼 뒤에 찍힌 엔진 프레임 한 장만 VLM·기록·가까이 보기에 쓴다(2초면 VLM 시간당 약 1,800번). 안 주고 `ENGINE_FRAME_MS`만 2초보다 길게 주면 그 값을 따른다. `ENGINE_FRAME_MS=2000 VLM_FRAME_MS=2000`이면 프레임마다 VLM을 부르던 옛 동작이다 |
| `VLM_WINDOW_FRAMES` | `5` | VLM 한 번에 보내는 최근 VLM 프레임 수(1~10, 그 프레임 포함). 오래된 것부터 보내고 장마다 촬영 시각(「t-8s」 … 「t-0s (latest)」)을 붙인다. 창 시간은 이 수 × `VLM_FRAME_MS`(기본 10초)이고 그보다 앞선 프레임은 넣지 않는다. 틀린 값이면 시작하지 않는다 |
| `VLM_MAX_INFLIGHT`, `DETECT_QUEUE_MAX` | `4`, `8` | VLM 동시 요청 상한(넘친 프레임은 「요청이 몰려 VLM 분석 없음」), YOLO 대기열 상한(넘친 VLM 프레임은 「요청이 몰려 YOLO·VLM 분석 없음」. 빠른 프레임은 대기열에 2장만 두고 오래된 것부터 기록 없이 버린다, `/api/brain`의 `skipped`). 틀린 값이면 시작하지 않는다 |
| `BRAIN_YOLO_PATH`, `BRAIN_POSE_PATH`, `BRAIN_YOLO_THREADS` | `models/yolo26s-seg.onnx`, `models/yolo26n-pose.onnx`, `8` | 감지(YOLO26s-seg)·관절(YOLO26n-pose) 모델 파일을 직접 줄 때, CPU 추론 스레드 수. 감지 모델 파일이 없으면 VLM만, 관절 모델 파일이 없으면 감지만 쓴다 |
| `BRAIN_YOLO_PROVIDER` | `auto` | YOLO 실행 장치: `auto`(Windows는 DirectML, 안 되면 CPU. 그 밖에는 CPU) · `dml` · `cpu`. `dml`·`cpu`로 정하면 그 장치만 쓰고 못 만들면 YOLO 없이 VLM만 쓴다. 다른 값이면 시작하지 않는다. 붙은 장치는 시작 글과 `/api/brain`의 `provider`에 나온다 |
| `BRAIN_POSE_EVERY` | `3` | 사람이 이어서 보이는 동안 관절 모델을 몇 장에 한 번 돌릴지(1 이상 정수). 사람이 다시 보인 첫 장은 늘 돌린다. 틀린 값이면 시작하지 않는다 |
| `FALL_DROP_MS` | `2000` | 쓰러짐 의심: 서 있음에서 몸통·허벅지가 다 누운 자세가 되기까지 이 시간(ms) 안이어야 한다. 틀린 값이면 시작하지 않는다 |
| `FALL_HOLD_MS` | `3000` | 쓰러짐 의심: 이어서 본 그 누운 자세가 이 시간(ms) 이어져야 한다 |
| `FALL_GAP_MS` | `1000` | 쓰러짐 의심: 누운 자세 사이가 이 시간(ms) 넘게 끊기면 다시 본 때부터 센다 |
| `FALL_TORSO_DEG` | `60` | 쓰러짐 의심의 누운 자세: 몸통이 중력 방향에서 이 각도(°, 0~90 사이) 넘게 기운다 |
| `FALL_THIGH_DEG` | `45` | 쓰러짐 의심의 누운 자세: 무릎이 보이면 허벅지도 이 각도(°, 0~90 사이) 넘게 기운다(허리 숙이기를 거른다) |
| `FALL_VIEW_DEG` | `15` | 쓰러짐 의심: 엉덩이 광선이 수직에서 이 각도(°, 0~90 사이) 안이면(거의 바로 아래를 봄) 기울기를 재지 않고 보류한다 |
| `PAM_TIMEOUT_MS` | `30000` | 판단 한 번 제한 시간(`PAM_LLM_TIMEOUT_S`보다 길면 짧은 쪽). 판단은 늘 서버 안 PAM(`src/brain/pam/`, 계약 `docs/pam-interface.md`)이다 |
| `PAM_TRIGGER` | `periodic` | 판단 호출 시점: `periodic`(폰 엔진 프레임이 오는 동안 `PAM_PERIOD_MS`마다 그때 World State로 부른다. 계기·행동은 PAM의 FSM이 정한다. 사람 없음·등장 사라짐 없음이 이어지면 멈춤) · `event`(World State에 의미 있는 변화가 있을 때). 다른 값이면 시작하지 않는다 |
| `PAM_PERIOD_MS`, `PAM_LIVE_MS`, `PAM_IDLE_STOP_MS`, `PAM_MIN_GAP_MS`, `PAM_MAX_INFLIGHT` | `5000`, `10000`, `1800000`, `3000`, `1` | periodic 주기, periodic이 마지막 엔진 프레임 뒤 부르는 시간(넘으면 폰 없음으로 보고 부르지 않는다), periodic 멈춤까지 시간, event 최소 간격, 동시에 나가 있는 판단 상한(앞 판단이 끝나야 다음을 부른다) |
| `STALE_MS` | `3000` | 실행 전 검사: 대상을 마지막으로 본 뒤 이만큼 지나면 낡은 근거로 보고 실행하지 않는다. 0 이하·숫자가 아니면 시작하지 않는다 |
| `KEEP_HEARD_TEXT` | 꺼짐 | `1`이면 실제 폰이 들은 말(명령의 답이 아닌 말)을 기록 DB·대시보드·반성 입력에 그대로 남긴다. 기본은 그 순간 판단의 관찰 텍스트 한 줄로만 쓰고 기록에는 「들은 말 있음」만 남긴다 |
| `FOCUS` | (끔) | `1`이면 초점 표시(클로이드가 다룬 물건의 고리·"클로이드 주목")를 대시보드·폰·3D로 보낸다. 기본은 보내지 않는다 |
| `PORT` | `8200` | HTTP 포트(`0`이면 빈 포트) |
| `HOST` | `127.0.0.1` | HTTP 바인드 주소. `0.0.0.0`이면 LAN에서도 열린다(인증 없음) |
| `ALLOWED_ORIGINS` | (없음) | 이 PC 말고 대시보드를 여는 출처(쉼표로 여러 개, 예: `https://<서버>.<tailnet>.ts.net`). 쓰기 요청과 `/events`를 허용한다. 주소가 아닌 값이면 시작하지 않는다 |
| `HUB` | `matter` | `matter` / `memory` |
| `MATTER_TRANSPORT` | `network` | `network`(실제 커미셔닝) / `local`(같은 프로세스 behavior API) |
| `MATTER_COMMISSION_TIMEOUT_MS` | `30000` | network 커미셔닝·연결 단계별 제한 시간. 넘기면 local로 대신 뜬다 |
| `MATTER_STORAGE_DIR` | `.matter` | 브리지·컨트롤러 저장소(커미셔닝 정보) |
| `MATTER_PORT` | `5540` | 브리지 UDP 포트. 컨트롤러는 +1 |
| `MATTER_PASSCODE`, `MATTER_DISCRIMINATOR` | `20261011`, `3011` | 페어링 값. 공개된 개발용 값이니 LAN에 열 때는 바꾼다 |
| `MATTER_DISCOVERY` | `address` | 우리 컨트롤러가 브리지를 찾는 방법: `address`(127.0.0.1:포트) / `mdns` |
| `MATTER_LOG_LEVEL` | `error` | matter.js 로그(`debug`…`fatal`) |
| `MATTER_STORAGE_DRIVER` | `sqlite` | `file`도 된다(matter.js 변수) |
| `MATTER_RUNTIME_SIGNALS` | (끔) | matter.js가 SIGINT를 직접 잡게 하려면 준다(보통 쓰지 않음) |
| `MATTER_MDNS_NETWORKINTERFACE` | | mDNS를 특정 어댑터로 제한(matter.js 변수, 아래 "문제 해결") |
| `TWIN_HOME_URL` | `http://127.0.0.1:8200` | MCP 서버가 부를 twin-home 주소 |
| `THINQ_TOKEN` | (없음) | 실제 모드에 쓰는 LG ThinQ Connect 개인 토큰(PAT). `.env`에만 넣는다. 없으면 실제 모드로 바꿀 수 없다 |
| `THINQ_COUNTRY`, `THINQ_REGION` | `KR`, `kic` | ThinQ 나라 코드(`x-country`), 지역(`kic`·`aic`·`eic`, 주소 `https://api-<지역>.lgthinq.com/`) |
| `THINQ_CLIENT_ID`, `THINQ_API_KEY` | (시작마다 uuid), SDK 공개 값 | `x-client-id`, `x-api-key` |
| `THINQ_POLL_MS`, `THINQ_READBACK_MS`, `THINQ_TIMEOUT_MS` | `15000`, `1000,2000,4000`, `10000` | 짝지은 기기 읽기 간격(`0`이면 처음 한 번), 명령 뒤 다시 읽기 전 기다림, 요청 제한 시간 |
| `THINQ_BASE_URL` | (지역 주소) | ThinQ 주소를 바꾼다(시험의 가짜 서버) |
| `CALL_SERVICE_URL` | (없음) | 외부 연락(AS센터 전화·보호자 연락)을 받는 전화 서비스 주소(http(s)). 사용자가 실제 폰에서 승인하면 연락 하나를 JSON으로 POST한다(아래 「외부 연락」). 비우면 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」. http(s) 주소가 아니면 시작하지 않는다 |
| `REDIS_URL` | (없음) | 노드 통로 Redis 주소. 비우면 메모리 통로. 이 PC 개발용은 `compose.dev.yaml`의 `noonchi-redis`(`redis://127.0.0.1:6379`), compose 안에서는 `redis://redis:6379`. Redis 디스크 저장이 켜져 있으면(`appendonly`·`save`) 통로를 열지 않는다. 계획: `docs/superpowers/plans/2026-11-17-stage-queue.md` |

선택 값은 `.env.example`에서 주석으로 두었다. 빈 값(`MATTER_X=`)으로 두면 matter.js가 자기 설정으로 읽을 수 있어서다.

## 서버 (src/server)

### 시작 순서와 대체 경로

`npm start` → `main.ts`(`.env` 읽기) → `startServer()`(`start.ts`):

0. 서버 잠금(`src/server/lock.ts`): 기록 DB를 열기 전에 `RUNTIME_DIR/server.lock.db`에 SQLite 배타 잠금(OS 파일 잠금)을 걸고, 서버가 사는 동안 쥔다. 같은 폴더를 쓰는 서버가 이미 있거나 시연 준비가 쥐고 있으면 「이 폴더를 쓰는 서버가 이미 있어요」로 멈춘다. 끄거나 시작이 실패하면 놓고, 프로세스가 죽으면 OS가 푼다(파일이 남아도 남은 잠금이 아니다). 같은 파일이면 정션·심볼릭 링크·대소문자가 다른 경로도 같은 잠금이다. 시연 준비(`npx tsx scripts/demo-setup.ts`의 `--fresh`·`reflect --scripted`·`learned`)도 같은 잠금을 잡고 일이 끝날 때까지 쥐며, 잡지 못하면 「서버를 먼저 끄세요」로 멈춘다. `--fresh`는 폴더를 옮기지 않고, 잠금을 쥔 채 잠금 파일 말고 옛 항목을 `<폴더>.old-<시각>/`(그 이름이 이미 있으면 그 폴더는 두고 `-2`, `-3`…을 붙인 새 폴더)으로 하나씩 옮긴 뒤 같은 잠금을 쥔 채 새로 쓴다(잠금을 한 번도 놓지 않는다). 하나라도 못 옮기면 옮긴 것을 모두 되돌려 보고(하나가 실패해도 끝까지) 멈추며, 이번에 만든 백업 폴더는 비어 있을 때만 지운다. 옮기기 전에 폴더에 `RESTORE_NEEDED.json`(백업 위치·옮길 항목)을 먼저 쓰고(쓰지 못하면 아무것도 옮기지 않고 멈춘다), 옮기기와 새로 쓰기가 다 끝났을 때(또는 다 되돌렸을 때)만 지운다. 못 돌린 항목이 있으면 그 목록을 이 파일에 더하고, 이 파일이 있으면 서버(DB를 열기 전)와 준비 명령이 「--fresh 복구가 덜 끝났어요」로 멈춘다. 백업의 항목을 옮긴 뒤 이 파일을 지우면 다시 쓴다. 같은 runtime 폴더를 호스트와 컨테이너가 동시에 쓰지 않는다: Docker Desktop처럼 호스트(Windows)와 컨테이너(Linux)가 같은 폴더를 쓰면 두 OS의 파일 잠금이 서로 안 보일 수 있다.
1. `loadTwin(TWIN_STUDIO_DIR)`: 기기 65개, 방 13개(아래 "기기 목록").
2. `startHub()`(`hubFactory.ts`): 허브를 만들고 시작한다.
   - `HUB`가 없으면 **matter**. `MATTER_TRANSPORT`가 없으면 **network**.
   - network 시작(브리지 UDP, 커미셔닝, 연결, 구독)이 실패하거나 `MATTER_COMMISSION_TIMEOUT_MS` 안에 끝나지 않으면, 그 허브를 정리하고 **local 전송으로 다시 시작**한다. 이때 이렇게 한 줄을 찍는다.
     ```
     [경고] Matter network 전송을 시작하지 못했습니다(브리지 커미셔닝에 실패했습니다: …). local 전송으로 바꿉니다(Matter 데이터 모델은 같고 네트워크·외부 컨트롤러 페어링만 빠짐).
     ```
   - local도 실패하면 경고하고 MemoryHub로 뜬다(서버는 항상 뜬다).
3. `Policy` → 공급자(`createProvider`) → `Agent` → `createApp()` → `listen(PORT, HOST)`.

시작하면 이렇게 출력된다(이 PC, 두 번째 시작부터).

```
twin 데이터: scene (…\twin-studio) · 기기 65개 · 방 13개
[Matter 브리지] UDP 포트 5540, 커미셔닝 됨(패브릭 1개)
  수동 페어링 코드: 25953912363
  QR 페이로드:     MT:Y.K90YDA1327ZK2AG00
  (passcode 20261011, discriminator 3011) 이미 커미셔닝됨: 같은 LAN의 다른 컨트롤러(Home Assistant 등)는 먼저 페어링 창을 연 뒤(POST /api/matter/commissioning-window) 이 코드로 추가한다.
[Matter 컨트롤러] 저장된 커미셔닝을 다시 쓴다(peer1).
twin-home 서버: http://127.0.0.1:8200  (허브 matter/network, 에이전트 openai/gpt-5.5)
  웹 화면   http://127.0.0.1:8200/
  WS 이벤트 ws://127.0.0.1:8200/events
  3D 트윈   http://127.0.0.1:8200/twin/
  Matter    다른 컨트롤러(Home Assistant 등) 추가: curl -X POST http://127.0.0.1:8200/api/matter/commissioning-window …
```

### REST·WebSocket

| 메서드·경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/health` | | `{ ok, devices, hub, transport, provider, model, twin, eye, home: { id, name }, phone_urls, tz_minutes, brain, mode, ready }`(`tz_minutes`: 기록 시간대 분, 기록 DB가 없으면 없음)(`mode`: `test` 시험 · `live` 실제). `ready`: `{ ok, inference_mode, vlm: { base_url, model, key, reachable }, pam: { base_url, model, key, reachable }, db }`. 모델은 부르지 않고 VLM `GET {base}/models`(30초 캐시)·PAM `GET {url}/health`만 본다. 답하지 않아도 200이고 `ready.ok`가 false다 |
| `GET /api/homes` | | `{ current, homes: [{ id, name }] }` (twin-studio `homes.json`) |
| `GET /api/setup` | | 설정 상태 `{ ok, persist, done, switching, error, home, homes, rooms, devices: [{ ..., source, pairable }], position, mode, thinq: { ready }, pairs }` (아래 "설정 흐름", 형은 `src/contract/setup.ts`) |
| `POST /api/setup/home` | `{ home }` | 다른 집이면 허브·에이전트·폰 서버를 새 집으로 다시 띄운다. 없는 집 400, 바꾸는 중 409 |
| `POST /api/setup/devices` | `{ home, sources: { <기기 id>: "virtual"\|"none" } }` | 기기 신호 출처. 모르는 기기·값 400, `home`이 지금 집과 다르면 409 |
| `POST /api/setup/done` | `{ home }` | 설정 끝냄 |
| `POST /api/setup/mode` | `{ mode: "test"\|"live", confirm? }` | 운영 모드. `live`는 `confirm: true`와 `THINQ_TOKEN`이 있어야 한다(없으면 400) |
| `GET /api/setup/thinq` | | 실제 모드에서만 ThinQ 기기 목록 `{ ok, devices: [{ id, type, name, model }] }`. 시험 모드 409(ThinQ를 부르지 않음), ThinQ 실패 502 |
| `POST /api/setup/pairs` | `{ home, pairs: { <기기 id>: <ThinQ id>\|null } }` | 에어컨·냉장고 ↔ ThinQ 기기 짝(`null`은 풀기). 다른 종류·목록에 없는 ThinQ 기기 400, 다른 집 409 |
| `GET /api/layout` | | 배치 보정 상태 `{ ok, home, edits, dirty, savePath, savedAt, items }`. 집 scene.json이 없으면 404 |
| `POST /api/layout/save` | `{ home? }` | 수정본을 `RUNTIME_DIR/homes/<id>/edits.json`에 쓴다. `{ ok, path, count, saved_at }`. `home`이 지금 집과 다르면 409 |
| `POST /api/layout/reset` | `{ home? }` | 보정을 모두 버린다. 뷰어에 되돌리는 layout 메시지를 보낸다. `{ ok, reverted }` |
| `GET /api/rooms` | | `[{ id, label, deviceCount }]` |
| `GET /api/devices?room=&kind=` | | `[{ ...DeviceSpec, state: DeviceState }]`. 카메라로 본 기기는 `state.vision: { twin, at, applied }`(아래 "카메라로 맞추는 가전 상태") |
| `GET /api/devices/:id` | | `{ ...DeviceSpec, state }`, 없으면 404 |
| `POST /api/devices/:id/command` | `{ command, confirmToken? }` | 200 `{ ok, state }` / 400 오류 / 404 / **409 `{ needsConfirmation: { token, reason } }`** |
| `POST /api/devices/:id/twin` | `{ attr, value, confirmToken? }` | 3D 트윈에서 바꾼 twin 상태. 200 `{ ok, state, via: "command"\|"sensor", command? }` / 400(없는 attr·값) / 404 / **409 `{ needsConfirmation, command }`** (아래 "3D 트윈 연결") |
| `POST /api/sensors/:id` | `{ attr, value }` | 200 / 400(센서가 아니거나 값이 목록에 없음) |
| `POST /api/agent/chat` | `{ message, sessionId? }` | `{ sessionId, reply, actions, pendingConfirmations, provider }` |
| `POST /api/agent/confirm` | `{ token }` | `{ ok, reply, state, deviceId }`, 토큰이 없거나 만료면 400 |
| `POST /api/agent/cancel` | `{ token }` | `{ ok, reply }` |
| `GET /api/agent/pending?sessionId=` | | 승인 대기 목록 |
| `GET /api/matter` | | `{ ok, transport, commissioning: "none"\|"new"\|"reused", port, controllerPort?, subscribed?, pairing: { manualPairingCode, qrPairingCode, passcode, discriminator, commissioned, fabrics } }`. MemoryHub면 404 |
| `POST /api/matter/commissioning-window` | `{ timeoutSeconds? }`(180~900, 기본 900) | `{ ok, timeoutSeconds, pairing, reply }`. 다른 Matter 컨트롤러용 페어링 창을 연다. local 전송이면 400 |
| `GET /api/brain` | | 관찰 흐름 상태 `{ ok, frames, duplicates, detector, vlm_model, detected, detect_ms, queued, yolo_missing: { cap, error }, vlm: { sent, missing: { cap, timeout, format, error }, inflight, costUsd }, time_source, time_err_ms, dataset, closer: { looks, failed, costUsd, model } }`(`dataset`: `DATASET_COLLECT=1`이면 `{ saved, failed }`, 아니면 null. `closer`: 가까이 보기 한 수·못 한 수·VLM 비용(가격표에 없는 모델이 답했으면 null)·VLM 모델 이름). `BRAIN=1`이 아니면 404 |
| `GET /api/world` | | `{ ok, world }` 지금 World State(`src/contract/world.ts` `WorldView`). `BRAIN=1`이 아니면 404 |
| `GET /api/history?since=&until=&kinds=&limit=` | | `{ ok, rows: HistoryRow[] }` 한 시간축 기록(시각 순). `since`가 없으면 최근 `limit`줄, 있으면 그 시각부터 `limit`줄(기본 500, 최대 5000). `kinds`는 쉼표 목록(생각 메시지는 `thought`). 모르는 종류·숫자가 아닌 시각·범위 밖 limit은 400 |
| `GET /api/history/day/{YYYY-MM-DD}` | | `{ ok, day, observation_text, action_summary, counts, dropped }` 하루 요약(아래 "기록과 반성"). 없는 날짜 400 |
| `POST /api/reflection/run` | `{ day? }`(기본 오늘) | 그날을 바로 반성한다. `{ ok, day, version, appliesDay }`. 없는 날짜 400, 그날 기록이 없거나 이미 반성 중이면 409, PAM 실패 502 |
| `GET /api/phone/start-pose` | | `{ ok, start: { position, yaw_deg, label, facing_label } \| null }` 폰 위치 맞추기 시작 자리(아래 "위치 맞추기"). 집 scene.json이 없으면 404 |
| `POST /api/phone/start-pose` | `{ home?, position: [x, y], yaw_deg, label?, facing_label? }` | 저장하고 실행 중인 폰에 바로 알린다. 이름을 비우면 채운다. 방 바닥 밖·숫자 아님 400, 다른 집 409 |
| `POST /api/phone/start-pose/preview` | `{ home?, position, yaw_deg, label?, facing_label? }` | 저장하지 않고 검사·이름 채우기만 한 `{ ok, start }`. 방 바닥이 아니면 400 |
| `POST /api/phone/start-pose/clear` | `{ home? }` | `{ ok, start: null }` |
| `GET /api/phone/sync` | | `{ ok, sync }` 위치 맞춤 모듈 상태(`rigid`, `floorY`, `aligned`, `source`, `started`, `anchors`, `anchorIds`(짝지은 트윈 물건), `wallPoints`, `residualM`, `observed`). 폰 서버가 없으면 `sync: null` |
| `GET /api/decisions?limit=` | | `{ ok, decisions: [{ id, at_ms, day, text, text_sent, seq, status, prediction, memory_version, world }] }` 최근 판단과 그때 보낸 관찰 텍스트(기본 20, 최대 500) |
| `GET /events` (WebSocket) | | 붙으면 `{type:"hello", home}`, 모든 기기의 `{type:"state", state}`, 지금 배치 보정의 `{type:"layout"}`들, `{type:"plan"}`, (`BRAIN=1`이면) `{type:"world"}`와 마지막 판단·상자 있는 마지막 observe의 `{type:"brain", event}` 하나씩, 마지막 판단의 생각 두 줄 최근 생각 메시지 `{type:"thought", messages, replay:true}`(있을 때). 끝에는 늘 메시지 상자 글 `{type:"say", text}`(글이 없으면 `null`, 안전 알림(쓰러짐 의심·다시 켜짐·꺼짐 기다림·끄기 안내)이면 `safety: true`), 그다음 지금 행동 모드 `{type:"mode", mode}`, 미리 세운 목표가 있으면 `{type:"goal", goal}`, 판단이 한 번이라도 돌았으면 습관 FSM 그림 `{type:"habit", habit}`(`src/contract/habit.ts`), 사람 상태를 정했으면 마지막 `{type:"person"}`(아래). 이후 바뀔 때마다 `{type:"state"}`, `{type:"agent", event:"action"\|"reply"\|"pending"\|"confirmed"\|"cancelled", ...}`, `{type:"layout"}`, `{type:"focus"}`, `{type:"eye"}`, `{type:"photo"}`, `{type:"brain", event}`(관찰·World State 변화·판단·실행·연결·판단 시점·반성 기록, `src/contract/events.ts` `BrainLog`), `{type:"thought", messages}`(새 생각 메시지 `{ id, text, at_ms, decision }` 목록. 판단 뒤에 따로 온다), `{type:"world"}`, `{type:"say"}`(글이 바뀔 때만, `src/act/say.ts`), `{type:"mode", mode}`(지금 행동 모드 눈치·코치가 바뀔 때만, `src/act/mode.ts`), `{type:"goal", goal}`(목표 전환마다), `{type:"habit", habit}`(판단이 PAM에 보낸 기억 판본이 바뀔 때만, 판단 기록보다 먼저), `{type:"person", state, name, since_ms, source, decision_id}`(시간 줄 사람 줄: 사람 상태가 바뀔 때만, `src/brain/person.ts` `PersonLane`: 판단의 PAM 답 상태와 판단 사이 World State 하는 일) (모양은 [plan.md](plan.md)) |

- `command`는 `docs/plan.md`의 `Command` 객체다. 줄임으로 문자열(`"on"`, `"off"`, `"lock"` …)도 받는다.
- 정적 파일: `/`·`/setup/`은 React 빌드 `ui/dist/`다. `/twin/`은 고른 집의 twin-studio 산출물 폴더(아파트는 `apartment/`, 원룸 예시는 `homes/oneroom/`), `/twin/viewer/`는 모든 집이 함께 쓰는 뷰어(`homes.json` viewer), `/twin/lib/`은 모든 종류의 GLB(`homes.json` library)다. 경로 탈출(`..`)은 막는다.
- 보안: 기본 바인드는 `127.0.0.1`. 브라우저 출처는 `localhost`·`127.0.0.1`·`[::1]`만 허용한다(CORS, WebSocket). 다른 출처의 POST(페어링 창 열기 포함)는 403이다. 인증은 없다.

### 웹 화면 (ui/)

React+TypeScript 화면(`ui/`, Vite 다중 페이지)이다. 서버는 빌드 결과 `ui/dist/`를 내준다. `npm start`·`npm run dev`가 먼저 `npm run ui:build`로 빌드하고, 빌드 전이면 화면 요청은 503(「화면이 아직 빌드되지 않았어요. npm run ui:build」)이다. 화면만 고칠 때는 `npm run ui:dev`(5173, `/api`·`/twin`·`/events`를 8200으로 넘김).

- **대시보드** (`/`): 3D 트윈이 화면 전체(둘레 여백 안)를 쓰고, 그 위에 오른쪽 위 폰 카메라 미니맵, 오른쪽 아래 마스코트(누르면 설정 창), 트윈 아래쪽 메시지 상자(마스코트 왼쪽)를 얹는다(자리는 `ui/src/dashboard/layout.ts`). 입력창이 없다. 요청·승인은 폰에서 음성으로 한다. 트윈 위에는 밝힌 방, 계획 길, 단계 번호, 지금 단계 이름표, 사람 이름표, 확인한 것 점, 방 이름표, 확인한 기기·물건 말풍선을 그린다. 할 일 진행도 알약(할 일·단계 번호·단계 막대)과 로봇 상태 알약은 없다. 카메라는 계획 경로·목적지·클로이드가 보이게 맞춘다. 부품은 모두 21st.dev 받은 코드다.
  - 트윈 계획 표시: 무엇을 어디에 그릴지(트윈 좌표 `[x, 높이, z]`와 글)는 `ui/src/dashboard/plan-marks.ts` `planMarks`가 정하고, 트윈 판은 그것을 구운 보기 그림 픽셀로 옮겨 그린다(`frame.ts` `planned`, `MapOverlay`). 같은 자료를 다른 카메라(폰 카메라 화면) 위에도 옮겨 그릴 수 있다. 길은 바닥 높이의 세 겹 선(지나온 길 흐림 `routePassed`, 지금 이동 구간 `route`(로봇 자리에서 나눔), 남은 길 `routeAhead`)이다. 단계 번호는 단계마다 그 단계 자리(이동은 구간 끝, 그 밖은 대상 자리)에 21st.dev Avatar 번호 동그라미(20px)로, 지금 단계 brand, 끝난 단계 brand에 흐림(opacity 0.4), 남은 단계 회색(off)이다. 목적지 고리는 그리지 않는다(지금 단계 번호가 그 자리다). 지금 단계 번호 오른쪽에 이름표 「② 컵 집기」(Status brand), World State 사람 발 자리 위 1.7m에 「사람 · 마시는 중」(하는 일, 없으면 자세, 그것도 없으면 「보임」, 안 보이면 「안 보임」, Status). 목표는 글 없이 고리 하나다. 목표가 준비되면(열린 계획이 없을 때) 미리 만든 계획(목표 `plan`)의 길 전체(남은 길 색)와 단계 번호를 글 없이 흐리게(opacity 0.35, `PRE_FADE`) 그려 두고(`plan-marks.ts` `pre`), 사람이 떠나 시작이면 진해지며(opacity 1, 0.3초), 열린 계획이 오면 같은 번호 요소가 그 계획의 번호 길로 이어진다. 세움·끝·버림이면 없다.
  - 트윈 카메라(2026-11-19 사용자 「지금 트윈이 너무 멀어. 3인칭일 때 화면 중앙에 확대되게 수정해」, `ui/src/dashboard/camera.ts`): 맞출 곳의 가운데를 트윈이 가리지 않는 빈 곳(지도 카메라 칸 `layout.focus`: 칩 줄 아래, 미니맵·마스코트 왼쪽, 메시지 상자·시간 줄 카드 위, 각 사이 gap) 가운데에 두고, 맞출 곳이 빈 곳에 다 드는 배율로 당긴다(집 전체 보기 배율의 `MAX_ZOOM` 3.2배, 그림 `MAX_SCALE` 1.3배까지). 지켜보기(계획 없음)는 클로이드가 있는 방(바닥·벽 위)·그 3D 원뿔·사람 이름표 자리(`watchFocus`, 가장 작은 640×520 그림 픽셀, 눈을 모르면 거실·주방·식당)를, 이동 단계는 지금 구간과 목적지 둘레(가장 작은 440×360)를, 서 있는 단계는 확인한 것·다음 이동 길·목적지·클로이드(가장 작은 440×360, 밝힐 방 전체는 넣지 않음)를 맞춘다. 고치기 전보다 1280×800 지켜보기 0.586 → 0.773배, 계획 단계 0.65~1.01 → 1.11~1.3배, 1920×1080 지켜보기 0.866 → 1.13배(계획 단계는 이미 1.3배라 그대로). 칸 크기는 그대로이고 카메라만 옮긴다.
  - 트윈 오른쪽 위 칩 줄(미니맵 왼쪽): 맨 위에 날짜·시간 칩 「11월 17일 (화) 01:30」을 늘 두고, 그 아래 클로이드 위치를 모를 때·연결이 끊겼을 때만 그 칩을 둔다. 시각은 브라우저 시계, 시간대는 서버 기록 시간대(`HISTORY_TZ_MINUTES`, `/api/health`의 `tz_minutes`, 서버에 다시 붙을 때마다 다시 받는다)라 기록 DB의 날과 같다. 분이 바뀔 때만 그 칩만 다시 그린다.
  - 폰 카메라 미니맵: 가로 16:9 칸, 너비는 화면 너비의 320/1280(1920에서 480×270, 1440에서 360×202.5)이고 높이는 영상 비율을 따른다. 가로 16:9 영상(1280×720과 그 대시보드 프레임 780×439)은 빈 띠 없이 칸을 꼭 채운다. 세로 영상은 트윈 높이의 절반과 마스코트 위 사이(gap)까지 중 작은 쪽에서 멈춘다.
  - 판단·확인 표시(점과 말풍선 하나)는 판단을 내린 자리가 아니라 지금 그 대상이 있는 자리를 따라간다(`ui/src/dashboard/checks/checks.ts` `spotOf`): 계획이 진행 중이면 지금 단계의 자리(가는 곳·집는 물건·넣는 곳·가전)에 「확인」, 계획이 없으면 관찰 기록이 오는 동안 지켜보는 대상(마지막 계획의 대상 물건, 없으면 마지막 판단 행동의 대상 종류 중 가장 최근에 본 물건)의 지금 자리에 「지켜봄」이다. 물건이 손에 있으면(확인됨) 폰 눈 자리, 면 위면 그 면, 아니면 그 물건 자리이고, 대상이 없는 대기 판단이면 폰 눈 자리다(폰 눈을 모르면 표시하지 않는다).
  - 트윈 위 확인한 물건 말풍선과 미니맵 이름표에는 확신 숫자를 쓰지 않는다: 미니맵 이름표는 이름만, 두뇌 말풍선 줄은 로봇이 믿는 상태(「사람 마시는 중 · 컵 비어 있음」, 아직 확인 전이면 「컵 확인 중」)다. 숫자는 개발용 보기(주소 `?scores=1`)에서만 보인다.
  - 메시지 상자: 트윈 아래쪽 마스코트 바로 왼쪽, 남은 너비(트윈 안쪽 여백부터)의 절반(`TALK_SHARE` 0.5, 좁은 화면은 `TALK_MIN_W` 640px까지: 가장 긴 시연 허락 줄이 16px로 한 줄에 든다), 높이 128(문장 세 줄, 상자 가운데 높이)으로 고정(21st.dev LiquidGlass 불투명 판 + Item talk: 문장 줄 16px, 줄 높이 24, 사용자 허락 2026-11-18 「메시지박스 글씨 키워」, 목표 칩은 없다). 마스코트는 상자 오른쪽에서 말하는 사람처럼 서고, 상자 오른쪽 끝의 꼬리(Line Draw SVG 두 장: 판 색 칠한 삼각형과 판 바깥 선 색 두 변, `viz.talkTail`)가 마스코트를 가리킨다. 알약(상태·트리거·액션)과 목표 칩은 없다. 최근 세 줄이 굴러간다: 가장 새 줄이 맨 아래(진하게), 위 두 줄은 지난 줄(흐리게, 맨 위가 더 흐리게), 줄마다 한 줄로 자른다. 새 줄이 오면 세 줄이 한 줄 높이만큼 위로 올라가고 맨 위 줄은 사라지며 새 줄이 아래에서 떠오른다(transform·opacity만). 짧은 사이에 여러 줄이 와도 차례대로 하나씩 굴리고, 끝에 붙지 않은 바뀜(안전 알림 앞에 생각이 끼어듦 등)은 굴리지 않고 바로 바꾼다. 오른쪽 아래에 ▼. 줄은 다듬은 생각 메시지(반성·찾기·쓰는 중 지킴 상태 줄 포함)와 바뀐 말을 받은 차례로 섞은 것이고, PAM의 원래 생각은 싣지 않는다. 안전 알림 말(`safety`)이 유효한 동안 최신 줄은 늘 그 알림이고, 안전 아닌 말이나 빈 말이 오면 풀린다. 「눈치·행동」·「습관·배운 규칙」 칩과 「배운 습관」 줄·모드 글은 없다.
  - 시간 줄 카드(메시지 상자 왼쪽 남은 너비, 위·아래 선과 높이 128이 메시지 상자와 같다, 21st.dev Timeline `ui/src/components/ui/timeline.tsx`, abui id 28289, 끌어 옮기기 뺌): 맨 위 초 눈금 한 줄, 사람 · 로봇 두 줄과 오른쪽 끝 「지금」 선이다(`ui/src/dashboard/timeline.ts` `timelineOf`, `TimelineCard.tsx`). 지금에서 30초 앞까지 보이고(`TIMELINE_SPAN_S`) 지금이 흐르면 구간이 왼쪽으로 간다(0.2초마다, 움직임 줄이기면 1초마다 브라우저 시계). 눈금은 10초마다 굵은 선과 머리 글 「10초 전」·「20초 전」, 그 1/4마다 옅은 선이다. 숫자는 모두 서버 자료에서 온다. 사람 줄은 서버 사람 상태다: `{type:"person"}`(판단의 PAM 답 상태와 판단 사이 World State 하는 일, 임시 상태 포함)이 바뀐 때(`since_ms`)부터 다음 바뀜까지(`data.ts` `people`), 이름은 서버가 붙인 `name`(`FSM_STATE_TEXT`, 임시 상태는 하는 일 이름)이다. 그 메시지를 받기 전에는 유효한 판단의 `fsm.state`와 습관 그림 `{type:"habit"}` 상태 이름으로 잇고, 상태를 모르는 판단은 바꾸지 않는다. 로봇 줄은 계획 단계가 시작한 때(`started_ms`, 그 단계 명령을 낸 때) → 끝난 때(`ended_ms`) 칸(지금 단계 brand 빨강, 지난 단계 옅은 칸, 단계 이름)과 그 사이 「지켜봄」이다(최근 계획 넷, `data.ts` `plans`). 예상 줄(목표 구간과 「… · 준비됨」·「N초 먼저」 글)은 없다(2026-11-19 사용자 「예상을 없애자」). 사람이 떠난 때(목표 `gone_ms`) → 그 뒤 같은 행동 계획의 첫 명령(첫 단계 시작)은 두 줄을 가로지르는 brand 구간(두 끝 선·옅은 바탕)과 그 위 두 줄 가운데에 얹은 굵은 「N.N초」(구간 이름표 14px, LG 빨강 바탕, 따로 줄 없음)다. 글은 모두 부품 원래 크기(줄 이름·반응 간격 14px, 칸·눈금·지금 12px)이고 128 높이에 맞게 머리 줄(24)·이름표 여백만 줄였다(1280×720·1280×800에서 글이 잘리지 않는다). 첫 판단 전에는 카드가 없다. 가짜 단계 화면(`?debug=steps`)은 그 순간 자료의 가장 늦은 때 2초 뒤를 지금으로 멈춰 그린다. 카드는 크기만 받고 자리는 놓는 쪽(`DashboardScreen`, layout `timeline`)이 정한다.
  - 미리 세운 목표: 사람 FSM과 따로 된 상태 머신(세움 → 준비됨 → 시작 → 끝/버림)이다(`ui/src/dashboard/goal.ts` `goalOf`: 미리 만드는 중·못 만듦 세움, 계획 준비됨, 사람이 떠남·준비한 계획을 씀 시작, 그 행동 계획이 닫힘 끝, 버림). 메시지 상자·시간 줄에는 칩·글을 두지 않는다(목표 문장 「컵을 두고 자리를 뜨면 컵을 치울게요」가 메시지 줄로 온다). 목표가 선 동안(세움·준비됨·시작) 트윈의 치울 물건 위에 작은 빨간 고리(Line Draw SVG 세 겹, 글 없음)가 있고 끝·버림이면 사라진다. 자리는 계획 표시 자료(`plan-marks.ts` `goal`: World State 물건 position, 없으면 놓인 면의 자리)라 다른 카메라 화면에도 같은 자리에 그린다.
  - 모드 말풍선: 마스코트 머리 바로 위에 21st.dev Tooltip(화살표) 말풍선으로 지금 행동 모드를 늘 보인다(눈치 모드 brand 바탕, 코치 모드 ok 바탕). 모드는 서버가 정해 보낸 `{type:"mode"}`(아래 「지금 모드」) 그대로이고, 받기 전이면 눈치 모드다. 판단·계획의 행동 종류로 화면이 따로 정하지 않는다. seq가 더 작은 늦은 판단 응답은 화면에 쓰지 않는다.
  - 마스코트는 대기·행동과 상관없이 늘 왼쪽(메시지 상자·트윈 쪽)을 본다(그림을 단추 가운데 축으로 뒤집은 transform, 가슴 표시는 다시 뒤집어 바로 읽힘).
    - 메시지 상자 문장은 모델 없이 판단 기록·World State·실행 추적의 사실로만 만든다(`src/brain/thought.ts`). 말투는 채팅처럼 클로이드가 직접 하는 말이다. 예: 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」 → 「컵을 치울게요.」 → 「식탁으로 갈게요.」·「컵을 들게요.」·「싱크대로 갈게요.」·「컵을 싱크대에 넣을게요.」 → 「컵을 다 치웠어요.」
    - 행동을 고른 판단이 맞은 FSM 규칙 하나면 「<그 규칙 조건> <행동 허락> 된다고 하셨어요」 한 줄을 올린다. 시연 기억 규칙은 사용자가 정한 짧은 조건형(`RULE_IF`, `src/world/labels.ts`: 「컵을 두고 자리를 뜨면」·「식사 중 컵이 비면」·「TV를 보다 컵이 비면」, 「아무도 안 만지면」 같은 덧조건은 넣지 않는다, 1280×720 메시지 상자 한 줄에 잘림 없이 들어간다)이고, 배운 규칙(learned)은 트리거를 줄이지 않고 끝 「다」에 「면」을 붙여 그대로, 그 밖은 「「<트리거>」일 때」다. 허락형·클로이드 말은 `TASK_SAY`(`src/act/tasks.ts`). 규칙을 특정하지 못하면(규칙 여럿·규칙 없이 고른 행동) 이 줄이 없다.
    - 그다음 줄은 말풍선 말(`src/act/say.ts`)이다: 정한 것(「컵을 치울게요.」, 대상 컵의 면을 알면 「식탁 컵을 치울게요.」), 실제 폰에 낸 사람 단계 명령을 클로이드 말로 바꾼 것(「~주세요」 → 「~ㄹ게요.」, 끝을 모르면 「<단계 이름>을 할게요.」), 끝낸 일. 실제 폰 명령만 사람에게 「~주세요」다.
    - 대기·실패 판단은 새 줄을 만들지 않는다. 그동안의 줄은 쓰는 중 지킴(「사람이 컵을 들고 있어서 지켜볼게요」)·찾기(「컵이 안 보여서 식탁 쪽을 다시 볼게요」)의 사실 줄이다. 이미 올린 말(최근 5개)과 같은 줄은 다시 올리지 않는다. 행동 목록에 없는 일(물기 닦기 등)은 문장에 나오지 않는다. PAM의 원래 생각은 대시보드로 보내지 않는다.
    - 반성 결과가 오면 그 규칙의 상황과 「새로 배운 습관이에요」·「전에 배운 습관이에요」가 메시지로 쌓인다.
    - 메시지는 기록 DB에 하나씩 `thought` 줄(판단 id, 집 id·메시지 id)로 남는다. 새로 붙은 대시보드는 최근 메시지를 다시 받고, 서버를 다시 띄우면 이 집의 10분 안 최근 메시지 5개로 시작한다. 기록 DB 판단 줄에는 원래 생각이 남는다.
- **설정 화면** (`/setup/`): 아래 "설정 흐름". 설정을 안 끝냈으면(`npm start`) 서버가 `/`를 `/setup/`으로 보낸다(302).
- **폰 화면** (`/phone/`, `ui/phone/index.html`·`ui/src/phone/`): 폰 서버가 `ui/dist`에서 폰 화면과 그 빌드 파일(`/assets/`)·브랜드 그림·파비콘만 내준다. tailscale serve는 폰 포트를 사이트 뿌리(`/`)로 잇는다.
- WebSocket `/events`로 실시간 반영하고, 끊기면 다시 연결한다.

## 3D 트윈 연결

twin-studio 아파트 뷰어(`apartment/viewer/`)에 `?live=`를 주면 twin-home `/events`에 붙어 상태를 3D에 반영하고, 뷰어 가전 패널에서 바꾼 상태를 twin-home으로 보낸다. 뷰어 쪽 코드는 twin-studio `apartment/viewer/live.mjs`(+ `main.mjs`의 몇 줄 훅)다.

### 실행

```bash
# 1) twin-home(이 레포). /twin/에 twin/apartment/를 붙인다(TWIN_STUDIO_DIR 기본값 twin/)
npm start
#    → http://127.0.0.1:8200/              웹 화면(3D | 대화, "기기 카드"로 카드 칸 추가), 3D 칸은 같은 출처 /twin/viewer/?live=auto&embed=1
#    → http://127.0.0.1:8200/twin/viewer/?live=auto   뷰어만 크게

# 2) (선택) twin-studio 미리보기 서버(:8100)에서 뷰어를 열어 다른 출처로 붙기
#    http://127.0.0.1:8100/apartment/viewer/?live=ws://127.0.0.1:8200/events
```

| `?live=` 값 | 붙는 곳 |
|---|---|
| `auto`(또는 `1`, 빈 값) | 같은 호스트의 `ws(s)://<host>/events`. twin-home이 `/twin/viewer/`로 줄 때 |
| `ws://127.0.0.1:8200/events` | 그 주소. `http://…`를 주면 `ws://…/events`로 바꾼다. REST는 같은 호스트(`http://127.0.0.1:8200`) |
| (`&embed=1`) | iframe용: 오른쪽 검사 패널·도구를 숨기고, 좁으면(640px 미만) 가전 패널을 접는다("가전 패널" 버튼) |

### 무엇이 맞춰지나

- **twin-home → 3D**: 붙으면 `hello` 뒤 기기 65개 스냅숏, 이후 `state` 이벤트마다 `state.twin`의 attr 중 **그 객체가 가진 attr**만 `aptViewer.setState`로 바꾼다. 3D 객체 id = 기기 id(scene.json placement id, 문은 floorplan 문 id). 같은 값은 건너뛴다.
- 모르는 기기·attr·값은 무시하고 센다. 뷰어 위쪽 칩: `실시간 연결됨 · twin-home 127.0.0.1:8200 · 기기 65 · 반영 N · 무시 N`(마우스를 올리면 종류별 개수). 끊기면 `끊김 · N초 뒤 다시`, 1·2·4…15초 간격으로 다시 붙는다.
- **3D → twin-home**: 연결된 동안 뷰어 가전 패널(스위치·목록, 모두 켜기/끄기 포함)에서 바꾼 값은 **로컬에서 바꾸지 않고** `POST /api/devices/:id/twin`으로 보낸다. 돌아오는 `state` 이벤트가 3D를 바꾼다. 원격 상태를 반영하는 동안에는 보내지 않아 되울림이 없다.
- twin-home이 모르는 객체·attr(장식, 월패드 화면 등)와 끊긴 동안의 변경은 뷰어 안에서만 바뀐다(다시 붙으면 스냅숏으로 덮인다).

### `POST /api/devices/:id/twin` 계약

본문 `{ attr, value, confirmToken? }`. 값은 그 기기 `twinAttrs[attr]` 목록에서 고른다(`"true"`도 `true`로 맞춘다).

| attr 종류 | 바뀌는 것 | 예 |
|---|---|---|
| 센서(`door`, `charging`) | `hub.setSensor` (정책 없음) | `door_bed2` `{attr:"door", value:"open"}` → 200 `via:"sensor"` |
| 제어 attr, 도어록 | `lock` / `unlock` | `door_main` `{attr:"lock", value:"unlocked"}` → **409** |
| 제어 attr, 커튼·블라인드 | `covering` 100%(open) / 0%(closed) | `curtain_living` `{attr:"curtain", value:"closed"}` → `openPercent=0` |
| 나머지 제어 attr(`power`, `running`, `heating`, `faucet`, `water`) | `on` / `off` (동작형은 start/stop, 수전은 valve로 정규화) | `washer_1` `{attr:"running", value:false}` → `stop` |

- 명령은 `/command`와 같은 **승인 정책**을 거친다. 현관문 잠금 해제·인덕션 켜기·전자레인지 시작은 409 `{ ok:false, needsConfirmation:{token, reason}, command }`이고 실행하지 않는다. 토큰으로 `POST /api/agent/confirm {token}`(또는 같은 본문에 `confirmToken`)하면 실행한다.
- 400: attr 없음, 값 없음, 목록에 없는 값, 바꿀 수 없는 attr. 404: 없는 기기. CORS·출처 규칙은 다른 API와 같다(`localhost`·`127.0.0.1`·`[::1]` 출처만, 그래서 :8100 뷰어도 된다).

### 승인 동작(뷰어)

뷰어에서 현관문 잠금을 풀면 스위치가 곧바로 원래대로(잠김) 돌아가고, 화면 아래에 "현관문 잠금 해제는 사용자 승인이 필요합니다. [승인] [취소]" 알림이 뜬다. **승인**은 `POST /api/agent/confirm`을 부르고, 실행되면 state 이벤트로 3D·웹 카드가 함께 바뀐다. **취소**는 `/api/agent/cancel`. 토큰은 5분 뒤 만료된다. 실패(400 등)는 빨간 알림으로 8초 보인다.

### 확인한 것(2026-10-11, 이 PC)

헤드리스 Chrome(CDP)으로 `npm start`(matter/network) + `:8100` 미리보기 서버에서 13개 항목을 확인했다: 3D 칸 기본 표시, 스냅숏 반영(기기 65, 무시 0), 채팅 "거실 불 켜고 TV 켜줘" → 3D의 거실 천장등·플로어 스탠드·TV `on`(REST와 같음), 뷰어 패널 스위치 → REST `on`(클릭 → 3D 반영 33~55ms), 뷰어 현관문 잠금 해제 → 승인 알림·잠김 유지 → 승인 → `unlocked`, `:8100` 다른 출처 뷰어의 수신·패널 POST(CORS), 3D 토글, 390px 가로 스크롤 없음·3D 탭.

따로 한 번 더 확인했다(16개 항목).
- **채팅 → 3D·카드:** "안방 불 켜줘"는 안방 조명 3개, 이어서 "에어컨 켜줘"는 `ac_master`를 켰다. 원격 상태를 반영하는 동안 뷰어가 보낸 요청은 0회였다.
- **승인:** 뷰어에서 현관문 잠금을 풀면 승인 알림이 뜬다. 취소하면 잠김이 유지되고 대기가 0개가 된다. 승인하면 `unlocked`가 된다.
- **새로고침:** 3D가 스냅숏으로 현재 상태를 되살렸다(68개 attr 중 불일치 0).
- **서버 재시작:** `끊김 · N초 뒤 다시`(1·2·4·8·15초)를 거쳐 저절로 다시 붙고, 스냅숏을 다시 반영했다(불일치 0).
- **`?live` 없는 뷰어:** 연결하지 않고 그대로 동작한다.
- **출처 검사:** `evil.com`, `localhost.evil.com`, `null` 출처의 POST는 403이고, WS는 401로 거부된다.

## 폰 AR (클로이드의 눈)

폰(안드로이드 크롬)이 WebXR AR로 자기 위치·방향을 재고, 3D 트윈에 '클로이드의 눈' 원뿔로 실시간 표시한다. 계약은 [plan.md](plan.md) "폰 AR 눈", 코드는 `src/phone/`·`ui/src/phone/`, 뷰어 쪽은 twin-studio `apartment/viewer/eye.mjs`다.

1. PC: `PHONE_PORT=8210 npm start` (PowerShell: `$env:PHONE_PORT=8210; npm start`). 시작 로그의 `폰 AR http://<PC IP>:8210/phone/`를 확인한다. Windows 방화벽 창이 뜨면 **개인 네트워크**를 허용한다.
2. 폰(같은 와이파이): 크롬 `chrome://flags`에서 **Insecure origins treated as secure**를 켜고 `http://<PC IP>:8210`을 넣은 뒤 크롬을 다시 시작한다. WebXR은 보안 출처에서만 켜지기 때문이다.
3. 설정 4단계에서 시작 자리와 방향을 저장한다. 폰에서 `http://<PC IP>:8210/phone/` → AR 시작 → 그 자리에 서서 그 쪽을 보고 **여기서 시작** → 방을 천천히 둘러보며 걷는다(아래 "위치 맞추기"). 시작 자리가 없는 집은 「설정 화면에서 시작 위치를 정해 주세요」 창이 뜬다.
4. PC 브라우저 `http://127.0.0.1:8200/`의 3D에서 눈 마커가 폰을 따라 움직인다. 추적이 약하면 마커가 회색이 된다.
5. 대시보드 오른쪽 위 "클로이드의 눈" 칸에 폰 카메라 실시간 화면(기본 초당 12장, 폰 주소 뒤에 `?fps=20`·`?w=640`처럼 붙여 바꾼다)이 뜬다.

- 아이폰은 Safari가 WebXR AR을 지원하지 않아 쓸 수 없다.
- 흰 벽·어두운 곳·빠른 움직임에서는 추적이 약해진다. 오래 걸으면 조금씩 밀린다. 벽 모양이 걸으며 다시 맞추고, 크게 틀리면 설정 모달의 **시작 위치에서 다시 맞추기**를 쓴다.
- 트윈과 같은 구조의 집에서만 위치가 맞는다. 벽이 트윈과 다르면 벽 모양이 기준을 넘지 못해 시작 위치의 어림으로 남는다.
- 크롬이 AR 카메라 접근(`camera-access`)을 주지 않으면 위치만 보낸다. 그 AR 동안 실제 폰 설정 모달(미어캣)에 「카메라 · 못 보냄」 줄이 남고, 엄지 자리 카드가 있으면 비전 상태 줄에 「카메라 화면을 보낼 수 없어요. 위치만 보내요」가 4초 뜬다. 비전이 컵을 못 보므로 집기·내려놓기는 「완료」로 넘긴다.
- 카메라 화면이 위아래가 뒤집혀 보이면 폰 주소에 `?flip=0`을 붙인다(카메라 텍스처 방향은 실제 폰에서만 확인할 수 있다).
- 실시간 화면은 암호화하지 않은 http로 같은 와이파이 안에서만 오간다.

### 시작 위치·물건·벽 모양으로 맞추기(위치 맞추기)

바닥 구석을 조준하지 않고 맞춘다. 계산은 서버 `src/phone/sync/`가 하고, 폰은 자세·조준점·면 법선·엔진 프레임만 보낸다. 웹이든 앱이든 같은 메시지다. 결과는 바닥 평면의 회전 + 이동(크기 없음) 하나와 품질이다. 계획: [2026-11-10-phone-sync](superpowers/plans/2026-11-10-phone-sync.md).

1. **시작 자리 저장(집마다 한 번, 설정 4단계):** 3D 트윈 바닥을 누르면 그 자리에 「시작」 핀이 꽂히고, 다른 곳을 누르면 그쪽을 보는 화살표가 된다. 화살표 끝 손잡이를 끌거나 돌리기 단추(15°씩)로도 돌린다. 끌면(카메라 돌리기) 고르지 않는다. **다시 고르기**는 다음 누름을 새 자리로 쓴다. 이름은 서버가 채운다(`POST /api/phone/start-pose/preview`): 1.5m 안 가장 가까운 물건으로 「<물건> 앞」(없으면 「<방> 시작 위치」), 보는 쪽은 방향 15°·8m 안 가장 가까운 물건. 고친 이름은 그대로 둔다. 방 바닥이 아니면(벽·집 밖) 받지 않는다. **저장**하면 `runtime/homes/<집>/phone-start.json`에 남고 실행 중인 폰에 바로 간다. 「완료하고 대시보드로」는 저장한 뒤에만 누를 수 있다. 예전 `phone-touch.json`(벽 대기 A·B)은 읽지 않는다.
2. **폰에서 「여기서 시작」:** 시작 자리가 있는 집은 AR을 켜면 위에 「<자리>에 서서 <보는 쪽> 쪽을 봐 주세요」, 아래에 **여기서 시작**이 뜬다. 그 자리에 서서 그 쪽을 보고 누르거나 「여기서 시작」이라고 말한다(말 전체가 시작일 때만). 그 순간 자세로 변환이 바로 정해진다. 이때는 어림이다. 폰이 바닥을 거의 내려다보면 폰 윗쪽을 보는 방향으로 쓴다.
3. **걸으며 맞춤:** 방을 천천히 둘러보며 걸으면 서버가 저절로 고친다.
   - 벽 모양: 자세마다 오는 실제 hit-test 점(어림 바닥 점은 뺀다) 중 면 법선이 수평인 점을 벽 점으로 모은다(10cm 칸마다 하나, 최근 45초, 1200칸까지, 폰에서 5m 안). 위를 보고 폰보다 0.9m 이상 아래인 점은 바닥 높이로만 쓴다. 어림일 때는 먼저 벽 점 법선을 트윈 벽 방향에 겹쳐 방향만 고친다(±20°). 그다음 지금 변환에서 2D ICP(점-선 거리, Cauchy 무게, 먼 15% 잘라냄, 짝 문턱 1.0m → 0.15m)로 평면도 방 쪽 벽 면(`src/layout/home-plan.ts` `roomFaces`)에 맞춘다. 법선이 30° 넘게 다르거나 그 면이 카메라 쪽을 보지 않으면 짝짓지 않는다. 가구 옆면 hit은 짝이 없어 빠진다.
   - 물건 기준점: 엔진 프레임(2초마다) YOLO26s 상자 중 냉장고·싱크대·변기·침대·소파·식탁·오븐·전자레인지·TV(`src/phone/sync/classes.ts`, 이름·COCO 번호는 낱말 표 `src/world/vocab.ts`, 점수 0.4 이상, 그림 가장자리에 닿은 상자는 뺀다). World State는 이 상자를 받지 않는다. 상자 아래 가운데 광선이 그 물건이 놓인 높이(바닥, 싱크대·세면대는 윗면, TV는 받침 윗면)의 AR 면과 만나는 점을 그 프레임 자세로 구한다(6m 안, 5° 넘게 숙인 광선만). 종류·자리로 묶고(관찰 3개 이상, 묶음 가운데에서 먼 것은 버림) 트윈 물건(`src/phone/sync/landmarks.ts` 종류 표)과 짝짓는다. 집에 하나뿐인 종류를 먼저 쓰고, 변환이 있으면 가장 가까운 같은 종류를 더한다(둘째와 0.5m 안으로 비슷하면 버림). 상자 아래 가운데는 물건 앞 가장자리라서 카메라 → 물건 가운데 선이 물건 바닥 사각형에 들어가는 점을 짝으로 쓴다. 트윈 물건 자리가 실제와 다르면 **물건 자리 맞추기**로 먼저 고친다.
   - 시작 위치는 약한 사전값으로 남는다(자리 0.3m, 1분마다 0.1m씩 커짐, 방향 10°).
4. **받는 기준**(`src/phone/sync/aligner.ts` `SYNC_LIMITS`):
   - 벽: 면에서 10cm 안 점 40개 이상, 그 RMS 6cm 이하, 짝 중 맞는 몫 절반 이상.
   - 물건: 50cm 안 짝, 그 RMS 35cm 이하.
   - 맞춤: 벽이 두 방향 이상(법선 퍼짐의 작은 고윳값이 큰 것의 15% 이상, 점 8개 몫 이상)이거나, 벽 한 방향 + 물건 하나, 또는 물건 셋. 벽 한 방향(복도)·물건 둘이면 변환은 고치지만 어림으로 둔다. 물건 하나는 회전을 못 정해 쓰지 않는다.
   - 기준을 못 넘으면 바꾸지 않는다. 맞춘 뒤에는 맞춤 기준을 넘을 때만 바꾼다.
   - 한 번에 움직이는 양(폰 자리에서): 어림이면 1.0m·20°, 맞춘 뒤면 0.3m·5°. 넘으면 그만큼만 가고 다음에 마저 간다.
   - 다시 푸는 것은 0.5초에 한 번, 새 벽 점 10개나 새 물건 관찰이 있을 때만이다(목련, 벽 점 400여 개에서 한 번 약 3ms).
5. **어림인 동안:** 눈은 시작 변환 자리에 `estimated: true`로 대시보드에 보인다. 사진 위치·World State 물건 자리·명령 대상 고리·「여기」에는 쓰지 않는다(맞춘 뒤에만). 명령이 떠 있으면 비전 상태 줄 앞에 「위치 맞추는 중」이 붙는다.
6. **설정 모달:** 「위치」 줄(맞음 · 오차 cm / 어림 / 안 맞음), 「기준」 줄(시작 위치 · 물건 n · 벽 n점). 시작 자리가 있으면 **시작 위치에서 다시 맞추기**(주 단추)와 **물건 자리 맞추기**.
7. **지우기:** AR을 새로 시작하거나 추적 원점이 다시 잡히면 맞춤과 모은 증거를 지운다(시작부터 다시). 폰은 자세·사진·기준점 상자마다 그 AR 원점 이름(epoch)을 붙이므로, 그 순간 연결이 끊겨 있었어도 다시 붙으면 서버가 이전 맞춤을 버린다. 버린 원점의 늦은 자세·시작은 받지 않고, 다른 원점에서 찍은 사진·엔진 프레임에는 위치를 붙이지 않는다. 폰 한 대만 쓴다고 본다.
8. **바닥 높이:** 실제 hit 바닥 점(위를 보고 폰보다 0.9m 이상 아래)의 중앙값에서 그 방 바닥 단차(`floor_z`)를 뺀다. 없으면 폰이 보낸 어림 바닥(`floor_y`: 크롬 `local-floor`가 폰보다 0.9~2.5m 아래면 그 높이, 아니면 폰보다 1.5m 아래), 그것도 없으면 시작할 때 폰 높이 − `PHONE_EYE_HEIGHT_M`(기본 1.5m).

모의 시험(`tests/sync-walk.test.ts`, 목련 트윈, hit 잡음 1.5cm·빠짐 30%, 상자 잡음 3px, 가구가 벽을 가림):
- 시작이 0.5m·15° 틀려도 한 바퀴(90초) 걸으면 벽으로 1cm·0.1° 안이다. 맞춤은 걷기 시작 뒤 약 21초.
- 벽 hit 없이 물건만이면 두 바퀴에 13cm·1.2°(물건 둘, 어림).
- 복도에서 옆 벽만 보이면 회전·벽에 수직인 자리는 맞추고 길이 방향은 시작 그대로 둔다(어림).
- 벽 점이 8개뿐이면 시작 변환 그대로다.

메시지(폰 → 서버 `/phone/events`, `src/phone/session.ts`). 앱도 같은 것을 보낸다:

| 메시지 | 칸 |
|---|---|
| `reset` | `epoch`. 새 AR 원점·다시 맞추기 |
| `pose`(초당 10번) | `position`, `orientation`, `tracking`, `hit`(조준점), `hit_estimated`, `hit_normal`(실제 hit 면 법선 = hit 자세 +Y), `floor_y`(어림 바닥 높이), `epoch` |
| `start` | `position`, `orientation`, `epoch`. 「여기서 시작」 순간 자세 |
| `surface`(앱) | `camera`, `points: [[x, y, z, nx, ny, nz], …]`(256개까지), `epoch` |
| `landmarks`(앱 감지기) | `position`, `orientation`, `projection`(16개), `width`, `height`, `boxes: [{ label 또는 cls, score, box: [x, y, w, h] }]`(32개까지, `label`은 낱말 표 키 `refrigerator`·`dining_table` 등, `cls`는 COCO 번호), `epoch` |
| 엔진 프레임(바이너리, 웹) | 서버 YOLO가 기준점 상자를 찾아 그 프레임 자세·투영과 함께 넘긴다(원점이 지금 원점일 때만) |

서버 → 폰: `status`(`{ type, aligned, sync, error?, engine_ms?, protocol }`)의 `sync: { state: "none"|"estimated"|"aligned", source: "start"|"objects"|"walls"|null, start: { label, facing }|null, started, anchors, wall_points, residual_m }`. 맞춤 상태가 바뀌거나 변환이 폰 자리에서 5cm 넘게 움직이면 붙은 폰 모두에 다시 보내고, 맞춘 상태면 지금 명령도 새 대상 자리로 다시 보낸다.

폰 판본(`src/phone/server.ts`, 판본 형 `src/contract/phone-version.ts`): 폰 페이지는 열리자마자 `{type:"hello", protocol}`을 보낸다. 서버는 판본이 맞는 hello를 받은 연결에만 계획 명령을 보내고 답(`answer`·`say`·`confirm`·`cancel`)을 받는다(자세·사진은 늘 받는다). 2초 안에 hello가 없거나 판본이 다르면 옛 탭으로 두고 명령 `{id:"refresh"}`(「화면을 새로 고쳐 주세요」)만 보낸다. 맞는 hello를 받으면(늦게 와도) 새로 고침 안내를 지우고 지금 명령 전체와 지금 승인 대기 목록을 보낸다. 폰은 `status.protocol`이 폰 빌드와 다르면 페이지를 다시 읽는다(같은 탭에서 60초에 한 번, 못 읽으면 「새로 고침이 필요해요」). 말 `{type:"say", text, at}`의 `at`은 말하기 시작할 때 떠 있던 명령(`{kind:"command", id, step}`, 없으면 `{kind:"none"}`)과 보인 승인 대기 token들(`pending`)이다. 서버는 말 답을 그 명령에만, 말로 한 승인·거절은 보인 token이 하나이고 지금도 대기일 때 그 하나에만 받고(at에 승인 token이 있으면 명령의 답으로 보내지 않는다), 답한 뒤 지금 승인 대기 목록을 보낸다. 폰은 화면에 실제로 보이는 것(엄지 자리의 명령 또는 승인 대기 하나)만 at에 싣는다. 안전 명령(끄기 안내·부탁, `grade: "safety"`)은 승인 대기 카드보다 먼저 보이고 at도 그 명령이다. 가린 동안 서버는 승인 시간 제한을 멈추고, 안내가 풀리면 카드가 다시 보인다. 그 밖의 답 말은 들은 말로만 남기고 실행 기록에 「늦은 답이라 쓰지 않음」을 남긴다. 판본이 맞는 폰이 없으면 폰이 필요한 계획(사람 단계·질문·승인이 필요한 가전 단계·시간 초과 질문, 처음 하는 일 묻기를 켰으면 처음 하는 일)은 시작을 미루고(「폰 화면 새로 고침 전이라 새 일을 미룸」), 계획 도중 물을 폰이 없으면 바로 닫는다(「폰이 없어 물을 수 없어 그만둠」). 닫힌 계획의 끄기 안내는 보통 명령으로 명령 줄에 뜬다(명령 id는 그 계획 id, 단계 id `off:<계획>:<가전>:<회차>`, 가전마다 하나). 안내가 남은 동안 폰이 필요한 새 계획만 미루고, 폰이 필요 없는 가전 계획은 그대로 돈다. 폰이 필요한 다른 계획이 도는 동안 다시 걸린 안내는 그 계획이 끝난 뒤 뜨고, 그동안 폰 서버가 판본이 맞는 폰 모두에 `{type:"reply", text, grade:"safety"}`(「…이 다시 켜졌어요. 꺼 주세요」)를 2분마다 보낸다(여러 가전이면 돌아가며). 폰은 말을 차례로 읽고(앞 말을 끊지 않음) reply 글을 잠깐 알림 줄에 20초 남긴다.

실제 폰에서 확인할 것:
- 크롬 WebXR hit-test가 벽(수직면)을 돌려주는지, hit 자세 +Y가 면 법선인지. 수평면만 주면 벽 모양은 쓰이지 않고 시작 위치·물건만 남는다.
- 엔진 프레임 투영과 카메라 이미지가 맞는지(물건 바닥 점이 어긋난다).
- YOLO26s가 실제 집 가구를 점수 0.4 넘게 잡는지, 트윈 물건 자리가 실제와 맞는지.
- 사람이 시작 자리·방향에 얼마나 맞게 서는지(0.5m·15° 안이면 벽으로 맞춰진다).
- 나침반(`deviceorientationabsolute`)은 쓰지 않았다. WebXR 세션 중 크롬이 이 값을 주는지는 실제 폰에서 봐야 한다.

### 영상 모드: 영상으로 시험하기

실제 폰 대신 영상을 틀어 같은 흐름(관찰 → 판단 → 계획 → 단계 명령)을 보고, 명령이 맞는 때에 오는지 판정한다. 계획: [2026-11-11-video-input](superpowers/plans/2026-11-11-video-input.md).

- 열기: 폰 페이지 `/phone/?clip=<파일>`. 영상은 폰 서버가 공용 `runtime/videos/<파일>`(`PHONE_VIDEO_DIR`로 바꿈)을 `/phone/videos/<파일>`로 내준다(이름은 영문·숫자·`_-` 64자까지, `.mp4`·`.webm`, Range 요청). 주소 칸 `fov`(세로 시야각, 기본 60°), `pitch`(기본 −25°), `h`(카메라 높이, 기본 1.4m)로 카메라를 정한다. 실제 폰 페이지와 같이 열지 않는다(명령이 둘 다에 간다).
- 위치: 설정 4단계에서 저장한 시작 자리·방향이 카메라 자리다. 「AR 시작」을 누르면 `reset` 뒤 `start {fixed: true}`를 보내고, 서버는 그 자세를 바로 맞춤(`sync.source: "video"`)으로 둔다. 고정 변환은 물건·벽으로 움직이지 않고, `reset`이나 보통 `start`에서 풀린다. 서버 sync가 none으로 떨어지면(다시 연결) 페이지가 `start {fixed: true}`를 다시 보낸다. 시작 자리가 없으면 「설정 화면에서 시작 위치를 정해 주세요」가 뜬다.
- 보내기: 실제 폰과 같다. 화면 프레임 JPEG 초당 12장(긴 변 780), `engine_ms`마다 엔진 프레임(360×640, 고정 자세·투영·`captured_at`), 자세 초당 10번(`floor_y: 0`). H.264 표시 영상은 쓰지 않는다. 영상은 다시 틀지 않는다.
- 전체 화면: 「AR 시작」을 누른 순간 페이지 전체 화면(`requestFullscreen({ navigationUI: "hide" })`, 옵션을 못 받으면 옵션 없이)을 요청한다. 실제 AR(immersive-ar)이 그 자체로 전체 화면인 것을 흉내 내는 카메라 입력 갈래다. 지원하지 않거나 거절돼도 영상은 그대로 시작하고, 끝내면 이 페이지가 요청한 전체 화면만 푼다. 화면 방향은 고정하지 않는다.
- 화면: 영상이 카메라 자리에 깔리고(`object-fit: cover`) 그 위에 실제 폰 화면이 그대로 뜬다. 명령 대상 자리는 고정 자세·투영으로 잡아 잘린 화면 자리로 옮긴다(실제 모드처럼 화면 밖·칸에 가릴 때만 세모). 명령은 실제 폰처럼 소리로 읽고(말 차례·등급·시간 상한도 같다), 마이크로 늘 듣기만 끈다. 답은 「완료」·「승인」 단추로 한다. 영상 모드가 실제 모드와 다른 갈래는 카메라 입력·자세 흉내·단계 영상·held·시험 기록·듣기 끔뿐이다(`tests/video-mode-parity.test.ts`). 단계 영상이 없으면 영상은 바뀌지 않고 go만 걷는다(아래).
- 단계 영상: 주소 칸 `step=<종류>:<낱말>:<파일>`(여러 개, 종류 go·pick·place·do)을 붙이면, 사람 단계 명령(`PhoneCommand.kind`)의 종류가 같고 대상 id에 낱말이 든 칸의 영상으로 `react`초(기본 1.5, 0~10) 뒤 바꿔 튼다. 같은 명령 id·단계에는 한 번만 바꾼다. 자세는 새 영상이 틀어질 때 함께 바뀌고, 영상을 열지 못하거나 더 새 바꾸기가 있으면 그대로다. go면 그 영상을 트는 동안 자세가 대상 쪽으로 돌아 초당 0.8m 걷고 대상 0.6m 앞에서 멈춘다(높이·시작 숙인 각 그대로, 벽은 보지 않고 곧게). 집기·놓기·그 자리에서 하는 일(do)이면 걷기를 멈추고 그 자리에서 대상(면이면 윗면 가운데, 싱크볼이 있으면 싱크볼 가운데)을 바라본다: 대상 쪽으로 돌고 대상 높이까지 숙인다(높이 그대로, 대상이 수평 1cm 안이면 그대로). 가까이 가서 보기 명령이면 go는 `near_m`×0.8과 0.6m 중 짧은 거리 앞까지 걷고, `view: "above"`인 do는 폰을 대상 입구 바로 위(지금 자리 쪽으로 수평 2cm, 대상 위 0.4m)로 옮겨 내려다본다(높이도 바뀐다). 명령이 지워지면(`command_clear`) 그 명령의 예약된 영상 바꾸기와 걷기를 멈추고, 이미 재생을 기다리는 바꾸기는 재생이 끝나면 새 영상을 닫고 앞 영상·자세를 그대로 둔다. 맞는 칸이 없는 go는 `react`초 뒤 영상은 그대로 두고 같은 규칙으로 걷기만 한다(같은 명령이 다시 와도 다시 하지 않고, 대상이 바뀌어 같은 명령이 칸에 맞게 되면 그때 단계 영상으로 바꾼다). 칸이 없는 집기·놓기·그 자리에서 하는 일(do, `view: "above"` 포함)은 영상이 돌지 않으므로 자세도 그대로 둔다(자세만 돌리면 사진과 자세가 어긋나 서버가 엉뚱한 자리를 잘라 본다). 그래서 찾기의 비추기는 대상 자리가 이미 영상 화면 안이면 그 사진으로 끝나고, 화면 밖이면 영상 모드에서는 끝나지 않아 비추기 한도(30초)로 닫힌다. `start`는 늘 처음 자세로 보낸다. 서버는 이 자세와 영상으로 단계를 넘긴다(가기는 폰 근처, 집기·놓기는 World State).
  - 같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다: 그 종류·낱말에 맞는 새 명령마다 다음 칸을 틀고, 칸이 다 떨어지면 지금 영상을 둔다. 칸이 하나면 맞는 새 명령마다 그 칸을 튼다.
  - 단계 영상이 끝나면 마지막 장면을 붙잡는다: 다음 단계 영상이 오거나 끝낼 때까지 그 장면으로 화면·엔진 프레임을 계속 보내고(영상 시각은 흐른다), 엔진 프레임에 `held: true`를 붙인다. 첫 영상도 끝나면 마지막 장면을 붙잡는다(실제 폰은 계속 보므로, 판단·계획 뒤 대상 다시 확인이 영상 끝에서 끊기지 않는다). 서버는 영상 모드 연결의 붙잡은 프레임만 같은 사진이어도 VLM 간격마다 새 관찰로 넣는다. `ended`는 첫 영상이 끝났을 때만 참이다.
- 기록: `window.__noonchiVideo = { t0, ended, hold, commands: [{ video_ms, id, step, text }], clips: [{ video_ms, clip, duration_ms }], sync: [[서버 시각, 영상 시각]], at }`(t0는 재생 시작 순간의 서버 시계, 영상 시각은 바꾼 영상을 이어 센다. sync는 시계를 맞춘 뒤 첫 프레임과, 영상이 멈칫해(버퍼·디코딩 밀림) 서버 시계와 1:1로 이어 셀 수 없게 50ms 넘게 어긋난 곳의 앞뒤 짝이다. 멈칫하는 동안에는 프레임이 오지 않아 0.25초마다와 끝낼 때도 견주고(시계를 맞춘 뒤 프레임보다 먼저면 그때 t0도 고친다), 짝은 판정 도구가 옮길 때(짝 사이는 잇고 마지막 짝 뒤는 1:1) 모든 견주기의 오차가 50ms 안이 되게 줄인다(같은 직선 구간은 양 끝점만). 4000개에 닿으면 앞 짝을 버리지 않고 `syncFull`을 참으로 두고 더 쌓지 않으며, 판정 도구는 넘침을 읽은 즉시 판정을 멈추고(말·누름을 더 보내지 않음) 시각표·판정 없이 「짝 넘침」만 적어 실패(끝 코드 1)로 끝낸다. hold는 붙잡는 중인 영상(첫 영상이나 단계 영상)과 붙잡기 시작한 영상 시각, 아니면 null. at은 지금 말의 at(화면이 바뀔 때마다 실제 폰 말과 같은 `heardAtOf`로 다시 쓰고, 판정 도구 `--say`가 그대로 싣는다))와 console `[video]` 줄.
- 판정 도구: `npm run heavy -- npx tsx scripts/video-check.ts --clip <파일> [--step <종류>:<낱말>:<파일> …] [--done-after 3] [--expect-after 36.3] [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--out <md>] [--record <폴더>] [--record-view top|minimap] [--record-fps 10] [--fov <도>] [--pitch <도>] [--h <m>]`. `--record-view minimap`면 녹화 대시보드를 `?view=minimap`(비전 미니맵 칸 하나만 창 가운데 16:9로 채움, 3D 트윈·카드·마스코트 없음. 지금 실제 폰에 낸 명령 한 줄(`{type:"phone_command"}`, 지우면 null, 승인·계속 질문은 싣지 않음)을 칸 아래쪽 가운데 자막으로 보인다)으로 1280×720 창에 열고 mp4도 1280×720이다. `--record-fps`는 녹화 초당 장 수(1~30, 기본 10: ack 간격 1000/fps, mp4 fps). minimap 보기는 mp4를 만든 뒤에도 `<줄기>.frames` 장면 폴더와 판 기록 `run.json`(녹화 시작 시각, 장면과 받은 ms, 폰 페이지 [서버 시각, 영상 시각] 짝, 바꾼 단계 영상과 길이, 첫 영상 길이)을 남긴다. `npx tsx scripts/minimap-cut.ts <장면 폴더> [--out <mp4>] [--fps 20] [--lag-ms 0]`는 장면마다 녹화 시각을 짝으로 영상 시각에 옮기고 재생 시작 전과 영상 조각 사이·끝의 마지막 장면 붙잡기를 뺀 이은 영상 시각을 붙여, 이은 시각이 앞으로 가는 장면만 그 순서로 일정한 초당 장수로 엮은 `<줄기>.minimap.mp4`를 만든다(같은 판이면 같은 파일, 판정·시각표는 그대로).
  - `--fov`(20~120)·`--pitch`(-89~89)·`--h`(0.2~3m)는 준 것만 폰 주소의 `fov`·`pitch`·`h`로 붙는다. 없으면 폰 페이지 기본값(60°, −25°, 1.4m)이다. 예: 가로 영상 `--fov 40 --pitch -10 --h 1.15`.
  - 헤드리스 크롬 하나(390×844)로 폰 페이지를 열어 「AR 시작」을 누르고 영상 끝까지 본다. 새 명령이 뜨면 `--done-after`초 뒤 첫 답 단추를 누른다(0이면 안 누름). 끄기 안내(`off:`)와 계획이 끝난 뒤 충전 자리 명령(`dock:`)은 누르지 않는다. 충전 자리 명령은 단계 영상이 없어도 폰 페이지가 그쪽으로 걷기만 하고, 판정은 계획이 끝나면 끝난다.
  - 끝나면 `/api/history`(사람·물건 등장·사라짐, PAM 판단, 계획, 단계)와 폰이 받은 명령을 영상 시각순 표 하나로 합치고(서버 기록·트윈 줄·누름은 `sync` 짝으로 영상 시각에 옮긴다: 짝 사이는 잇고 앞뒤는 1:1, 짝이 없으면 t0를 뺀다), 판정 줄(첫 명령 시각, `--expect-after`초 전 명령 수, 계획 끝남)과 VLM 비용(PAM·계획 비용 빠짐)을 붙여 `runtime/videos/<파일>.<시각>.timeline.md`에 쓴다.
  - `--step`은 폰 주소의 `step=`으로 넘기고, 있으면 `--done-after` 기본이 0(단추를 누르지 않음)이다. 1초마다 `/api/world`를 읽어 트윈 줄(눈 방·자리가 바뀌거나 0.5m 넘게 옮김, 컵 상태·놓인 곳·면·방이 바뀜)과 바꾼 단계 영상 줄을 표에 넣고, 단계 판정 줄(첫 계획 끝난 단계 수, 누른 단추 수, 마지막 트윈 눈 방·컵 놓인 곳)을 더한다.
  - 판정 기준 계획(`mainPlan`): 명령을 낸 계획(`plan:`) 가운데 기록의 목표가 컵 치우기인 마지막 계획(마지막으로 실행된 것), 없으면 마지막 계획, 계획 명령이 하나도 없으면 기록의 마지막 컵 치우기 계획이다. 찾기(`find:`)·계획 밖 가까이 보기(`peek:`)·충전 자리(`dock:`)·끄기 안내는 계획이 아니다. 단계 자리는 그 계획의 단계마다 마지막 명령으로 맞추고, 계획 줄의 찾기 명령(`:find:`)은 뺀다(2026-11-18 wide-mug g1). 기록의 계획 줄 단계에는 종류(`kind`)도 있어 빠진 단계 명령을 잡는다. 판정 줄의 계획 끝남, 단계 판정 줄의 단계 수, 단계 자리 판정이 모두 이 계획 하나로 본다(첫 명령 시각은 처음 나간 명령 그대로).
  - 단계 자리 판정(`stepPlaces`): 판정 기준 계획의 사람 단계(기록의 계획 단계 가운데 가기·손 단계)를 차례로 본다. 그 단계 명령이 없으면 「단계 명령 없음: <단계 이름>」이고, 있으면 아직 안 쓴 같은 종류 `--step` 가운데 명령 대상(폰 페이지가 남긴 명령 kind·target)에 낱말이 드는 것을 맞음으로 센다(go:table 식탁, pick:cup 컵, go:sink·place:sink 싱크대). 같은 종류가 있는데 맞는 것이 없으면 「단계 자리 틀림」이다. 계획에 없는 `--step`(찾기가 생길 때만 쓰는 go:cup 등)은 선택이라 세지 않는다(2026-11-18 wide-tall q3 거짓 실패). 계획 밖 명령(충전 자리·끄기 안내)과 질문은 세지 않는다. 컵 치우기 판이면 끝에 집은 컵(집기 명령 대상에서 옮김 표시 `followed_by`만 따라간 물건, 상관없는 다른 컵으로 대신하지 않음)이 싱크대 안(싱크대 안 사실 또는 싱크볼 안)이어야 한다. 다른 판(라면·전자레인지)은 단계 자리만 본다. 단계 명령이 하나도 없으면 「단계 명령 없음」, 판정 기준 계획이 끝남이 아니면(계획·실행 줄에 끝남이 없음) 맨 앞에 「계획 없음」·「계획 실패」·「계획 취소」·「계획 안 끝남」으로 실패다(2026-11-18 wide-glass c1·wide-tall m1 거짓 통과). 하나라도 틀리면 시각표 위에 「판정 실패 · 단계 자리: 3/4 맞음 · 단계 자리 틀림: 세탁기 ≠ 식탁 · …」를 적고 끝 코드 1이다(2026-11-18 tall q1 거짓 통과).
  - 영상이 멈춘 뒤(첫 영상 끝, 단계 영상 마지막 장면 붙잡기)에도 계획이 열려 있거나 끄기 추적(지금 계획 hot·끄기 안내)이 남아 있으면 `--tail`초(기본 30)까지 더 본다. 계획 상태와 끄기 추적은 `GET /api/plan` 한 답(`plan`·`off`)에서 함께 읽는다. 끄기 안내가 남은 채 끝나면 「끝까지 돌지 않음」에 적는다. 끝에 같은 크롬 새 탭(1280×800)으로 대시보드를 열어 `runtime/videos/<파일>.<시각>.twin.png`를 남긴다.
  - `--record <폴더>`: 폰 페이지를 연 뒤 같은 크롬 새 창(1280×800)으로 대시보드를 판정 내내 띄우고, 트윈이 다 뜬 뒤(대시보드 `main[data-ready]`와 그 뒤 그림 5장, 3분 안에 안 되면 오류) 대시보드 한 화면(`--record-phone`이면 폰 탭도)을 `Page.startScreencast`(JPEG, ack를 100ms 간격으로 보내 화면마다 초당 약 10장)로 끝(30초 더 보기 포함)까지 받는다(`scripts/video-record.ts`). 「AR 시작」(영상 재생)은 녹화를 시작한 뒤 누른다. 녹화하는 동안 대시보드 그림 간격(requestAnimationFrame)을 재 판정 줄 위에 중앙값·p90·최대·초당 장 수를 적는다. 크롬 그리기 방식은 `--chrome`(기본 `headless-gpu`: 화면 없이 그래픽 카드 ANGLE D3D11, `swiftshader`, `window`)이다. 화면마다 녹화 시작 답이 10초 안에 오지 않거나 오류면(CDP 끊김) 리스너·ack 타이머를 풀고 시작을 보낸 화면의 녹화를 끈 뒤 그 판을 오류로 끝낸다. 끝 사진은 그 창으로 찍는다. 크롬을 끈 뒤 ffmpeg로 대시보드 한 화면(1280×800, `--record-phone`이면 왼쪽 폰·오른쪽 대시보드를 높이 800에 맞춰 붙인 1650×800)의 `<폴더>/<시각표 이름 줄기>.demo.mp4`(H.264, yuv420p, 10fps, 프레임 받은 시각대로 실제 시간 길이)를 만들고 프레임 폴더를 지운다. ffmpeg가 없거나 실패하면 `<줄기>.frames` 폴더를 남기고 판정 줄 위에 적는다.
  - 엔진 프레임을 이미 받은 서버나 끝나지 않은 계획이 있는 서버면 시작하지 않는다. 판마다 서버를 새로 띄운다. 끝까지 돌지 않으면 끝 코드 1이다.
  - `--fake`: 가짜 모델(VLM·계획·PAM)과 대본 감지기로 같은 흐름을 한 프로세스에서 돌려 도구만 본다. 계획이 닫혀도 첫 영상이 멈출 때까지 보고(영상 끝 줄), 기본 `--expect-after`는 대본 사람 시간(서버 시계 30초)을 영상 시각으로 옮긴 값이다.
- 시험 영상 `runtime/videos/cup-demo.mp4`(76.3초, 커밋 안 함): 0~27.8초 두 사람이 식탁에서 마심(Pexels 4828603), 27.8~36.3초 손이 머그를 놓고 나감(4065943 거꾸로), 36.3초부터 머그만. 이 머그에는 커피가 들어 있어 컵 FSM 기억(「컵을 비우고 떠나면 치움」)으로는 치우지 않는 것이 맞다.
- 빈 컵 영상 `runtime/videos/cup-empty.mp4`(74.1초, 커밋 안 함): `cup-demo` 0~27.8초 + Pexels 10568206 9.5초부터(손이 빈 흰 컵을 놓고 나감) + 마지막 장면 40초 멈춤. 31초부터 빈 컵만 보인다.
- 컵 치우기 단계 영상(720×1280 25fps, 커밋 안 함): `go-table.mp4`(빈 컵 끝 장면을 3초에 1.6배로 다가감), `pick-cup.mp4`(10568206 0~3초 손이 같은 컵을 듦, 같은 1.6배 자리), `go-sink.mp4`(Pexels 5965451 바닥을 보며 걷는 1인칭), `place-sink.mp4`(Pexels 19548448 2~3.2초 싱크대 수전 아래로 머그를 내림). 끝 장면을 15~20초 멈춘다. Pexels에 컵을 싱크대에 내려놓는 영상이 없어 놓기는 손에 든 머그다.

### 조준점

- 화면 가운데 조준점은 hit-test 점이고, 없으면 시선이 어림 바닥과 만나는 점이다(`ui/src/phone/core/aim.js` `aimPoint`). hit-test 점은 ARCore가 면을 찾은 뒤에만 나온다(민무늬·반짝이는 바닥, 폰을 덜 움직였을 때는 없다). 어림 바닥 높이는 위 "위치 맞추기" 바닥 높이와 같다. 수평보다 위를 보거나 6m보다 멀면 닿지 않음이다.
- 어림 조준점은 주황(`phoneFocus.aim.estimated`)과 「어림잡은 바닥에 닿음」으로 보인다. 자세의 `hit_estimated`가 true이고, 위치 맞추기는 이 점을 벽·바닥 점으로 쓰지 않는다. 어림 바닥이 실제 바닥과 다른 높이만큼 조준점이 앞뒤로 어긋난다(45° 아래로 볼 때 높이 10cm 차이면 10cm).
- 조준점은 **물건 자리 맞추기**(「여기」) 때만 화면에 그린다.
- 설정 4단계 3D에는 뷰어 위 막대(벽·방·CCTV·천장 보기·상태 배지·실시간 칩)가 없고, 벽은 온전히 보이며 기기 배지는 뜨지 않는다. 집을 다 불러올 때까지 3D 자리는 「3D 트윈 불러오는 중…」으로 가려지고, 못 불러오면 「3D 트윈을 불러오지 못했어요.」가 뜬다.

### 실제 폰 화면(세로 기본)과 속도 측정

- 실제 폰은 에이전트의 손이다. 세로로 든다. 처음 화면(마스코트 그림·제목·준비 줄·시작 위치 안내·AR 시작·답 줄·글 입력)은 390×844·412×915·360×780에서 AR 시작 단추까지 스크롤 없이 보인다. 폰을 닫으면 끝난다.
- AR 화면(`ui/src/phone/PhoneScreen.tsx`): 위는 왼쪽 위 미어캣 아이콘(설정 단추)과 그 옆 지금 할 명령 한 줄뿐이다. 위 칸은 상태 표시줄 아래에 둔다: 위 여백 `max(env(safe-area-inset-top), 28px) + 8px`, `viewport-fit=cover`. 화면 사진 검사(`layoutIssues`)는 위 줄 첫 단추가 36px보다 위면 실패한다. 명령이 없으면 미어캣만 있다. 아래는 명령이 있을 때만 엄지 자리 카드 하나: 비전 상태 한 줄, 그 바로 아래 「완료」. 질문이면 위에 질문, 아래 답 단추이고, 실제 모드 가전 승인이면 위에 「기기: 까닭」, 아래 승인·취소다. 계획·할 일 이름·몇 번째 단계·판단 글은 대시보드에만 있다. 큰 단추(말하기·사진·끝내기)·상태 줄·fps·⋯ 메뉴·「나중에」·YOLO 상자와 이름표·판단 말풍선은 폰에 없다.
- 미어캣을 누르면 설정 모달(21st.dev Alert Dialog, 덮개 뿌리 안): 연결·듣기·위치 상태(위치 맞춤 중이면 「기준」 줄도), **물건 자리 맞추기**, **닫기**, 시작 자리가 있으면 **시작 위치에서 다시 맞추기**. 닫으면 초점이 미어캣으로 돌아온다.
- 문제: 일이 멈추는 문제는 모달 하나와 고치는 단추다. 연결 끊김 「다시 연결하는 중」(단추 없음, 다시 붙으면 닫힘), 마이크 꺼짐 「마이크가 꺼져 있어요」와 **마이크 켜기**(듣기를 다시 켜서 브라우저가 되면 권한을 다시 묻는다), 시작 위치 없음 「설정 화면에서 시작 위치를 정해 주세요」(단추 없음, 설정에서 저장하면 닫힘. 시작 위치 없이도 물건으로 변환이 생기면 닫힌다). 여럿이면 이 차례로 하나만 뜨고 설정 모달은 닫힌다. 추적 약함은 모달 없이 비전 상태 줄이 「추적이 약해요」가 된다. 잠깐 알릴 말(기록 실패·서버 오류)도 비전 상태 줄에 4초 뜬다.
- 시작 위치 맞추기: AR을 켜면(시작 자리가 있고 아직 시작하지 않았으면) 위 「<자리>에 서서 <보는 쪽> 쪽을 봐 주세요」, 아래 **여기서 시작**. 누르거나 말하면 닫힌다. 설정의 **시작 위치에서 다시 맞추기**로 다시 연다. 물건 자리 맞추기: 조준점과 위 「물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요」, 아래 「바닥에 닿음」과 **완료**(끝내기).
- 늘 듣기: AR 중 크롬 음성 인식(ko-KR)을 이어서 켜 두고, 끝나면 0.3초 뒤 다시 켠다. 끝난 말마다 서버로 보낸다(`say`). 폰이 명령·답을 소리로 읽는 동안은 듣기를 멈추고, 다 읽으면(끝 알림이 안 오면 2초 + 글자마다 0.3초 뒤) 다시 켠다. 마이크 권한이 없거나 마이크가 없으면 멈추고 「마이크가 꺼져 있어요」가 뜬다.
- 명령 대상: 명령마다 대상 하나(`target`: 식탁 → 집을 컵 → 싱크대 → 싱크대)가 같이 온다. 화면 안이면 아무것도 그리지 않는다(고리 없음). 위 줄·엄지 자리에 그 명령이 보일 때만(승인 대기·시작 위치 맞추기·물건 자리 맞추기 중이 아닐 때), 대상이 화면 밖이거나 화면 안이어도 위 줄·엄지 자리 칸에 가리면(칸 가장자리 23px 안 포함) 그쪽 가장자리 세모 하나(이름표 없음)를 그린다. 세모는 위 줄 아래 8px부터 엄지 자리 위 8px까지(그릴 때 두 칸을 잰다), 옆은 화면 가장자리 8px 안에 둔다. 대상 자리는 서버가 배치(물건 가운데, 식탁·싱크대처럼 윗면이 있는 면은 윗면 가운데, 싱크볼이 있는 싱크대는 윗면 높이의 싱크볼 가운데)와 World State(컵)에서 트윈 자리로 잡고, 폰 서버가 맞춘 변환으로 AR 자리로 바꾼다. 맞추기 전(어림 포함)에는 대상이 없고, 맞추면 지금 명령이 대상과 함께 다시 온다. 에이전트 초점(`FOCUS=1`)은 실제 폰 화면에 그리지 않는다.
- 폰은 세로·가로 어느 쪽으로 들어도 된다. 가로로 들어도 AR·자세·화면 보내기는 그대로이고 방향 알림은 없다(카메라 크기가 바뀌면 프레임·표시 영상 크기를 그 프레임부터 다시 맞춘다). 엄지 자리 카드는 오른쪽 아래(폭 360px까지)로 가고, 설정 모달 단추 줄은 모달 폭 안에서 줄을 바꾼다. 배치는 CSS 방향 조건(Tailwind `landscape:`)으로만 바꾼다. 화면 방향은 고정하지 않는다. 실제 모드는 전체 화면을 요청하지 않는다(WebXR AR 화면이 그 자체로 전체 화면이고, 같이 요청하면 DOM 오버레이 AR 화면이 나오지 않았다). 영상 모드는 「AR 시작」 때 페이지 전체 화면을 요청한다(영상 모드 절). 추적은 폰 위치와 카메라가 보는 방향만 쓰므로 가로·세로가 같다.
- 글 크기는 부품 원래 크기(단추는 label 토큰)이고 넓은 화면이라고 키우지 않는다. 누르는 것은 48px이다.
- 실제 폰 명령(`src/contract/phone.ts`): 실제 폰은 에이전트의 손이다. 서버는 계획 단계마다 `{type:"command", id, step, text, vision, choices, speak}`를 보낸다. `text`는 위 한 줄(사람에게 하는 명령이나 질문), `vision`은 아래 답 단추 바로 위 비전 상태 한 줄(질문이면 null), `choices`는 답 단추(단계 명령은 「완료」 하나), `speak`가 true면 소리로 읽는다(새 명령, 오래 걸려 다시 읽기). 비전 상태만 바뀌면 같은 id·step을 speak false로 다시 보낸다. 끝나면 `{type:"command_clear", id}`. 새로 붙은 폰은 상태 다음에 지금 명령(speak false)을, 명령이 없으면 id 없는 `command_clear`를 받는다. 답 단추는 `{type:"answer", id, step, choice}`로 받은 명령의 id·step을 그대로 돌려준다. 판단·관찰 글은 폰에 보내지 않는다(대시보드에만 있다).
- 화면 사진 페이지(`PHONE_SHOTS=1`로 빌드한 `/phone/shots/#상태`)는 상태 예시(`ui/src/phone/fixtures.ts`)를 그린 뒤 배치를 잰다. 화면 밖 단추, 세로 화면 아래 1/3 밖·가로 화면 오른쪽 아래(오른쪽 절반·아래 절반) 밖의 엄지 자리 단추, 옆으로 넘친 모달 내용, 조준점이나 그 칸 밖 단추를 가리는 칸(위 줄·엄지 자리, 모달 안 단추는 빼고), 잘린 명령·비전 상태 글, 칸·단추와 겹친 화면 밖 세모가 있으면 콘솔 오류를 내서 `npm run capture`가 실패한다. 처음 화면은 AR 시작 단추가 첫 화면 밖이면 실패한다. 상태는 `intro`·`intro-nostart`(시작 자리가 없는 집), 네 명령 `go-table`·`pick-cup`·`go-sink`·`put-cup`, 컵이 엄지 자리 카드 밑에 비침 `low-cup`, 명령 없음 `idle`, 추적 약함 `weak`, 문제 모달 `no-start`·`mic`·`offline`, 설정 `settings`, 카메라 못 보냄 설정 `no-camera`, 물건 자리 맞추기 `place`, 질문 `question`, 승인 `approve`·`approve-task`, 시작 위치 맞추기 `start`, 맞추는 중 `aligning`이다. 모두 세로 390×844·412×915·360×780으로 찍고, 가로는 `pick-cup`을 844×390으로, `intro`를 844×390·780×360으로 찍어 본다.
- 화면 프레임: 기본 초당 12장, 가로 촬영 가로 480px·세로 360px, JPEG 품질 0.55(`?fps=`·`?w=`로 바꾼다). 프레임 위 명령 대상 표시(`ui/src/phone/core/marks.js` `drawMarks`)는 화면 안이면 이름표만(고리 없음), 화면 밖이면 그쪽 세모와 이름표다. 인코딩은 워커 두 개로 두 장까지 겹치고, 순서가 뒤바뀐 오래된 프레임은 버린다.
- 엔진 프레임(분석용): 서버가 상태 메시지 `engine_ms`로 간격을 알려 주면 화면 프레임과 따로 그 간격마다 한 장(`kind: "engine"`, 같은 크기, JPEG 품질 0.8, 초점 고리 없음)을 보낸다. 찍은 순간 자세·투영 행렬(`projection`, 16개)·서버 시계 촬영 시각과 오차를 붙인다. 엔진 프레임은 표시 화면에 쓰지 않는다.
- 측정: 서버는 `/api/eye/stats`에 받은 fps·장당 KB를 내고, 대시보드 눈 캡션에 보인다. 실제 폰에는 측정 글이 없다.

### 말하기·'여기'·초점

- 눈 표시: 서버는 맞추기 전에도 `estimated: true` 눈을 보낸다(가장 넓은 방의 창에서 방 안쪽 0.8m·높이 1.3m, 방향만 폰을 따라감. 「여기서 시작」 뒤에는 시작 변환 자리). iframe 뷰어(다른 집·설정 4단계)는 이 눈도 원뿔로 그린다. 한양목련 구운 대시보드는 맞춘 눈만 보는 방향 원뿔로 그린다(`ui/src/twin/3d/eye.ts`): 원뿔 꼭짓점은 `height_m`, 축은 `yaw_deg`·`pitch_deg`, 추적 약함이면 원뿔이 회색이다. 원뿔은 iframe 뷰어와 같은 모양(열린 원뿔 반지름 0.32m·길이 0.9m와 꼭짓점 공)이다. 그리는 자리만 보정한다(`ui/src/twin/3d/walk.ts`): 눈 자리가 벽 속·집 밖이면 방 안, 벽에서 벽 반 두께 + 꼭짓점 공 반지름(0.11m)만큼 떨어진 자리에 세우고, 새 자리까지는 서버 경로 찾기(`src/layout/route.ts`)와 같은 문·트인 경계를 지나 걸어간다. 눈 자세 값과 World State·단계 판정은 그대로다. 원뿔은 집을 그린 뒤 깊이를 보지 않고 따로 한 번 더 그려 벽에 가리지 않는다. 말풍선·방 이름표는 원뿔이 화면에서 차지하는 상자(꼭짓점 공 ~ 넓은 끝, 보는 방향에 따라 달라짐)를 비킨다. 추정 눈은 사진의 찍은 위치에는 쓰지 않는다.

6. AR 중에는 그냥 말한다. 폰이 늘 듣는다(크롬 내장 음성 인식, 한국어, 누르는 단추 없음). 받아쓴 문장은 에이전트(세션 `phone`)로 가고, 답은 폰이 읽어 준다. 처음 화면에서는 글 입력으로 보낸다. 승인이 필요하면 엄지 자리에 승인·취소가 뜬다. 말로 승인하려면 「승인」·「승인해 줘」라고 한다. 폰이 늘 들어서 「응」·「네」·「어」로는 확정하지 않는다(대시보드 채팅은 「응」으로도 된다).
   - 실제 폰에 명령·질문이 떠 있는 동안(`BRAIN=1`, 아래 "관찰 흐름")에는 말을 먼저 그 답으로 맞춰 본다. 「그만」·「완료」·「다 했어」는 짧은 말 전체일 때만(앞의 「응」·「이제」, 끝의 「요」는 된다. 「그만큼」·「숙제 다 했어?」는 아니다) 그 답으로 받는다. 「그만」이면 계획을 그만둔다. 질문의 답은 단추 글이나 그 답의 말(`src/act/prompts.ts` `words`, 예: 「치워」·「그대로」)이 들어 있으면 받는다. 받은 답은 에이전트로 보내지 않는다. 명령의 답을 말로 하면 답 글(`reply`)은 빈 글이고 다음 명령이 따로 온다. 맞는 답이 없으면 에이전트로 간다. 답으로 받은 말과 단추 답만 기록 DB에 `feedback`(「다 했어 · 부탁: 싱크대로 가 주세요」·「그냥 그대로 둬 · 질문: 컵을 치울까요?」)으로 남아 그날 반성의 사용자 피드백이 된다.
7. 미어캣 → **물건 자리 맞추기**로 조준점을 켜고, 물건 아래 바닥을 조준점으로 가리키고 "냉장고 위치 여기로 맞춰줘"·"냉장고는 여기 있어"·"TV 여기로 옮겨줘"라고 하면 트윈의 그 물건이 조준점 자리로 옮겨진다(바닥 물건은 폰 쪽을 보게, 벽걸이는 가장 가까운 벽에 붙는다). "배치 저장해"면 수정본을 저장한다(아래 "집 고르기와 배치 보정").
8. (`FOCUS=1`일 때만) 에이전트가 다룬 물건(켠 TV, 옮긴 냉장고 등)은 8초 동안 초점이 된다. 대시보드 눈 영상과 3D 트윈에는 고리와 `클로이드 주목 · 이름`이 뜬다(명령이 떠 있을 때는 대시보드 눈 영상의 고리도 명령 대상이다). 실제 폰 화면에는 명령 대상 고리만 그린다.

- 실제 폰 명령 대상 세모와 대시보드 프레임 고리는 XR 시점의 투영 행렬로 그린다. 카메라 이미지가 그 투영과 같다고 보고 그리므로 실제 폰에서 어긋나는지 확인이 필요하다.
- AR을 켠 채로 이어서 듣기가 되는지, 다시 켤 때 크롬이 알림 소리를 내는지는 실제 폰에서 아직 확인하지 않았다.
- 폰 말에는 인증이 없다(같은 와이파이의 누구나 보낼 수 있다). 내부 테스트용이다.

## 관찰 흐름 (src/observe, src/world)

한 흐름: 폰 엔진 프레임 → YOLO 감지·관절·VLM → World State → 관찰 텍스트 → PAM(`src/brain/pam/`, `pam-predict/3`: 사람 상태와 일어난 화살표) → 서버가 화살표 행동으로 정함 → 클로이드 계획 → 실행 전 검사 → 실제 폰 단계 명령(소리) → 폰 위치·World State로 단계 확인 → 기록 DB(`noonchi.db`) → 밤 흐름(반성 `pam-reflect/3`·채택 검사) → 다음 날 기억. 사진은 PAM에 가지 않는다. `tests/noonchi-e2e.test.ts`가 가짜 OpenAI 호환 서버와 시험용 PAM 자리로 이 흐름 전체를 돌린다.

| 단계 | 코드 | 나가는 것 |
|---|---|---|
| 엔진 프레임·고리 | `src/phone/`, `src/observe/ring.ts` | `GET /api/brain` |
| YOLO 감지·관절·VLM | `src/observe/detector.ts`, `src/observe/pipeline.ts`, `src/observe/scene.ts` | `{type:"brain", event:{type:"observe"}}`, 기록 `vlm`·`yolo` |
| World State | `src/world/state/`, `src/world/pose.ts` | `{type:"world"}`, `world_change`, `GET /api/world`, 기록 `detection`·`world` |
| 판단 | `src/brain/decide.ts`, `src/brain/pam.ts` | `decision`, 기록 `pam_text`·`decision`, `GET /api/decisions` |
| 계획·검사·실행 | `src/act/` | `{type:"plan"}`, `execution`, 실제 폰 `{type:"command"}`·`{type:"command_clear"}`, 기록 `plan`·`execution`·`feedback` |
| 반성 | `src/brain/history/reflect.ts` | `reflection`, 기록 `reflection`, `POST /api/reflection/run` |

폰 엔진 프레임마다 YOLO와 VLM이 둘 다 분석하고, World State가 둘을 물체별로 합친다. 분석한 사진은 메모리(최근 20초)에만 두고 디스크에 쓰지 않는다(`DATASET_COLLECT=1`일 때만 시험 자료로 쓴다).

- **엔진 프레임:** `BRAIN=1`이면 폰 서버가 상태 메시지 `engine_ms`(`ENGINE_FRAME_MS`, 기본 100ms)로 간격을 알리고, 폰은 그 간격마다 분석용 JPEG을 촬영 자세·투영 행렬·서버 시계 촬영 시각과 함께 보낸다. 폰은 앞 분석용 사진이 아직 인코딩 중이거나 보낼 것이 512KB 넘게 쌓여 있으면 그 차례를 건너뛰고 쌓지 않는다(⋯ 메뉴 측정 줄의 「분석용 사진」 수). 표시용 사진과 같은 그림 틀에서 크기가 같으면 카메라 그림은 한 번만 읽는다. 직전 프레임과 SHA-256이 같으면 버린다(멈춘 카메라). 영상 시험에서 붙잡은 마지막 장면(헤더 `held: true`)은 같은 사진이어도 VLM 간격(`VLM_FRAME_MS`, 기본 2초)마다 새 프레임으로 받는다. `held`는 폰 서버가 내주는 영상으로 연 연결(소켓 주소 `?video=<영상>`, 그 영상이 `RUNTIME_DIR/videos/`에 있을 때)에서만 넘기고, 실제 폰 연결의 `held`는 지운다. 표시 프레임·사진은 관찰 흐름에 들어가지 않는다.
- **빠른 프레임과 VLM 프레임:** YOLO는 모든 엔진 프레임에 돌아 World State의 자리·보임을 고치고, 감지가 된 프레임마다 물체 모양을 `/events`의 `seen` 메시지(마스크·프레임 크기, 기록 DB에 넣지 않음)로 대시보드에 보낸다. 앞 VLM 프레임보다 `VLM_FRAME_MS`(기본 2초) 이상 뒤에 찍힌 프레임만 VLM 프레임이다: observe 기록(YOLO 줄·VLM 답)을 남기고 VLM에 보내며, VLM 창과 가까이 보기도 VLM 프레임만 쓴다. `observe` 기록에는 상자를 싣지 않는다. 대시보드 폰 칸은 마지막 `seen`의 마스크를 영상 위 canvas 한 장에 칠하고(네모 테두리 없음, 불투명도 0.45, 토큰 `viz.mask`: 사람 · 마시는 그릇(컵·병·그릇) · 그 밖의 물건 세 무리마다 한 색, 가전 설비는 칠하지 않음) 마스크 테두리 위에 이름·신뢰도 이름표를 붙인다. 보낼 것이 256KB 넘게 쌓인 대시보드 연결에는 `seen`을 건너뛴다. `seen`이 600ms 넘게 안 오면 지운다. 실행 추적이 가까이 보는 차례(찾기의 비추기·가까이 보기, 내용물 보류의 잘라 보기·위에서 비추기·위에서 보기)이거나 미리 세운 목표가 서 있는 동안(세움·떠남, 버리거나 계획이 시작되면 끝, `ExecutionTracker.fastVlm`)만 VLM 프레임 간격을 1초(`FAST_VLM_MS`, `VLM_FRAME_MS`가 더 짧으면 그 값)로 줄이고, 끝나면 돌아간다(늘어나는 VLM 호출은 그 차례뿐이다).
- **YOLO 감지:** YOLO26s-seg(`models/yolo26s-seg.onnx`, Ultralytics, AGPL-3.0)가 [World State 낱말 표](world-vocabulary.md)의 사람·물건 30종·가전 설비 6종(COCO 번호는 `src/world/vocab.ts`, 유리컵은 컵, 식탁·의자 같은 가구는 거름)을 워커 스레드에서 하나씩 본다. 입력은 640 가운데 레터박스(RGB 0~1, 쌍선형), 앵커마다 가장 높은 종류 하나, 같은 종류끼리 NMS(IoU 0.5), 최소 점수 0.25. World State는 종류마다 낱말 표의 최소 신뢰도(사람 0.5, 컵·병·그릇 0.4, 작은 식기 0.45, 음식·드문 물건·가전 설비 0.5) 이상만 받는다. 감지마다 물체 모양(마스크: 프로토 160×160 칸에서 상자만 자른 0/1 그림)을 같이 내고, 상자는 마스크의 바깥 테두리, 바닥 점은 마스크 가장 아래 줄의 가운데다(`src/shared/mask.ts`). JPEG은 sharp로 푼다(못 불러오면 jpeg-js). 이 PC에서 360×640 엔진 프레임 한 장에 DirectML 약 144ms, CPU 8스레드 약 218ms다(JPEG 풀기 6 + 레터박스 5 + 추론 129·204 + 마스크 3, `scripts/brain-yolo-bench.ts`). 엔진 프레임(100ms)보다 느려 빠른 프레임은 대기열에 2장만 두고 오래된 것부터 버리고(`skipped`), VLM 프레임은 모두 감지한다. nano(YOLO26n-seg, 약 72ms)는 실제 영상의 흰 머그·유리컵을 컵 기준 0.4 넘게 잡지 못해 바꿨다. 대기열(`DETECT_QUEUE_MAX`, 기본 8)이 차면 그 프레임은 「요청이 몰려 YOLO·VLM 분석 없음」, 감지가 실패하면 「감지 오류로 YOLO 분석 없음」(VLM은 그 프레임도 분석)이다. 모델 파일이 없으면 「감지기 없음」으로 VLM만 돈다. 같은 출력에서 크고 바닥에 서는 가구·가전(냉장고·싱크대·변기·침대·소파·식탁·오븐·전자레인지·TV) 상자는 폰 위치 맞추기 기준점으로도 따로 낸다(`landmarks`, 위 "위치 맞추기"). 가구는 World State에 넣지 않는다.
- **가까이 보기:** 실행 추적이 집기·놓기 단계가 8초 넘게 안 끝났다고 알리거나 판단 전 볼 면이 확인되지 않으면(없음·짐작·모름 값, 불투명이 확인된 컵의 내용물은 빼고) 관찰 모드(`src/agent/observer.ts`)가 가까이 보기·기다리기 중 하나를 고른다. 계획이 도는 동안 폰은 그 단계 명령의 것이라 관찰 모드는 폰으로 사람에게 부탁하지 않는다(사진만 쓰는 가까이 보기는 한다). 코치 계획의 다시 알리기는 모델이 알리는 방식(repeat 지금 명령 그대로, earlier 「먼저」를 붙임)만 고르고, 실행 추적이 서버 글(`src/act/labels.ts` TELL_TEXT)로 보낸다. 가까이 보기(`src/observe/pipeline.ts` `closer`)는 대상이 사진 안인 최근 엔진 프레임 5장까지(서로 다른 장이 3장 안 되면 하지 않음)를 장마다 대상 자리 둘레로 절반 크기 잘라 2배로 키워 같은 YOLO로 보고, World State에 한 번에 합친다(`applyCloser`). 물건 감지가 있는 가장 새 장 하나만 VLM에 보내고 그 답은 그 장에서 잡은 물건 사실만 넣는다. 그 VLM은 같은 주소에 `VLM_CLOSER_MODEL` 모델로 부른다(비우면 보통 프레임과 같은 `VLM_MODEL`). 맞는 물건이 없는 물건 감지는 서로 다른 원본 프레임 3장에서 같은 자리로 보이거나, 1장 이상 보이고 VLM이 그 감지에 사실을 하나 이상 답하면 확인된 새 물건이 된다. VLM이 그 감지에 사실을 답하지 않거나 가림(`not_visible`)을 함께 답하거나, 답이 없거나 끊기면 만들지 않는다. 이미 있는 물건도 가림을 함께 답한 상자의 사실은 넣지 않는다. VLM 답이 왔을 때 쓴 가장 새 사진이 지금보다 끊김 범위(`closerStaleMs`, 2초 간격이면 5초) 넘게 앞서 찍혔으면(폰 끊김) 그 답은 넣지 않고(결과 `vlm`: `no_fresh_frames`, 시도로 세지 않음) 새 물건도 만들지 않는다. 가까이 보기로 찾거나 만든 물건은 30초(`CLOSER_HOLD_MS`) 동안 전체 사진이 못 봐도 사라짐으로 세지 않는다.
- **관절:** 사람 감지(0.25 이상)가 있는 프레임만 같은 워커에서 YOLO26n-pose(`models/yolo26n-pose.onnx`)를 같은 640 입력으로 더 돌린다(추론 DirectML 약 44ms, CPU 8스레드 약 55ms). 사람이 이어서 보이는 동안에는 `BRAIN_POSE_EVERY`(기본 3)장에 한 번만 돌리고, 돌리지 않은 장은 관절 없이 넘긴다. 관절 17개 가운데 신뢰도 0.3 이상만 쓴다(`src/world/pose.ts`). 자세: 어깨·엉덩이를 이은 몸통이 수직에서 60° 넘게 기울면 누워 있음, 아니면 엉덩이·무릎을 이은 허벅지가 45° 넘으면 앉아 있음, 아니면 서 있음. 엉덩이나 무릎이 안 보이면 자세를 정하지 않는다. 손에 듦: 어느 관절이든 손목이 컵·병·그릇 상자 안이거나, 상자까지 거리 기준(어깨 너비·몸통×0.6·사람 상자 짧은 변×0.25 중 큰 값)×0.35 안이면 든 것이다. 사람 상자 넓이의 25%를 넘는 큰 물건은 손목이 상자 안일 때만 든 것이다. 마시기·따르기 사건(`src/world/sip.ts`): 든 그릇 상자가 얼굴 점(코·눈·귀 평균)에서 거리 기준×0.5 안이면 입에 댐, 든 병의 마스크 긴 축(주성분)이 그 자리 중력 방향(카메라 자세로 구함)에서 35° 넘게 기울고 중력 좌표에서 병 마스크가 그릇 마스크 위에서 옆으로 겹치며 병 아래가 그릇 위에서 위로 그릇 높이·아래로 그 절반 안이면 따름이다. 카메라 자세가 없거나 마스크가 없거나 작거나 둥글면 따름을 보지 않는다. 사건은 그 그릇의 확인 내용물을 다시 열기만 하고(새 값은 그 뒤 사진), 앞서 연 때보다 먼저 찍힌 사건은 버린다. 대시보드에는 관절을 그리지 않는다.
- **VLM:** 엔진 프레임마다 한 번 부른다. 그 프레임과 앞선 엔진 프레임을 `VLM_WINDOW_FRAMES`(기본 5장, 2초 간격이면 10초)까지 오래된 것부터 보내고, 장마다 앞에 가장 새 프레임 기준 촬영 시각(「Photo 1 of 5, t-8s」 … 「Photo 5 of 5, t-0s (latest)」)을 붙인다. 처음에 프레임이 모자라면 있는 만큼 보낸다. YOLO 감지 목록(임시 번호·종류·박스)은 가장 새 프레임 것이다. 답(`{scene, observations: [{object_id, state}], summary}`, JSON Schema)의 `observations`는 가장 새 프레임에 보이는 사실(자리·안 내용·열림·쓰는 중·화면, 사람 자세·자리·들고 있음)과 5장 사이 사람의 하는 일 하나·순간 동작 하나다. state enum과 프롬프트의 값 목록은 낱말 표에서 만든다. `summary`는 여러 장 사이에 보이는 행동·변화(집어 듦·마심·내려놓음·닦음·화면 밖으로 나감)다. 요약은 World State 변화 줄 「VLM: …」로 PAM 관찰 텍스트에 들어간다. 동시 요청은 `VLM_MAX_INFLIGHT`(기본 4)까지, 제한 시간(`VLM_TIMEOUT_MS`, 기본 20초)이 지나면 HTTP 요청을 끊는다. 답은 프레임 번호로 맞춘다. 상한 초과·시간 초과·형식 오류·호출 오류 프레임은 「… VLM 분석 없음」으로 남긴다.
- **World State:** 등장·사라짐은 장 수가 아니라 시간으로 인정한다(`src/world/confirm.ts`, 한 장 = 2초). 등장은 처음 본 뒤 사람·물건 2초 이어 보일 때, 사라짐은 마지막으로 본 뒤 그 자리가 시야 안인데 사람 4초·물건 6초 못 볼 때다(2초 간격이면 등장 2장, 사라짐 사람 2장·물건 3장). 흔들려 짧게 잡힌 물건은 등장하지 않고 잊거나, 등장했어도 6초 사라짐 셈이 정리한다. 반대쪽 프레임이 와도 셈하던 쪽을 본 지 500ms가 안 됐으면 끊지 않고, 셈하던 쪽 시간이 절반 이상이어야 인정한다. 등장 확인 전 물건은 500ms 넘게 못 보면 잊고, 트윈 자리가 있으면 그 마지막 자리를 후보 자리(`sightings`: 종류·자리·면·마지막 본 때·손에 있었는가)로 남긴다. 관절로 손에 든 채 끊긴 후보는 손에 없던 마지막 자리를, 그런 자리가 없으면 손에 든 자리를 `in_hand`로 남긴다. 후보 자리는 2분 두고 종류마다 최근 4개이며, 같은 종류 물건이 0.5m 안에 등장하면 지운다. 관절이 붙인 사실은 같은 값이 2초 이어져야 확신으로 올린다. 맞춘 뒤에는 물건 마스크의 바닥 점(가장 아래 줄의 가운데, 마스크가 없으면 박스 아래 가운데. 가까이 보기는 엔진 프레임 픽셀로 옮긴 점) 광선이 트윈의 식탁·책상·조리대·싱크대 윗면(없으면 바닥)과 만나는 점을 물건 위치로 쓰고, 같은 종류가 0.25m 안이면 같은 물체로 본다. 싱크볼이 있는 싱크대(도면 설비 `sink` 점, 평면도 `anchors.basin`)는 그 점을 가운데로 폭 0.74 × 깊이 0.44m(깊이는 배치 facing 방향) 싱크볼을 두고, 광선이 윗면 높이에서 그 안을 지나면 물건에 `surface_part: "basin"`(싱크볼 안)을 단다. 싱크볼 옆 조리대는 같은 싱크대 면이지만 싱크볼 안이 아니다. 그 자리가 시야 밖이면 「시야 밖」이고 사라짐을 세지 않는다. 맞추기 전에는 위치를 모르고 폰이 한 곳을 비춘다고 본다. VLM 사실은 면(자리·안 내용·몸통·열림·쓰는 중·화면·자세·들고 있음·하는 일·순간 동작)마다 두고 같은 값이 두 번 이어지면 확인됨이다. 그 종류에 없는 면의 값은 버린다. 컵·병·그릇 안 내용은 내용물 갱신기(`src/world/state/contents.ts`) 하나가 전체 사진·가까이 본 사진·마시기 따르기 사건·따르기 단계를 모두 받아 정한다: 서로 다른 원본 프레임 사진에서 같은 값이 3장, 처음과 마지막이 4초 넘게, 이웃 사진 사이 6초 안으로 이어져야 확인됨이다(같은 원본 프레임은 한 장, 잘라 본 답이 앞선다, 「안이 안 보임」 답은 후보가 아니다). 확인된 값은 반대 값 한 장으로 바뀌지 않고, 반대 값이 2장 이어지면 짐작으로 낮춘다(후보 충돌, 같은 값의 새 사진이 올 때까지 기억한다). 반대 값이 다 이어져도 바꾸지 않는다. 확인 값은 마시기·따르기 사건이나 계획의 따르기 단계로만 다시 열린다(이전 값은 보관, 연 뒤 찍힌 사진만 쓴다, 따르기 단계 동안은 다 이어진 새 값이 바꾼다). 확인을 받치던 사진이 같은 원본 프레임의 잘라 본 답으로 반대가 되면 다시 세어 거둔다. 위에서 본 사진(관찰 흐름 위에서 보기, 아래)은 같은 값 두 장이 1.5초 이상·6초 이하로 떨어지면 확인됨이고(`TOP_CONFIRM`, 비침·반사·불투명 몸통의 모호함이 없어 두 장), 옆 사진(전체·잘라 봄)으로 정한 확인 값을 창과 상관없이 대신한다. 다만 지금 확인보다 옛 사진은 바꾸지 않는다. 같은 원본 프레임은 위에서 본 답 > 잘라 본 답 > 전체 사진 답 차례로 덮는다. 몸통 면 「불투명」이 확인된 컵은 옆 사진의 내용물 답을 쓰지 않는다: 옆 사진으로 정한 확인 값은 거두고 위에서 본 사진만 받으며, 위에서 확인한 값이 없으면 「안이 안 보임」(확인됨)이다. 컵·병·그릇은 전체 사진 감지 상자로 크기(높이·폭, 최근 5장 가운데값, 사진 세로가 중력과 15° 넘게 어긋나거나 상자가 가장자리에 닿으면 재지 않음)를 재고, 지금 자리를 잰 카메라 반대쪽으로 반 폭 옮긴 바닥 가운데와 함께 `size_m`으로 낸다. 실행 추적이 위에서 비추는 동안 거는 보기 지킴(`guard`, 60초 한도)은 그 물건을 사라짐으로 세지 않는다(확인된 관측의 지킴 `closer_hold`와 다른 칸). 내용물 세대(`contents_gen`)는 확인 값이 정해지거나 바뀌거나 거둬지거나 다시 열릴 때 오른다. 내용물 짐작 변화는 변화 줄을 내지 않고, 확인은 판단 계기 줄, 다시 열림은 계기 아닌 줄(「컵 cup_1 마심 · 내용물 다시 확인」)이다. TV·냉장고·전자레인지·오븐·토스터·싱크대는 가전 설비라 보임·사라짐 없이 클로이드 눈의 방마다 하나(`tv_living`)에 VLM 상태만 둔다. 사람은 보인 수, 맞춘 뒤 발이 보이면 바닥 자리·방·가까운 가전(1.5m)을 둔다. 관절 사실도 같은 면에 둔다: 든 물건은 자리 「손에 있음」, 사람은 「물건을 들고 있음」(`holding`)과 자세 「서 있음·앉아 있음·누워 있음」. 서 있음에서 2초(`FALL_DROP_MS`) 안에 몸통·허벅지가 다 누운 자세가 되어 이어서 본 그 자세가 3초(`FALL_HOLD_MS`) 이어지면 자세를 「쓰러짐 의심」으로 두고 의미 있는 변화 줄 「사람 쓰러짐 의심」을 한 번 낸다(`src/world/fall.ts`, VLM에는 묻지 않는다). 기울기는 사진 세로가 아니라 엔진 프레임 카메라 자세로 구한 중력 방향에서 재고, 카메라 자세가 없거나(맞추기 전) 거의 바로 아래를 보면(`FALL_VIEW_DEG`) 보류한다. 무릎이 안 보이면 사진 경계에 잘리지 않은 상자가 중력에 가로로 길 때만 누운 자세다. 누운 자세 사이가 1초(`FALL_GAP_MS`) 넘게 끊기면 다시 본 때부터 센다. 침대·소파 위에 누운 것은 세지 않는다: 기하는 후보만 고르고(엉덩이·어깨 광선이 트윈 침대·소파의 몸 점 높이, 곧 누울 면 + 0.1~0.25m를 지나는 동안 가장자리 0.1m 안쪽을 지남. 누울 면은 카탈로그 매트리스 면이고 없으면 침대 0.55m·소파 0.45m), 빼는 결정은 그 사람을 본 VLM 자리 답이 그 가구 위(「침대 위」·「소파 위」)이고 지금 누운 구간 안에서 찍혔으며 10초 안일 때만 한다. 그 구간에 사람이 둘 넘게 보였으면 누구의 답인지 몰라 빼지 않는다. 빼는 동안에는 셈만 멈추고 서 있음에서 빨리 누운 것은 기억해, 답이 끊기면 다시 센다. 답이 없거나 「바닥」이면 그대로 센다(놓치는 것보다 잘못 알리는 것이 낫다). 이 판정은 셈을 다시 하게 할 뿐 이미 켜진 쓰러짐 의심은 풀지 않는다. 쓰러짐 의심인 동안 사람 자세는 관절만 바꾼다(VLM 자세 답은 넣지 않는다). 일어나면(서 있음·앉아 있음) 풀고, 그동안 대시보드 메시지 상자가 먼저 알린다. 신고·연락은 하지 않는다. 같은 프레임에서는 관절 사실이 VLM 답보다 앞서고, 손목이 보이는데 물건에서 떨어졌거나 사람이 안 보이게 되면 관절이 붙인 「손에 있음」만 지운다. 다만 사람이 안 보이게 될 때 든 물건이 아직 움직이고 있으면(최근 3초 동안 본 자리 가운데 지금 자리에서 트윈 자리 0.15m, 자리를 모르면 사진 가운데 점이 5% 넘게 떨어진 것이 있음) 들고 나가는 중일 수 있어 「손에 있음」을 두고, 그동안 VLM·가까이 보기의 다른 자리 답도 덮지 않는다. 움직임을 찾을 때마다 그때부터 다시 세어 3초 동안 움직임이 없으면 그때 지운다. 자리는 원본 프레임마다 하나씩 전체 감지와 가까이 보기 둘 다에서 쌓고(전체 감지가 놓치고 가까이 보기로만 보는 물건도 내려놓음을 안다), 가까이 보기 한 번의 묶음은 다 쌓은 뒤 판정한다. 앞 3초 안에 본 자리가 없으면(감지가 끊겼다 다시 봄) 그 촬영부터 정지를 센다. 보호 중인 물건은 `carried: true`다. 식기에는 관계표로 식기세척기를, 음식에는 냉장고를 붙인다. 모든 가전의 상태 키(트윈 속성 값, 예: 작동 중·멈춤·켜짐·문 열림)·바뀐 시각·이력·남은 시간(`course_min`)을 쌓고, 바뀌면 사건 줄(「후면 발코니 세탁기 세탁 멈춤」)을 낸다. 냉장고·현관문 문이 1분 넘게 열리면 판단 타이머(250ms)가 「문이 1분 넘게 열림」을 한 번 낸다.
- **카메라로 맞추는 가전 상태(src/world/sight.ts, src/devices/hub/signals.ts `observe`):** TV 화면 켜짐·꺼짐 → power, 냉장고 열림·닫힘 → door, 전자레인지 쓰는 중 → power(답에 쓰는 중이 없으면 꺼짐)와 열림·닫힘 → door(그 속성이 있는 가전만), 싱크대 물이 흐름 → faucet(답에 쓰는 중이 없으면 잠김). 오븐·토스터는 트윈 가전 종류가 없어 맞추지 않는다.
  - 고르기: 가전 설비 상자마다 그 사진을 찍은 눈의 방에서 같은 종류 트윈 가전 가운데 가운데 자리(배치 물건 가운데)가 시야 안인 것, 그중 상자 가운데 광선과 각이 가장 작은 것. 25° 넘거나 둘이 8° 안으로 붙거나 맞추기 전·방 모름·후보 없음·시야 밖이면 고르지 않고 가전 설비 `link.miss`에 까닭을 둔다.
  - 안정: 같은 값이 연속 2번(앞 값과 4초 안)이어야 허브로 넘긴다. 가림·답 없음은 값이 아니고, 시야 밖이면 마지막 상태를 그대로 둔다.
  - 우선: 실제 출처(ThinQ 읽은 값, 명령·센서 값을 받은 가상 기기)가 이긴다. 없으면(신호 없음, 읽기 전 ThinQ, 명령 받은 적 없는 가상 기기) 본 값이 기기 상태다. 기기 상태에 `vision: { twin, at, applied }`(`applied`: 본 값이 상태인가, `at`: 마지막으로 본 촬영 시각)가 붙어 3D 트윈·대시보드·에이전트가 다른 상태처럼 받는다. 실제 상태와 다르면 실제 상태를 두고 처음 한 번만 서버 로그와 World State 다름 줄(「거실 TV 카메라로는 켜짐 · 기기 값은 꺼짐」, 판단 계기 아님)을 낸다.
  - 글: 변화 줄 「주방·식당 냉장고 문 열림 · 카메라로 봄」, `[지속]` 줄 끝 「카메라로 봄, 마지막 확인 21:04:08」, 기록 DB `device` 줄도 같은 글. 대시보드 말풍선 줄 끝에 「카메라로 봄」(말풍선은 판단에서 확인한 기기에만).
  - 시야 여유(0.25)·각 기준(25°·8°)·연속 수(2번·4초)는 실제 프레임으로 아직 맞추지 않았다.
- **기록:** 프레임마다 `{type:"brain", event:{type:"observe"}}`(YOLO 글 또는 `yolo_missing`, VLM 요약 또는 `vlm_missing`)가 반드시 나가고(YOLO 결과에는 상자 `boxes`(엔진 프레임 픽셀 `[x, y, w, h]`, 감지 없음이면 `[]`)와 프레임 크기 `frame`), World State가 바뀌면 `world_change`와 `{type:"world"}`가 나간다. 상태는 `GET /api/brain`(감지기 `detector`·관절 모델 `pose`, 평균 `detect_ms`·`pose_ms`, 관절을 돌린 프레임 수 `posed`), World State는 `GET /api/world`.
- **판단 호출:** 기본(`PAM_TRIGGER=periodic`)은 5초(`PAM_PERIOD_MS`)마다 그때 World State로 PAM(`src/brain/pam/`)을 부른다. 언제 무엇을 할지는 사람 상태 FSM 기억(아래 "사람 상태 FSM 기억")이 정하므로 변화를 기다리지 않는다. PAM은 지금 사람 상태(`state`)와 이번에 일어난 화살표(`from`·`next_index`)를 답하고, 서버가 그 화살표의 행동이 지금 행동 목록에 있으면 그 행동을, 없으면 대기를 정한다(거꾸로 찾지 않는다). 요청에는 직전 판단의 상태(`last_state`, 처음이면 null: 처음 상태로 본다)를 싣는다. 행동이 붙은 화살표의 행동이 아직 시작되지 않았으면(목표가 맡음·실행 전 검사가 막음) 15초(`PENDING_EDGE_MS`) 동안 직전 상태를 그 출발 상태로 보내 같은 화살표를 다시 낼 수 있게 하고, 실행이 시작된 뒤 늦게 온 같은 화살표 답(그때까지 보낸 요청 번호 이하)은 버린다(판단 기록 `late`, 실행 기록 「앞선 판단이라 쓰지 않음」). 사람이 떠난 뒤에도 부르므로 컵이 남은 때를 판단한다. 마지막 엔진 프레임 뒤 `PAM_LIVE_MS`(10초)가 지나면 부르지 않고(폰이 없으면 호출·비용 없음, 프레임이 다시 오면 바로 다시), 사람 없음·등장 사라짐 없음이 `PAM_IDLE_STOP_MS`(30분) 이어지면 멈췄다가 등장·사라짐이 생기면 다시 부른다. 나가 있는 판단은 `PAM_MAX_INFLIGHT`(1)까지라 판단이 5초보다 오래 걸리면 끝난 뒤 바로 다음을 부른다. `event`는 World State에 의미 있는 변화(사람·물건 등장·사라짐, 물건·가전 설비 상태 변화, 사람 방, 가전 사건)가 있을 때 부른다(최소 간격 `PAM_MIN_GAP_MS`). 넘기는 것은 관찰 텍스트(최근 60초 변화 줄, 이어진 같은 줄은 「처음~마지막 글 N번」, `[지속]` 물건·가전 설비·사람(수·방·가까이·자세·하는 일)·가전(켜짐류·관련 가전·10분 안에 바뀐 것, 남은 시간), `[때]` 날짜·요일·하루 때, `[눈]` 눈이 있는 방 이름) + 기억(그날 처음 정한 기억 판본, 아래 "기록과 반성") + 행동 목록이다. 판단마다 `{type:"brain", event:{type:"decision"}}`(번호 seq, 보낸 관찰 텍스트, PAM 답, 사람 상태와 화살표 `fsm`(`FsmStep`: state·from·next_index·to·on·when·action·learned), World State 요약)이 나가고, PAM 연결 끊김·연결됨(`link`)과 판단 멈춤(「폰 사진이 오지 않아 판단을 멈춤」·「사람이 없어 판단을 멈춤」)·다시 시작(`trigger`)은 바뀔 때 한 번씩 나간다.
- **계획·검사·실행(src/act):** 고른 행동은 에이전트 계획 모드(`src/agent/planner.ts`)가 클로이드 계획으로 만든다. 행동 목록(`src/act/tasks.ts`)은 행동마다 설명과 쓸 수 있는 단계만 정한다. 모델은 `submit_plan` 한 번으로 계획 전체(단계 배열)를 내고(OpenAI는 그 함수를 지정하고 병렬 호출을 끈다, Anthropic은 생각이 늘 켜져 지정 대신 auto에 병렬 호출만 끈다), 낼 때마다 전체를 새로 검사해 틀리면 틀린 단계마다 번호와 까닭을 한 번에 돌려받아 고친 전체를 다시 낸다(모델 차례 3번, 계획 하나 45초. 2026-11-18: 첫 틀린 단계만 돌려주면 집기·놓기가 같은 실수를 해도 단계마다 한 차례씩 썼다). until 모양 오류는 틀린 자리와 까닭(「all.0.any.0.facts.place: 조건 낱말에 없는 값 "in_basin"」, `src/world/conditions.ts` `conditionProblems`)으로 돌려준다. item이 물건 이름 목록에 없으면 값 목록 대신 그 값과 「World State 물건을 집거나 놓으면 item을 쓰지 않는다」를 돌려주고, 모양이 틀린 칸을 뺀 나머지로 단계 검사도 해 같은 단계의 다른 틀린 칸(act 없음 등)을 함께 말한다. 보이는 물건 집기 앞 가기(go)는 그 물건이 놓인 자리로 가야 하고, 아니면 그 자리 id를 말하며 버린다(미리 만든 계획을 다시 낼 때도 같다). 자리는 계획 안에서 이어 간다: 그 물건을 앞 단계에서 놓았으면 그 놓은 자리, 아니면 World State 면이다. go target이 방 id면 그 방 물건 목록 맨 앞에 World State 물건이 놓인 면을 둔다. 지시문의 예는 submit_plan steps 한 칸 JSON 그대로이고, 사람 단계마다 act를 꼭 쓰고 World State 물건 집기·놓기에는 item을 쓰지 않는다(서버가 그 물건 종류 이름으로 부른다)고 말한다. 차례마다(모델 호출 하나) 계획 id·차례·시간·토큰(입력·캐시·출력·생각)·버린 까닭·모델이 낸 단계를 서버 로그 「[계획 모드] …」(틀린 단계는 JSON 그대로)와 기록 DB `planner` 줄(data에 낸 단계 전체)에 남기고, 영상 판정 시각표에는 「계획 모드」 줄로 보인다. 사람 단계(go·pick·place·do)에서 모델은 동작(act)·대상·물건(item)만 고르고, 단계 이름·폰 명령·안전 문구와 손 조작(켜기·끄기·열기·닫기)의 끝 조건은 서버가 만든다(`src/act/labels.ts` STEP_TEXT, 가전마다 할 수 있는 동작은 `src/agent/planTools.ts` DEVICE_ACTS). 알림(say) 글과 기다리기(wait) 이름은 열쇠(notice, `src/act/labels.ts` NOTICES)로, 질문(ask)의 답 단추·답 말은 답 묶음(`src/act/prompts.ts` ASK_CHOICES)으로 고르고, 모델이 쓰는 글은 질문 한 줄뿐이다(「?」로 끝남, 「주세요」·위험 가전 이름 없이). 말 요청 에이전트의 답은 위험 가전 이름 표(`src/agent/policy.ts` RISKY_ON_NAMES: 별명·흔한 오타·영어, 세 글자 이상은 띄어 써도)로만 보고 이름이 나오면 고정 글로 바꾼다. 이름 없이 조작만 말하는 답(예: 「전원 버튼을 눌러 주세요」)은 막지 못한다. 실제 `gpt-5.4-mini`로 컵 치우기 계획 한 번이 호출 1번 3~7초다(2026-11-11, 단계마다 부르던 때는 6번 12~19초). 컵 치우기는 World State의 컵(사라지지 않고 가장 최근에 본 것)을 집기 대상으로 하는 식탁·싱크대 네 단계, 물어보기는 폰 질문 한 단계다. 지시문은 물건을 놓는 단계(place)의 끝 조건을 「그 물건 자리 사실 또는 트윈 자리 조건(놓을 자리에 있고 손에 없음)」의 `any`와 사람이 그 물건을 들고 있지 않음(`not person_holding`)을 `all`로 묶어(물건 조건 `{"object": …}`은 모두 `follow`, `person_holding`에는 쓰지 않음) 쓰게 한다. 놓을 자리는 위에 놓기면 놓을 면(그 단계 target) 위, 안에 넣기(싱크대)면 그 면의 싱크볼 안(`part: "basin"`)이고, 싱크볼이 없는 자리에 넣기는 트윈 자리 조건 없이 자리 사실과 `not person_holding`만 쓴다. 계획 입력의 평면도 줄에 싱크볼 점이, World State 줄에 「싱크볼 안」이 붙는다. VLM이 자리 사실을 놓쳐도 트윈 자리로 넘어가고, 손에 든 채 지나가면 넘기지 않는다. 사람이 그 물건을 들고 있다고 보이면 자리 사실이 와도 넘기지 않는다. `person_holding`은 10초 안에 분석한 프레임에 사람이 안 보이면 거짓이고, 그 안에 분석한 프레임이 없으면 모름이라 단계가 넘어가지 않는다. 실행 추적이 옮긴 물건을 새 id로 이으면 조건은 그 id만 보고 사라진 원래 id는 보지 않는다. 실행 추적은 놓기 단계를 끝낸 물건과 그 계획의 넣은 곳(끝낸 때 그 면의 싱크볼 안이었으면 `part: "basin"`)을 남기고(`placed`), 계획 전·실행 전 검사와 대상 고르기(판단 전 가까이 보기 포함)는 그 물건을 VLM 자리 사실과 상관없이 이미 치운 것으로 본다. 놓은 물건이 사라진 뒤 같은 종류 하나가 사라진 무렵(마지막으로 본 때 2초 앞) 뒤 그 넣은 곳(싱크볼이었으면 싱크볼)에 새 id로 처음 보이면 그 물건으로 이어 간다. 원래 있던 옆 물건이나 후보가 둘 이상이면 잇지 않고, 사라진 때부터 30초가 지나면 잊는다. 지금 싱크볼 안에 있고 손에 있음이 확인되지 않은 물건은 넣은 기억이 없어도(서버를 다시 띄운 뒤, 새 id) 치운 것으로 더한다(치우기 계획 놓기 끝 자리와 같다). 계획을 끝낸 넣은 곳의 같은 종류 무리도 치운 것이다: 그 뒤 그 넣은 곳(싱크볼에 넣었으면 그 싱크볼 안, 아니면 그 면)에 있는 같은 종류 물건은 넣은 기억이 없어도(새 id로 둘 이상 잡힘·원래 있던 컵·그 뒤 들어온 컵) 손에 있음이 확인되지 않는 한 치운 것이라(그 뒤 손에 있음이 확인된 물건은 다시 쓴 것이라 풀리고, 같은 면에 도로 놓여도 무리로 돌아가지 않는다), 내용물 보기(계획 밖 가까이 가서 보기)·판단 전 보기(관찰 모드)·새 치우기 계획에서 빠진다. 계획 입력의 World State 물건 줄에는 상태 뒤에 「이미 치움」이 붙고, 제출 검사는 그 물건을 집거나 놓는 계획을 버린다. PAM 관찰 텍스트는 싱크볼 안 물건을 「<싱크대> 안 · 치움」으로 쓰고 그 물건의 VLM 자리 답(손에 있음 말고)은 [지속] 줄과 변화 줄에 쓰지 않는다. 그 뒤 손에 있음이 확인되거나(다시 집음) 트윈 자리가 그 영역을 벗어나면(다른 면, 싱크볼이면 같은 면이어도 싱크볼 밖) 지운다. 트윈 자리를 모르는 채 본 것으로는 지우지 않는다. 실행 전 검사(`src/act/check.ts`): 아는 행동, 대상 물건이 있고 이미 치운 것이 아니고 판단 뒤에 찍힌 프레임으로 다시 봤고 `STALE_MS`(기본 3초) 안, 사람이 들고 있거나 쓰는 중 아님, 이동 단계면 경로 있음, 시험 모드면 짝지은 실제 가전 단계 없음. 검사는 통과할 때까지 250ms마다 다시 보고 3초가 지나도 안 되면 그 이유로 실패한다. 검사를 막은 대상 물건의 손에 있음이 들고 감 보호(World State 물건 `carried`)에서만 왔으면(쓰는 중·사람이 그 물건을 들고 있음이 아님) 보호가 풀릴 때까지 3초를 세지 않는다. 행동 조건(`src/act/tasks.ts` `want`): 물 채우기·콜라는 비어 있음이 확인돼야 한다(조건 값은 확인됨만, 계획 끝 조건의 내용물도 확인됨만 참). 계획 전 검사는 맞는 컵이 하나라도 있으면 통과하고 다 확인된 반대 값이면 막는다(모르는 컵이 있으면 계획으로 넘긴다). 실행 전 검사는 들고 있음 뒤에 계획이 따르는 컵 전부를 보고, 반대 값이면 막고, 모르면 내용물 보류(`src/act/track/contents.ts`)가 계획을 붙잡는다: 그 컵을 관찰 모드 없이 가까이 보고(불투명 컵·자리를 모르는 컵은 건너뜀) 4초 사진을 기다린다. 그래도 모르거나 불투명한 컵이면 폰을 든 사람에게 가까이 가서 보게 한다(컵이 비었는지는 사용자에게 묻지 않는다): 지금 명령 줄에 단추 없는 사람 단계 명령 「컵 가까이 가 주세요」(go, `near_m` 0.5, 맞춘 폰 눈과 컵 바닥 가운데가 수평 0.5m 안이면 끝)를 보내고, 이어 「컵 안이 보이게 위에서 비춰 주세요」(do, `view: "above"`)를 보낸다. 위에서 비추기는 관찰 흐름이 그 컵 안을 내려다본 VLM 프레임 쌍(`topReady`: 카메라가 테두리보다 높고 먼 쪽 안벽 바닥 모서리가 가까운 테두리 위로 보이며 컵이 화면 가운데 절반 안, 컵 모양은 잰 크기로 안 반지름 0.85×min(폭, 높이)/2·깊이 높이−1cm, 모르면 반지름 3cm·깊이 15cm, 쌍은 `TOP_CONFIRM`)을 찾으면 끝나고, 명령을 거둔 뒤 그 쌍으로 위에서 보기(`topLook`)를 한다: 장마다 컵 자리를 가운데로 잘라 YOLO로 보고 그 컵 하나만 d1(잰 크기 원기둥 상자)로 VLM에 보내, 옮겨짐·답 없음·d1 가림·내용물 값이 하나로 모이지 않음(안이 안 보임 섞임 포함)·그 자리에 그릇 감지 없음·같은 종류 0.1m 안을 거른 답만 World State에 넣는다(YOLO 감지로 물건을 만들지 않는다). 위에서 비추기를 보낼 때 그 컵에 보기 지킴을 걸고 그 차례가 끝나면 푼다. 대화·끄기 안내·승인 대기·질문 중이거나 위치 맞춤이 지금 것이 아니거나(추정 눈·2초 넘게 안 옴) 컵이 사라졌거나 옮김 표시가 남았으면 명령을 거두고 풀리면 새 번호로 다시 보낸다(막힌 채 30초면 그만둠). 컵이 0.1m 넘게 옮겨지면 처음부터 하고, 명령마다 30초 한도다. 검사가 다른 까닭(들고 있음·없음)으로 막아도 명령·지킴을 거두고 30초 기다린다. 위에서 본 뒤 4초에도 모르면 「대상 물건 안을 몰라 실행하지 않아요」로 닫고 같은 컵·세대는 60초 동안 다시 가지 않는다. 확인됐지만 컵을 다시 못 봐 낡았으면 30초 기다린다. 보류에서 풀린 첫 명령은 폰 대화·승인 대기가 없을 때 보내고, 30초 넘게 막히면 「폰을 쓰는 중이라 실행하지 않아요」로 닫는다. 이번 보류에서 본 컵 내용물은 「가까이 본 뒤 다시 판단」에서 빼고 행동 조건으로 다시 검사한다. 계획이 없을 때도 판단 전 보기가 잘라 본 뒤 4초에도 모르거나 불투명한 컵은 같은 순서로 계획 밖 명령(명령 id `peek:<번호>`)을 보낸다: 행동 목록에 손대는 내용물 행동(물 채우기·콜라 따르기)이 있고, 사람이 그 컵을 쓰는 중이 아니고(아래 쓰는 중 지킴, 쓰기 시작하면 어느 차례든 거둔다), 열린·만드는 계획·끄기 안내·승인 대기·폰 대화가 없고, 지금 맞춘 눈이 있고, 사람이 보일 때 시작하며, 가까이 가기 중에는 사람이 보여야 하고 위에서 비추기·보기 중에는 안 보여도 잇는다. 새 계획을 받으면 그 계획이 명령을 쓰기 전에 거두고, 「그만」이면 어느 차례에서든 그만두고 60초 쉰다. 모르면 보기 기록만 남는다. 따르기 단계(끝 조건이 그 컵 내용물)는 그 단계 동안 그 컵의 내용물 창을 연다(따라가는 컵 id가 바뀌면 창도 옮긴다). 통과하면 계획 단계마다 실제 폰에 명령 하나를 보내고 소리로 읽는다(`{type:"command"}`, 위 "실제 폰 명령"). 컵 치우기 명령과 넘어가는 때: 「식탁으로 가 주세요」(비전 상태 「식탁까지 2.4m」, 폰 눈이 식탁에서 1.2m 안), 「컵을 들어 주세요」(「컵 · 식탁 위」, World State 컵 자리가 손에 있음이거나 사람이 물건을 들고 있음), 「싱크대로 가 주세요」(「컵 · 손에 있음 · 싱크대까지 3.1m」, 폰 눈이 싱크대에서 1.2m 안), 「컵을 싱크대에 넣어 주세요」(「컵 · 손에 있음」, 컵 자리가 싱크대 안이거나 컵이 싱크볼 안이고 손에 없고, 사람이 그 컵을 들고 있지 않으면 명령을 지우고 완료). 거리는 맞춘 폰 눈 자리에서 평면도의 식탁·싱크대 자리까지이고, 맞추기 전에는 「거리 모름」이다. 한 번 볼 때(250ms tick·World State 변화·답) 한 단계만 넘긴다. 「완료」 단추나 말 「완료」「다 했어」는 지금 단계 하나를 넘기고, 말 「그만」은 계획을 취소한다(실행 기록은 「사용자가 그만둠」). 비전 상태는 바뀔 때만 0.5초에 한 번까지 보낸다. 한 단계가 30초마다 명령을 다시 읽고 2분 안에 안 끝나면 실패로 닫는다(폰을 닫고 나가도 이렇게 끝난다). 물어보기는 같은 자리에 질문과 답 단추를 띄우고 답을 받으면 완료. 대시보드 계획의 단계 상태(진행 중·완료)가 지금 단계를 따라간다. 단계마다 `{type:"brain", event:{type:"execution", plan_id, state, text}}`(판단·계획·실행 중·완료·실패)가 나간다. 진행 중 계획과 행동·대상이 같은 판단은 「같은 행동을 진행 중」, 지금 계획보다 seq가 작은 늦은 답은 「앞선 판단이라 쓰지 않음」으로 기록만 하고, 다른 행동을 고른 판단은 진행 중 계획을 바꾼다(앞 계획은 취소, 새 계획에 `supersedes`, 실제 폰의 앞 명령은 지운다).
- **찾기(src/act/track/find.ts):** 대상 물건이 안 보여 검사가 막으면 바로 닫지 않고 마지막으로 본 자리로 폰을 든 사람을 보내 다시 본다(사용자에게 묻지 않는다). 찾기는 대상에 손을 대는 행동(`TaskSpec.touch`: 컵 치우기·물 채우기·콜라 따르기)만 한다. 사람이 그 종류를 쓰는 중이면(아래 쓰는 중 지킴) 시작하지 않고, 찾는 중에 쓰기 시작하면 명령·보기 지킴·가까이 보기를 거두고 사람이 사라질 때까지 기다린다(막힌 채 30초면 그만둔다). 계획 전 검사가 `no_target`·`in_sink`로 막았으면 계획 밖 칸(명령 id `find:<번호>`)으로, 실행 전 검사가 다시 보는 3초가 지나도 `no_target`·`stale`로 막으면 닫지 않고 그 계획 명령 줄로 막은 대상 하나를 찾는다(검사는 막은 물건 id를 `object`에 싣고, `in_sink`는 막은 대상 자신이 치운 것일 때만이다). 찾을 자리(`src/act/tasks.ts` `lostTarget`, 가장 새 것 하나)는 막은 검사의 신선도(계획 전 10초, 실행 전 3초이고 판단 뒤에 본 것만) 안에 보이지 않은 그 종류 확인 물건과 World State 후보 자리 가운데 고르고, 실행 전은 막은 그 물건 자리만 쓴다. 치운 것(놓기를 끝낸 물건과 그 옛 id 포함)·들고 감 보호였던 물건·60초 안에 찾아보고 못 찾은 자리는 뺀다. 자리가 없으면 지금처럼 그 검사 글로 닫는다. 차례: 폰 눈이 그 자리에서 수평 1m 밖이면 「식탁으로 가 주세요」(면이 없으면 「컵 있던 곳으로 가 주세요」, go, `near_m` 1.0), 안이면 「식탁 위를 비춰 주세요」(면이 없으면 「컵 있던 곳을 비춰 주세요」, do)를 단추 없이 보낸다(자리 이름은 계획 단계와 같은 평면도 이름). 대상 좌표는 그 자리이고 id는 확인 물건 id, 후보 자리면 `find_<종류>`다. 비추기는 관찰 흐름의 가까이 보기와 같은 프레임 고르기가 그 자리를 비추기 뒤 사진만으로 고를 수 있을 때(`spotReady`) 끝나고, 명령을 거둔 뒤 그 자리를 가까이 본다(보기 담당의 같은 물건 30초 건너뛰기 없이, 바쁘면 3초 뒤 다시). 찾음은 250ms마다 본다: 그 자리 0.5m 안에 그 종류 있는 물건이 그 신선도 안에 보였고 치운 것·손에 있음이 아니면 가장 가까운 하나다(둘이 0.1m 안으로 붙으면 못 가름). 비추기 뒤 사진에서 찾았지만 낡았거나 가까이 보기가 확인에 실패했으면(사진 모자람·VLM 답 없음·그 종류를 감지했지만 확정 못 함) 4초 사진을 기다린 뒤 다시 비춘다. 계획 전 찾기는 다른 계획이 열려 있거나(질문 중 포함) 만드는 중이면 시작하지 않는다. 찾으면 찾는 동안 받은 같은 행동의 가장 새 판단(그동안 같은 행동 판단은 「컵을 찾는 중이에요」로 기록만)으로 계획 전 검사부터 다시 하고, 다른 행동의 계획을 받으면 거두며, 계획 밖 가까이 가서 보기보다 먼저다. 실행 전 찾기는 막은 그 물건을 찾으면 실행 전 검사가 통과해 첫 단계로 가고(내용물 보류처럼 폰 대화·승인 대기가 있으면 첫 명령을 미루고 30초 넘으면 닫는다), 그 자리에서 다른 id의 같은 종류 물건만 찾으면 「찾은 뒤 다시 판단」으로 닫고 같은 행동 다시 계획 간격에서 뺀다. 막힘(지금 맞춘 눈 없음·판본이 맞는 폰 없음·끄기 안내·승인 대기·폰 대화·계획의 질문)이면 명령을 거두고 풀리면 새 단계 id로 다시 보낸다. 명령 하나가 30초, 막힌 채 30초, 가까이 보기가 분명히 없음(새 사진으로 보고 VLM도 답했는데 그 종류가 없음), 찾기 시작부터 60초 가운데 하나면 막은 검사의 글로 닫고 그 자리는 60초 쉰다. 「그만」이면 계획 전 찾기는 거두고 그 자리를 쉬며, 실행 전은 계획을 그만둔다. 확인 물건을 찾는 동안은 그 물건에 보기 지킴을 건다. 실행 기록은 「컵을 찾으러 가요」다.
- **지금 모드(src/act/mode.ts, 정하는 곳은 이 하나):** 평소에는 눈치 모드다. 코치 모드는 (가) 비상: 안전 알림이 유효함(사람 자세가 쓰러짐 의심, 켠 위험 가전 끄기 안내가 떠 있거나 줄에서 기다림), (나) 사람이 말로 코치 행동을 부탁함: PAM이 코치 행동을 골라 그 계획을 만드는 중이거나 열려 있을 때뿐이다. 그 코치 계획이 끝나고 비상이 풀리면 눈치 모드로 돌아온다. 서버는 이 모드를 판단 기록 `assist`(그 판단 뒤의 모드, 대기 판단도 지금 모드), 대시보드 `{type:"mode"}`(바뀔 때마다·접속 때 한 번, 말풍선 말과 같은 때 다시 본다)에 싣는다. PAM 행동 목록은 모드를 따른다: 눈치 모드는 코치가 아닌 행동, 코치 모드는 코치 행동과 「사용자에게 물어보기」. 눈치 모드에서 이번 관찰 텍스트에 사람이 한 말(「사람이 말함」)이 있으면 말로 부탁한 코치 행동을 고를 수 있게 모든 행동을 보낸다(들은 말 없이 코치 행동을 고르지 않는다).
- **계획 검사에서 버린 계획(src/act/track/start.ts):** 에이전트 계획이 계획 검사(PlanDraft)를 넘지 못하면 「계획이 맞지 않아 버림」 실행 줄의 data에 까닭(`reason`: 틀린 단계마다 번호와 이유)을 적고 서버 로그에도 「[실행 추적] plan:… 계획 버림(<행동>): <까닭>」을 남긴다. 같은 행동 다시 계획 간격(「방금 계획한 일이라 잠시 뒤 다시 봄」)은 두지 않아 다음 판단에서 바로 다시 짠다(2026-11-18 wide-glass q3).
- **손대는 단계 중 판단(src/act/track/start.ts, core.ts touching):** 진행 중 계획이 집기·내려놓기 단계이거나 집은 물건을 들고 가는 동안에는 PAM의 다른 행동 판단으로 계획을 바꾸지 않고 「물건을 다루는 중이라 새 판단을 미룸」만 남긴다(계획이 끝난 뒤 다시 판단). 가기 단계에서 만들기 시작한 다른 계획이 손대는 단계 중에 도착해도 같은 지킴으로 그 새 계획을 버리고 다음 판단에서 다시 짠다. 비상(쓰러짐 의심·끄기 안내)과 사람이 말로 한 부탁(들은 말이 든 판단)만 계획을 바꾼다. 이때 보이는 사람은 폰을 든 사람일 수 있어 쓰는 중 지킴을 새로 붙잡지 않는다(2026-11-18 wide-mug q3).
- **승인(src/agent/approval.ts):** 실제 폰으로 묻는 것은 위험 목록(현관 잠금 해제, 인덕션·전자레인지를 끄기 말고 상태를 바꾸는 명령)뿐이고 늘 묻는다(답은 이번만). 처음 하는 일이라는 까닭만으로는 묻지 않고 바로 실행한다: 설정값 `ASK_FIRST_TIME` 하나가 끔이다(2026-11-18 사용자 결정, 켜면 처음 하는 PAM 계획을 첫 단계 전에 묻고 승인은 `runtime/homes/<집>/approvals.json`에 남는다). 말로 시킨 가전 명령·질문 계획은 묻지 않는다.
- **계획이 끝난 뒤 충전 자리로(src/act/track/dock.ts):** 명령을 낸 적이 있는 계획이 끝나면(완료·그만·실패, 새 계획으로 바뀐 것은 아님) 걷지 않고 지금 자리에서 3초 보기만 한 뒤, 아는 사실(World State 사람: 보이면 그 방, 아니면 마지막으로 본 방)로 사용자 위치를 메시지 상자에 올린다(「사용자는 거실에 계세요」·「사용자를 마지막으로 거실에서 봤어요」·「사용자가 어디 계신지 몰라요」). 그다음 실제 폰에 「충전 자리로 가 주세요」 하나(명령 id `dock:<번호>`, 가기, `near_m` 1.2, 「완료」 단추)를 보내고 메시지 상자에 「충전 자리로 갈게요」를 올린다. 폰 눈이 충전 자리 1.2m 안에 들면(이미 그 안이면 명령 없이) 명령을 지우고 「충전 자리에서 지켜볼게요」로 지켜본다. 폰 눈을 모를 때(맞추기 전)는 「완료」 단추나 그 명령에 한 말 「다 했어」로 닿음을 받는다. 2분 안에 닿지 않으면 「충전 자리로 가지 못했어요」로 그만둔다. 그동안 새 행동 판단은 미루고(「충전 자리로 가는 중이라 새 일을 미룸」, 새 일은 충전 자리에서 시작한다), 사람이 말로 한 부탁(관찰 텍스트에 들은 말이 든 판단)은 복귀를 멈추고 바로 받는다(판단에 쓴 들은 말은 다시 가지 않아 미루면 사라진다). 비상(쓰러짐 의심·끄기 안내)이 오면 확인·가기를 바로 거두고 그 뒤 판단도 미루지 않는다(안전 일은 미루지 않는다). 계획 밖 가까이 가서 보기도 하지 않으며, 끝낸 대상과 그 무리는 치운 것이다. 「그만」은 충전 자리 가기도 그만둔다. 명령 줄 막힘(폰 판본·끄기 안내·승인 대기·폰 대화)이면 거두었다가 다시 보낸다. 충전 자리는 집마다 하나로 `twin/data/homes/<집>/dock.json`(`{ "version": 1, "position": [x, y] }` 평면도 자리)이고 장면과 함께 읽는다(`src/layout/scene.ts` `loadScene` `dock`, 트윈 자리 [x, 0, y]). 없거나 틀린 파일이면 충전 자리로 가지 않는다. 시연 집(한양목련)은 거실 동쪽 벽가 TV 장 남쪽의 빈 바닥 [11.3, 11.6]이다. 화면에 새 표시는 없다. 이 파일은 이 저장소 것이라 `scripts/twin-assets.ts`로 twin/을 통째로 다시 복사하면 다시 넣어야 한다.
- **쓰는 중 지킴(src/act/track/use.ts):** 사람이 손대는 행동(`TaskSpec.touch`)의 대상을 쓰는 것을 보면 사람이 모두 화면에서 사라질 때까지 그것을 붙잡고 관찰만 한다. 쓰는 중(`src/act/tasks.ts` `usingNow`, 기준은 이 함수 하나)은 사람이 보이고 그 사람이 나타난 뒤 찍힌 사진의 사실로만 본다: 마시는 중(컵·병), 그 종류나 무엇인지 모르는 물건을 듦, 그 종류 물건이나 후보 자리를 손에 든 채 봄, 그 물건·가전이 쓰는 중. 무엇을 쓰는지 알면(World State 물건 id) 그 물건만(옮김 표시로 이어진 새 물건 포함), 모르면(무엇을 들었는지 모름·확인 전 물건·후보 자리·손에 든 컵 없이 마시는 중) 그 종류 전체를 붙잡는다. 사람이 안 보이면(`person_gone`) 모두 푼다. World State는 사람을 한 묶음으로 세어 누가 나갔는지 가를 수 없으므로, 사람이 보이는 동안에는 보인 사람 수가 줄어도(같이 있던 사람만 나갔을 수 있다) 지킨다. 사라지기 전 사진의 늦은 답은 다음 등장의 근거가 아니다. 붙잡은 동안 PAM 판단은 그대로 받고, 그쪽으로 사람을 보내는 일(찾기·계획 밖 가까이 가서 보기·보류 중 가까이 가서 보기)은 자동 접근 조건(`mayApproach`: 손대는 행동의 대상이고 쓰는 중이 아님) 하나로 막으며 도는 중이면 250ms마다 보고 거둔다. 그 대상을 쓰는 계획(계획 단계가 다루는 그 종류 물건을 하나라도 붙잡았다: 채우기의 따를 컵 포함)은 첫 명령을 미루고 「사람이 쓰는 중이라 기다려요」를 한 번 남기며, 30초 넘게 이어지면 「사람이 쓰는 중이라 실행하지 않아요」로 닫는다. 풀린 뒤 첫 명령은 내용물 보류·찾기에서 풀린 계획처럼 폰 대화·승인 대기가 없을 때 보낸다. 처음 붙잡을 때 생각 말풍선에 「사람이 마시는 중이라 지켜볼게요」·「사람이 컵을 들고 있어서 지켜볼게요」를 올린다.
- **미리 세운 목표(src/act/track/goal.ts):** 쓰는 중 지킴이 사람이 쓰는 종류를 붙잡으면 사람 상태 FSM의 지금 상태(World State 하는 일로 정한 것, 없으면 마지막 판단의 상태)에서 나가는 화살표를 읽어(`src/brain/goal.ts` `goalAhead`: 자기 자신으로 가는 화살표 말고, 그 행동이 지금 행동 목록에 있고 `TaskSpec.afterUse`이며 그 종류에 손대는 행동이 하나일 때. 배우기 전 떠날 때 묻기는 목표가 아니라 목표는 배운 화살표에서만 선다) 사람이 떠난 뒤 할 일(「컵 치우기」)을 목표로 세우고, 메시지 상자에 「컵을 두고 자리를 뜨면 컵을 치울게요」 한 줄을 올리고, 목표가 선 동안 트윈의 그 컵 위에 작은 빨간 고리를 둔다. 다른 계획이 열려 있거나 만드는 중·안전 알림·충전 자리 복귀 중이면 세우지 않고, 한 등장에 한 번만 세운다. 세우면 같은 계획 모드를 목표 기록으로 한 번 불러 계획을 미리 만든다(입력에 `[미리 세운 목표]` 줄과 목표 물건(그때를 기다리거나 할지 묻는 단계 없이 그 뒤에 할 단계만 계획하게 한다), 계획 검사는 같은 종류의 다른 물건을 쓰는 단계를 버린다). 대상 컵이 면 위에 놓인 World State 물건이면 그 컵으로, 아직 손에 있거나 확정 전이면 사람이 다 쓰고 둘 자리(이번 등장에서 그 종류 후보를 손 밖에서 본 면, 아니면 사람 자리(모르면 손에 든 후보 자리)에서 가장자리까지 1.5 m 안의 가장 가까운 면, 싱크대 빼고)에 둔 대신 물건 `<종류>_0`으로 만든다(`PlanAhead.stand`, 계획 모드가 World State 물건 맨 앞에 넣는다). 둘 자리를 모르면 기다린다(2026-11-18 d1 세 판: 컵이 확정된 뒤에야 시작해 떠나기 전에 계획이 없었다). 폰에는 아무것도 보내지 않는다. 사람이 안 보이고 컵이 그대로(손에 없음) 있으면 떠난 때를 싣고 판단을 다음 판단 타이머에 바로 부른다(`Decider.nudge`, 주기 5초를 기다리지 않음). PAM이 떠난 뒤에 같은 행동을 고르면 계획 모드를 다시 부르지 않고, 모델이 낸 `submit_plan` 인자를 그 판단·지금 World State로 계획 검사에 다시 넣어(`resubmit`, 옮긴 컵은 `followed_by` 끝 id) 쓴다. 이때 미리 만든 면에 있는 목표 컵 id로 묶는다(`rename`: 대신 물건 `cup_0` → 확정된 컵, 같은 컵을 다른 id로 잡았으면 그 id). 그 면에 목표 컵이 없으면(다른 면에 놓임) 미리 만든 계획을 쓰지 않는다. 판단은 집 상태에 사람이 안 보이고 사람이 사라진 때 뒤에 보낸 것이면 받는다(목표가 컵 확정을 기다려 떠남을 늦게 내도 그 앞에 보낸 판단을 받는다, 2026-11-18 glass d1). 실행 전 검사는 떠나기 직전 2.5초(`GOAL_DEFAULTS.leaveSeenMs`) 안이나 그 뒤에 본 컵이면 떠난 뒤 사진을 기다리지 않고 다시 본 것으로 보고 낡음 한도는 보지 않는다(`seenSince`, 2026-11-18 사용자 결정: 바로 시작). 손에 있음으로 본 컵은 그대로 막는다. 떠난 뒤 사진에 그 컵이 아직 없으면 그 컵을 다루는 단계(집기) 전에 다시 본다(`Run.verify`, `Starter.held`): 떠난 뒤 사진에 있으면 그 단계로 가고, 다시 보기 기한(3초) 뒤에도 없음·낡음이면 실행 전 찾기와 같은 길로 그 자리를 찾고(「식탁 위를 비춰 주세요」), 못 찾으면 「대상 물건이 보이지 않아…」로 닫는다(사람이 마지막에 컵을 들고 나간 때). 집기로 시작하는 계획은 떠나기 전 사진만으로 시작하지 않고 실행 전 검사가 떠난 뒤 사진을 기다린다(없으면 실행 전 찾기). 대상은 실행 전 검사와 같은 기준(컵 치우기는 지금 종류: 지금 컵인 `bottle_1`도 컵 대상)으로 고른다. 목표 실행은 첫 명령 전에 안전(쓰러짐 의심·끄기 안내)을 다시 보고 비상이면 「안전 알림이 있어 시작하지 않아요」로 닫는다(받아 쓰던 미리 만들기를 기다리는 동안 목표가 떨어져 있어 목표의 안전 버림이 보지 않는다, 그때 목표는 안전 알림으로 버린다). 목표 실행은 첫 단계 전 승인을 묻지 않는다(위험 목록 가전은 그 단계에서 늘 묻는다). 폰 대화·승인 대기 중이면 첫 명령을 미룬다. 떠나기 전에 보낸 같은 행동 판단과 사람이 쓰는 동안의 같은 행동 판단은 「다 쓰고 떠나면 할 일로 두었어요」로 기록만 한다. 목표 컵이 사라져도 그 면에 같은 종류 컵이 있으면 그 컵으로 이어 간다(2026-11-18 mug d1: 한 머그를 cup_2·cup_1로 잡고 cup_2가 사라져 「들고 나감」이 났다). 버림: 들고 나감(사람이 떠난 뒤 그 면에 같은 종류 컵이 없음)·금방 돌아옴·컵이 옮겨지거나 사라짐·다른 행동의 계획이 실제로 시작함(실행 전 검사를 지나 running. 골라졌다가 계획이 막히거나 쓰는 중이라 기다리면 버리지 않는다)·안전 알림·코치 모드·충전 자리 복귀·30분·떠난 뒤 15초 안에 PAM이 고르지 않음·미리 만든 계획이 지금 검사를 못 넘음. 버리면 지금 길(PAM 판단 → 계획 모드)로 간다. 사람이 떠난 뒤(fired) PAM 답이 화살표 없이(next_index −1) 사람 상태만 목표 화살표의 출발 상태에서 도착 상태(`*`면 다른 상태)로 바꿔 와도 그 목표의 트리거로 보고 준비한 계획으로 시작한다(화살표에 when이 있으면 하지 않는다, `goal.ts` `triggerOf`, 2026-11-19 사용자 「자리 없다고 판단했는데 왜 제대로 동작을 안 해?」). 준비한 계획을 쓰지 못하고 계획 모드로 넘어가면(받아 쓰던 미리 만들기 실패·지금 판단으로 다시 검사를 못 넘음·컵이 다른 면) 그 까닭 글을 목표 `error`와 서버 로그 「[실행 추적] goal-<번호> 준비한 계획 버림(<행동>): <까닭>」에 남기고, 기록 DB 목표 줄은 「준비한 계획 버림 · <까닭>」이다(data `reason`, 실행 기록 「계획이 맞지 않아 버림」의 `reason`과 같은 칸, 버린 종류는 `drop`). 미리 만들기 실패도 「계획 못 만듦 · <까닭>」으로 남는다. 받아 쓰기의 끝 상태(씀·버림)는 그 호출이 끝난 뒤 낸다. 목표 전환은 `/brain/goal_changes`(RELIABLE, 녹화)로, 최신 보기는 `/brain/goal`(STATE)과 대시보드 `{type:"goal"}`로 나간다. 사람 사라짐 → 첫 명령은 판단 타이머 한 번(0~0.25초) + PAM 답(약 1.0~1.6초)이다.
- **화면:** 대시보드 판단 기록의 「클로이드 · 관찰과 판단」 카드에 World State 변화·연결·판단 시점 줄과 지금 YOLO·VLM 한 줄씩. 판단 줄(고른 행동·대기·판단 실패와 이유)이 카드를 닫고, 그 판단의 실행 줄은 같은 카드에 쌓인다(알약은 실행 단계). 판단 줄을 누르면 「판단 근거」가 펼쳐진다: 보낸 관찰 텍스트, 판단할 때 World State(물건마다 면, 사실별 확인됨·추정, 위치 오차, 사람·분석 없음 수), 참조한 기억 판본. 반성·연결·판단 시점은 줄 하나씩이다. 트윈 식탁 말풍선 메모는 마지막 YOLO 글이고, 열린 판단 계획의 집기 대상 물건·가전도 확인 목록에 든다.

실행(폰은 Tailscale 주소로 연다):

```bash
npx tsx scripts/brain-yolo-fetch.ts          # 저장소 models/의 YOLO26 두 파일 sha256 확인(받지 않는다)
HUB=memory HOME_ID=mokryeon_180b PHONE_PORT=8210 BRAIN=1 npm start
tailscale serve --bg 8210   # 이미 켜져 있으면 생략. 폰: https://<이 PC 이름>.<tailnet>.ts.net/phone/
```

- VLM은 `INFERENCE_MODE`가 고른 OpenAI 호환 주소로 부른다(`src/infer/vlm.ts`, chat completions + JSON Schema). openai는 OpenAI `gpt-5.4-mini`(키 `OPENAI_API_KEY`), vllm은 같은 서버 vLLM `vlm`. 2초 간격(기본)이면 시간당 약 1,800번이다. 비용은 호출마다 답의 사용량으로 세고(`src/infer/cost.ts`, `GET /api/brain`의 `vlm.costUsd`), 사진 수에 거의 비례한다.
- 키 없이 돌려 보기: `npx tsx scripts/fake-openai.ts --port 8500`을 띄우고 `VLM_BASE_URL=http://127.0.0.1:8500/v1`로 시작한다.

## 기록과 반성 (src/brain/history)

기록 DB는 `RUNTIME_DIR/noonchi.db`(SQLite 파일 하나)다. 재시작해도 남는다.

- **한 시간축(`events` 표):** 종류(`src/contract/history.ts` `HistoryKind`)마다 시각·날짜·대상·글·data를 적는다.
  - `device` 가전 값 변화(시작 상태는 적지 않음), `detection` 사람·물건 등장·사라짐, `world` 나머지 World State 변화
  - `vlm` 프레임마다 VLM 답 또는 「… VLM 분석 없음」, `yolo` 「감지 오류로 YOLO 분석 없음」·「요청이 몰려 YOLO·VLM 분석 없음」
  - `pam_text` PAM에 보낸 관찰 텍스트, `decision` 판단(고른 행동·대기·판단 실패), `plan` 계획(목표·상태), `execution` 실행 단계, `mode` 운영 모드 변경
  - `link` PAM 연결 끊김·연결됨, `trigger` 판단 멈춤·다시 시작
  - `planner` 계획 모드 차례(모델 호출 하나)마다 「계획 모드 1/3차례 2.4초 · 버림 · 2번 단계: …」(마지막 차례까지 틀리면 「· 못 냄」, 맞으면 「· 통과」). 대상은 계획 id, data는 할 일·차례·시간·토큰·낸 단계·까닭(`src/agent/planner.ts` `PlanRound`). 반성 입력이 아니다
  - `service` 외부 연락 결과(「세탁기 AS센터 전화 · 보냄」, 보냄·거절·연결 없음·실패·확인 불가·취소). 대상은 고장 난 가전 id, data는 연락 id·종류·결과·가전(실패·확인 불가면 까닭). 받는 이·고장 설명·에러 코드·사람 상태는 `KEEP_HEARD_TEXT=1`일 때만 남고, 기본은 `detail: "들은 말 있음"`이다
  - 사진은 적지 않는다. YOLO 결과는 등장·사라짐으로, 관절 사실은 World State 변화로 남는다.
- 날짜는 `HISTORY_TZ_MINUTES`(기본 서울) 기준이다.
- **하루 요약(`GET /api/history/day/{날짜}`):** 반성 입력이다.
  - 관찰 텍스트: `detection`·`world`·`device` 줄을 시각 순으로 쓰고, 맨 끝에 `[하루] VLM 분석 N장 · VLM 분석 없음 M장 · YOLO 분석 없음 K장` 한 줄. 프레임마다 쓰는 `vlm`·`yolo` 줄은 세기만 한다.
  - 행동 요약: 「클로이드 판단: …」·「클로이드 실행: …」·「사용자: …」(피드백).
  - 이어진 같은 줄은 「처음~마지막 글 N번」 한 줄로 묶는다.
  - 크기 한도를 주면 관찰 텍스트 70%·행동 요약 30%로 나누고(한쪽이 덜 쓰면 다른 쪽이 씀), 넘으면 오래된 줄부터 빼고 첫 줄에 「앞선 기록 N줄 생략」을 둔다.
- **기억 판본(`memories` 표):** 판단은 그날 처음 정한 판본을 하루 내내 쓴다(`meta` `memory_day:<날짜>`). 판본이 없으면 사람 상태 FSM seed(`CUP_FSM_MEMORY`)를 1판으로 저장한다. 판본 종류는 실행 기억(`fsm`·`list`, 판단이 PAM에 보내는 로봇 FSM)과 후보 판본(`fsm_candidates`, 다음 밤 반성의 입력)이고, 후보 판본은 실행 기억으로 뽑히지 않는다(`pinMemory`가 막는다). 옛 모양 기억(상태 안 `rules`, 2026-11-18 전)은 옮기지 않는다: 그날 쓸 판본이 옛 모양이면 지금 seed 판본(가장 새 판본이 이미 그것이면 그 판본)으로 다시 시작하고 서버 로그에 한 줄 남긴다. 그날 쓸 판본이 seed인데 내용이 지금 코드의 seed와 다르고 가장 새 판본도 seed면 지금 seed 판본을 그날에 다시 고정한다(반성 판본은 덮지 않는다).
- **사람 상태 FSM 기억(`kind: "fsm"`, `src/brain/decision.ts`):** 상태 = 사람이 하는 일 하나(`id`, `description`, World State 사람 하는 일 값 `activity`, 한 값은 한 상태에만, 자리에 없음 `away`만 빈 목록, 처음 상태는 `away`, 12개까지), 화살표 = 사람 일이 바뀜(`next`: `to` 상태 id 또는 다른 어느 일로든 `"*"`, 사람 사건 `on`, 사람 쪽 조건 `when`(같이 하는 일·자세·한 말), 행동 `action`). 행동은 화살표 위에만 하나, 행동 목록에 있는 것만이고 안 하기는 화살표 없음이다(`"*"`는 행동이 있을 때만). 물건·집 조건(컵 남음·내용물)은 기억에 넣지 않고 그 행동의 실행 전 검사가 본다. seed 행동 화살표는 사용자가 정한 습관(물 채우기(마시는 중 → 마시는 중, 조건 「식탁에 앉아 있다.」)·콜라·덥다 에어컨·코치 둘, 반성이 고치지 않음)과 떠날 때 묻기(컵 치우기를 배우기 전)다. 컵 치우기·말없이 에어컨 켜기는 배우는 습관이라 채택 검사를 지나야 화살표가 된다. 기억에 없는 활동은 임시 상태 `~<하는 일 값>`(PAM 답, 나가는 화살표 없음)으로 그날 기록에 남는다. PAM이 기억에 있는 상태 id에 ~를 붙여 오면(`~drinking`) 그 상태로 읽는다(`validateFsmPrediction`). 코드 검사(`validateMemory`)는 판단 요청·반성 직후·DB 읽기 때 모양을 본다.
- **밤 흐름(반성, `src/brain/history/night.ts` `runNight`):** 매일 `REFLECT_AT`(기본 23:30)이나 `POST /api/reflection/run`으로 돈다. 한 번에 하나만 돈다. 덩어리 기록(그날 기록 줄 → 하는 일 덩어리, 덩어리마다 그 동안의 사람 상태) → 반성(`pam-reflect/3`, 후보 FSM 종류 `fsm_candidates`: 입력은 덩어리 기록·지금까지의 후보 FSM·지난 검사 결과·피드백) → 코드 검사(`validateCandidateFsm`) → 배우지 않는 행동 후보 빼기(사용자가 정한 습관·코치) → 기억 뜻 검사(`PamClient.checkMemory`, 같은 PAM LLM: 상태가 사람이 하는 일인지·조건이 사람 쪽인지·합칠 상태) → 거절이면 까닭을 피드백에 붙여 한 번 다시 → 시각 찾기(지난 날까지, 날마다 모르는 (상태, 후보)·행동만, 사본 `runtime/homes/<집>/habit/marks-<날>.json`) → 채택 검사(`src/brain/pam/adopt.ts`: 후보 뒤 300초 창에 행동이 따라온 비율 75% 이상이고 단측 이항검정 p < 0.001, p0 = max(다른 때 비율, 0.01). 행동 때 = 사람이 직접 한 때 ∪ 로봇이 물었을 때 「치워 주세요」로 답한 때, 「그대로 둬요」 답이 있는 창은 본 것, 안 보인 구간과 로봇이 그 일을 한 구간은 못 봄) → 로봇 FSM(seed 화살표 + 통과한 배우는 행동 후보, 같은 트리거의 묻기·행동 없는 화살표 자리를 바꾸고 정한 습관 화살표는 그대로) → 코드 검사 → 저장(로봇 판본·후보 판본·반성 기록을 한 트랜잭션으로, `HistoryDb.saveNight`) → 검사 결과 사본 `habit/check-<날>.json`. 끝내 거절·실패면 새 판본을 저장하지 않고 전날 기억을 쓴다(반성 기록에 까닭).
  - `PamClient.limits()`의 `reflect_input_bytes`(`PAM_MAX_MODEL_LEN`에서 센다)에서 기억 JSON·피드백·다시 반성할 까닭·지난 검사 결과 크기를 빼고, 그 안으로 덩어리 기록과 하루 요약을 줄인다. 칸 상한(관찰 100,000·행동 50,000·피드백 8,000자)도 넘지 않게 하고, 피드백은 최근 것부터 담는다. 덩어리 답이 틀리면 하루 요약 관찰 텍스트로 반성한다.
  - 새 기억은 다음 날부터 쓴다. 다음 날 판단이 이미 다른 판본으로 시작했으면 그다음 날부터다.
  - 결과는 기록 DB(`reflection`, 검사 결과 `data.checks`)와 대시보드 판단 기록(`{type:"brain", event:{type:"reflection"}}`, 새로 배운 화살표 `learned`·쓰는 배운 화살표 `active`·뺀 후보 `dropped`)에 남는다. 그날 기록이 없으면 PAM을 부르지 않고 실패로 남긴다.
- **합성 일주일과 배운 뒤 기억:** 합성 일주일(`scripts/seed-history.ts`)은 날마다 아침 커피 뒤 한 번 컵을 두고 떠나고, 1·2일째는 묻고(답 「치워 주세요」 → 컵 치우기), 둘째 밤 채택 검사를 지나 3일째부터 바로 치운다. 말없이 에어컨은 1일째 「아 덥다」(로봇이 켬), 2·3일째 사람이 켜고, 셋째 밤 통과해 4일째부터 TV를 보기 시작하면 켠다(`memoryAfter`·`weekMarks`). 치우기를 보는 시연·영상·시험은 배운 뒤 기억(`scripts/learned-memory.ts` `LEARNED_FSM_MEMORY`: seed에서 마시는 중의 떠날 때 묻기만 컵 치우기)으로 돈다: 서버를 끈 채 `npx tsx scripts/demo-setup.ts learned --dir <서버 RUNTIME_DIR>`가 오늘 판본으로 넣고, `scripts/video-check.ts`는 영상을 틀기 전에 `GET /api/memory/day/<오늘>`의 `uses.memory`에 그 화살표가 있는지 본다(없으면 멈춤).
- **사진 보관(`photos` 표):** 디스크에는 폰 사진 찍기 사진(`photos/`, 기록 `photo`)과 `DATASET_COLLECT=1`일 때의 시험 자료(`dataset/`)만 쓴다. 시작 때와 1시간마다 보관 기간(`PHOTO_RETENTION_DAYS`·`DATASET_RETENTION_DAYS`, 기본 7일)이 지난 파일과 같은 이름의 `.json`을 지운다.

## PAM (src/brain/pam)

판단·반성은 서버 안 함수 `PamClient`다(`predict`·`reflect`·`limits`, 계약 `docs/pam-interface.md`). 띄울 서비스가 없다. 논문 프롬프트·해시표·출처 문서(`PROVENANCE.md`·`THIRD_PARTY.md`)가 같은 폴더에 있고, 고칠 곳 안내는 `src/brain/pam/README.md`다.

- PAM LLM: `INFERENCE_MODE`가 고른다(openai: OpenAI `gpt-5.4-mini`, 생각은 `reasoning_effort` 판단 none·반성 medium이고 생각을 켤 때는 temperature를 보내지 않는다 / vllm: 같은 서버 vLLM `pam`, 생각은 `chat_template_kwargs.enable_thinking`).
- 전송 값: `src/brain/pam/config/transport.json`(max_tokens 판단 2048·반성 16384, 시간 제한 120초). 다시 보내지 않고, 잘린 답은 실패다.
- 오류: 입력이 계약에 안 맞으면 `PamRequestError`, 문맥 길이를 넘으면 `PamBudgetError`(둘 다 LLM에 보내지 않는다), 답이 틀리면 `PamAnswerError`, LLM 오류·시간 초과·잘린 답은 `PamLinkError`(PAM 연결 끊김).
- 사용량: 판단·반성 기록에 `usage`(모델·토큰·비용)를 남긴다.
- 가짜 서버로 띄우기: `npx tsx scripts/fake-openai.ts --port 8500` 뒤 `PAM_LLM_BASE_URL=http://127.0.0.1:8500/v1`.
- 시험: `tests/pam-*.test.ts`, `tests/brain-pam.test.ts`(옮기기 전 Python 결과와 바이트까지 같은지는 `tests/pam-golden.test.ts`).

## 설정 흐름 (집 → 가전 → 운영 모드 → 위치 동기화 → 대시보드)

`npm start` 뒤 `http://127.0.0.1:8200/`을 열면 설정을 끝내지 않았을 때 `/setup/`으로 간다. 대시보드 **설정 다시 하기**로 언제든 다시 연다. 계획: [2026-11-05-setup-flow](superpowers/plans/2026-11-05-setup-flow.md).

1. **집 고르기**: twin-studio `homes.json`의 집. 다른 집을 고르면 서버를 끄지 않고 허브·에이전트·폰 서버·관찰 흐름을 새 집으로 다시 띄운다(포트 그대로, HUB=matter local 전송에서 약 2초).
2. **가전 선택**: 집 배치에 놓인 가전마다 **가상**(트윈 시뮬레이터 값을 읽음) 또는 **신호 없음**(상태를 「모름」으로 두고 사진·질문으로만 알아냄). 명령은 둘 다 트윈에서 실행된다. 신호 없는 기기는 에이전트·대시보드 카드·3D 뷰어 모두 새 상태를 받지 않고, 카메라로 본 상태(위 "카메라로 맞추는 가전 상태")만 받는다.
3. **운영 모드**: 아래 "운영 모드". 기본은 시험 모드.
4. **위치 동기화**: 3D에서 폰 시작 자리·방향(위 "위치 맞추기")과 배치 보정 저장·되돌리기, 폰 주소. 시작 자리를 저장해야 「완료하고 대시보드로」를 누를 수 있다(집 scene.json이 없어 못 쓰는 집은 바로).

- 고른 것은 `runtime/setup.json`(집·끝냄·모드), `runtime/homes/<id>/signals.json`(출처), `runtime/homes/<id>/thinq.json`(ThinQ 짝)에 남아 다음 시작 때 그대로 쓴다. 저장한 집이 없으면 `HOME_ID`(없으면 기본 집)로 뜬다.
- 테스트·데모(`startServer`)는 이 파일을 읽지도 쓰지도 않는다.

## 운영 모드 (시험 · 실제)

계획: [2026-11-06-control-mode](superpowers/plans/2026-11-06-control-mode.md).

- **시험 모드**(기본): 가전을 트윈에서만 다룬다(가상 Matter 기기). ThinQ를 한 번도 부르지 않는다.
- **실제 모드**: 설정에서 짝지은 에어컨·냉장고만 ThinQ로 실제 가전을 읽고 다룬다. 짝짓지 않은 기기는 가상 그대로다.
  - 읽기: 켤 때와 `THINQ_POLL_MS`마다 읽어 트윈에 비춘다. 기기 상태에 `readback: { source: "thinq", deviceId, at }`이 붙는다. 처음 읽기 전에는 「모름」(카메라로 본 상태가 있으면 그 값). 읽은 뒤에는 카메라로 본 값보다 읽은 값이 이긴다.
  - 명령: 정책(승인) → ThinQ에서 지금 상태 읽기 → 이미 같으면 보내지 않음 → 한 단계씩 보냄 → 다시 읽어 같으면 완료(`outcome: "done"`, 200). 받았지만 다시 읽은 값이 다르면 확인 안 됨(`unverified`, 202), 거부하면 실패(`failed`, 400), 지금 상태를 못 읽으면 보내지 않음(`not_sent`, 400). 같은 기기의 앞 명령이 끝나기 전 명령은 거절한다.
  - 꺼진 에어컨에 냉난방 설정을 보내면 먼저 켜고, 켜짐을 확인한 뒤 설정을 보낸다.
  - 냉장고는 문 상태만 읽는다(문 닫기 명령은 ThinQ에 없다). 실제 가전 값(센서)은 화면·API로 바꿀 수 없다.
- 토큰은 `THINQ_TOKEN` 환경변수(`.env`)에만 둔다. 로그·오류 글·응답에 나오지 않는다.
- 저장한 모드가 실제인데 토큰이 없으면 시험 모드로 뜬다.
- ThinQ 형식은 LG 공식 SDK(github.com/thinq-connect/pythinqconnect)를 따른다. 실제 연결 때 확인할 것은 계획서 「실제 연결 때 확인할 것」.

## 집 고르기와 배치 보정

twin-studio는 평면도마다 집 패키지를 하나씩 둔다(`homes.json`). twin-home은 설정에서 고른 집(없으면 `HOME_ID`)을 불러온다.

```bash
# 집 3개(apartment·oneroom·mokryeon_180b)는 twin/에 들어 있다
HOME_ID=oneroom PHONE_PORT=8210 npm start
```

1. 실제 집에 맞게 트윈을 고친다: 폰 '여기'(위), 또는 대시보드·폰 채팅("냉장고 오른쪽으로 0.5m", "공기청정기 추가해줘", "TV 빼줘"). 3D 트윈이 바로 바뀌고, 설정 3단계 배치 보정 칸에 `보정 N건 · 저장 안 함`이 뜬다.
2. "배치 저장해" 또는 설정 3단계 **배치 보정 → 저장** → `runtime/homes/<id>/edits.json`. 다시 시작해도 저장한 보정은 다시 적용된다. **되돌리기**는 저장하지 않은 것까지 모두 버린다.
3. 확정: twin-studio에서 `uv run python -m studio apply-edits --home <id> <edits.json>`(먼저 `--dry-run`으로 볼 수 있다) → `uv run python -m studio apartment --home <id> --no-render` → 이 저장소에서 `npx tsx scripts/twin-assets.ts --from <twin-studio 폴더>`로 `twin/`을 다시 채움 → twin-home 재시작. 추가한 가전은 이때부터 Matter 기기로 켜고 끌 수 있다.

- 문·창·벽·바닥·천장 고정 설비는 옮기지 않는다. 다른 물건 위에 놓는 종류(TV·전자레인지 등)는 더할 수 없고, 옮기면 받침째 옮긴다.
- 새 종류의 3D 모델은 집 산출물 → `twin/library/`(twin-studio `python -m studio library`에서 복사) 순서로 찾고, 둘 다 없으면 회색 상자로 보인다.

## 에이전트 (src/agent)

- `new Agent({ hub, policy, provider, rooms?, maxToolRounds = 6, onEvent? })`: `chat(sessionId, message)`, `confirm(token)`, `cancel(token)`, `pending(sessionId?)`, `subscribe(cb)`. 세션별 대화를 기억하고, 같은 세션 요청은 차례로 처리한다.
- **승인**: 도구가 `needsConfirmation`을 돌려주면 에이전트가 토큰을 세션에 보관하고 LLM에게는 이유만 보여 준다. LLM은 스스로 승인할 수 없다. 사용자는 화면의 승인 버튼(`POST /api/agent/confirm`)이나 같은 세션의 "응/네/확인"으로 확정하고, "아니/취소"로 취소한다.
- **도구**(`tools.ts`, 에이전트·MCP 공용, zod 스키마 + 한국어 설명): `list_rooms`, `list_devices{room?,kind?}`, `find_devices{query}`, `get_state{device_id}`, `turn_on`, `turn_off`, `set_level{percent}`, `set_climate{mode?,setpoint_c?,fan?}`, `set_covering{open_percent}`, `lock`, `unlock`, `start`, `stop`, `set_valve{open}`, `call_service{kind,to?,device_id?,problem?,error_code?,person?}`(아래 「외부 연락」). `confirm_action{token}`은 MCP에만, `call_service`·`leave_it`은 서버 안 에이전트에만 있다. `device_id`에 정확한 한국어 이름("거실 TV")도 넣을 수 있다.
  - 도구는 `ToolBackend`로 집을 다룬다. 서버 안은 `localBackend(hub, policy, rooms)`, MCP는 `httpBackend(url)`(REST)이다.
- **기기 찾기**(`search.ts`): 방 이름은 긴 것부터(안방 욕실 > 안방), 별칭(화장실 → 공용 욕실, 부엌 → 주방·식당, 베란다 → 다용도실), 종류 동의어(불 → 조명, 티비 → TV), 조사 떼기.
- **시스템 프롬프트**(`prompts.ts`, 한국어): 방·기기 목록, 승인 규칙, 센서 규칙, 방을 말하지 않으면 직전 방 → 거실, "1~2문장으로 짧게 보고". 바뀌는 상태는 넣지 않는다(캐시 유지).
- **공급자**(`providers/`)
  - `anthropic`: Messages API 도구 사용, `ANTHROPIC_MODEL`(기본 `claude-opus-5-5`). 이 모델은 thinking을 끌 수 없어 `thinking`을 보내지 않고 `output_config.effort`(`ANTHROPIC_EFFORT`, 기본 `low`)로 깊이를 정한다. 거절 대체 `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)를 기본으로 켠다.
  - `openai`: Responses API 함수 호출, `OPENAI_MODEL`(기본 `gpt-5.5`).
  - 키가 없어도 다른 공급자로 바꾸지 않는다. 부르면 요청을 보내지 않고 키가 없다고 실패한다. `/api/health` `ready.agent`(키·주소 응답)가 준비 안 됨이다.
  - 시험은 같은 OpenAI 공급자를 가짜 OpenAI 호환 서버(`tests/helpers/llm.ts`, `OPENAI_BASE_URL`)에 붙인다. 가짜 서버는 사용자 말마다 정한 도구 호출과 답을 낸다.
  - 키는 로그·응답에 넣지 않는다.

### 외부 연락 (call_service, 전화 에이전트 자리)

가전이 고장 났을 때 AS센터에 전화(상담·방문 예약)하거나, 사람 상태가 걱정될 때 보호자에게 연락하는 자리다. 실제 전화는 전화 서비스(`CALL_SERVICE_URL`)가 맡는다.

- 부르는 곳: 말로 시킨 요청(「세탁기 AS 불러 줘」)과 말 요청 에이전트가 스스로 정한 도구 호출뿐이다. PAM 행동 목록(`src/act/tasks.ts`)과 에이전트 계획 모드 단계에는 없다.
- 도구 `call_service`: `kind`(`as_center` AS센터 전화, `guardian` 보호자 연락), `device_id`·`problem`(고장 증상 80자까지)·`error_code`(에러 코드 20자까지), `person`(사람 상태 요약 80자까지). 받는 이 칸은 없다.
  - 보내는 칸은 승인 질문에 보이는 칸뿐이다: AS센터 전화는 가전·고장 설명·에러 코드(사람 상태 없음), 보호자 연락은 사람 상태뿐. 다른 칸을 넣으면 묻지 않고 모델에게 까닭을 돌려준다.
  - AS센터 전화는 가전이나 고장 설명, 보호자 연락은 사람 상태가 없으면 묻지 않고 모델에게 까닭을 돌려준다. 고장 설명·사람 상태에 위험 가전 이름(인덕션·전자레인지)이 있어도 돌려준다(가전은 `device_id`로 정한다).
- 받는 이: 서버에 등록한 연락처 `RUNTIME_DIR/homes/<집>/contacts.json`(커밋하지 않음)뿐이다. 모델은 받는 이를 정하지 못한다. 종류마다 이름(40자까지)과 번호(숫자·`+`·`-`, 없어도 됨)를 둔다. 파일이나 그 종류 칸이 없거나 틀리면 그 연락은 묻지도 보내지도 않고 실제 폰 답이 「AS센터 연락처가 등록되지 않았어요.」·「보호자 연락처가 등록되지 않았어요.」다. 틀린 칸은 시작 로그에 경고를 남긴다.

```json
{
  "as_center": { "name": "LG전자 서비스센터", "phone": "1544-7777" },
  "guardian": { "name": "딸", "phone": "010-1234-5678" }
}
```

- 승인: 부르면 늘 실제 폰으로 먼저 묻는다. 질문에 보낼 내용과 받는 이 이름이 그대로 보인다: 「세탁기: 탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?」, 가전이 없으면 「거실에서 넘어진 뒤 일어나지 못함. 딸에게 연락할까요?」. 답은 승인·거절이고 위험 목록처럼 둘 다 이번만이라 기억하지 않는다. 대기는 가전 승인과 같은 5분 제한이다.
- 승인되면 외부 API 통로(`src/infer/call-service.ts`)가 `CALL_SERVICE_URL`에 아래 JSON 하나를 `POST`한다(`content-type: application/json`, 제한 시간 10초, 스스로 다시 보내지 않음). 답 본문은 읽지 않는다.
  - 2xx: 보냄.
  - 2xx가 아닌 답, 보내기 전에 닿지 못함(연결 거부·주소 못 찾음·TLS 실패): 실패.
  - 보낸 뒤 답이 없거나(10초) 연결이 끊김: 확인 불가. 같은 내용(종류·받는 이·가전·고장 설명·에러 코드·사람 상태)의 연락이 마지막 확인 불가에서 30분 안에 다시 승인되면 같은 `id`로 보낸다. 2xx를 받아야 그 `id`를 잊는다(닿지 못함·2xx가 아닌 답으로는 잊지 않는다). 내용이 다르면 새 `id`다.
  - `id`는 보내기 전에 기억에 남긴다. 전화 서비스가 받고 답하기 전에 서버가 꺼져도 다시 띄운 뒤 같은 내용은 같은 `id`다. 앞 기억이 없는 새 연락이 닿지 못하거나 2xx가 아닌 답을 받으면 그 `id`는 잊는다. 같은 내용의 연락이 함께 승인되면 앞 것이 끝난 뒤 차례로 보낸다. 이 차례는 집 파일마다 하나라 집을 바꿔 에이전트가 둘이어도 같다.
  - 집을 닫을 때(집 바꾸기·서버 끄기) 먼저 판단·계획 진행을 멈추고 가전 명령(말·API·실행 추적)을 막는다(「집을 닫는 중이라 실행하지 않았어요.」, 새 말은 「집을 닫는 중이라 요청을 받지 않았어요.」). 진행 중인 모델 호출은 끊어(같은 답) 그 뒤에 기다리던 승인 답이 바로 차례를 받는다. 닫힌 뒤에는 모델 답의 도구를 하나도 실행하지 않고, 도구를 실행하는 중에 닫히면 남은 도구는 실행하지 않는다. 차례를 기다리던 연락은 보내지 않고 취소로 끝낸다(실제 폰 답 「AS센터 전화를 취소했어요.」, 기록 DB·메시지 상자에 취소). 보내는 중인 연락과 이미 받은 승인 답(같은 세션 차례를 기다리던 것 포함)은 기록·답 길을 열어 둔 채 끝난 뒤, 그 답(확인 불가·취소 등)을 실제 폰에 보내고 폰 연결을 닫는다.
  - 이 기억은 집마다 `RUNTIME_DIR/homes/<집>/service-retry.json`에 남아 서버를 다시 띄우거나 집을 바꿨다 돌아와도 같다. 일마다 파일을 다시 읽고 바꿔 쓰므로 같은 집 파일을 쓰는 것이 둘이어도 서로 지우지 않는다. 내용 글은 쓰지 않고 내용 해시와 `id`·때만 쓴다.
  - 이 파일이 깨졌거나 읽을 수 없으면(권한·폴더) 빈 기억으로 두지 않고 시작 로그에 경고를 남기며, 고칠 때까지 외부 연락을 묻지도 보내지도 않는다. 실제 폰 답은 「외부 연락 기록을 읽지 못해 연락하지 않았어요.」다.
- 주소가 없으면 부르지 않는다. 실제 폰 답과 대시보드 메시지 상자가 「전화 서비스가 아직 연결되지 않았어요.」다.
- 대시보드로 가는 사본(`/events`의 `agent` 행동·승인 대기·답)은 `KEEP_HEARD_TEXT`가 꺼져 있으면(기본) 받는 이·보낼 내용·승인 질문을 「들은 말 있음」으로 가린다. 모델 대화에 그 내용이 남으므로 같은 세션이 이어지는 동안 뒤 차례의 답·행동 글에서도 가린다. 실제 폰이 받는 승인 질문과 답은 그대로다.
- 결과: 실제 폰 답(보냄 「AS센터에 전화를 요청했어요.」, 거절 「AS센터 전화는 하지 않을게요.」, 실패 「AS센터에 전화하지 못했어요.」, 확인 불가 「AS센터 전화 요청이 접수됐는지 확인하지 못했어요.」), 대시보드 메시지 상자 20초(쓰러짐 의심·다시 켜짐·끄기 안내 다음 차례, 거절은 보이지 않음), 기록 DB `service` 줄.

AS센터 전화 요청:

```json
{
  "version": 1,
  "id": "6f1c2a9e-3b7d-4c1e-9a52-0d8e4f7b21c3",
  "kind": "as_center",
  "to": { "name": "LG전자 서비스센터", "phone": "1544-7777" },
  "home": { "id": "mokryeon_180b", "name": "한양목련 180B (도면 기준 · 방 4·욕실 3)" },
  "device": { "id": "washer_1", "label": "세탁기", "kind": "washer" },
  "problem": "탈수할 때 멈춤",
  "error_code": "UE",
  "person": null,
  "approved_at": "2026-11-17T10:00:00.000Z"
}
```

보호자 연락 요청:

```json
{
  "version": 1,
  "id": "0b9e7d41-58a2-4f36-8c1d-2e6a9f3b7c50",
  "kind": "guardian",
  "to": { "name": "딸", "phone": "010-1234-5678" },
  "home": { "id": "mokryeon_180b", "name": "한양목련 180B (도면 기준 · 방 4·욕실 3)" },
  "device": null,
  "problem": null,
  "error_code": null,
  "person": "거실에서 넘어진 뒤 일어나지 못함",
  "approved_at": "2026-11-17T10:00:00.000Z"
}
```

- `id`: 연락 하나의 값. 전화 서비스는 같은 `id`를 한 번만 처리하고, 이미 받은 `id`가 다시 오면 다시 전화하지 않고 2xx로 답한다. `to`: 등록한 받는 이(번호가 없으면 `null`, 전화 서비스가 정한다). `home`: 이 서버가 띄운 집. `device.kind`: 가전 종류 등록부 키(`src/devices/kinds.ts`). 없는 값은 `null`이다. `approved_at`: 사용자가 승인한 때.

## MCP (src/agent/mcp/server.ts)

stdio MCP 서버다. 에이전트 도구를 그대로 노출하고, **실행 중인 twin-home 서버**의 REST(`TWIN_HOME_URL`)를 부른다. 그래서 Claude Code나 Claude Desktop이 그대로 이 집의 에이전트가 된다. 허브가 matter면 MCP 명령도 Matter 속성을 바꾼다(e2e 테스트로 확인).

```bash
npm start                                                       # 먼저 서버를 띄운다(다른 터미널)
claude mcp add twin-home -- npx tsx src/agent/mcp/server.ts           # 이 레포 폴더에서
claude mcp add twin-home -e TWIN_HOME_URL=http://127.0.0.1:8200 -- npx tsx <저장소 폴더>/src/agent/mcp/server.ts   # 다른 폴더에서
```

Claude Desktop(`claude_desktop_config.json`)은 같은 명령을 이렇게 적는다(이 형식은 여기서 실행해 보지 않았다).

```json
{
  "mcpServers": {
    "twin-home": {
      "command": "npx",
      "args": ["-y", "tsx", "<저장소 폴더>/src/agent/mcp/server.ts"],
      "env": { "TWIN_HOME_URL": "http://127.0.0.1:8200" }
    }
  }
}
```

- 사용 예: Claude Code에서 "거실 불 켜고 TV 꺼줘" → `find_devices` → `turn_on`/`turn_off`.
- 승인이 필요한 명령(현관문 잠금 해제, 인덕션·전자레인지는 끄기 말고 상태를 바꾸는 명령 전부)은 `needsConfirmation.token`을 돌려준다. 사용자가 승인하면 `confirm_action{token}`으로 실행한다. 웹 화면의 승인 버튼으로 확정해도 된다.
- 실패는 `isError: true`와 한국어 `error`로 돌려준다. 서버가 꺼져 있으면 "twin-home 서버에 연결하지 못했습니다…"라고 알린다.
- stdout은 MCP 전용이고 로그는 stderr로 쓴다.
- 테스트(`tests/mcp.test.ts`, `tests/e2e.test.ts`)는 `node --import tsx src/agent/mcp/server.ts`를 레포 폴더에서 실제로 띄워 SDK 클라이언트로 부른다.

## Matter (src/devices/matter)

`MatterHub`가 `DeviceHub`를 matter.js 0.17.9로 구현한다. 상태의 원천은 브리지의 Matter 속성이고, twin 상태는 `src/devices/mapping.ts`로 계산한다.

| 파일 | 하는 일 |
|---|---|
| `matterHub.ts` | `MatterHub`(DeviceHub), `createMatterHub(twin, opts)`, `matterHubOptionsFromEnv()`, `isNetworkUnavailable(e)`, `info`, `openCommissioningWindow()` |
| `bridge.ts` | `createBridge(devices, opts)`: ServerNode + Aggregator + 가전마다 Bridged 엔드포인트, `formatPairingInfo()` |
| `controller.ts` | 컨트롤러 노드, 커미셔닝(`commissionBridge`), 재연결 주소, 구독 대기 |
| `deviceTypes.ts` | matter.js 기기 종류 → 엔드포인트 타입·고정 설정, `SUBSTITUTIONS`, `DEVICE_TYPE_INFO` |
| `behaviors.ts` | 기본 서버가 명령을 구현하지 않는 클러스터의 최소 behavior |
| `ops.ts` | 매핑의 `MatterOp`를 엔드포인트에 실행, 상태 읽기, 변화 구독 |
| `environment.ts` | 노드별 저장 폴더, 로그 수준, 저장소 드라이버, 신호 처리 |

### 전송

- **network**(기본)
  - 브리지(ServerNode, 기기 65개 중 Matter 기기 62개)를 UDP 5540에 올리고 mDNS로 광고한다. 듣는 주소를 정하지 않아 matter.js 기본값(모든 어댑터)으로 듣는다(`HOST`는 HTTP에만 적용).
  - 같은 프로세스의 matter.js 컨트롤러(UDP 5541)가 페어링 코드로 브리지를 커미셔닝한다(기본 `127.0.0.1:5540`으로 바로, `MATTER_DISCOVERY=mdns`면 검색). 그 뒤로는 Matter Invoke/Write/Read/Subscribe만 쓴다.
  - 커미셔닝 정보는 `.matter/`에 남아 다시 시작하면 재사용한다(`commissioning: "reused"`). 강제 종료(`taskkill /F`) 뒤에도 재사용되는 것을 확인했다.
- **local**: 브리지를 네트워크에 올리지 않고 같은 프로세스의 브리지 엔드포인트를 behavior API로 다룬다. Matter 데이터 모델(클러스터·속성·명령)은 같다. 외부 컨트롤러는 붙일 수 없다.
- **센서**(문 열림): 두 전송 모두 브리지 쪽 `BooleanState.stateValue`에 직접 쓴다. 충전 상태(로봇·무선청소기 충전대 3개)는 Matter 기기가 아니라 twin에만 있다.
- **구독**: 명령 결과와 브리지 쪽 변화(다른 컨트롤러가 바꾼 것 포함)가 모두 허브 → WS로 온다. network의 `start()`는 컨트롤러 구독이 선 뒤에 끝난다.

### Matter 페어링: Home Assistant·SmartThings 등 같은 LAN 컨트롤러에 브리지 추가

브리지는 이미 우리 컨트롤러가 커미셔닝했으므로, 다른 컨트롤러는 **페어링 창을 연 뒤** 같은 코드로 추가한다(multi-admin, 우리 컨트롤러와 함께 쓴다). 아래 순서 중 컨트롤러 앱 쪽 단계는 이 PC에서 실제 앱으로 해 보지 않았다.

1. 서버를 network 전송으로 띄운다(`npm start`). 시작 로그가 `허브 matter/network`인지 확인한다(local로 대신 떴으면 외부 페어링 불가).
2. Windows 방화벽: 처음 실행할 때 node.exe의 네트워크 허용 창이 뜨면 **개인 네트워크**를 허용한다. 직접 열려면 UDP 5540(브리지)과 5353(mDNS) 인바운드를 연다.
3. 페어링 창을 연다(기본 15분, 180~900초).
   ```bash
   curl -X POST http://127.0.0.1:8200/api/matter/commissioning-window -H "content-type: application/json" -d "{}"
   # → {"ok":true,"timeoutSeconds":900,"pairing":{"manualPairingCode":"25953912363","qrPairingCode":"MT:Y.K90YDA1327ZK2AG00",...}}
   ```
   코드는 `GET /api/matter`나 시작 로그로도 볼 수 있다. QR이 필요하면 `qrPairingCode`(MT:…) 문자열을 아무 QR 생성기로 그림으로 바꾸면 된다.
4. 컨트롤러 앱에서 추가한다. 컨트롤러는 이 PC와 같은 LAN(같은 서브넷, IPv6 링크 로컬·mDNS가 통하는 곳)에 있어야 한다.
   - **Home Assistant**: Matter 통합(Matter Server)이 필요하다. 컴패니언 앱에서 설정 → 기기 및 서비스 → 기기 추가 → Matter 기기 추가 → "이미 다른 곳에서 쓰는 기기"를 고르고 11자리 수동 페어링 코드를 넣는다. 브리지 아래에 한국어 이름(`nodeLabel`)으로 기기 62개가 생긴다.
   - **SmartThings**: 앱의 + → 기기 추가 → Matter → QR 스캔 또는 코드 입력.
   - **Apple 홈**: 액세서리 추가 → 코드 입력. "인증되지 않은 액세서리" 경고가 나오면 그대로 추가를 고른다.
   - **Google Home**: 테스트 vendor(0xFFF1/0x8000) 기기는 Google Home Developer Console에 같은 VID/PID로 통합을 만들어 두어야 추가된다.
5. 추가한 뒤 그 앱에서 끄고 켜면 브리지의 Matter 속성이 바뀌고, 구독을 통해 twin-home 웹 화면에도 바로 반영된다. 반대로 에이전트가 바꾼 상태도 그 앱에 보인다.

주의:

- vendor id가 CSA 테스트용 0xFFF1이고 인증받지 않은 기기다. 상용 앱은 경고를 띄우거나 거부할 수 있다(SmartThings는 개발자 모드·Developer Workspace 등록이 필요할 수 있다).
- passcode가 고정값(기본 20261011)이다. 창이 열린 동안 같은 LAN의 누구나 이 코드로 붙일 수 있으니, LAN에 열 때는 `MATTER_PASSCODE`를 바꾼다.
- 처음부터 다시 하려면 서버를 끄고 `.matter/`를 지운다. 컨트롤러 폴더만 지우면 브리지 창을 다시 열어 새로 커미셔닝하고(옛 패브릭은 남음), 브리지 폴더만 지우면 컨트롤러의 옛 기록을 지우고 새로 커미셔닝한다.

### 기기 종류와 대체 (deviceTypes.ts)

matter.js 0.17.9에 매핑 표의 기기 종류 21개가 모두 있어 **대체한 기기 종류는 없다**(`SUBSTITUTIONS = {}`, plan.md의 "Basic Video Player(없으면 On/Off Plug-in Unit)"도 Basic Video Player 그대로). 대신 기기 종류 정의만으로는 부족한 부분을 아래처럼 채우거나 구조를 바꿨다. 모든 엔드포인트에 `BridgedDeviceBasicInformation`(nodeLabel = 한국어 이름, uniqueId = 기기 id, reachable = true)이 붙는다.

| 기기 종류 | 채우거나 바꾼 것 |
|---|---|
| 문 센서가 있는 식기세척기·세탁기·냉장고·현관 도어록 | **구조 변경**: Contact Sensor 자식 엔드포인트 대신 같은 엔드포인트에 BooleanState를 붙였다 |
| Cooktop / Refrigerator | Cook Surface·냉장실 자식 엔드포인트, RefrigeratorAlarm은 생략 |
| Thermostat(보일러) | 매핑의 `auto`(systemMode Auto)를 받으려면 AutoMode가 필요하고 AutoMode에는 Cooling이 따라온다. Heating·Cooling·AutoMode를 켜고 `controlSequenceOfOperation = HeatingOnly`로 냉방을 막았다(deadband 0) |
| RoomAirConditioner | Thermostat(Cooling·Heating·AutoMode), FanControl(Auto) |
| AirPurifier / Fan / ExtractorHood | FanControl(Auto), fanModeSequence = Off·Low·Med·High·Auto |
| BasicVideoPlayer(TV) | 필수 MediaPlayback·KeypadInput 최소 구현 |
| MicrowaveOven | OperationalState(시작·정지·일시정지·재개), MicrowaveOvenMode, MicrowaveOvenControl(PowerAsNumber) |
| Dishwasher / LaundryWasher / LaundryDryer | OperationalState 명령 구현 |
| RoboticVacuumCleaner | RvcRunMode(0 = 대기, 1 = 청소), RvcOperationalState(Pause·Resume·GoHome → Docked) |
| WindowCovering | Lift·PositionAwareLift(goToLiftPercentage). 커튼은 Drapery, 블라인드는 Rollershade. lift 0 = 열림, 10000 = 닫힘 |
| DoorLock | PIN 기능을 켜지 않아 원격 잠금·해제에 PIN이 필요 없다. 패브릭 없이(local) 부르면 상태만 바꾼다 |
| WaterValve | ValveConfigurationAndControl Open·Close 구현 |
| 충전 상태(dock 등 3개) | Matter 기기가 아니다(`matterDeviceType: "none"`), twin 전용 |

### 저장 폴더 `.matter/` (gitignore)

- `twin-home-bridge/`와 `twin-home-controller/`가 생긴다. 기본 드라이버는 sqlite(폴더마다 파일 하나)다. Node 22의 `node:sqlite`는 실험 기능이라 실행마다 `ExperimentalWarning` 한 줄이 나온다.
- file 드라이버는 속성 하나가 파일 하나라 65개 기기면 컨트롤러 폴더만 파일 3,211개, Windows 종료에 11초쯤 걸린다(sqlite는 0.6초). 기존 file 저장소는 자동으로 옮겨진다.
- 다시 시작하면 기본으로 twin 초기 상태로 되돌린다(`keepState: true`면 마지막 Matter 상태를 이어받는다).

## 기기 목록 (파일 읽기 src/layout/twin-files.ts, 가전 만들기 src/devices/devices.ts)

- 고른 집(`HOME_ID`)의 1순위 `<out>/scene.json` objects 중 `attrs`가 있는 것. 없거나 깨져 있으면 그 집 `<data>`의 `placement.json` + `floorplan.json`의 문 + 카탈로그(`<data>/catalog` → `data/catalog` → 옛 `data/apartment/catalog`)로 만든다(`loadTwin(dir, { source: "auto" | "scene" | "catalog", home })`).
- 초기 twin 상태: scene/placement `state` > 카탈로그 `states.<attr>.default` > attr 기본값(꺼짐·멈춤·닫힘·잠김, 커튼은 열림).
- 문: 방은 twin-studio `layout.py`와 같은 규칙. 이름은 `현관문`, 나머지는 `<들어가는 방> 문`(예: `작은방 문`).
- 월패드(`wall_pad`)·CLOiD 로봇(`robot`)은 twin 전용이라 목록에서 뺀다(`TwinData.skipped`).
- 현재 데이터(2026-10-11, scene.json): 기기 65개(조명 22, 문 센서 9, 수전 4, 에어컨 4, 플러그 3, 충전 상태 3, 커튼·블라인드 3, 팬 3, 공기청정기 2, 나머지 1개씩), 방 13개.

## 기기 매핑 (src/devices/mapping.ts)

가전 종류별 값은 가전 종류 등록부(`src/devices/kinds.ts` `KINDS`) 한 곳에 있다: 이름(`label`)·찾기 말(`synonyms`)·Matter 연결(`profile`)·트윈 type(`twinTypes`)·늘 묻는 승인(`confirm`)·위험 가전 이름과 안전 문구(`riskyOn`)·손 조작(`hand`)·카메라 설비와 맞추는 규칙(`camera`)·ThinQ 짝짓기(`thinq`)·오래 이어지면 나는 사건(`longEvents`)·종류별 상태 글(`stateText`). `TYPE_RULES`(twin type → 종류)·`KIND_PROFILES`(종류 → matter.js 기기·능력·제어 attr)·`KIND_LABELS`와 에이전트·정책·카메라 쪽 표는 모두 등록부에서 파생한다. 제어 명령(잠금·커튼·난방 설정점)은 종류 이름이 아니라 프로필 모델(`profile.model`)로 가른다. 등록부 밖에 종류별 표를 새로 두면 `tests/kinds-registry.test.ts`의 구조 검사가 실패한다.

| 종류 | matter.js 기기 | 능력 | twin attr |
|---|---|---|---|
| light | `DimmableLightDevice` (다운라이트는 `OnOffLightDevice`) | onoff, level | power |
| plug | `OnOffPlugInUnitDevice` | onoff | power |
| tv | `BasicVideoPlayerDevice` | onoff | power |
| speaker | `SpeakerDevice` | onoff, level(음량) | power |
| aircon | `RoomAirConditionerDevice` | onoff, climate, fan | power |
| purifier / fan / hood | `AirPurifierDevice` / `FanDevice` / `ExtractorHoodDevice` | onoff, fan | power (on ↔ fanMode ≠ off) |
| cooktop | `CooktopDevice` | onoff | power |
| microwave | `MicrowaveOvenDevice` | operation | power (on ↔ running) |
| dishwasher / washer / dryer | `DishwasherDevice` / `LaundryWasherDevice` / `LaundryDryerDevice` | operation | running, door(센서) |
| fridge | `RefrigeratorDevice` | — | door(센서) |
| vacuum | `RoboticVacuumCleanerDevice` | operation | running |
| covering | `WindowCoveringDevice` | covering | curtain / blind |
| lock | `DoorLockDevice` | lock | lock, door(센서) |
| contact | `ContactSensorDevice` | — | door(센서) |
| valve | `WaterValveDevice` | valve | faucet / water |
| thermostat | `ThermostatDevice` | onoff, climate | heating |
| status | (Matter 기기 아님) | — | charging(센서) |

- 별칭: onoff가 없는 동작형 기기는 `on/off` → `start/stop`, 밸브는 `on/off` → `valve{open}`. 정책도 바뀐 명령으로 판단한다.
- 안전: 문이 열린 식기세척기·세탁기는 시작하지 않는다. 동작 중이 아니면 일시정지하지 않는다.
- 에어컨·보일러에 `climate` 명령을 주면 켠다. 조명 `level > 0`은 켜고 `0`은 끈다.
- 카탈로그가 없는 트윈 type(`added_devices.json`으로 더한 새 종류)은 등록부 프로필의 제어 attr(`[꺼짐, 켜짐]`)과 센서 attr로 상태를 만든다(`profileAttrs`). 모델 파일이 없으면 장면 물건의 `asset`이 null이라 대시보드 트윈이 그 자리에 회색 상자(`footprint`·`height`, 없으면 0.4m)로 그린다.
- Matter 요약 키(`DeviceState.matter`): `onOff`, `level`(%), `systemMode`, `setpointC`(°C), `fanMode`, `operationalState`, `runMode`, `openPercent`(100 = 열림), `lockState`, `valveState`, `stateValue`(문 센서, true = 닫힘).

### 새 종류 추가하는 법

1. `src/devices/kinds.ts`의 `KINDS`에 항목 하나를 더한다: `label`(이름), `synonyms`(찾기 말), `profile`(Matter 기기 종류·기능·제어 속성·센서), `twinTypes`(트윈 type 이름). 사람이 손으로 조작하면 `hand`, ThinQ와 짝지으면 `thinq`. 필수 칸을 빼면 타입 오류가 난다.
2. 집 파일 `twin/data/homes/<집>/added_devices.json`에 한 줄을 더한다: `id`·`type`(1번 `twinTypes`의 이름)·`label`·`room`·`position`·`facing_deg`·`elevation`.
3. 카메라로 볼 수 있으면: YOLO(COCO)에 그 종류가 있으면 `src/world/vocab.ts` `CLASSES`에 설비 종류(role fixture)를 두고, 등록부 항목에 `camera: { fixture, sight }`를 적는다.
4. 3D 모델이 없으면: 카탈로그(`twin/data/catalog/<type>.json`)나 모델 파일이 없어도 기기는 생기고, 대시보드 트윈에는 그 자리의 회색 상자로 보인다. 모양을 넣으려면 카탈로그와 `twin/library/assets/`의 모델을 더한다.
5. 불·열이 나는 가전은 `riskyOn`과 `riskyReason`을 둔다(끄기 말고 상태를 바꾸는 명령은 전부 승인 질문). 잠금 해제처럼 명령 하나만 승인하려면 `confirm`에 그 명령 이름을 적는다(정규화로 이름이 바뀌는 on·off는 쓰지 않는다). ThinQ로 짝지으려면 이미 있는 어댑터(`air_conditioner`·`refrigerator`) 가운데 받는 명령이 맞는 것을 `thinq.adapter`로 고르고, 맞는 어댑터가 없으면 `src/devices/thinq/appliance.ts`에 어댑터를 먼저 더한다. 틀린 조합은 서버 시작 때 `checkKinds`가 까닭과 함께 막는다.
6. `npm run heavy -- npx vitest run tests/kinds-registry.test.ts tests/kinds-behavior.test.ts`로 확인한다.

## 승인 정책 (src/agent/policy.ts)

- 승인 대상 판정은 `needsConfirm` 하나다: 위험 켜기 종류(등록부 `riskyOn`: 인덕션·전자레인지)는 그 기기 사양으로 정규화한 명령이 끄기(`off`·`stop`)가 아니면 모두(켜기·시작·세기 등, 덮어쓴 capabilities여도), 그 밖에는 등록부 `confirm` 명령(현관문 잠금 해제). 승인 토큰이 있어야 실행한다. 정책·손 조작 켜기 질문(`riskyHand`)·계획 입력과 에이전트 지시문의 위험 목록 글이 모두 이 판정과 등록부에서 나온다.
- 서버는 시작 때 등록부를 검증한다(`src/devices/kinds-check.ts` `checkKinds`): confirm 명령이 모든 사양에서 정규화해도 같은 이름인지, 위험 켜기 종류에 confirm 대신 riskyReason이 있는지, ThinQ 어댑터가 그 종류의 모든 사양 명령을 받는지(읽기만 하는 어댑터에는 제어 없는 프로필만), 손 조작이 제어·문 센서·카메라 열림 면과 맞는지. 틀리면 까닭과 함께 시작을 멈춘다.
- `policy.guard(hub, id, cmd, confirmToken?)`: 실행할 수 없는 명령은 바로 오류. 승인이 필요하면 `{ ok: false, needsConfirmation: { token, reason } }`(서버는 409). 토큰은 한 번만 쓰고 5분 뒤 만료된다.
- `policy.confirm(hub, token)`: 토큰만으로 대기 중인 명령을 실행한다(화면 승인 버튼).
- `policy.askService(call)`: 외부 연락(`call_service`) 승인 대기를 만든다. 늘 묻고 승인 기억을 보지도 남기지도 않는다. `services()`·`takeService(token)`으로 읽고 꺼낸다. 시간 제한·멈춤(`pause`)은 가전 명령 대기와 같다.

## 테스트

`npm test`는 11개 파일을 돌린다(이 PC에서 약 1분 반, 실제 UDP 커미셔닝 포함). 이 중 `tests/devices.test.ts`의 catalog 전용 초기값 검사 1개는 scene 데이터일 때 건너뛴다.

| 파일 | 다루는 것 |
|---|---|
| `mapping`, `devices`, `memory`, `policy` | 매핑 표, twin 데이터 읽기(실제 twin-studio 데이터 포함), MemoryHub, 승인 토큰 |
| `agent` | 도구, 기기 찾기, 가짜 OpenAI 호환 서버로 한국어 요청 시나리오·승인·세션 기억, 공급자 선택(키가 없어도 바꾸지 않음), 공급자 배선(가짜 API로 요청 모양 확인) |
| `server` | REST·WS(임의 포트), CORS, Matter 정보·페어링 API |
| `twin-sync` | 3D 트윈 → `POST /api/devices/:id/twin`: `twinChange` 매핑(명령·센서·오류), 정책 409 + `/api/agent/confirm`, `confirmToken`, 없는 attr·값 400, 뷰어 출처 CORS |
| `mcp` | MCP stdio 서버를 실제로 띄워 SDK 클라이언트로 호출 |
| `start` | HUB 기본값 matter, network → local → memory 대체 경로 |
| `matter` | 모든 기기 종류의 엔드포인트·명령(local), 실제 커미셔닝·구독·재사용·multi-admin 창(network) |
| `homes`, `layout-editor`, `layout-agent`, `layout-server` | homes.json 읽기·카탈로그 순서, 배치 편집기(옮기기·받침·벽 붙이기·더하기·빼기·되돌리기·수정본·재적용), 배치 도구·가짜 서버의 배치 말, REST·WS |
| `phone-session`, `phone-server`, `phone-project`, `focus` | 폰 '여기'·트윈→AR, 말·승인·초점 전달, 초점 투영, `HOME_ID` 통합(폰 "냉장고 위치 여기로 맞춰줘" → layout·focus·저장) |
| `react` | 추론 과정: 서버 안 에이전트 도구의 필수 reason(MCP에는 없음), 실행 전 떼기, 관찰 문장 |
| `e2e` | `startServer()`(npm start 경로)로 실제 기기 65개 MatterHub를 띄우고: 데모 시나리오를 REST 에이전트로 돌려 **브리지의 Matter 속성**(`onOff`, `occupiedCoolingSetpoint`, `currentPositionLiftPercent100ths`, `lockState`)과 WS 이벤트를 확인, MCP 클라이언트로 `turn_on`·`unlock`→`confirm_action`, network 전송으로 같은 흐름 + 기기 쪽 변경이 구독으로 WS까지 오는지 + 페어링 창, 커미셔닝 제한 시간 초과 → local 대체 |

## 제한 사항

- **외부 Matter 컨트롤러로는 아직 해 보지 않았다.** 페어링 창이 열리는 것(`windowStatus ≠ 0`)까지는 테스트하지만, Home Assistant·SmartThings 앱으로 실제 추가한 적은 없다. 인증받지 않은 테스트 vendor(0xFFF1)다.
- **실제 LLM 호출을 해 보지 않았다.** 키가 없어 anthropic·openai 공급자는 가짜 HTTP API로 요청·도구 루프 모양만 확인했다. 키가 없으면 에이전트가 준비 안 됨이다.
- `DeviceState.online`은 항상 true다(브리지 연결 상태를 따르지 않는다).
- local로 대신 뜨면 외부 컨트롤러를 붙일 수 없다(시작 로그의 `[경고]`와 `/api/health`의 `transport`로 알 수 있다).
- 시작 시간: 기기 65개 network는 보통 7~10초. 이 PC에 무거운 작업(Blender 빌드 등)이 돌 때는 local도 30초, network 재시작이 2분 가까이 걸린 적이 있다. 커미셔닝 단계별 제한 시간(`MATTER_COMMISSION_TIMEOUT_MS`)은 한 단계에 적용되므로 전체 시작은 그보다 길 수 있다.
- HTTP API에 인증이 없다. 기본 `HOST=127.0.0.1`로만 연다.
- twin-studio `apartment/scene.json`의 초기 `state`를 그대로 쓴다. 지금 scene.json(카탈로그 수정 전 빌드)은 식기세척기·세탁기·건조기·로봇청소기가 `running: true`로 들어 있어 처음 띄우면 넷이 "동작 중"이다. twin-studio가 scene.json을 다시 빌드하면 바뀐다(카탈로그는 이미 `[false, true]`).
- 종료: Ctrl+C(SIGINT)는 서버의 종료 처리(HTTP → 브리지 → 컨트롤러 순)를 탄다. 작업 관리자·`taskkill /F`로 죽이면 정리 없이 끝나지만, 저장소는 다음 시작에 그대로 쓰였다(이 PC에서 확인).
- 웹 화면의 바람 세기 목록으로는 끌 수 없다(전원 스위치를 쓴다).
- 3D 트윈은 twin attr(켜짐·열림·잠김 등 두세 값)만 맞춘다. 밝기·설정 온도·바람 세기·커튼 열림 %는 3D에 없다. 3D에서 커튼을 "열림"으로 바꾸면 100%, "닫힘"은 0%다.
- 뷰어 승인 알림은 뷰어 안에만 뜬다(웹 화면 대화의 승인 카드와 따로). 웹 대화에서 나온 승인 대기는 뷰어에 뜨지 않는다.
- **조명이 켜지고 꺼질 때 화면이 멈춘다.** 뷰어는 조명을 켤 때 three.js 광원을 장면에 더하고 끌 때 뺀다(twin-studio `states.mjs`의 `refreshLight`). 광원 수·종류 조합이 처음 나올 때마다 three.js가 셰이더를 다시 만든다(한 번에 프로그램 약 17개 추가). 그동안 뷰어의 메인 스레드가 막히고, 같은 출처 iframe이라 twin-home 웹 화면(대화·카드)도 함께 멈춘다. 이 PC의 GPU(AMD Radeon, ANGLE D3D11)에서 잰 값:
  - 셰이더 캐시가 비어 있을 때: 프레임 사이 최대 10~15초.
  - Chrome GPU 디스크 캐시가 찬 뒤: 최대 약 0.7초, 3D에 보이기까지 3.5~5초.
  - 이미 나온 조합: 약 0.1초.
  - 헤드리스 SwiftShader: 9~18초.

  조명과 상관없는 변경(클릭·채팅 → 3D)은 33~220ms, 에이전트 응답을 기다리는 경우 약 1.3초였다. 고치려면 뷰어에서 광원 수를 고정해야 한다(불러올 때 광원을 미리 만들고, 끌 때는 빼지 말고 intensity만 0으로). twin-studio 뷰어 쪽 일이다.

### 문제 해결

- `EADDRINUSE`(UDP 5540): 다른 twin-home이 떠 있다. 끄거나 `MATTER_PORT`를 바꾼다. 그대로 두면 local로 대신 뜬다.
- 로그에 `getaddrinfo ENOTFOUND fe80::…%`: Tailscale 같은 가상 어댑터의 영역 없는 IPv6 주소를 mDNS가 광고해서 생기는 경고다. 동작에는 지장이 없다(다음 주소까지 기다림을 1초로 줄였다). 거슬리면 `MATTER_MDNS_NETWORKINTERFACE`로 실제 LAN 어댑터만 쓰게 한다.
- `listen EFAULT: bad address in system call argument 127.0.0.1` / `connect EFAULT`: 이 PC에서 **IPv4** bind·connect가 가끔 이 Winsock 오류로 실패한다. 순수 Node 스크립트로 재 보면 `127.0.0.1` listen(0)이 300번에 5~44번(HTTP+fetch를 섞으면 2000번에 909번) 실패했고, `::1`·`localhost`는 0번이었다. 원인은 확인하지 못했다(Winsock을 가로채는 보안 프로그램을 의심). 그래서 `src/shared/net.ts`의 `listenRetry`(서버 listen, 최대 6번)와 `fetchRetry`(연결 단계 EFAULT만, 최대 4번, MCP REST 클라이언트·테스트가 씀)가 EFAULT일 때만 다시 시도한다. 포트가 쓰이고 있으면(`EADDRINUSE`) 다시 시도하지 않고 바로 실패를 알린다.
- `Channel is closed`: 한 피어에 동시 교환이 많을 때 matter.js가 오래된 것부터 닫는다. 시작 때 읽기를 3개씩만 보내도록 해 두었다.

## 개발 규칙

- TypeScript strict, ESM, `tsx`로 실행, `vitest`로 테스트(TDD). import 경로는 `.js` 확장자로 쓴다.
- 사용자에게 보이는 문자열(에이전트 답, 화면, 오류)은 한국어.
- API 키는 출력·커밋하지 않는다(`.env`는 gitignore).
