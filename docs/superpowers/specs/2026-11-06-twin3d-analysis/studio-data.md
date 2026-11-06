# studio-data 분석: 한양목련 `mokryeon_180b` 데이터와 빌드 파이프라인

기준: twin-studio `feat/viewer-wall-touch`(41f9589), 빌드 산출물 2026-11-04 10:45. 파일은 고치지 않았어요.

## 0. 한눈에

- 구조(방 15·벽 39·덩어리 4·문 15·창 10)는 **공개 180B 도면을 손으로 옮긴 것**이에요. 1202동 실측이 아니고, 천장 2.30m·벽 두께 등은 가정값이에요.
- 가구·가전 30개는 **모두 팀원 라벨(김준형)에서 왔어요**. 다만 라벨이 준 건 "도면 위 사각형"뿐이라 **방향은 자동 추정**, 높이는 카탈로그 기본값, 5종은 라벨 크기 대신 모델 크기예요. 지금 scene.json에는 이 출처 구분이 없어요.
- 좌표는 그대로 쓰면 돼요: **three.js (x, 높이, z) = 평면도 (x, h, y)**, 단위 m, 회전 `rotation.y = (90 − facing_deg)°`.
- 벽은 이미 벽 id별 노드 + 아래(0~1.05m)/위(1.05~2.30m) 두 조각 + 면마다 방 id·법선이 있어요. **방 여러 개에 걸친 벽 조각 10개**는 방별로 못 나눠요.
- 모델은 전부 Blender 파이썬으로 만든 파라메트릭 모델이에요. 크기는 카탈로그와 맞지만, 재질은 **바탕색+노멀만** 있고 거칠기·금속·AO 그림이 없어요. 그림은 numpy로 만든 절차 텍스처(최대 1024px)예요.
- 집 전체 GLB 7.3MB, 그리는 삼각형 약 30만, 프리미티브 859개(최적화 전 드로콜 수준).
- 압축 도구: **Blender 5.2 내보내기에 Draco·Meshopt가 들어 있어요.** gltf-transform·gltfpack·toktx·basisu는 **없어요**(KTX2 불가).

## 1. 파일과 뜻

| 경로 | 내용 | 만드는 쪽 | git |
|---|---|---|---|
| `homes.json` | 집 목록 3개(apartment 기본, oneroom, mokryeon_180b). id → data·out 폴더 | 손 | 추적 |
| `data/homes/mokryeon_180b/floorplan.json` | 방·벽·덩어리·문·창·트인 경계·AR 기준점, 축척·원점 | 손(도면 트레이싱) | 추적 |
| `.../placement.json` | 가구·가전 30개: id·type·label·room·position[x,y]·facing_deg·(elevation)·label_name | `import-labels` | 추적 |
| `.../catalog/*.json` (53개) | 이 집 전용 종류. 가구·가전 28종(`generated_by: import-labels`, `builder`로 공용 빌더 재사용) + 문 15·창 10(`mk_*`, 폭을 도면에 맞춘 변형) | import-labels / 손 | 추적 |
| `.../reference.jpg` | KB 180B 공개 평면도(16,200mm = 576px) | 다운로드 | 추적 |
| `build/mokryeon_180b/geometry.json` | Blender 입력: 벽 조각 프리즘(아래/위·문창 구멍), 바닥 판, 걸레받이 128개, 슬래브, 문·창(facing·z 포함), 놓인 객체(높이·yaw 계산 끝남) | `apt-plan` | 무시 |
| `build/mokryeon_180b/layout_errors.txt` | 배치 검사 오류. **0바이트 = 오류 0건** | `apt-plan` | 무시 |
| `homes/mokryeon_180b/scene.json` | 런타임 계약: 축 정보, plan(방·벽 면·문·창·AR), stage(카메라·해·배경), objects 57개 | Blender `export.py` | 무시 |
| `.../assets/<분류>/<type>.glb` (55개, 약 12MB) | 종류별 GLB. 구조 2(walls, floors) + 가전 8 + 가구 20 + 문창 25 | Blender | 무시 |
| `.../apartment_complete.glb` | 전체 배치 GLB 7.3MB(법선 8비트 양자화 `KHR_mesh_quantization`) | Blender + `glbslim` | 무시 |
| `.../preview.png`, `rooms/<방>.png` 15장 | Cycles 렌더(전체·방별). 기존 화면 비교용으로 쓸 수 있어요 | Blender | 무시 |
| `.../plan.png`, `plan_overlay.png` | 2D 배치도, 원본 도면 겹침 | `apt-plan` | 무시 |

