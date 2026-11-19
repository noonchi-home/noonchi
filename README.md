<div align="center">

<h1>NOONCHI (twin-home)</h1>

**홈 로봇 클로이드(CLOiD)가 집을 보고, 사람의 습관을 배우고, 할 일을 미리 세워 두었다가 사람에게 알려 주는 서버**

noonchi-home | 26-2 소프트웨어공학

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![three.js](https://img.shields.io/badge/three.js-r187-000000?logo=threedotjs&logoColor=white)
![Matter](https://img.shields.io/badge/matter.js-0.17-1A1A1A)
![Redis](https://img.shields.io/badge/Redis-8.10-FF4438?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP_SDK-1.32-D97757)
![OpenAI](https://img.shields.io/badge/OpenAI_SDK-7-412991?logo=openai&logoColor=white)

</div>

---

### 소개

[twin-studio](https://github.com/noonchi-home/twin-studio)가 집마다 3D 모델과 장면을 만들고, 이 저장소는 한 집을 불러와 클로이드의 머리를 돌린다. 클로이드는 사람이 하는 일을 사람 상태 FSM으로 따라가고, 다음에 할 일을 미리 세워 두었다가 때가 되면 실제 폰으로 사람에게 단계마다 알려 준다.

| 단계 | 하는 일 | 보이는 곳 |
|---|---|---|
| **보기** | 실제 폰이 클로이드의 눈이다. 카메라 사진과 AR 위치가 들어온다. VLM이 최근 5장(2초 간격)을 함께 보고 물건, 손에 든 것, 사람이 하는 일(마시기·TV 보기·요리)을 읽는다. YOLO26s-seg는 물체 모양과 폰 위치 맞추기에, YOLO26n-pose는 사람 자세와 쓰러짐에만 쓴다. | 대시보드 비전 미니맵 |
| **알기** | World State가 VLM 답, 자세, 집 장면(가구·가전·도면 설비), 가전 상태를 합쳐 지금 상태와 관찰 글을 만든다. 볼 수 있는 것은 [낱말 표](docs/world-vocabulary.md)에 있는 것뿐이다. 사람 상태 FSM은 사람이 지금 하는 일 하나를 상태로 갖는다(먹거나 마시는 중·TV 보는 중·요리하는 중·자리에 없음, 배우면서 12개까지). | 트윈 사람 이름표, 시간 줄 사람 줄 |
| **판단** | 폰 사진이 오는 동안 5초마다 PAM이 관찰 글만 받아 지금 사람 상태, 일어난 화살표, 그 화살표의 행동을 답한다. 행동은 화살표 위에만 있고 서버는 규칙으로 행동을 고르지 않는다. 습관은 밤마다 반성과 채택 검사로 배운다. 사람이 컵을 쓰는 동안 목표 기계가 지금 상태에서 나가는 화살표의 행동(컵 치우기)을 목표로 세우고 계획을 미리 만든다. 관리자가 「안전 > 말로 한 부탁 > 목표 > 대기」 차례로 할 일을 고르고 눈치·코치 모드를 정한다. | 메시지 상자, 모드 말풍선, 트윈의 컵 위 고리·흐린 길 |
| **행동** | 실제 폰 명령은 로봇 실행 기계(대기·관찰·이동·실행·복귀·막힘 복구) 하나만 낸다. 계획 단계마다 사람에게 명령 하나를 내고, World State와 폰 위치로 그 단계가 된 것을 본 뒤 다음 명령을 낸다. 안전 기계는 따로 돈다. 쓰러짐 의심이면 로봇이 그 사람 쪽으로 가서 「괜찮으세요?」를 소리로 묻고 8초 듣기를 두 번 한다. 말 답이 없거나 도움을 청하는 말이면 비상(멈춤·안전 알림)이다. 켠 위험 가전은 꺼진 것이 확인될 때까지 끄기 안내를 한다. | 실제 폰, 트윈 번호 길, 시간 줄 로봇 줄 |

예: 사람이 식탁에서 컵으로 마시면 목표 기계가 컵 치우기를 목표로 세우고 계획을 미리 만든다(트윈의 컵 위 빨간 고리와 흐린 길). 사람이 컵을 두고 떠나면 PAM이 「마시는 중 → 다른 일」 화살표의 컵 치우기를 고르고, 미리 만든 계획을 지금 World State로 다시 검사해 1~2초 안에 첫 명령을 보낸다. 실제 폰에 「식탁으로 가 주세요」 → 「컵을 들어 주세요」 → 「싱크대로 가 주세요」 → 「컵을 싱크대에 넣어 주세요」가 차례로 뜬다. 폰이 식탁 1.2 m 안에 들어오면 다음, 컵이 손에 있으면 다음, 컵이 싱크볼 안이고 손에 없으면 끝이다. 끝나면 「충전 자리로 가 주세요」로 충전 자리에 돌아가 지켜본다.

컵 치우기는 배우는 습관이다. 배우기 전에는 떠날 때 「컵을 치울까요?」를 묻고, 「치워 주세요」 답이 쌓여 채택 검사를 지나면 묻지 않고 바로 치운다(합성 일주일에서는 3일째부터).

---

### 1. 주요 기능

#### 01. 대시보드

- 화면 전체가 3D 트윈이고, 그 위에 비전 미니맵(오른쪽 위)·마스코트(오른쪽 아래)·메시지 상자·시간 줄 카드가 얹힌다. 입력창은 없다.
- 3D 트윈: 한양목련 180B를 빛을 구운 three.js 트윈으로 그린다. 각도가 고정된 정사영 카메라가 그때 볼 것(지켜볼 때는 클로이드가 있는 방과 보는 방향 원뿔, 계획 중에는 단계 자리)을 가려지지 않는 빈 곳 가운데에 맞추고 채우도록 확대한다. 원뿔은 폰 위치를 맞춘 뒤에만 보이고, 벽 속에 서지 않고 문을 지나 옮겨 간다. 다른 집은 iframe 뷰어로 보인다.
- 번호 길: 계획은 로봇에서 단계 자리까지 이은 선과 단계 번호 ①②③④로 보인다. 지금 단계는 빨강, 끝난 단계는 흐리고, 지금 단계에 이름표(「② 컵 집기」)가 붙는다.
- 목표: 목표가 선 동안 치울 물건 위에 작은 빨간 고리 하나가 뜬다. 계획이 준비되면 그 길과 번호를 글 없이 흐리게 그려 두고, 사람이 떠나면 진해지며 번호 길로 이어진다. 목표가 끝나거나 버려지면 사라진다.
- 사람 이름표: 사람 발 위에 「사람 · 마시는 중」, 안 보이면 「사람 · 안 보임」.
- 말풍선: 판단하며 확인한 기기·물건에만 띄운다.
- 메시지 상자: 마스코트 바로 왼쪽, 남은 너비의 절반이고 최근 세 줄이다. 클로이드가 직접 하는 말로 쓴다(배운 뒤 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」 → 「컵을 치울게요.」, 배우기 전 「컵을 치울지 여쭤볼게요.」). 모델 없이 판단 기록·World State·실행 기록의 사실로만 만든다.
- 시간 줄 카드: 메시지 상자 왼쪽에 같은 높이로 선다. 맨 위 10초 눈금, 사람 · 로봇 두 줄, 오른쪽 끝 지금 선, 지난 30초다. 사람 줄은 사람 상태 FSM의 상태 구간, 로봇 줄은 로봇 실행 기계의 계획 단계 구간과 지켜봄이다. 사람이 떠난 때부터 첫 명령까지는 두 줄을 가로지르는 구간과 굵은 「N.N초」로 보인다. 숫자는 모두 서버 자료에서 온다.
- 모드 말풍선: 마스코트 머리 위에 「눈치 모드」 또는 「코치 모드」.
- 비전 미니맵: 실제 폰 영상과 물체 모양(마스크, 종류 무리마다 다른 색)·이름표. 네모 상자는 그리지 않는다. 대시보드 주소에 `?view=minimap`을 붙이면 미니맵만 보인다.
- 칩: 날짜·시간은 늘, 「클로이드 위치 모름」과 「연결 끊김 · 다시 연결 중」은 그때만 뜬다. 승인 대기는 대시보드에 보이지 않는다.
- 마스코트는 늘 왼쪽을 본다. 누르면 설정 창이 열린다(연결, 운영 모드, 허브, 에이전트, 집, 폰 연결 QR, 「집 다시 설정하기」).
- 단계가 바뀔 때는 transform·opacity만 움직이고, 가장 긴 그림 간격은 50 ms 이하다([view-switch](docs/view-switch.md)).

#### 02. 실제 폰: 클로이드의 눈과 손

- 안드로이드 크롬에서 폰 페이지를 연다. WebXR AR이 위치와 방향을 딴다. 집마다 정한 시작 자리에서 「여기서 시작」을 한 번 하면 트윈에 어림으로 맞고, 방을 둘러보며 걸으면 서버가 벽 모양(hit-test 벽 점)과 큰 가구(냉장고·소파·식탁 등)로 저절로 맞춘다([위치 맞추기](docs/reference.md#시작-위치물건벽-모양으로-맞추기위치-맞추기)).
- 위: 미어캣 아이콘과 지금 할 명령 한 줄(상태 표시줄 아래, 위에서 36px부터). 아래: 비전 상태 줄(「식탁까지 2.4m」, 「컵 · 손에 있음」)과 바로 밑 「완료」 단추. 비전이 못 알아볼 때 「완료」를 누르거나 말하면 다음 단계로 간다.
- 명령은 소리로 읽고 늘 듣는다(읽는 동안은 듣지 않는다). 질문은 말로 답하고 단추는 보조다. 「그만」이라고 하면 계획을 그만둔다.
- 명령은 로봇 실행 기계 하나만 낸다. 폰 화면을 누가 쓰는지는 폰 사용권 표(안전 안내 > 승인 질문 > 대화 > 계획 명령 > 가까이 가서 보기)가 정한다.
- 쓰러짐 확인: 「괜찮으세요?」 → 8초 듣기 → 「괜찮으세요? 괜찮으시면 괜찮아라고 말해 주세요.」 → 8초 듣기. 답은 말로만 받고 단추는 없다. 「괜찮아」류 말이면 「다행이에요」로 평소로 돌아가고, 도움을 청하는 말(「도와줘」·「119」 등)이면 바로 비상이다. 사람이 서 있거나 걷는 것이 다시 보여도 평소로 돌아간다.
- 승인: 허락 없이 하면 위험한 일(현관 잠금 해제, 인덕션·전자레인지를 끄기 말고 바꾸는 명령)만 실제 폰에서 「승인」·「거절」로 묻고, 그 밖에는 바로 한다. 말로 답할 때는 말 전체가 답일 때만 받는다.
- 일이 멈추는 문제(시작 위치 없음, 마이크 꺼짐, 연결 끊김)는 고치는 단추가 있는 창으로, 잠깐 생기는 문제(추적 약함, 위치 맞추는 중)는 비전 상태 줄로 알린다.
- 카메라 프레임은 늘 서버로 간다. 폰 서버는 Wi-Fi에 폰 페이지와 그 WebSocket만 내주고, 기기 제어 REST는 127.0.0.1에만 둔다.

#### 03. 밤 반성과 채택 검사: 배우는 습관

- 하루 한 번(`REFLECT_AT`, 기본 23:30) 밤 흐름이 돈다: 덩어리 기록 → 반성(후보 FSM) → 코드 모양 검사 → LLM 뜻 검사 → 시각 찾기 → 채택 검사 → 로봇 FSM → 저장. 판단 속도와 상관없다.
- 덩어리 기록: 하루 관찰 줄을 하는 일 덩어리(시작·끝·한 문장)로 묶고, 그동안의 사람 상태를 붙인다.
- 반성: (출발 상태, 행동)마다 화살표 조건 후보 1~3개를 낸다. 상태 더하기·합치기와 화살표 더하기·바꾸기·지우기만 한다.
- 코드 검사(`src/brain/decision.ts`, 후보 FSM은 `validateCandidateFsm`, 로봇 FSM은 `validateMemory`): 같은 (출발·사건·조건) 화살표 둘, 목록 밖 행동, 행동 없는 `*` 화살표, 상태 12개 넘음, 처음 상태 「자리에 없음」 없음 같은 모양을 거절한다.
- LLM 뜻 검사(같은 PAM LLM): 상태가 사람이 하는 일인지(물건·장소·로봇 행동·시간대가 섞이면 거절), 조건이 사람 쪽 사실인지, 합칠 상태가 있는지 본다. 거절이면 까닭을 붙여 한 번 다시 반성한다.
- 채택 검사(`src/brain/pam/adopt.ts`, 모델을 부르지 않음): 후보가 일어난 뒤 300초 안에 사람이 그 일을 했거나, 물었을 때 「치워 주세요」로 답했으면 따라온 것이다. 따라온 비율 75% 이상이고 단측 이항검정 p < 0.001(p0 = max(다른 때 비율, 0.01))이면 채택한다. 사람이 안 보인 구간과 로봇이 그 일을 한 구간은 셈에서 뺀다.
- 채택된 후보만 로봇 FSM에 들어가 같은 트리거의 묻기 화살표를 바꾼다. 끝내 거절·실패면 전날 기억을 쓴다.
- 정한 습관(먹다가 다 마시면 물 채우기, TV 보며 다 마시면 콜라 따르기, 「아 덥다」·부채질이면 에어컨, 코치 둘)은 검사 없이 늘 있고 반성이 바꾸지 않는다. 배우는 습관은 컵 치우기와 「말없이 TV 보기 시작 → 에어컨 켜기」 둘이다.
- 합성 일주일(`scripts/seed-history.ts`): 1·2일째는 떠날 때 묻고 3일째부터 바로 컵을 치운다. 말없이 에어컨은 4일째부터 켠다.

#### 04. 말 부탁

- 기억에 화살표가 없는 일도 말로 부탁하면 한다. 말 요청 에이전트가 할 일 부탁 도구(`request_task`)로 계획 모드에 넘기고 로봇 실행 기계가 실행한다(예: TV 보는 중 「라면 끓이는 법 알려 줘」 → 라면 코치 계획).
- 「컵을 치울까요?」에 「치워 주세요」로 답해도 같은 길로 컵 치우기가 시작된다.
- 관리자 차례에서 말로 한 부탁은 안전 다음, 목표 앞이다. 손대는 단계(집기·넣기) 중이면 그 단계가 끝난 뒤로 미루고, 충전 자리로 가는 중에는 바로 받는다. 말로 부탁한 코치 계획이 열린 동안은 코치 모드다.
- 가전 명령(「거실 불 켜 줘」)은 에이전트가 바로 한다. 그 말이 승인이다. 위험 목록만 실제 폰에서 승인을 묻는다.

#### 05. 영상 시험

- 폰 페이지 `/phone/?clip=<파일>`이면 카메라 대신 `runtime/videos/<파일>`을 틀고 실제 폰과 같은 길로 서버에 보낸다. 다른 것은 카메라 입력과 마이크 듣기 끔뿐이고, 지시·소리 읽기·완료 판단·트윈 반영은 실제와 같다. 답은 화면 단추로 한다.
- `step=<종류>:<낱말>:<파일>`을 붙이면 명령마다 사람이 그 단계를 하는 영상으로 바꿔 틀고, 가기 단계는 카메라 자리를 대상 앞까지 옮긴다([영상 모드](docs/reference.md#영상-모드-영상으로-시험하기)).
- `scripts/video-check.ts`: 헤드리스 크롬이 영상 모드로 끝까지 틀고, 영상 시각 기준 시각표(사람 등장·사라짐, PAM 판단, 계획, 명령, 끝, 사람·목표·로봇·안전·관리 기계 전이)와 판정을 `runtime/videos/`에 남긴다. 판마다 서버를 새로 띄운다.
- 컵 치우기를 보는 영상은 배운 뒤 기억으로 돈다. 서버를 끈 채 `npx tsx scripts/demo-setup.ts learned --dir <서버 RUNTIME_DIR>`로 넣고, `video-check`가 시작 때 확인한다(없으면 멈춘다).
- `--record <폴더>`는 폰 화면과 대시보드를 녹화해 mp4로 남기고, `--record-view minimap`은 비전 미니맵만 1280×720으로 녹화한다. `scripts/minimap-cut.ts`가 미니맵 녹화를 영상 시각대로 한 편으로 잇는다. 모델 없이 도구만 보려면 `--fake`.

#### 06. 설정 화면 (`/setup/`)

<img src="docs/screenshot-setup.webp" alt="설정 화면: 왼쪽 아래 상반신 마스코트에서 생각 동그라미가 이어지고, 오른쪽 말풍선 안에 「어느 집을 쓸까요?」와 집 고르기 카드" />

- 왼쪽 아래 마스코트가 묻고, 오른쪽 생각 말풍선 안에서 고른다. 집 고르기, 가전 선택, 운영 모드(시험·실제), 위치 동기화 네 단계다. 돕는 방식은 고르지 않는다(모드는 서버가 정한다).
- 위치 동기화는 말풍선 안을 트윈 하나가 채운다. 트윈 바닥을 눌러 폰을 켤 시작 자리를 고르고, 볼 쪽을 누르거나 화살표 끝을 끌어 방향을 정한다. 시작 자리를 저장해야 「완료하고 대시보드로」가 눌린다.

#### 07. 가상 Matter 가전과 집

- 집의 조명, TV, 에어컨, 인덕션, 도어락, 커튼 같은 가전을 matter.js 브리지 하나의 기기로 띄운다. 기기 상태의 원본은 Matter 속성이다. 운영 모드가 실제면 짝지은 가전은 ThinQ로 실제 기기를 움직인다.
- 카메라로 본 가전 상태(TV 화면 켜짐, 냉장고·전자레인지 문 열림, 싱크대 물)도 트윈에 맞춘다. 같은 모습이 2번(4초) 이어져야 바꾸고, 실제 값이 있는 가전은 실제 값이 이긴다.
- `HOME_ID`나 설정 화면으로 집을 고른다(한양목련 180B, 마곡 보타닉, 원룸 예시). 도면 설비(싱크대·조리대·변기·세면대·욕조)와 충전 자리도 장면에 들어간다.
- 말이나 폰 조준(「냉장고 위치 여기로 맞춰줘」)으로 가구·가전을 옮기고, 돌리고, 넣고, 뺀다. 「배치 저장해」면 `runtime/homes/<id>/edits.json`에 남는다.
- MCP 서버가 기기 도구를 내준다. Claude Code나 Claude Desktop이 이 집의 에이전트가 될 수 있다.

---

### 2. 레포 구조

| 폴더 | 들어 있는 것 |
|---|---|
| `src/` | 서버(Node.js 22). 도메인 폴더로 나뉜다(아래 표) |
| `ui/` | 대시보드·설정·폰 화면(React). 서버는 빌드 결과 `ui/dist/`만 내준다. 화면 시험은 `ui/tests/` |
| `twin/` | twin-studio에서 가져온 집 자산: 장면·뷰어·구운 3D, 집마다 `twin/data/homes/<집>/`(평면도·배치·도면 설비·더한 가전·충전 자리 `dock.json`) |
| `models/` | 감지·관절 모델(YOLO26s-seg·YOLO26n-pose ONNX) |
| `scripts/` | 검사(`lint-*.ts`), 영상 시험(`video-check.ts`·`video-record.ts`·`minimap-cut.ts`), 시연·합성 기록(`demo.ts`·`demo-setup.ts`·`seed-history.ts`·`learned-memory.ts`), 가짜 모델 서버(`fake-openai.ts`), 집 자산 가져오기(`twin-assets.ts`), 트윈 사진·무거운 일 잠금(`twin3d/`) |
| `tests/` | 서버 시험(Vitest). 시험 대역(가짜 PAM·가짜 모델·작은 집)은 `tests/helpers/` |
| `docs/` | 계약·참고·배포 문서 |
| `web/` | 클로이드의 눈 영상(H.264)을 그리는 워커 |

#### 서버 도메인 (`src/`)

다른 도메인은 그 입구(`index.ts`, 서버 도메인은 node 모듈 없이 읽히는 `browser.ts`도)로만, 아래 「가져다 쓰는 것」 방향으로만 가져온다. 고리는 없다. `npm run lint`(`scripts/lint-domains.ts` `DEPS`)와 `tests/domain-boundaries.test.ts`가 막는다.

| 도메인 | 하는 일 | 가져다 쓰는 것 | 노드 |
|---|---|---|---|
| `bus` | 노드 통로(ROS 2처럼): 토픽 표(`topics.ts`)·QoS, `MemoryBus`·`RedisBus`, 실행기 `BusNode` | 없음 | 통로 |
| `devices` | 가상 Matter 가전·ThinQ, 가전 종류 등록부(`kinds.ts`) | bus | `devices` |
| `layout` | 집 장면·평면도·도면 설비·배치 보정·경로 찾기·충전 자리 | devices | 도구(읽기만) |
| `world` | World State, PAM 관찰 글, 낱말 표(`vocab.ts`) | bus, devices, layout | `world` |
| `phone` | 실제 폰 서버·눈, 위치 맞추기(`sync/`), 폰 사용권(`owner.ts`) | bus, world, layout | `phone` |
| `observe` | 관찰 흐름: YOLO 감지·관절, VLM, 가까이 보기·위에서 보기 | bus, phone, world, devices | `perception` |
| `brain` | PAM 판단·반성(`pam/`), 사람 상태 FSM(`person.ts`), 기억 모양·검사·seed(`decision.ts`), 목표 고르기(`goal.ts`), 기록 DB·밤 흐름(`history/`) | bus, world, devices | `brain` |
| `agent` | LLM 에이전트: 말 요청·계획 모드·관찰 모드, 승인 규칙(`policy.ts`), MCP(`mcp/`) | world, devices, layout | 도구 |
| `safety` | 안전 기계: 쓰러짐·위험 가전 | bus, world, agent | `safety` |
| `goal` | 목표 기계 | bus, brain, world, agent | `goal` |
| `manage` | 관리자: 차례·모드·PAM 행동 목록·쓰는 중 지킴 | bus, world | `manager` |
| `act` | 로봇 실행 기계(`robot/`, 실제 폰 명령 줄 `robot/phone.ts`), 실행 전 검사, 계획 단계·승인·코치·찾기·충전 복귀 | bus, agent, brain, observe, phone, world, devices, layout | `act` |
| `record` | 기록 노드: 기록 DB 쓰기·녹화·격리 재생 | bus, brain | `recorder` |
| `server` | 노드를 띄우는 곳, HTTP·WebSocket, 집 하나의 실행 묶음(`home/`) | 모든 도메인 | 띄우는 곳 |

기반층은 누구나 가져오고, 기반층은 도메인을 가져오지 않는다.

- `src/contract/`: 공용 타입(서버 메시지·계획·World State·PAM 계약 등)
- `src/shared/`: 공용 도우미(글 자르기 `cut.ts`, 기하, 경로)
- `src/infer/`: 외부 모델 API 통로(추론 모드 주소 `endpoints.ts`, VLM, 비용)
- `src/design/`: 디자인 토큰(`tokens.json` 하나가 원본)
- 공용 표: `src/world/vocab.ts`·`src/world/labels.ts`(낱말·글), `src/devices/kinds.ts`·`src/devices/types.ts`(가전 종류), `src/act/tasks.ts`·`src/act/prompts.ts`·`src/act/labels.ts`(행동 목록·폰 답·명령 글), `src/phone/sync/classes.ts`(기준점 종류)

#### 기계 넷과 관리자

기계마다 노드 하나, 상태 토픽 하나(STATE, 최신 값)와 전이 기록(RELIABLE, 빠짐없이)이다. 전이는 기록 DB·녹화와 영상 시각표에 남는다.

| 기계 | 사는 곳 | 상태 | 상태 토픽 | 전이 기록 |
|---|---|---|---|---|
| 사람 상태 FSM | `src/brain/person.ts` | 기억의 상태 id(`away`부터) | `/brain/person` | `/brain/person_changes` |
| 목표 기계 | `src/goal/` | 세움 `armed` → 미리 만드는 중 `planning` → 준비됨 `ready` → 시작 `started` → 끝 `done` / 버림 `dropped` | `/goal/state` | `/goal/changes` |
| 로봇 실행 기계 | `src/act/robot/` | 대기 `idle` · 관찰 `observe` · 이동 `move` · 실행 `run`(안에 계획 단계) · 복귀 `return` · 막힘 복구 `recover` | `/robot/state` | `/robot/changes`, 실제 폰 명령 `/act/phone_command` |
| 안전 기계 | `src/safety/` | 평소 `normal` → 의심 `suspect` → 비상 `emergency`(까닭: 쓰러짐 `fall`, 위험 가전 `device`) | `/safety/state` | `/safety/changes` |
| 관리자 | `src/manage/` | 맡은 쪽 `safety` · `request` · `goal` · `idle`, 모드 `noonchi` · `coach` | `/manager/state` | `/manager/changes`, 로봇에 내리는 일 `/manager/order` |

밤 흐름은 `brain` 안에 있다: 흐름 `src/brain/history/night.ts`, 채택 검사 `src/brain/pam/adopt.ts`, 뜻 검사 `src/brain/pam/memoryCheck.ts`, 덩어리·시각 찾기 답 검사 `src/brain/pam/marks.ts`.

#### 노드 사이 흐름

노드는 한 Node 프로세스 안에서 돌고 토픽으로만 주고받는다. 토픽 표는 `src/bus/topics.ts` 하나다.

1. `phone` → `/perception/frame` → `perception` → `/perception/analysis`·`/perception/detections`
2. `world` → `/world/state`·`/world/changes`
3. `brain` → `/brain/decision`(PAM 판단)·`/brain/person`(사람 상태)·`/brain/plan`(계획 모드)
4. `goal` → `/goal/state`, `safety` → `/safety/state`
5. `manager` → `/manager/order` → `act` → `/act/phone_command` → `phone` → 실제 폰
6. 실제 폰의 「완료」·답·들은 말 → `/phone/progress`·`/phone/heard`
7. 가전은 `/device/command` → `/device/result`·`/device/state`, `recorder`는 기록 DB(SQLite `noonchi.db`)와 녹화

#### 화면 (`ui/src`)

화면은 `src/`에서 contract·공용 표·shared·design·`src/layout/browser.ts`만 가져온다.

| 폴더 | 화면 | 가져다 쓰는 것 |
|---|---|---|
| `ui/src/dashboard` | 대시보드(`/`): 트윈 위 번호 길·목표 고리(`plan-marks.ts`), 메시지 상자(`TalkBox.tsx`), 시간 줄(`timeline.ts`·`TimelineCard.tsx`), 모드 말풍선(`ModeBubble.tsx`), 비전 미니맵(`PhonePane.tsx`) | ui/twin |
| `ui/src/twin` | three.js 3D 트윈(`3d/`) | 없음 |
| `ui/src/setup` | 설정 화면(`/setup/`) | ui/twin |
| `ui/src/phone` | 실제 폰 페이지(`/phone/`) | 없음 |
| `ui/src/components/ui` | 21st.dev 부품(파일마다 출처 줄) | 공용 |
| `ui/src/lib` | 서버 연결·메시지 종류·토큰 | 공용 |

---

### 3. 개발 도구

- Claude Code (Claude Opus 5.5)

### 4. 플랫폼

- Node.js 서버와 웹 화면, 안드로이드 크롬 폰 페이지(아이폰 사파리는 WebXR AR이 없어 폰 페이지가 돌지 않는다)
- Windows 11, Docker Compose(서버 한 대·GPU 서버·Redis)

---

<details>
<summary><b>로컬에서 돌리기</b></summary>

Node.js 22.15가 필요하다. 집 자산은 `twin/`에 있다. twin-studio에서 다시 빌드했으면 `npx tsx scripts/twin-assets.ts --from <twin-studio 폴더>`로 `twin/`을 채운다.

```bash
npm install
npm --prefix ui install   # 대시보드·설정·폰 화면(React)
cp .env.example .env      # OPENAI_API_KEY(에이전트·VLM·PAM LLM, INFERENCE_MODE=openai)
npm start                 # 화면을 빌드하고 http://127.0.0.1:8200
```

- 관찰·판단까지 돌리기: `BRAIN=1 PHONE_PORT=8210 npm start`. 폰은 설정 창의 QR로 연다.
- 추론 모드(`INFERENCE_MODE`): `openai`(개발, VLM·PAM LLM 모두 OpenAI API, `OPENAI_API_KEY`) · `vllm`(GPU 서버의 vLLM 두 개, `VLLM_API_KEY`, `docker compose --profile gpu up -d --build`). 두 모드는 같은 코드 길이고 모델 주소·모델 이름·제공자 칸만 다르다.
- 통로(`REDIS_URL`, 선택): 비우면 메모리 통로, 주면 Redis 통로다. 이 PC에서는 `docker compose -f compose.dev.yaml up -d redis` 뒤 `REDIS_URL=redis://127.0.0.1:6379`, compose 서버 안에서는 `redis://redis:6379`. Redis 디스크 저장이 켜져 있으면 통로를 열지 않는다.
- 무거운 일은 하나씩: 3D 크롬·시험·빌드는 `npm run heavy -- <명령>`으로 돌린다. 시험은 파일 하나도 `npm run heavy -- npx vitest run tests/act-track.test.ts`처럼 한다. 다른 무거운 일이 돌고 있으면 바로 끝난다. 대시보드 사진은 `npm run capture -- …`로만 찍는다.
- 비용을 줄인 모델: `.env`에 `VLM_MODEL=gpt-5.4-nano`, `PAM_LLM_MODEL=gpt-5.4-nano`, `OPENAI_MODEL=gpt-5.4-mini`. 가까이 보기만 다른 모델이면 `VLM_CLOSER_MODEL`.
- 키 없이 돌려 보기: `npx tsx scripts/fake-openai.ts --port 8500`을 띄우고 `VLM_BASE_URL`·`PAM_LLM_BASE_URL`·`OPENAI_BASE_URL`을 `http://127.0.0.1:8500/v1`로, `OPENAI_API_KEY`를 `fake-key`로 둔다.
- 지난 기록이 있는 시험: `npx tsx scripts/seed-history.ts`가 한양목련 7일 합성 기록을 넣는다(모든 줄에 합성 표시). 지우기는 `--clear`.
- 시연 준비(`scripts/demo-setup.ts`): `day1`(빈 기록), `week`(합성 7일) 뒤 `reflect --chain`(1~6일 반성), `learned`(서버를 끈 채 배운 뒤 기억 넣기), `start <cup|tv|microwave|kitchen>`(장면 시작 위치).
- 영상 시험: 시작 자리를 저장하고(설정 4단계) 영상을 `runtime/videos/`에 둔 뒤 `npm run heavy -- npx tsx scripts/video-check.ts --clip <파일> --done-after 3`. 단계 영상은 `--step go:table:go-table.mp4 …`, 녹화는 `--record <폴더>`(`--record-view minimap`), 모델 없이는 `--fake`.
- 실제 집 사진 모으기: `.env`에 `DATASET_COLLECT=1`이면 분석한 사진이 폰 위치·방향과 함께 `runtime/dataset/<날짜>/`에 쌓인다(7일 보관).
- 감지·관절 모델은 저장소 `models/`에 있어 따로 받지 않는다(AGPL-3.0). 출처·다시 내보내기는 [THIRD_PARTY](THIRD_PARTY.md#모델).
- 서버 한 대: `docker compose up -d --build`(noonchi와 redis). GPU 서버는 `docker compose --profile gpu up -d --build`([deploy](docs/deploy.md)).
- 대시보드 순간 보기: `?debug=steps&step=N`은 서버 자료 대신 `ui/src/dashboard/fake-run.json`의 순간(지켜보기, 1~4단계)을 보인다([twin3d](docs/twin3d.md)).

| 명령 | 하는 일 |
|---|---|
| `npm start` | 화면을 빌드하고 서버 실행(8200) |
| `npm run dev` | 같고, 서버 파일이 바뀌면 다시 시작 |
| `npm test` | 서버 시험과 화면 시험(Vitest) |
| `npm run lint` | 화면 글·색·21st.dev 부품·글 크기, 도메인 경계, 글 자르기 검사 |
| `npm run typecheck` | `tsc --noEmit`(`ui/`는 `npm run ui:build`가 본다) |
| `npm run tokens` | 디자인 토큰(`src/design/tokens.json`)에서 화면 파일 만들기 |
| `npm run demo` | 임의 포트에 서버를 띄워 시나리오를 REST·WS로 돌리고 표를 찍는다 |
| `npm run mcp` | MCP stdio 서버(켜 둔 서버의 REST를 부른다) |
| `npm run ui:dev` | 화면 개발 서버(5173, API는 8200으로) |
| `npm run ui:build` | 화면 빌드(`ui/dist/`) |
| `npm run ui:test` | 화면 시험만 |
| `npm run heavy -- <명령>` | 3D 크롬·시험·빌드를 한 번에 하나만 돌리는 잠금 |
| `npm run dev3d -- start` | 3D 작업용 서버(8201)와 화면(5174), 모델 주소 닫힘 |
| `npm run capture -- …` | 대시보드 사진 찍기 |
| `HUB=memory npm start` | Matter 없이 시작(빠름) |
| `HOME_ID=oneroom PHONE_PORT=8210 npm start` | 원룸 예시와 폰 페이지로 시작 |
| `claude mcp add twin-home -- npx tsx src/agent/mcp/server.ts` | Claude Code에 MCP 서버 등록(`npm start`는 켜 둔다) |

</details>

<details>
<summary><b>문서</b></summary>

- [계약](docs/plan.md): 형식과 연결. 코드보다 먼저 고친다.
- [전체 참고](docs/reference.md): 환경 변수, REST·WebSocket API, 폰 AR, 관찰 흐름, 기록과 반성, PAM, 설정 흐름, 승인, 시험
- [PAM 연결 형식](docs/pam-interface.md), [PAM 안내](src/brain/pam/README.md), [계획 계약](docs/plan-contract.md)
- [World State 낱말 표](docs/world-vocabulary.md): 사람 상태·화살표 사건과 계획 단계 조건에 쓸 키·글
- [대시보드 3D 트윈](docs/twin3d.md): 구운 자산, 다시 굽기, 사진 찍기
- [단계 바뀜 끊김 막기](docs/view-switch.md): 규칙과 잰 값
- [배포](docs/deploy.md)

</details>
