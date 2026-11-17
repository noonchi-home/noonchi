# 단계 사이를 메시지 줄로 나누기 (ROS 2처럼, Redis) Implementation Plan

> **쉬운 요약**
> 1. 서버 안의 단계(폰·화면 연결, 인식, 집 상태, 판단, 실행 추적, 가전, 기록)를 「노드」로 나누고, 노드끼리는 함수를 부르지 않고 「토픽」에 메시지를 넣고 받기만 해요(ROS 2처럼).
> 2. 토픽마다 받는 방식(QoS)을 한 표에 정해요: 사진처럼 최신만 보면 되는 것, 지금 상태 하나, 꼭 다 받아야 하는 것. 표에 빠지면 타입 검사가 실패해요.
> 3. 통로는 Redis(EC2 안 noonchi 옆 컨테이너)이고, 시험·개발은 같은 동작의 메모리 통로를 써요. 두 통로가 같게 도는지 같은 시험으로 봐요.
> 4. 노드는 메시지를 하나씩 차례로 처리하고, 낡은 메시지는 받는 쪽 한곳에서 버려요. 오늘 고친 순서·다시 들어오기·늦은 답·타이머 버그가 구조로 막혀요.
> 5. 여섯 묶음으로 옮기고, 묶음마다 데모 e2e 넷과 영상 모드 시험이 통과해야 다음으로 가요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 집 실행 묶음(`src/server/home/`)이 부품끼리 콜백으로 직접 잇던 것을, 노드가 토픽으로만 주고받는 구조로 바꾼다. 통로는 Redis Streams(실제)와 메모리(시험·개발)를 바꿔 끼운다.

**Architecture:** 새 도메인 `src/bus/`가 토픽 표(이름·QoS·메시지 모양·보내는 노드), 메시지 머리(stamp·node·seq·gen), 통로 인터페이스 `Bus`(`MemoryBus`·`RedisBus`), 노드 실행기(`BusNode`: 콜백 하나씩, 타이머도 같은 줄, 낡은 메시지 버리기), 녹화·재생을 맡는다. 노드는 모두 한 Node 프로세스(noonchi 컨테이너) 안에서 돌고 통로로만 이어진다. 폰 화면을 누가 쓰는지는 줄과 따로 사용권 표 하나로 정한다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, `redis`(node-redis) 6.3.1, Redis 8.10.2(`redis:8.10.2-alpine`), `node:sqlite`, Vitest.

**Spec:** 사용자 결정(2026-11-17, 조정자 전달): 「ROS 2처럼 Redis를 쓰는 코드를 짜자」, Redis는 EC2 안 noonchi 옆 컨테이너, 개발용 Redis는 이 PC의 Docker 컨테이너. 아키텍처 그림 `2026_SWE_NOONCHI_Archi.drawio`(인식 ↔ Redis ↔ noonchi, pam 없음). 앞선 일: `docs/superpowers/plans/2026-11-17-pam-in-node.md`(이 계획은 그 브랜치 끝에서 시작한다).

## 정한 것 (2026-11-17, 사용자)

1. **Redis 자리:** EC2 안에서 noonchi 옆 컨테이너(ElastiCache 아님). 서버 한 대가 로봇 몸 안 컴퓨터, Redis가 그 안의 ROS 2 통로다.
2. **노드:** 폰·화면 연결(`phone`), 인식(`perception`), 집 상태(`world`), 판단(`brain`), 실행 추적(`act`), 가전(`devices`), 기록(`recorder`). 노드는 토픽 구독·발행만 한다. 다른 노드 코드를 import하면 도메인 경계 시험이 실패한다.
3. **실행기:** 노드마다 콜백(메시지·타이머)을 하나씩 차례로 처리한다(ROS 2 single-threaded executor). 다시 들어오기가 없다.
4. **QoS 셋**(토픽마다 하나, 표에 없으면 타입 검사 실패):
   - **SENSOR:** best effort, keep last N. Redis Stream `MAXLEN ~N`, ack 없음, 늘 최신을 읽는다.
   - **STATE:** 열쇠(key)마다 최신 값 하나. 늦게 붙은 노드도 바로 받는다(ROS 2 transient local).
   - **RELIABLE:** consumer group, `XREADGROUP`/`XACK`, 못 받은 것 다시 주기, 처리 뒤 자르기.
5. **메시지 머리:** `stamp`(찍힌 시각), `node`(보낸 노드), `seq`, `gen`(세대). zod로 모양을 검사하고 JSON으로 직렬화한다. 사진은 SENSOR 토픽에 최근 몇 장만 담는다. 낡은 메시지(지난 세대, 더 옛 stamp)는 받는 쪽 한곳(실행기)에서 버린다.
6. **통로 바꿔 끼우기(rmw처럼):** `Bus` 하나에 `RedisBus`·`MemoryBus`. `REDIS_URL`이 있으면 `RedisBus`, 없으면 `MemoryBus`. 두 통로는 같은 계약 시험을 통과한다. 실제 Redis 시험은 `REDIS_URL`이 있을 때만 돌고, 없으면 건너뛴다(CI·다른 PC).
7. **개발용 Redis:** 이 PC는 Docker 컨테이너. 개발용 compose 파일(`compose.dev.yaml`)의 `redis` 서비스, 공식 이미지 판 고정, 컨테이너 이름 `noonchi-redis`, `127.0.0.1:6379`만 연다. 시험·개발 서버는 `REDIS_URL=redis://127.0.0.1:6379`. AWS compose도 같은 이미지·판.
8. **Docker Desktop은 실제 Redis 시험 때만 켠다.** 켜면 WSL VM이 1GB 넘게 쓴다. 켜기 전 빈 메모리를 보고 2.6GB 밑이면 기다린다. 끝나면 끈다. 실제 Redis 시험은 무거운 일이라 하나씩(`npm run heavy`).
9. **녹화·재생(rosbag2처럼):** 기록 노드가 모든 토픽을 SQLite에 남긴다. 하루치를 통로에 다시 흘려 시험한다.
10. **폰 사용권:** 줄과 따로 표 하나: 안전 안내 > 승인 질문 > 대화 > 계획 명령 > 가까이 가서 보기.
11. **옮기는 순서:** ① 통로·QoS 표·메시지 머리·MemoryBus·RedisBus·녹화 ② 집 상태 입력(실행 추적이 World State를 직접 바꾸던 `contentsAction`·`guard` 포함) ③ 실행 추적 ↔ 폰(콜백 22개) ④ 판단 ⑤ 가전 ⑥ 경계 검사를 엄격하게. 묶음마다 데모 e2e 넷과 영상 모드 시험이 통과해야 한다.
12. **배포:** AWS용 `compose.yaml`에 `redis` 컨테이너를 더한다(noonchi와 같은 EC2).

## 이 계획에서 정한 것

1. **새 도메인 `bus`:** 기반층(`src/shared`·`src/infer`)은 npm 패키지를 가져올 수 없고(`scripts/lint-domains.ts:177`), 계약(`src/contract`)은 타입만 가져온다. 통로는 zod·`redis`를 쓰므로 도메인 `src/bus/`(의존 없음)로 두고, 모든 노드 도메인이 가져올 수 있게 한다.
2. **노드 = 도메인 하나의 `node.ts`:** `src/phone/node.ts`, `src/observe/node.ts`(인식), `src/world/node.ts`, `src/brain/node.ts`, `src/act/node.ts`, `src/devices/node.ts`, `src/record/node.ts`(새 도메인). `src/server/`는 노드를 띄우는 곳(launch)으로, 노드 입구만 가져온다.
3. **도구 묶음(노드 아님):** `layout`(평면도·자리 이름, 읽기만), `agent`(대화·계획 모드·관찰 모드 LLM 호출). 노드가 가져와 쓴다. 대화는 폰 노드 안에서, 계획 모드는 판단 노드 안에서(묶음 4), 관찰 모드는 실행 추적 노드의 보기 담당 안에서 돈다.
4. **한 프로세스, 여러 노드:** 노드는 지금처럼 noonchi 프로세스 하나에서 돈다. 통로만 Redis를 지난다. 노드를 다른 프로세스로 떼는 일은 이 계획 밖이다.
5. **RELIABLE은 「붙은 뒤부터」:** consumer group은 처음 구독할 때 `$`(지금 끝)부터 만든다. 그래서 띄우는 곳(launch)이 모든 노드의 구독을 마친 뒤에야 노드를 시작한다(`start()`). 노드가 죽었다 다시 뜨면 그룹이 남아 있어 못 받은 것을 다시 받는다.
6. **STATE 열쇠:** STATE 토픽은 열쇠마다 최신 하나(Kafka log compaction처럼). 열쇠가 하나인 토픽은 `"_"`.
7. **세대(`gen`):** 메시지가 가리키는 것의 세대다. 집 세대(집을 열 때마다 +1, 기본), 요청에 대한 답은 요청의 세대를 그대로 돌려준다(가까이 보기 답은 보기 요청 세대, 영상 바꾸기는 명령 id·단계). 실행기가 (토픽, 열쇠)마다 본 가장 높은 세대보다 낮으면 버리고, 순서 토픽(`ordered`)이면 같은 세대에서 더 옛 stamp도 버린다.
8. **사진은 녹화하지 않는다:** 「분석한 프레임은 디스크에 쓰지 않는다」(`tests/no-frames-on-disk.test.ts`)를 지킨다. 기록 노드는 사진 칸(`jpeg`)을 빼고 머리·나머지 칸만 남긴다(`DATASET_COLLECT=1`일 때도 사진은 지금 자료 수집기만 쓴다). 그래서 재생은 인식 결과 토픽부터 흘린다.
9. **폰 사용권은 폰 노드가 정한다:** 각 노드는 「폰을 쓰고 싶다」를 `/phone/claim`(STATE, 열쇠 = 사용권 종류)에 내고, 폰 노드가 표로 하나를 골라 화면에 띄우고 `/phone/owner`(STATE)로 알린다. 지금 흩어진 막기(`policy.pause` 안전 명령, `approvalsWaiting`, `talking`, 승인 대기 시간 멈춤)가 이 표 하나로 간다.
10. **이 계획의 깊이:** 묶음 1은 단계·코드까지 쓴다. 묶음 2~6은 토픽·파일·시험·끝 조건까지 정하고, 앞 묶음이 끝나면 그 묶음의 단계 계획을 같은 파일에 더한다(묶음마다 Codex 설계 검토).

## 근거: 오늘 고친 버그와 구조로 막는 자리

