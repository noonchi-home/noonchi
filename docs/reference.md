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
src/
  hub/types.ts          DeviceSpec·DeviceState·Command·DeviceHub (공용 계약)
  hub/memory.ts         MemoryHub: Matter 없이 메모리에서 동작하는 DeviceHub (테스트·HUB=memory)
  matter/               MatterHub: matter.js 브리지(가상 가전) + 컨트롤러 (아래 "Matter")
  model/mapping.ts      twin type/attrs ↔ Matter 기기·클러스터 매핑 표와 변환 함수
  model/devices.ts      twin-studio 데이터 → DeviceSpec[] + 초기 상태
  agent/                도구 호출 루프(agent.ts), 도구(tools.ts), 기기 찾기, 승인 정책(policy.ts), 공급자(providers/)
  server/start.ts       시작 순서: twin 데이터 → 허브(대체 경로 포함) → 정책·에이전트 → HTTP/WS
  server/hubFactory.ts  HUB 고르기, startHub(network 실패 → local → memory)
  server/app.ts         REST + WebSocket + 정적 파일
  server/main.ts        npm start 진입점(.env, 출력, 종료 신호)
  mcp/                  MCP stdio 서버(server.ts)와 REST 백엔드(client.ts)
ui/                     대시보드·설정·폰 화면(React+TypeScript, 빌드 결과 ui/dist/)
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

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `AGENT_PROVIDER` | (자동) | `openai` / `anthropic`. 비우면 `ANTHROPIC_API_KEY`가 있으면 anthropic, 없으면 openai. 키가 없어도 다른 공급자로 바꾸지 않는다: 시작 로그에 경고, 에이전트는 준비 안 됨(`/api/health` `ready.agent`)이고 대화가 실패한다 |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | `gpt-5.5`, `https://api.openai.com/v1` | OpenAI(Responses API). 시험·키 없는 확인은 `OPENAI_BASE_URL`을 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`)에 붙인다 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-opus-5-5` | Anthropic(Messages API) |
| `ANTHROPIC_EFFORT` | `low` | `low`…`max` |
| `ANTHROPIC_FALLBACKS` | (켬) | `off`면 서버 측 거절 대체를 끈다 |
| `TWIN_STUDIO_DIR` | `twin/` | 트윈 결과물 폴더(상대 경로는 실행 위치 기준) |
| `HOME_ID` | `homes.json`의 `default` | 불러올 집(twin-studio `homes.json`의 id, 예: `oneroom`) |
| `RUNTIME_DIR` | `runtime` | 실행 중 만든 파일의 바탕 폴더: 배치 수정본 `homes/<id>/edits.json`, 사진 `photos/`, 기록 DB `noonchi.db`(SQLite, 커밋하지 않음), 서버 잠금 `server.lock.db`(아래 「시작 순서」 0) |
| `HISTORY_TZ_MINUTES` | `540` | 기록 DB가 날짜(하루 요약·반성)를 나누는 시간대(분, -720~840). PAM 관찰 텍스트 시각도 이 시간대다. 틀린 값이면 시작하지 않는다 |
| `REFLECT_AT` | `23:30` | 매일 그날을 반성하는 시각(HH:MM, 기록 시간대). `off`면 끈다. 틀린 값이면 시작하지 않는다 |
| `PHOTO_RETENTION_DAYS`, `DATASET_RETENTION_DAYS` | `7`, `7` | 폰 사진 찍기 사진·시험 자료 보관 일(0보다 큰 숫자). 지나면 파일과 표 줄을 지운다. 틀린 값이면 시작하지 않는다 |
| `DATASET_COLLECT` | (끔) | `1`이면 엔진 프레임을 시험 자료로 `RUNTIME_DIR/dataset/<날짜>/`에 JPEG과 같은 이름의 `.json`(크기·자세·카메라)으로 쓴다 |
| `INFERENCE_MODE` | `mock` | `mock`(GPU 없음, VLM은 OpenAI) · `live`(GPU 서버, VLM은 같은 서버 vLLM `http://vllm-vlm:8000/v1`, 모델 이름 `vlm`). 두 모드는 같은 코드 경로이고 주소·모델 이름만 다르다. 다른 값이면 시작하지 않는다 |
| `VLM_BASE_URL`, `VLM_MODEL`, `VLM_API_KEY`, `VLM_EXTRA_BODY` | 모드 기본값 | 따로 주면 모드 기본값 대신 쓴다(OpenAI 호환 주소). mock 기본: `https://api.openai.com/v1`·`gpt-5.4-mini`·`OPENAI_API_KEY`·`{"reasoning_effort":"none"}`, live 기본: `http://vllm-vlm:8000/v1`·`vlm`·`VLLM_API_KEY`·`{}` |
| `VLM_CLOSER_MODEL` | `VLM_MODEL`과 같음 | 가까이 보기 VLM 모델 이름. 같은 VLM 주소·키·요청 칸에 모델 이름만 바꿔 보낸다. 비용은 그 모델 가격으로 세고, 가격표(`src/infer/cost.ts`)에 없으면 모름 |
| `VLM_TIMEOUT_MS` | `20000` | 사진 한 장 VLM 분석 제한 시간(1000 이상) |
| `PAM_URL` | `http://127.0.0.1:8300` | PAM 서비스 주소(compose 안은 compose가 `http://pam:8300`으로 둔다) |
| `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL`, `PAM_LLM_API_KEY` | 모드 기본값 | PAM 서비스(`services/pam/`)가 부르는 PAM LLM(OpenAI 호환 주소). mock 기본: `https://openrouter.ai/api/v1`·`qwen/qwen3.5-27b`(provider alibaba 고정)·`OPENROUTER_API_KEY`, live 기본: `http://vllm-pam:8000/v1`·`pam`·`VLLM_API_KEY` |
| `PAM_LLM_TIMEOUT_S`, `PAM_MAX_MODEL_LEN` | `120`, `32768` | PAM LLM 한 번 제한 시간(초), 문맥 길이(vLLM `--max-model-len`과 같은 값, 반성 출력 16384보다 커야 한다). 입력이 넘으면 PAM 서비스가 413 |
| `PAM_HOST_PORT` | `8300` | compose가 호스트 127.0.0.1에 여는 PAM 서비스 포트 |
| `PHONE_PORT`, `PHONE_HOST` | (끔), `0.0.0.0` | 폰 AR 서버(아래 "폰 AR") |
| `PHONE_URL` | (없음) | 폰에서 열 주소. 대시보드 QR에 맨 앞 주소가 나온다. 없으면 `tailscale serve`가 폰 포트로 잇는 https 주소, 그다음 와이파이 주소 |
| `PHONE_LAN_URLS` | `1` | `0`이면 폰 주소에 이 기계의 네트워크 주소(와이파이)를 넣지 않는다. compose는 `0`으로 둔다(컨테이너 안 주소는 밖에서 열 수 없다). 그때 폰 주소는 `PHONE_URL`뿐이다 |
| `PHONE_PHOTO_DIR` | `RUNTIME_DIR/photos` | 사진 폴더 |
| `PHONE_VIDEO_DIR` | 저장소 `runtime/videos`(컨테이너는 `/data/videos`) | 영상 모드 영상 폴더. `RUNTIME_DIR`(시연 폴더 포함)와 상관없이 이 폴더 하나에서 읽는다 |
| `BRAIN` | (끔) | `1`이면 폰 엔진 프레임으로 관찰 흐름(아래 "관찰 흐름")을 돌린다. `PHONE_PORT`가 있어야 한다. VLM은 `INFERENCE_MODE`가 고른 주소로 부른다(mock은 `OPENAI_API_KEY`) |
| `ENGINE_FRAME_MS` | `100` | 엔진 프레임 간격(50 이상). 폰 서버가 상태 메시지로 폰에 알린다. 모든 엔진 프레임에 YOLO를 돌린다 |
| `VLM_FRAME_MS` | `2000` | VLM 프레임 간격(`ENGINE_FRAME_MS` 이상). 앞 VLM 프레임보다 이만큼 뒤에 찍힌 엔진 프레임 한 장만 VLM·기록·가까이 보기에 쓴다(2초면 VLM 시간당 약 1,800번). 안 주고 `ENGINE_FRAME_MS`만 2초보다 길게 주면 그 값을 따른다. `ENGINE_FRAME_MS=2000 VLM_FRAME_MS=2000`이면 프레임마다 VLM을 부르던 옛 동작이다 |
| `VLM_WINDOW_FRAMES` | `5` | VLM 한 번에 보내는 최근 VLM 프레임 수(1~10, 그 프레임 포함). 오래된 것부터 보내고 장마다 촬영 시각(「t-8s」 … 「t-0s (latest)」)을 붙인다. 창 시간은 이 수 × `VLM_FRAME_MS`(기본 10초)이고 그보다 앞선 프레임은 넣지 않는다. 틀린 값이면 시작하지 않는다 |
| `VLM_MAX_INFLIGHT`, `DETECT_QUEUE_MAX` | `4`, `8` | VLM 동시 요청 상한(넘친 프레임은 「요청이 몰려 VLM 분석 없음」), YOLO 대기열 상한(넘친 VLM 프레임은 「요청이 몰려 YOLO·VLM 분석 없음」. 빠른 프레임은 대기열에 2장만 두고 오래된 것부터 기록 없이 버린다, `/api/brain`의 `skipped`). 틀린 값이면 시작하지 않는다 |
| `BRAIN_YOLO_PATH`, `BRAIN_POSE_PATH`, `BRAIN_YOLO_THREADS` | `models/yolo26n-seg.onnx`, `models/yolo26n-pose.onnx`, `8` | 감지(YOLO26n-seg)·관절(YOLO26n-pose) 모델 파일을 직접 줄 때, CPU 추론 스레드 수. 감지 모델 파일이 없으면 VLM만, 관절 모델 파일이 없으면 감지만 쓴다 |
| `BRAIN_YOLO_PROVIDER` | `auto` | YOLO 실행 장치: `auto`(Windows는 DirectML, 안 되면 CPU. 그 밖에는 CPU) · `dml` · `cpu`. `dml`·`cpu`로 정하면 그 장치만 쓰고 못 만들면 YOLO 없이 VLM만 쓴다. 다른 값이면 시작하지 않는다. 붙은 장치는 시작 글과 `/api/brain`의 `provider`에 나온다 |
| `BRAIN_POSE_EVERY` | `3` | 사람이 이어서 보이는 동안 관절 모델을 몇 장에 한 번 돌릴지(1 이상 정수). 사람이 다시 보인 첫 장은 늘 돌린다. 틀린 값이면 시작하지 않는다 |
| `PAM_TIMEOUT_MS` | `30000` | 판단 한 번 제한 시간. 판단은 늘 PAM 서비스(`PAM_URL`, 계약 `docs/pam-interface.md`)다 |
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

선택 값은 `.env.example`에서 주석으로 두었다. 빈 값(`MATTER_X=`)으로 두면 matter.js가 자기 설정으로 읽을 수 있어서다.

## 서버 (src/server)

### 시작 순서와 대체 경로

`npm start` → `main.ts`(`.env` 읽기) → `startServer()`(`start.ts`):

