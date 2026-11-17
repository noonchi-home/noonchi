# 단계 사이를 메시지 줄로 나누기 (ROS 2처럼, Redis) Implementation Plan

> **쉬운 요약**
> 1. 서버 안의 단계(폰·화면 연결, 인식, 집 상태, 판단, 실행 추적, 가전, 기록)를 「노드」로 나누고, 노드끼리는 함수를 부르지 않고 「토픽」에 메시지를 넣고 받기만 해요(ROS 2처럼).
> 2. 토픽마다 받는 방식(QoS)을 한 표에 정해요: 최신만 보면 되는 것, 지금 상태 하나, 꼭 다 받아야 하는 것. 표에 빠지면 타입 검사가 실패해요.
> 3. 통로는 Redis(EC2 안 noonchi 옆 컨테이너, 디스크 저장 끔)이고, 시험·개발은 같은 동작의 메모리 통로를 써요. 두 통로가 같게 도는지 같은 시험으로 봐요.
> 4. 노드는 메시지를 하나씩 처리하고, 처리가 끝나야 「받았음」을 알려요. 낡은 메시지·지난 기동·지난 집의 메시지는 받는 쪽 한곳에서 버려요. 오래 남길 기록은 기록 노드가 SQLite에 빠짐없이 적어요.
> 5. 여섯 묶음으로 옮기고, 묶음마다 데모 e2e 넷·영상 모드 시험·기록 DB 같음 시험이 통과해야 다음으로 가요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 집 실행 묶음(`src/server/home/`)이 부품끼리 콜백으로 직접 잇던 것을, 노드가 토픽으로만 주고받는 구조로 바꾼다. 통로는 Redis Streams(실제)와 메모리(시험·개발)를 바꿔 끼운다.

**Architecture:** 새 도메인 `src/bus/`가 토픽 표(이름·QoS·몸 모양·보내는 노드·순서 기준), 메시지 머리(stamp·node·seq·boot·home), 통로 인터페이스 `Bus`(`MemoryBus`·`RedisBus`), 노드 실행기(`BusNode`: 준비·시작 두 단계, 콜백 하나씩, 타이머도 같은 줄, 처리 뒤 ack, 끝내기 계약), 요청-답 맞추기(`Pending`), 가상 시계를 맡는다. 노드는 모두 한 Node 프로세스(noonchi 컨테이너) 안에서 돌고 통로로만 이어진다. 기록 노드(`src/record/`)가 기록 DB(SQLite)와 녹화를 쓰고, 격리 재생을 맡는다. 폰 화면을 누가 쓰는지는 줄과 따로 사용권 표 하나로 정한다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, `redis`(node-redis) 6.3.1, Redis 8.10.2(`redis:8.10.2-alpine`), `node:sqlite`, Vitest.

**Spec:** 사용자 결정(2026-11-17, 조정자 전달): 「ROS 2처럼 Redis를 쓰는 코드를 짜자」, Redis는 EC2 안 noonchi 옆 컨테이너, 개발용 Redis는 이 PC의 Docker 컨테이너, Redis 디스크 저장 끔, 반성 입력은 기록 DB에 빠짐없이. 아키텍처 그림 `2026_SWE_NOONCHI_Archi.drawio`(인식 ↔ Redis ↔ noonchi, pam 없음). 앞선 일: `docs/superpowers/plans/2026-11-17-pam-in-node.md`(이 계획은 그 브랜치 끝에서 시작한다). Codex 설계 검토 세 번(c6073a6: P1 다섯·P2 열, d4fe651: P1 셋·P2 열·P3 하나, edd2e13: 묶음 1을 막는 P1 없음·P2 넷)을 아래 「검토 반영」 표 셋으로 반영했다.

## 정한 것 (2026-11-17, 사용자)

1. **Redis 자리:** EC2 안에서 noonchi 옆 컨테이너(ElastiCache 아님). 서버 한 대가 로봇 몸 안 컴퓨터, Redis가 그 안의 ROS 2 통로다. noonchi와 Redis는 같은 EC2에서 같이 켜지고 꺼진다.
2. **노드:** 폰·화면 연결(`phone`), 인식(`perception`), 집 상태(`world`), 판단(`brain`), 실행 추적(`act`), 가전(`devices`), 기록(`recorder`). 노드는 토픽 구독·발행만 한다. 다른 노드 코드를 import하면 도메인 경계 시험이 실패한다.
3. **실행기:** 노드마다 콜백(메시지·타이머)을 하나씩 차례로 처리한다(ROS 2 single-threaded executor). 다시 들어오기가 없다.
4. **QoS 셋**(토픽마다 하나, 표에 없으면 타입 검사 실패):
   - **SENSOR:** best effort, keep last N. Redis Stream `MAXLEN ~N`, ack 없음, 늘 최신을 읽음(기록 노드만 처음부터 차례로 다 읽는다, 정한 것 10).
   - **STATE:** 열쇠(key)마다 최신 값 하나. 늦게 붙은 노드도 바로 받는다(ROS 2 transient local).
   - **RELIABLE:** consumer group, `XREADGROUP`/`XACK`, 못 받은 것 다시 주기, 처리 뒤 자르기.
5. **메시지 머리:** 찍힌 시각(stamp), 보낸 노드, seq, 세대. zod로 모양을 검사하고 JSON으로 직렬화한다. 사진은 SENSOR 토픽에 최근 몇 장만 담는다. 낡은 메시지는 받는 쪽 한곳(실행기)에서 버린다.
6. **통로 바꿔 끼우기(rmw처럼):** `Bus` 하나에 `RedisBus`·`MemoryBus`. `REDIS_URL`이 있으면 `RedisBus`, 없으면 `MemoryBus`. 두 통로는 같은 계약 시험을 통과한다. 실제 Redis 시험은 `REDIS_URL`이 있을 때만 돌고, 없으면 건너뛴다(CI·다른 PC).
7. **개발용 Redis:** 이 PC는 Docker 컨테이너. 개발용 compose 파일(`compose.dev.yaml`)의 `redis` 서비스, 공식 이미지 판 고정, 컨테이너 이름 `noonchi-redis`, `127.0.0.1:6379`만 연다. 시험·개발 서버는 `REDIS_URL=redis://127.0.0.1:6379`. AWS compose도 같은 이미지·판.
8. **Docker Desktop은 실제 Redis 시험 때만 켠다.** 켜면 WSL VM이 1GB 넘게 쓴다. 켜기 전 빈 메모리를 보고 2.6GB 밑이면 기다린다. 끝나면 끈다. 실제 Redis 시험은 무거운 일이라 하나씩(`npm run heavy`).
9. **Redis 디스크 저장을 통째로 끈다**(`appendonly no`, `save ""`, 개발용·AWS 둘 다). 사진용 Redis를 따로 두지 않는다. noonchi는 켜질 때 `CONFIG GET appendonly`·`save`를 보고, 저장이 켜져 있으면 무엇을 바꾸라는 오류로 시작하지 않는다(시험 있음). 근거: 다시 켜진 뒤에는 기동 세대(이 계획 5)로 옛 메시지를 어차피 받지 않고, noonchi와 Redis는 같이 켜지고 꺼지며, 오래 남길 것은 기록 노드가 SQLite에 남기고(사진 빼고), ROS 2 토픽도 volatile이고 남길 것만 rosbag으로 남긴다. 그래서 RELIABLE의 「다시 주기」는 같은 기동 안에서 노드가 죽거나 끊겼을 때만이다.
10. **오래 남는 곳은 지금처럼 SQLite 기록 DB(`noonchi.db`)다.** 기록 노드가 토픽을 구독해 적는다. 반성(`src/brain/history/reflect.ts` `DAY_KINDS`·`HABIT_KINDS`, `summary.ts`)이 읽는 종류는 하나도 놓치지 않는다.
    - RELIABLE 토픽: 기록 노드는 자기 consumer group으로 읽고, SQLite에 쓴 뒤에만 XACK한다.
    - SENSOR 토픽 가운데 기록에 남기는 것: 기록 노드는 따로 커서로 처음부터 차례로 다 읽는다. MAXLEN 때문에 잘려 놓치면 그 수를 기록 DB에 `bus_gap` 줄로 남긴다. 상한·속도 근거는 「SENSOR 상한」 표.
    - 사진 바이트는 남기지 않는다.
    - 메시지 하나의 기록 줄과 처리표를 한 트랜잭션으로 써서, 다시 온 메시지는 한 번만 남는다(이 계획 18).
    - 시험: 같은 입력을 지금 방식과 통로 방식으로 돌려 기록 DB의 반성용 줄이 같아야 한다(묶음 2·3 끝 조건).
11. **녹화·재생(rosbag2처럼):** 기록 노드가 토픽을 사진 칸 없이 녹화 파일(SQLite)에 남긴다. 하루치를 **격리된 재생 실행기**에서 다시 흘려 시험한다(이 계획 17).
12. **폰 사용권:** 줄과 따로 표 하나: 안전 안내 > 승인 질문 > 대화 > 계획 명령 > 가까이 가서 보기.
13. **옮기는 순서:** ① 통로·QoS 표·메시지 머리·MemoryBus·RedisBus·녹화 ② 집 상태 입력(실행 추적이 World State를 직접 바꾸던 `contentsAction`·`guard` 포함) ③ 실행 추적 ↔ 폰(콜백 22개) ④ 판단 ⑤ 가전 ⑥ 경계 검사를 엄격하게. 묶음마다 데모 e2e 넷과 영상 모드 시험이 통과해야 한다.
14. **배포:** AWS용 `compose.yaml`에 `redis` 컨테이너를 더한다(noonchi와 같은 EC2, 디스크 저장 끔).

## 이 계획에서 정한 것

1. **새 도메인 `bus`:** 기반층(`src/shared`·`src/infer`)은 npm 패키지를 가져올 수 없고(`scripts/lint-domains.ts:177`), 계약(`src/contract`)은 타입만 가져온다. 통로는 zod·`redis`를 쓰므로 도메인 `src/bus/`(의존 없음)로 두고, 모든 노드 도메인이 가져올 수 있게 한다.
2. **노드 = 도메인 하나의 `node.ts`:** `src/phone/node.ts`, `src/observe/node.ts`(인식), `src/world/node.ts`, `src/brain/node.ts`, `src/act/node.ts`, `src/devices/node.ts`, `src/record/node.ts`(새 도메인). `src/server/`는 노드를 띄우는 곳(launch)으로, 노드 입구만 가져온다.
3. **도구 묶음(노드 아님):** `layout`(평면도·자리 이름, 읽기만), `agent`(대화·계획 모드·관찰 모드 LLM 호출). 대화는 폰 노드 안에서, 계획 모드는 판단 노드 안에서(묶음 4), 관찰 모드는 실행 추적 노드의 보기 담당 안에서 돈다.
4. **한 프로세스, 여러 노드:** 노드는 지금처럼 noonchi 프로세스 하나에서 돈다. 통로만 Redis를 지난다. 노드를 다른 프로세스로 떼는 일은 이 계획 밖이다.
5. **세대 셋을 나눈다:**
   - **기동(`boot`):** 서버가 켜질 때마다 새 UUID. Redis 열쇠 앞에 붙이고(`noonchi:<boot>:<토픽>`), 켜질 때 다른 기동의 열쇠를 지운다. 머리에도 싣고, 받는 쪽은 지금 기동이 아니면 버린다.
   - **집(`home`):** 집을 열 때마다 새 값(`<집 id>#<연 횟수>`). 머리에 싣고, 받는 쪽은 지금 집이 아니면 버린다. 집을 바꾸면 띄우는 곳이 모든 노드를 끝내고(이 계획 9) 새 집 값으로 다시 띄운다.
   - **보낸 노드 인스턴스(`inst`):** 노드 객체를 만들 때마다 새 값. seq는 인스턴스·토픽마다 1부터다. 메시지 식별자는 `msgId` = 기동/집/노드/인스턴스/seq이고, 중복 판정(처리표·녹화)과 낡은 메시지 판정이 모두 이것을 쓴다(집·노드를 다시 만들어 seq가 1로 돌아와도 새 메시지가 옛것으로 버려지지 않는다).
   - **요청 id(`req`):** 요청과 답을 잇는 글 id(UUID). 답을 받는 노드는 `Pending`에 열어 둔 요청 id와 맞을 때만 받는다(늦은 답·모르는 답은 버린다). 다른 요청끼리 세대 숫자를 견주지 않는다.
6. **두 단계로 띄운다(준비 → 시작):** 띄우는 곳은 모든 노드의 `prepare()`(구독·consumer group·커서를 만든다, 콜백은 아직 안 부른다)를 마친 뒤에 모든 노드의 `start()`(콜백·타이머 시작)를 부른다. 첫 노드의 타이머나 STATE 초기 콜백이 다른 노드의 그룹이 생기기 전에 발행해 잃는 일이 없다.
7. **ack는 처리가 끝난 뒤에만, 차례는 지킨다:** 콜백이 성공하고, 그 안에서 기다린 필수 발행(`await node.publish(...)`)도 성공해야 RELIABLE을 ack한다. 줄에서 잠시 내려놓은 메시지(상태를 기다리는 변화, 이 계획 10)는 실제로 처리한 뒤에 ack한다(`ctx.defer()`). 실패하면 ack하지 않고 같은 메시지를 다시 준다(한 구독 안에서 최대 3번). 그동안 같은 토픽·그룹의 뒤 메시지는 앞지르지 않는다. 세 번 실패하면 `/bus/dead`에 남기고 ack한 뒤 다음으로 간다(기록 DB `bus_gap`). `/bus/dead` 처리 자체가 실패하면 dead로 다시 보내지 않고 log 오류로만 남긴다. 낡은 메시지 기록(Freshness)도 성공 뒤에 확정한다.
8. **순서 기준은 근거 시각:** 머리 stamp는 발행 시각이다. 사진 근거가 있는 몸은 `observed_ms`(촬영·근거 시각)를 싣고, 토픽 표의 `order`가 `observed_ms`면 그것으로, `rev`면 상태 판본으로 낡음을 본다. 늦게 끝난 옛 VLM 답이 새 관측처럼 통과하지 않는다.
9. **끝내기 계약:** `BusNode.stop()`은 닫힘 표시 → 타이머 멈춤 → 돌던 콜백과 `spawn()`으로 띄운 긴 일(LLM 호출)에 취소 신호 → 둘 다 끝나길 기다림 → 구독 끊기 차례다. 내려놓은 메시지는 ack하지 않고 둔다(같은 기동 안에서 다시 띄운 노드가 다시 받는다). 닫힌 뒤 `publish`는 거절된다. 집을 닫은 뒤 옛 출력이 나가지 않는다. 띄우는 곳은 새 일을 만드는 노드(판단·실행 추적·가전)를 먼저 끝내고, 그다음 나머지를 끝낸다(9f0f661과 같은 차례).
10. **상태와 변화의 판본을 잇는다:** 집 상태 노드는 바뀔 때마다 `rev`를 1 올려 `/world/state {rev, view}`와 `/world/changes {rev, changes}`를 낸다. 변화를 받는 노드는 `rev`가 그 이상인 상태를 가진 뒤에 변화를 처리한다(`node.withState`). 상태가 아직 없으면 변화를 내려놓고 줄을 비우며, 상태가 와서 처리한 뒤에 그 변화를 ack한다.
11. **사용권은 요청(claim) id마다:** `/phone/claim`의 열쇠는 claim id다(계획 승인과 대화 승인이 서로 덮지 않는다). `/phone/owner`는 고른 claim id와 종류를 싣는다. 승인 시간은 그 claim이 화면에 있을 때만 흐른다.
12. **위에서 보기는 사진 쌍을 기다리는 요청 하나로:** `topReady`(사진 쌍이 모였나)를 따로 묻지 않는다. 실행 추적은 `/perception/look_request {req, kind: "top", target, since_ms, deadline_ms}`를 내고, 인식 노드가 쌍이 모이면(또는 기한이 지나면) `/perception/look_result`를 낸다(지금 `contents.ts:205`의 「준비됐으면 topLook」을 인식 쪽이 맡는다). 순환 대기가 없다.
13. **사진은 base64로 싣고 크기를 묶는다:** `/perception/frame`의 사진은 `jpeg_b64`(JSON 글, 최대 700,000자 ≈ 512KB)이고, 받는 쪽은 `frameBytes(body)`로 `Buffer`를 되살린다. 녹화는 이 칸을 뺀다.
14. **가전 명령은 한 번만 실행한다:** `/device/command`는 `command_id`·`deadline_ms`를 싣는다. 가전 노드는 실행 전에 「시작함」을 적고, 실행 뒤 결과를 `command_id`로 보관한다. 이 원장은 기록 DB(SQLite)의 `device_commands` 표(기동·`command_id`·시작함·결과)에 둔다. 노드를 다시 만들어도, Redis가 다시 켜져도 그 기동 동안 남는다. 다시 온 명령은 실행하지 않고 보관한 결과를 다시 낸다. 「시작함」만 있고 결과가 없으면(실행 중 끊김) 다시 실행하지 않고 `unknown`을 낸다. 기한이 지났으면 실행하지 않고 `expired`를 낸다.
15. **Redis 오류·끊김:** 연결마다 오류 리스너를 단다(프로세스가 죽지 않는다). 잠깐 끊겼다 다시 붙으면 그룹·처리 중 메시지가 Redis에 남아 있으므로 그대로 잇는다. 켜질 때 기동 표시 열쇠(`noonchi:<boot>:alive`)를 두고 1초마다 본다. 열쇠가 없거나 `NOGROUP`이 나면 Redis가 다시 켜져 이번 기동의 메시지·그룹을 잃은 것이다. 되살려 잇지 않고 이 기동을 멈춘다: 통로는 그 뒤 발행·구독을 「Redis가 다시 켜져 이번 기동의 메시지를 잃었어요」로 거절하고 읽기를 멈추며, `onLost`(꼭 넘긴다)로 띄우는 곳이 서버를 끝내고, compose `restart`가 새 기동으로 다시 띄운다. 읽기 루프(RELIABLE·STATE 스냅숏·SENSOR)는 연결 오류가 나면 그 루프 전체를 처음부터 다시 시도한다(잠깐 끊긴 것은 이어진다). STATE는 알림의 카운터가 건너뛰면 스냅숏을 다시 읽는다.
16. **SENSOR는 정말 최신을, STATE는 빠짐없이:** SENSOR 구독은 깨어날 때마다 `XREVRANGE + COUNT 1`로 가장 새 것을 읽는다. SENSOR 상한은 정확히 depth개(`MAXLEN = depth`)이고, 메모리 통로도 같은 상한의 기록을 커서로 읽는다(상한 밖으로 쌓아 두지 않는다). 기록 커서는 준비 때 가장 새 메시지의 seq(없으면 0)를 기준으로 잡아, 첫 수신 전에 잘린 것도 놓친 수에 센다(SENSOR 토픽은 보내는 노드가 하나다). STATE는 발행마다 토픽 카운터(`INCR`)를 알림에 싣고, 받는 쪽이 건너뜀을 보면 스냅숏(`HGETALL`)을 다시 읽는다.
17. **재생은 격리된 실행기에서:** `replay()`는 실제 통로가 아니라 새 `MemoryBus`·가상 시계 위에 노드를 띄우고(가전 노드는 실행하지 않는 `dry-run`), 허용 목록의 바깥 입력 토픽만 흘린다(`/perception/detections`·`/perception/analysis`·`/perception/look_result`·`/phone/pose`·`/phone/heard`·`/phone/progress`·`/device/changes`). 녹화는 도착 차례와 도착 시각(`arrival_ms`, 기록 노드 시계)을 보관한다. 메시지마다 가상 시계를 그 도착 시각까지 당기되 타이머를 하나 부를 때마다 처리 장벽을 지나고, 발행한 뒤 다시 장벽을 지나 다음 메시지로 간다. 처리 장벽은 모든 노드의 줄이 비고 통로에 예약된 배달이 없는 상태가 두 번 이어질 때까지 기다린다(이어지는 발행이 몇 단계여도 비운다).
18. **기록은 한 번만:** 기록 노드는 메시지 하나의 기록 DB 줄과 처리표(`bus_seen`: 토픽·그룹·열쇠·`msgId`)를 한 SQLite 트랜잭션으로 쓴다(`db.once`). 녹화나 ack 전에 실패해 다시 와도 처리표에 있으면 쓰지 않는다. 녹화는 (토픽, `msgId`)가 같으면 다시 남기지 않는다. 가전 기록기의 기기마다 지난 값(지금 `attachRecorder`의 `last`)은 기록 DB `device_last` 표에 같은 트랜잭션으로 쓰고 거기서 읽는다(`deviceRecorder`는 메모리에 들지 않는다). 기록 노드를 다시 만들어도 지난 값이 이어진다.
19. **이 계획의 깊이:** 묶음 1은 단계·코드까지 쓴다. 묶음 2~6은 토픽·파일·시험·끝 조건까지 정하고, 앞 묶음이 끝나면 그 묶음의 단계 계획을 같은 파일에 더한다(묶음마다 Codex 설계 검토).

## 검토 반영 (Codex, c6073a6)

| # | 지적 | 반영 |
|---|---|---|
| P1-1 | AOF가 사진 XADD까지 디스크에 남김 | 사용자 정한 것 9: Redis 디스크 저장 끔 + 켜질 때 `CONFIG GET` 확인(Task 3) |
| P1-2 | 가전 실행 뒤 XACK 전에 끊기면 다시 실행 | 이 계획 14: `command_id` 결과 보관·중복 막기·기한(묶음 5) |
| P1-3 | 처리 예외를 삼키고 ACK | 이 계획 7: 성공 뒤에만 ack, 실패는 다시 주기·`/bus/dead`, Freshness는 성공 뒤 확정(Task 2) |
| P1-4 | 집·기동 epoch 없음, 요청 id와 세대가 섞임 | 이 계획 5: `boot`·`home`·`req` 셋(Task 1·3) |
| P1-5 | 재생이 모든 토픽을 실제 통로에 다시 보냄 | 이 계획 17: 허용 목록 + 격리 실행기(Task 4) |
| P2-6 | stop이 실행 중 콜백을 취소·대기하지 않음 | 이 계획 9: 끝내기 계약(Task 2) |
| P2-7 | 변화가 상태보다 먼저 와 옛 상태로 판단 | 이 계획 10: `rev`로 잇기(Task 2 `withState`, 묶음 2) |
| P2-8 | 사용권 열쇠가 종류라 승인끼리 덮음 | 이 계획 11: claim id(묶음 3) |
| P2-9 | topReady → look_result 순환 대기 | 이 계획 12: 쌍을 기다리는 요청 하나(묶음 2·3) |
| P2-10 | 구독 준비 전에 타이머·초기 콜백이 돎 | 이 계획 6: prepare → start(Task 2) |
| P2-11 | jpeg Buffer가 JSON 왕복에서 깨짐 | 이 계획 13: base64 + 상한 + `frameBytes`(Task 1) |
| P2-12 | stamp가 발행 시각이라 옛 결과가 새것처럼 통과 | 이 계획 8: `observed_ms`·`rev` 순서 기준(Task 1) |
| P2-13 | Redis 오류 리스너 없음, NOGROUP 삼킴 | 이 계획 15(Task 3) |
| P2-14 | SENSOR 최신 보장 안 됨, STATE 알림 누락 복구 없음 | 이 계획 16(Task 3) |
| P2-15 | 재생 시계·타이머·처리 장벽 없음 | 이 계획 17(Task 4) |

## 검토 반영 (Codex, d4fe651)

| # | 지적 | 반영 |
|---|---|---|
| P1-1 | `withState`가 상태를 기다리며 변화를 보관한 채 바로 ack | 이 계획 7·10: `ctx.defer()`로 줄은 비우고 ack는 처리 뒤(Task 2 `withState`, 시험 「상태를 기다리는 변화는 처리한 뒤에 ack」) |
| P1-2 | 실패한 메시지를 남긴 채 뒤 메시지를 처리(Redis) | 이 계획 7: 같은 메시지를 ack·dead까지 다시 주고 뒤 메시지는 기다림, 다시 붙으면 내 몫(id 0)부터(Task 3, 계약 시험 「앞 메시지가 성공하거나 dead가 되기 전에는…」) |
| P1-3 | 가전 중복 막기 원장이 노드 재생성·Redis 재시작 때 사라짐 | 이 계획 14: 원장은 기록 DB `device_commands`(묶음 5). 이 계획 15: Redis가 다시 켜지면 그 기동을 멈춤(Task 3 기동 표시 열쇠·`onLost`) |
| P2-4 | 시작만 한 LLM 호출이 stop 취소에서 빠짐 | 이 계획 9: `spawn()`(노드 수명 신호, stop이 끊고 기다림)·`post()`(Task 2, 묶음 4) |
| P2-5 | MemoryBus SENSOR all이 상한 없이 쌓음 | 이 계획 16: 같은 상한 기록을 커서로, 계약 시험 「상한을 넘으면 앞을 잃고 그 수를 센다」 |
| P2-6 | 기록 뒤 녹화·ack 전에 실패하면 반성용 줄 중복 | 이 계획 18: 기록 줄과 처리표 `bus_seen`을 한 트랜잭션(`db.once`), 녹화 `INSERT OR IGNORE`(Task 4) |
| P2-7 | `recordDevice`에 지난 값 상태가 없음 | 이 계획 18: `deviceRecorder(db, now)`가 기기마다 지난 값을 들고 커밋 뒤에 바꿈(Task 4) |
| P2-8 | 가상 시계가 비동기 타이머 일이 끝나기 전에 넘어감 | `VirtualClock.advanceTo(ms, settle)`: 타이머마다 장벽(Task 2 시험 「타이머마다 그 일이 끝난 뒤에」) |
| P2-9 | 장벽 세 번으로는 긴 발행 사슬을 못 비움 | 이 계획 17: `settle(bus, nodes)`가 줄·예약 배달이 두 번 연속 빌 때까지(Task 4 시험 「다섯 단계」) |
| P2-10 | 재생이 발행 stamp로 시계를 옮김 | 이 계획 17: 녹화에 `arrival_ms`, 재생 시계는 도착 시각(Task 4) |
| P2-11 | 동기 예외 때 `#running`이 끝난 Promise로 남음 | `#drain()`은 늘 다음 차례에 시작(`await null`), 회귀 시험 「타이머 콜백이 동기로 던져도」(Task 2) |
| P2-12 | `/bus/dead` 실패가 dead를 다시 dead로 | 이 계획 7: `/bus/dead` 실패는 log만(계약 시험) |
| P2-13 | 재진입 시험이 다른 노드의 정상 순서까지 잡음 | 계약 시험은 publish 안 동기 호출만, 같은 노드 콜백 겹침은 `bus-node` 시험이 따로 |
| P3-14 | 첫 수신 전에 잘린 SENSOR가 놓친 수에서 빠짐 | 이 계획 16: 준비 때 기준 seq(가장 새 메시지의 머리) |

## 검토 반영 (Codex, edd2e13: 묶음 1을 막는 P1 없음)

| # | 지적 | 반영 |
|---|---|---|
| P2-1 | 집·노드를 다시 만들면 seq가 1로 돌아와 새 메시지가 중복으로 버려짐 | 이 계획 5: 머리에 `inst`, 식별자 `msgId`(기동/집/노드/인스턴스/seq)를 처리표·녹화·낡은 메시지 판정이 같이 씀(Task 1·4) |
| P2-2 | 기록 노드를 다시 만들면 가전 지난 값이 비어 이전 값·중복 판정이 틀림 | 이 계획 18: 지난 값을 기록 DB `device_last`에 같은 트랜잭션으로(Task 4 시험 「기록 노드를 다시 만들어도」) |
| P2-3 | STATE 스냅숏·hGet·SENSOR xRevRange 오류가 구독을 영영 멈춤 | 이 계획 15: 읽기 루프마다 오류면 처음부터 다시(Task 3 시험 「연결이 잠깐 끊겨도」) |
| P2-4 | 기동을 잃은 뒤에도 발행·구독이 됨, 기본 onLost가 로그만 | 이 계획 15: 통로가 거절, `onLost`는 꼭 넘김(Task 3 시험) |
| 묶음 4 | 재생 장벽이 `spawn()` 일을 세지 않음 | 묶음 4 단계 계획에서 정한다(아래 묶음 4) |