- `homes/`, `library/`, `build/`는 gitignore예요. 다른 PC는 Blender로 다시 빌드해야 해요.
- `preview.png`(09:51)는 마지막 빌드(10:45, 현관문 변경)보다 먼저 그려졌어요.
- 공용 `library/assets`(105종, 18MB)에 CLOiD `robot.glb`(1.6만 삼각형, `mode` 상태), 변기·세면대·샤워부스·싱크대·식물·러그·TV·조명이 있어요. 목련 집에는 안 놓였어요.
- 지금 8200 서버는 **apartment(마곡) 집**을 띄우고 있어요(`/api/health` home.id = apartment, `/twin/scene.json` 171KB). 목련을 보려면 집 선택을 바꿔야 해요.

## 2. 좌표계

| 항목 | 값 |
|---|---|
| 평면도 단위·축 | m. x = 그림 오른쪽, y = 그림 아래 |
| 축척·원점 | 0.028125 m/px(16,200mm/576px), 원점 = 그림 (171, 97)px |
| 평면도 → three.js | `(x, y)`, 높이 h → `(x, h, y)`. three는 +Y 위, 평면도 y = three +Z. 위에서 보면 그림과 같은 방향(뒤집힘 없음) |
| 평면도 → Blender | `(x, −y, z)`. glTF Y-up 내보내기로 three와 맞아요 |
| 범위 | x 0 ~ 16.2, z −0.478 ~ 14.175(주방 쪽 0.48m 튀어나옴). 중심 약 (8.1, 6.85) = `stage.camera.target` |
| 높이 | 마루 바닥 0, 전실·현관·발코니 −0.10, 바닥판 아래 z_min −0.112, 슬래브 −0.30, 천장 2.30(가정), 벽 자르기 1.05 |
| facing_deg | 평면도에서 정면 방향. 0 = +x, 90 = +y(three +Z), 180 = −x, 270 = −y |
| 회전 | three `rotation = [0, rad(90 − facing_deg), 0]`, Euler XYZ. 에셋 로컬 정면 = three +Z |
| 원점 규칙 | floor·surface: 바닥 접촉면 중앙 / wall: 뒷면 아래 중앙, `elevation` = 아래 높이(벽걸이 에어컨 1.95) / ceiling: 윗면 중앙 / opening: 개구부 아래 중앙, 로컬 y=0이 벽 중심선(창은 원점 = sill 높이) |
| 방 폴리곤 | **벽 중심선 기준**. 실제 바닥(벽 안쪽)은 반두께(외벽 0.10, 내벽 0.075)만큼 안쪽 |
| 벽 면 법선 | `plan.walls[].faces[] = {room, normal:[nx, ny]}`, 방 안쪽을 향함. three로는 `(nx, 0, ny)` |
| 방위 | **확인 안 됨.** README: "ne/sw는 그림 위치 이름". 마곡 집 계약의 "x=동, y=남"을 목련에 쓰면 안 돼요 |
| 기본 카메라·해 | 정사영, +x·+z 쪽 위(고도 50°, 방향 [0.4545, 0.766, 0.4545]). 해는 −x·+z 쪽 고도 35°, #FFEDD6. 배경 #DCDAD6 |

- three 월드 좌표를 평면도 m 그대로 두면 CLOiD·눈(eye)·목표 지점·경로를 바꿀 필요가 없어요. 화면 계산용 중심 이동은 렌더러 안 그룹에서만 해요.
- 위치 → 방: 중심선 폴리곤끼리 변을 공유하므로 경계 위 점은 두 방에 걸려요. 안쪽 폴리곤 + 가장 가까운 방 보정이 필요해요.

## 3. 구조 데이터가 지오메트리가 되는 길

```
floorplan.json ─┐
placement.json ─┼─ studio apt-plan (shapely: plan.py·layout.py·geometry.py)
catalog/*.json ─┘      벽 조각(모서리 겹침 없음)·면별 방·문창 구멍·바닥판·걸레받이·배치 검사
                       → build/<id>/geometry.json, plan.png, layout_errors.txt
                ─ studio apartment (Blender 5.2 headless: blender/apartment/*)
                       structure.py: 벽·바닥 메시 / assets/*.py: 종류별 빌더 / export.py: GLB·scene.json
                       → homes/<id>/assets/**.glb, apartment_complete.glb, scene.json, 렌더
                ─ studio apt-check: 파일·원점·크기(±5cm 경고, ±15cm 실패)·상태 연결·텍스처 1024px·12MB
```