0. 서버 잠금(`src/server/lock.ts`): 기록 DB를 열기 전에 `RUNTIME_DIR/server.lock.db`에 SQLite 배타 잠금(OS 파일 잠금)을 걸고, 서버가 사는 동안 쥔다. 같은 폴더를 쓰는 서버가 이미 있거나 시연 준비가 쥐고 있으면 「이 폴더를 쓰는 서버가 이미 있어요」로 멈춘다. 끄거나 시작이 실패하면 놓고, 프로세스가 죽으면 OS가 푼다(파일이 남아도 남은 잠금이 아니다). 같은 파일이면 정션·심볼릭 링크·대소문자가 다른 경로도 같은 잠금이다. 시연 준비(`npx tsx scripts/demo-setup.ts`의 `--fresh`·`reflect --scripted`)도 같은 잠금을 잡고 일이 끝날 때까지 쥐며, 잡지 못하면 「서버를 먼저 끄세요」로 멈춘다. `--fresh`는 폴더를 옮기지 않고, 잠금을 쥔 채 잠금 파일 말고 옛 항목을 `<폴더>.old-<시각>/`(그 이름이 이미 있으면 그 폴더는 두고 `-2`, `-3`…을 붙인 새 폴더)으로 하나씩 옮긴 뒤 같은 잠금을 쥔 채 새로 쓴다(잠금을 한 번도 놓지 않는다). 하나라도 못 옮기면 옮긴 것을 모두 되돌려 보고(하나가 실패해도 끝까지) 멈추며, 이번에 만든 백업 폴더는 비어 있을 때만 지운다. 옮기기 전에 폴더에 `RESTORE_NEEDED.json`(백업 위치·옮길 항목)을 먼저 쓰고(쓰지 못하면 아무것도 옮기지 않고 멈춘다), 옮기기와 새로 쓰기가 다 끝났을 때(또는 다 되돌렸을 때)만 지운다. 못 돌린 항목이 있으면 그 목록을 이 파일에 더하고, 이 파일이 있으면 서버(DB를 열기 전)와 준비 명령이 「--fresh 복구가 덜 끝났어요」로 멈춘다. 백업의 항목을 옮긴 뒤 이 파일을 지우면 다시 쓴다. 같은 runtime 폴더를 호스트와 컨테이너가 동시에 쓰지 않는다: Docker Desktop처럼 호스트(Windows)와 컨테이너(Linux)가 같은 폴더를 쓰면 두 OS의 파일 잠금이 서로 안 보일 수 있다.
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
| `GET /api/health` | | `{ ok, devices, hub, transport, provider, model, twin, eye, home: { id, name }, phone_urls, brain, mode, ready }`(`mode`: `test` 시험 · `live` 실제). `ready`: `{ ok, inference_mode, vlm: { base_url, model, key, reachable }, pam: { url, reachable, llm: { base_url, model, reachable } | null }, db }`. 모델은 부르지 않고 VLM `GET {base}/models`(30초 캐시)·PAM `GET {url}/health`만 본다. 답하지 않아도 200이고 `ready.ok`가 false다 |
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
| `GET /api/history?since=&until=&kinds=&limit=` | | `{ ok, rows: HistoryRow[] }` 한 시간축 기록(시각 순). `since`가 없으면 최근 `limit`줄, 있으면 그 시각부터 `limit`줄(기본 500, 최대 5000). `kinds`는 쉼표 목록. 모르는 종류·숫자가 아닌 시각·범위 밖 limit은 400 |
| `GET /api/history/day/{YYYY-MM-DD}` | | `{ ok, day, observation_text, action_summary, counts, dropped }` 하루 요약(아래 "기록과 반성"). 없는 날짜 400 |
| `POST /api/reflection/run` | `{ day? }`(기본 오늘) | 그날을 바로 반성한다. `{ ok, day, version, appliesDay }`. 없는 날짜 400, 그날 기록이 없거나 이미 반성 중이면 409, PAM 실패 502 |
| `GET /api/phone/start-pose` | | `{ ok, start: { position, yaw_deg, label, facing_label } \| null }` 폰 위치 맞추기 시작 자리(아래 "위치 맞추기"). 집 scene.json이 없으면 404 |
| `POST /api/phone/start-pose` | `{ home?, position: [x, y], yaw_deg, label?, facing_label? }` | 저장하고 실행 중인 폰에 바로 알린다. 이름을 비우면 채운다. 방 바닥 밖·숫자 아님 400, 다른 집 409 |
| `POST /api/phone/start-pose/preview` | `{ home?, position, yaw_deg, label?, facing_label? }` | 저장하지 않고 검사·이름 채우기만 한 `{ ok, start }`. 방 바닥이 아니면 400 |
| `POST /api/phone/start-pose/clear` | `{ home? }` | `{ ok, start: null }` |
| `GET /api/phone/sync` | | `{ ok, sync }` 위치 맞춤 모듈 상태(`rigid`, `floorY`, `aligned`, `source`, `started`, `anchors`, `anchorIds`(짝지은 트윈 물건), `wallPoints`, `residualM`, `observed`). 폰 서버가 없으면 `sync: null` |
| `GET /api/decisions?limit=` | | `{ ok, decisions: [{ id, at_ms, day, text, text_sent, seq, status, prediction, memory_version, world }] }` 최근 판단과 그때 보낸 관찰 텍스트(기본 20, 최대 500) |
| `GET /events` (WebSocket) | | 붙으면 `{type:"hello", home}`, 모든 기기의 `{type:"state", state}`, 지금 배치 보정의 `{type:"layout"}`들, `{type:"plan"}`, (`BRAIN=1`이면) `{type:"world"}`와 마지막 판단·상자 있는 마지막 observe의 `{type:"brain", event}` 하나씩. 맨 끝은 늘 말풍선 카드 글 `{type:"say", text}`(글이 없으면 `null`). 이후 바뀔 때마다 `{type:"state"}`, `{type:"agent", event:"action"\|"reply"\|"pending"\|"confirmed"\|"cancelled", ...}`, `{type:"layout"}`, `{type:"focus"}`, `{type:"eye"}`, `{type:"photo"}`, `{type:"brain", event}`(관찰·World State 변화·판단·실행·연결·판단 시점·반성 기록, `src/contract/events.ts` `BrainLog`), `{type:"world"}`, `{type:"say"}`(글이 바뀔 때만, `src/act/say.ts`) (모양은 [plan.md](plan.md)) |

- `command`는 `docs/plan.md`의 `Command` 객체다. 줄임으로 문자열(`"on"`, `"off"`, `"lock"` …)도 받는다.
- 정적 파일: `/`·`/setup/`은 React 빌드 `ui/dist/`다. `/twin/`은 고른 집의 twin-studio 산출물 폴더(아파트는 `apartment/`, 원룸 예시는 `homes/oneroom/`), `/twin/viewer/`는 모든 집이 함께 쓰는 뷰어(`homes.json` viewer), `/twin/lib/`은 모든 종류의 GLB(`homes.json` library)다. 경로 탈출(`..`)은 막는다.
- 보안: 기본 바인드는 `127.0.0.1`. 브라우저 출처는 `localhost`·`127.0.0.1`·`[::1]`만 허용한다(CORS, WebSocket). 다른 출처의 POST(페어링 창 열기 포함)는 403이다. 인증은 없다.

### 웹 화면 (ui/)

React+TypeScript 화면(`ui/`, Vite 다중 페이지)이다. 서버는 빌드 결과 `ui/dist/`를 내준다. `npm start`·`npm run dev`가 먼저 `npm run ui:build`로 빌드하고, 빌드 전이면 화면 요청은 503(「화면이 아직 빌드되지 않았어요. npm run ui:build」)이다. 화면만 고칠 때는 `npm run ui:dev`(5173, `/api`·`/twin`·`/events`를 8200으로 넘김).

- **대시보드** (`/`): 3D 트윈이 화면 전체 배경이고 그 위에 패널이 떠 있다. 위 가운데 상태 알약(연결·집·운영 모드·허브·에이전트·설정 다시 하기), 왼쪽 위 클로이드의 눈(접기), 오른쪽 판단 기록(요청마다 카드, 「폰 화면」 탭). 입력창이 없다. 요청·승인은 폰에서 음성으로 한다. 말풍선은 에이전트가 판단하면서 확인한 기기·물건에만 뜬다. 패널·알약·말풍선은 21st.dev 부품의 흰 카드다.
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

바닥 구석을 조준하지 않고 맞춘다. 계산은 서버 `src/sync/`가 하고, 폰은 자세·조준점·면 법선·엔진 프레임만 보낸다. 웹이든 앱이든 같은 메시지다. 결과는 바닥 평면의 회전 + 이동(크기 없음) 하나와 품질이다. 계획: [2026-11-10-phone-sync](superpowers/plans/2026-11-10-phone-sync.md).

1. **시작 자리 저장(집마다 한 번, 설정 4단계):** 3D 트윈 바닥을 누르면 그 자리에 「시작」 핀이 꽂히고, 다른 곳을 누르면 그쪽을 보는 화살표가 된다. 화살표 끝 손잡이를 끌거나 돌리기 단추(15°씩)로도 돌린다. 끌면(카메라 돌리기) 고르지 않는다. **다시 고르기**는 다음 누름을 새 자리로 쓴다. 이름은 서버가 채운다(`POST /api/phone/start-pose/preview`): 1.5m 안 가장 가까운 물건으로 「<물건> 앞」(없으면 「<방> 시작 위치」), 보는 쪽은 방향 15°·8m 안 가장 가까운 물건. 고친 이름은 그대로 둔다. 방 바닥이 아니면(벽·집 밖) 받지 않는다. **저장**하면 `runtime/homes/<집>/phone-start.json`에 남고 실행 중인 폰에 바로 간다. 「완료하고 대시보드로」는 저장한 뒤에만 누를 수 있다. 예전 `phone-touch.json`(벽 대기 A·B)은 읽지 않는다.
2. **폰에서 「여기서 시작」:** 시작 자리가 있는 집은 AR을 켜면 위에 「<자리>에 서서 <보는 쪽> 쪽을 봐 주세요」, 아래에 **여기서 시작**이 뜬다. 그 자리에 서서 그 쪽을 보고 누르거나 「여기서 시작」이라고 말한다(말 전체가 시작일 때만). 그 순간 자세로 변환이 바로 정해진다. 이때는 어림이다. 폰이 바닥을 거의 내려다보면 폰 윗쪽을 보는 방향으로 쓴다.
3. **걸으며 맞춤:** 방을 천천히 둘러보며 걸으면 서버가 저절로 고친다.
   - 벽 모양: 자세마다 오는 실제 hit-test 점(어림 바닥 점은 뺀다) 중 면 법선이 수평인 점을 벽 점으로 모은다(10cm 칸마다 하나, 최근 45초, 1200칸까지, 폰에서 5m 안). 위를 보고 폰보다 0.9m 이상 아래인 점은 바닥 높이로만 쓴다. 어림일 때는 먼저 벽 점 법선을 트윈 벽 방향에 겹쳐 방향만 고친다(±20°). 그다음 지금 변환에서 2D ICP(점-선 거리, Cauchy 무게, 먼 15% 잘라냄, 짝 문턱 1.0m → 0.15m)로 평면도 방 쪽 벽 면(`src/phone/home-plan.ts` `roomFaces`)에 맞춘다. 법선이 30° 넘게 다르거나 그 면이 카메라 쪽을 보지 않으면 짝짓지 않는다. 가구 옆면 hit은 짝이 없어 빠진다.
   - 물건 기준점: 엔진 프레임(2초마다) YOLO26n 상자 중 냉장고·싱크대·변기·침대·소파·식탁·오븐·전자레인지·TV(`src/sync/classes.ts`, 이름·COCO 번호는 낱말 표 `src/world/vocab.ts`, 점수 0.4 이상, 그림 가장자리에 닿은 상자는 뺀다). World State는 이 상자를 받지 않는다. 상자 아래 가운데 광선이 그 물건이 놓인 높이(바닥, 싱크대·세면대는 윗면, TV는 받침 윗면)의 AR 면과 만나는 점을 그 프레임 자세로 구한다(6m 안, 5° 넘게 숙인 광선만). 종류·자리로 묶고(관찰 3개 이상, 묶음 가운데에서 먼 것은 버림) 트윈 물건(`src/sync/landmarks.ts` 종류 표)과 짝짓는다. 집에 하나뿐인 종류를 먼저 쓰고, 변환이 있으면 가장 가까운 같은 종류를 더한다(둘째와 0.5m 안으로 비슷하면 버림). 상자 아래 가운데는 물건 앞 가장자리라서 카메라 → 물건 가운데 선이 물건 바닥 사각형에 들어가는 점을 짝으로 쓴다. 트윈 물건 자리가 실제와 다르면 **물건 자리 맞추기**로 먼저 고친다.
   - 시작 위치는 약한 사전값으로 남는다(자리 0.3m, 1분마다 0.1m씩 커짐, 방향 10°).
