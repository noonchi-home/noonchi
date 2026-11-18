# 클로이드 계획 계약

task planner가 클로이드 계획(판단·단계·이동 경로)을 트윈 화면에 띄울 때 보내는 모양이다. 타입 원본은 `src/contract/plan.ts`.

## 보내기

- `POST http://127.0.0.1:8200/api/plan`, 본문 `{ "plan": PlanView }`. `npm start`로 띄운 서버에는 같은 PC에서 그대로 보낸다.
- compose로 띄운 서버나 다른 PC에서는 `Authorization: Bearer <PLAN_TOKEN>`을 붙인다. `PLAN_TOKEN`은 서버 `.env`에 둔다. 둘 다 아니면 403.
- `id`가 같으면 그 계획을 바꾼다. 바꿀 때마다 `revision`을 1 올린다. 서버는 같은 `id`의 번호를 지금 번호보다 크게 맞춘다. 화면은 지금 것과 같거나 작은 번호를 버린다.
- 모양이 틀리면 400과 틀린 필드를 돌려준다. 답은 `{ "ok": true, "plan": 서버가 보관한 계획 }`.
- 단계 상태만 바꿀 때: `POST http://127.0.0.1:8200/api/plan/:id/steps/:stepId`, 본문 `{ "status": "done" }`. 이때 `revision`은 서버가 올린다. 보내는 규칙은 계획과 같다.
- 지금 계획 보기: `GET http://127.0.0.1:8200/api/plan` → `{ "ok": true, "plan": PlanView | null, "off": { "hot": string[], "notices": string[] } | null }`. `off`는 켠 위험 가전 끄기 추적 요약이다: 지금 계획이 켠 채 추적하는 가전(`hot`)과 끄기 안내가 떠 있거나 줄에서 기다리는 가전(`notices`). 실행 추적이 없으면 null.

## 좌표

- 그 집 scene.json `plan`과 같은 평면 `[x, z]`, 미터.
- 방은 `plan.rooms[].id`, 물건은 `objects[].id`를 그대로 쓴다.

## PlanView

| 필드 | 뜻 |
|---|---|
| `id` | 계획 id. 다시 계획하면 새 id |
| `revision` | 새 계획은 1, 같은 `id`를 고칠 때마다 +1 |
| `supersedes` | 다시 계획했으면 바뀌기 전 계획 id. 첫 계획에는 없다 |
| `origin` | 시험으로 보낸 계획이면 `"mock"`. 없으면 실제(`"live"`) |
| `source` | task planner는 `"planner"`. 서버가 만든 계획은 `"brain"`(PAM이 고른 행동을 에이전트가 계획 모드로 만든 것, `src/agent/planner.ts`)·`"agent"`(말로 시킨 기기 행동) |
| `goal` | 할 일 이름. 예: 컵 치우기 |
| `judgment` | 지금 상황 판단 한 줄 |
| `dryRun` | `true`면 모의 계획. 화면에 「모의」가 붙는다 |
| `robot` | `{ position, room }`. 로봇 위치를 모르면 `position: null`이고 그때 `path: []` |
| `path` | 로봇 자리에서 시작하는 바닥 경로 점 목록. 이동이 없으면 `[]` |
| `legs` | `move` 단계마다 `{ stepId, end }`. `end`는 그 단계가 끝나는 `path` 점 번호(0부터) |
| `steps` | `{ id, kind, label, target?, status }` 목록. 화면에 번호 순서로 보인다 |
| `status` | `planned` · `running` · `done` · `cancelled` · `failed` |
| `updatedAt` | ISO 시각 |

- `kind`: `move` 이동, `act` 손으로 하는 일, `ask` 사람에게 묻기·알리기, `device` 기기 행동, `wait` 기다리기(행동 중, 예: 세탁 멈춤. 대시보드 진행도에 「기다리는 중 · 이름」, 실제 폰에는 보내지 않는다).
- 단계 `status`: `pending` 아직, `active` 지금, `done` 끝남, `failed` 실패, `skipped` 건너뜀.
- 단계 `started_ms`·`ended_ms`(없어도 됨): 진행 중이 된 시각(그 단계 명령을 낸 때)과 진행 중에서 끝난 시각(ms). 서버 실행 추적이 단다. 대시보드 시간 줄 로봇 줄이 쓴다.
- `target`: `objectId` · `deviceId` · `room` · `position` 중 아는 것만 넣는다.

## 화면에 나오는 글

- `goal` · `judgment` · `steps[].label`은 화면에 그대로 나온다. 60자 아래로, 화살표(→)·괄호 없이 지금 상태나 할 일만 쓴다. 어기면 400.
- 단계는 번호로 보인다. `label`에 순서나 다음 단계를 적지 않는다.

## 예시: 컵 치우기

마곡 보타닉 아파트(twin-studio `apartment/scene.json`) 좌표다. 복도 로봇이 식탁 앞으로 가서 컵을 집고, 싱크대 앞에서 내려놓는다. 이동 끝 점은 목적지 물건에서 0.55m 앞이다.

```json
{
  "plan": {
    "id": "cup-1",
    "revision": 1,
    "source": "planner",
    "goal": "컵 치우기",
    "judgment": "컵을 치우러 가요",
    "dryRun": true,
    "robot": { "position": [3.9, 5.51], "room": "hallway" },
    "path": [[3.9, 5.51], [6.95, 5.25], [7.824, 3.206], [6.33, 2.796]],
    "legs": [
      { "stepId": "cup-1:1", "end": 2 },
      { "stepId": "cup-1:3", "end": 3 }
    ],
    "steps": [
      { "id": "cup-1:1", "kind": "move", "label": "식탁으로 가기", "target": { "objectId": "table_1", "room": "kitchen_dining" }, "status": "active" },
      { "id": "cup-1:2", "kind": "act", "label": "컵 집기", "target": { "objectId": "table_1" }, "status": "pending" },
      { "id": "cup-1:3", "kind": "move", "label": "싱크대로 가기", "target": { "objectId": "sink_1", "room": "kitchen_dining" }, "status": "pending" },
      { "id": "cup-1:4", "kind": "act", "label": "컵 내려놓기", "target": { "objectId": "sink_1" }, "status": "pending" }
    ],
    "status": "running",
    "updatedAt": "2026-11-06T00:00:00Z"
  }
}
```