### 방 15개 (면적 = 중심선 기준, 합계 약 200m², 발코니 포함)

| id | 이름 | 면적 m² | 바닥 | floor_z | 벽 마감 |
|---|---|---|---|---|---|
| living | 거실·복도 | 51.6 (꼭짓점 12, 십자형) | 마루 | 0 | 도장 |
| bed_se | 침실 2 | 19.5 | 마루 | 0 | 도장 |
| balcony_front | 전면 발코니 | 18.8 (곡선을 직선 3개로) | 발코니 타일 | −0.1 | 도장 |
| alpha | 알파룸 | 16.7 | 마루 | 0 | 도장 |
| bed_ne | 침실 3 | 16.6 | 마루 | 0 | 도장 |
| kitchen | 주방·식당 | 14.5 | 마루 | 0 | 도장 |
| bed_sw | 침실 1 | 14.3 | 마루 | 0 | 도장 |
| balcony_north | 후면 발코니 | 12.4 | 발코니 타일 | −0.1 | 도장 |
| vestibule | 전실 | 9.9 | 현관 타일 | −0.1 | 도장 |
| bath_center | 욕실 2 | 6.0 | 욕실 타일 | 0 | 타일 |
| balcony_west | 서측 발코니 | 5.8 | 발코니 타일 | −0.1 | 도장 |
| bath_east | 욕실 3 | 4.6 | 욕실 타일 | 0 | 타일 |
| bath_west | 욕실 1 | 3.7 | 욕실 타일 | 0 | 타일 |
| entrance | 현관 | 3.3 | 현관 타일 | −0.1 | 도장 |
| closet | 수납공간 | 2.8 | 마루 | 0 | 도장 |

- 트인 경계(벽 없음) 2곳: entrance–living, kitchen–living. 방 강조·경계선을 그릴 때 이 변은 벽이 없어요.
- 식탁·식기수납장은 `living` 폴리곤 안이에요(x 8.8~11.8, z 2.2~6.0). "주방·식당"(kitchen)에는 냉장고·인덕션·주방수납장만 있어요.
- 방 데이터에 없는 것: 안쪽 폴리곤, 중심·이름표 자리, 방 종류(침실·욕실 등), 이웃 방 목록(문·트인 경계로 계산 가능).

### 벽 43조각 (외벽 18 + 내벽 21 + 덩어리 4)

- 두께: 외벽 0.20, 내벽 0.15. 덩어리(샤프트 3·기둥 1)는 바닥~천장 꽉 찬 블록.
- `walls.glb`: `walls` → `wall_<id>`(extras `wall = {id, kind, faces}`) → `wall_<id>_lower`(z −0.112~1.05) · `wall_<id>_upper`(1.05~2.30). 문·창 자리는 구멍과 위·아래 조각으로 나뉘어 있어요.
- 재질은 면별: 방 쪽 `paint_warm` 또는 `tile_bath_wall`, 바깥 `facade`, 아래 조각 윗면(1.05m 단면) `wall_cap`(검정), 덩어리 윗면 `solid_core`(빗금). 위 조각 꼭대기(2.30m)는 흰색 `paint_warm`이에요(레퍼런스처럼 짙은 단면이 아님).
- 옆면은 방 경계에서 면이 나뉘지만 **한 메시 안**이에요. 방 여러 개에 걸친 조각 10개: `E07`(2방), `E10`(4), `E18`(3), `alpha_top`, `alpha_right`(4), `balcony_north_bottom`(4), `bed_ne_bottom`, `bed_se_top`, `front_boundary`(4), `vest_bottom`. 이 조각들은 방 하나만 낮추거나 숨길 수 없어요.
- 자르기 높이는 1.05m 하나로 메시에 박혀 있어요. 다른 높이로 자르려면 다시 빌드하거나 렌더러에서 clipping으로 해야 해요.

### 문 15 · 창 10 · 바닥

- 문: 여닫이 10, 미닫이 5. `position` = 벽 중심선 위 개구부 중앙, 높이 2.05(가정), 폭은 도면 픽셀 근사. 경첩·`swing_into`·`connects` 있음. 문마다 폭이 달라 종류가 15개로 갈려요(인스턴싱 불가).
- 창: 일반 sill 0.9, 발코니 sill 0.15, head 2.15(가정). `room` 쪽이 정면. 상태 없음.
- 바닥: 방마다 `floor_<room>`(중심선 폴리곤, 벽 밑까지 깔림) + `slab` + 방마다 걸레받이(0.07m). 천장은 없어요.