4. **받는 기준**(`src/sync/aligner.ts` `SYNC_LIMITS`):
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

폰 판본(`src/phone/server.ts`, 판본 형 `src/contract/phone-version.ts`): 폰 페이지는 열리자마자 `{type:"hello", protocol}`을 보낸다. 서버는 판본이 맞는 hello를 받은 연결에만 계획 명령을 보내고 답(`answer`·`say`·`confirm`·`cancel`)을 받는다(자세·사진은 늘 받는다). 2초 안에 hello가 없거나 판본이 다르면 옛 탭으로 두고 명령 `{id:"refresh"}`(「화면을 새로 고쳐 주세요」)만 보낸다. 맞는 hello를 받으면(늦게 와도) 새로 고침 안내를 지우고 지금 명령 전체와 지금 승인 대기 목록을 보낸다. 폰은 `status.protocol`이 폰 빌드와 다르면 페이지를 다시 읽는다(같은 탭에서 60초에 한 번, 못 읽으면 「새로 고침이 필요해요」). 말 `{type:"say", text, at}`의 `at`은 말하기 시작할 때 떠 있던 명령(`{kind:"command", id, step}`, 없으면 `{kind:"none"}`)과 보인 승인 대기 token들(`pending`)이다. 서버는 말 답을 그 명령에만, 말로 한 승인·거절은 보인 token이 하나이고 지금도 대기일 때 그 하나에만 받고(at에 승인 token이 있으면 명령의 답으로 보내지 않는다), 답한 뒤 지금 승인 대기 목록을 보낸다. 폰은 화면에 실제로 보이는 것(엄지 자리의 명령 또는 승인 대기 하나)만 at에 싣는다. 안전 명령(끄기 안내·부탁, `grade: "safety"`)은 승인 대기 카드보다 먼저 보이고 at도 그 명령이다. 가린 동안 서버는 승인 시간 제한을 멈추고, 안내가 풀리면 카드가 다시 보인다. 그 밖의 답 말은 들은 말로만 남기고 실행 기록에 「늦은 답이라 쓰지 않음」을 남긴다. 판본이 맞는 폰이 없으면 폰이 필요한 계획(사람 단계·질문·처음 하는 일·승인이 필요한 가전 단계·시간 초과 질문)은 시작을 미루고(「폰 화면 새로 고침 전이라 새 일을 미룸」), 계획 도중 물을 폰이 없으면 바로 닫는다(「폰이 없어 물을 수 없어 그만둠」). 닫힌 계획의 끄기 안내는 보통 명령으로 명령 줄에 뜬다(명령 id는 그 계획 id, 단계 id `off:<계획>:<가전>:<회차>`, 가전마다 하나). 안내가 남은 동안 폰이 필요한 새 계획만 미루고, 폰이 필요 없는 가전 계획은 그대로 돈다. 폰이 필요한 다른 계획이 도는 동안 다시 걸린 안내는 그 계획이 끝난 뒤 뜨고, 그동안 폰 서버가 판본이 맞는 폰 모두에 `{type:"reply", text, grade:"safety"}`(「…이 다시 켜졌어요. 꺼 주세요」)를 2분마다 보낸다(여러 가전이면 돌아가며). 폰은 말을 차례로 읽고(앞 말을 끊지 않음) reply 글을 잠깐 알림 줄에 20초 남긴다.

실제 폰에서 확인할 것:
- 크롬 WebXR hit-test가 벽(수직면)을 돌려주는지, hit 자세 +Y가 면 법선인지. 수평면만 주면 벽 모양은 쓰이지 않고 시작 위치·물건만 남는다.
- 엔진 프레임 투영과 카메라 이미지가 맞는지(물건 바닥 점이 어긋난다).
- YOLO26n이 실제 집 가구를 점수 0.4 넘게 잡는지, 트윈 물건 자리가 실제와 맞는지.
- 사람이 시작 자리·방향에 얼마나 맞게 서는지(0.5m·15° 안이면 벽으로 맞춰진다).
- 나침반(`deviceorientationabsolute`)은 쓰지 않았다. WebXR 세션 중 크롬이 이 값을 주는지는 실제 폰에서 봐야 한다.

### 영상 모드: 영상으로 시험하기

실제 폰 대신 영상을 틀어 같은 흐름(관찰 → 판단 → 계획 → 단계 명령)을 보고, 명령이 맞는 때에 오는지 판정한다. 계획: [2026-11-11-video-input](superpowers/plans/2026-11-11-video-input.md).

- 열기: 폰 페이지 `/phone/?clip=<파일>`. 영상은 폰 서버가 공용 `runtime/videos/<파일>`(`PHONE_VIDEO_DIR`로 바꿈)을 `/phone/videos/<파일>`로 내준다(이름은 영문·숫자·`_-` 64자까지, `.mp4`·`.webm`, Range 요청). 주소 칸 `fov`(세로 시야각, 기본 60°), `pitch`(기본 −25°), `h`(카메라 높이, 기본 1.4m)로 카메라를 정한다. 실제 폰 페이지와 같이 열지 않는다(명령이 둘 다에 간다).
- 위치: 설정 4단계에서 저장한 시작 자리·방향이 카메라 자리다. 「AR 시작」을 누르면 `reset` 뒤 `start {fixed: true}`를 보내고, 서버는 그 자세를 바로 맞춤(`sync.source: "video"`)으로 둔다. 고정 변환은 물건·벽으로 움직이지 않고, `reset`이나 보통 `start`에서 풀린다. 서버 sync가 none으로 떨어지면(다시 연결) 페이지가 `start {fixed: true}`를 다시 보낸다. 시작 자리가 없으면 「설정 화면에서 시작 위치를 정해 주세요」가 뜬다.
- 보내기: 실제 폰과 같다. 화면 프레임 JPEG 초당 12장(긴 변 780), `engine_ms`마다 엔진 프레임(360×640, 고정 자세·투영·`captured_at`), 자세 초당 10번(`floor_y: 0`). H.264 표시 영상은 쓰지 않는다. 영상이 끝나면 프레임을 멈춘다.
- 화면: 영상이 카메라 자리에 깔리고(`object-fit: cover`) 그 위에 실제 폰 화면이 그대로 뜬다. 명령 대상 고리는 고정 자세·투영으로 잡아 잘린 화면 자리로 옮긴다. 명령은 실제 폰처럼 소리로 읽고(말 차례·등급·시간 상한도 같다), 마이크로 늘 듣기만 끈다. 답은 「완료」·「승인」 단추로 한다. 영상 모드가 실제 모드와 다른 갈래는 카메라 입력·자세 흉내·단계 영상·held·시험 기록·듣기 끔뿐이다(`tests/video-mode-parity.test.ts`). 단계 영상이 없으면 카메라가 움직이지 않아 이동 단계는 「완료」로 넘긴다.
- 단계 영상: 주소 칸 `step=<종류>:<낱말>:<파일>`(여러 개, 종류 go·pick·place·do)을 붙이면, 사람 단계 명령(`PhoneCommand.kind`)의 종류가 같고 대상 id에 낱말이 든 칸의 영상으로 `react`초(기본 1.5, 0~10) 뒤 바꿔 튼다. 같은 명령 id·단계에는 한 번만 바꾼다. 자세는 새 영상이 틀어질 때 함께 바뀌고, 영상을 열지 못하거나 더 새 바꾸기가 있으면 그대로다. go면 그 영상을 트는 동안 자세가 대상 쪽으로 돌아 초당 0.8m 걷고 대상 0.6m 앞에서 멈춘다(높이·시작 숙인 각 그대로, 벽은 보지 않고 곧게). 집기·놓기·그 자리에서 하는 일(do)이면 걷기를 멈추고 그 자리에서 대상(면이면 윗면 가운데, 싱크볼이 있으면 싱크볼 가운데)을 바라본다: 대상 쪽으로 돌고 대상 높이까지 숙인다(높이 그대로, 대상이 수평 1cm 안이면 그대로). `start`는 늘 처음 자세로 보낸다. 서버는 이 자세와 영상으로 단계를 넘긴다(가기는 폰 근처, 집기·놓기는 World State).
  - 같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다: 그 종류·낱말에 맞는 새 명령마다 다음 칸을 틀고, 칸이 다 떨어지면 지금 영상을 둔다. 칸이 하나면 맞는 새 명령마다 그 칸을 튼다.
  - 단계 영상이 끝나면 마지막 장면을 붙잡는다: 다음 단계 영상이 오거나 끝낼 때까지 그 장면으로 화면·엔진 프레임을 계속 보내고(영상 시각은 흐른다), 엔진 프레임에 `held: true`를 붙인다. 서버는 영상 모드 연결의 붙잡은 프레임만 같은 사진이어도 VLM 간격마다 새 관찰로 넣는다. `ended`는 첫 영상이 끝났을 때만 참이다.