| 갈래 | 커밋 | 무엇이 틀렸나 | 새 구조에서 막는 것 |
|---|---|---|---|
| 다시 들어오기 | 1620be1 → 8a13f9f | 실행 추적 콜백 안에서 World State를 바꾸고 바로 방송하면 실행 추적에 다시 들어가서, `queueMicrotask`로 방송을 미뤘다(`src/server/home/act.ts` `answerContents`) | 실행기가 콜백을 하나씩 처리하고, 발행은 콜백이 끝난 뒤 받는 쪽 줄에 들어간다(정한 것 3) |
| 다시 들어오기·지름길 | `src/server/home/act.ts:141,143`(cb07b65) | 실행 추적이 `world.guard`·`world.contentsAction`으로 World State를 직접 바꾸고 방송하지 않는다 | 묶음 2: `/world/input`(RELIABLE)으로만 바꾼다 |
| 순서 | d1ccae2 | 같은 원본 프레임의 잘라 본 답과 전체 답, 몸통(불투명)과 내용물의 넣는 차례 | 인식 답에 원본 프레임 stamp·seq, 집 상태 노드가 한 줄로 차례대로 넣는다 |
| 순서 | e54860d, 4dc5de7 | 새 계획이 같은 컵의 보기 지킴을 쓰기 전에 계획 밖 보기를 거둬야 했고, 계획을 만드는 중 「그만」이 계획 밖 보기를 멈추지 않았다 | 실행 추적 노드의 한 줄: 「그만」·새 계획·보기 거두기가 들어온 차례대로 처리된다 |
| 늦은 답 | 292eb63 | 옛 위에서 본 쌍이 새 확인을 덮고, 늦은 위에서 본 답이 보임을 바꿨다 | 세대·stamp로 받는 쪽 한곳에서 버린다(정한 것 5, 이 계획 7) |
| 늦은 답 | 58246d8 | 지나간 질문에 늦게 온 말 답 | 질문 세대를 답에 실어 `/phone/progress`에서 버린다 |
| 늦은 답 | c966b20, 6a2efe9, cb07b65 | 지난 명령의 단계 영상 바꾸기·예약이 새 명령 뒤에 끝났다 | 명령 세대(명령 id·단계)를 `/act/phone_command`·`/phone/progress`에 싣는다 |
| 타이머 | a243ea5 | 다른 검사로 멈춘 보류 계획에서 다시 보기 기한이 계속 흘러 3초 만에 닫혔다 | 타이머도 같은 실행기 줄에서 돈다. 기한은 노드 상태로만 센다 |
| 타이머 | 6fb2d1d | 가까이 보기가 아직 도는 동안 보류 기한이 지나도 닫히지 않았다 | 기한 타이머 콜백이 보기 콜백과 끼어들지 않고 차례로 돈다 |
| 흩어진 폰 사용권 | `src/server/home/act.ts:119,145-146` | 안전 명령 때 승인 시간 멈춤, 승인 대기·대화 중 막기가 세 곳에 따로 있다 | 사용권 표 하나(정한 것 10) |
| 콜백 수 | `src/server/home/act.ts:100-151` | 실행 추적에 함수 22개를 넘긴다 | 묶음 3: 토픽으로 바꾼다(아래 표) |

## 레퍼런스

- ROS 2 QoS: sensor data 프로필은 best effort·keep last(작은 depth), 명령·상태 서비스는 reliable. transient local은 늦게 붙은 구독자에게 마지막 값을 준다. (docs.ros.org 「Quality of Service settings」)
- ROS 2 executor: single-threaded executor는 콜백을 한 스레드에서 하나씩 돌린다. 타이머도 콜백이다.
- ROS 2 `std_msgs/Header`: `stamp`, `frame_id`. 우리는 `frame_id` 대신 `node`·`seq`·`gen`.
- rosbag2: 모든 토픽을 녹화하고 다시 흘린다.
- Home Assistant core: State Machine이 엔티티마다 최신 상태를 들고, Event Bus가 `state_changed` 사건을 낸다. 우리 `/world/state`(STATE)와 `/world/changes`(RELIABLE)가 같은 짝이다.
- Kafka log compaction: 열쇠마다 마지막 값만 남기는 상태 토픽과, 사건을 다 남기는 사건 토픽을 나눈다. 우리 STATE와 RELIABLE.
- Redis Streams: `XADD … MAXLEN ~ N`, consumer group `XGROUP CREATE … $ MKSTREAM`, `XREADGROUP`, `XACK`, 못 받은 것 `XAUTOCLAIM`, 자르기 `XTRIM MINID`.

## 노드와 토픽

### 노드

| 노드 | 도메인 | 지금 코드 | 구독 | 발행 |
|---|---|---|---|---|
| `phone` 폰·화면 연결 | `src/phone` | 폰 서버, 대시보드 방송(`app.broadcast`), 대화(agent) | `/act/phone_command`, `/phone/claim`, `/world/state`, `/brain/decision`, `/brain/thought`, `/act/plan`, `/act/log`, `/device/state`, `/phone/say` | `/perception/frame`, `/phone/pose`, `/phone/progress`, `/phone/heard`, `/phone/link`, `/phone/owner`, `/phone/claim`(대화·승인 질문), `/device/command`(말로 시킨 가전) |
| `perception` 인식 | `src/observe` | `ObservePipeline`(YOLO·VLM·가까이 보기·위에서 보기) | `/perception/frame`, `/perception/look_request` | `/perception/detections`, `/perception/analysis`, `/perception/look_result` |
| `world` 집 상태 | `src/world` | `WorldState` | `/perception/detections`, `/perception/analysis`, `/perception/look_result`, `/phone/pose`, `/device/state`, `/world/input` | `/world/state`, `/world/changes` |
| `brain` 판단 | `src/brain` | `Decider`·Trigger·PAM, 계획 전 검사·계획 모드(묶음 4), 생각 메시지, 반성 | `/world/state`, `/world/changes`, `/act/status`, `/phone/heard`, `/brain/cancel`, `/device/state` | `/brain/decision`, `/brain/plan`, `/brain/thought`, `/brain/link` |
| `act` 실행 추적 | `src/act` | `ExecutionTracker`·`Looker`·`PlanHub`·승인 기억 | `/brain/plan`, `/world/state`, `/world/changes`, `/phone/progress`, `/phone/owner`, `/phone/link`, `/device/state`, `/device/result`, `/perception/look_result` | `/act/phone_command`, `/act/plan`, `/act/status`, `/act/log`, `/phone/claim`(계획 명령·보기·안전 안내·승인 질문), `/phone/say`, `/world/input`, `/perception/look_request`, `/device/command`, `/brain/cancel` |
| `devices` 가전 | `src/devices` | 허브 `signals`, 정책(위험 목록은 승인 토큰) | `/device/command` | `/device/state`, `/device/result` |
| `recorder` 기록 | `src/record`(새) | 기록 DB 쓰기(`attachRecorder`), 녹화 | 모든 토픽 | 없음 |

### 토픽 표(`src/bus/topics.ts` 하나)

| 토픽 | QoS | 열쇠 | 순서 | 보내는 노드 | 담는 것 |
|---|---|---|---|---|---|
| `/perception/frame` | SENSOR depth 4 | `_` | stamp | phone | 엔진 프레임(JPEG·자세·촬영 시각) |
| `/phone/pose` | SENSOR depth 8 | `_` | stamp | phone | 맞춘 폰 눈 자리 |
| `/perception/detections` | SENSOR depth 8 | `_` | stamp | perception | 프레임 하나의 YOLO 감지·관절(대시보드 물체 모양 포함) |
| `/perception/analysis` | RELIABLE | 원본 프레임 id | stamp | perception | 프레임 하나의 VLM 답(전체·잘라 본 것), 원본 프레임 stamp |
| `/perception/look_request` | RELIABLE | 대상 id | 없음 | act | 가까이 보기·위에서 보기 요청(세대 = 보기 세대) |
| `/perception/look_result` | RELIABLE | 대상 id | stamp | perception | 보기 결과(세대 = 요청 세대) |
| `/world/input` | RELIABLE | 물건 id | 없음 | act | 보기 지킴 켜기·끄기, 따르기 창 켜기·끄기 |
| `/world/state` | STATE | `_` | stamp | world | World State 보기(`WorldView`) |
| `/world/changes` | RELIABLE | `_` | stamp | world | World State 바뀜 목록 |
| `/brain/decision` | RELIABLE | `_` | stamp | brain | 판단 기록(`BrainLog` decision) |
| `/brain/plan` | RELIABLE | 판단 id | 없음 | brain | 계획 모드가 만든 계획과 그 판단(묶음 4 전에는 act가 계획을 만든다) |
| `/brain/thought` | RELIABLE | `_` | stamp | brain | 생각 말풍선 메시지 |
| `/brain/link` | STATE | `_` | stamp | brain | PAM 연결 오르내림 |
| `/brain/cancel` | RELIABLE | 판단 id | 없음 | act | 만드는 중인 계획 그만 |
| `/act/plan` | STATE | 계획 id | stamp | act | 계획 보기(`PlanView`, 대시보드) |
| `/act/status` | STATE | `_` | stamp | act | 기다리는 중·코치 중·이미 치운 물건(`placed`)·지금 계획 id |
| `/act/log` | RELIABLE | `_` | stamp | act | 실행 기록(`BrainLog` 실행 사건) |
| `/act/phone_command` | STATE | `_` | stamp | act | 지금 폰 명령(없으면 지움). 세대 = 명령 id·단계 |
| `/phone/claim` | STATE | 사용권 종류 | stamp | act, phone | 폰을 쓰고 싶음(종류·글·세대) 또는 비움 |
| `/phone/owner` | STATE | `_` | stamp | phone | 지금 폰을 쓰는 종류 |
| `/phone/progress` | RELIABLE | 명령 id | 없음 | phone | 「완료」·답 단추·「그만」·단계 영상 끝(세대 = 명령 세대) |
| `/phone/heard` | RELIABLE | `_` | stamp | phone | 들은 말(판단 관찰 텍스트·말 답) |
| `/phone/say` | RELIABLE | `_` | 없음 | act, brain | 폰에서 소리로 읽을 말 |
| `/phone/link` | STATE | `_` | stamp | phone | 판본이 맞는 실제 폰이 붙었는가 |
| `/device/command` | RELIABLE | 기기 id | 없음 | act, phone | 가전 명령(위험 목록은 승인 토큰) |
| `/device/result` | RELIABLE | 명령 id | 없음 | devices | 가전 명령 결과 |
| `/device/state` | STATE | 기기 id | stamp | devices | 기기 상태 |

### 폰 사용권 표(`src/phone/owner.ts`)

| 차례 | 종류 | 내는 노드 | 지금 코드 |
|---|---|---|---|
| 1 | `safety` 안전 안내(끄기 안내·부탁) | act | `toPhone` 안 `policy.pause(grade === "safety")`, `sayAloud` |
| 2 | `approval` 승인 질문 | act(계획 승인), phone(말로 시킨 위험 가전) | `approvalsWaiting`, 승인 대기 카드 |
| 3 | `talk` 대화 | phone | `talking`(`TALK_QUIET_MS` 10초) |
| 4 | `plan` 계획 명령 | act | `toPhone` 명령 |
| 5 | `peek` 가까이 가서 보기 | act | 계획 밖 보기(`idlePeek`) |

높은 차례가 있으면 낮은 것은 화면에 나가지 않고 기다린다(지워지지 않는다). 승인 대기 시간은 그 승인이 화면에 있을 때만 흐른다.

---

## Global Constraints

