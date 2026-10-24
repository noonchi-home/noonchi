# 집 패키지 · 현장 보정 · 음성 · 초점 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평면도 그림으로 만든 아무 집이나 twin-studio 패키지로 두고, twin-home이 그 집을 골라 불러와 폰 AR·채팅·음성으로 가구·가전 위치를 보정하고 저장하며, 클로이드가 지금 무엇에 집중하는지 폰과 대시보드에 보여 준다.

**Architecture:** twin-studio는 집 목록(`homes.json`)과 공용 카탈로그(`data/catalog`)를 가진 에셋 저장소가 된다. twin-home은 `HOME_ID`로 집 하나를 불러오고, 배치 보정은 런타임 덮어쓰기(편집기)로 즉시 3D에 반영한 뒤 수정본 파일로 저장한다. twin-studio `apply-edits`가 그 파일을 원본 배치에 반영한다. 음성은 폰 크롬 내장 음성 인식·읽기를 쓰고, 초점은 에이전트가 다룬 객체의 트윈 좌표를 폰 카메라 화면에 투영한다.

**Tech Stack:** twin-studio Python 3.11·uv·pytest·shapely·Blender 5.2, three.js 뷰어(node --test). twin-home Node 22·TypeScript·Vitest·ws·zod, 폰 WebXR(hit-test·dom-overlay·camera-access), Web Speech API.

**Spec:** 사용자 지시(2026-10-24): 평면도 그림 기반으로만 집을 만든다(AR 방 찍기 제외). 실제 있는 가전만 넣고 폰 AR과 채팅으로 후보정해 확정되면 저장한다. twin-home 대시보드는 트윈 + 실시간 AR 화면 + 추론 로그, 폰 화면에는 클로이드가 집중하는 곳, 음성으로 에이전트와 대화. 보안은 내부 테스트라 고려하지 않는다(같은 와이파이).

## Global Constraints

- twin-home은 twin-studio 파일을 고치지 않는다. 보정은 `twin-home/runtime/homes/<id>/edits.json`에만 쓰고, 반영은 twin-studio 명령이 한다.
- 기존 아파트는 그대로 동작해야 한다: 경로 `data/apartment`·`apartment/`, 기본 집 = `apartment`.
- 환경 변수 이름은 `HOME_ID`(유닉스 `HOME`과 겹치지 않게).
- 클로이드의 눈 화면은 계속 '엔진 입력 아님'. 초점 표시는 화면용이고 사진(kind photo)에는 그리지 않는다.
- 추가한 가전은 저장 → `apply-edits` → 빌드 → twin-home 재시작 뒤에 Matter 기기가 된다(실행 중 Matter 기기 추가는 하지 않음).
- 문·창·벽·구조는 보정 대상이 아니다. 배치(placement) 항목만 옮기고 더하고 뺀다.
- 테스트는 모두 통과, `npm run typecheck` 0, `uv run ruff check .` 0.

---

## 계약

### A. twin-studio 집 목록 `homes.json` (저장소 루트)

```json
{
  "version": 1,
  "default": "apartment",
  "viewer": "apartment/viewer",
  "library": "library",
  "homes": [
    { "id": "apartment", "name": "마곡 보타닉 아파트 (방 3·욕실 2)", "data": "data/apartment", "out": "apartment" },
    { "id": "oneroom", "name": "원룸 예시 (테스트용)", "data": "data/homes/oneroom", "out": "homes/oneroom" }
  ]
}
```

- `id`: `^[a-z][a-z0-9_]*$`. 경로는 저장소 루트 기준.
- 카탈로그: `<data>/catalog`가 있으면 그것, 없으면 공용 `data/catalog`.
- 빌드 중간 파일: `build/<id>`. 뷰어는 모든 집이 함께 쓴다(`viewer`).
- `library`: 모든 카탈로그 종류의 개별 GLB(`library/assets/<category>/<type>.glb`, `python -m studio library`). 실행 중 새 종류를 더할 때 쓴다. 없으면 회색 상자.
- `homes.json`이 없으면 아파트 한 집(`data/apartment`, `apartment`)으로 본다.
- 집마다 `door_main` 문과 `dock`(robot_dock) 배치가 있어야 폰 AR 기준점이 된다.

### B. 보정 수정본 `edits.json`

```json
{
  "version": 1,
  "home": "oneroom",
  "saved_at": "2026-10-24T12:00:00.000Z",
  "edits": [
    { "op": "move", "id": "fridge_1", "position": [1.2, 0.5], "facing_deg": 90, "room": "room" },
    { "op": "add", "id": "wall_ac_2", "type": "wall_ac", "label": "벽걸이 에어컨", "room": "room", "position": [2.0, 0.2], "facing_deg": 90 },
    { "op": "remove", "id": "tv_1" }
  ]
}
```