- 기록: `window.__noonchiVideo = { t0, ended, hold, commands: [{ video_ms, id, step, text }], clips: [{ video_ms, clip, duration_ms }], at }`(t0는 재생 시작 순간의 서버 시계, 영상 시각은 바꾼 영상을 이어 센다. hold는 붙잡는 중인 단계 영상과 붙잡기 시작한 영상 시각, 아니면 null. at은 지금 말의 at(화면이 바뀔 때마다 실제 폰 말과 같은 `heardAtOf`로 다시 쓰고, 판정 도구 `--say`가 그대로 싣는다))와 console `[video]` 줄.
- 판정 도구: `npm run heavy -- npx tsx scripts/video-check.ts --clip <파일> [--step <종류>:<낱말>:<파일> …] [--done-after 3] [--expect-after 36.3] [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--out <md>] [--record <폴더>]`.
  - 헤드리스 크롬 하나(390×844)로 폰 페이지를 열어 「AR 시작」을 누르고 영상 끝까지 본다. 새 명령이 뜨면 `--done-after`초 뒤 첫 답 단추를 누른다(0이면 안 누름).
  - 끝나면 `/api/history`(사람·물건 등장·사라짐, PAM 판단, 계획, 단계)와 폰이 받은 명령을 영상 시각순 표 하나로 합치고, 판정 줄(첫 명령 시각, `--expect-after`초 전 명령 수, 계획 끝남)과 VLM 비용(PAM·계획 비용 빠짐)을 붙여 `runtime/videos/<파일>.<시각>.timeline.md`에 쓴다.
  - `--step`은 폰 주소의 `step=`으로 넘기고, 있으면 `--done-after` 기본이 0(단추를 누르지 않음)이다. 1초마다 `/api/world`를 읽어 트윈 줄(눈 방·자리가 바뀌거나 0.5m 넘게 옮김, 컵 상태·놓인 곳·면·방이 바뀜)과 바꾼 단계 영상 줄을 표에 넣고, 단계 판정 줄(첫 계획 끝난 단계 수, 누른 단추 수, 마지막 트윈 눈 방·컵 놓인 곳)을 더한다.
  - 영상이 멈춘 뒤(첫 영상 끝, 단계 영상 마지막 장면 붙잡기)에도 계획이 열려 있거나 끄기 추적(지금 계획 hot·끄기 안내)이 남아 있으면 `--tail`초(기본 30)까지 더 본다. 계획 상태와 끄기 추적은 `GET /api/plan` 한 답(`plan`·`off`)에서 함께 읽는다. 끄기 안내가 남은 채 끝나면 「끝까지 돌지 않음」에 적는다. 끝에 같은 크롬 새 탭(1280×800)으로 대시보드를 열어 `runtime/videos/<파일>.<시각>.twin.png`를 남긴다.
  - `--record <폴더>`: 폰 페이지를 연 뒤 같은 크롬 새 창(1280×800)으로 대시보드를 판정 내내 띄우고, 두 화면을 `Page.startScreencast`(JPEG, ack를 100ms 간격으로 보내 화면마다 초당 약 10장)로 끝(30초 더 보기 포함)까지 받는다(`scripts/video-record.ts`). 화면마다 녹화 시작 답이 10초 안에 오지 않거나 오류면(CDP 끊김) 리스너·ack 타이머를 풀고 시작을 보낸 화면의 녹화를 끈 뒤 그 판을 오류로 끝낸다. 끝 사진은 그 창으로 찍는다. 크롬을 끈 뒤 ffmpeg로 왼쪽 폰·오른쪽 대시보드를 높이 800에 맞춰 붙인 `<폴더>/<시각표 이름 줄기>.demo.mp4`(1650×800, H.264, yuv420p, 10fps, 프레임 받은 시각대로 실제 시간 길이)를 만들고 프레임 폴더를 지운다. ffmpeg가 없거나 실패하면 `<줄기>.frames` 폴더를 남기고 판정 줄 위에 적는다.
  - 엔진 프레임을 이미 받은 서버나 끝나지 않은 계획이 있는 서버면 시작하지 않는다. 판마다 서버를 새로 띄운다. 끝까지 돌지 않으면 끝 코드 1이다.
  - `--fake`: 가짜 모델(VLM·계획·PAM)과 대본 감지기로 같은 흐름을 한 프로세스에서 돌려 도구만 본다.
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
- 명령 대상 고리: 명령마다 대상 하나(`target`: 식탁 → 집을 컵 → 싱크대 → 싱크대)가 같이 온다. 위 줄·엄지 자리에 그 명령이 보일 때만(승인 대기·시작 위치 맞추기·물건 자리 맞추기 중이 아닐 때) 그 대상에 작은 고리(40px, 이름표 없음)를 그린다. 화면 밖이거나, 화면 안이어도 고리가 위 줄·엄지 자리 칸에 걸리면 그쪽 가장자리 세모 하나. 세모는 위 줄 아래 8px부터 엄지 자리 위 8px까지(그릴 때 두 칸을 잰다), 옆은 화면 가장자리 8px 안에 둔다. 대상 자리는 서버가 배치(물건 가운데, 식탁·싱크대처럼 윗면이 있는 면은 윗면 가운데, 싱크볼이 있는 싱크대는 윗면 높이의 싱크볼 가운데)와 World State(컵)에서 트윈 자리로 잡고, 폰 서버가 맞춘 변환으로 AR 자리로 바꾼다. 맞추기 전(어림 포함)에는 대상이 없고, 맞추면 지금 명령이 대상과 함께 다시 온다. 에이전트 초점(`FOCUS=1`)은 실제 폰 화면에 그리지 않는다.
- 폰은 세로·가로 어느 쪽으로 들어도 된다. 가로로 들어도 AR·자세·화면 보내기는 그대로이고 방향 알림은 없다(카메라 크기가 바뀌면 프레임·표시 영상 크기를 그 프레임부터 다시 맞춘다). 엄지 자리 카드는 오른쪽 아래(폭 360px까지)로 가고, 설정 모달 단추 줄은 모달 폭 안에서 줄을 바꾼다. 배치는 CSS 방향 조건(Tailwind `landscape:`)으로만 바꾼다. 화면 방향 고정·전체 화면은 요청하지 않는다. 같이 요청하면 DOM 오버레이 AR 화면이 나오지 않았다. 추적은 폰 위치와 카메라가 보는 방향만 쓰므로 가로·세로가 같다.
- 글 크기는 부품 원래 크기(단추는 label 토큰)이고 넓은 화면이라고 키우지 않는다. 누르는 것은 48px이다.
- 실제 폰 명령(`src/contract/phone.ts`): 실제 폰은 에이전트의 손이다. 서버는 계획 단계마다 `{type:"command", id, step, text, vision, choices, speak}`를 보낸다. `text`는 위 한 줄(사람에게 하는 명령이나 질문), `vision`은 아래 답 단추 바로 위 비전 상태 한 줄(질문이면 null), `choices`는 답 단추(단계 명령은 「완료」 하나), `speak`가 true면 소리로 읽는다(새 명령, 오래 걸려 다시 읽기). 비전 상태만 바뀌면 같은 id·step을 speak false로 다시 보낸다. 끝나면 `{type:"command_clear", id}`. 새로 붙은 폰은 상태 다음에 지금 명령(speak false)을, 명령이 없으면 id 없는 `command_clear`를 받는다. 답 단추는 `{type:"answer", id, step, choice}`로 받은 명령의 id·step을 그대로 돌려준다. 판단·관찰 글은 폰에 보내지 않는다(대시보드에만 있다).
- 화면 사진 페이지(`PHONE_SHOTS=1`로 빌드한 `/phone/shots/#상태`)는 상태 예시(`ui/src/phone/fixtures.ts`)를 그린 뒤 배치를 잰다. 화면 밖 단추, 세로 화면 아래 1/3 밖·가로 화면 오른쪽 아래(오른쪽 절반·아래 절반) 밖의 엄지 자리 단추, 옆으로 넘친 모달 내용, 조준점이나 그 칸 밖 단추를 가리는 칸(위 줄·엄지 자리, 모달 안 단추는 빼고), 잘린 명령·비전 상태 글, 칸·단추와 겹친 화면 밖 세모, 칸 밑에 깔린 고리가 있으면 콘솔 오류를 내서 `npm run capture`가 실패한다. 처음 화면은 AR 시작 단추가 첫 화면 밖이면 실패한다. 상태는 `intro`·`intro-nostart`(시작 자리가 없는 집), 네 명령 `go-table`·`pick-cup`·`go-sink`·`put-cup`, 컵이 엄지 자리 카드 밑에 비침 `low-cup`, 명령 없음 `idle`, 추적 약함 `weak`, 문제 모달 `no-start`·`mic`·`offline`, 설정 `settings`, 카메라 못 보냄 설정 `no-camera`, 물건 자리 맞추기 `place`, 질문 `question`, 승인 `approve`·`approve-task`, 시작 위치 맞추기 `start`, 맞추는 중 `aligning`이다. 모두 세로 390×844·412×915·360×780으로 찍고, 가로는 `pick-cup`을 844×390으로, `intro`를 844×390·780×360으로 찍어 본다.
- 화면 프레임: 기본 초당 12장, 가로 촬영 가로 480px·세로 360px, JPEG 품질 0.55(`?fps=`·`?w=`로 바꾼다). 인코딩은 워커 두 개로 두 장까지 겹치고, 순서가 뒤바뀐 오래된 프레임은 버린다.
- 엔진 프레임(분석용): 서버가 상태 메시지 `engine_ms`로 간격을 알려 주면 화면 프레임과 따로 그 간격마다 한 장(`kind: "engine"`, 같은 크기, JPEG 품질 0.8, 초점 고리 없음)을 보낸다. 찍은 순간 자세·투영 행렬(`projection`, 16개)·서버 시계 촬영 시각과 오차를 붙인다. 엔진 프레임은 표시 화면에 쓰지 않는다.
- 측정: 서버는 `/api/eye/stats`에 받은 fps·장당 KB를 내고, 대시보드 눈 캡션에 보인다. 실제 폰에는 측정 글이 없다.

### 말하기·'여기'·초점

- 눈 표시: 서버는 맞추기 전에도 `estimated: true` 눈을 보낸다(가장 넓은 방의 창에서 방 안쪽 0.8m·높이 1.3m, 방향만 폰을 따라감. 「여기서 시작」 뒤에는 시작 변환 자리). iframe 뷰어(다른 집·설정 4단계)는 이 눈도 원뿔로 그린다. 한양목련 구운 대시보드는 맞춘 눈만 보는 방향 원뿔로 그린다(`ui/src/twin3d/eye.ts`): 원뿔 꼭짓점은 `height_m`, 축은 `yaw_deg`·`pitch_deg`, 추적 약함이면 원뿔이 회색이다. 원뿔은 iframe 뷰어와 같은 모양(열린 원뿔 반지름 0.32m·길이 0.9m와 꼭짓점 공)이다. 그리는 자리만 보정한다(`ui/src/twin3d/walk.ts`): 눈 자리가 벽 속·집 밖이면 방 안, 벽에서 벽 반 두께 + 꼭짓점 공 반지름(0.11m)만큼 떨어진 자리에 세우고, 새 자리까지는 서버 경로 찾기(`src/plan/route.ts`)와 같은 문·트인 경계를 지나 걸어간다. 눈 자세 값과 World State·단계 판정은 그대로다. 원뿔은 집을 그린 뒤 깊이를 보지 않고 따로 한 번 더 그려 벽에 가리지 않는다. 말풍선·방 이름표·경로 선은 원뿔이 화면에서 차지하는 상자(꼭짓점 공 ~ 넓은 끝, 보는 방향에 따라 달라짐)를 비킨다. 추정 눈은 사진의 찍은 위치에는 쓰지 않는다.

6. AR 중에는 그냥 말한다. 폰이 늘 듣는다(크롬 내장 음성 인식, 한국어, 누르는 단추 없음). 받아쓴 문장은 에이전트(세션 `phone`)로 가고, 답은 폰이 읽어 준다. 처음 화면에서는 글 입력으로 보낸다. 승인이 필요하면 엄지 자리에 승인·취소가 뜬다. 말로 승인하려면 「승인」·「승인해 줘」라고 한다. 폰이 늘 들어서 「응」·「네」·「어」로는 확정하지 않는다(대시보드 채팅은 「응」으로도 된다).
   - 실제 폰에 명령·질문이 떠 있는 동안(`BRAIN=1`, 아래 "관찰 흐름")에는 말을 먼저 그 답으로 맞춰 본다. 「그만」·「완료」·「다 했어」는 짧은 말 전체일 때만(앞의 「응」·「이제」, 끝의 「요」는 된다. 「그만큼」·「숙제 다 했어?」는 아니다) 그 답으로 받는다. 「그만」이면 계획을 그만둔다. 질문의 답은 단추 글이나 그 답의 말(`src/act/prompts.ts` `words`, 예: 「치워」·「그대로」)이 들어 있으면 받는다. 받은 답은 에이전트로 보내지 않는다. 명령의 답을 말로 하면 답 글(`reply`)은 빈 글이고 다음 명령이 따로 온다. 맞는 답이 없으면 에이전트로 간다. 답으로 받은 말과 단추 답만 기록 DB에 `feedback`(「다 했어 · 부탁: 싱크대로 가 주세요」·「그냥 그대로 둬 · 질문: 컵을 치울까요?」)으로 남아 그날 반성의 사용자 피드백이 된다.
7. 미어캣 → **물건 자리 맞추기**로 조준점을 켜고, 물건 아래 바닥을 조준점으로 가리키고 "냉장고 위치 여기로 맞춰줘"·"냉장고는 여기 있어"·"TV 여기로 옮겨줘"라고 하면 트윈의 그 물건이 조준점 자리로 옮겨진다(바닥 물건은 폰 쪽을 보게, 벽걸이는 가장 가까운 벽에 붙는다). "배치 저장해"면 수정본을 저장한다(아래 "집 고르기와 배치 보정").
8. (`FOCUS=1`일 때만) 에이전트가 다룬 물건(켠 TV, 옮긴 냉장고 등)은 8초 동안 초점이 된다. 대시보드 눈 영상과 3D 트윈에는 고리와 `클로이드 주목 · 이름`이 뜬다(명령이 떠 있을 때는 대시보드 눈 영상의 고리도 명령 대상이다). 실제 폰 화면에는 명령 대상 고리만 그린다.