- 무거운 일은 하나씩: 시험은 `npm run heavy -- <명령>`. 작은 시험 파일 하나는 빈 메모리 2.6GB까지, e2e·typecheck·전체 시험은 3GB 이상.
- Docker Desktop은 실제 Redis 시험 때만 켜고, 켜기 전 빈 메모리 2.6GB 이상, 끝나면 끈다. 실제 Redis 시험은 하나씩.
- 서버·PAM은 띄우지 않는다. 실제 모델은 부르지 않는다(가짜 서버만).
- force·amend·bare `git stash` 금지. 영어 커밋, attribution 없음. 내 파일만 경로로 `git add`.
- docs 저장소, `twin-home-split` worktree는 고치지 않는다.
- 저장소 규칙 표(`CLAUDE.md`)를 지킨다: 같은 구조(mock·live·MemoryBus·RedisBus가 같은 코드 경로), 도메인 경계, 사진은 PAM에 안 넘김·디스크에 안 씀, `headWithin`.
- 묶음마다 끝 조건: 데모 e2e 넷(`demo-e2e` 7, `noonchi-e2e` 2, `coach-e2e` 3, `cup-branches-e2e` 3) + 영상 모드 시험(`video-mode-e2e`, `video-real-e2e`, `video-mode-parity`, `ui/tests/phone-mode-parity.test.ts`) + typecheck + lint 통과. 실패 시험 먼저 → 구현 → 통과 → 커밋 → push → 해시 보고.

---

## File Structure (묶음 1)

| 파일 | 맡는 일 |
|---|---|
| `src/bus/topics.ts` | 노드 이름, QoS 타입, 토픽 표(`TOPICS`, 표에 없으면 타입 오류), 토픽별 메시지 모양(zod) |
| `src/bus/header.ts` | 메시지 머리(zod), 봉투 `Envelope`, 직렬화·읽기 |
| `src/bus/fresh.ts` | 낡은 메시지 버리기(세대·stamp) |
| `src/bus/bus.ts` | `Bus` 인터페이스 |
| `src/bus/memory.ts` | `MemoryBus` |
| `src/bus/redis.ts` | `RedisBus`(node-redis) |
| `src/bus/node.ts` | `BusNode` 실행기(콜백 하나씩, 타이머, SENSOR 최신만, 발행) |
| `src/bus/open.ts` | `openBus(env)`: `REDIS_URL`이면 `RedisBus`, 아니면 `MemoryBus` |
| `src/bus/index.ts` | 입구 |
| `src/record/bag.ts`, `src/record/node.ts`, `src/record/index.ts` | 녹화(SQLite)·재생 |
| `scripts/lint-domains.ts` | `bus`·`record` 도메인, 의존 표 |
| `compose.dev.yaml` | 개발용 `redis`(`noonchi-redis`, `127.0.0.1:6379`) |
| `compose.yaml` | AWS `redis` 서비스, noonchi `REDIS_URL` |
| `tests/helpers/bus-contract.ts` | 두 통로가 같이 통과하는 계약 시험 |
| `tests/bus-memory.test.ts`, `tests/bus-redis.test.ts`, `tests/bus-node.test.ts`, `tests/bus-topics.test.ts`, `tests/record-bag.test.ts` | 시험 |

---

## 묶음 1: 통로 · QoS 표 · 메시지 머리 · MemoryBus · RedisBus · 녹화

이 묶음은 새 코드만 더한다. 집 실행 묶음은 아직 통로를 쓰지 않는다(묶음 2부터). 그래서 데모 e2e는 그대로 통과해야 한다.

### Task 1: 토픽 표 · 메시지 머리 · 낡은 메시지 버리기

**Files:**
- Create: `src/bus/topics.ts`, `src/bus/header.ts`, `src/bus/fresh.ts`, `src/bus/index.ts`
- Modify: `scripts/lint-domains.ts`(`SERVER_DOMAINS`에 `bus`, `DEPS.bus = []`, 노드 도메인 `phone`·`observe`·`world`·`brain`·`act`·`devices`·`server`에 `bus`)
- Test: `tests/bus-topics.test.ts`

**Interfaces:**
- Produces: `NODES`, `type NodeName`, `type Qos = { kind: "sensor"; depth: number } | { kind: "state" } | { kind: "reliable" }`, `interface TopicSpec<B> { qos: Qos; body: z.ZodType<B>; key: (b: B) => string; ordered: boolean; from: readonly NodeName[] }`, `TOPICS`, `type TopicName = keyof typeof TOPICS`, `type Body<N extends TopicName>`.
- Produces: `Header`(zod), `type Header = { stamp: number; node: NodeName; seq: number; gen: number }`, `interface Envelope<N extends TopicName> { topic: N; key: string; header: Header; body: Body<N> }`, `encode(e): string`, `decode(topic, raw): Envelope`.
- Produces: `class Freshness { accept(e: Envelope<TopicName>): boolean }`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/bus-topics.test.ts`:

```ts
// 토픽 표: 토픽마다 QoS·모양·열쇠·보내는 노드가 있고, 머리는 zod로 검사하며 JSON으로 오간다. 낡은 메시지는 한곳에서 버린다.
import { describe, expect, it } from "vitest";
import { Freshness, NODES, TOPICS, decode, encode, type Envelope } from "../src/bus/index.js";

const env = (over: Partial<Envelope<"/world/state">["header"]> = {}, key = "_"): Envelope<"/world/state"> =>
  ({ topic: "/world/state", key, header: { stamp: 1000, node: "world", seq: 1, gen: 1, ...over }, body: { at_ms: 1000 } as never });

describe("토픽 표", () => {
  it("토픽마다 QoS가 셋 가운데 하나이고, SENSOR는 depth가 1 이상이다", () => {
    for (const [name, t] of Object.entries(TOPICS)) {
      expect(["sensor", "state", "reliable"], name).toContain(t.qos.kind);
      if (t.qos.kind === "sensor") expect(t.qos.depth, name).toBeGreaterThanOrEqual(1);
      expect(t.from.length, name).toBeGreaterThan(0);
      for (const n of t.from) expect(NODES, name).toContain(n);
    }
  });

  it("사진(jpeg)은 SENSOR 토픽에만 있다", () => {
    for (const [name, t] of Object.entries(TOPICS)) if (t.photo) expect(t.qos.kind, name).toBe("sensor");
  });

  it("QoS가 없는 토픽은 타입 검사가 실패한다", () => {
    // @ts-expect-error qos가 없다
    const bad: (typeof TOPICS)["/world/state"] = { body: TOPICS["/world/state"].body, key: () => "_", ordered: true, from: ["world"] };
    expect(bad).toBeDefined();
  });

  it("머리·몸은 JSON으로 오가고 모양이 틀리면 거절한다", () => {
    const raw = encode(env());
    expect(decode("/world/state", raw)).toEqual(env());
    expect(() => decode("/world/state", raw.replace('"node":"world"', '"node":"nobody"'))).toThrow();
    expect(() => decode("/world/state", raw.replace('"seq":1', '"seq":-1'))).toThrow();
  });
});

describe("낡은 메시지", () => {
  it("열쇠마다 지난 세대는 버리고, 순서 토픽은 같은 세대의 더 옛 stamp도 버린다", () => {
    const f = new Freshness();
    expect(f.accept(env({ gen: 2, stamp: 1000 }))).toBe(true);
    expect(f.accept(env({ gen: 1, stamp: 5000 }))).toBe(false);
    expect(f.accept(env({ gen: 2, stamp: 900, seq: 2 }))).toBe(false);
    expect(f.accept(env({ gen: 2, stamp: 1000, seq: 1 }))).toBe(false);
    expect(f.accept(env({ gen: 2, stamp: 1000, seq: 2 }))).toBe(true);
    expect(f.accept(env({ gen: 1, stamp: 1 }, "other"))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts`
Expected: FAIL(`src/bus/index.js`가 없다)

- [ ] **Step 3: `topics.ts`를 쓴다**

```ts
// 토픽 표(ROS 2 토픽·QoS처럼): 이름, QoS(SENSOR·STATE·RELIABLE), 메시지 몸 모양(zod), 열쇠, 순서(stamp로 낡은 것 버림), 보내는 노드.
// 토픽을 더할 때는 이 표 하나에 더한다. qos가 없으면 satisfies에서 타입 오류다. 사진(jpeg)이 든 토픽은 SENSOR만.
// 몸 모양은 그 토픽을 옮기는 묶음에서 실제 모양으로 바꾼다(그 전에는 객체인지만 본다).
import { z } from "zod";

export const NODES = ["phone", "perception", "world", "brain", "act", "devices", "recorder"] as const;
export type NodeName = (typeof NODES)[number];
export type Qos = { kind: "sensor"; depth: number } | { kind: "state" } | { kind: "reliable" };
export interface TopicSpec<B = unknown> {
  qos: Qos;
  body: z.ZodType<B>;
  key: (b: B) => string;
  ordered: boolean;
  from: readonly NodeName[];
  /** 사진 칸 이름(녹화에서 뺀다). SENSOR 토픽만. */
  photo?: string;
}

const obj = z.looseObject({});
const one = () => "_";
const by = (k: string) => (b: Record<string, unknown>) => String(b[k] ?? "_");

export const TOPICS = {
  "/perception/frame": { qos: { kind: "sensor", depth: 4 }, body: obj, key: one, ordered: true, from: ["phone"], photo: "jpeg" },
  "/phone/pose": { qos: { kind: "sensor", depth: 8 }, body: obj, key: one, ordered: true, from: ["phone"] },
  "/perception/detections": { qos: { kind: "sensor", depth: 8 }, body: obj, key: one, ordered: true, from: ["perception"] },
  "/perception/analysis": { qos: { kind: "reliable" }, body: obj, key: by("frame_id"), ordered: true, from: ["perception"] },
  "/perception/look_request": { qos: { kind: "reliable" }, body: obj, key: by("target"), ordered: false, from: ["act"] },
  "/perception/look_result": { qos: { kind: "reliable" }, body: obj, key: by("target"), ordered: true, from: ["perception"] },
  "/world/input": { qos: { kind: "reliable" }, body: obj, key: by("id"), ordered: false, from: ["act"] },
  "/world/state": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["world"] },
  "/world/changes": { qos: { kind: "reliable" }, body: obj, key: one, ordered: true, from: ["world"] },
  "/brain/decision": { qos: { kind: "reliable" }, body: obj, key: one, ordered: true, from: ["brain"] },
  "/brain/plan": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), ordered: false, from: ["brain", "act"] },
  "/brain/thought": { qos: { kind: "reliable" }, body: obj, key: one, ordered: true, from: ["brain"] },
  "/brain/link": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["brain"] },
  "/brain/cancel": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), ordered: false, from: ["act"] },
  "/act/plan": { qos: { kind: "state" }, body: obj, key: by("id"), ordered: true, from: ["act"] },
  "/act/status": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["act"] },
  "/act/log": { qos: { kind: "reliable" }, body: obj, key: one, ordered: true, from: ["act"] },
  "/act/phone_command": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["act"] },
  "/phone/claim": { qos: { kind: "state" }, body: obj, key: by("kind"), ordered: true, from: ["act", "phone"] },
  "/phone/owner": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["phone"] },
  "/phone/progress": { qos: { kind: "reliable" }, body: obj, key: by("command_id"), ordered: false, from: ["phone"] },
  "/phone/heard": { qos: { kind: "reliable" }, body: obj, key: one, ordered: true, from: ["phone"] },
  "/phone/say": { qos: { kind: "reliable" }, body: obj, key: one, ordered: false, from: ["act", "brain"] },
  "/phone/link": { qos: { kind: "state" }, body: obj, key: one, ordered: true, from: ["phone"] },
  "/device/command": { qos: { kind: "reliable" }, body: obj, key: by("device_id"), ordered: false, from: ["act", "phone"] },
  "/device/result": { qos: { kind: "reliable" }, body: obj, key: by("command_id"), ordered: false, from: ["devices"] },
  "/device/state": { qos: { kind: "state" }, body: obj, key: by("id"), ordered: true, from: ["devices"] },
} as const satisfies Record<string, TopicSpec<Record<string, unknown>>>;