## 근거: 오늘 고친 버그와 구조로 막는 자리

| 갈래 | 커밋 | 무엇이 틀렸나 | 새 구조에서 막는 것 |
|---|---|---|---|
| 다시 들어오기 | 1620be1 → 8a13f9f | 실행 추적 콜백 안에서 World State를 바꾸고 바로 방송하면 실행 추적에 다시 들어가서, `queueMicrotask`로 방송을 미뤘다(`src/server/home/act.ts` `answerContents`) | 실행기가 콜백을 하나씩 처리하고, 발행은 콜백이 끝난 뒤 받는 쪽 줄에 들어간다 |
| 다시 들어오기·지름길 | `src/server/home/act.ts:141,143`(cb07b65) | 실행 추적이 `world.guard`·`world.contentsAction`으로 World State를 직접 바꾸고 방송하지 않는다 | 묶음 2: `/world/input`(RELIABLE)으로만 바꾼다 |
| 순서 | d1ccae2 | 같은 원본 프레임의 잘라 본 답과 전체 답, 몸통(불투명)과 내용물의 넣는 차례 | 인식 답에 원본 프레임 `observed_ms`·seq, 집 상태 노드가 한 줄로 차례대로 넣는다 |
| 순서 | e54860d, 4dc5de7 | 새 계획이 같은 컵의 보기 지킴을 쓰기 전에 계획 밖 보기를 거둬야 했고, 계획을 만드는 중 「그만」이 계획 밖 보기를 멈추지 않았다 | 실행 추적 노드의 한 줄: 「그만」·새 계획·보기 거두기가 들어온 차례대로 처리된다 |
| 늦은 답 | 292eb63 | 옛 위에서 본 쌍이 새 확인을 덮고, 늦은 위에서 본 답이 보임을 바꿨다 | `observed_ms` 순서 기준과 `req` 맞추기로 받는 쪽 한곳에서 버린다 |
| 늦은 답 | 58246d8 | 지나간 질문에 늦게 온 말 답 | 질문 `req`를 답에 실어 `Pending`에 없으면 버린다 |
| 늦은 답 | c966b20, 6a2efe9, cb07b65 | 지난 명령의 단계 영상 바꾸기·예약이 새 명령 뒤에 끝났다 | 명령 `req`(명령 id·단계)를 `/act/phone_command`·`/phone/progress`에 싣는다 |
| 타이머 | a243ea5 | 다른 검사로 멈춘 보류 계획에서 다시 보기 기한이 계속 흘러 3초 만에 닫혔다 | 타이머도 같은 실행기 줄에서 돈다. 기한은 노드 상태로만 센다 |
| 타이머 | 6fb2d1d | 가까이 보기가 아직 도는 동안 보류 기한이 지나도 닫히지 않았다 | 기한 타이머 콜백이 보기 콜백과 끼어들지 않고 차례로 돈다 |
| 끝내기 | dc411ae, 9f0f661 | 서버를 끌 때 반성·판단 요청을 끊지 않거나, 반성을 기다리는 동안 집이 새 일을 받았다 | 이 계획 9: 닫힘 → 새 일 막기 → 돌던 일 취소 → 기다림 |
| 흩어진 폰 사용권 | `src/server/home/act.ts:119,145-146` | 안전 명령 때 승인 시간 멈춤, 승인 대기·대화 중 막기가 세 곳에 따로 있다 | 사용권 표 하나(정한 것 12) |
| 콜백 수 | `src/server/home/act.ts:100-151` | 실행 추적에 함수 22개를 넘긴다 | 묶음 3: 토픽으로 바꾼다(아래 표) |

## 레퍼런스

- ROS 2 QoS: sensor data 프로필은 best effort·keep last(작은 depth), 명령·상태 서비스는 reliable. transient local은 늦게 붙은 구독자에게 마지막 값을 준다. 토픽은 기본 volatile이다. (docs.ros.org 「Quality of Service settings」)
- ROS 2 executor: single-threaded executor는 콜백을 한 스레드에서 하나씩 돌린다. 타이머도 콜백이다.
- ROS 2 `std_msgs/Header`: `stamp`, `frame_id`. 우리는 `frame_id` 대신 `node`·`seq`·`boot`·`home`.
- rosbag2: 남길 토픽만 녹화하고 다시 흘린다(재생은 시뮬레이션 시계 `/clock`).
- Home Assistant core: State Machine이 엔티티마다 최신 상태를 들고, Event Bus가 `state_changed` 사건을 낸다. 우리 `/world/state`(STATE)와 `/world/changes`(RELIABLE)가 같은 짝이다.
- Kafka log compaction: 열쇠마다 마지막 값만 남기는 상태 토픽과, 사건을 다 남기는 사건 토픽을 나눈다. 우리 STATE와 RELIABLE.
- Redis Streams: `XADD … MAXLEN N`(정확히)·`MAXLEN ~ N`(대략), consumer group `XGROUP CREATE … $ MKSTREAM`, `XREADGROUP`(`>` 새것, `0` 내 몫으로 남은 것), `XACK`, `XPENDING`, 자르기 `XTRIM MINID`. 영속은 `appendonly`·`save` 설정.

## 노드와 토픽

### 노드

| 노드 | 도메인 | 지금 코드 | 구독 | 발행 |
|---|---|---|---|---|
| `phone` 폰·화면 연결 | `src/phone` | 폰 서버, 대시보드 방송(`app.broadcast`), 대화(agent) | `/act/phone_command`, `/phone/claim`, `/world/state`, `/brain/decision`, `/brain/thought`, `/act/plan`, `/act/log`, `/device/state`, `/phone/say` | `/perception/frame`, `/phone/pose`, `/phone/progress`, `/phone/heard`, `/phone/link`, `/phone/owner`, `/phone/claim`(대화·말로 시킨 위험 가전 승인), `/device/command`(말로 시킨 가전) |
| `perception` 인식 | `src/observe` | `ObservePipeline`(YOLO·VLM·가까이 보기·위에서 보기) | `/perception/frame`, `/perception/look_request` | `/perception/detections`, `/perception/analysis`, `/perception/look_result` |
| `world` 집 상태 | `src/world` | `WorldState` | `/perception/detections`, `/perception/analysis`, `/perception/look_result`, `/phone/pose`, `/device/state`, `/world/input` | `/world/state`, `/world/changes` |
| `brain` 판단 | `src/brain` | `Decider`·Trigger·PAM, 계획 전 검사·계획 모드(묶음 4), 생각 메시지, 반성 | `/world/state`, `/world/changes`, `/act/status`, `/phone/heard`, `/brain/cancel`, `/device/state` | `/brain/decision`, `/brain/plan`, `/brain/thought`, `/brain/link` |
| `act` 실행 추적 | `src/act` | `ExecutionTracker`·`Looker`·`PlanHub`·승인 기억 | `/brain/plan`, `/world/state`, `/world/changes`, `/phone/progress`, `/phone/owner`, `/phone/link`, `/device/state`, `/device/result`, `/perception/look_result` | `/act/phone_command`, `/act/plan`, `/act/status`, `/act/log`, `/phone/claim`(계획 명령·보기·안전 안내·승인 질문), `/phone/say`, `/world/input`, `/perception/look_request`, `/device/command`, `/brain/cancel` |
| `devices` 가전 | `src/devices` | 허브 `signals`, 정책(위험 목록은 승인 토큰) | `/device/command` | `/device/state`, `/device/changes`, `/device/result` |
| `recorder` 기록 | `src/record`(새) | 기록 DB 쓰기(`attachRecorder`), 녹화 | 기록 DB 표의 토픽 + 녹화할 토픽 | `/bus/dead`만(자기 실패) |

### 토픽 표(`src/bus/topics.ts` 하나)

| 토픽 | QoS | 열쇠 | 순서 | 보내는 노드 | 담는 것 |
|---|---|---|---|---|---|
| `/perception/frame` | SENSOR depth 4 | `_` | `observed_ms` | phone | 엔진 프레임(`jpeg_b64`·자세·`observed_ms` 촬영 시각) |
| `/phone/pose` | SENSOR depth 600, 녹화 | `_` | `observed_ms` | phone | 맞춘 폰 눈 자리 |
| `/perception/detections` | SENSOR depth 600, 녹화 | `_` | `observed_ms` | perception | 프레임 하나의 YOLO 감지·관절·물체 모양 |
| `/perception/analysis` | RELIABLE | 원본 프레임 id | `observed_ms` | perception | 프레임 하나의 VLM 답(전체·잘라 본 것)과 분석 기록(`logs`, 기록 DB `vlm`·`yolo`) |
| `/perception/look_request` | RELIABLE | `req` | 없음 | act | 가까이 보기·위에서 보기 요청(`req`·대상·`since_ms`·`deadline_ms`) |
| `/perception/look_result` | RELIABLE | `req` | `observed_ms` | perception | 보기 결과(`req`·사진 근거 `observed_ms`) |
| `/world/input` | RELIABLE | 물건 id | 없음 | act | 보기 지킴 켜기·끄기, 따르기 창 켜기·끄기 |
| `/world/state` | STATE | `_` | `rev` | world | `{rev, view}` |
| `/world/changes` | RELIABLE | `_` | `rev` | world | `{rev, changes}`(기록 DB `detection`·`world`) |
| `/brain/decision` | RELIABLE | `_` | `stamp` | brain | 판단 기록(사용량 포함, 기록 DB `decision`·`pam_text`) |
| `/brain/plan` | RELIABLE | 판단 id | 없음 | brain(묶음 4 전에는 act) | 계획 모드가 만든 계획과 그 판단 |
| `/brain/thought` | RELIABLE | `_` | `stamp` | brain | 생각 말풍선 메시지 |
| `/brain/link` | STATE | `_` | `stamp` | brain | PAM 연결 오르내림 |
| `/brain/cancel` | RELIABLE | 판단 id | 없음 | act | 만드는 중인 계획 그만 |
| `/act/plan` | STATE | 계획 id | `stamp` | act | 계획 보기(`PlanView`) |
| `/act/status` | STATE | `_` | `stamp` | act | 기다리는 중·코치 중·이미 치운 물건·지금 계획 id |
| `/act/log` | RELIABLE | `_` | `stamp` | act | 실행 기록·피드백(기록 DB `execution`·`feedback`) |
| `/act/phone_command` | STATE | `_` | `stamp` | act | 지금 폰 명령(없으면 지움, `req` = 명령 id·단계) |
| `/phone/claim` | STATE | claim id | `stamp` | act, phone | 폰을 쓰고 싶음(claim id·종류·글) 또는 비움 |
| `/phone/owner` | STATE | `_` | `stamp` | phone | 지금 폰을 쓰는 claim id와 종류 |
| `/phone/progress` | RELIABLE | 명령 `req` | 없음 | phone | 「완료」·답 단추·「그만」·단계 영상 끝(`req`) |
| `/phone/heard` | RELIABLE | `_` | `observed_ms` | phone | 들은 말 |
| `/phone/say` | RELIABLE | `_` | 없음 | act, brain | 폰에서 소리로 읽을 말 |
| `/phone/link` | STATE | `_` | `stamp` | phone | 판본이 맞는 실제 폰이 붙었는가 |
| `/device/command` | RELIABLE | `command_id` | 없음 | act, phone | 가전 명령(`command_id`·`deadline_ms`, 위험 목록은 승인 토큰) |
| `/device/result` | RELIABLE | `command_id` | 없음 | devices | `done`·`failed`·`expired`·`unknown` |
| `/device/state` | STATE | 기기 id | `stamp` | devices | 기기 상태 |
| `/device/changes` | RELIABLE | 기기 id | `stamp` | devices | 기기 상태 바뀜(기록 DB `device`) |
| `/bus/dead` | RELIABLE | 토픽 | 없음 | 모든 노드 | 세 번 실패한 메시지와 까닭(기록 DB `bus_gap`) |

### 기록 DB 표(기록 노드가 쓰는 것, 반성이 읽는 종류)

| 기록 종류 | 반성 | 오는 토픽 | 읽는 법 |
|---|---|---|---|
| `vlm`, `yolo` | `DAY_KINDS`·분석 수 | `/perception/analysis`(`logs`) | RELIABLE 그룹, 쓴 뒤 ack |
| `detection`, `world` | `DAY_KINDS`·`HABIT_KINDS` | `/world/changes` | RELIABLE 그룹, 쓴 뒤 ack |
| `device` | 둘 다 | `/device/changes` | RELIABLE 그룹, 쓴 뒤 ack |
| `decision`, `pam_text` | 둘 다 | `/brain/decision` | RELIABLE 그룹, 쓴 뒤 ack |
| `execution`, `feedback` | 둘 다 | `/act/log` | RELIABLE 그룹, 쓴 뒤 ack |
| `link`, `trigger`, `look`, `reflection`, `mode`, `photo` | 아님 | `/brain/link`·`/brain/decision`·`/act/log` 등 | 같음 |
| `bus_gap` | 아님 | `/bus/dead`, 기록 노드 자신 | 잘려 놓친 SENSOR 수, 세 번 실패한 메시지 |
| (감지 모양은 지금처럼 기록 DB에 쓰지 않는다) | 아님 | `/perception/detections` | 녹화만, 커서로 다 읽음 |

### SENSOR 상한(놓친 수를 0으로 지키는 근거)

| 토픽 | 오는 빠르기 | 상한(MAXLEN) | 버티는 시간 | 기록 노드 처리 |
|---|---|---|---|---|
| `/perception/detections` | 엔진 프레임 10장/초(`ENGINE_FRAME_MS` 100) | 600 | 60초 | 녹화 한 줄 쓰기 1ms 안팎 → 초당 1,000줄 이상 |
| `/phone/pose` | 10번/초 | 600 | 60초 | 같음 |
| `/perception/frame` | 10장/초 | 4 | 0.4초 | 녹화하지 않음(사진) |

기록 노드가 60초 넘게 멈춘 때만 놓친다. 놓치면 머리 seq의 건너뜀으로 그 수를 1분마다 `bus_gap` 줄에 남긴다.

### 폰 사용권 표(`src/phone/owner.ts`)

| 차례 | 종류 | 내는 노드 | 지금 코드 |
|---|---|---|---|
| 1 | `safety` 안전 안내(끄기 안내·부탁) | act | `toPhone` 안 `policy.pause(grade === "safety")`, `sayAloud` |
| 2 | `approval` 승인 질문 | act(계획 승인), phone(말로 시킨 위험 가전) | `approvalsWaiting`, 승인 대기 카드 |
| 3 | `talk` 대화 | phone | `talking`(`TALK_QUIET_MS` 10초) |
| 4 | `plan` 계획 명령 | act | `toPhone` 명령 |
| 5 | `peek` 가까이 가서 보기 | act | 계획 밖 보기(`idlePeek`) |

높은 차례가 있으면 낮은 것은 화면에 나가지 않고 기다린다(지워지지 않는다). 같은 차례면 먼저 낸 claim이 앞선다. 승인 대기 시간은 그 claim이 화면에 있을 때만 흐른다.

---

## Global Constraints

- 무거운 일은 하나씩: 시험은 `npm run heavy -- <명령>`. 작은 시험 파일 하나는 빈 메모리 2.6GB까지, e2e·typecheck·전체 시험은 3GB 이상.
- Docker Desktop은 실제 Redis 시험 때만 켜고, 켜기 전 빈 메모리 2.6GB 이상, 끝나면 끈다. 실제 Redis 시험은 하나씩.
- 서버·PAM은 띄우지 않는다. 실제 모델은 부르지 않는다(가짜 서버만).
- force·amend·bare `git stash` 금지. 영어 커밋, attribution 없음. 내 파일만 경로로 `git add`.
- docs 저장소, `twin-home-split` worktree는 고치지 않는다.
- 저장소 규칙 표(`CLAUDE.md`)를 지킨다: 같은 구조(openai·vllm·MemoryBus·RedisBus가 같은 코드 경로), 도메인 경계, 사진은 PAM에 안 넘김·디스크에 안 씀, `headWithin`.
- 묶음마다 끝 조건: 데모 e2e 넷(`demo-e2e` 7, `noonchi-e2e` 2, `coach-e2e` 3, `cup-branches-e2e` 3) + 영상 모드 시험(`video-mode-e2e`, `video-real-e2e`, `video-mode-parity`, `ui/tests/phone-mode-parity.test.ts`) + 기록 DB 같음 시험(묶음 2부터) + typecheck + lint 통과. 실패 시험 먼저 → 구현 → 통과 → 커밋 → push → 해시 보고.

---

## File Structure (묶음 1)

| 파일 | 맡는 일 |
|---|---|
| `src/bus/topics.ts` | 노드 이름, QoS·순서 타입, 토픽 표(`TOPICS`, 표에 없으면 타입 오류), 토픽별 몸 모양(zod), 사진 칸 |
| `src/bus/header.ts` | 메시지 머리(zod), 봉투 `Envelope`, 직렬화·읽기, `frameBytes` |
| `src/bus/fresh.ts` | 낡은 메시지 보기(기동·집·순서 기준), 성공 뒤 확정 |
| `src/bus/pending.ts` | 요청 id 맞추기(`Pending`) |
| `src/bus/bus.ts` | `Bus`·`Subscription` 인터페이스, 놓친 수 세기, dead 몸 |
| `src/bus/memory.ts` | `MemoryBus` |
| `src/bus/redis.ts` | `RedisBus`(node-redis), 디스크 저장 확인 `assertNoPersistence` |
| `src/bus/node.ts` | `BusNode` 실행기(준비·시작, 콜백 하나씩, 타이머, 처리 뒤 ack, 끝내기, `withState`) |
| `src/bus/clock.ts` | 실제 시계·가상 시계(타이머 포함) |
| `src/bus/open.ts` | `openBus(env, o)`: `REDIS_URL`이면 `RedisBus`, 아니면 `MemoryBus` |
| `src/bus/index.ts` | 입구 |
| `src/record/bag.ts`, `src/record/history.ts`, `src/record/node.ts`, `src/record/replay.ts`, `src/record/index.ts` | 녹화(SQLite)·기록 DB 쓰기·격리 재생 |
| `src/brain/history/recorder.ts`, `src/brain/history/db.ts` | 기록 DB 줄 만들기를 `recordBrainLog`·`deviceRecorder`로 빼고, 처리표 `bus_seen`과 한 트랜잭션 쓰기 `once`를 더한다 |
| `scripts/lint-domains.ts` | `bus`·`record` 도메인, 의존 표 |
| `compose.dev.yaml` | 개발용 `redis`(`noonchi-redis`, `127.0.0.1:6379`, 디스크 저장 끔) |
| `compose.yaml` | AWS `redis` 서비스(디스크 저장 끔), noonchi `REDIS_URL` |
| `tests/helpers/bus-contract.ts` | 두 통로가 같이 통과하는 계약 시험 |
| `tests/bus-memory.test.ts`, `tests/bus-redis.test.ts`, `tests/bus-node.test.ts`, `tests/bus-topics.test.ts`, `tests/bus-persistence.test.ts`, `tests/record-bag.test.ts`, `tests/record-replay.test.ts` | 시험 |

---

## 묶음 1: 통로 · QoS 표 · 메시지 머리 · MemoryBus · RedisBus · 녹화

이 묶음은 새 코드만 더한다. 집 실행 묶음은 아직 통로를 쓰지 않는다(묶음 2부터). 그래서 데모 e2e는 그대로 통과해야 한다.

### Task 1: 토픽 표 · 메시지 머리 · 낡은 메시지 · 요청 id

**Files:**
- Create: `src/bus/topics.ts`, `src/bus/header.ts`, `src/bus/fresh.ts`, `src/bus/pending.ts`, `src/bus/index.ts`
- Modify: `scripts/lint-domains.ts`(`SERVER_DOMAINS`에 `bus`, `DEPS.bus = []`, 노드 도메인 `phone`·`observe`·`world`·`brain`·`act`·`devices`·`server`에 `bus`)
- Test: `tests/bus-topics.test.ts`

**Interfaces:**
- Produces: `NODES`, `type NodeName`, `type Qos = { kind: "sensor"; depth: number; record?: boolean } | { kind: "state" } | { kind: "reliable" }`, `type Order = "observed_ms" | "rev" | "stamp" | null`, `interface TopicSpec<B> { qos; body: z.ZodType<B>; key: (b: B) => string; order: Order; from: readonly NodeName[]; photo?: string }`, `TOPICS`, `type TopicName`, `type Body<N>`, `MAX_FRAME_B64 = 700_000`.
- Produces: `Header`(zod) `{ stamp: number; node: NodeName; inst: string; seq: number; boot: string; home: string }`, `msgId(h): string`(기동/집/노드/인스턴스/seq), `interface Envelope<N> { topic: N; key: string; header: Header; body: Body<N> }`, `encode(e): string`, `decode(topic, raw): Envelope`, `frameBytes(body): Buffer`.
- Produces: `class Freshness { constructor(epoch: () => { boot: string; home: string }); check(e): boolean; commit(e): void }`.
- Produces: `class Pending<T> { open(req, value): void; take(req): T | undefined; has(req): boolean; clear(): void; get size(): number }`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/bus-topics.test.ts`:

```ts
// 토픽 표·머리·낡은 메시지·요청 id. 토픽마다 QoS·순서 기준·보내는 노드가 있고, 사진은 SENSOR에만 base64로, 받는 쪽은 지난 기동·지난 집·옛 근거 시각을 버린다.
import { describe, expect, it } from "vitest";
import { Freshness, MAX_FRAME_B64, NODES, Pending, TOPICS, decode, encode, frameBytes, msgId, type Envelope } from "../src/bus/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const e = <N extends "/perception/analysis" | "/world/state">(topic: N, body: Record<string, unknown>, over: Partial<Envelope<N>["header"]> = {}, key = "_"): Envelope<N> =>
  ({ topic, key, header: { stamp: 1000, node: topic === "/world/state" ? "world" : "perception", inst: "i1", seq: 1, ...EPOCH, ...over }, body } as never);

describe("토픽 표", () => {
  it("토픽마다 QoS가 셋 가운데 하나이고 보내는 노드가 노드 목록 안이다", () => {
    for (const [name, t] of Object.entries(TOPICS)) {
      expect(["sensor", "state", "reliable"], name).toContain(t.qos.kind);
      if (t.qos.kind === "sensor") {
        expect(t.qos.depth, name).toBeGreaterThanOrEqual(1);
        expect(t.from, `${name}: SENSOR는 보내는 노드가 하나(놓친 수 기준 seq)`).toHaveLength(1);
      }
      for (const n of t.from) expect(NODES, name).toContain(n);
    }
  });

  it("사진 칸은 SENSOR 토픽에만 있고, 사진은 base64 글로 싣고 상한을 넘으면 거절한다", () => {
    for (const [name, t] of Object.entries(TOPICS)) if ("photo" in t && t.photo) expect(t.qos.kind, name).toBe("sensor");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const body = { jpeg_b64: jpeg.toString("base64"), width: 4, height: 3, observed_ms: 1 };
    expect(frameBytes(TOPICS["/perception/frame"].body.parse(body))).toEqual(jpeg);
    expect(() => TOPICS["/perception/frame"].body.parse({ ...body, jpeg_b64: "A".repeat(MAX_FRAME_B64 + 4) })).toThrow();
  });

  it("QoS가 없는 토픽은 타입 검사가 실패한다", () => {
    // @ts-expect-error qos가 없다
    const bad: (typeof TOPICS)["/world/state"] = { body: TOPICS["/world/state"].body, key: () => "_", order: "rev", from: ["world"] };
    expect(bad).toBeDefined();
  });

  it("메시지 식별자는 기동·집·노드·인스턴스·seq를 모두 담는다(노드를 다시 만들어 seq가 1로 돌아와도 겹치지 않는다)", () => {
    const a = e("/world/state", { rev: 1, view: {} }).header;
    expect(msgId(a)).not.toBe(msgId({ ...a, inst: "i2" }));
    expect(msgId(a)).not.toBe(msgId({ ...a, home: "h#2" }));
  });

  it("머리·몸은 JSON으로 오가고 모양이 틀리면 거절한다", () => {
    const one = e("/world/state", { rev: 1, view: {} });
    const raw = encode(one);
    expect(decode("/world/state", raw)).toEqual(one);
    expect(() => decode("/world/state", raw.replace('"node":"world"', '"node":"nobody"'))).toThrow();
    expect(() => decode("/world/state", raw.replace('"boot":"b1"', '"boot":""'))).toThrow();
  });
});

describe("낡은 메시지", () => {
  it("지난 기동·지난 집의 메시지는 버린다", () => {
    const f = new Freshness(() => EPOCH);
    expect(f.check(e("/world/state", { rev: 1, view: {} }, { boot: "b0" }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 1, view: {} }, { home: "h#0" }))).toBe(false);
  });

  it("observed_ms 순서 토픽은 옛 근거 시각을 버린다(늦게 끝난 옛 VLM 답). 확정은 성공 뒤에만 한다", () => {
    const f = new Freshness(() => EPOCH);
    const newer = e("/perception/analysis", { frame_id: "f2", observed_ms: 2000 }, { stamp: 2100 }, "f2");
    const older = e("/perception/analysis", { frame_id: "f2", observed_ms: 1000 }, { stamp: 2200, seq: 2 }, "f2");
    expect(f.check(newer)).toBe(true);
    expect(f.check(older)).toBe(true);
    f.commit(newer);
    expect(f.check(older)).toBe(false);
  });

  it("rev 순서 토픽은 옛 판본을 버린다", () => {
    const f = new Freshness(() => EPOCH);
    f.commit(e("/world/state", { rev: 5, view: {} }));
    expect(f.check(e("/world/state", { rev: 4, view: {} }, { stamp: 9999, seq: 9 }))).toBe(false);
    expect(f.check(e("/world/state", { rev: 6, view: {} }))).toBe(true);
  });

  it("같은 근거 시각에서 A 인스턴스 → B 인스턴스를 처리한 뒤 A의 이미 처리한 메시지가 다시 와도 버린다(인스턴스마다 처리한 seq를 기억)", () => {
    const f = new Freshness(() => EPOCH);
    const at = (inst: string, seq: number) => e("/perception/analysis", { frame_id: "f1", observed_ms: 1000 }, { inst, seq }, "f1");
    f.commit(at("A", 5));
    expect(f.check(at("B", 1))).toBe(true);
    f.commit(at("B", 1));
    expect(f.check(at("A", 5))).toBe(false);
    expect(f.check(at("A", 4))).toBe(false);
    expect(f.check(at("B", 1))).toBe(false);
    expect(f.check(at("A", 6))).toBe(true);
  });
});