- 실제 폰 고리와 대시보드 프레임 고리는 XR 시점의 투영 행렬로 그린다. 카메라 이미지가 그 투영과 같다고 보고 그리므로 실제 폰에서 어긋나는지 확인이 필요하다.
- AR을 켠 채로 이어서 듣기가 되는지, 다시 켤 때 크롬이 알림 소리를 내는지는 실제 폰에서 아직 확인하지 않았다.
- 폰 말에는 인증이 없다(같은 와이파이의 누구나 보낼 수 있다). 내부 테스트용이다.

## 관찰 흐름 (src/observe, src/world)

한 흐름: 폰 엔진 프레임 → YOLO 감지·관절·VLM → World State → 관찰 텍스트 → PAM 서비스(`pam-predict/2`) → 클로이드 계획 → 실행 전 검사 → 실제 폰 단계 명령(소리) → 폰 위치·World State로 단계 확인 → 기록 DB(`noonchi.db`) → 하루 끝 반성(`pam-reflect/2`) → 다음 날 기억. 사진은 PAM에 가지 않는다. `tests/noonchi-e2e.test.ts`가 가짜 OpenAI 호환 서버와 시험용 PAM 자리로 이 흐름 전체를 돌린다.

| 단계 | 코드 | 나가는 것 |
|---|---|---|
| 엔진 프레임·고리 | `src/phone/`, `src/observe/ring.ts` | `GET /api/brain` |
| YOLO 감지·관절·VLM | `src/brain/detector.ts`, `src/observe/pipeline.ts`, `src/observe/scene.ts` | `{type:"brain", event:{type:"observe"}}`, 기록 `vlm`·`yolo` |
| World State | `src/world/state.ts`, `src/world/pose.ts` | `{type:"world"}`, `world_change`, `GET /api/world`, 기록 `detection`·`world` |
| 판단 | `src/world/decide.ts`, `src/brain/pam.ts` | `decision`, 기록 `pam_text`·`decision`, `GET /api/decisions` |
| 계획·검사·실행 | `src/act/` | `{type:"plan"}`, `execution`, 실제 폰 `{type:"command"}`·`{type:"command_clear"}`, 기록 `plan`·`execution`·`feedback` |
| 반성 | `src/history/reflect.ts` | `reflection`, 기록 `reflection`, `POST /api/reflection/run` |

폰 엔진 프레임마다 YOLO와 VLM이 둘 다 분석하고, World State가 둘을 물체별로 합친다. 분석한 사진은 메모리(최근 20초)에만 두고 디스크에 쓰지 않는다(`DATASET_COLLECT=1`일 때만 시험 자료로 쓴다).

- **엔진 프레임:** `BRAIN=1`이면 폰 서버가 상태 메시지 `engine_ms`(`ENGINE_FRAME_MS`, 기본 100ms)로 간격을 알리고, 폰은 그 간격마다 분석용 JPEG을 촬영 자세·투영 행렬·서버 시계 촬영 시각과 함께 보낸다. 폰은 앞 분석용 사진이 아직 인코딩 중이거나 보낼 것이 512KB 넘게 쌓여 있으면 그 차례를 건너뛰고 쌓지 않는다(⋯ 메뉴 측정 줄의 「분석용 사진」 수). 표시용 사진과 같은 그림 틀에서 크기가 같으면 카메라 그림은 한 번만 읽는다. 직전 프레임과 SHA-256이 같으면 버린다(멈춘 카메라). 영상 시험에서 붙잡은 마지막 장면(헤더 `held: true`)은 같은 사진이어도 VLM 간격(`VLM_FRAME_MS`, 기본 2초)마다 새 프레임으로 받는다. `held`는 폰 서버가 내주는 영상으로 연 연결(소켓 주소 `?video=<영상>`, 그 영상이 `RUNTIME_DIR/videos/`에 있을 때)에서만 넘기고, 실제 폰 연결의 `held`는 지운다. 표시 프레임·사진은 관찰 흐름에 들어가지 않는다.
- **빠른 프레임과 VLM 프레임:** YOLO는 모든 엔진 프레임에 돌아 World State의 자리·보임을 고치고, 감지가 된 프레임마다 물체 모양을 `/events`의 `seen` 메시지(마스크·프레임 크기, 기록 DB에 넣지 않음)로 대시보드에 보낸다. 앞 VLM 프레임보다 `VLM_FRAME_MS`(기본 2초) 이상 뒤에 찍힌 프레임만 VLM 프레임이다: observe 기록(YOLO 줄·VLM 답)을 남기고 VLM에 보내며, VLM 창과 가까이 보기도 VLM 프레임만 쓴다. `observe` 기록에는 상자를 싣지 않는다. 대시보드 폰 칸은 마지막 `seen`의 마스크를 영상 위 canvas 한 장에 칠하고(네모 테두리 없음, 불투명도 0.45, 토큰 `viz.mask`: 사람 · 마시는 그릇(컵·병·그릇) · 그 밖의 물건 세 무리마다 한 색, 가전 설비는 칠하지 않음) 마스크 테두리 위에 이름·신뢰도 이름표를 붙인다. 보낼 것이 256KB 넘게 쌓인 대시보드 연결에는 `seen`을 건너뛴다. `seen`이 600ms 넘게 안 오면 지운다.
- **YOLO 감지:** YOLO26n-seg(`models/yolo26n-seg.onnx`, Ultralytics, AGPL-3.0)가 [World State 낱말 표](world-vocabulary.md)의 사람·물건 30종·가전 설비 6종(COCO 번호는 `src/world/vocab.ts`, 유리컵은 컵, 식탁·의자 같은 가구는 거름)을 워커 스레드에서 하나씩 본다. 입력은 640 가운데 레터박스(RGB 0~1, 쌍선형), 앵커마다 가장 높은 종류 하나, 같은 종류끼리 NMS(IoU 0.5), 최소 점수 0.25. World State는 종류마다 낱말 표의 최소 신뢰도(사람 0.5, 컵·병·그릇 0.4, 작은 식기 0.45, 음식·드문 물건·가전 설비 0.5) 이상만 받는다. 감지마다 물체 모양(마스크: 프로토 160×160 칸에서 상자만 자른 0/1 그림)을 같이 내고, 상자는 마스크의 바깥 테두리, 바닥 점은 마스크 가장 아래 줄의 가운데다(`src/shared/mask.ts`). JPEG은 sharp로 푼다(못 불러오면 jpeg-js). 이 PC에서 360×640 엔진 프레임 한 장에 DirectML 약 74ms, CPU 8스레드 약 95ms다(JPEG 풀기 8 + 레터박스 4 + 추론 54·73 + 마스크 7, `scripts/brain-yolo-bench.ts`). 대기열(`DETECT_QUEUE_MAX`, 기본 8)이 차면 그 프레임은 「요청이 몰려 YOLO·VLM 분석 없음」, 감지가 실패하면 「감지 오류로 YOLO 분석 없음」(VLM은 그 프레임도 분석)이다. 모델 파일이 없으면 「감지기 없음」으로 VLM만 돈다. 같은 출력에서 크고 바닥에 서는 가구·가전(냉장고·싱크대·변기·침대·소파·식탁·오븐·전자레인지·TV) 상자는 폰 위치 맞추기 기준점으로도 따로 낸다(`landmarks`, 위 "위치 맞추기"). 가구는 World State에 넣지 않는다.
- **가까이 보기:** 실행 추적이 집기·놓기 단계가 8초 넘게 안 끝났다고 알리거나 판단 전 볼 면을 모르면 관찰 모드(`src/agent/observer.ts`)가 가까이 보기·사람 부탁·기다리기 중 하나를 고른다. 사람 부탁과 코치 계획의 다시 알리기는 모델이 가까이 볼 곳 id·알리는 방식(repeat 지금 명령 그대로, earlier 「먼저」를 붙임)만 고르고, 실행 추적이 서버 글(`src/plan/labels.ts` CLOSER_TEXT·TELL_TEXT)로 보낸다. 가까이 보기(`src/observe/pipeline.ts` `closer`)는 대상이 사진 안인 최근 엔진 프레임 5장까지(서로 다른 장이 3장 안 되면 하지 않음)를 장마다 대상 자리 둘레로 절반 크기 잘라 2배로 키워 같은 YOLO로 보고, World State에 한 번에 합친다(`applyCloser`). 물건 감지가 있는 가장 새 장 하나만 VLM에 보내고 그 답은 그 장에서 잡은 물건 사실만 넣는다. 그 VLM은 같은 주소에 `VLM_CLOSER_MODEL` 모델로 부른다(비우면 보통 프레임과 같은 `VLM_MODEL`). 맞는 물건이 없는 물건 감지는 서로 다른 원본 프레임 3장에서 같은 자리로 보이거나, 1장 이상 보이고 VLM이 그 감지에 사실을 하나 이상 답하면 확인된 새 물건이 된다. VLM이 그 감지에 사실을 답하지 않거나 가림(`not_visible`)을 함께 답하거나, 답이 없거나 끊기면 만들지 않는다. 이미 있는 물건도 가림을 함께 답한 상자의 사실은 넣지 않는다. VLM 답이 왔을 때 쓴 가장 새 사진이 지금보다 끊김 범위(`closerStaleMs`, 2초 간격이면 5초) 넘게 앞서 찍혔으면(폰 끊김) 그 답은 넣지 않고(결과 `vlm`: `no_fresh_frames`, 시도로 세지 않음) 새 물건도 만들지 않는다. 가까이 보기로 찾거나 만든 물건은 30초(`CLOSER_HOLD_MS`) 동안 전체 사진이 못 봐도 사라짐으로 세지 않는다.
- **관절:** 사람 감지(0.25 이상)가 있는 프레임만 같은 워커에서 YOLO26n-pose(`models/yolo26n-pose.onnx`)를 같은 640 입력으로 더 돌린다(추론 DirectML 약 44ms, CPU 8스레드 약 55ms). 사람이 이어서 보이는 동안에는 `BRAIN_POSE_EVERY`(기본 3)장에 한 번만 돌리고, 돌리지 않은 장은 관절 없이 넘긴다. 관절 17개 가운데 신뢰도 0.3 이상만 쓴다(`src/world/pose.ts`). 자세: 어깨·엉덩이를 이은 몸통이 수직에서 60° 넘게 기울면 누워 있음, 아니면 엉덩이·무릎을 이은 허벅지가 45° 넘으면 앉아 있음, 아니면 서 있음. 엉덩이나 무릎이 안 보이면 자세를 정하지 않는다. 손에 듦: 어느 관절이든 손목이 컵·병·그릇 상자 안이거나, 상자까지 거리 기준(어깨 너비·몸통×0.6·사람 상자 짧은 변×0.25 중 큰 값)×0.35 안이면 든 것이다. 사람 상자 넓이의 25%를 넘는 큰 물건은 손목이 상자 안일 때만 든 것이다. 대시보드에는 관절을 그리지 않는다.
- **VLM:** 엔진 프레임마다 한 번 부른다. 그 프레임과 앞선 엔진 프레임을 `VLM_WINDOW_FRAMES`(기본 5장, 2초 간격이면 10초)까지 오래된 것부터 보내고, 장마다 앞에 가장 새 프레임 기준 촬영 시각(「Photo 1 of 5, t-8s」 … 「Photo 5 of 5, t-0s (latest)」)을 붙인다. 처음에 프레임이 모자라면 있는 만큼 보낸다. YOLO 감지 목록(임시 번호·종류·박스)은 가장 새 프레임 것이다. 답(`{scene, observations: [{object_id, state}], summary}`, JSON Schema)의 `observations`는 가장 새 프레임에 보이는 사실(자리·안 내용·열림·쓰는 중·화면, 사람 자세·자리·들고 있음)과 5장 사이 사람의 하는 일 하나·순간 동작 하나다. state enum과 프롬프트의 값 목록은 낱말 표에서 만든다. `summary`는 여러 장 사이에 보이는 행동·변화(집어 듦·마심·내려놓음·닦음·화면 밖으로 나감)다. 요약은 World State 변화 줄 「VLM: …」로 PAM 관찰 텍스트에 들어간다. 동시 요청은 `VLM_MAX_INFLIGHT`(기본 4)까지, 제한 시간(`VLM_TIMEOUT_MS`, 기본 20초)이 지나면 HTTP 요청을 끊는다. 답은 프레임 번호로 맞춘다. 상한 초과·시간 초과·형식 오류·호출 오류 프레임은 「… VLM 분석 없음」으로 남긴다.
- **World State:** 등장·사라짐은 장 수가 아니라 시간으로 인정한다(`src/world/confirm.ts`, 한 장 = 2초). 등장은 처음 본 뒤 사람 2초·물건 4초 이어 보일 때, 사라짐은 마지막으로 본 뒤 그 자리가 시야 안인데 사람 4초·물건 6초 못 볼 때다(2초 간격이면 사람 2장·물건 3장). 반대쪽 프레임이 와도 셈하던 쪽을 본 지 500ms가 안 됐으면 끊지 않고, 셈하던 쪽 시간이 절반 이상이어야 인정한다. 등장 확인 전 물건은 500ms 넘게 못 보면 잊는다. 관절이 붙인 사실은 같은 값이 2초 이어져야 확신으로 올린다. 맞춘 뒤에는 물건 마스크의 바닥 점(가장 아래 줄의 가운데, 마스크가 없으면 박스 아래 가운데. 가까이 보기는 엔진 프레임 픽셀로 옮긴 점) 광선이 트윈의 식탁·책상·조리대·싱크대 윗면(없으면 바닥)과 만나는 점을 물건 위치로 쓰고, 같은 종류가 0.25m 안이면 같은 물체로 본다. 싱크볼이 있는 싱크대(도면 설비 `sink` 점, 평면도 `anchors.basin`)는 그 점을 가운데로 폭 0.74 × 깊이 0.44m(깊이는 배치 facing 방향) 싱크볼을 두고, 광선이 윗면 높이에서 그 안을 지나면 물건에 `surface_part: "basin"`(싱크볼 안)을 단다. 싱크볼 옆 조리대는 같은 싱크대 면이지만 싱크볼 안이 아니다. 그 자리가 시야 밖이면 「시야 밖」이고 사라짐을 세지 않는다. 맞추기 전에는 위치를 모르고 폰이 한 곳을 비춘다고 본다. VLM 사실은 면(자리·안 내용·열림·쓰는 중·화면·자세·들고 있음·하는 일·순간 동작)마다 두고 같은 값이 두 번 이어지면 확인됨이다. 그 종류에 없는 면의 값은 버린다. TV·냉장고·전자레인지·오븐·토스터·싱크대는 가전 설비라 보임·사라짐 없이 클로이드 눈의 방마다 하나(`tv_living`)에 VLM 상태만 둔다. 사람은 보인 수, 맞춘 뒤 발이 보이면 바닥 자리·방·가까운 가전(1.5m)을 둔다. 관절 사실도 같은 면에 둔다: 든 물건은 자리 「손에 있음」, 사람은 「물건을 들고 있음」(`holding`)과 자세 「서 있음·앉아 있음·누워 있음」. 같은 프레임에서는 관절 사실이 VLM 답보다 앞서고, 손목이 보이는데 물건에서 떨어졌거나 사람이 안 보이게 되면 관절이 붙인 「손에 있음」만 지운다. 식기에는 관계표로 식기세척기를, 음식에는 냉장고를 붙인다. 모든 가전의 상태 키(트윈 속성 값, 예: 작동 중·멈춤·켜짐·문 열림)·바뀐 시각·이력·남은 시간(`course_min`)을 쌓고, 바뀌면 사건 줄(「후면 발코니 세탁기 세탁 멈춤」)을 낸다. 냉장고·현관문 문이 1분 넘게 열리면 판단 타이머(250ms)가 「문이 1분 넘게 열림」을 한 번 낸다.
- **카메라로 맞추는 가전 상태(src/world/sight.ts, src/hub/signals.ts `observe`):** TV 화면 켜짐·꺼짐 → power, 냉장고 열림·닫힘 → door, 전자레인지 쓰는 중 → power(답에 쓰는 중이 없으면 꺼짐)와 열림·닫힘 → door(그 속성이 있는 가전만), 싱크대 물이 흐름 → faucet(답에 쓰는 중이 없으면 잠김). 오븐·토스터는 트윈 가전 종류가 없어 맞추지 않는다.
  - 고르기: 가전 설비 상자마다 그 사진을 찍은 눈의 방에서 같은 종류 트윈 가전 가운데 가운데 자리(배치 물건 가운데)가 시야 안인 것, 그중 상자 가운데 광선과 각이 가장 작은 것. 25° 넘거나 둘이 8° 안으로 붙거나 맞추기 전·방 모름·후보 없음·시야 밖이면 고르지 않고 가전 설비 `link.miss`에 까닭을 둔다.
  - 안정: 같은 값이 연속 2번(앞 값과 4초 안)이어야 허브로 넘긴다. 가림·답 없음은 값이 아니고, 시야 밖이면 마지막 상태를 그대로 둔다.
  - 우선: 실제 출처(ThinQ 읽은 값, 명령·센서 값을 받은 가상 기기)가 이긴다. 없으면(신호 없음, 읽기 전 ThinQ, 명령 받은 적 없는 가상 기기) 본 값이 기기 상태다. 기기 상태에 `vision: { twin, at, applied }`(`applied`: 본 값이 상태인가, `at`: 마지막으로 본 촬영 시각)가 붙어 3D 트윈·대시보드·에이전트가 다른 상태처럼 받는다. 실제 상태와 다르면 실제 상태를 두고 처음 한 번만 서버 로그와 World State 다름 줄(「거실 TV 카메라로는 켜짐 · 기기 값은 꺼짐」, 판단 계기 아님)을 낸다.
  - 글: 변화 줄 「주방·식당 냉장고 문 열림 · 카메라로 봄」, `[지속]` 줄 끝 「카메라로 봄, 마지막 확인 21:04:08」, 기록 DB `device` 줄도 같은 글. 대시보드 말풍선 줄 끝에 「카메라로 봄」(말풍선은 판단에서 확인한 기기에만).
  - 시야 여유(0.25)·각 기준(25°·8°)·연속 수(2번·4초)는 실제 프레임으로 아직 맞추지 않았다.