## 4. 객체 목록

### 종류별 개수 (scene.json objects 57)

| 분류 | 개수 | 상태 있음 | twin-home 기기 |
|---|---|---|---|
| 구조(walls, floors) | 2 | – | – |
| 가전 | 8 | 6: 스탠드 에어컨(power), 벽걸이 에어컨(power), 냉장고(door), 인덕션(power), 세탁기(running·door), 건조기(running) | **6개 그대로 기기**. 김치냉장고·냉동고는 상태 없음 → 기기 아님 |
| 가구 | 22 | 0 | – |
| 문 | 15 | 15(door), 현관문은 lock도 | **기기 아님**: 종류 이름이 `mk_door_*`라 twin-home `TYPE_RULES`(`door_main`, `door_room_*` 등)에 안 맞아 빠져요 |
| 창 | 10 | 0 | – |

- 기기 id = scene 객체 id 그대로예요(예: `fridge_bbc363a3`, `washer_d559f0ae`). id 규칙 `<기본 종류>_<라벨 영역 id 앞 8자>`. 같은 라벨 파일을 다시 넣으면 그대로고, 라벨을 새로 그리면 바뀔 수 있어요.
- 없는 것: TV, 조명, CLOiD 로봇·충전대, 욕실 설비(변기·세면대·욕조), 싱크대 조리대, 소품(식물·러그·액자). 도면 그림에는 욕실 설비 3곳·주방 싱크 조리대가 그려져 있지만 객체로 넣지 않았어요.

### 무엇이 실제고 무엇이 추정인가

| 항목 | 출처 | 신뢰 |
|---|---|---|
| 방·벽·문·창 위치와 폭 | 공개 180B 도면 손 트레이싱 | 도면 기준 근사(1px = 2.8cm). 이 세대 실측 아님 |
| 천장·벽 두께·문 높이·창 높이·단차·마감 | 가정값(README 표) | 가정 |
| AR 기준점 2개 | 도면 모서리 후보 | 미보정 |
| 가구·가전 30개의 존재·종류·방 | 팀원 라벨 이름(`label_name`) | **실제** |
| 위치(중심) | 라벨 사각형 중심, 벽 0.25m 안이면 벽에 붙이고 방 안으로 밀어 넣음 | 실제(조정됨) |
| 크기(폭·깊이) | 25개 라벨 사각형 / 5개(소파·거실 테이블·세탁기·건조기·스탠드 에어컨) 모델 크기 | 25 실제, 5 모델값 |
| 방향(facing) | 라벨에 방향이 없어 "등 = 가장 가까운 벽" 규칙으로 계산 | **추정** |
| 높이 | 공용 카탈로그 기본값 | 가정 |
| 모양 | 공용 빌더. 대체 형태 4종: 냉동고 → 김치냉장고 빌더, 화장대 → 책상 빌더, 식기수납장·주방수납장 → 하부장(counter_base_60) 빌더. 수납장 → 옷장 빌더 | 비슷한 모양 |

- 이 출처 구분은 `placement.json`의 `label_name`과 카탈로그 `generated_by`에만 흔적이 있고, **scene.json에는 없어요**. 새 렌더러가 "실제 / 임시"를 나눠 그리려면 scene.json에 출처 필드가 필요해요(6절 P0-1).

### 30개 목록