- id마다 최종 결과 하나: 더한 뒤 지움 → 없음, 더한 뒤 옮김 → add(최종 자리), 원래 것을 옮김 → move, 원래 것을 지움 → remove.
- `position`은 평면도 [x, y] m, `facing_deg`는 [0, 360). move·add에 선택 필드 `elevation`(벽 걸이의 아래쪽 높이, m). 벽 걸이 종류를 더할 때는 꼭 넣는다. add는 올려놓기(`on`)를 지원하지 않는다.
- `python -m studio apply-edits --home <id> <edits.json>`: placement.json에 반영하고 배치 검사 결과를 보인다. 빌드는 따로 한다.

### C. twin-home `/events` 추가 메시지

- `{type:"layout", op:"move", id, room, plan:{position:[x,y], facing_deg}, position:[x,h,y], rotation:[0,ry,0]}`
- `{type:"layout", op:"add", object:<scene.json 객체 모양 + footprint·height>}`
- `{type:"layout", op:"remove", id}`
- 연결 때 지금 보정 상태를 위 메시지들로 다시 보낸다. 되돌리기는 반대 메시지들로 보낸다.
- `{type:"focus", focus:{targets:[{id,label,position:[x,h,y]}], at, ttl_ms}}`: 클로이드가 방금 다룬 객체. 빈 targets면 지운다.
- three.js 회전: `rotation.y = -(facing_deg - 90)°`(라디안).

### D. 폰 `/phone/events` 추가 메시지

- 폰 → 서버: `pose`에 `hit: [x,y,z] | null`(조준점 바닥 점), `{type:"say", text}`, `{type:"confirm", token}`, `{type:"cancel", token}`.
- 서버 → 폰: `{type:"reply", text, pending:[{token, deviceLabel, reason}]}`, `{type:"focus", targets:[{id,label,ar:[x,y,z]}], ttl_ms}`.
- "여기": 맞춘 상태에서 받은 마지막 `hit`의 평면도 좌표. 15초 지나면 쓰지 않는다.

### E. 에이전트 배치 도구 (서버 안 에이전트 전용, MCP 제외)

`find_objects(query)`, `move_object(object_id, to?: "here", x?, y?, dx?, dy?, facing_deg?, turn_deg?)`, `add_object(type, label?, to?: "here", x?, y?, facing_deg?)`, `remove_object(object_id)`, `find_object_types(query)`, `save_layout()`.
평면도 좌표: +x = 평면도 오른쪽, +y = 평면도 아래쪽.

---

## Task 1: twin-studio 집 목록과 공용 카탈로그

**Files:** Create `studio/homes.py`, `homes.json`, `tests/test_homes.py`. Move `data/apartment/catalog` → `data/catalog`. Modify `studio/__main__.py`, `studio/apartment/planrun.py`, `studio/apartment/check.py`, `blender/apartment/framework.py`, 카탈로그 경로를 쓰는 테스트들, `data/README.md`.

**Interfaces:** `load_registry(root=ROOT) -> Registry(default, viewer, library, homes: dict[str, Home])`, `Home(id, name, data, out, build)`, `resolve_home(id: str | None, root=ROOT) -> Home`, `catalog_dir(data_dir: Path, root=ROOT) -> Path`.

- [ ] 실패 테스트: 목록 읽기, 기본 집, 없는 id 오류, 잘못된 id 오류, homes.json 없을 때 아파트, catalog_dir 규칙(집 폴더 catalog 우선, 없으면 공용).
- [ ] 구현, 카탈로그 이동(`git mv`), 경로 쓰는 곳을 `catalog_dir`로.
- [ ] CLI `--home`(apt-plan·apartment·apt-check), `homes`(목록) 명령.
- [ ] 전체 pytest·ruff 통과.

## Task 2: 원룸 예시 집과 빌드

**Files:** Create `data/homes/oneroom/floorplan.json`, `data/homes/oneroom/placement.json`. Modify `homes.json`, `.gitignore`(`homes/*/` 산출물, `library/`).

- [ ] 원룸(방 하나·욕실·현관, 약 4×6m)에 실제 원룸에 흔한 가전만: 냉장고, 세탁기, 벽걸이 에어컨, TV, 천장등, 로봇청소기·충전대, 클로이드 도크, 월패드, 침대·책상.
- [ ] `python -m studio apt-plan --home oneroom --strict` 오류 0, 로봇 동선 OK.
- [ ] `python -m studio apartment --home oneroom --no-render` 성공, `apt-check --home oneroom` 통과.

## Task 3: apply-edits와 library

**Files:** Create `studio/edits.py`, `tests/test_edits.py`. Modify `studio/__main__.py`.

**Interfaces:** `apply_edits(placement: dict, edits: list[dict]) -> tuple[dict, list[str]]`(새 배치, 경고), CLI `apply-edits --home ID FILE [--dry-run]`, `library [--only TYPE ...]`.

- [ ] 실패 테스트: move(자리·방향·방 바뀜, elevation·on 유지), add(새 항목, id 중복 거절), remove, 모르는 id 경고, 다른 집 파일 거절, 파일 쓰기 형식(한 항목 한 줄) 유지.
- [ ] 구현 → 통과. library는 Blender `--only` 전 종류를 `library/`로.

## Task 4: twin-home 집 고르기

**Files:** Create `src/model/homes.ts`, `tests/homes.test.ts`. Modify `src/model/devices.ts`, `src/server/start.ts`, `src/server/app.ts`, `tests/helpers/*`.