- **기록:** 프레임마다 `{type:"brain", event:{type:"observe"}}`(YOLO 글 또는 `yolo_missing`, VLM 요약 또는 `vlm_missing`)가 반드시 나가고(YOLO 결과에는 상자 `boxes`(엔진 프레임 픽셀 `[x, y, w, h]`, 감지 없음이면 `[]`)와 프레임 크기 `frame`), World State가 바뀌면 `world_change`와 `{type:"world"}`가 나간다. 상태는 `GET /api/brain`(감지기 `detector`·관절 모델 `pose`, 평균 `detect_ms`·`pose_ms`, 관절을 돌린 프레임 수 `posed`), World State는 `GET /api/world`.
- **판단 호출:** 기본(`PAM_TRIGGER=periodic`)은 5초(`PAM_PERIOD_MS`)마다 그때 World State로 PAM 서비스(`PAM_URL`)를 부른다. 언제 무엇을 할지는 PAM의 FSM(계기·행동)이 정하므로 변화를 기다리지 않는다. 사람이 떠난 뒤에도 부르므로 컵이 남은 때를 판단한다. 마지막 엔진 프레임 뒤 `PAM_LIVE_MS`(10초)가 지나면 부르지 않고(폰이 없으면 호출·비용 없음, 프레임이 다시 오면 바로 다시), 사람 없음·등장 사라짐 없음이 `PAM_IDLE_STOP_MS`(30분) 이어지면 멈췄다가 등장·사라짐이 생기면 다시 부른다. 나가 있는 판단은 `PAM_MAX_INFLIGHT`(1)까지라 판단이 5초보다 오래 걸리면 끝난 뒤 바로 다음을 부른다. `event`는 World State에 의미 있는 변화(사람·물건 등장·사라짐, 물건·가전 설비 상태 변화, 사람 방, 가전 사건)가 있을 때 부른다(최소 간격 `PAM_MIN_GAP_MS`). 넘기는 것은 관찰 텍스트(최근 60초 변화 줄, 이어진 같은 줄은 「처음~마지막 글 N번」, `[지속]` 물건·가전 설비·사람(수·방·가까이·자세·하는 일)·가전(켜짐류·관련 가전·10분 안에 바뀐 것, 남은 시간), `[때]` 날짜·요일·하루 때, `[눈]` 눈이 있는 방 이름) + 기억(그날 처음 정한 기억 판본, 아래 "기록과 반성") + 행동 목록이다. 판단마다 `{type:"brain", event:{type:"decision"}}`(번호 seq, 보낸 관찰 텍스트, PAM 답, World State 요약)이 나가고, PAM 연결 끊김·연결됨(`link`)과 판단 멈춤(「폰 사진이 오지 않아 판단을 멈춤」·「사람이 없어 판단을 멈춤」)·다시 시작(`trigger`)은 바뀔 때 한 번씩 나간다.
- **계획·검사·실행(src/act):** 고른 행동은 에이전트 계획 모드(`src/agent/planner.ts`)가 클로이드 계획으로 만든다. 행동 목록(`src/act/tasks.ts`)은 행동마다 설명과 쓸 수 있는 단계만 정한다. 모델은 `submit_plan` 한 번으로 계획 전체(단계 배열)를 내고(OpenAI는 그 함수를 지정하고 병렬 호출을 끈다, Anthropic은 생각이 늘 켜져 지정 대신 auto에 병렬 호출만 끈다), 낼 때마다 전체를 새로 검사해 틀리면 첫 틀린 단계와 까닭을 돌려받아 고친 전체를 다시 낸다(모델 차례 3번, 계획 하나 45초). 사람 단계(go·pick·place·do)에서 모델은 동작(act)·대상·물건(item)만 고르고, 단계 이름·폰 명령·안전 문구와 손 조작(켜기·끄기·열기·닫기)의 끝 조건은 서버가 만든다(`src/plan/labels.ts` STEP_TEXT, 가전마다 할 수 있는 동작은 `src/agent/planTools.ts` DEVICE_ACTS). 알림(say) 글과 기다리기(wait) 이름은 열쇠(notice, `src/plan/labels.ts` NOTICES)로, 질문(ask)의 답 단추·답 말은 답 묶음(`src/act/prompts.ts` ASK_CHOICES)으로 고르고, 모델이 쓰는 글은 질문 한 줄뿐이다(「?」로 끝남, 「주세요」·위험 가전 이름 없이). 말 요청 에이전트의 답은 위험 가전 이름 표(`src/agent/policy.ts` RISKY_ON_NAMES: 별명·흔한 오타·영어, 세 글자 이상은 띄어 써도)로만 보고 이름이 나오면 고정 글로 바꾼다. 이름 없이 조작만 말하는 답(예: 「전원 버튼을 눌러 주세요」)은 막지 못한다. 실제 `gpt-5.4-mini`로 컵 치우기 계획 한 번이 호출 1번 3~7초다(2026-11-11, 단계마다 부르던 때는 6번 12~19초). 컵 치우기는 World State의 컵(사라지지 않고 가장 최근에 본 것)을 집기 대상으로 하는 식탁·싱크대 네 단계, 물어보기는 폰 질문 한 단계다. 지시문은 물건을 놓는 단계(place)의 끝 조건을 「그 물건 자리 사실 또는 트윈 자리 조건(놓을 자리에 있고 손에 없음)」의 `any`와 사람이 그 물건을 들고 있지 않음(`not person_holding`)을 `all`로 묶어(물건 조건은 모두 `follow`) 쓰게 한다. 놓을 자리는 위에 놓기면 놓을 면(그 단계 target) 위, 안에 넣기(싱크대)면 그 면의 싱크볼 안(`part: "basin"`)이고, 싱크볼이 없는 자리에 넣기는 트윈 자리 조건 없이 자리 사실과 `not person_holding`만 쓴다. 계획 입력의 평면도 줄에 싱크볼 점이, World State 줄에 「싱크볼 안」이 붙는다. VLM이 자리 사실을 놓쳐도 트윈 자리로 넘어가고, 손에 든 채 지나가면 넘기지 않는다. 사람이 그 물건을 들고 있다고 보이면 자리 사실이 와도 넘기지 않는다. `person_holding`은 10초 안에 분석한 프레임에 사람이 안 보이면 거짓이고, 그 안에 분석한 프레임이 없으면 모름이라 단계가 넘어가지 않는다. 실행 추적이 옮긴 물건을 새 id로 이으면 조건은 그 id만 보고 사라진 원래 id는 보지 않는다. 실행 추적은 놓기 단계를 끝낸 물건과 그 계획의 넣은 곳(끝낸 때 그 면의 싱크볼 안이었으면 `part: "basin"`)을 남기고(`placed`), 계획 전·실행 전 검사와 대상 고르기(판단 전 가까이 보기 포함)는 그 물건을 VLM 자리 사실과 상관없이 이미 치운 것으로 본다. 계획 입력의 World State 물건 줄에는 상태 뒤에 「이미 치움」이 붙고, 제출 검사는 그 물건을 집거나 놓는 계획을 버린다(PAM 관찰 텍스트는 그대로). 그 뒤 손에 있음이 확인되거나(다시 집음) 트윈 자리가 그 영역을 벗어나면(다른 면, 싱크볼이면 같은 면이어도 싱크볼 밖) 지운다. 트윈 자리를 모르는 채 본 것으로는 지우지 않는다. 실행 전 검사(`src/act/check.ts`): 아는 행동, 대상 물건이 있고 이미 치운 것이 아니고 판단 뒤에 찍힌 프레임으로 다시 봤고 `STALE_MS`(기본 3초) 안, 사람이 들고 있거나 쓰는 중 아님, 이동 단계면 경로 있음, 시험 모드면 짝지은 실제 가전 단계 없음. 검사는 통과할 때까지 250ms마다 다시 보고 3초가 지나도 안 되면 그 이유로 실패한다. 통과하면 계획 단계마다 실제 폰에 명령 하나를 보내고 소리로 읽는다(`{type:"command"}`, 위 "실제 폰 명령"). 컵 치우기 명령과 넘어가는 때: 「식탁으로 가 주세요」(비전 상태 「식탁까지 2.4m」, 폰 눈이 식탁에서 1.2m 안), 「컵을 들어 주세요」(「컵 · 식탁 위」, World State 컵 자리가 손에 있음이거나 사람이 물건을 들고 있음), 「싱크대로 가 주세요」(「컵 · 손에 있음 · 싱크대까지 3.1m」, 폰 눈이 싱크대에서 1.2m 안), 「컵을 싱크대에 넣어 주세요」(「컵 · 손에 있음」, 컵 자리가 싱크대 안이거나 컵이 싱크볼 안이고 손에 없고, 사람이 그 컵을 들고 있지 않으면 명령을 지우고 완료). 거리는 맞춘 폰 눈 자리에서 평면도의 식탁·싱크대 자리까지이고, 맞추기 전에는 「거리 모름」이다. 한 번 볼 때(250ms tick·World State 변화·답) 한 단계만 넘긴다. 「완료」 단추나 말 「완료」「다 했어」는 지금 단계 하나를 넘기고, 말 「그만」은 계획을 취소한다(실행 기록은 「사용자가 그만둠」). 비전 상태는 바뀔 때만 0.5초에 한 번까지 보낸다. 한 단계가 30초마다 명령을 다시 읽고 2분 안에 안 끝나면 실패로 닫는다(폰을 닫고 나가도 이렇게 끝난다). 물어보기는 같은 자리에 질문과 답 단추를 띄우고 답을 받으면 완료. 대시보드 계획의 단계 상태(진행 중·완료)가 지금 단계를 따라간다. 단계마다 `{type:"brain", event:{type:"execution", plan_id, state, text}}`(판단·계획·실행 중·완료·실패)가 나간다. 진행 중 계획과 행동·대상이 같은 판단은 「같은 행동을 진행 중」, 지금 계획보다 seq가 작은 늦은 답은 「앞선 판단이라 쓰지 않음」으로 기록만 하고, 다른 행동을 고른 판단은 진행 중 계획을 바꾼다(앞 계획은 취소, 새 계획에 `supersedes`, 실제 폰의 앞 명령은 지운다).
- **화면:** 대시보드 판단 기록의 「클로이드 · 관찰과 판단」 카드에 World State 변화·연결·판단 시점 줄과 지금 YOLO·VLM 한 줄씩. 판단 줄(고른 행동·대기·판단 실패와 이유)이 카드를 닫고, 그 판단의 실행 줄은 같은 카드에 쌓인다(알약은 실행 단계). 판단 줄을 누르면 「판단 근거」가 펼쳐진다: 보낸 관찰 텍스트, 판단할 때 World State(물건마다 면, 사실별 확인됨·추정, 위치 오차, 사람·분석 없음 수), 참조한 기억 판본. 반성·연결·판단 시점은 줄 하나씩이다. 트윈 식탁 말풍선 메모는 마지막 YOLO 글이고, 열린 판단 계획의 집기 대상 물건·가전도 확인 목록에 든다.