| id | 종류(빌더) | 방 | 라벨 | 크기 출처 |
|---|---|---|---|---|
| stand_ac_dc22b8f3 | stand_ac ●power | living | 에어컨_거 | 모델 |
| wall_ac_703d00ba | wall_ac ●power, 높이 1.95 | bed_sw | 에어컨_침1 | 라벨 |
| fridge_bbc363a3 | fridge ●door | kitchen | 냉장고 | 라벨 |
| induction_counter_5641ccf0 | induction_counter ●power | kitchen | 인덕션 | 라벨 |
| washer_d559f0ae | washer ●running·door | balcony_north | 세탁기 | 모델 |
| dryer_7aa61816 | dryer ●running | balcony_north | 건조기 | 모델 |
| freezer_0c022ae2 | freezer(kimchi_fridge) | balcony_north | 냉동고 | 라벨 |
| kimchi_fridge_bce0bf96 | kimchi_fridge | balcony_north | 김치냉장고 | 라벨 |
| bed_queen_aedb6a01 / _08dcffff | bed_queen ×2 | alpha / bed_ne | 침대_알 / 침대_침3 | 라벨 |
| bed_single_100dda69 | bed_single | bed_sw | 침대_침1 | 라벨 |
| bed_single_2f581c50 | bed_single_2 | bed_se | 침대_침2 | 라벨 |
| sofa_a848b595 | sofa | living | 소파 | 모델 |
| coffee_table_38536572 | coffee_table | living | 테이블 | 모델 |
| armchair_d3ed5f21 / _39fafa97 | armchair ×2 | living | 의자_1 / 의자_2 | 라벨 |
| tv_stand_2fdbdf48 | tv_stand(3.74m) | living | TV수납장_거 | 라벨 |
| storage_cabinet_f657b011 | storage_cabinet(wardrobe) | living | 수납장_2 | 라벨 |
| dish_cabinet_6c6899cf | dish_cabinet(counter_base_60) | living | 식기수납장 | 라벨 |
| dining_table_978b20c7 | dining_table | living | 식탁 | 라벨 |
| kitchen_cabinet_23109a26 | kitchen_cabinet(counter_base_60) | kitchen | 주방수납장 | 라벨 |
| wardrobe_0358a8fe | wardrobe | bed_se | 옷장_침2 | 라벨 |
| tv_stand_4136aadf | tv_stand_2 | bed_se | TV수납장_침2 | 라벨 |
| wardrobe_4ef026d4 / _9135a34e | wardrobe_2 / _3 | bed_sw | 옷장_침1_1 / _2 | 라벨 |
| bookcase_6b627971 | bookcase | bed_sw | 책장 | 라벨 |
| desk_small_ce7e768b | desk_small | bed_sw | 책상 | 라벨 |
| wardrobe_dba14d56 | wardrobe_4 | alpha | 옷장 | 라벨 |
| dresser_6e620743 | dresser(desk_small) | alpha | 화장대 | 라벨 |
| tv_stand_48d2767d | tv_stand_3 | alpha | TV수납장_알 | 라벨 |

(●는 상태 있음. 의자 2개는 거실 테이블 쪽을 봐요. 식탁 의자는 라벨에 없어요.)

## 5. GLB 모델 품질

### 숫자

| 종류 | 삼각형 | 재질 | 그림(바탕/노멀) | KB | 평가 |
|---|---|---|---|---|---|
| fridge | 9,692 | 21 | 없음(단색) | 391 | 모양 좋음, 재질 단순 |
| washer / dryer | 9,638 / 9,858 | 24 / 22 | 있음 / 노멀 8 | 417 / 421 | 좋음 |
| stand_ac | 7,276 | 12 | 없음 | 269 | 보통 |
| wall_ac | 3,024 | 10 | 화면 1 | 137 | 보통 |
| induction_counter | 2,694 | 12 | 쿡탑·석재 | 165 | 보통 |
| kimchi_fridge / freezer | 3,062 | 8 | 표시창 1 | 108 | 단순 |
| bed_queen / bed_single | 10,964 / 9,672 | 6 | 뜨개·패브릭 노멀 | 385 / 351 | 좋음(누빔 헤드보드·이불) |
| sofa / armchair | 7,456 / 6,280 | 3~4 | 트위드·직조 노멀 | 245 / 259 | 보통 |
| wardrobe류 / storage_cabinet | 3,608 | 4 | 오크 1 | 134 | 상자형 |
| tv_stand | 3,880 | 3 | 오크 1 | 178 | 상자형 |
| desk_small / dresser | 2,648 | 4 | 오크 1 | 113 | 단순, 화장대는 책상 모양 |
| bookcase | 1,704 | 3 | 오크 2 | 95 | 단순 |
| dining_table | 1,052 | 1 | 오크 1 | 59 | 단순 |
| coffee_table | 564 | 1 | 오크 1 | 38 | 매우 단순 |
| dish/kitchen_cabinet | 932 | 5 | 석재 1 | 74 | 상자형 |
| 문(여닫이) / 미닫이 / 현관문 | 4,290~4,984 / 3,914 / 6,914 | 4~17 | 오크·대리석 | 142~380 | 보통 |
| 창(10개) | 각 약 7,550 | 5~6 | 없음 | 약 293 | 문틀 자세함, 창 10개 합 7.5만 |
| walls.glb | 4,136 | 5 | 욕실 타일·빗금 | 424 | 노드 130, 프리미티브 207 |
| floors.glb | 1,912 | 6 | 1024px 마루·512px 타일 + 노멀 | 357 | 방별 바닥 15 + 걸레받이 15 + 슬래브 |

