# CLOiD plan contract

A task planner publishes a plan to show the intended action, route, and progress on the digital twin. The TypeScript definition is in [src/contract/plan.ts](../src/contract/plan.ts).

## Publishing and reading a plan

| Request | Behavior |
|---|---|
| `POST /api/plan` | Send `{ "plan": PlanView }`. A successful response contains `ok: true` and the stored plan. Invalid input returns HTTP 400 with the offending field. |
| `POST /api/plan/:id/steps/:stepId` | Send a new step status, for example `{ "status": "done" }`. The server advances the revision. |
| `GET /api/plan` | Returns `{ ok, plan, off }`. The plan may be `null`. When the tracker is available, `off.hot` lists risky appliances being tracked and `off.notices` lists appliances with a visible or queued switch-off reminder. Otherwise `off` is `null`. |

Use `http://127.0.0.1:8200` for the local server. Local loopback requests to a server started with `npm start` can publish directly. For a remote client or a Compose deployment, send `Authorization: Bearer <PLAN_TOKEN>`. An unauthorized write returns HTTP 403.

## Coordinates

Use the floor plane `[x, z]` in meters, as in the active home's `scene.json`. Use `plan.rooms[].id` for room IDs and `objects[].id` for object IDs.

## PlanView

| Field | Meaning |
|---|---|
| `id` | Stable ID for updates to one plan. A replacement plan gets a new ID. |
| `revision` | Starts at 1. Updates to the same ID advance the revision. The server ensures it increases and the dashboard ignores duplicate or older revisions. |
| `supersedes` | ID of the plan being replaced, if any. |
| `origin` | `"mock"` for test plans. Defaults to `"live"`. |
| `source` | `"planner"` for an external planner, `"brain"` for a plan based on a PAM decision, or `"agent"` for an appliance action requested by voice. |
| `goal`, `judgment` | The task name and a one-line assessment for the dashboard. |
| `dryRun` | Marks a simulated plan on the dashboard. |
| `robot` | `{ position, room }`. If the position is unknown, set it to `null` and use an empty path. |
| `path` | Floor coordinates starting at the robot's position. Empty when no travel is needed. |
| `legs` | One `{ stepId, end }` per move step. `end` is its zero-based end index in `path`. |
| `steps` | Ordered list of `{ id, kind, label, target?, status }`. |
| `status` | `planned`, `running`, `done`, `cancelled`, or `failed`. |
| `updatedAt` | ISO timestamp. |

Step kinds are `move`, `act` (manual action), `ask` (question or notice), `device`, and `wait`. A waiting step remains visible on the dashboard while an action is in progress, such as waiting for a washer to stop. It does not issue a phone command. Step status is `pending`, `active`, `done`, `failed`, or `skipped`. Optional `started_ms` and `ended_ms` timestamps delimit the step on the robot timeline. A target includes whichever of `objectId`, `deviceId`, `room`, and `position` are known.

## Display text

The dashboard displays `goal`, `judgment`, and each step's `label` verbatim. Keep them at most 60 characters and describe the current state or action without arrows, parentheses, or step numbers. Invalid text returns HTTP 400.

## Example: clear a cup

This example uses the Magok Botanic apartment layout. The robot starts in the hallway, picks up the cup at the table, then goes to the sink to put it down. The move endpoints are 0.55 m in front of their targets. Korean strings are the actual display text.

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