export type TopicName = keyof typeof TOPICS;
export type Body<N extends TopicName> = z.infer<(typeof TOPICS)[N]["body"]>;
```

- [ ] **Step 4: `header.ts`·`fresh.ts`·`index.ts`를 쓴다**

```ts
// header.ts — 메시지 머리(ROS 2 std_msgs/Header처럼): stamp(찍힌 시각 ms), node(보낸 노드), seq(노드·토픽마다 1씩), gen(세대).
import { z } from "zod";
import { NODES, TOPICS, type Body, type TopicName } from "./topics.js";

export const Header = z.strictObject({
  stamp: z.number().finite(), node: z.enum(NODES), seq: z.number().int().nonnegative(), gen: z.number().int().nonnegative(),
});
export type Header = z.infer<typeof Header>;
export interface Envelope<N extends TopicName> { topic: N; key: string; header: Header; body: Body<N> }

export function encode<N extends TopicName>(e: Envelope<N>): string {
  return JSON.stringify({ key: e.key, header: e.header, body: e.body });
}

export function decode<N extends TopicName>(topic: N, raw: string): Envelope<N> {
  const v = z.strictObject({ key: z.string(), header: Header, body: TOPICS[topic].body }).parse(JSON.parse(raw));
  return { topic, key: v.key, header: v.header, body: v.body as Body<N> };
}
```

```ts
// fresh.ts — 낡은 메시지 버리기(받는 쪽 한곳): (토픽, 열쇠)마다 본 가장 높은 세대보다 낮으면 버린다.
// 순서 토픽(ordered)은 같은 세대에서 더 옛 stamp, 같은 stamp·같은 노드의 이미 본 seq도 버린다.
import type { Envelope } from "./header.js";
import { TOPICS, type TopicName } from "./topics.js";

export class Freshness {
  readonly #last = new Map<string, { gen: number; stamp: number; node: string; seq: number }>();

  accept(e: Envelope<TopicName>): boolean {
    const k = `${e.topic}\u0000${e.key}`;
    const h = e.header;
    const p = this.#last.get(k);
    if (p) {
      if (h.gen < p.gen) return false;
      if (TOPICS[e.topic].ordered && h.gen === p.gen && (h.stamp < p.stamp || (h.stamp === p.stamp && h.node === p.node && h.seq <= p.seq))) return false;
    }
    this.#last.set(k, { gen: h.gen, stamp: h.stamp, node: h.node, seq: h.seq });
    return true;
  }
}
```

```ts
// index.ts — 통로(ROS 2 rmw·토픽·실행기처럼). 노드는 이 입구로만 가져온다.
export { Freshness } from "./fresh.js";
export { Header, decode, encode, type Envelope } from "./header.js";
export { NODES, TOPICS, type Body, type NodeName, type Qos, type TopicName, type TopicSpec } from "./topics.js";
```

`scripts/lint-domains.ts`: `SERVER_DOMAINS`에 `"bus"`를 더하고 `DEPS`에 `bus: []`, `phone`·`observe`·`world`·`brain`·`act`·`devices`·`server` 줄에 `"bus"`를 더한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts tests/domain-boundaries.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋·push**

```bash
git add src/bus scripts/lint-domains.ts tests/bus-topics.test.ts
git commit -m "feat(bus): add the topic table with QoS, the message header and the stale filter"
git push
```

### Task 2: 실행기 `BusNode` · `MemoryBus` · 통로 계약 시험

**Files:**
- Create: `src/bus/bus.ts`, `src/bus/memory.ts`, `src/bus/node.ts`, `src/bus/open.ts`
- Create: `tests/helpers/bus-contract.ts`
- Test: `tests/bus-memory.test.ts`, `tests/bus-node.test.ts`

**Interfaces:**
- Consumes: Task 1 `TOPICS`, `Envelope`, `encode`, `decode`, `Freshness`.
- Produces(`bus.ts`): `type Deliver<N> = (e: Envelope<N>) => Promise<void>`, `interface Bus { publish<N>(e: Envelope<N>): Promise<void>; subscribe<N>(topic: N, node: NodeName, deliver: Deliver<N>): Promise<() => Promise<void>>; close(): Promise<void> }`. `deliver`가 끝난(resolve) 뒤에야 RELIABLE은 ack한다. `publish`는 받는 쪽 콜백을 같은 호출 안에서 부르지 않는다.
- Produces(`node.ts`): `class BusNode { constructor(o: { name: NodeName; bus: Bus; clock?: { now(): number }; gen?: () => number; log?: (s: string) => void }); on<N>(topic: N, cb: (body: Body<N>, e: Envelope<N>) => void | Promise<void>): void; every(ms: number, cb: () => void | Promise<void>): void; publish<N>(topic: N, body: Body<N>, o?: { gen?: number }): void; start(): Promise<void>; stop(): Promise<void>; idle(): Promise<void> }`.
- Produces(`open.ts`): `openBus(env): Promise<Bus>`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/helpers/bus-contract.ts`(두 통로가 함께 쓰는 계약):

```ts
// 통로 계약(MemoryBus·RedisBus가 같은 시험을 통과한다): QoS 셋의 동작, JSON 왕복, 같은 호출 안에서 부르지 않음.
import { describe, expect, it } from "vitest";
import type { Bus, Envelope, TopicName } from "../../src/bus/index.js";

const e = <N extends TopicName>(topic: N, body: Record<string, unknown>, seq: number, key = "_"): Envelope<N> =>
  ({ topic, key, header: { stamp: 1000 + seq, node: "world", seq, gen: 1 }, body } as Envelope<N>);
const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("기다림 초과");
    await new Promise((r) => setTimeout(r, 10));
  }
};

export function busContract(name: string, make: () => Promise<Bus>, opts: { length: (b: Bus, topic: string) => Promise<number> }) {
  describe(`${name} 통로 계약`, () => {
    it("SENSOR: 늦게 붙으면 옛것을 받지 않고, 쌓인 길이는 depth 근처로 묶인다", async () => {
      const bus = await make();
      for (let i = 1; i <= 50; i++) await bus.publish(e("/phone/pose", { i }, i));
      const got: number[] = [];
      await bus.subscribe("/phone/pose", "world", async (m) => { got.push(m.body.i as number); });
      await bus.publish(e("/phone/pose", { i: 51 }, 51));
      await until(() => got.includes(51));
      expect(got).toEqual([51]);
      expect(await opts.length(bus, "/phone/pose")).toBeLessThanOrEqual(8 + 100);
      await bus.close();
    });

    it("STATE: 늦게 붙어도 열쇠마다 최신 값을 바로 받고, 그 뒤 값도 받는다", async () => {
      const bus = await make();
      await bus.publish(e("/device/state", { id: "a", on: 1 }, 1, "a"));
      await bus.publish(e("/device/state", { id: "a", on: 2 }, 2, "a"));
      await bus.publish(e("/device/state", { id: "b", on: 1 }, 3, "b"));
      const got: string[] = [];
      await bus.subscribe("/device/state", "world", async (m) => { got.push(`${m.key}${m.body.on}`); });
      await until(() => got.length >= 2);
      expect(got.sort()).toEqual(["a2", "b1"]);
      await bus.publish(e("/device/state", { id: "a", on: 3 }, 4, "a"));
      await until(() => got.includes("a3"));
      await bus.close();
    });

    it("RELIABLE: 그룹마다 모두 차례대로 받고, 느린 처리도 잃지 않는다", async () => {
      const bus = await make();
      const a: number[] = [];
      const b: number[] = [];
      await bus.subscribe("/world/changes", "brain", async (m) => { a.push(m.body.i as number); });
      await bus.subscribe("/world/changes", "act", async (m) => { await new Promise((r) => setTimeout(r, 5)); b.push(m.body.i as number); });
      for (let i = 1; i <= 30; i++) await bus.publish(e("/world/changes", { i }, i));
      await until(() => a.length === 30 && b.length === 30);
      expect(a).toEqual(Array.from({ length: 30 }, (_, k) => k + 1));
      expect(b).toEqual(a);
      await bus.close();
    });

    it("RELIABLE: 처리를 끝내지 못한 메시지는 다시 붙은 같은 그룹이 다시 받고, 모두 처리하면 잘린다", async () => {
      const bus = await make();
      const stop = await bus.subscribe("/world/changes", "act", () => new Promise<void>(() => {}));
      await bus.publish(e("/world/changes", { i: 1 }, 1));
      await new Promise((r) => setTimeout(r, 100));
      await stop();
      const got: number[] = [];
      await bus.subscribe("/world/changes", "act", async (m) => { got.push(m.body.i as number); });
      await until(() => got.includes(1));
      await until(async () => (await opts.length(bus, "/world/changes")) === 0);
      await bus.close();
    });

    it("publish는 받는 쪽 콜백을 같은 호출 안에서 부르지 않는다", async () => {
      const bus = await make();
      let inside = false;
      let sawInside = false;
      await bus.subscribe("/world/changes", "act", async () => { sawInside ||= inside; });
      inside = true;
      await bus.publish(e("/world/changes", { i: 1 }, 1));
      inside = false;
      await new Promise((r) => setTimeout(r, 50));
      expect(sawInside).toBe(false);
      await bus.close();
    });
  });
}
```

`tests/bus-memory.test.ts`:

```ts
import { MemoryBus } from "../src/bus/memory.js";
import { busContract } from "./helpers/bus-contract.js";

busContract("MemoryBus", async () => new MemoryBus(), { length: async (b, t) => (b as MemoryBus).length(t) });
```

`tests/bus-node.test.ts`:

```ts
// 실행기(ROS 2 single-threaded executor처럼): 콜백 하나씩, 타이머도 같은 줄, SENSOR는 최신만, 콜백 안 발행은 콜백이 끝난 뒤 받는다, 낡은 메시지는 버린다.
import { describe, expect, it } from "vitest";
import { BusNode } from "../src/bus/node.js";
import { MemoryBus } from "../src/bus/memory.js";

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("BusNode 실행기", () => {
  it("메시지 콜백과 타이머 콜백이 겹치지 않는다", async () => {
    const bus = new MemoryBus();
    const n = new BusNode({ name: "act", bus });
    let running = 0;
    let overlap = false;
    const work = async () => { running++; overlap ||= running > 1; await tick(); running--; };
    n.on("/world/changes", work);
    n.every(5, work);
    await n.start();
    const w = new BusNode({ name: "world", bus });
    await w.start();
    for (let i = 0; i < 5; i++) w.publish("/world/changes", { i });
    await new Promise((r) => setTimeout(r, 200));
    await n.stop();
    expect(overlap).toBe(false);
  });

  it("콜백 안에서 발행한 메시지는 그 콜백이 끝난 뒤에 처리된다(자기 구독도)", async () => {
    const bus = new MemoryBus();
    const n = new BusNode({ name: "act", bus });
    const order: string[] = [];
    n.on("/act/log", () => { order.push("log"); });
    n.on("/world/changes", () => { n.publish("/act/log", { a: 1 }); order.push("changes-end"); });
    await n.start();
    const w = new BusNode({ name: "world", bus });
    await w.start();
    w.publish("/world/changes", { i: 1 });
    await n.idle();
    await tick();
    await n.idle();
    expect(order).toEqual(["changes-end", "log"]);
  });

  it("바쁜 동안 쌓인 SENSOR는 마지막 하나만 처리한다", async () => {
    const bus = new MemoryBus();
    const n = new BusNode({ name: "perception", bus });
    const seen: number[] = [];
    n.on("/perception/frame", async (b) => { seen.push(b.i as number); await tick(); });
    await n.start();
    const p = new BusNode({ name: "phone", bus });
    await p.start();
    for (let i = 1; i <= 10; i++) p.publish("/perception/frame", { i });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.at(-1)).toBe(10);
    expect(seen.length).toBeLessThan(10);
  });

  it("지난 세대의 메시지는 콜백에 오지 않는다", async () => {
    const bus = new MemoryBus();
    const n = new BusNode({ name: "act", bus });
    const got: number[] = [];
    n.on("/perception/look_result", (b) => { got.push(b.v as number); });
    await n.start();
    const p = new BusNode({ name: "perception", bus });
    await p.start();
    p.publish("/perception/look_result", { target: "cup_1", v: 1 }, { gen: 2 });
    p.publish("/perception/look_result", { target: "cup_1", v: 2 }, { gen: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([1]);
  });

  it("보내는 노드가 아닌 노드가 발행하면 바로 오류다", () => {
    const n = new BusNode({ name: "brain", bus: new MemoryBus() });
    expect(() => n.publish("/world/state", {})).toThrow(/world/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-memory.test.ts tests/bus-node.test.ts`
Expected: FAIL(`MemoryBus`·`BusNode`가 없다)

- [ ] **Step 3: `bus.ts`·`memory.ts`를 쓴다**

```ts
// bus.ts — 통로 인터페이스(ROS 2 rmw처럼). MemoryBus(시험·개발)와 RedisBus(실제)가 같은 계약을 따른다.
// publish는 받는 쪽 콜백을 같은 호출 안에서 부르지 않는다. RELIABLE은 deliver가 끝난 뒤 ack한다.
import type { Envelope } from "./header.js";
import type { NodeName, TopicName } from "./topics.js";

export type Deliver<N extends TopicName> = (e: Envelope<N>) => Promise<void>;
export interface Bus {
  publish<N extends TopicName>(e: Envelope<N>): Promise<void>;
  /** node는 RELIABLE의 consumer group 이름이다. 돌려준 함수로 구독을 끊는다(처리 중이던 RELIABLE은 ack하지 않는다). */
  subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>): Promise<() => Promise<void>>;
  close(): Promise<void>;
}
```

```ts
// memory.ts — 한 프로세스 안 통로. QoS 동작은 RedisBus와 같다(tests/helpers/bus-contract.ts).
// SENSOR: 토픽마다 마지막 depth개, 늦게 붙으면 새것만. STATE: 열쇠마다 마지막 하나, 붙을 때 지금 값들을 먼저 준다.
// RELIABLE: 토픽 기록 + 그룹마다 다음 차례·처리 중. 처리를 끝내지 않고 끊긴 것은 같은 그룹이 다시 붙으면 다시 준다. 모든 그룹이 처리하면 앞을 자른다.
// 배달은 늘 다음 차례(setImmediate)에 한다: publish 안에서 콜백을 부르지 않는다.
import type { Bus, Deliver } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

type Raw = { id: number; raw: string };
interface Group { next: number; pending: Raw | null; deliver: Deliver<TopicName> | null; busy: boolean }

export class MemoryBus implements Bus {
  #id = 0;
  readonly #log = new Map<string, Raw[]>();
  readonly #state = new Map<string, Map<string, string>>();
  readonly #live = new Map<string, Set<Deliver<TopicName>>>();
  readonly #groups = new Map<string, Map<string, Group>>();

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    const raw = encode(e);
    decode(e.topic, raw);
    const t = TOPICS[e.topic];
    if (t.qos.kind === "state") (this.#state.get(e.topic) ?? this.#state.set(e.topic, new Map()).get(e.topic)!).set(e.key, raw);
    const log = this.#log.get(e.topic) ?? this.#log.set(e.topic, []).get(e.topic)!;
    log.push({ id: ++this.#id, raw });
    if (t.qos.kind === "sensor" && log.length > t.qos.depth) log.splice(0, log.length - t.qos.depth);
    if (t.qos.kind === "state" && log.length > 1) log.splice(0, log.length - 1);
    if (t.qos.kind === "reliable") for (const g of this.#groups.get(e.topic)?.values() ?? []) this.#pump(e.topic, g);
    else for (const d of this.#live.get(e.topic) ?? []) setImmediate(() => void d(decode(e.topic, raw)));
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>): Promise<() => Promise<void>> {
    const d = deliver as Deliver<TopicName>;
    if (TOPICS[topic].qos.kind === "reliable") {
      const groups = this.#groups.get(topic) ?? this.#groups.set(topic, new Map()).get(topic)!;
      const g = groups.get(node) ?? groups.set(node, { next: this.#id + 1, pending: null, deliver: null, busy: false }).get(node)!;
      g.deliver = d;
      this.#pump(topic, g);
      return async () => { g.deliver = null; g.busy = false; };
    }
    if (TOPICS[topic].qos.kind === "state") for (const raw of this.#state.get(topic)?.values() ?? []) setImmediate(() => void d(decode(topic, raw)));
    const live = this.#live.get(topic) ?? this.#live.set(topic, new Set()).get(topic)!;
    live.add(d);
    return async () => { live.delete(d); };
  }

  #pump(topic: TopicName, g: Group): void {
    if (g.busy || !g.deliver) return;
    const log = this.#log.get(topic) ?? [];
    const item = g.pending ?? log.find((r) => r.id >= g.next);
    if (!item) return;
    g.pending = item;
    g.next = item.id + 1;
    g.busy = true;
    const deliver = g.deliver;
    setImmediate(() => {
      void deliver(decode(topic, item.raw)).finally(() => {
        if (g.deliver !== deliver) return;
        g.pending = null;
        g.busy = false;
        this.#trim(topic);
        this.#pump(topic, g);
      });
    });
  }

  #trim(topic: TopicName): void {
    const log = this.#log.get(topic);
    const groups = [...(this.#groups.get(topic)?.values() ?? [])];
    if (!log || !groups.length) return;
    const keep = Math.min(...groups.map((g) => g.pending?.id ?? g.next));
    while (log.length && log[0]!.id < keep) log.shift();
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  length(topic: string): number {
    return this.#log.get(topic)?.length ?? 0;
  }

  async close(): Promise<void> {
    this.#live.clear();
    for (const groups of this.#groups.values()) for (const g of groups.values()) g.deliver = null;
  }
}
```

- [ ] **Step 4: `node.ts`·`open.ts`를 쓴다**

```ts
// node.ts — 노드 실행기(ROS 2 single-threaded executor처럼): 메시지 콜백과 타이머 콜백을 한 줄에서 하나씩 처리한다(다시 들어오기 없음).
// 받은 메시지는 먼저 낡은 것을 버리고(Freshness), SENSOR는 줄에 마지막 하나만 둔다. 발행은 머리(stamp·node·seq·gen)를 붙여 통로로 보낸다.
// 콜백 안에서 발행해도 받는 쪽(자기 구독 포함)은 이 콜백이 끝난 뒤 처리한다.
import type { Bus } from "./bus.js";
import { Freshness } from "./fresh.js";
import type { Envelope } from "./header.js";
import { TOPICS, type Body, type NodeName, type TopicName } from "./topics.js";

type Job = { run: () => Promise<void> | void; done?: () => void; sensor?: TopicName };

export class BusNode {
  readonly name: NodeName;
  readonly #bus: Bus;
  readonly #clock: { now(): number };
  readonly #gen: () => number;
  readonly #log: (s: string) => void;
  readonly #fresh = new Freshness();
  readonly #seq = new Map<TopicName, number>();
  readonly #subs: [TopicName, (body: never, e: Envelope<TopicName>) => void | Promise<void>][] = [];
  readonly #timers: [number, () => void | Promise<void>][] = [];
  readonly #queue: Job[] = [];
  readonly #unsub: (() => Promise<void>)[] = [];
  readonly #handles: NodeJS.Timeout[] = [];
  #running = false;
  #idle: (() => void)[] = [];

  constructor(o: { name: NodeName; bus: Bus; clock?: { now(): number }; gen?: () => number; log?: (s: string) => void }) {
    this.name = o.name;
    this.#bus = o.bus;
    this.#clock = o.clock ?? { now: () => Date.now() };
    this.#gen = o.gen ?? (() => 0);
    this.#log = o.log ?? ((s) => console.error(s));
  }

  on<N extends TopicName>(topic: N, cb: (body: Body<N>, e: Envelope<N>) => void | Promise<void>): void {
    this.#subs.push([topic, cb as never]);
  }

  every(ms: number, cb: () => void | Promise<void>): void {
    this.#timers.push([ms, cb]);
  }

  publish<N extends TopicName>(topic: N, body: Body<N>, o: { gen?: number } = {}): void {
    const t = TOPICS[topic];
    if (!(t.from as readonly NodeName[]).includes(this.name)) throw new Error(`${this.name}는 ${topic}을 보낼 수 없어요(보내는 노드: ${t.from.join(", ")})`);
    t.body.parse(body);
    const seq = (this.#seq.get(topic) ?? 0) + 1;
    this.#seq.set(topic, seq);
    const e = { topic, key: (t.key as (b: Body<N>) => string)(body), header: { stamp: this.#clock.now(), node: this.name, seq, gen: o.gen ?? this.#gen() }, body } as Envelope<N>;
    void this.#bus.publish(e).catch((err) => this.#log(`[${this.name}] ${topic} 발행 실패: ${(err as Error).message}`));
  }

  /** 모든 구독을 붙인 뒤 타이머를 켠다. 띄우는 곳은 모든 노드의 start()를 마친 뒤 첫 메시지를 낸다. */
  async start(): Promise<void> {
    for (const [topic, cb] of this.#subs) {
      this.#unsub.push(await this.#bus.subscribe(topic, this.name, (e) => this.#enqueue(e, cb)));
    }
    for (const [ms, cb] of this.#timers) {
      const h = setInterval(() => void this.#push({ run: cb }), ms);
      h.unref?.();
      this.#handles.push(h);
    }
  }

  async stop(): Promise<void> {
    for (const h of this.#handles) clearInterval(h);
    for (const u of this.#unsub) await u();
    this.#queue.length = 0;
  }

  /** 시험용: 줄이 빌 때까지 기다린다. */
  idle(): Promise<void> {
    return !this.#running && !this.#queue.length ? Promise.resolve() : new Promise((r) => this.#idle.push(r));
  }

  #enqueue(e: Envelope<TopicName>, cb: (body: never, e: Envelope<TopicName>) => void | Promise<void>): Promise<void> {
    return new Promise<void>((done) => {
      const sensor = TOPICS[e.topic].qos.kind === "sensor" ? e.topic : undefined;
      this.#push({ run: () => (this.#fresh.accept(e) ? cb(e.body as never, e) : undefined), done, sensor });
    });
  }

  #push(job: Job): void {
    if (job.sensor) {
      const old = this.#queue.findIndex((j) => j.sensor === job.sensor);
      if (old >= 0) this.#queue.splice(old, 1)[0]!.done?.();
    }
    this.#queue.push(job);
    if (!this.#running) void this.#drain();
  }

  async #drain(): Promise<void> {
    this.#running = true;
    while (this.#queue.length) {
      const job = this.#queue.shift()!;
      try {
        await job.run();
      } catch (err) {
        this.#log(`[${this.name}] 콜백 오류: ${(err as Error).message}`);
      }
      job.done?.();
    }
    this.#running = false;
    for (const r of this.#idle.splice(0)) r();
  }
}
```