describe("요청 id", () => {
  it("열어 둔 요청 id의 답만 받고, 한 번 받으면 닫힌다", () => {
    const p = new Pending<{ target: string }>();
    p.open("r1", { target: "cup_1" });
    expect(p.take("r0")).toBeUndefined();
    expect(p.take("r1")).toEqual({ target: "cup_1" });
    expect(p.take("r1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts`
Expected: FAIL(`src/bus/index.js`가 없다)

- [ ] **Step 3: `topics.ts`를 쓴다**

```ts
// 토픽 표(ROS 2 토픽·QoS처럼): 이름, QoS(SENSOR·STATE·RELIABLE), 몸 모양(zod), 열쇠, 순서 기준, 보내는 노드, 사진 칸.
// 토픽을 더할 때는 이 표 하나에 더한다. qos가 없으면 satisfies에서 타입 오류다. 사진(jpeg_b64)이 든 토픽은 SENSOR만.
// 몸 모양은 그 토픽을 옮기는 묶음에서 실제 모양으로 바꾼다(그 전에는 객체인지와 순서 칸만 본다).
import { z } from "zod";

export const NODES = ["phone", "perception", "world", "brain", "act", "devices", "recorder"] as const;
export type NodeName = (typeof NODES)[number];
export type Qos = { kind: "sensor"; depth: number; record?: boolean } | { kind: "state" } | { kind: "reliable" };
/** 낡음을 보는 기준: 근거 시각(observed_ms 칸), 상태 판본(rev 칸), 발행 시각(머리 stamp), 없음. */
export type Order = "observed_ms" | "rev" | "stamp" | null;
export interface TopicSpec<B = unknown> {
  qos: Qos;
  body: z.ZodType<B>;
  key: (b: B) => string;
  order: Order;
  from: readonly NodeName[];
  /** 사진 칸 이름(녹화에서 뺀다). SENSOR 토픽만. */
  photo?: string;
}

/** 사진 base64 글 상한(≈ 512KB JPEG). */
export const MAX_FRAME_B64 = 700_000;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const obj = z.looseObject({});
const observed = z.looseObject({ observed_ms: z.number().finite() });
const revved = z.looseObject({ rev: z.number().int().nonnegative() });
const frame = z.looseObject({
  jpeg_b64: z.string().max(MAX_FRAME_B64).regex(B64), width: z.number().int().positive(), height: z.number().int().positive(), observed_ms: z.number().finite(),
});
const one = () => "_";
const by = (k: string) => (b: Record<string, unknown>) => String(b[k] ?? "_");

export const TOPICS = {
  "/perception/frame": { qos: { kind: "sensor", depth: 4 }, body: frame, key: one, order: "observed_ms", from: ["phone"], photo: "jpeg_b64" },
  "/phone/pose": { qos: { kind: "sensor", depth: 600, record: true }, body: observed, key: one, order: "observed_ms", from: ["phone"] },
  "/perception/detections": { qos: { kind: "sensor", depth: 600, record: true }, body: observed, key: one, order: "observed_ms", from: ["perception"] },
  "/perception/analysis": { qos: { kind: "reliable" }, body: observed, key: by("frame_id"), order: "observed_ms", from: ["perception"] },
  "/perception/look_request": { qos: { kind: "reliable" }, body: obj, key: by("req"), order: null, from: ["act"] },
  "/perception/look_result": { qos: { kind: "reliable" }, body: observed, key: by("req"), order: "observed_ms", from: ["perception"] },
  "/world/input": { qos: { kind: "reliable" }, body: obj, key: by("id"), order: null, from: ["act"] },
  "/world/state": { qos: { kind: "state" }, body: revved, key: one, order: "rev", from: ["world"] },
  "/world/changes": { qos: { kind: "reliable" }, body: revved, key: one, order: "rev", from: ["world"] },
  "/brain/decision": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/plan": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), order: null, from: ["brain", "act"] },
  "/brain/thought": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/link": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/cancel": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), order: null, from: ["act"] },
  "/act/plan": { qos: { kind: "state" }, body: obj, key: by("id"), order: "stamp", from: ["act"] },
  "/act/status": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/act/log": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/act/phone_command": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/phone/claim": { qos: { kind: "state" }, body: obj, key: by("claim_id"), order: "stamp", from: ["act", "phone"] },
  "/phone/owner": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["phone"] },
  "/phone/progress": { qos: { kind: "reliable" }, body: obj, key: by("req"), order: null, from: ["phone"] },
  "/phone/heard": { qos: { kind: "reliable" }, body: observed, key: one, order: "observed_ms", from: ["phone"] },
  "/phone/say": { qos: { kind: "reliable" }, body: obj, key: one, order: null, from: ["act", "brain"] },
  "/phone/link": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["phone"] },
  "/device/command": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), deadline_ms: z.number().finite() }), key: by("command_id"), order: null, from: ["act", "phone"] },
  "/device/result": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), status: z.enum(["done", "failed", "expired", "unknown"]) }), key: by("command_id"), order: null, from: ["devices"] },
  "/device/state": { qos: { kind: "state" }, body: obj, key: by("id"), order: "stamp", from: ["devices"] },
  "/device/changes": { qos: { kind: "reliable" }, body: obj, key: by("id"), order: "stamp", from: ["devices"] },
  "/bus/dead": { qos: { kind: "reliable" }, body: obj, key: by("topic"), order: null, from: NODES },
} as const satisfies Record<string, TopicSpec<Record<string, unknown>>>;

export type TopicName = keyof typeof TOPICS;
export type Body<N extends TopicName> = z.infer<(typeof TOPICS)[N]["body"]>;
```

- [ ] **Step 4: `header.ts`·`fresh.ts`·`pending.ts`·`index.ts`를 쓴다**

```ts
// header.ts — 메시지 머리(ROS 2 std_msgs/Header처럼): stamp(발행 시각 ms), node(보낸 노드), inst(보낸 노드 인스턴스: 노드 객체마다 새 값),
// seq(인스턴스·토픽마다 1부터), boot(기동), home(집). 메시지 식별자 msgId는 이 다섯으로 만든다.
// 근거 시각은 몸의 observed_ms다(머리 stamp는 발행 시각). 사진은 jpeg_b64로 싣고 frameBytes로 되살린다.
import { z } from "zod";
import { NODES, TOPICS, type Body, type TopicName } from "./topics.js";

export const Header = z.strictObject({
  stamp: z.number().finite(), node: z.enum(NODES), inst: z.string().min(1), seq: z.number().int().nonnegative(), boot: z.string().min(1), home: z.string().min(1),
});
export type Header = z.infer<typeof Header>;
export interface Envelope<N extends TopicName> { topic: N; key: string; header: Header; body: Body<N> }

/** 메시지 식별자: 기동/집/노드/인스턴스/seq. 중복 판정(처리표·녹화)이 쓴다. */
export const msgId = (h: Header): string => `${h.boot}/${h.home}/${h.node}/${h.inst}/${h.seq}`;

export function encode<N extends TopicName>(e: Envelope<N>): string {
  return JSON.stringify({ key: e.key, header: e.header, body: e.body });
}

export function decode<N extends TopicName>(topic: N, raw: string): Envelope<N> {
  const v = z.strictObject({ key: z.string(), header: Header, body: TOPICS[topic].body }).parse(JSON.parse(raw));
  return { topic, key: v.key, header: v.header, body: v.body as Body<N> };
}

/** /perception/frame 몸의 사진 바이트. */
export const frameBytes = (body: { jpeg_b64: string }): Buffer => Buffer.from(body.jpeg_b64, "base64");
```

```ts
// fresh.ts — 낡은 메시지 보기(받는 쪽 한곳): 지금 기동·집이 아니면 버린다. 순서 기준(토픽 표 order)이 있으면 (토픽, 열쇠)마다
// 확정한 가장 큰 근거 값(근거 시각·판본·발행 시각)보다 옛것을 버린다. 같은 근거 값이면 보낸 노드 인스턴스마다 확정한 seq를 기억해
// 그 인스턴스의 이미 처리한 seq를 버린다(다른 인스턴스를 처리한 뒤에도). 더 큰 근거 값을 확정하면 인스턴스 기억은 새로 시작한다.
// 확정(commit)은 처리가 성공한 뒤에만 한다.
import type { Envelope } from "./header.js";
import { TOPICS, type TopicName } from "./topics.js";

/** (토픽, 열쇠)마다: 확정한 가장 큰 근거 값과, 그 값에서 인스턴스마다 확정한 가장 큰 seq. */
type Mark = { at: number; seqs: Map<string, number> };
const SEP = "|";

export class Freshness {
  readonly #last = new Map<string, Mark>();
  constructor(private readonly epoch: () => { boot: string; home: string }) {}

  #at(e: Envelope<TopicName>): number | null {
    const order = TOPICS[e.topic].order;
    if (order === null) return null;
    return order === "stamp" ? e.header.stamp : Number((e.body as Record<string, unknown>)[order]);
  }

  check(e: Envelope<TopicName>): boolean {
    const now = this.epoch();
    if (e.header.boot !== now.boot || e.header.home !== now.home) return false;
    const at = this.#at(e);
    const p = at === null ? undefined : this.#last.get(e.topic + SEP + e.key);
    if (at === null || !p) return true;
    if (at !== p.at) return at > p.at;
    const seen = p.seqs.get(e.header.node + SEP + e.header.inst);
    return seen === undefined || e.header.seq > seen;
  }

  commit(e: Envelope<TopicName>): void {
    const at = this.#at(e);
    if (at === null) return;
    const k = e.topic + SEP + e.key;
    const p = this.#last.get(k);
    if (p && at < p.at) return;
    const mark = p && at === p.at ? p : { at, seqs: new Map<string, number>() };
    const who = e.header.node + SEP + e.header.inst;
    mark.seqs.set(who, Math.max(mark.seqs.get(who) ?? 0, e.header.seq));
    this.#last.set(k, mark);
  }
}
```

```ts
// pending.ts — 요청 id 맞추기: 요청을 낼 때 열고, 답의 req가 열린 것일 때만 받는다(늦은 답·모르는 답은 버린다).
// 다른 요청끼리 세대 숫자를 견주지 않는다.
export class Pending<T> {
  readonly #open = new Map<string, T>();
  open(req: string, value: T): void { this.#open.set(req, value); }
  take(req: string): T | undefined {
    const v = this.#open.get(req);
    this.#open.delete(req);
    return v;
  }
  has(req: string): boolean { return this.#open.has(req); }
  clear(): void { this.#open.clear(); }
  get size(): number { return this.#open.size; }
}
```

```ts
// index.ts — 통로(ROS 2 rmw·토픽·실행기처럼). 노드는 이 입구로만 가져온다.
export { Freshness } from "./fresh.js";
export { Header, decode, encode, frameBytes, msgId, type Envelope } from "./header.js";
export { Pending } from "./pending.js";
export { MAX_FRAME_B64, NODES, TOPICS, type Body, type NodeName, type Order, type Qos, type TopicName, type TopicSpec } from "./topics.js";
```

`scripts/lint-domains.ts`: `SERVER_DOMAINS`에 `"bus"`, `DEPS.bus = []`, `phone`·`observe`·`world`·`brain`·`act`·`devices`·`server` 줄에 `"bus"`.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts tests/domain-boundaries.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋·push**

```bash
git add src/bus scripts/lint-domains.ts tests/bus-topics.test.ts
git commit -m "feat(bus): add the topic table with QoS and order keys, the boot and home header, the stale filter and request matching"
git push
```

### Task 2: 실행기 `BusNode` · `MemoryBus` · 통로 계약 시험

**Files:**
- Create: `src/bus/bus.ts`, `src/bus/memory.ts`, `src/bus/node.ts`, `src/bus/clock.ts`(`src/bus/open.ts`는 `redis.ts`를 가져오므로 Task 3에서 만든다)
- Create: `tests/helpers/bus-contract.ts`
- Test: `tests/bus-memory.test.ts`, `tests/bus-node.test.ts`

**Interfaces:**
- Consumes: Task 1 전부.
- Produces(`bus.ts`): `MAX_DELIVERIES = 3`, `RETRY_MS = 100`, `type Outcome = "ack" | "retry"`, `type Deliver<N> = (e: Envelope<N>) => Promise<Outcome>`, `interface Subscription { start(): void; stop(): Promise<void>; lost(): number }`, `interface Bus { publish<N>(e): Promise<void>; subscribe<N>(topic, node, deliver, o?: { mode?: "latest" | "all" }): Promise<Subscription>; close(): Promise<void> }`, `gapCounter(base?: Envelope)`(보낸 노드 인스턴스마다 seq 건너뜀, 처음 보는 인스턴스는 seq 0부터), `deadBody(topic, group, raw, deliveries)`. `subscribe`는 그룹·커서를 만들기만 하고(준비) `start()` 뒤에 배달한다. RELIABLE은 `"ack"`일 때만 ack하고, `"retry"`면 `RETRY_MS` 뒤 같은 메시지를 다시 주며 그동안 뒤 메시지를 주지 않는다(한 구독 안에서 `MAX_DELIVERIES`번 넘으면 `/bus/dead`에 남기고 ack, `/bus/dead` 자체의 실패는 log만). `mode: "all"`은 SENSOR를 같은 상한의 기록에서 커서로 차례로 준다(기록 노드, 준비 때 가장 새 seq가 놓친 수 기준).
- Produces(`clock.ts`): `interface Clock { now(): number; every(ms, fn): () => void }`, `realClock`, `class VirtualClock implements Clock { constructor(start?: number); set(ms): void; advanceTo(ms, settle?: () => Promise<void>): Promise<void> }`(타이머 하나를 부를 때마다 `settle`을 기다린다).
- Produces(`memory.ts`): `class MemoryBus implements Bus { constructor(warn?); quiet(): boolean; length(topic): number }`(`quiet`: 예약된 배달이 없다).
- Produces(`node.ts`): `class BusNode { constructor(o: { name; bus; epoch: { boot; home }; clock?; log? }); on<N>(topic, cb: (body, ctx: { e; signal: AbortSignal; defer(): (ok: boolean) => void }) => void | Promise<void>, o?: { mode? }): void; withState<C, S>(changes: C, state: S, cb: (change, latest, ctx) => void | Promise<void>): void; every(ms, cb): void; publish<N>(topic, body): Promise<void>; spawn<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T>; post(fn: (signal) => void | Promise<void>): void; prepare(): Promise<void>; start(): void; stop(): Promise<void>; idle(): Promise<void>; busy(): boolean; lost(topic): number }`.
- Produces(`open.ts`): `openBus(env, o: { boot: string; log?; onLost: (err: Error) => void }): Promise<Bus>`(`onLost`는 꼭 넘긴다).

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/helpers/bus-contract.ts`(두 통로가 함께 쓰는 계약):

```ts
// 통로 계약(MemoryBus·RedisBus가 같은 시험을 통과한다): 준비·시작 두 단계, QoS 셋, SENSOR 상한·놓친 수,
// 처리 뒤 ack·차례를 지키며 다시 주기·dead(dead의 실패는 다시 보내지 않음), 끊긴 뒤 다시 받기, publish 안에서 동기로 부르지 않음.
import { describe, expect, it } from "vitest";
import { RETRY_MS, type Bus, type Envelope, type Outcome, type TopicName } from "../../src/bus/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const env = <N extends TopicName>(topic: N, body: Record<string, unknown>, seq: number, key = "_", node = "world"): Envelope<N> =>
  ({ topic, key, header: { stamp: 1000 + seq, node, inst: "i1", seq, ...EPOCH }, body } as never);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("기다림 초과");
    await pause(10);
  }
};

export function busContract(name: string, make: () => Promise<Bus>, opts: { length: (b: Bus, topic: string) => Promise<number> }) {
  describe(`${name} 통로 계약`, () => {
    it("준비만 한 구독은 배달하지 않고, 시작한 뒤에 준비 이후 것부터 준다(RELIABLE)", async () => {
      const bus = await make();
      const got: number[] = [];
      const sub = await bus.subscribe("/world/changes", "brain", async (m) => { got.push(m.body.rev as number); return "ack"; });
      await bus.publish(env("/world/changes", { rev: 1 }, 1));
      await pause(100);
      expect(got).toEqual([]);
      sub.start();
      await until(() => got.includes(1));
      await bus.close();
    });

    it("SENSOR latest: 늦게 붙으면 옛것을 받지 않고, 밀린 것 가운데 가장 새 것을 받는다", async () => {
      const bus = await make();
      for (let i = 1; i <= 50; i++) await bus.publish(env("/phone/pose", { observed_ms: i }, i, "_", "phone"));
      const got: number[] = [];
      const sub = await bus.subscribe("/phone/pose", "world", async (m) => { got.push(m.body.observed_ms as number); await pause(30); return "ack"; });
      sub.start();
      for (let i = 51; i <= 60; i++) await bus.publish(env("/phone/pose", { observed_ms: i }, i, "_", "phone"));
      await until(() => got.includes(60));
      expect(got.every((x) => x > 50)).toBe(true);
      expect(got.length).toBeLessThan(10);
      await bus.close();
    });

    it("SENSOR all(기록 커서): 준비 이후 것을 차례로 다 주고, 놓친 수는 0이다", async () => {
      const bus = await make();
      const got: number[] = [];
      const sub = await bus.subscribe("/perception/detections", "recorder", async (m) => { got.push(m.header.seq); return "ack"; }, { mode: "all" });
      for (let i = 1; i <= 20; i++) await bus.publish(env("/perception/detections", { observed_ms: i }, i, "_", "perception"));
      sub.start();
      await until(() => got.length === 20);
      expect(got).toEqual(Array.from({ length: 20 }, (_, k) => k + 1));
      expect(sub.lost()).toBe(0);
      await bus.close();
    });

    it("SENSOR all: 상한(depth 600)을 넘으면 앞을 잃고 그 수를 센다. 준비 때 가장 새 seq가 기준이라 첫 수신 전에 잘린 것도 센다", async () => {
      const bus = await make();
      const det = (seq: number) => env("/perception/detections", { observed_ms: seq }, seq, "_", "perception");
      for (let i = 1; i <= 5; i++) await bus.publish(det(i));
      const got: number[] = [];
      const sub = await bus.subscribe("/perception/detections", "recorder", async (m) => { got.push(m.header.seq); return "ack"; }, { mode: "all" });
      for (let i = 6; i <= 705; i++) await bus.publish(det(i));
      expect(await opts.length(bus, "/perception/detections")).toBe(600);
      sub.start();
      await until(() => got.at(-1) === 705, 10_000);
      expect(got).toEqual(Array.from({ length: 600 }, (_, k) => k + 106));
      expect(sub.lost()).toBe(100);
      await bus.close();
    });

    it("STATE: 늦게 붙어도 열쇠마다 최신 값을 바로 받고, 그 뒤 값도 받는다", async () => {
      const bus = await make();
      await bus.publish(env("/device/state", { id: "a", on: 1 }, 1, "a", "devices"));
      await bus.publish(env("/device/state", { id: "a", on: 2 }, 2, "a", "devices"));
      await bus.publish(env("/device/state", { id: "b", on: 1 }, 3, "b", "devices"));
      const got: string[] = [];
      const sub = await bus.subscribe("/device/state", "world", async (m) => { got.push(`${m.key}${m.body.on}`); return "ack"; });
      sub.start();
      await until(() => got.length >= 2);
      expect(got.sort()).toEqual(["a2", "b1"]);
      await bus.publish(env("/device/state", { id: "a", on: 3 }, 4, "a", "devices"));
      await until(() => got.includes("a3"));
      await bus.close();
    });

    it("RELIABLE: 그룹마다 모두 차례대로 받고, 모두 ack하면 잘린다", async () => {
      const bus = await make();
      const a: number[] = [];
      const b: number[] = [];
      const sa = await bus.subscribe("/world/changes", "brain", async (m) => { a.push(m.body.rev as number); return "ack"; });
      const sb = await bus.subscribe("/world/changes", "act", async (m) => { await pause(5); b.push(m.body.rev as number); return "ack"; });
      sa.start();
      sb.start();
      for (let i = 1; i <= 30; i++) await bus.publish(env("/world/changes", { rev: i }, i));
      await until(() => a.length === 30 && b.length === 30);
      expect(a).toEqual(Array.from({ length: 30 }, (_, k) => k + 1));
      expect(b).toEqual(a);
      await until(async () => (await opts.length(bus, "/world/changes")) === 0);
      await bus.close();
    });

    it("RELIABLE: 앞 메시지가 성공하거나 dead가 되기 전에는 뒤 메시지를 주지 않는다", async () => {
      const bus = await make();
      const seen: string[] = [];
      let fails = 2;
      const s = await bus.subscribe("/world/changes", "act", async (m) => {
        const rev = m.body.rev as number;
        if (rev === 1 && fails-- > 0) { seen.push("1 실패"); return "retry"; }
        seen.push(`${rev} 성공`);
        return "ack";
      });
      s.start();
      await bus.publish(env("/world/changes", { rev: 1 }, 1));
      await bus.publish(env("/world/changes", { rev: 2 }, 2));
      await until(() => seen.includes("2 성공"), 5000);
      expect(seen).toEqual(["1 실패", "1 실패", "1 성공", "2 성공"]);
      await bus.close();
    });

    it("RELIABLE: 세 번 실패하면 /bus/dead에 남기고 ack한 뒤 다음으로 간다", async () => {
      const bus = await make();
      const tries: number[] = [];
      const dead: Record<string, unknown>[] = [];
      const sd = await bus.subscribe("/bus/dead", "recorder", async (m) => { dead.push(m.body); return "ack"; });
      const s = await bus.subscribe("/world/changes", "act", async (m) => { tries.push(m.body.rev as number); return m.body.rev === 1 ? "retry" : "ack"; });
      sd.start();
      s.start();
      await bus.publish(env("/world/changes", { rev: 1 }, 1));
      await bus.publish(env("/world/changes", { rev: 2 }, 2));
      await until(() => dead.length === 1 && tries.includes(2), 10_000);
      expect(tries).toEqual([1, 1, 1, 2]);
      expect(dead[0]).toMatchObject({ topic: "/world/changes", group: "act", deliveries: 3 });
      await bus.close();
    });

    it("/bus/dead 처리가 실패해도 dead를 다시 dead로 보내지 않는다", async () => {
      const bus = await make();
      let tries = 0;
      const sd = await bus.subscribe("/bus/dead", "recorder", async () => { tries++; return "retry"; });
      sd.start();
      await bus.publish(env("/bus/dead", { topic: "/world/changes" }, 1, "/world/changes", "act"));
      await until(() => tries === 3, 5000);
      await pause(500);
      expect(tries).toBe(3);
      expect(await opts.length(bus, "/bus/dead")).toBe(0);
      await bus.close();
    });

    it("RELIABLE: 처리를 끝내지 못하고 끊긴 메시지는 같은 그룹이 다시 붙으면 차례대로 다시 받는다(같은 기동 안)", async () => {
      const bus = await make();
      const s1 = await bus.subscribe("/world/changes", "act", () => new Promise<Outcome>(() => {}));
      s1.start();
      await bus.publish(env("/world/changes", { rev: 1 }, 1));
      await bus.publish(env("/world/changes", { rev: 2 }, 2));
      await pause(100);
      await s1.stop();
      const got: number[] = [];
      const s2 = await bus.subscribe("/world/changes", "act", async (m) => { got.push(m.body.rev as number); return "ack"; });
      s2.start();
      await until(() => got.length === 2, 5000);
      expect(got).toEqual([1, 2]);
      await bus.close();
    });

    it("publish는 받는 쪽 콜백을 그 호출 안에서(동기로) 부르지 않는다", async () => {
      const bus = await make();
      let inside = false;
      let sawInside = false;
      const s = await bus.subscribe("/world/changes", "act", async () => { sawInside ||= inside; return "ack"; });
      s.start();
      inside = true;
      const sent = bus.publish(env("/world/changes", { rev: 1 }, 1));
      inside = false;
      await sent;
      await until(async () => (await opts.length(bus, "/world/changes")) === 0);
      expect(sawInside).toBe(false);
      await bus.close();
    });

    it("RELIABLE: 다시 주기를 기다리는 동안 새 메시지가 와도 RETRY_MS 전에는 다시 주지 않는다", async () => {
      const bus = await make();
      const at: number[] = [];
      const s = await bus.subscribe("/world/changes", "act", async (m) => {
        if (m.body.rev !== 1) return "ack";
        at.push(Date.now());
        return at.length === 1 ? "retry" : "ack";
      });
      s.start();
      await bus.publish(env("/world/changes", { rev: 1 }, 1));
      await until(() => at.length === 1);
      await bus.publish(env("/world/changes", { rev: 2 }, 2));
      await until(() => at.length === 2, 5000);
      expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(RETRY_MS - 5);
      await bus.close();
    });

    it("닫은 뒤에는 발행·구독을 거절한다", async () => {
      const bus = await make();
      await bus.close();
      await expect(bus.publish(env("/world/changes", { rev: 1 }, 1))).rejects.toThrow(/닫힌 통로/);
      await expect(bus.subscribe("/world/changes", "act", async () => "ack")).rejects.toThrow(/닫힌 통로/);
    });
  });
}
```

`tests/bus-memory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Envelope, TopicName } from "../src/bus/index.js";
import { MemoryBus } from "../src/bus/memory.js";
import { busContract } from "./helpers/bus-contract.js";

busContract("MemoryBus", async () => new MemoryBus({ warn: () => {} }), { length: async (b, t) => (b as MemoryBus).length(t) });

const EPOCH = { boot: "b1", home: "h#1" };
const env = <N extends TopicName>(topic: N, body: Record<string, unknown>, seq: number, node = "world"): Envelope<N> =>
  ({ topic, key: "_", header: { stamp: seq, node, inst: "i1", seq, ...EPOCH }, body } as never);
const until = async (f: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("기다림 초과"); await new Promise((r) => setTimeout(r, 10)); } };

describe("MemoryBus", () => {
  it("닫은 뒤에는 예약된 배달이 돌지 않고, 발행·구독을 거절한다", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    const got: number[] = [];
    const s = await bus.subscribe("/phone/pose", "world", async (m) => { got.push(m.body.observed_ms as number); return "ack"; });
    s.start();
    await bus.publish(env("/phone/pose", { observed_ms: 1 }, 1, "phone"));
    await bus.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([]);
    await expect(bus.publish(env("/phone/pose", { observed_ms: 2 }, 2, "phone"))).rejects.toThrow(/닫힌 통로/);
    await expect(bus.subscribe("/phone/pose", "world", async () => "ack")).rejects.toThrow(/닫힌 통로/);
  });

  it("받는 쪽이 거절(reject)해도 다시 주기로 처리하고 줄이 멈추지 않는다", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    let calls = 0;
    const got: number[] = [];
    const s = await bus.subscribe("/world/changes", "act", async (m) => {
      calls++;
      if (calls === 1) throw new Error("받는 쪽 거절");
      got.push(m.body.rev as number);
      return "ack";
    });
    s.start();
    await bus.publish(env("/world/changes", { rev: 1 }, 1));
    await bus.publish(env("/world/changes", { rev: 2 }, 2));
    await until(() => got.length === 2);
    expect(got).toEqual([1, 2]);
    await bus.close();
  });
});
```

`tests/bus-node.test.ts`:

```ts
// 실행기(ROS 2 single-threaded executor처럼): 준비·시작 두 단계, 같은 노드의 콜백은 겹치지 않음, 콜백 안 발행은 콜백이 끝난 뒤,
// 처리 성공 뒤에만 ack·Freshness 확정, 상태를 기다리는 변화는 처리한 뒤 ack, 동기 예외에도 줄이 멈추지 않음,
// 끝내기 계약(돌던 콜백·spawn한 일 취소와 대기), 가상 시계는 타이머 일이 끝난 뒤 간다.
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, VirtualClock, type Bus } from "../src/bus/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const node = (name: ConstructorParameters<typeof BusNode>[0]["name"], bus: MemoryBus, clock?: VirtualClock) => new BusNode({ name, bus, epoch: EPOCH, clock, log: () => {} });