실행(폰은 Tailscale 주소로 연다):

```bash
npx tsx scripts/brain-yolo-fetch.ts          # 저장소 models/의 YOLO26 두 파일 sha256 확인(받지 않는다)
HUB=memory HOME_ID=mokryeon_180b PHONE_PORT=8210 BRAIN=1 npm start
tailscale serve --bg 8210   # 이미 켜져 있으면 생략. 폰: https://<이 PC 이름>.<tailnet>.ts.net/phone/
```

- VLM은 `INFERENCE_MODE`가 고른 OpenAI 호환 주소로 부른다(`src/infer/vlm.ts`, chat completions + JSON Schema). mock은 OpenAI `gpt-5.4-mini`(키 `OPENAI_API_KEY`), live는 같은 서버 vLLM `vlm`. 2초 간격(기본)이면 시간당 약 1,800번이다. 비용은 호출마다 답의 사용량으로 세고(`src/infer/cost.ts`, `GET /api/brain`의 `vlm.costUsd`), 사진 수에 거의 비례한다.
- 키 없이 돌려 보기: `npx tsx scripts/fake-openai.ts --port 8500`을 띄우고 `VLM_BASE_URL=http://127.0.0.1:8500/v1`로 시작한다.

## 기록과 반성 (src/history)

기록 DB는 `RUNTIME_DIR/noonchi.db`(SQLite 파일 하나)다. 재시작해도 남는다.

- **한 시간축(`events` 표):** 종류(`src/contract/history.ts` `HistoryKind`)마다 시각·날짜·대상·글·data를 적는다.
  - `device` 가전 값 변화(시작 상태는 적지 않음), `detection` 사람·물건 등장·사라짐, `world` 나머지 World State 변화
  - `vlm` 프레임마다 VLM 답 또는 「… VLM 분석 없음」, `yolo` 「감지 오류로 YOLO 분석 없음」·「요청이 몰려 YOLO·VLM 분석 없음」
  - `pam_text` PAM에 보낸 관찰 텍스트, `decision` 판단(고른 행동·대기·판단 실패), `plan` 계획(목표·상태), `execution` 실행 단계, `mode` 운영 모드 변경
  - `link` PAM 연결 끊김·연결됨, `trigger` 판단 멈춤·다시 시작
  - 사진은 적지 않는다. YOLO 결과는 등장·사라짐으로, 관절 사실은 World State 변화로 남는다.
- 날짜는 `HISTORY_TZ_MINUTES`(기본 서울) 기준이다.
- **하루 요약(`GET /api/history/day/{날짜}`):** 반성 입력이다.
  - 관찰 텍스트: `detection`·`world`·`device` 줄을 시각 순으로 쓰고, 맨 끝에 `[하루] VLM 분석 N장 · VLM 분석 없음 M장 · YOLO 분석 없음 K장` 한 줄. 프레임마다 쓰는 `vlm`·`yolo` 줄은 세기만 한다.
  - 행동 요약: 「클로이드 판단: …」·「클로이드 실행: …」·「사용자: …」(피드백).
  - 이어진 같은 줄은 「처음~마지막 글 N번」 한 줄로 묶는다.
  - 크기 한도를 주면 관찰 텍스트 70%·행동 요약 30%로 나누고(한쪽이 덜 쓰면 다른 쪽이 씀), 넘으면 오래된 줄부터 빼고 첫 줄에 「앞선 기록 N줄 생략」을 둔다.
- **기억 판본(`memories` 표):** 판단은 그날 처음 정한 판본을 하루 내내 쓴다(`meta` `memory_day:<날짜>`). 판본이 없으면 컵 FSM 기억을 1판으로 저장한다.
- **반성:** 매일 `REFLECT_AT`(기본 23:30)이나 `POST /api/reflection/run`으로 돈다. 한 번에 하나만 돈다.
  - PAM 서비스 `GET /health`의 `reflect_input_bytes`에서 기억 JSON·피드백 크기를 빼고, 그 안으로 하루 요약을 줄여 `pam-reflect/2`로 보낸다. 칸 상한(관찰 100,000·행동 50,000·피드백 8,000자)도 넘지 않게 하고, 피드백은 최근 것부터 담는다.
  - 새 기억은 다음 날부터 쓴다. 다음 날 판단이 이미 다른 판본으로 시작했으면 그다음 날부터다.
  - 결과는 기록 DB(`reflection`)와 대시보드 판단 기록(`{type:"brain", event:{type:"reflection"}}`)에 남는다. 그날 기록이 없으면 PAM을 부르지 않고 실패로 남긴다.
- **사진 보관(`photos` 표):** 디스크에는 폰 사진 찍기 사진(`photos/`, 기록 `photo`)과 `DATASET_COLLECT=1`일 때의 시험 자료(`dataset/`)만 쓴다. 시작 때와 1시간마다 보관 기간(`PHOTO_RETENTION_DAYS`·`DATASET_RETENTION_DAYS`, 기본 7일)이 지난 파일과 같은 이름의 `.json`을 지운다.

## PAM 서비스 (services/pam)

판단·반성을 HTTP로 내준다: `POST /predict`(`pam-predict/2`), `POST /reflect`(`pam-reflect/2`), `GET /health`(`llm`, `limits`). 계약은 `docs/pam-interface.md`. 논문 PAM 코드·프롬프트(`pam/`, `prompts/`, `config/`)를 옮겨 왔고 출처는 `services/pam/PROVENANCE.md`·`THIRD_PARTY.md`다.

```bash
py -3.13 -m venv services/pam/.venv                                   # 한 번만
services/pam/.venv/Scripts/python.exe -m pip install --require-hashes -r services/pam/requirements-test.lock
cd services/pam && .venv/Scripts/python.exe -m uvicorn noonchi_pam.app:create_app --factory --port 8300
```