```ts
// open.ts — REDIS_URL이 있으면 RedisBus, 없으면 MemoryBus(같은 계약). 다른 갈래는 없다.
import type { Bus } from "./bus.js";
import { MemoryBus } from "./memory.js";

export async function openBus(env: Record<string, string | undefined>): Promise<Bus> {
  const url = env.REDIS_URL?.trim();
  if (!url) return new MemoryBus();
  const { RedisBus } = await import("./redis.js");
  return RedisBus.connect(url);
}
```

`open.ts`의 `import("./redis.js")`는 글자 그대로라 도메인 검사가 따라간다. `index.ts`에 `type Bus`, `BusNode`, `MemoryBus`, `openBus`를 더한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-memory.test.ts tests/bus-node.test.ts tests/bus-topics.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋·push**

```bash
git add src/bus tests/helpers/bus-contract.ts tests/bus-memory.test.ts tests/bus-node.test.ts
git commit -m "feat(bus): add the single-callback node executor and the in-memory bus with the shared QoS contract"
git push
```

### Task 3: `RedisBus` · 개발용·AWS Redis 컨테이너

**Files:**
- Create: `src/bus/redis.ts`, `compose.dev.yaml`, `tests/bus-redis.test.ts`
- Modify: `package.json`·`package-lock.json`(`redis` 6.3.1 정확히), `compose.yaml`(`redis` 서비스, noonchi `REDIS_URL`·`depends_on`), `.env.example`(`REDIS_URL`), `tests/deploy-files.test.ts`

**Interfaces:**
- Consumes: Task 2 `Bus`, `Deliver`, 계약 시험.
- Produces: `class RedisBus implements Bus { static connect(url: string): Promise<RedisBus>; length(topic: string): Promise<number> }`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/bus-redis.test.ts`:

```ts
// 실제 Redis 통로: REDIS_URL이 있을 때만 돈다(이 PC는 compose.dev.yaml의 noonchi-redis, CI·다른 PC는 건너뜀).
// 토픽 이름 앞에 시험마다 다른 접두어를 붙여 다른 시험·개발 서버와 섞이지 않게 한다.
import { describe } from "vitest";
import { RedisBus } from "../src/bus/redis.js";
import { busContract } from "./helpers/bus-contract.js";

const url = process.env.REDIS_URL?.trim();
let n = 0;
describe.skipIf(!url)("RedisBus", () => {
  busContract("RedisBus", () => RedisBus.connect(url!, { prefix: `test:${process.pid}:${Date.now()}:${++n}:` }), { length: (b, t) => (b as RedisBus).length(t) });
});
```

`tests/deploy-files.test.ts`에 더한다:

```ts
  it("compose: redis는 판을 고정한 공식 이미지이고 호스트에 열지 않으며, noonchi가 REDIS_URL로 붙는다", () => {
    const c = composeFile();
    expect(c.services.redis.image).toBe("redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b");
    expect(c.services.redis.ports).toBeUndefined();
    expect(c.services.noonchi.environment.REDIS_URL).toBe("redis://redis:6379");
    expect(c.services.noonchi.depends_on.redis).toEqual({ condition: "service_healthy" });
  });

  it("개발용 compose: noonchi-redis가 같은 이미지로 127.0.0.1:6379만 연다", () => {
    const d = parseYaml(read("compose.dev.yaml"));
    expect(d.services.redis.image).toBe(composeFile().services.redis.image);
    expect(d.services.redis.container_name).toBe("noonchi-redis");
    expect(d.services.redis.ports).toEqual(["127.0.0.1:6379:6379"]);
  });
```

(`composeFile`·`read`·`parseYaml`은 그 파일이 이미 쓰는 도우미를 쓴다.)

Run: `npm run heavy -- npx vitest run tests/bus-redis.test.ts tests/deploy-files.test.ts`
Expected: `bus-redis`는 `REDIS_URL`이 없어 건너뜀, `deploy-files`는 FAIL(`redis` 서비스 없음). `src/bus/redis.js`가 없어 import에서도 실패한다.

- [ ] **Step 2: 의존성을 더한다**

Run: `npm install --save-exact redis@6.3.1`
Expected: `package.json` `dependencies`에 `"redis": "6.3.1"`

- [ ] **Step 3: `redis.ts`를 쓴다**

```ts
// redis.ts — Redis Streams 통로(node-redis). QoS 동작은 MemoryBus와 같다(tests/helpers/bus-contract.ts).
// SENSOR: XADD 토픽 MAXLEN ~ depth, 구독은 XREAD $부터(새것만, ack 없음).
// STATE: HSET state:토픽 열쇠 값 + XADD 토픽 MAXLEN ~ 64(알림). 붙을 때 마지막 id를 먼저 보고 HGETALL로 지금 값들을 준 뒤 그 id부터 읽는다(겹친 것은 실행기가 버린다).
// RELIABLE: XADD 토픽(자르지 않음), 그룹 = 노드 이름(처음 붙을 때 $부터), XREADGROUP → deliver → XACK.
//   붙을 때 XAUTOCLAIM으로 처리를 끝내지 못한 것을 먼저 다시 받는다. ack 뒤 모든 그룹이 넘긴 앞부분을 XTRIM MINID로 자른다.
// 막고 읽기(BLOCK)는 구독마다 따로 연결(duplicate)을 쓴다.
import { createClient, type RedisClientType } from "redis";
import type { Bus, Deliver } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

const BLOCK_MS = 1000;
const STATE_NOTE = 64;
const nextId = (id: string) => { const [ms, seq] = id.split("-"); return `${ms}-${Number(seq) + 1}`; };

export class RedisBus implements Bus {
  readonly #closers = new Set<() => Promise<void>>();

  private constructor(private readonly client: RedisClientType, private readonly prefix: string) {}

  static async connect(url: string, o: { prefix?: string } = {}): Promise<RedisBus> {
    const client = createClient({ url }) as RedisClientType;
    await client.connect();
    return new RedisBus(client, o.prefix ?? "noonchi:");
  }