**Interfaces:** `resolveHome(studioDir: string, id?: string): Home` (`{id,name,dataDir,outDir,viewerDir,libraryDir,catalogDir,scenePath}`), `listHomes(studioDir)`, `loadTwin(dir?, {home?})`, `TwinData.home`. 서버: `/twin/viewer/*` → viewerDir, `/twin/lib/*` → libraryDir, `/twin/*` → outDir, `GET /api/homes`, health에 `home`.

- [ ] 실패 테스트: homes.json 읽기, 기본·없는 id, homes.json 없을 때 아파트, loadTwin이 고른 집의 scene.json을 읽음, `/twin/viewer/`와 `/twin/scene.json`이 서로 다른 폴더에서 나옴.
- [ ] 구현 → 통과(기존 테스트 포함).

## Task 5: 배치 편집기

**Files:** Create `src/layout/editor.ts`, `src/layout/catalog.ts`, `tests/layout-editor.test.ts`.

**Interfaces:** `loadCatalog(dir): Map<string, TypeInfo>`, `class LayoutEditor { objects(); find(q); move(id, to, facing?); add(type, to, opts); remove(id); reset(); edits(); syncMessages(); save(path); subscribe(cb) }`, `To = {x,y} | {dx,dy} | "here"`(here는 생성자에 준 `here()`로 푼다).

- [ ] 실패 테스트: 옮기면 방 바뀜·높이 유지·회전 계산, 집 밖 거절, 구조·문 거절, 상대 이동, 방향만 돌리기, 더하기(id 생성·자리·높이·asset 경로·library 대체·회색 상자), 빼기, 되돌리기 반대 메시지, 압축 규칙, 저장 파일 모양, here 없음 오류.
- [ ] 구현 → 통과.

## Task 6: 배치 도구·REST·WS

**Files:** Create `src/agent/layoutTools.ts`. Modify `src/agent/tools.ts`(ToolBackend.layout), `src/agent/agent.ts`(옵션 layout), `src/agent/prompts.ts`, `src/agent/providers/mock.ts`(여기·저장 의도), `src/server/app.ts`, `src/server/start.ts`, tests.

- [ ] 실패 테스트: 도구로 옮기기·더하기·지우기·저장, mock "냉장고 여기야" → move_object(here), "배치 저장해" → save_layout, `GET /api/layout`, `POST /api/layout/save|reset`, WS 연결 때 보정 상태 재전송, 변경 브로드캐스트.
- [ ] 구현 → 통과.

## Task 7: 뷰어 보정·초점 표시

**Files:** Create `apartment/viewer/layout.mjs`, `apartment/viewer/test/layout.test.mjs`. Modify `apartment/viewer/live.mjs`, `main.mjs`, `test/live.test.mjs`.

**Interfaces:** `applyLayoutMessage(msg, ops)`(순수 분기), 뷰어 `moveObject(id, entryPatch)`, `addObject(object)`, `removeObject(id)`, `setFocus(focus)`.

- [ ] 실패 테스트(node): layout 메시지 분기, 회색 상자 크기, 초점 만료 계산, live가 layout·focus를 넘김.
- [ ] 구현 → 통과. 헤드리스 크롬으로 실제 이동·추가·삭제·초점 고리 확인.

## Task 8: 폰 "여기"·음성·승인

**Files:** Modify `src/phone/session.ts`(hit → 평면도 점), `src/phone/align.ts`(`fromTwin`), `src/phone/server.ts`(say·confirm·cancel, reply, focus 보내기), `web/phone/*`(말하기 버튼·글 입력·답 읽기·승인 버튼), tests.

- [ ] 실패 테스트: fromTwin이 toTwin의 역, 맞춘 뒤 hit가 here가 됨·15초 만료·맞추기 전 없음, say → onSay 결과가 reply로, confirm/cancel 전달.
- [ ] 구현 → 통과.

## Task 9: 초점

**Files:** Create `src/layout/focus.ts`, `web/phone/project.js`, tests. Modify `start.ts`(에이전트 답 → 초점 방송), `web/phone/phone.js`·`capture.js`(화면 고리·프레임에 그리기), `web/app.js`(대화 로그에 폰 대화·배치 변경).

- [ ] 실패 테스트: actions → targets(기기·배치 도구 대상, 중복 제거, 높이 = 바닥 + 키/2), 투영(앞·뒤·화면 밖 가장자리), 폰 초점이 AR 좌표로 감.
- [ ] 구현 → 통과.

## Task 10: 문서와 전체 검증

- [ ] twin-home `docs/plan.md`(계약 A~E), `docs/reference.md`(HOME_ID, 보정, 음성, 초점), README. twin-studio README·`data/README.md`·`apartment/README.md`.
- [ ] twin-home `npm test`·`npm run typecheck`, twin-studio `uv run pytest`·`ruff`·`node --test`.
- [ ] 헤드리스 크롬: 원룸으로 서버 실행 → 가짜 폰 맞추기 → "여기" 옮기기 → 뷰어 반영 → 저장 → apply-edits → 초점 고리.