- 전체 GLB: 7.3MB, 노드 669, 메시 505, 재질 118, 그림 33장(고유). 그리는 삼각형 약 30만, 프리미티브 859개.
- 크기: 잰 가구·가전 24종(같은 빌더 크기 변형 4종 제외) 모두 GLB 경계 상자가 카탈로그 footprint·height와 1cm 안으로 맞아요. 바닥 원점 min y = 0.
- UV: 모든 프리미티브에 있음(상자 투영, 실제 m ÷ 재질 `tile`). 두 번째 UV(라이트맵)는 없음.
- 재질: Principled → glTF metallic-roughness. **바탕색 그림 + 노멀만**. 거칠기·금속은 숫자 값, AO·ORM 그림 없음. 금속 재질 5종(chrome, aluminium, stainless, brass, silver)은 metallic 1.0이라 환경광 없으면 검게 보여요.
- 그림: numpy 절차 텍스처, JPEG 90, 128~1024px(대부분 512). apt-check가 1024px 넘으면 경고. 확대하면 마루(1024px/2m = 512px/m) 외에는 흐려질 수 있어요.
- 유리·반투명: `openings_glass`(alpha 0.2 + 발광 0.27), `glass`(alpha 0.5 + 발광 0.87), `openings_frosted`(발광 0.31)처럼 **발광으로 밝기를 흉내** 내요. HDR 환경광을 쓰면 빛나 보여요. transmission 확장은 안 써요.
- 상태 표현: 부품 extras `part` 라벨 + 루트 `states_json`. 빛은 Empty + `light` JSON(three에서 켤 때 만듦). GLB는 "켜진 모습"으로 내보내고 뷰어가 끄는 방식이에요(일반 glTF 뷰어로 보면 효과 부품이 다 보임).
- 같은 그림이 개별 GLB마다 따로 들어 있어요(고유 33장인데 개별 GLB 합계 79장, 예: oak 13번). 개별 GLB를 따로 불러오면 GPU에 여러 번 올라가요.
- 인스턴싱 효과는 작아요: 같은 종류 2개 이상은 bed_queen·armchair뿐이에요. 문·옷장은 크기마다 다른 종류예요.

### 레퍼런스 그림과 차이 (데이터 쪽)

- 레퍼런스는 욕실 설비·주방 조리대·러그·식물·조명·소품이 가득해요. 지금 데이터에는 이게 없어요. 넣으려면 "도면 그림 기준"(욕실·싱크) 또는 "꾸밈 임시"로 출처를 달고 넣어야 해요.
- 레퍼런스 벽은 꼭대기 단면이 짙은 회색이에요. 지금은 1.05m 단면만 짙고 2.30m 꼭대기는 흰색이에요.
- 레퍼런스의 나무 포인트 벽·질감 있는 바닥은 고해상 PBR 그림이 있어야 나와요.

## 6. 고품질로 가려면 파이프라인에서 바꿀 것

P0 = 렌더러가 기대는 데이터 계약, P1 = 화질, P2 = 성능·압축. 모두 twin-studio 쪽 작업이고 기존 필드는 그대로 두고 **더하기만** 해요(twin-home 기기·뷰어 호환).

### P0. 데이터 계약

1. **객체 출처 필드** — `blender/apartment/export.py` `object_entry`에 `label_name`과 `provenance`를 넣어요.
   예: `{"origin":"label|plan|plan_drawing|decor|runtime", "size":"label|model", "facing":"inferred|label", "height":"catalog", "model":"builder|substitute|external|placeholder", "builder":"desk_small"}`. 문·창은 `origin: plan`. 렌더러는 `decor`·`placeholder`·`substitute`를 다르게 표시해요.
2. **방 데이터 보강** — `plan_block`에서 `rooms[]`에 `interior`(벽 반두께 안쪽 폴리곤, `plan.room_interior` 이미 있음), `center`(이름표 자리), `area`, `kind`(bedroom·bath·kitchen·living·balcony·entry·storage), `neighbors`(문·트인 경계)를 더해요. 바닥 강조·위치→방·Fit to Selection·미니맵이 같은 원본을 써요.
3. **벽을 방별로 나눠 내보내기** — `structure.py`에서 방 경계 지점(지금 `split_ring`이 면 재질용으로 이미 찾음)에서 메시도 잘라 `wall_<id>__<n>` 조각으로 내보내고, 조각마다 extras `{id, piece, rooms, faces, exterior}`를 달아요. lower/upper 나눔은 유지해요. 대상은 3절의 10조각. 위 조각 꼭대기 면도 `wall_cap`(짙은 단면)으로 바꿀지 선택(레퍼런스 모양).
4. **재질 이름 고정 + 분류 표시** — 재질 이름(`floor_wood`, `paint_warm`, `tile_bath_wall`, `facade`, `oak`…)은 이미 안정적이에요. extras에 `pbr: "wall_paint|wood_floor|tile|fabric|metal|glass|plastic|emissive"`를 달면 렌더러가 품질 프리셋별로 그림을 바꿔 끼울 수 있어요(Blender 다시 빌드 없이).