  #k(topic: string): string { return `${this.prefix}${topic}`; }

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    const raw = encode(e);
    decode(e.topic, raw);
    const q = TOPICS[e.topic].qos;
    const k = this.#k(e.topic);
    if (q.kind === "sensor") await this.client.xAdd(k, "*", { m: raw }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: q.depth } });
    else if (q.kind === "state") await this.client.multi().hSet(`${k}:state`, e.key, raw).xAdd(k, "*", { m: raw }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STATE_NOTE } }).exec();
    else await this.client.xAdd(k, "*", { m: raw });
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>): Promise<() => Promise<void>> {
    const k = this.#k(topic);
    const conn = this.client.duplicate();
    await conn.connect();
    let on = true;
    const q = TOPICS[topic].qos;
    let loop: Promise<void>;
    if (q.kind === "reliable") {
      try { await this.client.xGroupCreate(k, node, "$", { MKSTREAM: true }); } catch (e) { if (!String(e).includes("BUSYGROUP")) throw e; }
      const handle = async (id: string, raw: string) => {
        await deliver(decode(topic, raw));
        if (!on) return;
        await this.client.xAck(k, node, id);
        await this.#trim(k);
      };
      loop = (async () => {
        const claimed = await this.client.xAutoClaim(k, node, node, 0, "0-0", { COUNT: 1000 });
        for (const m of claimed.messages) if (m && on) await handle(m.id, m.message.m!);
        while (on) {
          const r = await conn.xReadGroup(node, node, { key: k, id: ">" }, { COUNT: 16, BLOCK: BLOCK_MS }).catch(() => null);
          for (const s of r ?? []) for (const m of s.messages) if (on) await handle(m.id, m.message.m!);
        }
      })();
    } else {
      // 붙기 전 마지막 id부터 읽는다($로 읽으면 첫 XREAD 전에 낸 것을 놓친다)
      const tail = await this.client.xRevRange(k, "+", "-", { COUNT: 1 });
      let last = tail[0]?.id ?? "0-0";
      if (q.kind === "state") {
        for (const raw of Object.values(await this.client.hGetAll(`${k}:state`))) await deliver(decode(topic, raw));
      }
      loop = (async () => {
        while (on) {
          const r = await conn.xRead({ key: k, id: last }, { COUNT: q.kind === "sensor" ? q.depth : 100, BLOCK: BLOCK_MS }).catch(() => null);
          const ms = r?.flatMap((s) => s.messages) ?? [];
          if (!ms.length) continue;
          last = ms.at(-1)!.id;
          for (const m of q.kind === "sensor" ? ms.slice(-1) : ms) if (on) void deliver(decode(topic, m.message.m!));
        }
      })();
    }
    // 끊을 때 처리 중인 deliver를 기다리지 않는다(끝나도 on이 거짓이라 ack하지 않고, 다시 붙은 그룹이 XAUTOCLAIM으로 다시 받는다)
    const close = async () => {
      on = false;
      void loop.catch(() => {});
      await conn.disconnect().catch(() => {});
      this.#closers.delete(close);
    };
    this.#closers.add(close);
    return close;
  }

  /** 모든 그룹이 넘긴(처리 중 없음) 앞부분을 자른다. */
  async #trim(k: string): Promise<void> {
    const groups = await this.client.xInfoGroups(k);
    if (!groups.length) return;
    const keep: string[] = [];
    for (const g of groups) {
      const p = await this.client.xPending(k, g.name);
      keep.push(p.pending > 0 && p.firstId ? p.firstId : nextId(g.lastDeliveredId));
    }
    const min = keep.sort((a, b) => { const [am, as] = a.split("-").map(Number); const [bm, bs] = b.split("-").map(Number); return am! - bm! || as! - bs!; })[0]!;
    await this.client.xTrim(k, "MINID", min);
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  async length(topic: string): Promise<number> {
    return this.client.xLen(this.#k(topic));
  }

  async close(): Promise<void> {
    for (const c of [...this.#closers]) await c();
    await this.client.quit();
  }
}
```

node-redis 6.3.1의 명령 함수 이름·인자 모양(`xAdd` `TRIM`, `xAutoClaim` 반환, `xInfoGroups`의 `lastDeliveredId`, `xPending`의 `firstId`)은 설치한 판의 타입으로 맞춘다. 맞추는 기준은 계약 시험이다.

- [ ] **Step 4: Redis 컨테이너 파일을 쓴다**

`compose.dev.yaml`:

```yaml
# 이 PC 개발·시험용 Redis(노드 통로). 실제 Redis 시험 때만 켠다: docker compose -f compose.dev.yaml up -d redis
# 시험·개발 서버는 REDIS_URL=redis://127.0.0.1:6379. 이미지·판은 compose.yaml redis와 같다.
services:
  redis:
    image: redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b
    container_name: noonchi-redis
    command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    ports: ["127.0.0.1:6379:6379"]
```

`compose.yaml`에 더한다:

```yaml
  # 노드 통로(ROS 2 통로 역할). noonchi와 같은 EC2, 호스트에 열지 않는다. RELIABLE을 잃지 않게 넘치면 지우지 않고(noeviction) AOF로 남긴다
  redis:
    image: redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b
    init: true
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "512mb", "--maxmemory-policy", "noeviction"]
    volumes: ["noonchi-redis:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
```

`noonchi` 서비스에 `REDIS_URL: redis://redis:6379`, `depends_on: { redis: { condition: service_healthy } }`, `volumes:` 목록에 `noonchi-redis:`를 더한다. `.env.example`에 `REDIS_URL=`(비우면 메모리 통로, 개발용 Docker Redis는 `redis://127.0.0.1:6379`)을 더한다.

- [ ] **Step 5: 메모리 통로로 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-redis.test.ts tests/deploy-files.test.ts tests/bus-memory.test.ts`
Expected: `deploy-files`·`bus-memory` PASS, `bus-redis` 건너뜀

- [ ] **Step 6: 실제 Redis로 계약 시험을 돌린다(Docker는 이때만)**

```powershell
[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)   # 2.6 이상일 때만 다음으로
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
while (-not (docker info 2>$null)) { Start-Sleep 2 }                                # 엔진이 뜰 때까지
docker compose -f compose.dev.yaml up -d redis
$env:REDIS_URL = "redis://127.0.0.1:6379"; npm run heavy -- npx vitest run tests/bus-redis.test.ts
docker compose -f compose.dev.yaml down
Stop-Process -Name "Docker Desktop" -Confirm:$false; wsl --shutdown           # WSL VM 메모리를 돌려받는다(다른 WSL 일이 돌면 wsl --shutdown은 빼고 조정자에게 알린다)
```

Expected: `RedisBus 통로 계약` 다섯 시험 PASS. 끝나면 Docker Desktop과 WSL VM이 꺼져 있다(`Get-Process "Docker Desktop"`이 없음). 빈 메모리가 모자라면 이 단계를 미루고 조정자에게 알린다.

- [ ] **Step 7: 커밋·push**

```bash
git add src/bus package.json package-lock.json compose.yaml compose.dev.yaml .env.example tests/bus-redis.test.ts tests/deploy-files.test.ts
git commit -m "feat(bus): add the Redis Streams bus with pinned dev and AWS Redis containers"
git push
```

### Task 4: 녹화 · 재생 (기록 노드)

**Files:**
- Create: `src/record/bag.ts`, `src/record/node.ts`, `src/record/index.ts`
- Modify: `scripts/lint-domains.ts`(`record` 도메인, `DEPS.record = ["bus"]`, `server`에 `record`)
- Test: `tests/record-bag.test.ts`

**Interfaces:**
- Consumes: Task 2 `BusNode`, `MemoryBus`, `TOPICS`.
- Produces: `class Bag { static open(path: string): Bag; write(e: Envelope<TopicName>): void; day(dayStart: number, dayEnd: number, o?: { topics?: TopicName[] }): Envelope<TopicName>[]; close(): void }`, `startRecorder(o: { bus: Bus; bag: Bag; clock? }): Promise<BusNode>`, `replay(o: { bus: Bus; bag: Bag; from: number; to: number; topics?: TopicName[]; speed?: number; clock?: { set(ms: number): void } }): Promise<number>`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/record-bag.test.ts`:

```ts
// 녹화·재생(rosbag2처럼): 기록 노드가 모든 토픽을 SQLite에 남기고, 사진 칸은 남기지 않는다. 하루치를 통로에 같은 차례로 다시 흘린다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus } from "../src/bus/index.js";
import { Bag, replay, startRecorder } from "../src/record/index.js";

describe("녹화·재생", () => {
  it("모든 토픽을 남기고 사진(jpeg)은 남기지 않는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bag-")), "bag.sqlite");
    const bus = new MemoryBus();
    const bag = Bag.open(path);
    const rec = await startRecorder({ bus, bag });
    const phone = new BusNode({ name: "phone", bus, clock: { now: () => 1000 } });
    const world = new BusNode({ name: "world", bus, clock: { now: () => 2000 } });
    await phone.start();
    await world.start();
    phone.publish("/perception/frame", { jpeg: "/9j/AAAA", captured_ms: 1000 });
    world.publish("/world/changes", { changes: [{ id: "cup_1" }] });
    await new Promise((r) => setTimeout(r, 50));
    await rec.idle();
    const rows = bag.day(0, 10_000);
    expect(rows.map((r) => r.topic).sort()).toEqual(["/perception/frame", "/world/changes"]);
    expect(rows.find((r) => r.topic === "/perception/frame")!.body).toEqual({ captured_ms: 1000 });
    bag.close();
    expect(readFileSync(path).includes(Buffer.from("/9j/AAAA"))).toBe(false);
  });

  it("하루치를 stamp 차례로 통로에 다시 흘린다", async () => {
    const bag = Bag.open(":memory:");
    const e = (stamp: number, i: number) => ({ topic: "/world/changes" as const, key: "_", header: { stamp, node: "world" as const, seq: i, gen: 1 }, body: { i } });
    bag.write(e(3000, 2));
    bag.write(e(1000, 1));
    bag.write(e(99_999_999, 3));
    const bus = new MemoryBus();
    const got: number[] = [];
    await bus.subscribe("/world/changes", "act", async (m) => { got.push(m.body.i as number); });
    expect(await replay({ bus, bag, from: 0, to: 10_000 })).toBe(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([1, 2]);
  });
});
```

Run: `npm run heavy -- npx vitest run tests/record-bag.test.ts`
Expected: FAIL(`src/record/index.js`가 없다)

- [ ] **Step 2: `bag.ts`를 쓴다**

```ts
// 녹화 파일(SQLite, node:sqlite): 토픽·열쇠·머리·몸. 사진 칸(TOPICS의 photo)은 빼고 남긴다(분석한 프레임은 디스크에 쓰지 않는다).
import { DatabaseSync } from "node:sqlite";
import { TOPICS, decode, encode, type Envelope, type TopicName } from "../bus/index.js";

export class Bag {
  private constructor(private readonly db: DatabaseSync) {
    db.exec("CREATE TABLE IF NOT EXISTS bag (stamp INTEGER NOT NULL, topic TEXT NOT NULL, raw TEXT NOT NULL); CREATE INDEX IF NOT EXISTS bag_stamp ON bag(stamp);");
  }

  static open(path: string): Bag {
    return new Bag(new DatabaseSync(path));
  }

  write(e: Envelope<TopicName>): void {
    const photo = (TOPICS[e.topic] as { photo?: string }).photo;
    const body = photo ? Object.fromEntries(Object.entries(e.body as Record<string, unknown>).filter(([k]) => k !== photo)) : e.body;
    this.db.prepare("INSERT INTO bag (stamp, topic, raw) VALUES (?, ?, ?)").run(e.header.stamp, e.topic, encode({ ...e, body } as Envelope<TopicName>));
  }

  day(from: number, to: number, o: { topics?: TopicName[] } = {}): Envelope<TopicName>[] {
    const rows = this.db.prepare("SELECT topic, raw FROM bag WHERE stamp >= ? AND stamp < ? ORDER BY stamp, rowid").all(from, to) as { topic: TopicName; raw: string }[];
    return rows.filter((r) => !o.topics || o.topics.includes(r.topic)).map((r) => decode(r.topic, r.raw));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 3: `node.ts`·`index.ts`를 쓴다**

```ts
// 기록 노드: 모든 토픽을 구독해 녹화 파일에 남긴다. 재생은 녹화한 머리 그대로(stamp·node·seq·gen) 통로에 다시 낸다.
import { BusNode, TOPICS, type Bus, type TopicName } from "../bus/index.js";
import type { Bag } from "./bag.js";

export async function startRecorder(o: { bus: Bus; bag: Bag; clock?: { now(): number } }): Promise<BusNode> {
  const node = new BusNode({ name: "recorder", bus: o.bus, clock: o.clock });
  for (const topic of Object.keys(TOPICS) as TopicName[]) node.on(topic, (_b, e) => { o.bag.write(e); });
  await node.start();
  return node;
}

/** from ≤ stamp < to인 메시지를 stamp 차례로 낸다. clock이 있으면 내기 전에 그 stamp로 맞춘다. 낸 수를 돌려준다. */
export async function replay(o: { bus: Bus; bag: Bag; from: number; to: number; topics?: TopicName[]; clock?: { set(ms: number): void } }): Promise<number> {
  const rows = o.bag.day(o.from, o.to, { topics: o.topics });
  for (const e of rows) {
    o.clock?.set(e.header.stamp);
    await o.bus.publish(e);
  }
  return rows.length;
}
```

```ts
// index.ts — 기록 노드(녹화·재생).
export { Bag } from "./bag.js";
export { replay, startRecorder } from "./node.js";
```

`scripts/lint-domains.ts`: `SERVER_DOMAINS`에 `"record"`, `DEPS.record = ["bus"]`, `server`에 `"record"`.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/record-bag.test.ts tests/domain-boundaries.test.ts tests/no-frames-on-disk.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋·push**

```bash
git add src/record scripts/lint-domains.ts tests/record-bag.test.ts
git commit -m "feat(record): record every topic without photos into SQLite and replay a day onto the bus"
git push
```

### Task 5: 묶음 1 끝 조건

- [ ] **Step 1:** 빈 메모리 3GB 이상을 확인하고 하나씩 돌린다.

```bash
npm run heavy -- npx vitest run tests/demo-e2e.test.ts
npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts
npm run heavy -- npx vitest run tests/coach-e2e.test.ts
npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts
npm run heavy -- npx vitest run tests/video-mode-e2e.test.ts tests/video-real-e2e.test.ts tests/video-mode-parity.test.ts
npm run heavy -- npm --prefix ui test -- phone-mode-parity
npm run heavy -- npm run typecheck
npm run heavy -- npm run lint
```

Expected: 모두 PASS(이 묶음은 집 실행 묶음을 바꾸지 않는다).

- [ ] **Step 2:** 묶음 1 해시를 조정자에게 보내고 묶음 2 단계 계획을 이 파일에 더해 Codex 검토를 받는다.

---

## 묶음 2: 집 상태 노드 (입력 포함)

**목표:** World State를 `world` 노드 하나만 바꾼다. 관찰 흐름은 인식 결과를 토픽으로 내고, 실행 추적이 직접 부르던 `world.guard`·`world.contentsAction`은 `/world/input`으로 간다.

**바뀌는 자리:**

| 지금 | 묶음 2 뒤 |
|---|---|
| `ObservePipeline`이 `world.applyDetections`·`applyMissing`·`applyVlm…`을 부르고 `publish(changes)`로 방송(`src/observe/pipeline.ts:209-328`) | 인식은 `/perception/detections`(SENSOR)·`/perception/analysis`(RELIABLE)·`/perception/look_result`(RELIABLE)만 내고, `world` 노드가 받아 넣는다 |
| `onChanges: (c) => { tracking.onWorld(c); decide.onChanges(c); }`(`src/server/home/observe.ts`) | `world`가 `/world/changes`, `/world/state`를 낸다. 실행 추적·판단은 아직 함수로 두되 받는 길만 토픽 구독으로 바꾼다(어댑터 노드 `act`·`brain`) |
| `guardObject: (id, on) => world.guard(id, now(), on)`, `contentsAction: (id, on) => world.contentsAction(id, now(), on)` | `/world/input` `{ id, kind: "guard" | "pour", on }` |
| `observed.onDevice(s)`, 시작 가전 상태 `world.applyDevice` | `/device/state`(STATE, 이 묶음에서는 허브 구독을 `devices` 어댑터가 낸다) |
| 대시보드 `broadcastWorld`, 물체 모양 `onSeen` | `phone` 어댑터가 `/world/state`·`/perception/detections`를 받아 방송 |

**몸 모양:** `/perception/detections`, `/perception/analysis`, `/perception/look_result`, `/world/input`, `/world/state`, `/world/changes`, `/device/state`의 zod 모양을 `src/bus/topics.ts`에 실제 모양으로 넣는다(`src/contract/`의 타입과 같음을 `z.ZodType<Contract>` 타입 주석으로 묶는다).

**시험:** `tests/world-node.test.ts`(인식 토픽만으로 World State가 같은 바뀜을 내는지, `/world/input` 지킴·따르기 창, 늦은 위에서 본 답은 세대로 버림 — 292eb63 사례, 같은 원본 프레임의 잘라 본 답이 전체 답보다 앞섬 — d1ccae2 사례), 기존 `tests/world-*.test.ts`는 그대로 통과. 다시 들어오기 사례(1620be1의 `queueMicrotask` 없이 실행 추적 콜백 안 World State 바꿈)가 실행기 차례로 처리되는지 `tests/bus-node.test.ts`에 더한다.

**끝 조건:** 묶음 공통 + `grep -n "world\.\(guard\|contentsAction\|apply\)" src/server src/act src/observe`가 `src/world/node.ts` 밖에서 비어 있다.

## 묶음 3: 실행 추적 ↔ 폰 (콜백 22개)

**목표:** 실행 추적 노드(`act`)가 폰·대시보드와 토픽으로만 주고받는다. 폰 사용권 표가 흩어진 막기를 대신한다.

**콜백 → 토픽**(`src/server/home/act.ts:100-151`):

| 콜백 | 묶음 3 뒤 |
|---|---|
| `plans`(PlanHub 방송) | `/act/plan`(STATE) → `phone`이 대시보드로, `recorder` |
| `floor`, `locate`, `names` | `layout` 도구(읽기만) |
| `world` | `/world/state` 구독(노드 안 최신 값) |
| `emit` | `/act/log`(RELIABLE) |
| `clock`, `offsetMinutes` | 노드 설정 |
| `approvals` | `act` 노드가 가진 승인 기억(쓰는 곳 하나), 답은 `/phone/progress` |
| `devices` | `/device/command` → `/device/result`(묶음 5에서 가전 노드로) |
| `precheck`, `planner` | 묶음 4까지 `act` 안, 묶음 4에서 `brain`으로 |
| `toPhone` | `/act/phone_command`(STATE, 세대 = 명령 id·단계) + `/phone/claim` `plan` |
| `check`, `lessons` | `act` 안 |
| `handDevices` | `/device/state` 구독 |
| `phoneReady` | `/phone/link`(STATE) |
| `sayAloud` | `/phone/say` + `/phone/claim` `safety` |
| `stalled`, `lookContents`, `strayed` | `act` 안 보기 담당(`Looker`) |
| `topReady` | `/perception/look_result` 구독 |
| `guardObject`, `contentsAction` | `/world/input`(묶음 2) |
| `approvalsWaiting`, `talking` | `/phone/owner`(사용권 표) |
| `tasks` | `/act/status` 안 지금 도움 모드 행동 목록(설정) |
| 실제 폰 「완료」·답·「그만」·단계 영상 끝 | `/phone/progress`(RELIABLE, 세대 = 명령 세대, 지난 세대는 실행기에서 버림 — 58246d8·c966b20·6a2efe9·cb07b65 사례) |
| 주기 `tracking.tick()`·`looking.tick()`(`startLoop` 250ms) | `act` 노드 타이머(`every(250)`, 같은 줄 — a243ea5·6fb2d1d 사례) |

**폰 사용권:** `src/phone/owner.ts` `phoneOwner(claims): Claim | null`(표의 차례), `phone` 노드가 `/phone/claim`을 받아 고르고 `/phone/owner`를 낸다. 승인 대기 시간은 승인이 화면에 있을 때만 흐른다(`policy.pause` 대신).

**시험:** `tests/phone-owner.test.ts`(표 차례 다섯, 높은 것이 사라지면 낮은 것이 다시 나옴, 승인 시간 멈춤), `tests/act-node.test.ts`(지난 명령의 「완료」를 버림, 「그만」·새 계획·계획 밖 보기 거두기의 차례 — e54860d·4dc5de7 사례), 기존 `tests/act-track*.test.ts`는 실행 추적 함수를 그대로 시험해 통과.

**끝 조건:** 묶음 공통 + `ExecutionTracker` 생성자 옵션에 함수가 `planner`·`precheck`·`check` 말고 남지 않는다.

## 묶음 4: 판단 노드

**목표:** `brain` 노드가 `/world/state`·`/world/changes`·`/act/status`·`/phone/heard`를 받아 판단하고(`/brain/decision`), 계획 전 검사와 계획 모드를 돌려 `/brain/plan`을 낸다. 실행 추적은 `/brain/plan`을 받아 실행 전 검사·실행만 한다. 「그만」이 계획 만드는 중이면 `act`가 `/brain/cancel`을 낸다.

**바뀌는 자리:** `Decider`의 `hold`(`tracker.waiting()·coaching()`) → `/act/status`, `keepHeard` → `/phone/heard`, `onDecision` → `/brain/decision`, 생각 메시지 → `/brain/thought`, PAM 연결 → `/brain/link`, 반성은 `brain` 노드의 하루 끝 타이머.

**시험:** `tests/brain-node.test.ts`(바뀜이 없으면 부르지 않음, 기다리는 중이면 부르지 않음, 계획 만드는 중 취소, `placed`를 `/act/status`로 받아 이미 치운 물건 계획을 버림), 기존 `tests/world-decide.test.ts`·`tests/agent-planner.test.ts` 통과.

**끝 조건:** 묶음 공통 + `src/act`가 `src/brain`·`src/agent/planner`를 가져오지 않는다.

## 묶음 5: 가전 노드

**목표:** `devices` 노드가 허브(`signals`)를 가지고 `/device/command`를 받아 실행해 `/device/result`, 상태는 `/device/state`(STATE, 기기마다)로 낸다. 위험 목록 명령은 승인 토큰이 있어야 한다(지금 `deviceRunner`·정책과 같음). 말로 시킨 가전(대화, `phone` 노드)도 같은 토픽을 쓴다.

**시험:** `tests/devices-node.test.ts`(승인 토큰 없는 위험 명령 거절, 결과 세대, 늦게 붙은 노드가 모든 기기 상태를 받음), 기존 `tests/agent.test.ts` 「Agent + 승인 규칙」, `tests/act-track.test.ts` 기기 단계 통과.

**끝 조건:** 묶음 공통 + `signals`를 `src/devices` 밖에서 가져오지 않는다.

## 묶음 6: 경계 검사를 엄격하게

**목표:** 노드 도메인끼리 import를 막는다.

- `scripts/lint-domains.ts` `DEPS`: `phone`·`observe`·`world`·`brain`·`act`·`devices`·`record`는 `bus`와 도구 묶음(`layout`, `agent`)·공용 표·기반층만. `server`는 각 노드의 입구(`node.ts`를 내보내는 `index.ts`)만.
- 새 검사: 노드 도메인 파일이 다른 노드 도메인을 가져오면 「노드는 토픽으로만 주고받아요. `<토픽>`을 구독하세요」로 실패. 과거 실수로 실패 확인: `src/server/home/act.ts`의 `world.guard` 직접 호출(cb07b65)과 1620be1 `queueMicrotask` 줄을 넣은 가짜 트리.
- `CLAUDE.md` 규칙 표에 한 줄: 「노드는 토픽으로만 주고받는다 | `npm run lint`(lint-domains 노드 경계)·`tests/domain-boundaries.test.ts`·`tests/bus-node.test.ts`」.

**끝 조건:** 묶음 공통 + 전체 시험(빈 메모리 3GB 이상).

---

## 위험

| 위험 | 막는 것 |
|---|---|
| 한 프로세스 안인데 Redis를 지나 판단·명령이 느려진다 | 같은 EC2 안 Redis는 왕복 1ms 안팎이다. 판단 주기 5초, 폰 명령은 사람 속도다. 묶음마다 e2e 시간을 지금과 견준다 |
| RELIABLE 그룹이 늦게 만들어져 첫 메시지를 잃는다 | 띄우는 곳이 모든 노드 `start()`(구독)를 마친 뒤 발행한다(이 계획 5). 계약 시험 「다시 붙은 같은 그룹이 다시 받는다」 |
| Redis 메모리가 가득 차 RELIABLE을 잃는다 | `noeviction`(가득 차면 발행 오류, 지우지 않음), 처리 뒤 `XTRIM MINID`, SENSOR·STATE 알림은 `MAXLEN ~`. 발행 오류는 노드 로그에 남는다 |
| 사진이 Redis·녹화에 쌓인다 | 사진은 SENSOR(depth 4)에만, 녹화는 사진 칸을 뺀다(`tests/record-bag.test.ts`, `tests/no-frames-on-disk.test.ts`) |
| 실행기가 한 줄이라 느린 콜백(LLM 계획)이 노드를 막는다 | LLM 호출은 콜백에서 시작만 하고 결과는 그 노드에 메시지로 돌아온다(세대를 실어 늦은 답은 버림). 묶음 4에서 계획 모드를 이 꼴로 옮긴다 |
| 이 PC 메모리(Docker Desktop 1GB+) | 실제 Redis 시험만 Docker, 켜기 전 2.6GB 확인, 끝나면 끔. 평소 시험·개발은 MemoryBus |
| MemoryBus와 RedisBus 동작이 갈린다 | 같은 계약 시험(`tests/helpers/bus-contract.ts`). 갈래는 `openBus`의 `REDIS_URL` 한곳 |
| 묶음 사이 중간 상태에서 기능이 빠진다 | 묶음마다 데모 e2e 넷·영상 모드 시험이 끝 조건 |

## Self-Review

- 사용자 결정 1~9: 정한 것 1~12, 노드·토픽 표, 폰 사용권 표, 묶음 1~6, 레퍼런스. 개발용 Redis(Docker, `noonchi-redis`, 127.0.0.1:6379, 판 고정, 켜기 전 메모리, 끝나면 끔): 정한 것 7·8, 묶음 1 Task 3.
- 근거 표: 다시 들어오기(1620be1·8a13f9f), 순서(d1ccae2·e54860d·4dc5de7), 늦은 답(292eb63·58246d8·c966b20·6a2efe9·cb07b65), 타이머(a243ea5·6fb2d1d).
- 이름 맞춤: `TOPICS`·`TopicName`·`Body`·`Envelope`·`Header`·`Freshness`·`Bus`·`MemoryBus`·`RedisBus`·`BusNode`·`openBus`·`Bag`·`startRecorder`·`replay`가 묶음 1 Task 1~4에서 같다.