- 의존성은 판과 sha256을 고정한 `requirements.lock`(이미지)·`requirements-test.lock`(시험)으로 깐다. `pyproject.toml`의 판을 바꾸면 두 파일 머리의 `uv pip compile` 명령으로 다시 만든다.
- 직접 띄우면 셸 환경 변수만 읽는다(`.env`는 compose가 넘긴다). mock은 `OPENROUTER_API_KEY`가 있어야 판단·반성이 된다.
- OpenRouter 대신 OpenAI로 판단하려면 `PAM_LLM_PROVIDER=openai`와 `OPENAI_API_KEY`를 준다. 모델은 `gpt-5.4-mini`, 생각은 `reasoning_effort`(판단 none, 반성 medium)이고 생각을 켤 때는 temperature를 보내지 않는다.
- 가짜 서버로 띄우기: `INFERENCE_MODE=live PAM_LLM_BASE_URL=http://127.0.0.1:8500/v1`(가짜 서버를 먼저 띄운다).
- 답: 계약에 맞지 않으면 400, 문맥 길이를 넘으면 413, PAM LLM 오류·잘린 답은 502.
- 시험: `npm run heavy -- services\pam\.venv\Scripts\python.exe -m pytest services/pam -q`(가짜 OpenAI 호환 서버를 띄워 쓴다).

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
- **도구**(`tools.ts`, 에이전트·MCP 공용, zod 스키마 + 한국어 설명): `list_rooms`, `list_devices{room?,kind?}`, `find_devices{query}`, `get_state{device_id}`, `turn_on`, `turn_off`, `set_level{percent}`, `set_climate{mode?,setpoint_c?,fan?}`, `set_covering{open_percent}`, `lock`, `unlock`, `start`, `stop`, `set_valve{open}`. `confirm_action{token}`은 MCP에만 있다. `device_id`에 정확한 한국어 이름("거실 TV")도 넣을 수 있다.
  - 도구는 `ToolBackend`로 집을 다룬다. 서버 안은 `localBackend(hub, policy, rooms)`, MCP는 `httpBackend(url)`(REST)이다.
- **기기 찾기**(`search.ts`): 방 이름은 긴 것부터(안방 욕실 > 안방), 별칭(화장실 → 공용 욕실, 부엌 → 주방·식당, 베란다 → 다용도실), 종류 동의어(불 → 조명, 티비 → TV), 조사 떼기.
- **시스템 프롬프트**(`prompts.ts`, 한국어): 방·기기 목록, 승인 규칙, 센서 규칙, 방을 말하지 않으면 직전 방 → 거실, "1~2문장으로 짧게 보고". 바뀌는 상태는 넣지 않는다(캐시 유지).
- **공급자**(`providers/`)
  - `anthropic`: Messages API 도구 사용, `ANTHROPIC_MODEL`(기본 `claude-opus-5-5`). 이 모델은 thinking을 끌 수 없어 `thinking`을 보내지 않고 `output_config.effort`(`ANTHROPIC_EFFORT`, 기본 `low`)로 깊이를 정한다. 거절 대체 `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)를 기본으로 켠다.
  - `openai`: Responses API 함수 호출, `OPENAI_MODEL`(기본 `gpt-5.5`).
  - 키가 없어도 다른 공급자로 바꾸지 않는다. 부르면 요청을 보내지 않고 키가 없다고 실패한다. `/api/health` `ready.agent`(키·주소 응답)가 준비 안 됨이다.
  - 시험은 같은 OpenAI 공급자를 가짜 OpenAI 호환 서버(`tests/helpers/llm.ts`, `OPENAI_BASE_URL`)에 붙인다. 가짜 서버는 사용자 말마다 정한 도구 호출과 답을 낸다.
  - 키는 로그·응답에 넣지 않는다.

## MCP (src/mcp/server.ts)

stdio MCP 서버다. 에이전트 도구를 그대로 노출하고, **실행 중인 twin-home 서버**의 REST(`TWIN_HOME_URL`)를 부른다. 그래서 Claude Code나 Claude Desktop이 그대로 이 집의 에이전트가 된다. 허브가 matter면 MCP 명령도 Matter 속성을 바꾼다(e2e 테스트로 확인).

```bash
npm start                                                       # 먼저 서버를 띄운다(다른 터미널)
claude mcp add twin-home -- npx tsx src/mcp/server.ts           # 이 레포 폴더에서
claude mcp add twin-home -e TWIN_HOME_URL=http://127.0.0.1:8200 -- npx tsx <저장소 폴더>/src/mcp/server.ts   # 다른 폴더에서
```

Claude Desktop(`claude_desktop_config.json`)은 같은 명령을 이렇게 적는다(이 형식은 여기서 실행해 보지 않았다).

```json
{
  "mcpServers": {
    "twin-home": {
      "command": "npx",
      "args": ["-y", "tsx", "<저장소 폴더>/src/mcp/server.ts"],
      "env": { "TWIN_HOME_URL": "http://127.0.0.1:8200" }
    }
  }
}
```

- 사용 예: Claude Code에서 "거실 불 켜고 TV 꺼줘" → `find_devices` → `turn_on`/`turn_off`.
- 승인이 필요한 명령(현관문 잠금 해제, 인덕션·전자레인지는 끄기 말고 상태를 바꾸는 명령 전부)은 `needsConfirmation.token`을 돌려준다. 사용자가 승인하면 `confirm_action{token}`으로 실행한다. 웹 화면의 승인 버튼으로 확정해도 된다.
- 실패는 `isError: true`와 한국어 `error`로 돌려준다. 서버가 꺼져 있으면 "twin-home 서버에 연결하지 못했습니다…"라고 알린다.
- stdout은 MCP 전용이고 로그는 stderr로 쓴다.
- 테스트(`tests/mcp.test.ts`, `tests/e2e.test.ts`)는 `node --import tsx src/mcp/server.ts`를 레포 폴더에서 실제로 띄워 SDK 클라이언트로 부른다.

## Matter (src/matter)

`MatterHub`가 `DeviceHub`를 matter.js 0.17.9로 구현한다. 상태의 원천은 브리지의 Matter 속성이고, twin 상태는 `model/mapping.ts`로 계산한다.

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

## 기기 목록 (src/model/devices.ts)

- 고른 집(`HOME_ID`)의 1순위 `<out>/scene.json` objects 중 `attrs`가 있는 것. 없거나 깨져 있으면 그 집 `<data>`의 `placement.json` + `floorplan.json`의 문 + 카탈로그(`<data>/catalog` → `data/catalog` → 옛 `data/apartment/catalog`)로 만든다(`loadTwin(dir, { source: "auto" | "scene" | "catalog", home })`).
- 초기 twin 상태: scene/placement `state` > 카탈로그 `states.<attr>.default` > attr 기본값(꺼짐·멈춤·닫힘·잠김, 커튼은 열림).
- 문: 방은 twin-studio `layout.py`와 같은 규칙. 이름은 `현관문`, 나머지는 `<들어가는 방> 문`(예: `작은방 문`).
- 월패드(`wall_pad`)·CLOiD 로봇(`robot`)은 twin 전용이라 목록에서 뺀다(`TwinData.skipped`).
- 현재 데이터(2026-10-11, scene.json): 기기 65개(조명 22, 문 센서 9, 수전 4, 에어컨 4, 플러그 3, 충전 상태 3, 커튼·블라인드 3, 팬 3, 공기청정기 2, 나머지 1개씩), 방 13개.

## 기기 매핑 (src/model/mapping.ts)

가전 종류별 값은 가전 종류 등록부(`src/model/kinds.ts` `KINDS`) 한 곳에 있다: 이름(`label`)·찾기 말(`synonyms`)·Matter 연결(`profile`)·트윈 type(`twinTypes`)·늘 묻는 승인(`confirm`)·위험 가전 이름과 안전 문구(`riskyOn`)·손 조작(`hand`)·카메라 설비와 맞추는 규칙(`camera`)·ThinQ 짝짓기(`thinq`)·오래 이어지면 나는 사건(`longEvents`)·종류별 상태 글(`stateText`). `TYPE_RULES`(twin type → 종류)·`KIND_PROFILES`(종류 → matter.js 기기·능력·제어 attr)·`KIND_LABELS`와 에이전트·정책·카메라 쪽 표는 모두 등록부에서 파생한다. 제어 명령(잠금·커튼·난방 설정점)은 종류 이름이 아니라 프로필 모델(`profile.model`)로 가른다. 등록부 밖에 종류별 표를 새로 두면 `tests/kinds-registry.test.ts`의 구조 검사가 실패한다.

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

1. `src/model/kinds.ts`의 `KINDS`에 항목 하나를 더한다: `label`(이름), `synonyms`(찾기 말), `profile`(Matter 기기 종류·기능·제어 속성·센서), `twinTypes`(트윈 type 이름). 사람이 손으로 조작하면 `hand`, ThinQ와 짝지으면 `thinq`. 필수 칸을 빼면 타입 오류가 난다.
2. 집 파일 `twin/data/homes/<집>/added_devices.json`에 한 줄을 더한다: `id`·`type`(1번 `twinTypes`의 이름)·`label`·`room`·`position`·`facing_deg`·`elevation`.
3. 카메라로 볼 수 있으면: YOLO(COCO)에 그 종류가 있으면 `src/world/vocab.ts` `CLASSES`에 설비 종류(role fixture)를 두고, 등록부 항목에 `camera: { fixture, sight }`를 적는다.
4. 3D 모델이 없으면: 카탈로그(`twin/data/catalog/<type>.json`)나 모델 파일이 없어도 기기는 생기고, 대시보드 트윈에는 그 자리의 회색 상자로 보인다. 모양을 넣으려면 카탈로그와 `twin/library/assets/`의 모델을 더한다.
5. 불·열이 나는 가전은 `riskyOn`과 `riskyReason`을 둔다(끄기 말고 상태를 바꾸는 명령은 전부 승인 질문). 잠금 해제처럼 명령 하나만 승인하려면 `confirm`에 그 명령 이름을 적는다(정규화로 이름이 바뀌는 on·off는 쓰지 않는다). ThinQ로 짝지으려면 이미 있는 어댑터(`air_conditioner`·`refrigerator`) 가운데 받는 명령이 맞는 것을 `thinq.adapter`로 고르고, 맞는 어댑터가 없으면 `src/thinq/appliance.ts`에 어댑터를 먼저 더한다. 틀린 조합은 서버 시작 때 `checkKinds`가 까닭과 함께 막는다.
6. `npm run heavy -- npx vitest run tests/kinds-registry.test.ts tests/kinds-behavior.test.ts`로 확인한다.

## 승인 정책 (src/agent/policy.ts)

- 승인 대상 판정은 `needsConfirm` 하나다: 위험 켜기 종류(등록부 `riskyOn`: 인덕션·전자레인지)는 그 기기 사양으로 정규화한 명령이 끄기(`off`·`stop`)가 아니면 모두(켜기·시작·세기 등, 덮어쓴 capabilities여도), 그 밖에는 등록부 `confirm` 명령(현관문 잠금 해제). 승인 토큰이 있어야 실행한다. 정책·손 조작 켜기 질문(`riskyHand`)·계획 입력과 에이전트 지시문의 위험 목록 글이 모두 이 판정과 등록부에서 나온다.
- 서버는 시작 때 등록부를 검증한다(`src/model/kinds-check.ts` `checkKinds`): confirm 명령이 모든 사양에서 정규화해도 같은 이름인지, 위험 켜기 종류에 confirm 대신 riskyReason이 있는지, ThinQ 어댑터가 그 종류의 모든 사양 명령을 받는지(읽기만 하는 어댑터에는 제어 없는 프로필만), 손 조작이 제어·문 센서·카메라 열림 면과 맞는지. 틀리면 까닭과 함께 시작을 멈춘다.
- `policy.guard(hub, id, cmd, confirmToken?)`: 실행할 수 없는 명령은 바로 오류. 승인이 필요하면 `{ ok: false, needsConfirmation: { token, reason } }`(서버는 409). 토큰은 한 번만 쓰고 5분 뒤 만료된다.
- `policy.confirm(hub, token)`: 토큰만으로 대기 중인 명령을 실행한다(화면 승인 버튼).

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