describe("BusNode 실행기", () => {
  it("모든 노드를 준비한 뒤 시작하면, 먼저 시작한 노드의 첫 발행도 잃지 않는다", async () => {
    const bus = new MemoryBus();
    const w = node("world", bus);
    const a = node("act", bus);
    const got: number[] = [];
    let sent = false;
    w.every(5, async () => { if (!sent) { sent = true; await w.publish("/world/changes", { rev: 1, changes: [] }); } });
    a.on("/world/changes", (b) => { got.push(b.rev as number); });
    await w.prepare();
    await a.prepare();
    w.start();
    await tick(50);
    a.start();
    await tick(50);
    expect(got).toEqual([1]);
    await w.stop();
    await a.stop();
  });

  it("같은 노드의 메시지 콜백과 타이머 콜백이 겹치지 않는다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let running = 0;
    let overlap = false;
    const work = async () => { running++; overlap ||= running > 1; await tick(); running--; };
    n.on("/world/changes", work);
    n.every(5, work);
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    for (let i = 0; i < 5; i++) await w.publish("/world/changes", { rev: i + 1, changes: [] });
    await tick(200);
    await n.stop();
    expect(overlap).toBe(false);
  });

  it("콜백 안에서 발행한 메시지는 그 콜백이 끝난 뒤에 처리된다(자기 구독도)", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const order: string[] = [];
    n.on("/act/log", () => { order.push("log"); });
    n.on("/world/changes", async () => { await n.publish("/act/log", { a: 1 }); order.push("changes-end"); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await n.idle();
    expect(order).toEqual(["changes-end", "log"]);
  });

  it("콜백이 던지면 ack하지 않아 다시 받고, Freshness는 성공한 것만 확정한다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let calls = 0;
    n.on("/world/changes", () => { calls++; if (calls === 1) throw new Error("처음 한 번 실패"); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(300);
    expect(calls).toBe(2);
  });

  it("타이머 콜백이 동기로 던져도 줄이 멈추지 않는다", async () => {
    const clock = new VirtualClock(0);
    const n = node("act", new MemoryBus(), clock);
    const ran: number[] = [];
    n.every(100, () => { ran.push(clock.now()); if (ran.length === 1) throw new Error("동기 예외"); });
    await n.prepare();
    n.start();
    await clock.advanceTo(300, () => n.idle());
    expect(ran).toEqual([100, 200, 300]);
  });

  it("지난 기동·지난 집의 메시지는 콜백에 오지 않는다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const got: number[] = [];
    n.on("/world/changes", (b) => { got.push(b.rev as number); });
    await n.prepare();
    n.start();
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: "b0", home: "h#1" }, body: { rev: 1, changes: [] } } as never);
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 2, node: "world", inst: "i1", seq: 2, boot: "b1", home: "h#0" }, body: { rev: 2, changes: [] } } as never);
    await tick(50);
    expect(got).toEqual([]);
  });

  it("끝내기: 돌던 콜백에 취소 신호를 주고 끝나길 기다리며, 닫힌 뒤 발행은 거절된다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    let cancelled = false;
    n.on("/world/changes", (_b, ctx) => new Promise<void>((r) => ctx.signal.addEventListener("abort", () => { cancelled = true; r(); })));
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await n.stop();
    expect(cancelled).toBe(true);
    await expect(n.publish("/act/log", { a: 1 })).rejects.toThrow(/닫힌 노드/);
  });

  it("끝내기: spawn한 긴 일(LLM 호출)도 끊고 끝나길 기다리며, 그 뒤 post는 버린다", async () => {
    const n = node("brain", new MemoryBus());
    await n.prepare();
    n.start();
    let cut = false;
    let posted = false;
    const job = n.spawn((signal) => new Promise<string>((_ok, no) => signal.addEventListener("abort", () => { cut = true; no(signal.reason); })))
      .catch(() => n.post(() => { posted = true; }));
    await n.stop();
    expect(cut).toBe(true);
    await job;
    await tick();
    expect(posted).toBe(false);
    await expect(n.spawn(async () => 1)).rejects.toThrow(/닫힌 노드/);
  });

  it("변화는 그 판본 이상의 상태를 가진 뒤에 처리한다", async () => {
    const bus = new MemoryBus();
    const n = node("act", bus);
    const seen: [number, number][] = [];
    n.withState("/world/changes", "/world/state", (change, state) => { seen.push([change.rev as number, state.rev as number]); });
    const w = node("world", bus);
    await n.prepare();
    await w.prepare();
    n.start();
    w.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    expect(seen).toEqual([]);
    await w.publish("/world/state", { rev: 1, view: {} });
    await tick(50);
    expect(seen).toEqual([[1, 1]]);
  });

  it("상태를 기다리는 변화는 처리한 뒤에 ack한다: 그 전에 노드를 끝내면 다시 띄운 노드가 다시 받는다", async () => {
    const bus = new MemoryBus();
    const w = node("world", bus);
    await w.prepare();
    w.start();
    const a1 = node("act", bus);
    const seen1: number[] = [];
    a1.withState("/world/changes", "/world/state", (c) => { seen1.push(c.rev as number); });
    await a1.prepare();
    a1.start();
    await w.publish("/world/changes", { rev: 1, changes: [] });
    await tick(50);
    await a1.stop();
    expect(seen1).toEqual([]);
    expect(bus.length("/world/changes")).toBe(1);
    const a2 = node("act", bus);
    const seen2: [number, number][] = [];
    a2.withState("/world/changes", "/world/state", (c, s) => { seen2.push([c.rev as number, s.rev as number]); });
    await a2.prepare();
    a2.start();
    await w.publish("/world/state", { rev: 1, view: {} });
    await tick(100);
    expect(seen2).toEqual([[1, 1]]);
    expect(bus.length("/world/changes")).toBe(0);
  });

  it("보내는 노드가 아닌 노드가 발행하면 거절된다", async () => {
    const n = node("brain", new MemoryBus());
    await expect(n.publish("/world/state", { rev: 1 })).rejects.toThrow(/world/);
  });

  it("가상 시계: 타이머마다 그 일(비동기 포함)이 끝난 뒤에 다음 시각으로 간다", async () => {
    const clock = new VirtualClock(0);
    const n = node("act", new MemoryBus(), clock);
    const log: string[] = [];
    n.every(250, async () => { const at = clock.now(); log.push(`시작 ${at}`); await tick(10); log.push(`끝 ${at}@${clock.now()}`); });
    await n.prepare();
    n.start();
    await clock.advanceTo(750, () => n.idle());
    expect(log).toEqual(["시작 250", "끝 250@250", "시작 500", "끝 500@500", "시작 750", "끝 750@750"]);
  });

  it("통로가 발행에 답하지 않으면(끊김) 발행은 시간 제한으로 실패하고, 끝내기는 기다리는 발행을 끊는다", async () => {
    const stuck: Bus = { publish: () => new Promise<void>(() => {}), subscribe: async () => ({ start() {}, stop: async () => {}, lost: () => 0 }), close: async () => {} };
    const quick = new BusNode({ name: "act", bus: stuck, epoch: EPOCH, log: () => {}, publishTimeoutMs: 50 });
    await expect(quick.publish("/act/log", { a: 1 })).rejects.toThrow(/50ms/);
    const clock = new VirtualClock(0);
    const n = new BusNode({ name: "act", bus: stuck, epoch: EPOCH, clock, log: () => {} });
    let failed: unknown = null;
    n.every(100, async () => { try { await n.publish("/act/log", { a: 2 }); } catch (e) { failed = e; throw e; } });
    await n.prepare();
    n.start();
    void clock.advanceTo(100);
    await tick(30);
    const t0 = Date.now();
    await n.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(failed).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-memory.test.ts tests/bus-node.test.ts`
Expected: FAIL(`MemoryBus`·`BusNode`가 없다)

- [ ] **Step 3: `bus.ts`·`clock.ts`를 쓴다**

```ts
// bus.ts — 통로 인터페이스(ROS 2 rmw처럼). MemoryBus(시험·개발)와 RedisBus(실제)가 같은 계약(tests/helpers/bus-contract.ts)을 따른다.
// subscribe는 그룹·커서를 만들기만 하고 start() 뒤에 배달한다. publish는 받는 쪽 콜백을 그 호출 안에서 부르지 않는다.
// RELIABLE은 deliver가 "ack"일 때만 ack한다. "retry"면 RETRY_MS 뒤 같은 메시지를 다시 주고, 그동안 같은 토픽·그룹의 뒤 메시지는 주지 않는다.
// 한 구독 안에서 MAX_DELIVERIES번 실패하면 /bus/dead에 남기고 ack한 뒤 다음으로 간다. /bus/dead 자체의 실패는 다시 보내지 않고 log만 남긴다.
import type { Envelope } from "./header.js";
import type { NodeName, TopicName } from "./topics.js";

export const MAX_DELIVERIES = 3;
export const RETRY_MS = 100;
/** 닫은 통로에 발행·구독하면 이 글로 거절한다. */
export const CLOSED = "닫힌 통로예요";
export type Outcome = "ack" | "retry";
export type Deliver<N extends TopicName> = (e: Envelope<N>) => Promise<Outcome>;
export interface Subscription {
  start(): void;
  /** 끊는다. 처리 중이던 RELIABLE은 ack하지 않는다(다시 붙은 같은 그룹이 차례대로 다시 받는다). */
  stop(): Promise<void>;
  /** mode "all"에서 잘려 놓친 수(보낸 노드 seq의 건너뜀, 준비 때 기준부터). */
  lost(): number;
}
export interface Bus {
  publish<N extends TopicName>(e: Envelope<N>): Promise<void>;
  subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o?: { mode?: "latest" | "all" }): Promise<Subscription>;
  close(): Promise<void>;
}

/** 놓친 수 세기(SENSOR all): 보낸 노드 인스턴스마다 마지막 seq. base는 준비 때 가장 새 메시지다(그 인스턴스는 그 seq부터).
 *  처음 보는 인스턴스는 seq 0부터 센다: 인스턴스는 seq 1부터 보내고, 준비 뒤에 생긴 인스턴스다(SENSOR 토픽은 보내는 노드가 하나다). */
export function gapCounter(base?: Envelope<TopicName>) {
  const id = (e: Envelope<TopicName>) => `${e.header.node}|${e.header.inst}`;
  const last = new Map<string, number>(base ? [[id(base), base.header.seq]] : []);
  let lost = 0;
  return {
    see(e: Envelope<TopicName>): void {
      const p = last.get(id(e)) ?? 0;
      if (e.header.seq > p + 1) lost += e.header.seq - p - 1;
      last.set(id(e), Math.max(p, e.header.seq));
    },
    lost: () => lost,
  };
}

/** /bus/dead 몸: 처리하지 못한 메시지와 그룹, 전달 횟수. */
export const deadBody = (topic: TopicName, group: NodeName, raw: string, deliveries: number) => ({ topic, group, raw, deliveries });
```

```ts
// clock.ts — 노드 시계. 실제 시계는 Date.now·setInterval·setTimeout, 가상 시계(재생·시험)는 advanceTo로 시각을 당기며 그 사이 타이머(되풀이·한 번)를 시각 차례로 부른다.
// 타이머 하나를 부를 때마다 settle(재생 장벽)을 기다린 뒤 다음으로 간다: 비동기 타이머 일과 그 일이 낸 메시지가 끝나기 전에 시계가 넘어가지 않는다.
export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  /** ms 뒤 한 번(통로의 다시 주기). */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => { const h = setInterval(fn, ms); h.unref?.(); return () => clearInterval(h); },
  after: (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
};

type Timer = { ms: number; next: number; fn: () => void; once: boolean };

export class VirtualClock implements Clock {
  #now: number;
  readonly #timers = new Set<Timer>();
  constructor(start = 0) { this.#now = start; }
  now(): number { return this.#now; }
  set(ms: number): void { if (ms > this.#now) this.#now = ms; }
  every(ms: number, fn: () => void): () => void {
    return this.#add({ ms, next: this.#now + ms, fn, once: false });
  }
  after(ms: number, fn: () => void): () => void {
    return this.#add({ ms, next: this.#now + ms, fn, once: true });
  }
  #add(t: Timer): () => void {
    this.#timers.add(t);
    return () => this.#timers.delete(t);
  }
  async advanceTo(ms: number, settle: () => Promise<void> = async () => {}): Promise<void> {
    for (;;) {
      const due = [...this.#timers].filter((t) => t.next <= ms).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.#now = due.next;
      if (due.once) this.#timers.delete(due);
      else due.next += due.ms;
      due.fn();
      await settle();
    }
    this.set(ms);
  }
}
```

- [ ] **Step 4: `memory.ts`를 쓴다**

```ts
// memory.ts — 한 프로세스 안 통로. QoS 동작은 RedisBus와 같다(tests/helpers/bus-contract.ts).
// SENSOR: 토픽마다 정확히 마지막 depth개. latest는 깨어날 때 가장 새 것 하나, all은 같은 기록을 커서로 차례로 읽는다
//   (준비 때 가장 새 seq가 기준, 잘려 건너뛴 수를 센다). 상한 밖으로 쌓아 두지 않는다.
// STATE: 열쇠마다 마지막 하나. 바뀐 열쇠만 표시해 두고 읽을 때 그 열쇠의 지금 값을 준다. 시작할 때 모든 열쇠를 먼저 준다.
// RELIABLE: 토픽 기록 + 그룹마다 다음 차례·처리 중 하나·전달 횟수. 처리 중인 것이 ack되거나 dead가 될 때까지 뒤 메시지를 주지 않는다.
// 배달은 늘 다음 차례(setImmediate, 다시 주기는 RETRY_MS 뒤)에 한다: publish 안에서 콜백을 부르지 않는다. quiet()는 예약된 배달이 없는지 본다.
// 받는 쪽이 거절(reject)하면 "retry"로 본다. 다시 주기는 시계(clock, 기본 실제 시계)로 RETRY_MS가 지난 뒤에만 한다(그 사이 새 메시지가 와도 앞당기지 않는다).
// 재생은 가상 시계를 넘겨 다시 주기도 가상 시각으로 돈다(장벽은 다시 주기를 기다리지 않고, 시계를 당길 때 돈다).
// close() 뒤에는 발행·구독을 거절하고 예약된 배달도 돌리지 않는다.
import { CLOSED, deadBody, gapCounter, MAX_DELIVERIES, RETRY_MS, type Bus, type Deliver, type Subscription } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { realClock, type Clock } from "./clock.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

type Raw = { id: number; raw: string };
interface Group { name: NodeName; next: number; pending: Raw | null; tries: number; retryAt: number; deliver: Deliver<TopicName> | null; busy: boolean; started: boolean }

export class MemoryBus implements Bus {
  #id = 0;
  #scheduled = 0;
  #closed = false;
  readonly #log = new Map<string, Raw[]>();
  readonly #state = new Map<string, Map<string, string>>();
  readonly #wake = new Map<string, Set<(key: string) => void>>();
  readonly #groups = new Map<string, Map<string, Group>>();

  readonly #warn: (s: string) => void;
  readonly #clock: Clock;

  constructor(o: { warn?: (s: string) => void; clock?: Clock } = {}) {
    this.#warn = o.warn ?? ((s) => console.error(s));
    this.#clock = o.clock ?? realClock;
  }

  /** 다음 차례에 배달한다(예약 수를 센다: quiet). */
  #later(f: () => void): void {
    this.#scheduled++;
    setImmediate(() => { this.#scheduled--; if (!this.#closed) f(); });
  }

  /** 예약된 배달이 없다(재생·시험 장벽). 처리 중인 콜백은 노드 쪽(BusNode.busy)이 센다. */
  quiet(): boolean { return this.#scheduled === 0; }

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.#closed) throw new Error(CLOSED);
    const raw = encode(e);
    decode(e.topic, raw);
    const q = TOPICS[e.topic].qos;
    if (q.kind === "state") (this.#state.get(e.topic) ?? this.#state.set(e.topic, new Map()).get(e.topic)!).set(e.key, raw);
    const log = this.#log.get(e.topic) ?? this.#log.set(e.topic, []).get(e.topic)!;
    log.push({ id: ++this.#id, raw });
    if (q.kind === "sensor" && log.length > q.depth) log.splice(0, log.length - q.depth);
    if (q.kind === "state" && log.length > 1) log.splice(0, log.length - 1);
    if (q.kind === "reliable") for (const g of this.#groups.get(e.topic)?.values() ?? []) this.#pump(e.topic, g);
    else for (const w of this.#wake.get(e.topic) ?? []) this.#later(() => w(e.key));
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o: { mode?: "latest" | "all" } = {}): Promise<Subscription> {
    if (this.#closed) throw new Error(CLOSED);
    const d = deliver as Deliver<TopicName>;
    const q = TOPICS[topic].qos;
    if (q.kind === "reliable") {
      const groups = this.#groups.get(topic) ?? this.#groups.set(topic, new Map()).get(topic)!;
      const g = groups.get(node) ?? groups.set(node, { name: node, next: this.#id + 1, pending: null, tries: 0, retryAt: 0, deliver: null, busy: false, started: false }).get(node)!;
      g.deliver = d;
      g.busy = false;
      g.tries = 0;
      return {
        start: () => { g.started = true; this.#pump(topic, g); },
        stop: async () => { g.deliver = null; g.started = false; g.busy = false; },
        lost: () => 0,
      };
    }
    const log = () => this.#log.get(topic) ?? [];
    const all = q.kind === "sensor" && o.mode === "all";
    const tail = log().at(-1);
    let cursor = tail?.id ?? 0;
    const gaps = gapCounter(all && tail ? decode(topic, tail.raw) : undefined);
    const dirty = new Set<string>();
    let started = false;
    let busy = false;
    const next = (): string | undefined => {
      if (q.kind === "state") {
        const key = dirty.values().next().value;
        if (key === undefined) return undefined;
        dirty.delete(key);
        return this.#state.get(topic)?.get(key);
      }
      const l = log();
      const r = all ? l.find((x) => x.id > cursor) : l.at(-1);
      if (!r || r.id <= cursor) return undefined;
      cursor = r.id;
      return r.raw;
    };
    const run = () => {
      if (!started || busy) return;
      const raw = next();
      if (raw === undefined) return;
      busy = true;
      const e = decode(topic, raw);
      if (all) gaps.see(e);
      void d(e).catch(() => "retry" as const).finally(() => { busy = false; this.#later(run); });
    };
    const wake = (key: string) => { if (q.kind === "state") dirty.add(key); run(); };
    const wakes = this.#wake.get(topic) ?? this.#wake.set(topic, new Set()).get(topic)!;
    wakes.add(wake);
    return {
      start: () => {
        if (q.kind === "state") for (const key of this.#state.get(topic)?.keys() ?? []) dirty.add(key);
        started = true;
        run();
      },
      stop: async () => { wakes.delete(wake); started = false; },
      lost: () => gaps.lost(),
    };
  }

  #pump(topic: TopicName, g: Group): void {
    if (!g.started || g.busy || !g.deliver || this.#clock.now() < g.retryAt) return;
    const item = g.pending ?? (this.#log.get(topic) ?? []).find((r) => r.id >= g.next);
    if (!item) return;
    if (g.pending !== item) g.tries = 0;
    g.pending = item;
    g.next = item.id + 1;
    g.busy = true;
    const deliver = g.deliver;
    this.#later(() => {
      void deliver(decode(topic, item.raw)).catch(() => "retry" as const).then(async (out) => {
        if (g.deliver !== deliver) return;   // 끊긴 구독: 처리 중인 것을 그대로 둔다(다시 붙으면 다시 준다)
        g.tries++;
        if (out === "retry" && g.tries < MAX_DELIVERIES) {   // RETRY_MS 뒤 같은 메시지를 다시 준다. 뒤 메시지는 기다린다
          g.busy = false;
          g.retryAt = this.#clock.now() + RETRY_MS;
          this.#clock.after(RETRY_MS, () => { if (this.#closed) return; g.retryAt = 0; this.#pump(topic, g); });
          return;
        }
        if (out === "retry") await this.#dead(topic, g.name, item.raw, g.tries);
        g.pending = null;
        g.busy = false;
        this.#trim(topic);
        this.#pump(topic, g);
      }).catch((err: Error) => this.#warn(`[통로] ${topic} 배달 마무리 실패(${g.name}): ${err.message}`));
    });
  }

  async #dead(topic: TopicName, group: NodeName, raw: string, tries: number): Promise<void> {
    if (topic === "/bus/dead") return this.#warn(`[통로] /bus/dead 처리 실패(${group}, ${tries}번): 다시 보내지 않아요`);
    const e = decode(topic, raw);
    await this.publish({ topic: "/bus/dead", key: topic, header: { ...e.header, node: group }, body: deadBody(topic, group, raw, tries) } as never);
  }

  #trim(topic: TopicName): void {
    const log = this.#log.get(topic);
    const groups = [...(this.#groups.get(topic)?.values() ?? [])];
    if (!log || !groups.length) return;
    const keep = Math.min(...groups.map((g) => g.pending?.id ?? g.next));
    while (log.length && log[0]!.id < keep) log.shift();
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  length(topic: string): number { return this.#log.get(topic)?.length ?? 0; }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wake.clear();
    for (const groups of this.#groups.values()) for (const g of groups.values()) { g.deliver = null; g.started = false; }
  }
}
```

- [ ] **Step 5: `node.ts`·`open.ts`를 쓴다**

```ts
// node.ts — 노드 실행기(ROS 2 single-threaded executor처럼). prepare()로 모든 구독을 만들고, 띄우는 곳이 모든 노드를 준비한 뒤 start()로 배달·타이머를 켠다.
// 메시지 콜백과 타이머 콜백을 한 줄에서 하나씩 처리한다(같은 노드의 콜백은 겹치지 않는다). 받은 메시지는 먼저 낡은 것을 버리고(Freshness.check),
// 콜백이 성공해야 ack·확정(commit)한다. 실패하면 "retry"로 돌려 같은 메시지를 다시 받는다. SENSOR latest는 줄에 마지막 하나만 둔다.
// 콜백이 ctx.defer()를 부르면 줄은 비우되 ack·확정은 돌려받은 settle(ok)를 부를 때까지 미룬다(상태를 기다리는 변화, withState).
// 콜백 밖에서 도는 긴 일(LLM)은 spawn()으로 띄워 노드 수명 신호를 받고, 결과는 post()로 줄에 넣는다.
// stop(): 닫힘 → 타이머 멈춤 → 줄에 남은 일 버림 → 돌던 콜백·spawn한 일에 취소 신호 → 둘 다 기다림 → 구독 끊기 → 미룬 메시지는 ack하지 않음.
// 닫힌 뒤 publish·spawn은 거절하고 post는 버린다. 줄은 늘 다음 차례에 돌기 시작한다(첫 일이 동기로 던져도 줄이 멈추지 않는다).
// 발행은 publishTimeoutMs(기본 5초) 안에 끝나야 하고, 끝내기(노드 수명 신호)가 기다리는 발행을 끊는다(통로가 끊겨 답하지 않아도 멈추지 않는다).
import { randomUUID } from "node:crypto";
import type { Bus, Outcome, Subscription } from "./bus.js";
import { realClock, type Clock } from "./clock.js";
import { Freshness } from "./fresh.js";
import type { Envelope } from "./header.js";
import { TOPICS, type Body, type NodeName, type TopicName } from "./topics.js";

type Settle = (ok: boolean) => void;

/** 발행 한 번의 시간 제한 기본값(ms). */
export const PUBLISH_TIMEOUT_MS = 5000;

/** p를 기다리되 신호가 끊기거나 ms가 지나면 실패한다. */
function bounded<T>(p: Promise<T>, signal: AbortSignal, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (f: () => void) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); f(); };
    const onAbort = () => done(() => reject(signal.reason ?? new Error(`${what}을 멈췄어요`)));
    if (signal.aborted) return onAbort();
    timer = setTimeout(() => done(() => reject(new Error(`${what}이 ${ms}ms 안에 끝나지 않았어요`))), ms);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then((v) => done(() => resolve(v)), (e: unknown) => done(() => reject(e)));
  });
}
type Ctx<N extends TopicName> = { e: Envelope<N>; signal: AbortSignal; defer: () => Settle };
type RunCtx = { signal: AbortSignal; defer: () => Settle };
type Job = { run: (c: RunCtx) => Promise<void> | void; done?: Settle; latest?: TopicName };
type Sub = { topic: TopicName; mode?: "latest" | "all"; cb: (body: never, ctx: Ctx<TopicName>) => void | Promise<void> };

export class BusNode {
  readonly name: NodeName;
  /** 이 노드 객체의 인스턴스 id(머리 inst). 노드를 다시 만들면 바뀌고 seq는 1부터다. */
  readonly inst = randomUUID().slice(0, 8);
  readonly #bus: Bus;
  readonly #epoch: { boot: string; home: string };
  readonly #clock: Clock;
  readonly #log: (s: string) => void;
  readonly #publishMs: number;
  readonly #fresh: Freshness;
  readonly #seq = new Map<TopicName, number>();
  readonly #subs: Sub[] = [];
  readonly #timers: [number, () => void | Promise<void>][] = [];
  readonly #queue: Job[] = [];
  readonly #handles: { topic: TopicName; h: Subscription }[] = [];
  readonly #stopTimers: (() => void)[] = [];
  readonly #parked = new Set<Settle>();
  readonly #tasks = new Set<Promise<void>>();
  readonly #life = new AbortController();
  #running: Promise<void> | null = null;
  #current: AbortController | null = null;
  #closed = false;
  #idle: (() => void)[] = [];

  constructor(o: { name: NodeName; bus: Bus; epoch: { boot: string; home: string }; clock?: Clock; log?: (s: string) => void; publishTimeoutMs?: number }) {
    this.name = o.name;
    this.#bus = o.bus;
    this.#epoch = o.epoch;
    this.#clock = o.clock ?? realClock;
    this.#log = o.log ?? ((s) => console.error(s));
    this.#publishMs = o.publishTimeoutMs ?? PUBLISH_TIMEOUT_MS;
    this.#fresh = new Freshness(() => this.#epoch);
  }

  on<N extends TopicName>(topic: N, cb: (body: Body<N>, ctx: Ctx<N>) => void | Promise<void>, o: { mode?: "latest" | "all" } = {}): void {
    this.#subs.push({ topic, mode: o.mode, cb: cb as never });
  }

  /** 변화(rev)는 그 판본 이상의 상태를 가진 뒤에 처리한다. 상태가 아직 없으면 변화를 내려놓고(defer) 줄을 비운다.
   *  내려놓은 변화는 상태가 오면 그 콜백 안에서 처리하고 그때 ack한다. RELIABLE은 ack 전에는 뒤 변화를 주지 않으므로 내려놓은 변화는 하나다. */
  withState<C extends TopicName, S extends TopicName>(changes: C, state: S, cb: (change: Body<C>, latest: Body<S>, ctx: Ctx<C>) => void | Promise<void>): void {
    let latest: Body<S> | null = null;
    let parked: { c: Body<C>; ctx: Ctx<C>; settle: Settle } | null = null;
    const rev = (b: unknown) => Number((b as { rev?: number }).rev);
    const ready = (c: Body<C>) => latest !== null && rev(latest) >= rev(c);
    this.on(state, async (b, sctx) => {
      latest = b;
      if (!parked || !ready(parked.c)) return;
      const p = parked;
      parked = null;
      try {
        await cb(p.c, b, { ...p.ctx, signal: sctx.signal });
      } catch (err) {
        p.settle(false);
        throw err;
      }
      p.settle(true);
    });
    this.on(changes, async (c, ctx) => {
      if (ready(c)) return cb(c, latest!, ctx);
      parked = { c, ctx, settle: ctx.defer() };
    });
  }

  every(ms: number, cb: () => void | Promise<void>): void {
    this.#timers.push([ms, cb]);
  }

  async publish<N extends TopicName>(topic: N, body: Body<N>): Promise<void> {
    if (this.#closed) throw new Error(`닫힌 노드(${this.name})는 ${topic}을 보낼 수 없어요`);
    const t = TOPICS[topic];
    if (!(t.from as readonly NodeName[]).includes(this.name)) throw new Error(`${this.name}는 ${topic}을 보낼 수 없어요(보내는 노드: ${t.from.join(", ")})`);
    t.body.parse(body);
    const seq = (this.#seq.get(topic) ?? 0) + 1;
    this.#seq.set(topic, seq);
    const key = (t.key as (b: Body<N>) => string)(body);
    const sent = this.#bus.publish({ topic, key, header: { stamp: this.#clock.now(), node: this.name, inst: this.inst, seq, ...this.#epoch }, body } as Envelope<N>);
    await bounded(sent, this.#life.signal, this.#publishMs, `${topic} 발행`);
  }

  /** 콜백 밖에서 도는 긴 일(LLM 호출 등). 노드 수명 신호를 받고, stop()이 그 신호를 끊고 끝나길 기다린다. */
  spawn<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(`닫힌 노드(${this.name})는 새 일을 띄울 수 없어요`));
    const p = fn(this.#life.signal);
    const t = p.then(() => {}, () => {});
    this.#tasks.add(t);
    void t.then(() => this.#tasks.delete(t));
    return p;
  }

  /** 줄에 일 하나를 넣는다(spawn한 일의 결과를 노드 상태에 넣을 때). 닫힌 뒤에는 버린다. */
  post(fn: (signal: AbortSignal) => void | Promise<void>): void {
    this.#push({ run: ({ signal }) => fn(signal) });
  }

  /** 구독·그룹·커서를 만든다(배달은 start 뒤). */
  async prepare(): Promise<void> {
    for (const s of this.#subs) this.#handles.push({ topic: s.topic, h: await this.#bus.subscribe(s.topic, this.name, (e) => this.#enqueue(e, s), { mode: s.mode }) });
  }

  /** 배달·타이머를 켠다. 띄우는 곳은 모든 노드의 prepare를 마친 뒤 부른다. */
  start(): void {
    for (const { h } of this.#handles) h.start();
    for (const [ms, cb] of this.#timers) this.#stopTimers.push(this.#clock.every(ms, () => this.#push({ run: () => cb() })));
  }

  async stop(): Promise<void> {
    this.#closed = true;
    for (const s of this.#stopTimers) s();
    for (const j of this.#queue.splice(0)) j.done?.(false);
    const why = new Error(`${this.name} 노드를 끝냄`);
    this.#current?.abort(why);
    this.#life.abort(why);
    await this.#running;
    await Promise.all([...this.#tasks]);
    for (const { h } of this.#handles) await h.stop();
    for (const settle of [...this.#parked]) settle(false);
  }

  /** 시험·재생 장벽: 줄이 빌 때까지 기다린다. */
  idle(): Promise<void> {
    return this.busy() ? new Promise((r) => this.#idle.push(r)) : Promise.resolve();
  }

  /** 줄에 일이 있거나 도는 중이다. 내려놓은 메시지와 spawn한 일은 세지 않는다. */
  busy(): boolean { return this.#running !== null || this.#queue.length > 0; }

  /** 그 토픽 구독의 놓친 수(SENSOR all). */
  lost(topic: TopicName): number { return this.#handles.filter((x) => x.topic === topic).reduce((n, x) => n + x.h.lost(), 0); }

  #enqueue(e: Envelope<TopicName>, s: Sub): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      if (this.#closed) return resolve("retry");
      if (!this.#fresh.check(e)) return resolve("ack");
      const latest = TOPICS[e.topic].qos.kind === "sensor" && s.mode !== "all" ? e.topic : undefined;
      this.#push({
        latest,
        run: async ({ signal, defer }) => {
          let deferred = false;
          await s.cb(e.body as never, {
            e, signal,
            defer: () => {
              deferred = true;
              const settle = defer();
              return (ok) => { if (ok) this.#fresh.commit(e); settle(ok); };
            },
          });
          if (!deferred) this.#fresh.commit(e);
        },
        done: (ok) => resolve(ok ? "ack" : "retry"),
      });
    });
  }

  #push(job: Job): void {
    if (this.#closed) return job.done?.(false);
    if (job.latest) {
      const old = this.#queue.findIndex((j) => j.latest === job.latest);
      if (old >= 0) this.#queue.splice(old, 1)[0]!.done?.(true);
    }
    this.#queue.push(job);
    if (!this.#running) this.#running = this.#drain();
  }

  async #drain(): Promise<void> {
    await null;   // 늘 다음 차례에 시작한다: 첫 일이 동기로 던져 줄이 바로 비어도 #running이 끝난 Promise로 남지 않는다
    while (this.#queue.length && !this.#closed) {
      const job = this.#queue.shift()!;
      const ac = new AbortController();
      this.#current = ac;
      let taken: Settle | null = null;
      const defer = (): Settle => {
        const done = job.done;
        job.done = undefined;
        let settled = false;
        const settle: Settle = (ok) => {
          if (settled) return;
          settled = true;
          this.#parked.delete(settle);
          done?.(ok && !this.#closed);
        };
        this.#parked.add(settle);
        taken = settle;
        return settle;
      };
      let ok = true;
      try {
        await job.run({ signal: AbortSignal.any([ac.signal, this.#life.signal]), defer });
      } catch (err) {
        ok = false;
        this.#log(`[${this.name}] 콜백 실패: ${(err as Error).message}`);
        (taken as Settle | null)?.(false);
      }
      this.#current = null;
      job.done?.(ok && !this.#closed);
    }
    this.#running = null;
    for (const r of this.#idle.splice(0)) r();
  }
}
```

```ts
// open.ts — REDIS_URL이 있으면 RedisBus(켜질 때 디스크 저장 끔 확인, 다른 기동의 열쇠 지움, 기동 표시 열쇠), 없으면 MemoryBus(같은 계약). 다른 갈래는 없다.
// onLost(꼭 넘김): Redis가 다시 켜져 이번 기동의 메시지를 잃었을 때. 통로는 그 뒤 요청을 거절하고, 띄우는 곳은 서버를 끝낸다(compose restart가 새 기동으로 띄운다).
import type { Bus } from "./bus.js";
import { MemoryBus } from "./memory.js";

export async function openBus(env: Record<string, string | undefined>, o: { boot: string; log?: (s: string) => void; onLost: (err: Error) => void }): Promise<Bus> {
  const url = env.REDIS_URL?.trim();
  if (!url) return new MemoryBus(o.log);
  const { RedisBus } = await import("./redis.js");
  return RedisBus.connect(url, { boot: o.boot, log: o.log, onLost: o.onLost });
}
```

`index.ts`에 `MAX_DELIVERIES`, `RETRY_MS`, `type Bus`, `type Outcome`, `type Subscription`, `BusNode`, `MemoryBus`, `VirtualClock`, `realClock`, `type Clock`를 더한다(`openBus`는 Task 3).

- [ ] **Step 6: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-memory.test.ts tests/bus-node.test.ts tests/bus-topics.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋·push**

```bash
git add src/bus tests/helpers/bus-contract.ts tests/bus-memory.test.ts tests/bus-node.test.ts
git commit -m "feat(bus): add the two-phase node executor that acks after success, the in-memory bus and the shared QoS contract"
git push
```

### Task 3: `RedisBus` · 디스크 저장 끔 · 개발용·AWS Redis 컨테이너

**Files:**
- Create: `src/bus/redis.ts`, `src/bus/open.ts`(Task 2의 `open.ts` 코드, `index.ts`에 `openBus`), `compose.dev.yaml`, `tests/bus-redis.test.ts`, `tests/bus-persistence.test.ts`
- Modify: `package.json`·`package-lock.json`(`redis` 6.3.1 정확히), `compose.yaml`(`redis` 서비스, noonchi `REDIS_URL`·`depends_on`), `.env.example`·`docs/reference.md`(`REDIS_URL`), `tests/deploy-files.test.ts`

**Interfaces:**
- Consumes: Task 2 `Bus`, `Deliver`, `Subscription`, `MAX_DELIVERIES`, `RETRY_MS`, `gapCounter`, `deadBody`, 계약 시험.
- Produces: `assertNoPersistence(get: (name: string) => Promise<string>): Promise<void>`, `class RedisBus implements Bus { static connect(url, o: { boot: string; keepOthers?: boolean; log?; onLost: (err: Error) => void }): Promise<RedisBus>; length(topic): Promise<number> }`. 기동을 잃은 뒤 `publish`·`subscribe`는 거절한다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/bus-persistence.test.ts`(Redis 없이 돈다):

```ts
// Redis 디스크 저장이 켜져 있으면 noonchi는 시작하지 않고 무엇을 바꾸라는 오류를 낸다(사진·메시지가 디스크에 남지 않게).
import { describe, expect, it } from "vitest";
import { assertNoPersistence } from "../src/bus/redis.js";

const config = (v: Record<string, string>) => async (name: string) => v[name] ?? "";

describe("Redis 디스크 저장 끔 확인", () => {
  it("appendonly no·save 빈 값이면 통과", async () => {
    await expect(assertNoPersistence(config({ appendonly: "no", save: "" }))).resolves.toBeUndefined();
  });

  it("AOF나 RDB 저장이 켜져 있으면 바꿀 설정을 말하며 실패", async () => {
    await expect(assertNoPersistence(config({ appendonly: "yes", save: "" }))).rejects.toThrow('Redis 디스크 저장이 켜져 있어요(appendonly=yes, save=""). redis-server를 --appendonly no --save ""로 띄우세요');
    await expect(assertNoPersistence(config({ appendonly: "no", save: "3600 1" }))).rejects.toThrow(/save="3600 1"/);
  });
});
```

`tests/bus-redis.test.ts`:

```ts
// 실제 Redis 통로: REDIS_URL이 있을 때만 돈다(이 PC는 compose.dev.yaml의 noonchi-redis, CI·다른 PC는 건너뜀).
// 시험마다 다른 기동 값을 쓰고(다른 시험의 열쇠는 지우지 않는다) 다른 시험·개발 서버와 섞이지 않게 한다.
import { createClient } from "redis";
import { describe, expect, it } from "vitest";
import type { Envelope, TopicName } from "../src/bus/index.js";
import { RedisBus } from "../src/bus/redis.js";
import { busContract } from "./helpers/bus-contract.js";

const url = process.env.REDIS_URL?.trim();
let n = 0;
const boot = () => `test-${process.pid}-${Date.now()}-${++n}`;
const failOnLost = (e: Error) => { throw e; };
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("기다림 초과"); await new Promise((r) => setTimeout(r, 50)); } };
const admin = async (cmd: string[]) => { const c = createClient({ url: url! }); await c.connect(); try { return await c.sendCommand(cmd); } finally { await c.quit(); } };

describe.skipIf(!url)("RedisBus", () => {
  busContract("RedisBus", () => RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: failOnLost }), { length: (b, t) => (b as RedisBus).length(t) });

  it("기동 표시 열쇠가 사라지면(Redis가 다시 켜짐) onLost를 부르고, 그 뒤 발행·구독을 거절한다", async () => {
    const b = boot();
    let lost: Error | null = null;
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: (e) => { lost = e; } });
    await admin(["DEL", `noonchi:${b}:alive`]);
    await until(() => lost !== null, 3000);
    expect((lost as Error | null)?.message).toMatch(/Redis가 다시 켜져 이번 기동의 메시지를 잃었어요/);
    const msg = { topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: b, home: "h#1" }, body: { rev: 1 } } as Envelope<TopicName>;
    await expect(bus.publish(msg)).rejects.toThrow(/잃었어요/);
    await expect(bus.subscribe("/world/changes", "act", async () => "ack")).rejects.toThrow(/잃었어요/);
    await bus.close();
  });

  it("연결이 잠깐 끊겨도 STATE·SENSOR·RELIABLE 구독이 이어진다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    const h = (node: string, seq: number) => ({ stamp: seq, node, inst: "i1", seq, boot: b, home: "h#1" });
    const got: string[] = [];
    const subs = await Promise.all([
      bus.subscribe("/device/state", "world", async (m) => { got.push(`state ${m.body.on}`); return "ack"; }),
      bus.subscribe("/phone/pose", "world", async (m) => { got.push(`pose ${m.body.observed_ms}`); return "ack"; }),
      bus.subscribe("/world/changes", "act", async (m) => { got.push(`changes ${m.body.rev}`); return "ack"; }),
    ]);
    for (const s of subs) s.start();
    await admin(["CLIENT", "KILL", "TYPE", "normal", "SKIPME", "yes"]);
    await new Promise((r) => setTimeout(r, 500));
    await bus.publish({ topic: "/device/state", key: "a", header: h("devices", 1), body: { id: "a", on: 2 } } as never);
    await bus.publish({ topic: "/phone/pose", key: "_", header: h("phone", 1), body: { observed_ms: 7 } } as never);
    await bus.publish({ topic: "/world/changes", key: "_", header: h("world", 1), body: { rev: 3 } } as never);
    await until(() => ["state 2", "pose 7", "changes 3"].every((x) => got.includes(x)), 10_000);
    await bus.close();
  });

  it("dead 발행이 실패해도 실패한 일을 다시 하지 않고 dead만 다시 보낸다", async () => {
    const b = boot();
    const bus = await RedisBus.connect(url!, { boot: b, keepOthers: true, log: () => {}, onLost: failOnLost });
    await admin(["SET", `noonchi:${b}:/bus/dead`, "막음"]);
    let tries = 0;
    const s = await bus.subscribe("/world/changes", "act", async () => { tries++; return "retry"; });
    s.start();
    await bus.publish({ topic: "/world/changes", key: "_", header: { stamp: 1, node: "world", inst: "i1", seq: 1, boot: b, home: "h#1" }, body: { rev: 1 } } as never);
    await new Promise((r) => setTimeout(r, 1500));
    expect(tries).toBe(3);
    await admin(["DEL", `noonchi:${b}:/bus/dead`]);
    let left = 1;
    const t0 = Date.now();
    while (left > 0 && Date.now() - t0 < 5000) { left = await bus.length("/world/changes"); await new Promise((r) => setTimeout(r, 50)); }
    expect(left).toBe(0);
    expect(tries).toBe(3);
    expect(await bus.length("/bus/dead")).toBe(1);
    await bus.close();
  });

  it("시작하다 실패하면(디스크 저장이 켜짐) 만든 연결을 닫는다", async () => {
    const count = async () => String(await admin(["CLIENT", "LIST"])).trim().split("\n").length;
    const before = await count();
    await admin(["CONFIG", "SET", "appendonly", "yes"]);
    try {
      await expect(RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: failOnLost })).rejects.toThrow(/디스크 저장이 켜져/);
    } finally {
      await admin(["CONFIG", "SET", "appendonly", "no"]);
    }
    let after = await count();
    const t0 = Date.now();
    while (after > before && Date.now() - t0 < 3000) { await new Promise((r) => setTimeout(r, 100)); after = await count(); }
    expect(after).toBe(before);
  });

  it("Redis가 답하지 않아도 close()는 끝난다", async () => {
    const bus = await RedisBus.connect(url!, { boot: boot(), keepOthers: true, log: () => {}, onLost: () => {} });
    const s = await bus.subscribe("/world/changes", "act", async () => "ack");
    s.start();
    const c = createClient({ url: url! });
    await c.connect();
    await c.sendCommand(["CLIENT", "PAUSE", "2500", "ALL"]);
    c.destroy();
    const t0 = Date.now();
    await bus.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 2600));
  });
});
```

`tests/deploy-files.test.ts`에 더한다:

```ts
  it("compose: redis는 판을 고정한 공식 이미지, 디스크 저장 끔, 볼륨·호스트 포트 없음, noonchi가 REDIS_URL로 붙는다", () => {
    const c = composeFile();
    const r = c.services.redis;
    expect(r.image).toBe("redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b");
    expect(r.command).toEqual(["redis-server", "--appendonly", "no", "--save", "", "--maxmemory", "512mb", "--maxmemory-policy", "noeviction"]);
    expect(r.volumes).toBeUndefined();
    expect(r.ports).toBeUndefined();
    expect(c.services.noonchi.environment.REDIS_URL).toBe("redis://redis:6379");
    expect(c.services.noonchi.depends_on.redis).toEqual({ condition: "service_healthy" });
  });

  it("개발용 compose: noonchi-redis가 같은 이미지·같은 디스크 저장 끔으로 127.0.0.1:6379만 연다", () => {
    const d = parseYaml(read("compose.dev.yaml"));
    expect(d.services.redis.image).toBe(composeFile().services.redis.image);
    expect(d.services.redis.container_name).toBe("noonchi-redis");
    expect(d.services.redis.ports).toEqual(["127.0.0.1:6379:6379"]);
    expect(d.services.redis.command.slice(0, 5)).toEqual(["redis-server", "--appendonly", "no", "--save", ""]);
  });
```

(`composeFile`·`read`·`parseYaml`은 그 파일이 이미 쓰는 도우미를 쓴다.)

Run: `npm run heavy -- npx vitest run tests/bus-persistence.test.ts tests/bus-redis.test.ts tests/deploy-files.test.ts`
Expected: `bus-persistence`·`deploy-files` FAIL(`src/bus/redis.js`가 없다, `redis` 서비스 없음)

- [ ] **Step 2: 의존성을 더한다**

Run: `npm install --save-exact redis@6.3.1`
Expected: `package.json` `dependencies`에 `"redis": "6.3.1"`

- [ ] **Step 3: `redis.ts`를 쓴다**

```ts
// redis.ts — Redis Streams 통로(node-redis). QoS 동작은 MemoryBus와 같다(tests/helpers/bus-contract.ts).
// 켜질 때: 디스크 저장 끔 확인(assertNoPersistence), 다른 기동의 열쇠 지움(keepOthers면 두기), 기동 표시 열쇠(noonchi:<boot>:alive)를 둔다.
// 1초마다 기동 표시 열쇠를 본다. 없거나 NOGROUP이 나면 Redis가 다시 켜져 이번 기동의 메시지·그룹을 잃은 것이다:
//   onLost(꼭 넘김)를 한 번 부르고, 읽기를 멈추고, 그 뒤 publish·subscribe를 거절한다(되살려 잇지 않는다. 띄우는 곳이 이 기동을 멈춘다).
// 읽기 루프(RELIABLE·STATE 스냅숏·SENSOR)는 연결 오류가 나면 그 루프 전체를 처음부터 다시 시도한다(잠깐 끊긴 것은 이어진다).
// SENSOR: XADD MAXLEN = depth(정확히). latest는 깨어날 때마다 XREVRANGE COUNT 1로 가장 새 것, all은 커서로 차례로 다
//   (준비 때 가장 새 seq가 기준, seq 건너뜀을 센다).
// STATE: INCR 카운터 + MULTI(HSET 값 + XADD 알림{key, n} MAXLEN ~ 64). 받는 쪽은 n이 건너뛰면 HGETALL로 다시 읽는다.
// RELIABLE: XADD(자르지 않음), 그룹 = 노드 이름 = 소비자 이름(준비 때 $부터). 먼저 내 몫으로 남은 것(id 0)을 차례대로, 다 비면 새것(>)을 읽는다.
//   한 메시지를 "ack"까지 다시 준다(RETRY_MS 간격, 그동안 뒤 메시지를 읽지 않는다). 이 구독에서 MAX_DELIVERIES번 실패하면 /bus/dead에 남기고 XACK.
//   /bus/dead 자체의 실패는 다시 보내지 않고 log만 남긴다. ack 뒤 모든 그룹이 넘긴 앞부분을 XTRIM MINID로 자른다.
//   읽기·XACK가 실패하면 내 몫(id 0)부터 다시 읽는다(같은 메시지를 다시 받을 수 있다: 받는 쪽은 한 번만 쓰기로 막는다).
// 연결마다 error 리스너를 단다(프로세스가 죽지 않는다). 막고 읽기(BLOCK)는 구독마다 따로 연결(duplicate)을 쓴다.
import { createClient, type RedisClientType } from "redis";
import { CLOSED, deadBody, gapCounter, MAX_DELIVERIES, RETRY_MS, type Bus, type Deliver, type Subscription } from "./bus.js";
import { decode, encode, type Envelope } from "./header.js";
import { TOPICS, type NodeName, type TopicName } from "./topics.js";

const BLOCK_MS = 1000;
const STATE_NOTE = 64;
const WATCH_MS = 1000;
/** close()가 Redis의 답을 기다리는 시간. 넘으면 연결을 끊는다. */
const CLOSE_MS = 1000;
const LOST = "Redis가 다시 켜져 이번 기동의 메시지를 잃었어요. 서버를 새 기동으로 다시 띄워요";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextId = (id: string) => { const [ms, seq] = id.split("-"); return `${ms}-${Number(seq) + 1}`; };
const cmpId = (a: string, b: string) => { const [am, as] = a.split("-").map(Number); const [bm, bs] = b.split("-").map(Number); return am! - bm! || as! - bs!; };

/** Redis 디스크 저장(AOF·RDB)이 꺼져 있는지 본다. 켜져 있으면 바꿀 설정을 말하며 실패. */
export async function assertNoPersistence(get: (name: string) => Promise<string>): Promise<void> {
  const appendonly = await get("appendonly");
  const save = await get("save");
  if (appendonly !== "no" || save !== "") {
    throw new Error(`Redis 디스크 저장이 켜져 있어요(appendonly=${appendonly}, save=${JSON.stringify(save)}). redis-server를 --appendonly no --save ""로 띄우세요(compose.yaml·compose.dev.yaml redis command)`);
  }
}

export class RedisBus implements Bus {
  readonly #closers = new Set<() => Promise<void>>();
  #watch: ReturnType<typeof setInterval> | null = null;
  #lost = false;
  #closed = false;

  private constructor(private readonly client: RedisClientType, private readonly prefix: string, private readonly log: (s: string) => void, private readonly onLost: (e: Error) => void) {}

  static async connect(url: string, o: { boot: string; keepOthers?: boolean; log?: (s: string) => void; onLost: (e: Error) => void }): Promise<RedisBus> {
    const log = o.log ?? ((s) => console.error(s));
    const client = createClient({ url }) as RedisClientType;
    client.on("error", (e: Error) => log(`[통로] Redis 오류: ${e.message}`));
    await client.connect();
    const prefix = `noonchi:${o.boot}:`;
    try {
      await assertNoPersistence(async (name) => String(Object.values(await client.configGet(name))[0] ?? ""));
      if (!o.keepOthers) {
        for await (const keys of client.scanIterator({ MATCH: "noonchi:*", COUNT: 500 })) {
          const old = (Array.isArray(keys) ? keys : [keys]).filter((k) => !k.startsWith(prefix));
          if (old.length) await client.del(old);
        }
      }
      await client.set(`${prefix}alive`, "1");
    } catch (err) {
      client.destroy();   // 시작하다 실패하면 만든 연결을 닫는다
      throw err;
    }
    const bus = new RedisBus(client, prefix, log, o.onLost);
    bus.#watch = setInterval(() => void bus.#check(), WATCH_MS);
    bus.#watch.unref?.();
    return bus;
  }

  async #check(): Promise<void> {
    if ((await this.client.exists(`${this.prefix}alive`).catch(() => null)) === 0) this.#lose();
  }

  #lose(): void {
    if (this.#lost) return;
    this.#lost = true;
    this.onLost(new Error(LOST));
  }

  #k(topic: string): string { return `${this.prefix}${topic}`; }

  /** 스트림의 가장 새 항목(없으면 undefined). */
  async #newest(k: string) {
    return ((await this.client.xRevRange(k, "+", "-", { COUNT: 1 })) ?? [])[0];
  }

  #open(): void {
    if (this.#closed) throw new Error(CLOSED);
    if (this.#lost) throw new Error(LOST);
  }

  async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    this.#open();
    const raw = encode(e);
    decode(e.topic, raw);
    const q = TOPICS[e.topic].qos;
    const k = this.#k(e.topic);
    if (q.kind === "sensor") await this.client.xAdd(k, "*", { m: raw }, { TRIM: { strategy: "MAXLEN", threshold: q.depth } });
    else if (q.kind === "state") {
      const n = await this.client.incr(`${k}:n`);
      await this.client.multi().hSet(`${k}:state`, e.key, raw).xAdd(k, "*", { key: e.key, n: String(n) }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STATE_NOTE } }).exec();
    } else await this.client.xAdd(k, "*", { m: raw });
  }

  async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o: { mode?: "latest" | "all" } = {}): Promise<Subscription> {
    this.#open();
    const conn = this.client.duplicate() as RedisClientType;
    conn.on("error", (e: Error) => this.log(`[통로] ${topic} 구독 연결 오류: ${e.message}`));
    await conn.connect();
    try {
      return await this.#subscribeOn(conn, topic, node, deliver, o);
    } catch (err) {
      conn.destroy();   // 구독 준비가 실패하면 만든 연결을 닫는다
      throw err;
    }
  }

  async #subscribeOn<N extends TopicName>(conn: RedisClientType, topic: N, node: NodeName, deliver: Deliver<N>, o: { mode?: "latest" | "all" }): Promise<Subscription> {
    const k = this.#k(topic);
    const q = TOPICS[topic].qos;
    let on = true;
    let started = false;
    let loop: Promise<void> = Promise.resolve();
    const tailEntry = (await this.#newest(k));
    const tail = tailEntry?.id ?? "0-0";
    const all = q.kind === "sensor" && o.mode === "all";
    const gaps = gapCounter(all && tailEntry?.message.m ? decode(topic, tailEntry.message.m) : undefined);
    /** 읽기 한 걸음을 기동을 잃거나 끊을 때까지 되풀이한다. 오류면 onError(처음부터 다시 할 준비) 뒤 RETRY_MS 쉬고 다시. NOGROUP은 기동을 잃은 것이다. */
    const forever = (step: () => Promise<boolean | void>, onError: () => void = () => {}) => async () => {
      while (on && !this.#lost) {
        try {
          if ((await step()) === false) return;
        } catch (e) {
          if (String(e).includes("NOGROUP")) return this.#lose();
          onError();
          this.log(`[통로] ${topic} 읽기 실패, 처음부터 다시 해요: ${(e as Error).message}`);
          await sleep(RETRY_MS);
        }
      }
    };
    let run: () => Promise<void>;
    if (q.kind === "reliable") {
      try { await this.client.xGroupCreate(k, node, "$", { MKSTREAM: true }); } catch (e) { if (!String(e).includes("BUSYGROUP")) throw e; }
      /** 이 구독에서 메시지마다 실패한 횟수. dead 발행·XACK가 실패해 같은 메시지를 다시 읽어도 처음부터 세지 않는다(다 쓴 메시지는 dead만 다시 보낸다). */
      const failed = new Map<string, number>();
      /** 한 메시지를 ack나 dead까지. 끊긴 구독이면 false(ack하지 않고 둔다). */
      const handle = async (id: string, raw: string): Promise<boolean> => {
        for (;;) {
          const n = failed.get(id) ?? 0;
          if (n >= MAX_DELIVERIES) { await this.#dead(topic, node, raw, n); break; }
          const out = await deliver(decode(topic, raw)).catch(() => "retry" as const);
          if (!on) return false;
          if (out === "ack") break;
          failed.set(id, n + 1);
          if (n + 1 < MAX_DELIVERIES) {
            await sleep(RETRY_MS);
            if (!on) return false;
          }
        }
        await this.client.xAck(k, node, id);
        failed.delete(id);
        await this.#trim(k);
        return true;
      };
      let mineDone = false;
      run = forever(async () => {
        const r = await conn.xReadGroup(node, node, { key: k, id: mineDone ? ">" : "0" }, { COUNT: 16, ...(mineDone ? { BLOCK: BLOCK_MS } : {}) });
        const ms = (r ?? []).flatMap((s) => s.messages).filter((m) => m?.message?.m);
        if (!mineDone && !ms.length) { mineDone = true; return; }
        for (const m of ms) if (!(await handle(m.id, m.message.m!))) return false;
      }, () => { mineDone = false; });
    } else if (q.kind === "state") {
      let lastN = 0;
      let last = tail;
      let synced = false;
      /** 스냅숏: 카운터·알림 위치를 먼저 잡고 모든 열쇠의 지금 값을 준다. 그 뒤 알림을 이어 읽는다. */
      const snapshot = async () => {
        lastN = Number((await this.client.get(`${k}:n`)) ?? 0);
        last = (await this.#newest(k))?.id ?? "0-0";
        for (const raw of Object.values(await this.client.hGetAll(`${k}:state`))) if (on) await deliver(decode(topic, raw));
        synced = true;
      };
      run = forever(async () => {
        if (!synced) return snapshot();
        const r = await conn.xRead({ key: k, id: last }, { COUNT: 100, BLOCK: BLOCK_MS });
        const ms = r?.flatMap((s) => s.messages) ?? [];
        if (!ms.length) return;
        const ns = ms.map((m) => Number(m.message.n));
        if (ns[0] !== lastN + 1) { synced = false; return; }   // 알림이 건너뛰었다: 스냅숏부터 다시
        for (const m of ms) {
          const raw = await this.client.hGet(`${k}:state`, m.message.key!);
          if (raw && on) await deliver(decode(topic, raw));
          last = m.id;
          lastN = Number(m.message.n);
        }
      }, () => { synced = false; });
    } else {
      let last = tail;
      run = forever(async () => {
        const r = await conn.xRead({ key: k, id: last }, { COUNT: all ? 100 : 1, BLOCK: BLOCK_MS });
        const ms = r?.flatMap((s) => s.messages) ?? [];
        if (!ms.length) return;
        if (all) {
          for (const m of ms) {
            const e = decode(topic, m.message.m!);
            gaps.see(e);
            if (on) await deliver(e);
            last = m.id;
          }
          return;
        }
        const newest = (await this.#newest(k));
        if (!newest || cmpId(newest.id, last) <= 0) return;
        last = newest.id;
        if (on) await deliver(decode(topic, newest.message.m!));
      });
    }
    const stop = async () => {
      on = false;
      void loop.catch(() => {});
      conn.destroy();
      this.#closers.delete(stop);
    };
    this.#closers.add(stop);
    return {
      start: () => { if (!started) { started = true; loop = run().catch((e: Error) => this.log(`[통로] ${topic} 읽기 멈춤: ${e.message}`)); } },
      stop,
      lost: () => gaps.lost(),
    };
  }

  async #dead(topic: TopicName, group: NodeName, raw: string, tries: number): Promise<void> {
    if (topic === "/bus/dead") return this.log(`[통로] /bus/dead 처리 실패(${group}, ${tries}번): 다시 보내지 않아요`);
    const e = decode(topic, raw);
    await this.publish({ topic: "/bus/dead", key: topic, header: { ...e.header, node: group }, body: deadBody(topic, group, raw, tries) } as never);
  }

  /** 모든 그룹이 넘긴(처리 중 없음) 앞부분을 자른다. */
  async #trim(k: string): Promise<void> {
    const groups = await this.client.xInfoGroups(k);
    if (!groups.length) return;
    const keep: string[] = [];
    for (const g of groups) {
      const p = await this.client.xPending(k, g.name);
      keep.push(p.pending > 0 && p.firstId ? p.firstId : nextId(g["last-delivered-id"]));
    }
    await this.client.xTrim(k, "MINID", keep.sort(cmpId)[0]!);
  }

  /** 시험용: 토픽에 남은 메시지 수. */
  async length(topic: string): Promise<number> { return this.client.xLen(this.#k(topic)); }

  /** 닫는다: 구독 연결을 끊고, Redis가 CLOSE_MS 안에 답하지 않으면 기다리지 않고 연결을 끊는다. 그 뒤 발행·구독은 거절한다. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#watch) clearInterval(this.#watch);
    for (const c of [...this.#closers]) await c();
    await Promise.race([this.client.close().catch(() => {}), sleep(CLOSE_MS)]);
    try { this.client.destroy(); } catch { /* 이미 닫힘 */ }
  }
}
```

node-redis 6.3.1의 명령 함수 이름·반환 모양(`configGet`, `scanIterator`가 낱개·배열을 내는지, `xReadGroup`이 id `0`으로 내 몫을 돌려줄 때 지운 메시지를 어떻게 내는지, `xInfoGroups`의 `lastDeliveredId`, `xPending`의 `firstId`)은 설치한 판의 타입으로 맞춘다. 맞추는 기준은 계약 시험과 `bus-persistence` 시험이다.

- [ ] **Step 4: Redis 컨테이너 파일을 쓴다**

`compose.dev.yaml`:

```yaml
# 이 PC 개발·시험용 Redis(노드 통로). 실제 Redis 시험 때만 켠다: docker compose -f compose.dev.yaml up -d redis
# 시험·개발 서버는 REDIS_URL=redis://127.0.0.1:6379. 이미지·판·디스크 저장 끔은 compose.yaml redis와 같다.
services:
  redis:
    image: redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b
    container_name: noonchi-redis
    command: ["redis-server", "--appendonly", "no", "--save", "", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    ports: ["127.0.0.1:6379:6379"]
```

`compose.yaml`에 더한다:

```yaml
  # 노드 통로(ROS 2 통로 역할). noonchi와 같은 EC2, 호스트에 열지 않는다. 디스크에 저장하지 않는다(noonchi가 켜질 때 확인한다).
  # 넘치면 지우지 않고(noeviction) 발행 오류가 난다
  redis:
    image: redis:8.10.2-alpine@sha256:9f8d2d789b9a1d1e3f283f979aa9cbf393373806472e1ccd460e2f9c869b833b
    init: true
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "no", "--save", "", "--maxmemory", "512mb", "--maxmemory-policy", "noeviction"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
```

`noonchi` 서비스에 `REDIS_URL: redis://redis:6379`, `depends_on: { redis: { condition: service_healthy } }`를 더한다. `.env.example`에 `REDIS_URL=`(비우면 메모리 통로, 개발용 Docker Redis는 `redis://127.0.0.1:6379`)을 더한다.

- [ ] **Step 5: 메모리 통로로 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/bus-persistence.test.ts tests/bus-redis.test.ts tests/deploy-files.test.ts tests/bus-memory.test.ts`
Expected: `bus-persistence`·`deploy-files`·`bus-memory` PASS, `bus-redis` 건너뜀

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

Expected: `RedisBus 통로 계약` 열세 시험과 Redis 전용 다섯 시험(기동 표시 열쇠, 연결이 잠깐 끊김, dead 발행 실패, 시작 실패 때 연결 닫기, 답하지 않는 Redis에서 close) PASS. 끝나면 Docker Desktop과 WSL VM이 꺼져 있다. 빈 메모리가 모자라면 이 단계를 미루고 조정자에게 알린다.

- [ ] **Step 7: 커밋·push**

```bash
git add src/bus package.json package-lock.json compose.yaml compose.dev.yaml .env.example tests/bus-redis.test.ts tests/bus-persistence.test.ts tests/deploy-files.test.ts
git commit -m "feat(bus): add the Redis Streams bus that refuses disk persistence, with pinned dev and AWS Redis containers"
git push
```

### Task 4: 기록 노드(기록 DB·녹화) · 격리 재생

**Files:**
- Create: `src/record/history.ts`, `src/record/bag.ts`, `src/record/node.ts`, `src/record/replay.ts`, `src/record/index.ts`
- Modify: `src/brain/history/recorder.ts`(기록 DB 줄 만들기를 `recordBrainLog`·`deviceRecorder`로 빼고 `attachRecorder`가 그것을 쓴다), `src/brain/history/db.ts`(처리표 `bus_seen`, `once`, `forgetOtherBoots`, 가전 지난 값 `device_last`), `src/brain/index.ts`(내보내기), `src/contract/history.ts`(`bus_gap` 종류), `scripts/lint-domains.ts`(`record` 도메인, `DEPS.record = ["bus", "brain"]`, `server`에 `record`)
- Test: `tests/record-bag.test.ts`, `tests/record-replay.test.ts`

**Interfaces:**
- Consumes: Task 2 `BusNode`, `MemoryBus`(`quiet`), `VirtualClock`(`advanceTo(ms, settle)`), `TOPICS`.
- Produces(`brain`): `recordBrainLog(db: HistoryDb, l: BrainLog): void`, `deviceRecorder(db: HistoryDb, now: () => number): (s: DeviceState, note?: DeviceNote) => void`(지난 값은 `device_last`에서 읽고 같은 트랜잭션에 쓴다), `HistoryDb.once(key: { topic; group; key; msg; boot }, write: () => void): boolean`, `HistoryDb.forgetOtherBoots(boot): void`, `HistoryDb.deviceLast(id)`·`setDeviceLast(id, twin)`.
- Produces(`record`): `class Bag { static open(path); write(e, arrivalMs: number): void; range(from, to, o?: { topics? }): { e; arrivalMs }[]; close() }`, `historyRoutes(node: BusNode, db: HistoryDb, o: { bag?: Bag; now: () => number }): void`, `startRecorder(o: { bus; epoch; db: HistoryDb; bag?: Bag; clock? }): Promise<BusNode>`(prepare까지, start는 띄우는 곳), `REPLAY_INPUTS`, `settle(bus: MemoryBus, nodes): Promise<void>`, `replay(o: { bag; from; to; launch: (bus: MemoryBus, clock: VirtualClock) => Promise<BusNode[]>; topics? }): Promise<{ sent: number }>`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/record-bag.test.ts`:

```ts
// 기록 노드: 반성용 기록 DB 줄은 쓴 뒤에만 ack하고, 기록 줄과 처리표가 한 트랜잭션이라 다시 와도 한 번만 남는다.
// 가전 기록기는 기기마다 지난 값을 든다. 녹화는 사진 칸을 뺀다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus } from "../src/bus/index.js";
import { Bag, startRecorder } from "../src/record/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const sender = async (name: "world" | "phone" | "devices", bus: MemoryBus) => {
  const n = new BusNode({ name, bus, epoch: EPOCH, log: () => {} });
  await n.prepare();
  n.start();
  return n;
};

describe("기록 노드", () => {
  it("World State 바뀜을 기록 DB에 지금과 같은 줄로 쓴다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    const world = await sender("world", bus);
    await world.publish("/world/changes", { rev: 1, changes: [{ type: "world_change", at_ms: 1000, kind: "appeared", text: "컵 cup_1 보임" }] });
    await tick();
    await rec.idle();
    expect(db.list({}).map((r) => [r.kind, r.text])).toEqual([["detection", "컵 cup_1 보임"]]);
  });

  it("녹화가 실패해 같은 메시지를 다시 받아도 기록 DB 줄은 한 번만 남는다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const bag = Bag.open(":memory:");
    const write = bag.write.bind(bag);
    let fail = 1;
    bag.write = (e, at) => { if (fail-- > 0) throw new Error("녹화 실패"); write(e, at); };
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    rec.start();
    const world = await sender("world", bus);
    await world.publish("/world/changes", { rev: 1, changes: [{ type: "world_change", at_ms: 1000, kind: "appeared", text: "컵 cup_1 보임" }] });
    await tick(400);
    await rec.idle();
    expect(db.list({ kinds: ["detection"] })).toHaveLength(1);
    expect(bag.range(0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });

  it("가전 기록기는 기기마다 지난 값을 들어, 처음 상태는 적지 않고 같은 값은 다시 적지 않는다. 기록 노드를 다시 만들어도 이어진다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const tv = (on: boolean) => ({ id: "tv", twin: { on }, updatedAt: "2026-11-17T12:00:00Z" });
    const note = { label: "TV", kind: "tv" };
    const rec1 = await startRecorder({ bus, epoch: EPOCH, db });
    rec1.start();
    const dev = await sender("devices", bus);
    await dev.publish("/device/changes", { id: "tv", state: tv(false), note: { ...note, initial: true } });
    await dev.publish("/device/changes", { id: "tv", state: tv(true), note });
    await tick(100);
    await rec1.stop();
    const rec2 = await startRecorder({ bus, epoch: EPOCH, db });
    rec2.start();
    await dev.publish("/device/changes", { id: "tv", state: tv(true), note });
    await dev.publish("/device/changes", { id: "tv", state: tv(false), note });
    await tick(100);
    await rec2.idle();
    expect(db.list({ kinds: ["device"] }).map((r) => r.data)).toEqual([
      expect.objectContaining({ attr: "on", from: false, to: true }),
      expect.objectContaining({ attr: "on", from: true, to: false }),
    ]);
  });

  it("노드를 다시 만들어 seq가 1로 돌아와도 새 메시지는 중복으로 버려지지 않는다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    for (const text of ["컵 cup_1 보임", "컵 cup_2 보임"]) {
      const world = await sender("world", bus);
      await world.publish("/world/changes", { rev: 1, changes: [{ type: "world_change", at_ms: 1000, kind: "appeared", text }] });
      await tick();
      await world.stop();
    }
    await rec.idle();
    expect(db.list({ kinds: ["detection"] }).map((r) => r.text)).toEqual(["컵 cup_1 보임", "컵 cup_2 보임"]);
  });

  it("/act/log의 사용자 답(feedback)을 기록 DB feedback 줄로 쓴다(반성 입력)", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    const act = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
    await act.prepare();
    act.start();
    await act.publish("/act/log", { type: "feedback", at_ms: 1000, subject: "plan:pam-1", text: "완료 · 부탁: 식탁으로 가 주세요", data: { choice: "done", via: "button" } });
    await act.publish("/act/log", { type: "execution", at_ms: 1001, plan_id: "plan:pam-1", state: "done", text: "완료" });
    await tick(100);
    await rec.idle();
    expect(db.list({}).map((r) => [r.kind, r.text, r.subject])).toEqual([
      ["feedback", "완료 · 부탁: 식탁으로 가 주세요", "plan:pam-1"],
      ["execution", "완료", "plan:pam-1"],
    ]);
  });

  it("녹화에 사진 바이트(jpeg_b64)는 남기지 않는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bag-")), "bag.sqlite");
    const bus = new MemoryBus();
    const bag = Bag.open(path);
    const rec = await startRecorder({ bus, epoch: EPOCH, db: HistoryDb.open(":memory:"), bag });
    rec.start();
    const phone = await sender("phone", bus);
    const b64 = Buffer.from("SECRET-PHOTO-BYTES").toString("base64");
    await phone.publish("/perception/frame", { jpeg_b64: b64, width: 4, height: 3, observed_ms: 1000 });
    await tick();
    await rec.idle();
    bag.close();
    expect(readFileSync(path).includes(Buffer.from(b64))).toBe(false);
  });
});
```

`tests/record-replay.test.ts`:

```ts
// 격리 재생: 실제 통로가 아닌 새 MemoryBus·가상 시계에서, 허용 목록의 바깥 입력만 도착 차례·도착 시각대로 흘리고,
// 메시지마다 이어지는 발행이 다 끝날 때까지(처리 장벽) 기다린다.
import { describe, expect, it } from "vitest";
import { BusNode, RETRY_MS } from "../src/bus/index.js";
import { Bag, REPLAY_INPUTS, replay } from "../src/record/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const h = (seq: number, stamp: number) => ({ stamp, node: "perception" as const, inst: "i1", seq, ...EPOCH });

describe("격리 재생", () => {
  it("가전 명령·계획 같은 출력 토픽은 흘리지 않는다", () => {
    expect(REPLAY_INPUTS).not.toContain("/device/command");
    expect(REPLAY_INPUTS).not.toContain("/brain/plan");
    expect(REPLAY_INPUTS).toContain("/perception/analysis");
  });

  it("도착 차례대로 흘리고, 가상 시계는 발행 시각이 아니라 도착 시각까지 당긴다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 2000), body: { frame_id: "f1", observed_ms: 1500 } } as never, 2100);
    bag.write({ topic: "/device/command", key: "c1", header: { ...h(1, 2500), node: "act" }, body: { command_id: "c1", deadline_ms: 9e15 } } as never, 2500);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2200), body: { frame_id: "f2", observed_ms: 2150 } } as never, 3050);
    const seen: [string, number][] = [];
    const r = await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const n = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        n.on("/perception/analysis", async (b) => { await new Promise((ok) => setTimeout(ok, 20)); seen.push([String(b.frame_id), clock.now()]); });
        n.on("/device/command", (b) => { seen.push([`명령 ${String(b.command_id)}`, clock.now()]); });
        return [n];
      },
    });
    expect(r.sent).toBe(2);
    expect(seen).toEqual([["f1", 2100], ["f2", 3050]]);
  });

  it("처리에 실패한 메시지의 다시 주기도 가상 시계로 RETRY_MS 뒤에 온다(실제 시간을 기다리지 않는다)", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 1500), body: { frame_id: "f2", observed_ms: 1500 } } as never, 1500);
    const seen: [string, number][] = [];
    let failed = false;
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", (b) => {
          if (b.frame_id === "f1" && !failed) { failed = true; throw new Error("처음 한 번 실패"); }
          seen.push([String(b.frame_id), clock.now()]);
        });
        return [w];
      },
    });
    expect(seen).toEqual([["f1", 1000 + RETRY_MS], ["f2", 1500]]);
  });

  it("재생이 중간에 실패해도 노드를 끝내고 통로를 닫는다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    let stopped = false;
    let seenBus: { publish: (e: never) => Promise<void> } | null = null;
    const broken = { prepare: async () => {}, start: () => {}, busy: () => false, idle: () => Promise.reject(new Error("장벽 실패")), stop: async () => { stopped = true; } };
    await expect(replay({ bag, from: 0, to: 10_000, launch: async (bus) => { seenBus = bus as never; return [broken as never]; } })).rejects.toThrow("장벽 실패");
    expect(stopped).toBe(true);
    await expect(seenBus!.publish({ topic: "/perception/analysis", key: "f9", header: h(9, 9), body: { frame_id: "f9", observed_ms: 9 } } as never)).rejects.toThrow(/닫힌 통로/);
  });

  it("장벽은 이어지는 발행(다섯 단계)이 다 끝난 뒤 다음 메시지로 간다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2000), body: { frame_id: "f2", observed_ms: 2000 } } as never, 2000);
    const seen: string[] = [];
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        const a = new BusNode({ name: "act", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", async (b) => { seen.push(String(b.frame_id)); await w.publish("/world/changes", { rev: Number(b.observed_ms), changes: [] }); });
        a.on("/world/changes", async () => { await a.publish("/act/log", { n: 1 }); });
        a.on("/act/log", async (b) => { const n = Number(b.n); seen.push(`log ${n}`); if (n < 5) await a.publish("/act/log", { n: n + 1 }); });
        return [w, a];
      },
    });
    const five = ["log 1", "log 2", "log 3", "log 4", "log 5"];
    expect(seen).toEqual(["f1", ...five, "f2", ...five]);
  });
});
```

Run: `npm run heavy -- npx vitest run tests/record-bag.test.ts tests/record-replay.test.ts`
Expected: FAIL(`src/record/index.js`가 없다)

- [ ] **Step 2: 기록 DB 쓰기를 함수로 뺀다(`brain`)**

`src/brain/history/recorder.ts`의 `o.onBrain((l) => { switch … })` 몸을 `export function recordBrainLog(db: HistoryDb, l: BrainLog): void`로 옮긴다. `o.onDevice` 몸은 `export function deviceRecorder(db: HistoryDb, now: () => number)`로 옮긴다: `(s, note?)`를 받아 지난 값을 `db.deviceLast(s.id)`에서 읽고, 줄을 쓰고, `db.setDeviceLast(s.id, s.twin)`로 바꾼다(메모리에 들지 않는다. 기록 노드 안에서는 `once`의 트랜잭션 안에서 불린다). `attachRecorder`는 `o.onDevice(deviceRecorder(db, now))`로 쓴다. `src/brain/history/db.ts`에 `device_last(id PRIMARY KEY, twin TEXT)`, 처리표 `bus_seen(topic, grp, msg_key, msg, boot, PRIMARY KEY (topic, grp, msg_key, msg))`와 `once(key, write)`를 더한다: `BEGIN IMMEDIATE` → `INSERT OR IGNORE`로 처리표에 넣고, 이미 있으면 `ROLLBACK`하고 false. 없으면 `write()`(같은 연결의 `add`들) → `COMMIT` → true. `write`가 던지면 `ROLLBACK`하고 다시 던진다. `forgetOtherBoots(boot)`는 다른 기동의 처리표 줄을 지운다(`boot` 칸). `src/brain/index.ts`에서 `recordBrainLog`·`deviceRecorder`를 내보낸다. `src/contract/history.ts` `HISTORY_KINDS`에 `bus_gap`을 더한다(반성 `DAY_KINDS`에는 넣지 않는다). 기존 `tests/history-db.test.ts`가 그대로 통과해야 하고, `once` 시험(같은 열쇠 두 번 → 한 번만 씀, `write`가 던지면 처리표에도 남지 않음)을 더한다.

- [ ] **Step 3: `bag.ts`·`history.ts`·`node.ts`·`replay.ts`·`index.ts`를 쓴다**

```ts
// bag.ts — 녹화 파일(SQLite, node:sqlite): 도착 차례(arrival)·도착 시각(arrival_ms, 기록 노드 시계)·발행 시각·토픽·봉투.
// 사진 칸(TOPICS의 photo)은 빼고 남긴다. 같은 메시지(토픽·msgId)는 한 번만 남긴다.
import { DatabaseSync } from "node:sqlite";
import { TOPICS, decode, msgId, type Envelope, type TopicName } from "../bus/index.js";

export class Bag {
  private constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS bag (arrival INTEGER PRIMARY KEY AUTOINCREMENT, arrival_ms INTEGER NOT NULL, stamp INTEGER NOT NULL,
      topic TEXT NOT NULL, msg TEXT NOT NULL, raw TEXT NOT NULL, UNIQUE (topic, msg));
      CREATE INDEX IF NOT EXISTS bag_time ON bag(arrival_ms, arrival);`);
  }
  static open(path: string): Bag { return new Bag(new DatabaseSync(path)); }

  write(e: Envelope<TopicName>, arrivalMs: number): void {
    const photo = (TOPICS[e.topic] as { photo?: string }).photo;
    const body = photo ? Object.fromEntries(Object.entries(e.body as Record<string, unknown>).filter(([k]) => k !== photo)) : e.body;
    const h = e.header;
    this.db.prepare("INSERT OR IGNORE INTO bag (arrival_ms, stamp, topic, msg, raw) VALUES (?, ?, ?, ?, ?)")
      .run(arrivalMs, h.stamp, e.topic, msgId(h), JSON.stringify({ key: e.key, header: h, body }));
  }

  /** from ≤ 도착 시각 < to, 도착 차례로. 사진 토픽은 돌려주지 않는다(되살릴 사진이 없다). */
  range(from: number, to: number, o: { topics?: readonly TopicName[] } = {}): { e: Envelope<TopicName>; arrivalMs: number }[] {
    const rows = this.db.prepare("SELECT arrival_ms, topic, raw FROM bag WHERE arrival_ms >= ? AND arrival_ms < ? ORDER BY arrival").all(from, to) as { arrival_ms: number; topic: TopicName; raw: string }[];
    return rows
      .filter((r) => !(TOPICS[r.topic] as { photo?: string }).photo && (!o.topics || o.topics.includes(r.topic)))
      .map((r) => ({ e: decode(r.topic, r.raw), arrivalMs: r.arrival_ms }));
  }

  close(): void { this.db.close(); }
}
```

```ts
// history.ts — 기록 노드가 기록 DB(noonchi.db)에 쓰는 토픽과 줄(+ 녹화). 반성(DAY_KINDS·HABIT_KINDS)이 읽는 종류는 모두 RELIABLE에서 온다.
// 메시지 하나의 기록 줄과 처리표(bus_seen, msgId)는 한 트랜잭션이다(db.once): 다시 온 메시지는 쓰지 않는다. 가전 지난 값(device_last)도 같은 트랜잭션이다.
// 녹화는 같은 메시지를 다시 남기지 않는다. 다 쓰면 콜백이 끝나 실행기가 ack한다(실패하면 던져 다시 받는다).
// 녹화하는 SENSOR(record: true)는 커서(mode "all")로 다 읽는다. 사진 토픽과 /bus/dead는 녹화하지 않는다.
import type { BrainLog, FeedbackLog } from "../contract/events.js";
import { deviceRecorder, recordBrainLog, recordFeedback, type HistoryDb } from "../brain/index.js";
import { TOPICS, msgId, type BusNode, type TopicName } from "../bus/index.js";
import type { Bag } from "./bag.js";

type Write = (b: Record<string, unknown>) => void;

export function historyRoutes(node: BusNode, db: HistoryDb, o: { bag?: Bag; now: () => number }): void {
  const device = deviceRecorder(db, o.now);
  const logs = (list: unknown) => { for (const l of (list ?? []) as BrainLog[]) recordBrainLog(db, l); };
  const history: Partial<Record<TopicName, Write>> = {
    "/perception/analysis": (b) => logs(b.logs),
    "/world/changes": (b) => logs(b.changes),
    "/brain/decision": (b) => recordBrainLog(db, b as unknown as BrainLog),
    "/brain/link": (b) => recordBrainLog(db, b as unknown as BrainLog),
    "/act/log": (b) => (b.type === "feedback" ? recordFeedback(db, b as unknown as FeedbackLog) : recordBrainLog(db, b as unknown as BrainLog)),
    "/device/changes": (b) => device(b.state as never, b.note as never),
    "/bus/dead": (b) => { db.add("bus_gap", o.now(), `처리하지 못한 메시지: ${String(b.topic)}`, { data: b }); },
  };
  const recorded = (t: TopicName) => {
    const s = TOPICS[t] as { qos: { kind: string; record?: boolean }; photo?: string };
    return t !== "/bus/dead" && !s.photo && (s.qos.kind !== "sensor" || !!s.qos.record);
  };
  const topics = new Set<TopicName>([...(Object.keys(history) as TopicName[]), ...(o.bag ? (Object.keys(TOPICS) as TopicName[]).filter(recorded) : [])]);
  for (const topic of topics) {
    const write = history[topic];
    node.on(topic, (b, { e }) => {
      if (write) db.once({ topic, group: "recorder", key: e.key, msg: msgId(e.header), boot: e.header.boot }, () => write(b as Record<string, unknown>));
      if (o.bag && recorded(topic)) o.bag.write(e, o.now());
    }, TOPICS[topic].qos.kind === "sensor" ? { mode: "all" } : {});
  }
}
```

```ts
// node.ts — 기록 노드: 기록 DB 줄·녹화(history.ts), 잘려 놓친 SENSOR 수를 1분마다 bus_gap 줄로. prepare까지 하고 start는 띄우는 곳이 부른다.
import { BusNode, TOPICS, realClock, type Bus, type Clock, type TopicName } from "../bus/index.js";
import type { HistoryDb } from "../brain/index.js";
import type { Bag } from "./bag.js";
import { historyRoutes } from "./history.js";

export async function startRecorder(o: { bus: Bus; epoch: { boot: string; home: string }; db: HistoryDb; bag?: Bag; clock?: Clock }): Promise<BusNode> {
  const clock = o.clock ?? realClock;
  const node = new BusNode({ name: "recorder", bus: o.bus, epoch: o.epoch, clock });
  o.db.forgetOtherBoots(o.epoch.boot);
  historyRoutes(node, o.db, { bag: o.bag, now: () => clock.now() });
  const sensors = (Object.keys(TOPICS) as TopicName[]).filter((t) => (TOPICS[t].qos as { kind: string; record?: boolean }).record);
  const told = new Map<TopicName, number>();
  node.every(60_000, () => {
    for (const t of sensors) {
      const n = node.lost(t) - (told.get(t) ?? 0);
      if (n <= 0) continue;
      o.db.add("bus_gap", clock.now(), `잘려 놓친 ${t} ${n}개`, { data: { topic: t, lost: n } });
      told.set(t, node.lost(t));
    }
  });
  await node.prepare();
  return node;
}
```

```ts
// replay.ts — 격리 재생(rosbag2 재생처럼, 시뮬레이션 시계): 새 MemoryBus·가상 시계 위에 launch가 띄운 노드(가전은 dry-run)로,
// 허용 목록의 바깥 입력 토픽만 녹화의 도착 차례대로 흘린다. 메시지마다 가상 시계를 그 도착 시각까지 당기며 타이머를 하나씩 돌리고
// (타이머마다 장벽), 발행한 뒤 다시 장벽을 지난다. 통로의 다시 주기도 가상 시계로 돈다. 마지막 메시지 뒤에는 다시 주기가 다 끝나게 시계를 더 당긴다.
// 실패해도 노드를 끝내고 통로를 닫는다. 실제 통로(Redis)에는 아무것도 보내지 않는다.
import { MAX_DELIVERIES, MemoryBus, RETRY_MS, VirtualClock, type BusNode, type TopicName } from "../bus/index.js";
import type { Bag } from "./bag.js";

export const REPLAY_INPUTS: readonly TopicName[] = [
  "/perception/detections", "/perception/analysis", "/perception/look_result", "/phone/pose", "/phone/heard", "/phone/progress", "/device/changes",
];

/** 처리 장벽: 모든 노드의 줄이 비고 통로에 예약된 배달이 없는 상태가 두 번 이어질 때까지 기다린다(이어지는 발행이 몇 단계여도). */
export async function settle(bus: MemoryBus, nodes: readonly BusNode[], maxRounds = 10_000): Promise<void> {
  for (let calm = 0, round = 0; calm < 2; round++) {
    if (round > maxRounds) throw new Error("재생 장벽: 노드가 멈추지 않아요");
    await Promise.all(nodes.map((n) => n.idle()));
    await new Promise((r) => setImmediate(r));
    calm = bus.quiet() && nodes.every((n) => !n.busy()) ? calm + 1 : 0;
  }
}

export async function replay(o: { bag: Bag; from: number; to: number; launch: (bus: MemoryBus, clock: VirtualClock) => Promise<BusNode[]>; topics?: readonly TopicName[] }): Promise<{ sent: number }> {
  const rows = o.bag.range(o.from, o.to, { topics: o.topics ?? REPLAY_INPUTS });
  const clock = new VirtualClock(rows[0]?.arrivalMs ?? o.from);
  const bus = new MemoryBus({ warn: () => {}, clock });
  let nodes: BusNode[] = [];
  try {
    nodes = await o.launch(bus, clock);
    for (const n of nodes) await n.prepare();
    for (const n of nodes) n.start();
    const barrier = () => settle(bus, nodes);
    for (const { e, arrivalMs } of rows) {
      await clock.advanceTo(arrivalMs, barrier);
      await barrier();
      await bus.publish(e);
      await barrier();
    }
    await clock.advanceTo(clock.now() + RETRY_MS * MAX_DELIVERIES, barrier);
    return { sent: rows.length };
  } finally {
    for (const n of nodes) await n.stop().catch(() => {});
    await bus.close();
  }
}
```

```ts
// index.ts — 기록 노드(기록 DB·녹화)와 격리 재생.
export { Bag } from "./bag.js";
export { historyRoutes } from "./history.js";
export { startRecorder } from "./node.js";
export { REPLAY_INPUTS, replay, settle } from "./replay.js";
```

`scripts/lint-domains.ts`: `SERVER_DOMAINS`에 `"record"`, `DEPS.record = ["bus", "brain"]`, `server`에 `"record"`.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run heavy -- npx vitest run tests/record-bag.test.ts tests/record-replay.test.ts tests/history-db.test.ts tests/domain-boundaries.test.ts tests/no-frames-on-disk.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋·push**

```bash
git add src/record src/brain/history/recorder.ts src/brain/history/db.ts src/brain/index.ts src/contract/history.ts src/bus/node.ts scripts/lint-domains.ts tests/record-bag.test.ts tests/record-replay.test.ts tests/history-db.test.ts
git commit -m "feat(record): write the history DB from bus topics after each message, record topics without photos and replay inputs in an isolated bus"
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

- [ ] **Step 2: 기록 DB 같음 시험의 정답을 잡는다(묶음 2·3이 쓴다)**

`tests/helpers/history-golden.ts` `reflectionRows(db)`가 반성이 읽는 종류(detection·world·device·decision·execution·feedback)의 서로 다른 줄을 가나다 차례로 뽑는다(시각·줄 수·계획 id를 빼고, VLM·YOLO는 있는지만. 판단 주기·프레임 수는 시간에 따라 달라서). `demo-e2e`·`noonchi-e2e`·`cup-branches-e2e`의 `afterEach`가 서버를 닫기 전에 뽑아 `expectHistoryGolden`으로 `tests/fixtures/history-golden/<파일>/<시험 이름 해시>.txt`(첫 줄이 시험 이름)와 견준다. 지금 방식으로 두 번 돌려 같은지 보고 정답을 커밋한다. 묶음 2부터 같은 e2e가 통로 방식으로 같은 줄을 남겨야 한다(기록 DB 같음 시험).

- [ ] **Step 3:** 묶음 1 해시를 조정자에게 보내고 묶음 2 단계 계획을 이 파일에 더해 Codex 검토를 받는다.

---

## 묶음 2: 집 상태 노드 (입력 포함)

**구현 시점:** 2026-11-18 조정자가 지금 구현하기로 했다. 「상태 동기화는 VLM으로만」 일(`feat/vlm-objects`, `docs/superpowers/plans/2026-11-18-vlm-objects.md`)은 다른 에이전트가 만들고 나중에 합친다.

**목표:** World State를 `world` 노드 하나만 바꾼다. 집 상태 입력의 주인은 VLM 답 토픽 `/perception/scene`이다. 실행 추적이 직접 부르던 `world.guard`·`world.contentsAction`, 폰의 들은 말, 가전 상태도 토픽으로 간다. 지금 YOLO가 World State를 바꾸는 길은 큰 품을 들이지 않고 같은 토픽의 임시 갈래로 보낸다(정한 것 13). 읽는 쪽(판단·실행 추적·보기 담당·말풍선 카드·대시보드)은 `/world/state`·`/world/changes`를 받는 거울(`WorldMirror`)로 읽는다.

**사용자 결정(2026-11-18):**
- 트윈 성능(속도)을 최우선으로 제안한다. 그래서 이 묶음은 지연 예산·늘지 않게 하는 시험·줄일 수 있는 곳을 함께 정한다.
- 「집 상태(World State) 동기화는 VLM으로만 하고, YOLO는 대시보드 미니맵 표시용으로만 쓴다」(조정자 전달). `feat/vlm-objects`가 VLM 답의 사람·물건 목록으로만 World State를 바꾸게 만든다. 그 계획에서 YOLO는 미니맵 상자, 폰 위치 맞추기 기준점, 쓰러짐 신호(`applyFall`, World State로 가는 예외 길 하나)에만 남는다. 이 묶음은:
  - 집 상태 노드의 입력 주인은 `/perception/scene`(VLM)이다. `/perception/detections`(YOLO)는 대시보드 미니맵 상자로 가는 표시용 토픽이다.
  - 지금 YOLO → World State 길은 큰 품을 들여 옮기지 않는다. `/perception/scene`의 임시 갈래로 그대로 보내고 계획과 코드 주석 한 줄에 「VLM 전용으로 바뀔 자리」라고 적는다(2026-11-18 조정자: 차례와 녹화·재생이 맞고, 늘어나는 지연은 미니맵 표시 지연이라 받아들임).
- 「사람이 물건을 쓰는 중이면 그 사람이 사라질 때까지 관찰만」: domain-split에서 만드는 규칙이다. 통로로 옮길 때 실행 추적 노드의 공통 지킴으로 간다(묶음 3).

### 이 묶음에서 정한 것

1. **인식 토픽:**
   - `/perception/scene`(RELIABLE, 열쇠 `_`, 순서 기준 없음): VLM 갈래, 집 상태 입력의 주인. 갈래 다섯: 전체 사진 VLM 답(`scene`: 원본 프레임 id·촬영 시각·장면 답), VLM 분석 없음(`missing`), 가까이 본 VLM 답(`closer_scene`: `look` id), VLM 답 없이 끝난 가까이 보기(`closer_end`), 위에서 본 VLM 값(`top`: 컵 id·원본 프레임·`empty`·`has_contents`). 지금 관찰 흐름이 `applyScene`·VLM 쪽 `applyMissing`·`applyCloserScene`·`endCloser`·`applyTop`을 부르던 자리에서 같은 차례로 낸다. 순서 기준을 두지 않는 까닭: VLM 답은 약 2초 전 사진의 답이라 근거 시각으로 거르면 그사이 들어온 입력 뒤에 온 답이 버려진다. 늦은 답 판정은 지금처럼 World State 안(자리를 고친 촬영보다 새면)에서 한다.
   - `/perception/detections`(SENSOR, 표시용): 대시보드 미니맵 물체 모양(지금 `seen` 사건: 프레임 id·촬영 시각·프레임 크기·모양). 집 상태 노드는 구독하지 않는다. 토픽 표의 QoS(depth 600, 녹화)는 바꾸지 않는다.
   - 토픽 표의 `/perception/analysis`는 쓰지 않는다(분석 기록 `logs`는 기록 노드로 옮기는 묶음 3에서 정한다).
2. **사진은 싣지 않는다:** `/perception/scene`에는 JPEG가 없다. YOLO 임시 갈래의 프레임도 `EngineFrame`에서 `jpeg`·`sha256`을 뺀 것(`FrameMeta`)이고, 감지 상자·눈 자리·프레임 번호만 싣는다(모든 칸 strict라 사진 바이트 칸은 어디서든 거절, 시험 있음).
3. **감지 번호 맞추기는 집 상태 노드가 갖는다:** 관찰 흐름의 `idsOf`(프레임 → 감지 번호 → 물건 id)와 가까이 보기 `pending`(`look` id마다)을 집 상태 노드가 갖는다(30초 넘은 것은 지운다). VLM 답은 원본 프레임 id·`look` id만 싣고, 집 상태 노드가 자기 표에서 찾는다.
4. **가까이 보기의 물건 id는 VLM 합치기가 끝난 뒤 답 토픽으로:** 가까이 보기 결과(`found`)의 물건 id는 VLM 답까지 넣은 뒤에야 정해진다(그 답이 3장 안 된 후보를 물건으로 만들면 id가 더해진다). 그래서 잘라 본 장의 YOLO 합치기는 `/perception/scene`의 `closer_merge`(look·잘라 본 장·원본 프레임)로 보내고 기다리지 않는다. VLM 답은 `/perception/scene`의 `closer_scene`(답이 없으면 `closer_end`)으로 가고, 집 상태 노드는 그것을 넣은 뒤 `/world/closer {look, ids}`(RELIABLE, 열쇠 `look`, 감지 번호·VLM 물건 번호 → 물건 id 최종 표)를 낸다. 인식 노드는 `Pending`으로 `look`을 맞추고 그 표로 `found`를 채운다. `closer_end`를 낼 때도 같은 답을 기다린다. 기한(2초) 안에 답이 없으면 `closerMiss("world_timeout")`, 인식 노드를 끝내면 기다리던 답은 `closed`로 끝낸다. `feat/vlm-objects`의 가까이 보기(VLM 답이 올 때까지 합치기를 미루고, `found`에 VLM이 상자로 답한 물건을 `via: "vlm"`로 더함)와 같은 모양이다: 그쪽을 합칠 때 `closer_scene`에 VLM 상자 자리(`view`·크기·`crop`)를 더하고 `/world/closer`의 표에 VLM 물건 번호가 들어간다.
5. **읽기는 거울로:** `src/world/mirror.ts` `WorldMirror`가 `/world/state`(STATE)와 `/world/changes`(RELIABLE, `withState`)를 받아 `view()`(가장 새 상태)와 변화 콜백을 준다. 판단(`Decider`의 `world`는 `{ view(now) }`만 쓴다)·실행 추적·보기 담당·말풍선 카드·`/api/world`·대시보드 방송이 거울을 읽는다. 인식 노드는 가까이 보기 대상 고르기·위에서 보기 쌍 찾기에 자기 `/world/state` 구독의 가장 새 상태를 읽는다. 이 묶음에서 집 묶음 안의 읽는 쪽은 거울 하나(이름 `act`)를 같이 쓴다. 노드마다 따로 받는 것은 그 노드를 옮기는 묶음 3·4에서 한다.
6. **상태를 내는 때:** 입력 하나를 넣어 변화가 있으면 `rev`를 1 올리고 `/world/state {rev, view}`와 `/world/changes {rev, changes}`를 이 차례로, 앞 발행을 기다리지 않고 함께 낸다(대시보드는 한 번 지나기로 받고, 변화를 받는 쪽은 상태를 기다리며 내려놓지 않는다). 시간이 지나야 바뀌는 칸(`closer_hold`·`person.near`·가전 남은 시간·`at_ms`)이 있으므로 250ms마다(지금 판단 타이머와 같은 간격) `world.tick`을 넣고 같은 `rev`로 `/world/state`를 다시 낸다. 거울의 `view()`는 지금보다 최대 250ms + 지나는 시간 늦다(지금도 판단·실행 추적·보기 담당은 250ms마다 본다).
7. **대시보드 방송은 `rev`가 바뀔 때만:** 거울이 `rev`가 바뀐 상태만 대시보드로 보낸다(250ms 다시 냄은 보내지 않는다). 지금과 같은 횟수다. 대시보드 트윈이 더 자주 다시 그리지 않는다.
8. **입력 토픽:** `/world/input`(RELIABLE, act): `{kind: "guard", id, on, at_ms}`·`{kind: "contents", id, on, at_ms}`. `/phone/heard`(RELIABLE, phone): `{text, observed_ms}` → `world.heard`. `/device/changes`(RELIABLE, devices): `{id, state, note}`. 첫 상태(`note.initial`)는 변화 없이 넣는다(지금 `startLoop`의 시작 가전 상태와 같음). 가전 목록(`signals.list()`)은 집 상태 노드가 허브에서 읽는다(지금과 같음).
9. **기록 DB는 이 묶음에서 그대로 `attachRecorder`다:** 판단·실행·계획·운영 모드 기록이 아직 집 묶음 방송으로 온다. 집 상태 변화만 기록 노드로 옮기면 한 줄이 빠지거나 두 번 남는다. 기록 노드로 바꾸는 것은 모든 기록 줄이 토픽으로 오는 묶음 3 끝에 한 번에 한다. 이 묶음에서는 거울이 받은 변화의 `world_change` 기록을 지금 `emit`으로 넘긴다(같은 줄·같은 차례, 기록 DB 같음 시험이 본다).
10. **통로 하나:** 서버(`src/server/start.ts`)가 켜질 때 `boot`(UUID)와 `openBus(env, {boot, log, onLost})`로 통로 하나를 열고 집을 바꿔도 같은 통로를 쓴다. 집 세대 `home`은 `<집 id>#<연 횟수>`. `onLost`는 「Redis가 다시 켜져…」를 남기고 서버를 끝낸다(끝 코드 1, compose `restart`가 새 기동으로). 집을 닫을 때는 새 일을 만드는 쪽(인식) → 집 상태 → 거울 차례로 `stop()`한다.
11. **가까이 보기·위에서 보기 요청은 묶음 3:** 보기 담당(`src/act/look.ts`)이 관찰 흐름의 `closer()`·`topLook()`·`latest()`를 부르는 것은 이 묶음에서 그대로 둔다. 묶음 3에서 실행 추적 노드와 함께 `/perception/look_request`·`/perception/look_result`로 바꾼다(이 계획 12).
12. **RedisBus 지나기를 먼저 줄인다(Task 1, 아래 지연 예산 근거):** 이 PC에서 RedisBus 한 번 지나기가 RELIABLE p50 8.3ms·STATE p50 6.5ms로 PING 왕복(1.5ms)의 4~6배다. 이대로면 프레임 → 집 상태 발행에 두 번 지나며 약 15ms가 더해져 한도를 넘는다. 묶음 2의 노드를 잇기 전에 줄인다.
13. **YOLO → World State 임시 갈래(VLM 전용으로 바뀔 자리):** 지금 관찰 흐름이 YOLO로 World State를 바꾸는 네 곳(`setEye`, 프레임 감지 `applyDetections`, YOLO 쪽 `applyMissing`, 가까이 보기 합치기 `applyCloser`)은 `/perception/scene`의 임시 갈래 넷(`eye`·`frame`·`yolo_missing`·`closer_merge`)으로 VLM 답과 같은 토픽에 낸다. 한 토픽이라 같은 프레임의 YOLO 입력은 그 프레임 VLM 답보다 늘 먼저 들어가고(맞추는 대기가 없다), 녹화·재생에 그대로 남는다(재생 시험: 컵 등장·사실·가까이 보기 결과가 바로 넣은 것과 같다). YOLO 프레임이 통로를 한 번 더 지나므로 프레임 → 대시보드 지연이 MemoryBus 약 +0.8ms, Redis 약 +3.3ms 는다(미니맵 표시 지연이고 판단 지연이 아니다. Task 6 뒤 다시 재서 지연 예산 표에 적고, 한도 23.5ms를 넘으면 멈춘다). `feat/vlm-objects`를 합친 뒤 이 임시 갈래는 쓰러짐 신호(`fall`) 하나만 남는다(같은 토픽이라 VLM 답과 차례가 지켜진다).
14. **들은 말은 지금처럼 판단에만, 기록에는 표시만:** `/phone/heard`로 넣은 `heard` 변화는 거울이 판단에만 넘기고 실행 추적에는 넘기지 않는다. `world_change` 기록과 대시보드에는 지금처럼 `HEARD_MARK`(`KEEP_HEARD_TEXT=1`이면 말 그대로)만 남긴다.

### 지연 예산(사용자 결정: 트윈 성능 최우선)

재는 법: `tests/latency-world.test.ts`(Task 0), `scripts/bus-latency.ts`(통로 한 번 지나기·Redis 왕복, 500번씩 두 판). 이 PC(Windows 11, Node 22), 2026-11-18. 실제 Redis는 `compose.dev.yaml`의 `noonchi-redis`(Docker Desktop, WSL 거침). AWS EC2(리눅스, 같은 호스트)의 왕복은 이보다 훨씬 짧을 것이라 이 PC 값은 나쁜 쪽 값이다.

| 구간 | 지금(통로 전) | 통로 한 번 지나기: MemoryBus / RedisBus(p50·p95) | 묶음 2 뒤 예상 p95 |
|---|---|---|---|
| 엔진 프레임 → 집 상태 발행(대시보드 world) | p50 7.9ms · p95 13.5ms(감지기 시간 뺌, 40장) | RELIABLE(`/world/changes` 113바이트) 0.47·0.79ms / Task 1 뒤 2.4·3.2ms(전 8.3·9.5ms). STATE(`/world/state` 18.4KB) 0.54·0.86ms / Task 1 뒤 3.3·4.1ms~3.7·4.8ms(두 판, 전 6.5·7.6ms). 실제 몸 모양 검사(Task 2·최상위 칸 검사) 뒤 MemoryBus RELIABLE 0.48~0.50·0.70~0.78ms, STATE 0.56~0.57·0.73~0.84ms(두 판, 그대로) | 프레임 → `/perception/scene`(RELIABLE) → 집 상태 노드 → `/world/state`(STATE), 두 번 지남(상태를 변화보다 먼저 냄). MemoryBus 약 15.2ms(13.5 + 0.8 + 0.9), RedisBus 약 21.6ms(13.5 + 3.3 + 4.8). Task 6 뒤 실제 값으로 고친다 |
| 집 상태 변화 → 판단 시작(PAM 요청), event 모드 | 47·123·191·235ms(4번): 250ms 판단 타이머 기다림이 거의 전부. 기본 periodic 모드는 5초 주기라 0~5초 | 변화 한 번 지나기(위 RELIABLE) | 타이머가 그대로면 지금 + 한 번 지나기(아래 「줄일 수 있는 곳」 2) |
| 실제 감지(YOLO26s-seg) | DirectML 약 144ms · CPU 8스레드 약 218ms(구현명세서 4절) | — | 그대로 |
| Redis PING 왕복 | — | p50 1.57ms · p95 2.1ms | — |
| Redis 맨 전달: 이 PC 바닥(통로 없이 같은 크기 값을 `XADD` → 막고 읽던 다른 연결의 `XREAD`가 깨어남) | — | `/world/changes` 크기 p50 2.4·2.5ms · p95 3.0·3.1ms. `/world/state` 크기 p50 3.1·3.3ms · p95 3.8·4.1ms | AWS에서 다시 잴 것: 배포한 EC2의 noonchi 컨테이너 안에서 `scripts/bus-latency.ts`(PING·맨 전달·RedisBus 한 번 지나기)를 돌려 이 표에 더한다 |
| 봉투 만들기·읽기·검사(`/world/state` 18.4KB) | — | p50 0.27ms · p95 0.46ms. 최상위 칸·사진 칸 검사 뒤 p50 0.28ms · p95 0.49~0.54ms | — |

Task 1 뒤 RedisBus 한 번 지나기는 같은 크기 맨 전달과 p50이 같거나 0.6ms 안쪽으로 더 걸린다(통로가 왕복을 더하지 않는다). STATE p50 3ms는 이 PC에서 닿을 수 없다: 18.4KB 맨 전달의 바닥이 p50 3.1~3.3ms다(Docker Desktop 포트 전달에서 18KB 한 번 오가기가 PING보다 약 1.5ms 더 든다). AWS EC2 같은 호스트에서는 이 바닥이 훨씬 낮다.

### 늘지 않게 하는 장치

- `tests/latency-world.test.ts`: 폰 엔진 프레임을 150ms 간격으로 45장 보내(감지 실패 대본이라 프레임마다 변화 하나) 프레임 → 대시보드 world 지연을 잰다. 기준은 `tests/fixtures/latency/world.json`(묶음 2 전 이 PC: p50 7.9ms, p95 13.5ms). **p95가 기준 p95의 1.5배와 기준 + 10ms 가운데 큰 값(23.5ms)을 넘으면 같은 서버로 한 번 더 재고, 두 판 다 넘으면 실패**한다(이 PC에서 다른 일이 잠깐 몰리면 한 판이 p95 25.4ms까지 튀었고 바로 다음 판은 12.7ms였다). 묶음 2 끝 조건이고 묶음 3~6 끝 조건에도 남긴다. 다른 PC에서는 `LATENCY_BASELINE=write`로 그 PC의 기준을 먼저 잰다.
- `scripts/bus-latency.ts`를 `REDIS_URL`과 함께 묶음 끝마다 돌려 위 표의 RedisBus 값을 고쳐 적는다(CI에는 Redis가 없어 MemoryBus만 시험이 막는다).

### 줄일 수 있는 곳(근거와 함께)

1. **RedisBus 한 번 지나기(이 묶음 Task 1에서 한다):** RELIABLE은 ack 뒤 자르기를 메시지마다 하지 않고 모아서(1초마다 또는 100번마다 한 번), `XACK`는 다음 `XREADGROUP`과 한 번에 보낸다(파이프라인). STATE는 `INCR`·`HSET`·`XADD`를 Lua 하나(왕복 1번)로, 알림에 값을 같이 실어 받는 쪽 `HGET`을 없앤다(알림 스트림 `MAXLEN ~64` × 18KB ≈ 1.2MB). 밀린 알림은 열쇠마다 마지막 값만 준다. 결과: RELIABLE p50 8.3 → 2.4ms, STATE p50 6.5 → 3.3~3.7ms(같은 크기 맨 전달 바닥 3.1~3.3ms), 통로 계약 시험 그대로 통과.
2. **event 모드 판단을 변화가 올 때 바로 시작:** 지금 판단은 250ms 판단 타이머(`src/server/home/observe.ts` `startLoop`)가 `decide.tick()`을 부를 때만 시작한다. event 모드의 변화 → 판단 시작(47~235ms)은 거의 이 타이머 기다림이다. 판단 노드(묶음 4)가 `/world/changes`를 받을 때 계기를 바로 보면 평균 약 125ms 줄어든다. 기본 periodic 모드(5초 주기)는 주기가 정하므로 그대로다. 묶음 4 단계 계획에서 정한다.
3. **인식이 World State·읽는 쪽을 기다리지 않는다(이 묶음에서 저절로 생김):** 지금 `ObservationPipeline.publish()`는 감지 대기열을 비우는 고리 안에서 `world.apply…` → `tracking.onWorld` → `decide.onChanges` → `world.view()`(18.4KB) → 대시보드 JSON까지 같이 돈다(`src/observe/pipeline.ts` `publish`). 통로 뒤에는 인식 노드가 토픽만 내고 다음 프레임 감지로 간다. 감지가 밀릴 때(실제 YOLO 144~218ms) 다음 감지 시작이 그만큼 앞당겨진다.
4. **집 상태 보기(`view`)를 한 번만 만든다:** 지금은 판단·실행 추적·보기 담당·말풍선 카드가 250ms마다 저마다 `world.view(now)`를 부른다(초당 16번 이상, 한 번 18.4KB 객체). 통로 뒤에는 집 상태 노드가 `rev`마다·250ms마다 한 번 만들고 거울이 같은 객체를 나눠 준다.
5. **대시보드가 밀리면 가장 새 것만:** 변화가 몰릴 때(가까이 보기 합치기 등) 중간 상태 방송을 건너뛰면 트윈 다시 그리기가 준다. 이 묶음은 지금 횟수보다 늘지 않게만 하고(정한 것 7), 건너뛰기는 대시보드 시험(`ui/tests/dashboard/steps.test.tsx`)과 함께 따로 제안한다.
6. **집 상태를 통째로 말고 바뀐 부분만 보내기(적어만 둔다, 이 묶음에서 하지 않음):**
   - 얻는 것: 한 번에 18.4KB 대신 바뀐 물건·사람 몇 개(수백 바이트)만 지난다. 이 PC에서 STATE 한 번 지나기가 작은 몸 바닥(p50 약 2.4ms)으로 내려가 약 1ms 준다. 봉투 만들기·읽기·검사 0.27ms도 거의 없어진다. 250ms 다시 냄(초당 4번 × 18KB)과 Redis 알림 스트림(약 1.2MB)도 준다.
   - 잃는 것: STATE는 늦게 붙은 노드에게 통째 값을 줘야 하므로 통째 값(열쇠 값)과 바뀐 부분(알림)을 같이 둬야 한다. 받는 쪽은 `rev`가 이어질 때만 바뀐 부분을 붙이고, 하나라도 건너뛰면 통째 값을 다시 읽어야 한다. 집 상태 노드에 차이 만들기, 거울에 차이 붙이기와 그 시험이 새로 든다. `at_ms`·`closer_hold`·가전 남은 시간처럼 250ms마다 바뀌는 칸이 있어 다시 냄마다 몇 칸은 늘 나간다.
   - 판단: 얻는 것은 이 PC에서 한 번 지나기 약 1ms이고, AWS(같은 호스트 컨테이너 사이)에서는 18KB 전달이 훨씬 짧아 거의 없다. AWS에서 다시 잰 값에서 STATE 지나기가 프레임 → 대시보드 지연의 큰 몫일 때 다시 본다.

### 파일

| 파일 | 맡는 일 |
|---|---|
| `src/bus/redis.ts` | Task 1: 모아서 자르기, ack 파이프라인, STATE Lua 발행·알림에 값 싣기 |
| `src/bus/topics.ts` | `/perception/scene`(VLM 갈래 다섯)·`/perception/detections`(미니맵 물체 모양)·`/world/input`·`/world/state`·`/world/changes`·`/phone/heard`·`/device/changes`의 실제 몸 모양(zod, `src/contract/`와 같음을 타입으로 묶음, Task 2). `/world/closer {look, ids}`(Task 3) |
| `src/contract/world.ts` | `SceneInput`(VLM 갈래), `FrameMeta`, `WorldInput`, `WorldStateMsg {rev, view}`, `WorldChangesMsg {rev, changes}` |
| `src/world/accept.ts` | `accepts(d)`·`closerObject(d)`를 상태 없는 함수로 뺀다(지금 `core.accepts`·`closer.closerObject`와 같은 식) |
| `src/world/node.ts` | `startWorldNode(o)`: 입력 토픽(YOLO 임시 갈래 포함)을 노드 줄에 들어온 차례로 넣고(`WorldInputs`, 관찰 흐름 시험 대역도 같이 씀) `rev`·상태·변화와 가까이 보기 답(`/world/closer`)을 낸다. 250ms `tick` |
| `src/world/mirror.ts` | `WorldMirror`: `/world/state`·`/world/changes`를 받아 `view()`·변화 콜백·대시보드 방송 |
| `src/observe/pipeline.ts` | `world` 대신 `WorldPort`(`send(i)`로 `/perception/scene` 입력 하나, `closerIds(look)`, `view()`). `idsOf`·`publish()` 삭제, 물체 모양은 `onSeen` 그대로 |
| `src/observe/node.ts` | `startPerceptionNode(o)`: `WorldPort`의 입력은 `/perception/scene`으로, 가까이 보기 답은 `/world/closer`를 `Pending`으로, `view()`는 자기 `/world/state` 구독으로. 물체 모양은 `/perception/detections`로 |
| `src/server/start.ts` | 통로 열기(`boot`·`onLost`) |
| `src/server/home/observe.ts`·`act.ts`·`phone.ts`·`devices.ts`·`index.ts`·`say.ts`·`core.ts` | `core.world`(WorldState) 대신 `core.mirror`, 노드 띄우기·닫기 차례, `/world/input`·`/phone/heard`·`/device/changes` 내기 |
| `src/brain/decide.ts` | `world: WorldState` → `world: { view(now: number): WorldView }` |
| `tests/latency-world.test.ts`, `tests/fixtures/latency/world.json`, `scripts/bus-latency.ts` | Task 0(끝남) |
| `tests/world-node.test.ts`, `tests/world-mirror.test.ts`, `tests/observe-node.test.ts`, `tests/world-accept.test.ts` | 새 시험 |

### Task 0: 지연 기준 재기(끝남)

`tests/latency-world.test.ts`·`tests/fixtures/latency/world.json`·`scripts/bus-latency.ts`를 이 계획과 같이 커밋했다. 위 「지연 예산」 표의 지금 값이 이것으로 잰 값이다. `LATENCY_OUT=<파일>`이면 잰 값을 한 줄 JSON으로 남기고, `LATENCY_DECIDE=1`이면 변화 → 판단 시작도 잰다(재기만).

### Task 1: RedisBus 지나기 줄이기

**Files:** Modify `src/bus/redis.ts`. Test: `tests/bus-redis.test.ts`(계약 그대로), `scripts/bus-latency.ts`(잼).

- [x] 실패 시험(Redis 전용): 「메시지 100개를 받는 동안 `XTRIM`을 메시지마다 부르지 않고, 다 받은 뒤에는 잘린다」(`INFO commandstats`의 `cmdstat_xtrim` 호출 수 10 이하, 전 100), 「STATE 받는 쪽은 `HGET`을 부르지 않는다」(`cmdstat_hget` 0, 전 20), 「RELIABLE·STATE 한 번 지나기 p50은 같은 크기 Redis 맨 전달 p50보다 1ms 넘게 늘지 않는다」(전 RELIABLE 9.7ms, 맨 전달 2.6ms). 셋 다 바꾸기 전 코드에서 실패했다.
- [x] 구현: RELIABLE은 ack 뒤 자르기를 100번 또는 1초마다 한 번(읽기 줄 밖에서, 처음 ack는 바로), `XACK`는 구독 연결에서 답을 기다리지 않고 보내 다음 `XREADGROUP`과 같이 기다림. STATE 발행은 Lua(`INCR`·`HSET`·`XADD` 값 포함), 받는 쪽은 알림의 값을 쓰고 건너뜀이면 `HGETALL` 스냅숏.
- [x] 통과 확인: 통로 계약 열셋·Redis 전용 시험(Docker 규칙), `scripts/bus-latency.ts`(맨 전달도 잼)로 잰 값을 위 표에 적었다. 커밋·push.

### Task 2: 인식·집 상태 토픽의 모양과 상태 없는 감지 거르기

**Files:** Modify `src/contract/world.ts`, `src/bus/topics.ts`, `src/world/state/core.ts`·`closer.ts`(`accepts`·`closerObject`를 `src/world/accept.ts` 함수로), `src/world/index.ts`. Test: `tests/bus-topics.test.ts`, `tests/world-accept.test.ts`.

- [x] 실패 시험: `/perception/scene`은 갈래 다섯(`scene`·`missing`·`closer_scene`·`closer_end`·`top`)만 받고 `jpeg`·`jpeg_b64` 칸이 있으면 거절한다. `/perception/detections`는 미니맵 물체 모양(`seen` 사건의 프레임 id·크기·모양 + `observed_ms`)만 받는다. `/world/state`는 `{rev, view}`, `/world/changes`는 `{rev, changes}`, `/world/input`은 `guard`·`contents`, `/phone/heard`는 `{text, observed_ms}`, `/device/changes`는 `{id, state, note}`(묶음 1 기록 노드와 같은 모양)만 받는다. `accepts`·`closerObject` 함수가 지금 `WorldState` 메서드와 같은 답을 낸다(낱말 표 모든 종류 × 점수 경계). 기록 노드는 `/world/changes`의 `WorldChange`를 지금과 같은 `world_change` 줄로 쓰고, 프레임마다 분석 없음은 쓰지 않고 들은 말은 `HEARD_MARK`만 쓴다.
- [x] 구현: 계약 타입(`SceneInput`·`WorldInput`·`WorldStateMsg`·`WorldChangesMsg`·`FrameMeta`)과 zod 모양, `src/bus/topics.ts` `TopicBodiesSame`(`Assert<Equal<…>>`)로 계약과 같음을 tsc가 본다. `/world/state`의 보기는 깊이 검사하지 않는다(18KB, 지나기마다 세 번 검사). 상태 없는 함수로 빼고 `WorldState`는 그 함수를 부른다.
- [x] 통과 확인: `tests/bus-topics.test.ts`·`tests/world-accept.test.ts`·`tests/world-state.test.ts`·`tests/world-closer.test.ts`·통로·기록 시험, typecheck, lint. 커밋(push는 조정자가 한다).

### Task 3: 집 상태 노드

**Files:** Create `src/world/node.ts`. Test: `tests/world-node.test.ts`.

**Interfaces:** `startWorldNode(o: { bus: Bus; epoch; world: WorldState; clock?: Clock; tickMs?: number; log? }): Promise<{ node: BusNode }>`(prepare까지). 받는 것: `/perception/scene`(VLM 갈래 다섯 + YOLO 임시 갈래 넷)·`/world/input`·`/phone/heard`·`/device/changes`. 내는 것: `/world/state`·`/world/changes`·`/world/closer`. 입력을 넣는 일은 `WorldInputs`(감지 번호 표·가까이 보기 표)가 하고, 관찰 흐름 시험 대역이 같이 쓴다.

- [x] 실패 시험(`tests/world-node.test.ts`, MemoryBus·VirtualClock):
  - 같은 입력 차례를 `WorldState`에 바로 넣은 것과 집 상태 노드에 토픽으로 넣은 것의 변화 줄·`view`가 같다(YOLO 갈래 감지 → VLM 답, `closer_merge` → 그 VLM 답, 위에서 본 값, 분석 없음).
  - `closer_scene`·`closer_end`를 넣은 뒤 `/world/closer {look, ids}`를 내고, 그 표는 VLM 답이 만든 물건 id까지 담은 최종 표다(`WorldState`에 바로 넣고 본 `ids`와 같다).
  - 변화가 있을 때만 `rev`가 오르고 상태·변화를 같은 `rev`로, 상태를 먼저 낸다. 변화 없는 입력은 `rev`를 올리지 않는다. 250ms마다 같은 `rev`로 상태를 다시 낸다(가상 시계).
  - `/world/input` 지킴·따르기 창이 `world.guard`·`contentsAction`과 같다. 없는 물건이면 아무것도 하지 않는다.
  - 가전 첫 상태(`initial`)는 변화를 내지 않는다.
  - 1620be1 다시 들어오기: 변화를 받는 쪽이 같은 콜백 안에서 `/world/input`을 내도 그 입력은 지금 콜백이 끝난 뒤에 넣는다.
  - 발행이 실패해 다시 받은 입력은 다시 넣지 않고 남은 출력(변화·판본·가까이 보기 답)만 다시 낸다. 30초 넘은 가까이 보기 후보는 지우기 전에 `endCloser`로 끝낸다(Codex 0d81106 전 지적).
- [x] 구현: 입력마다 `world`에 넣고, 변화가 있으면 `rev++` → `/world/state`·`/world/changes`를 함께 발행. `idsOf`·가까이 보기 `pending`을 노드 안 표로(30초 넘은 것은 지운다). YOLO 임시 갈래 코드에 「VLM 전용으로 바뀔 자리」 주석 한 줄.
- [x] 통과 확인(`tests/world-node.test.ts`·`tests/bus-topics.test.ts`·World State 시험, typecheck, lint), 커밋. World State의 프레임 인자는 사진 없는 `FrameMeta`로 바꿨다(타입만).

### Task 4: 거울

**Files:** Create `src/world/mirror.ts`. Test: `tests/world-mirror.test.ts`.

**Interfaces:** `startWorldMirror(o: { bus; epoch; name: NodeName; clock?; log?; onChanges?(c: WorldChange[], view: WorldView): void; onView?(view: WorldView): void }): Promise<{ node: BusNode; view(): WorldView | null; rev(): number | null }>`(prepare까지). 상태 하나의 구독으로 보기·변화를 다 받는다(`withState`의 `onState`: 같은 노드가 상태를 두 번 구독하면 낡은 메시지 거르기가 둘째를 버린다).

- [x] 실패 시험: 변화는 그 `rev` 이상의 상태를 가진 뒤에 `onChanges`로 오고 그때 `view()`도 그 상태다(P2-7). `onView`는 `rev`가 바뀔 때만 부른다(250ms 다시 냄은 부르지 않음). 늦게 붙어도 가장 새 상태를 바로 받는다(STATE).
- [x] 구현, 통과 확인(`tests/world-mirror.test.ts`·`tests/bus-node.test.ts`, typecheck, lint), 커밋.

### Task 5: 관찰 흐름을 인식 노드로

**Files:** Modify `src/observe/pipeline.ts`(`world` → `WorldPort`, `idsOf`·`publish()` 삭제), Create `src/observe/node.ts`. Test: `tests/observe-node.test.ts`, 기존 `tests/observe-*.test.ts`·가까이 보기·위에서 보기 시험(그 시험들은 `WorldState`를 바로 넘기던 것을 `WorldState`를 바로 부르는 시험 대역 `tests/helpers/world-port.ts`로 바꾼다. 대역은 같은 차례로 넣고 같은 `ids`를 돌려준다).

- [ ] 실패 시험: 프레임 하나에 `/perception/scene`으로 `eye` → `frame` 차례(사진 없이), VLM 답은 `/perception/scene`으로 내고 JPEG를 싣지 않는다. 가까이 보기는 `/world/closer` 답(VLM 합치기 뒤 최종 표)으로 `found` id를 채운다(VLM 답이 새로 만든 물건 id 포함). 답이 2초 안에 없으면 `world_timeout`, 기다리는 중 인식 노드를 끝내면 `closed`로 끝난다(끝내기가 걸리지 않음). 감지 대기열 고리가 변화 콜백·`view()`를 부르지 않는다. 물체 모양은 `/perception/detections`로 낸다.
- [ ] 구현, 통과 확인, 커밋·push.

### Task 6: 집 묶음 잇기

**Files:** Modify `src/server/start.ts`(통로), `src/server/home/core.ts`(`world` → `mirror`·노드), `observe.ts`(노드 띄우기, `startLoop`의 `observed.tick()`·가전 구독 빼기: 집 상태 노드가 맡음, 미니맵은 `/perception/detections` 구독 → 대시보드), `act.ts`(`guardObject`·`contentsAction` → `/world/input`, `world` → 거울), `phone.ts`(`heardSpeech` → `/phone/heard`), `devices.ts`(허브 구독 → `/device/changes`), `say.ts`·`index.ts`(`/api/world`·닫기 차례), `src/brain/decide.ts`(`world` 타입).

- [ ] 실패 시험: `tests/observe-start.test.ts`에 「집을 닫으면 인식 → 집 상태 → 거울 차례로 끝나고 그 뒤 변화가 대시보드로 가지 않는다」, `tests/server.test.ts`에 「통로를 잃으면(가짜 통로의 onLost) 서버가 끝 코드 1로 끝난다」, 들은 말은 기록에 `HEARD_MARK`만 남고 실행 추적에 가지 않는다(정한 것 14).
- [ ] 구현: `grep -n "world\.\(guard\|contentsAction\|apply\|heard\|tick\|setEye\)" src/server src/act src/observe src/phone src/brain`이 `src/world/` 밖에서 빈다.
- [ ] 통과 확인: 기존 `tests/world-*.test.ts`·`tests/act-track*.test.ts`·`tests/observe-*.test.ts`. 커밋·push.

### Task 7: 묶음 2 끝 조건

- [ ] 묶음 공통(데모 e2e 넷·영상 모드 셋·`ui/tests/phone-mode-parity.test.ts`·typecheck·lint).
- [ ] 기록 DB 같음 시험: e2e 세 파일의 `afterEach` 정답이 그대로 통과한다(정답 파일을 고치지 않는다).
- [ ] 지연: `tests/latency-world.test.ts`가 한도 안(MemoryBus). `REDIS_URL`을 주고 `scripts/bus-latency.ts`와 이 시험을 한 번씩 돌려 값을 「지연 예산」 표에 적는다(Docker 규칙).
- [ ] `grep` 끝 조건(Task 6).
- [ ] 해시를 조정자에게 보내고 묶음 3 단계 계획을 이 파일에 더한다(domain-split을 합친 뒤라면 「VLM 메인」 확정 규칙 계획과 「사람이 쓰는 중이면 관찰만」 공통 지킴을 함께 본다).

## 묶음 3: 실행 추적 ↔ 폰 (콜백 22개)

**목표:** 실행 추적 노드(`act`)가 폰·대시보드와 토픽으로만 주고받는다. 폰 사용권 표가 흩어진 막기를 대신한다.

**공통 지킴(사용자 결정 2026-11-18):** 「사람이 물건을 쓰는 중이면 그 사람이 사라질 때까지 관찰만」(domain-split에서 만드는 규칙)을 실행 추적 노드의 공통 지킴 하나로 옮긴다: 계획 시작·단계 명령·가까이 가서 보기 모두 이 지킴을 먼저 본다. 묶음 3 단계 계획에서 domain-split의 구현과 시험을 그대로 옮긴다.

**콜백 → 토픽**(`src/server/home/act.ts:100-151`):

| 콜백 | 묶음 3 뒤 |
|---|---|
| `plans`(PlanHub 방송) | `/act/plan`(STATE) → `phone`이 대시보드로 |
| `floor`, `locate`, `names` | `layout` 도구(읽기만) |
| `world` | `/world/state` 구독(`withState`) |
| `emit` | `/act/log`(RELIABLE, 기록 DB `execution`·`feedback`) |
| `clock`, `offsetMinutes` | 노드 시계·설정 |
| `approvals` | `act` 노드가 가진 승인 기억(쓰는 곳 하나), 답은 `/phone/progress` |
| `devices` | `/device/command`(`command_id`·`deadline_ms`) → `/device/result`(묶음 5에서 가전 노드로) |
| `precheck`, `planner` | 묶음 4까지 `act` 안, 묶음 4에서 `brain`으로 |
| `toPhone` | `/act/phone_command`(STATE, `req` = 명령 id·단계) + `/phone/claim` `plan`(claim id = 계획 id·단계) |
| `check`, `lessons` | `act` 안 |
| `handDevices` | `/device/state` 구독 |
| `phoneReady` | `/phone/link`(STATE) |
| `sayAloud` | `/phone/say` + `/phone/claim` `safety` |
| `stalled`, `lookContents`, `strayed` | `act` 안 보기 담당(`Looker`) |
| `topReady`, 보기 담당의 `closer`·`topLook`·`latest` 직접 부르기 | 없앤다: `/perception/look_request`·`/perception/look_result`(위에서 보기는 쌍을 기다리는 요청 하나, 이 계획 12). 묶음 2에서 옮김 |
| `guardObject`, `contentsAction` | `/world/input`(묶음 2) |
| `approvalsWaiting`, `talking` | `/phone/owner`(사용권 표, claim id) |
| `tasks` | `/act/status` 안 지금 도움 모드 행동 목록(설정) |
| 실제 폰 「완료」·답·「그만」·단계 영상 끝 | `/phone/progress`(RELIABLE, `req` = 명령 id·단계, `Pending`에 없으면 버림 — 58246d8·c966b20·6a2efe9·cb07b65 사례) |
| 주기 `tracking.tick()`·`looking.tick()`(`startLoop` 250ms) | `act` 노드 타이머(`every(250)`, 같은 줄 — a243ea5·6fb2d1d 사례) |

**폰 사용권:** `src/phone/owner.ts` `phoneOwner(claims): Claim | null`(표의 차례, 같은 차례면 먼저 낸 claim), `phone` 노드가 `/phone/claim`(열쇠 claim id)을 받아 고르고 `/phone/owner {claim_id, kind}`를 낸다. 승인 대기 시간은 그 claim이 화면에 있을 때만 흐른다(`policy.pause` 대신).

**시험:** `tests/phone-owner.test.ts`(표 차례 다섯, 계획 승인과 대화 승인이 서로 덮지 않음, 높은 것이 사라지면 낮은 것이 다시 나옴, 승인 시간 멈춤은 그 claim만), `tests/act-node.test.ts`(지난 명령의 「완료」를 버림, 「그만」·새 계획·계획 밖 보기 거두기의 차례 — e54860d·4dc5de7 사례, 집을 닫으면 돌던 추적 콜백이 취소되고 그 뒤 명령이 나가지 않음), 기존 `tests/act-track*.test.ts`는 실행 추적 함수를 그대로 시험해 통과.

**끝 조건:** 묶음 공통 + 기록 DB 같음 시험 + `ExecutionTracker` 생성자 옵션에 함수가 `planner`·`precheck`·`check` 말고 남지 않는다.

## 묶음 4: 판단 노드

**목표:** `brain` 노드가 `/world/state`·`/world/changes`·`/act/status`·`/phone/heard`를 받아 판단하고(`/brain/decision`), 계획 전 검사와 계획 모드를 돌려 `/brain/plan`을 낸다. 실행 추적은 `/brain/plan`을 받아 실행 전 검사·실행만 한다. 「그만」이 계획 만드는 중이면 `act`가 `/brain/cancel`을 낸다. LLM 호출(PAM·계획 모드)은 `node.spawn()`으로 띄워 노드 수명 신호를 받고(stop이 끊고 기다림), 답은 `node.post()`로 줄에 넣어 `req`로 맞춘다(실행기 줄을 오래 막지 않는다).

**바뀌는 자리:** `Decider`의 `hold`(`tracker.waiting()·coaching()`) → `/act/status`, `keepHeard` → `/phone/heard`, `onDecision` → `/brain/decision`, 생각 메시지 → `/brain/thought`, PAM 연결 → `/brain/link`, 반성은 `brain` 노드의 하루 끝 타이머(끝내기 계약으로 끊는다).

**정할 것(묶음 4 단계 계획에서):**
- 재생 장벽은 `spawn()` 일을 세지 않는다(Codex edd2e13). 모델 응답을 녹화 입력으로 재생하거나(답을 토픽으로 내고 `REPLAY_INPUTS`에 더함, 실제 모델을 부르지 않음), 재생용 완료 기준을 정한다.
- 사용자 결정: 판단 노드는 그날 FSM 기억을 하루 한 번 읽어 메모리에 둔다(그날 판본은 하루 동안 고정). 판단마다 SQLite를 읽지 않고, 반성이 새 판본을 저장하거나 날이 바뀔 때만 다시 읽는다.

**시험:** `tests/brain-node.test.ts`(바뀜이 없으면 부르지 않음, 기다리는 중이면 부르지 않음, 계획 만드는 중 취소, `placed`를 `/act/status`로 받아 이미 치운 물건 계획을 버림, 노드를 끝내면 나가 있는 PAM 요청을 끊음), 기존 `tests/world-decide.test.ts`·`tests/agent-planner.test.ts` 통과.

**끝 조건:** 묶음 공통 + 기록 DB 같음 시험 + `src/act`가 `src/brain`·`src/agent/planner`를 가져오지 않는다.

## 묶음 5: 가전 노드

**목표:** `devices` 노드가 허브(`signals`)를 가지고 `/device/command`를 받아 실행해 `/device/result`, 상태는 `/device/state`(STATE, 기기마다)·`/device/changes`(RELIABLE)로 낸다. 위험 목록 명령은 승인 토큰이 있어야 한다(지금 `deviceRunner`·정책과 같음). 말로 시킨 가전(대화, `phone` 노드)도 같은 토픽을 쓴다. 한 번만 실행(이 계획 14): 실행 전 「시작함」 기록 → 실행 → 결과 보관 → ack. 다시 온 명령은 보관한 결과를 다시 내고, 「시작함」만 있으면 `unknown`, 기한이 지났으면 `expired`. 원장은 통로와 상관없이 기록 DB의 `device_commands` 표(기동·`command_id`·시작함·결과)다. 「시작함」은 실행 전에 커밋하고, 결과는 실행 뒤 커밋한 다음 `/device/result`를 내고 ack한다.

**시험:** `tests/devices-node.test.ts`(승인 토큰 없는 위험 명령 거절, 같은 `command_id`가 다시 와도 허브에 한 번만 보냄 — 실행 뒤 ack 전에 노드를 끝내고 다시 만든 경우(새 노드가 같은 기록 DB 원장을 봄)와 실행 중 끊겨 「시작함」만 있는 경우(`unknown`) 포함, 기한 지난 명령은 보내지 않고 `expired`, 늦게 붙은 노드가 모든 기기 상태를 받음), 기존 `tests/agent.test.ts` 「Agent + 승인 규칙」, `tests/act-track.test.ts` 기기 단계 통과.

**끝 조건:** 묶음 공통 + 기록 DB 같음 시험 + `signals`를 `src/devices` 밖에서 가져오지 않는다.

## 묶음 6: 경계 검사를 엄격하게

**목표:** 노드 도메인끼리 import를 막는다.

- `scripts/lint-domains.ts` `DEPS`: `phone`·`observe`·`world`·`brain`·`act`·`devices`는 `bus`와 도구 묶음(`layout`, `agent`)·공용 표·기반층만. `record`는 `bus`·`brain`의 기록 DB 쓰기 함수만. `server`는 각 노드의 입구(`node.ts`를 내보내는 `index.ts`)만.
- 새 검사: 노드 도메인 파일이 다른 노드 도메인을 가져오면 「노드는 토픽으로만 주고받아요. `<토픽>`을 구독하세요」로 실패. 과거 실수로 실패 확인: `src/server/home/act.ts`의 `world.guard` 직접 호출(cb07b65)과 1620be1 `queueMicrotask` 줄을 넣은 가짜 트리.
- `CLAUDE.md` 규칙 표에 한 줄: 「노드는 토픽으로만 주고받는다 | `npm run lint`(lint-domains 노드 경계)·`tests/domain-boundaries.test.ts`·`tests/bus-node.test.ts`」.

**끝 조건:** 묶음 공통 + 전체 시험(빈 메모리 3GB 이상).

---

## 위험

| 위험 | 막는 것 |
|---|---|
| 한 프로세스 안인데 Redis를 지나 판단·명령이 느려진다 | 같은 EC2 안 Redis는 왕복 1ms 안팎이다. 판단 주기 5초, 폰 명령은 사람 속도다. 묶음마다 e2e 시간을 지금과 견준다 |
| RELIABLE 그룹이 늦게 만들어져 첫 메시지를 잃는다 | 두 단계 띄우기(이 계획 6), 계약 시험 「준비만 한 구독은…」 |
| 처리 실패를 성공으로 ack해 잃는다 | 성공 뒤에만 ack, 세 번 실패하면 `/bus/dead`와 기록 DB `bus_gap`(이 계획 7) |
| 가전 명령이 두 번 실행된다 | `command_id` 결과 보관·「시작함」·기한(이 계획 14) |
| Redis 메모리가 가득 차 RELIABLE을 잃는다 | `noeviction`(가득 차면 발행 오류, 지우지 않음), 처리 뒤 `XTRIM MINID`, SENSOR·STATE 알림은 `MAXLEN ~`. 발행 오류는 그 콜백 실패라 다시 받는다 |
| 사진이 디스크에 남는다 | Redis 디스크 저장 끔 + 켜질 때 확인(정한 것 9), 녹화는 사진 칸을 뺀다(`tests/record-bag.test.ts`, `tests/no-frames-on-disk.test.ts`) |
| Redis가 다시 켜져 그룹·상태가 사라진다 | 기동 표시 열쇠·`NOGROUP`으로 알아채 그 기동을 멈추고 새 기동으로 다시 띄운다(이 계획 15). 되살려 잇지 않는다. 디스크 저장을 끄므로 그 사이 메시지는 잃는다: noonchi와 같이 켜지고 꺼지므로 운영에서는 같이 다시 띄운다 |
| 상태를 기다리던 변화·처리 중 메시지를 잃는다 | 내려놓은 변화도 처리한 뒤에 ack(`ctx.defer()`), 실패한 메시지는 뒤 메시지보다 먼저 다시 줌(이 계획 7) |
| 다시 온 메시지로 반성용 줄이 두 번 남는다 | 기록 줄과 처리표를 한 트랜잭션(이 계획 18) |
| 반성 입력(기록 DB)이 빠진다 | 반성용 종류는 모두 RELIABLE + 쓴 뒤 ack, SENSOR 녹화는 커서 + 놓친 수 기록, 기록 DB 같음 시험(묶음 2·3) |
| 실행기가 한 줄이라 느린 콜백(LLM)이 노드를 막는다 | LLM 호출은 시작만 하고 답은 메시지로(묶음 4) |
| 재생이 실제 가전·실제 통로를 건드린다 | 격리 실행기·허용 목록·dry-run(이 계획 17) |
| 이 PC 메모리(Docker Desktop 1GB+) | 실제 Redis 시험만 Docker, 켜기 전 2.6GB 확인, 끝나면 끔. 평소 시험·개발은 MemoryBus |
| MemoryBus와 RedisBus 동작이 갈린다 | 같은 계약 시험(`tests/helpers/bus-contract.ts`). 갈래는 `openBus`의 `REDIS_URL` 한곳 |

## Self-Review

- 사용자 결정: 정한 것 1~14(Redis 디스크 저장 끔·확인 시험, 「다시 주기」는 같은 기동 안, 기록 DB 빠짐없이·SENSOR 커서·놓친 수·상한 근거·같음 시험, 개발용 Docker Redis). Codex c6073a6 15개·d4fe651 14개·edd2e13 P2 넷과 묶음 4 하나: 「검토 반영」 표 셋.
- 근거 표: 다시 들어오기(1620be1·8a13f9f), 순서(d1ccae2·e54860d·4dc5de7), 늦은 답(292eb63·58246d8·c966b20·6a2efe9·cb07b65), 타이머(a243ea5·6fb2d1d), 끝내기(dc411ae·9f0f661).
- 이름 맞춤: `TOPICS`·`TopicName`·`Body`·`Envelope`·`Header`·`Freshness`·`Pending`·`Bus`·`Subscription`·`Outcome`·`RETRY_MS`·`gapCounter`·`msgId`·`MemoryBus`(`quiet`)·`RedisBus`(`onLost` 필수)·`assertNoPersistence`·`BusNode`(`defer`·`withState`·`spawn`·`post`·`busy`·`lost`)·`VirtualClock`(`advanceTo(ms, settle)`)·`openBus`·`Bag`(`arrivalMs`)·`historyRoutes`·`startRecorder`·`REPLAY_INPUTS`·`settle`·`replay`·`recordBrainLog`·`deviceRecorder`·`HistoryDb.once`이 묶음 1 Task 1~4에서 같다.