### P1. 화질

5. **PBR 그림 세트** — `lib/materials.Spec`에 `rough_map`·`metal_map`·`ao_map`(또는 ORM 한 장)과 **파일 그림**(CC0: ambientCG·Poly Haven) 경로를 더해요. Blender glTF 내보내기는 Separate Color(G=거칠기, B=금속)로 연결하면 `metallicRoughnessTexture`, glTF Material Output 노드로 `occlusionTexture`를 내보내요. 그림은 `library/textures/<이름>/`에 두고 `LICENSE.json`(출처·라이선스)을 같이 둬요. apt-check 1024px 규칙은 바닥·벽만 2048px까지 풀어요.
   - 빠른 길: 런타임에서 재질 이름으로 그림을 바꿔 끼우기(P0-4). Blender 빌드 없이 품질 실험이 돼요.
6. **유리·반투명 정리** — 유리 재질의 발광을 빼고 alpha 또는 `KHR_materials_transmission`(Blender 5.2 내보내기 지원)으로 바꿔요. 옛 뷰어 밝기 맞춤이므로 옛 뷰어용 값과 새 값을 나누거나 렌더러에서 덮어써요.
7. **외부 GLB 받아 넣기**(CC0·CC-BY) — 새 빌더 가족(`blender/apartment/assets/external.py`)으로 처리해요. 카탈로그 `external: {file, url, author, license, up, front, fit}`.
   - 가져오기: `bpy.ops.import_scene.gltf` → 위 축·정면 축을 계약(정면 −Y, 위 +Z)으로 돌림 → 원점을 mount 규칙 자리로 → footprint·height에 **균등 배율**로 맞춤(종횡비 차이 5% 넘으면 경고, 15% 넘으면 실패 = 기존 apt-check와 같은 기준) → 삼각형 예산 넘으면 Decimate → 그림 1~2K로 줄임.
   - 상태 있는 가전: 외부 모델엔 `part` 라벨이 없어요. 몸통만 외부 모델로 쓰고 문 회전축·화면·LED·바람 같은 상태 부품은 기존 빌더 것을 붙이는 혼합형으로 해요. 안 되면 기존 빌더 유지.
   - 라벨 크기에 정확히 맞아야 하는 수납·붙박이(옷장·수납장·TV장·책장·하부장)는 파라메트릭 유지 + PBR 재질만 개선해요. 자유 형태(소파·암체어·침대·테이블·식물)는 외부 모델이 효과가 커요.
   - CC-BY는 `homes/<id>/CREDITS.json`과 화면 출처 표기용 목록을 함께 만들어요.
8. **도면 그림 기준 설비** — 욕실 3곳 변기·세면대, 욕실 2·3 욕조, 주방 싱크 조리대는 도면에 그려져 있어요. 넣으면 `origin: plan_drawing`(이 세대 실측 아님)으로 표시해요. 욕조 종류는 공용 카탈로그에 없어요. **사용자 결정 필요.**
9. **정적 AO 굽기(선택)** — 벽·바닥만 Cycles로 AO를 구워 UV2에 넣을 수 있어요. 가구는 twin-home에서 실행 중 옮길 수 있어 구우면 틀려져요(가구 접지는 GTAO로). 이 PC는 Cycles CPU라 오래 걸려요(방별 1K 기준, 확인 필요).

### P2. 성능·압축

10. **압축** — Blender 5.2 내보내기 옵션만 켜면 돼요: `export_draco_mesh_compression_enable` 또는 `export_meshopt_compression_enable`(EXT_meshopt_compression). three는 `DRACOLoader`·`MeshoptDecoder`로 풀어요. 로컬 서버라 내려받기 이득은 작고, 지금 7.3MB도 문제는 아니에요.
11. **KTX2** — 고해상 PBR 그림을 넣으면 필요해요. 2048px 그림 40장이면 RGBA8로 약 900MB(밉맵 포함), KTX2(BC7/ETC1S)면 약 220MB 이하예요. 이 PC GPU 전용 메모리 2GB라 KTX2 없이 2K 세트는 위험해요. 도구가 없으니 `@gltf-transform/cli` + KTX-Software(`toktx`) 설치가 필요해요. 색은 ETC1S, 노멀·ORM은 UASTC.
12. **그림 중복 없애기** — 개별 GLB마다 같은 그림이 들어 있어요. 후처리(`gltf-transform dedup`)나 런타임 그림 캐시(이름 기준)로 한 번만 올려요.
13. **드로콜** — 859 프리미티브 × (본 화면 + 그림자). 벽·바닥·걸레받이는 재질별로 합치되, 벽 숨김을 위해 `BatchedMesh`(조각별 보이기) 같은 방식이 필요해요. 가구는 실행 중 옮겨지므로 영구 병합은 안 돼요.
14. 창 10개가 7.5만 삼각형이에요. Performance 프리셋용으로 창틀 단순 LOD를 같이 내보내면 좋아요.

### 그대로 둘 것

- 좌표·회전 규칙, 객체 id·방 id, `attrs`·`states`·`part` 라벨 방식, scene.json 기존 필드, 개별 GLB 경로 규칙(`assets/<분류>/<type>.glb`). twin-home 기기 목록·배치 보정(edits.json)·눈(eye)이 모두 여기에 기대요.

## 7. 도구 설치 상태 (확인만)

| 도구 | 상태 |
|---|---|
| Blender 5.2 | 있음 `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`(PATH엔 없음, studio가 자동으로 찾음). glTF 내보내기 5.2.40 |
| Draco 인코더 | 있음(Blender 안 `draco.dll`, `bf_intern_draco_bridge.dll`) |
| Meshopt 인코더 | 있음(Blender 안 `bf_intern_meshopt_bridge.dll`, EXT/KHR_meshopt_compression 선택) |
| WebP 내보내기 | 있음(Blender `export_image_format = WEBP`) |
| KHR_materials_transmission·volume, EXT_mesh_gpu_instancing | Blender 내보내기 지원 |
| gltf-transform CLI | 없음 |
| gltfpack | 없음 |
| toktx / ktx (KTX-Software) | 없음 |
| basisu | 없음 |
| meshoptimizer npm | `twin-home-glass/ui/node_modules/meshoptimizer` 1.1.1만 있음(@types/three 의존성, 도구 아님) |
| three (twin-home ui) | `@types/three` 0.187만 있고 `three` 패키지는 ui 의존성에 없음. 옛 뷰어는 CDN three 0.186.1 |
| 색 변환 | Blender 렌더는 AgX(Base Contrast)로 맞춘 색이에요. three에서 ACES로 바꾸면 색이 달라 보여요(three r186에는 AgX·Neutral 톤 매핑도 있음) |

## 8. 확인 필요 · 결정 필요

- 방위(북쪽): 도면에서 확인 안 됨. 해 방향·창 쪽 실내광을 실제 방위로 할지, 지금 stage 값(해 −x·+z 쪽)으로 둘지 결정 필요.
- 라벨 위치 정밀도: 라벨을 도면 그림 위에 그렸으므로 오차는 그림 픽셀(2.8cm/px)과 그린 사람 정밀도에 달려요. 확인 필요.
- 문 15개(현관 도어록 포함)가 twin-home 기기로 안 잡혀요. 에이전트가 문 열림·잠금을 써야 하면 twin-home `TYPE_RULES`에 `mk_door_*` 규칙이 필요해요.
- 목련 집에 CLOiD·충전대가 없어요. CLOiD 위치는 눈(eye)·에이전트 이벤트에서 와야 하고, 모델은 `library/assets/props/robot.glb`를 쓸 수 있어요.
- 욕실·주방 설비, 꾸밈 소품을 넣을지(넣으면 출처 표시 필수) 사용자 결정 필요.
- `living`(51.6m²)은 거실·복도·식탁 자리를 다 포함해요. Room Focus 때 너무 넓으면 하위 구역(거실/복도/식당)을 데이터로 나눌지 결정 필요.
- KTX2를 쓰려면 KTX-Software·gltf-transform 설치가 필요해요(사용자 승인).
- three r186 GLTFLoader의 `KHR_meshopt_compression` 지원 여부는 확인 필요(EXT_ 쪽은 지원).
