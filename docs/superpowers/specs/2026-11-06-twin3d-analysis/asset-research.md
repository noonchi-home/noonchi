# 에셋 조사 (asset-research)

조사일 2026-11-06. 받은 것은 목록·라이선스·크기 정보와 작은 미리보기 그림뿐이고, 모델·텍스처 본파일은 받지 않았다. 출처: Poly Haven API, ambientCG API v3, Sketchfab API v3 검색. 미리보기 묶음 그림은 `scratchpad/twin3d/ph/sheet_*.jpg`에 있다.

## 1. 결론

1. **가전 8종은 외부 모델로 바꾸지 않는다.** 냉장고·세탁기·건조기·에어컨 2·인덕션은 상태 효과가 GLB 안의 이름 붙은 부품(`extras.part`: door, display, drum, louver, airflow, 빛 기준점)을 움직인다. 외부 모델을 쓰면 이 부품이 없어져 기존 기능이 깨진다. 김치냉장고·냉동고도 한국식 모양이라 맞는 공개 모델이 없다. twin-studio 빌더를 그대로 쓰고 재질만 올린다.
2. **붙박이·길이 맞춤 가구 11종도 빌더를 유지한다.** 옷장 4(최대 3.32m), 수납장, 식기수납장 3.05m, 주방수납장, TV장 3(최대 3.74m), 책장, 책상, 화장대는 라벨 실측 크기라 기성 모델을 늘리면 모양이 찌그러진다. 맞는 크기의 공개 모델도 없다.
3. **외부 모델 후보는 소파·암체어·침대·커피 테이블·식탁 5종(실물 7개)뿐이다.** 이 중 소파·커피 테이블은 카탈로그가 이미 "모델 크기(라벨보다 작음)"라 고른 모델 크기에 맞춰 카탈로그 값을 바꿀 수 있다. 침대·식탁·암체어는 라벨 크기에 맞는 모델을 골라야 한다(오차 5cm 넘으면 apt-check 경고, 15cm 넘으면 실패).
4. **화질 차이의 대부분은 재질에서 난다.** 지금 바닥·타일·오크는 numpy로 만든 절차 텍스처(1024px, 색+노멀만, 거칠기·AO 맵 없음)다. CC0 사진 기반 PBR 텍스처(색·노멀·거칠기·AO)로 바꾸는 효과가 가장 크다.
5. **레퍼런스에 보이는 욕실 설비·주방 싱크·러그·식물·식탁 의자는 이 집 데이터에 없다.** twin-studio 라이브러리에 이미 빌더 모델이 있다(toilet, vanity, shower_booth, mirror_cabinet, sink_counter, dining_chair, nightstand, plant_monstera, plant_pothos, rug, picture_frame 등). 모자란 것은 모델이 아니라 배치 데이터다. 넣으려면 실제 데이터와 구분되는 표시가 필요하다(9절).
6. **조명용 HDRI는 1k .hdr 한 장(1.3~1.6MB)이면 충분하다.** 1순위 `brown_photostudio_02`, 2순위 `small_empty_room_1`. Balanced·Performance는 받을 파일이 없는 three.js `RoomEnvironment`를 쓴다.
7. **압축 도구는 하나도 설치되어 있지 않다.** gltf-transform·gltfpack·KTX-Software(toktx) 모두 없다. Blender 5.2는 있다(`C:/Program Files/Blender Foundation/Blender 5.2`, PATH에는 없음).
8. **twin-studio 산출 GLB에는 Draco·meshopt를 넣으면 안 된다.** apt-check가 막는다(`studio/apartment/check.py` "Draco·meshopt 없음", 텍스처 한 변 1024px 이하). 압축본은 별도 산출물로 만들어야 한다(7.4절).

## 2. 이 집에 실제로 있는 종류

`data/homes/mokryeon_180b/placement.json` 30개, 카탈로그 기준. 크기는 폭×깊이×높이(m).

| 종류 | 개수 | 방 | 크기 | 상태(부품) | 빌더 |
|---|---|---|---|---|---|
| stand_ac | 1 | 거실 | 0.36×0.36×1.85 | power(display, led_ring, airflow, shutter) | stand_ac |
| wall_ac | 1 | 침실1 | 0.827×0.211×0.27, 높이 1.95 벽걸이 | power(display, led, top_glow, louver, airflow) | wall_ac |
| fridge | 1 | 주방 | 1.064×0.778×1.85 | door(door_left·right, interior_light, 빛) | fridge |
| induction_counter | 1 | 주방 | 0.886×0.611×0.9 | power(zones, touch_display, 빛) | induction_counter |
| washer | 1 | 후면 발코니 | 0.6×0.65×0.85 (모델 크기) | running·door(display, drum, door 등) | washer |
| dryer | 1 | 후면 발코니 | 0.6×0.65×0.85 (모델 크기) | running | dryer |
| freezer | 1 | 후면 발코니 | 0.886×0.768×1.85 | 없음 | kimchi_fridge |
| kimchi_fridge | 1 | 후면 발코니 | 1.103×0.611×1.85 | 없음 | kimchi_fridge |
| bed_queen | 2 | 알파룸, 침실3 | 1.434×2.228×1.05 | 없음 | bed_queen |
| bed_single / bed_single_2 | 1+1 | 침실1, 침실2 | 1.297×2.392×0.9 | 없음 | bed_single |
| sofa | 1 | 거실 | 2.1×0.95×0.85 (모델 크기) | 없음 | sofa |
| armchair | 2 | 거실 | 0.827×0.729×0.85 | 없음 | armchair(세이지 트위드·오크) |
| coffee_table | 1 | 거실 | 1.45×0.62×0.42 (모델 크기) | 없음 | coffee_table |
| dining_table | 1 | 거실 | 1.438×0.788×0.75 | 없음 | dining_table |
| tv_stand / _2 / _3 | 3 | 거실, 침실2, 알파룸 | 3.743×0.433 / 2.285×0.906 / 1.261×0.571, 높이 0.45 | 없음 | tv_stand |
| wardrobe / _2 / _3 / _4 | 4 | 침실2, 침실1×2, 알파룸 | 3.324×0.78 / 0.698×0.827 / 0.768×0.827 / 2.974×0.589, 높이 2.1 | 없음(경첩 축만) | wardrobe |
| storage_cabinet | 1 | 거실 | 1.648×0.341×2.1 | 없음 | wardrobe |
| dish_cabinet | 1 | 거실 | 3.053×0.63×0.9 | 없음 | counter_base_60 |
| kitchen_cabinet | 1 | 주방 | 1.556×0.749×0.9 | 없음 | counter_base_60 |
| bookcase | 1 | 침실1 | 1.655×0.374×2.0 | 없음 | bookcase |
| desk_small | 1 | 침실1 | 1.043×0.847×0.75 | 없음 | desk_small |
| dresser | 1 | 알파룸 | 1.3×0.552×0.75 | 없음 | desk_small |

마감(floorplan.json): 바닥 `wood`(침실·거실·주방·알파룸·수납), `tile_entrance`(전실·현관), `tile_bath`(욕실 3), `tile_balcony`(발코니 3). 벽 `paint`, 욕실 `tile`. GLB 재질 이름: `floor_wood`, `tile_entrance`, `tile_bath_floor`, `tile_balcony`, `paint_warm`, `tile_bath_wall`, `oak`, `fabric_white`, `fabric_cream` 등. 모든 개별 GLB에 UV가 있고, UV 1 = 재질 `tile` 값(m)이다(예: floor_wood 2.0m).

지금 개별 GLB: 객체당 3.6k~11k 삼각형, 40~430KB, 텍스처는 JPEG 1024px.

## 3. 종류별 모델 후보

라이선스 표기: CC0 = 출처 표기 의무 없음. CC-BY = 제목·작가·링크·라이선스·수정 여부 표기 의무. Sketchfab 삼각형 수·용량은 원본 GLB 기준(압축 전). Sketchfab은 실제 크기 정보가 없어 받아서 재야 하고, 내려받기에 로그인이 필요하다. CC-BY 버전(4.0 등)은 모델마다 받을 때 확인 필요.

### 3.1 외부 모델을 쓸 만한 종류

| 종류 | 후보 | 출처·라이선스 | 분위기 | 폴리곤·용량 | 실제 크기 정보 | 판단 |
|---|---|---|---|---|---|---|
| sofa | Мodern sofa (avilov) `dfed5023ec614799a68d392a6a4199ed` | Sketchfab CC-BY | 맞음(밝은 베이지 낮은 모듈 소파) | 100,657 삼각형, 5.8MB, 2048×2 | 없음 | 1순위. 삼각형 줄여야 함(목표 25k) |
| sofa | Couch Complete Set (studio23) `7806c2e5146f471c98a561fc245f07c6` | Sketchfab CC-BY | 대체로 맞음(흰 소파 세트) | 13,164 / 8.5MB / 2048×2 | 없음 | 2순위. 세트에서 3인 소파만 떼야 함 |
| sofa | (Poly Haven) | - | 맞는 것 없음(가죽·빈티지뿐) | - | - | - |
| armchair | 366 Armchair (hectopod) `97e53f749df14e8c9de7a22bf99be753` | Sketchfab CC-BY | 맞음(세이지 패브릭+나무 팔걸이, 카탈로그 설명과 같음) | 52,432 / 9.8MB / 2048×5 | 없음 | 1순위 |
| armchair | Morello Armchair - Boucle (PurpleArkStudio) `9ed4a77861524425a7252a26b053d07b` | Sketchfab CC-BY | 맞음(흰 부클레 원형 의자) | 9,920 / 5.8MB / 4096×2 | 없음 | 2순위(카탈로그 설명과 색이 다름) |
| bed_queen | Upholstered Bed (cyberfox3d) `7602267cc32e4caf8c92c60b677539be` | Sketchfab CC-BY | 맞음(회색 채널 헤드보드) | 29,358 / 20.3MB / 4096×5 | 없음 | 1순위. 텍스처 1024로 줄임 |
| bed_queen | Chelsea bed with storage (bertosalotti) `cbe6e0dcc10a414a84acc5cc08171b87` | Sketchfab CC-BY | 맞음(밝은 회색 패브릭) | 105,298 / 23.1MB / 4096×3 | 없음 | 2순위(무거움) |
| bed_queen | Soho bed (bertosalotti) `97e361e8beda4112ac5b1b5bcd388cdf` | Sketchfab CC-BY | 색만 바꾸면 맞음(남색) | 68,952 / 15.7MB / 4096×1 | 없음 | 3순위 |
| bed_single(슈퍼싱글) | Ikea idanas single bed (ditovirnantio) `0ec37e3bb1b940c88ca2f73d274dcefb` | Sketchfab CC-BY | 보통(짙은 회색 틀) | 95,648 / 5.1MB / 1024×2 | 없음 | 폭 1.30에 맞는지 확인 필요. 안 맞으면 빌더 유지 |
| coffee_table | modern_coffee_table_01 | Poly Haven CC0 | 맞음(돌 상판+밝은 나무) | 4,504 / 1k 1.3MB, 2k 4.5MB | 있음 1.20×0.60×0.39 | 1순위. 카탈로그를 모델 크기로 바꿈 |
| dining_table | [Free] Dining Set Scandinavian Style (AllQuad) `61275205fe084208887d74876919aac6` | Sketchfab CC-BY | 맞음(오크 식탁·회색 의자) | 66,694 / 25.4MB / 2048×32(세트 전체) | 없음 | 식탁만 떼서 1.44×0.79에 맞는지 확인 필요 |
| dining_table | Mid Century Dining Room (mediacitygames) `eca1dcae26e94bdca36ff4be9f7503a9` | Sketchfab CC-BY | 확인 필요 | 10,128 / 8.3MB / 2048×3 | 없음 | 대안 |

### 3.2 빌더 유지(외부 모델 안 씀)

| 종류 | 까닭 | 참고만 할 후보 |
|---|---|---|
| 가전 8종 | 상태 부품이 GLB 안에 있어야 함. 공개 모델은 낡았거나 상표 모양 | Sketchfab "Kitchen Appliances"(nkilstrup) 등, 분위기 안 맞음 |
| wardrobe ×4, storage_cabinet | 길이 0.7~3.3m 붙박이, 기성품 크기 없음 | Sketchfab "Built-in wardrobe"(saintkastiell, 81k, 텍스처 없음) |
| tv_stand ×3 | 1.26~3.74m 맞춤 길이 | Sketchfab "TV Bench"(slls666, 49k, 18.9MB, 월넛 슬랫), Poly Haven `modern_wooden_cabinet`(2.44×0.52×0.68, 25k, 어두움) |
| dish_cabinet, kitchen_cabinet | 주방 하부장 맞춤 | - |
| bookcase | 1.655×2.0, Poly Haven `wooden_display_shelves_01`(1.08×0.37×1.56)는 크기 안 맞음 | - |
| desk_small, dresser | 기성품 크기와 다름 | - |

빌더 유지 종류는 재질을 CC0 텍스처로 바꾸는 것만으로 화질이 크게 오른다(5절).

### 3.3 데이터에 없는 장식(시각 전용 후보)

| 용도 | 후보 | 출처·라이선스 | 폴리곤·용량 | 실제 크기 |
|---|---|---|---|---|
| 큰 화분 | potted_plant_02 | Poly Haven CC0 | 69,806 / 1k 2.5MB | 0.70×0.66×0.84 |
| 큰 화분 | potted_plant_01 | Poly Haven CC0 | 96,030 / 1k 6.0MB | 0.59×0.64×1.35 (무거움) |
| 작은 화분 | potted_plant_04 | Poly Haven CC0 | 6,097 / 1k 2.0MB | 0.17×0.19×0.27 |
| 화분 | [FREE] Pothos Potted Plant (AllQuad) `e9832f38484f4f85b3f9081b51fa3799` | Sketchfab CC-BY | 15,744 / 3.7MB | 없음 |
| 화분 | [FREE] Pilea Peperomioides (AllQuad) `891b276aa29b4c42a0e3bc476203cb9b` | Sketchfab CC-BY | 15,436 / 3.8MB | 없음 |
| 꽃병 | ceramic_vase_01 | Poly Haven CC0 | 2,548 / 1k 0.4MB | 0.20×0.21×0.40 |
| 협탁 | side_table_01 | Poly Haven CC0 | 2,756 / 1k 0.5MB | 0.55×0.45×0.55 |
| 액자 | hanging_picture_frame_01 | Poly Haven CC0 | 2,586 / 1k 0.4MB | 0.59×0.02×0.84 |
| 바구니 | wicker_basket_02 | Poly Haven CC0 | 17,850 / 1k 2.9MB | 0.37×0.27×0.22 |
| 러그 | 얇은 판 + ambientCG `Carpet016`(베이지 울, 1.7m) | CC0 | 판 1개 | 텍스처 1.7m |
| 욕실 설비·싱크·식탁 의자·커튼 | twin-studio 라이브러리 빌더(toilet, vanity, shower_booth, mirror_cabinet, sink_counter, dining_chair, curtain_250 등) | 자체 | 기존 | 카탈로그 |

Poly Haven의 모던 가구는 적다. 소파·의자·서랍장 대부분이 빈티지·가죽이라 레퍼런스 분위기와 안 맞는다(Ottoman_01, sofa_02, dining_chair_02, modern_arm_chair_01, mid_century_lounge_chair 모두 짙은 가죽). Sketchfab CC0는 박물관 스캔뿐이라 쓸 것이 없다.

## 4. 레퍼런스 분위기 기준

레퍼런스: 밝은 오크 판재 바닥, 거실 쪽 밝은 회색 대형 타일, 흰 무광 벽, 일부 벽에 갈색 세로 목재 패널, 베이지·회색 패브릭, 초록 식물. 지금 트윈 바닥은 이보다 진하고 주황기가 있다.

## 5. 재질 텍스처 후보

크기는 텍스처 한 장이 덮는 실제 길이. Poly Haven 용량은 1k/2k JPG의 색+노멀(GL)+ARM(AO·거칠기·금속) 세 장 합. ambientCG 용량은 1K-JPG zip 전체(색·노멀 GL/DX·거칠기·변위·AO). 모두 CC0.

### 5.1 바닥 나무 (`wood`, `floor_wood`)

| 후보 | 출처 | 실제 크기 | 용량 | 모양 |
|---|---|---|---|---|
| **WoodFloor066A** | ambientCG | 정보 없음(확인 필요) | 1K 6.1MB / 2K 23.8MB | 아주 밝은 오크 판재. 1순위 |
| WoodFloor051 | ambientCG | 1.8m | 1K 4.9MB / 2K 15.7MB | 밝은~중간 갈색 엇갈림 판재, 주황기 약간 |
| laminate_floor_02 | Poly Haven | 1.7m | 1k 1.7MB / 2k 8.0MB | 중간 갈색 판재. 밝기 보정 필요 |
| rectangular_parquet | Poly Haven | 2.25m | 1k 1.3MB / 2k 6.1MB | 광택 판재, 중간 갈색 |
| oak_wood_planks | Poly Haven | 1.2m | 1k 2.0MB / 2k 8.5MB | 오크 판재, 중간 갈색 |

WoodFloor067A·068은 노랑·주황이 강해 제외. WoodFloor071은 바구니 짜임 무늬라 제외.

### 5.2 바닥 타일

| 쓰임 | 후보 | 출처 | 실제 크기 | 용량 | 모양 |
|---|---|---|---|---|---|
| 욕실 바닥 | Tiles107 | ambientCG | 1.0m | 1K 3.1MB / 2K 6.4MB | 흰 대형 정사각 |
| 욕실 바닥 | marble_01 | Poly Haven | 1.5m | 1k 0.4MB / 2k 1.8MB | 밝은 대리석 타일 |
| 현관·전실 | Tiles109 / Tiles110 | ambientCG | 1.85m | 1K 5.2MB | 베이지 테라조 |
| 현관·전실 | Travertine009 | ambientCG | 1.2m | 1K 3.1MB / 2K 8.7MB | 밝은 베이지 석재 |
| 발코니 | Tiles139 | ambientCG | 2.0m | 1K 4.6MB / 2K 15.5MB | 베이지 석회암 격자 |
| 발코니 | interior_tiles | Poly Haven | 1.9m | 1k 1.6MB / 2k 6.9MB | 베이지·회색 사각 타일 |

### 5.3 벽

| 쓰임 | 후보 | 출처 | 실제 크기 | 용량 | 모양 |
|---|---|---|---|---|---|
| 무광 페인트 | 단색(#F3F1EC, 거칠기 0.9~0.95) + 아래 노멀만 약하게 | - | - | - | 1순위. 색은 텍스처 대신 값으로 |
| 페인트 노멀 | beige_wall_001 | Poly Haven | 3.0m | 1k 0.3MB / 2k 1.4MB | 매끈한 도장, 가장 가벼움 |
| 페인트 노멀 | Plaster001 / Plaster002 / PaintedPlaster017 | ambientCG | 정보 없음 | 1K 4.5~7.2MB | 흰 미장 |
| 욕실 벽 | Tiles036 | ambientCG | 정보 없음 | 1K 4.2MB | 흰 서브웨이 타일 |
| 욕실 벽 | Tiles133A / Tiles136A | ambientCG | 정보 없음 | 1K 4.4~4.6MB | 작은 흰 타일 |

### 5.4 가구 목재·목재 패널

| 쓰임 | 후보 | 출처 | 실제 크기 | 용량 | 모양 |
|---|---|---|---|---|---|
| 가구 오크(`oak`, 옷장 문 등) | silver_oak_veneer_01 | Poly Haven | 1.0m | 1k 1.3MB / 2k 5.4MB | 밝은 화이트오크. 1순위 |
| 가구 오크 | Wood095 | ambientCG | 정보 없음 | 1K 3.7MB / 2K 12.3MB | 밝고 깨끗한 나뭇결 |
| 가구 오크 | okoume_veneer / white_oak_veneer / ash_veneer | Poly Haven | 1.0 / 0.5 / 1.0m | 1k 1.6~1.8MB | 밝은 무늬목 |
| 세로 목재 패널(레퍼런스 갈색 벽) | natural_walnut_veneer, walnut_veneer + 세로 홈 노멀(절차) | Poly Haven | 1.0m / 1.8m | 1k 약 1.5~2MB(확인 필요) | 데이터에 패널 마감 없음 → 시각 선택 |

### 5.5 패브릭(침구·소파·러그)

색은 팔레트 값으로 두고 노멀·거칠기 맵만 세밀 무늬로 반복한다(0.3m 반복이 기본).

| 후보 | 출처 | 실제 크기 | 용량 | 모양 |
|---|---|---|---|---|
| terlenka | Poly Haven | 0.3m | 1k 2.4MB | 크림 평직 |
| cotton_jersey | Poly Haven | 0.3m | 1k 2.1MB | 베이지 면 |
| Fabric019 | ambientCG | 정보 없음 | 1K 7.2MB | 흰 울 직조 |
| Carpet016 | ambientCG | 1.7m | 1K 8.9MB | 베이지 울 러그 |
| curly_teddy_natural | Poly Haven | 0.3m | 1k 2.2MB | 베이지 털 담요 |

Poly Haven 패브릭에 딸린 이방성(anisotropy) 맵은 웹에서 쓰지 않는다.

## 6. HDRI 후보

모두 Poly Haven CC0. 원본은 16k 이상. 집을 밖에서 내려다보는 장면이라 배경으로 보이지 않고 재질 광원(`scene.environment`)으로만 쓴다. PMREM은 1k로 충분하다.

| 후보 | 모양 | 1k .hdr | 2k .hdr | 판단 |
|---|---|---|---|---|
| **brown_photostudio_02** | 밝은 흰 현대 실내, 낮은 대비 | 1.6MB | 6.2MB | High 1순위 |
| small_empty_room_1 | 중성 흰 빈 방 | 1.5MB | 5.9MB | 2순위 |
| unfinished_office | 중성 흰 공사 중 사무실, 낮은 대비 | 1.4MB | 5.6MB | 대안 |
| modern_bathroom | 회백색 욕실, 낮은 대비 | 1.5MB | 6.2MB | 대안 |
| white_studio_06 | 아주 부드러운 흰 스튜디오 | 1.3MB | 5.3MB | 반사가 밋밋할 때 |
| studio_small_08 | 소프트박스 스튜디오 | 1.4MB | 5.7MB | 금속 가전 반사용 대안 |
| three.js RoomEnvironment | 절차 생성 중성 방 | 0 | - | Balanced·Performance 기본, 실패 시 대체 |

제외: lythwood_room·photo_studio_loft_hall·poly_haven_studio(노랑·나무 천장으로 색이 따뜻하게 물듦), hotel_room(높은 대비).

- .hdr를 쓴다. twin-home 정적 서버는 `.hdr`·`.ktx2`·`.wasm`·`.glb` MIME이 있고 `.exr`은 없다(`src/server/static.ts`).
- three r187 타입 기준 `RGBELoader`는 폐기 예정이고 `HDRLoader`를 쓴다. 기존 뷰어는 CDN three 0.186.1, twin-home ui에는 three 런타임이 아직 없고 `@types/three` 0.187만 있다.

## 7. 받아 넣는 절차

### 7.1 받기·보관

1. 받기는 손으로 한다. Sketchfab은 로그인 후 GLB(원본) 받기. Poly Haven은 glTF 1k(또는 2k)·HDR 1k, ambientCG는 1K-JPG 또는 2K-JPG zip.
2. 받은 원본은 저장소 밖 캐시에 둔다(예: `twin-studio/external_cache/`, gitignore). 원본 파일마다 sha256을 manifest에 적는다.
3. 정규화한 결과물(1024px 텍스처, 줄인 삼각형)은 저장소에 커밋한다(`data/external/models/<id>.glb`, `data/external/textures/<id>/`). CC0·CC-BY 모두 재배포 가능. Sketchfab은 로그인 없이 다시 받을 수 없어 원본 대신 정규화본을 남겨야 다시 빌드된다. 예상 총량 20~40MB(확인 필요, 사용자 판단 필요: 저장소에 넣을지 LFS를 쓸지).
4. Poly Haven 사이트 약관은 허락 없는 스크래핑을 금지한다. 자동 내려받기 스크립트는 만들지 않고, manifest에 받은 주소만 적는다.

### 7.2 정규화(축척·원점·방향)

twin-studio 계약(`apartment/README.md`, `studio/apartment/check.py`)에 맞춘다.

| 항목 | 규칙 |
|---|---|
| 축 | glTF: +Y 위, +Z 정면, 미터. Blender 안에서는 정면 −Y, 위 +Z |
| 원점 floor·surface | 바닥 min y = 0, x·z 중앙 |
| 원점 wall | 바닥 min y = 0, x 중앙, 뒷면 min z = 0 |
| 원점 ceiling | 윗면 max y = 0, x·z 중앙 |
| 크기 | 카탈로그 footprint·height와 차이 5cm 이하(넘으면 경고, 15cm 넘으면 실패) |
| 루트 | 최상위 노드 1개, 이름 = 종류, 항등 변환, extras: asset_name·mount·origin·category·catalog_type·states_json |
| 텍스처 | 한 변 1024px 이하, GLB 안에 포함, Draco·meshopt 없음 |
| 재질 이름 | `ext_<에셋id>_<원래이름>`(가족 접두어 규칙) |

외부 모델별 작업:
1. Sketchfab GLB는 루트에 `Sketchfab_model` 같은 축 변환 노드와 cm 단위 축척이 섞여 있다. 모든 변환을 메시에 굽는다.
2. 바닥판·그림자판·카메라·빛·애니메이션·숨은 보조 메시를 지운다.
3. 정면을 −Y(Blender)로 돌린다. 모델마다 정면 방향이 다르므로 눈으로 확인한다.
4. 축척은 균일 축척을 먼저 쓰고, 축마다 다르게 늘리는 것은 5% 안쪽만 허용한다. 그 이상이면 다른 모델을 고르거나(침대·식탁·암체어), 카탈로그를 모델 크기로 바꾼다(소파·커피 테이블처럼 이미 "모델 크기"인 종류만).
5. 삼각형을 예산(8절)까지 줄인다(Blender Decimate 또는 meshopt simplify 후 윤곽 확인).
6. 색은 레퍼런스 팔레트로 바꿔도 된다. CC-BY는 "수정함"을 출처에 적는다.

### 7.3 twin-studio 카탈로그 종류에 외부 GLB 붙이기

빌더 고르는 곳: `blender/apartment/framework.py` `build_type()`이 `spec.get("builder", type)`로 빌더를 찾는다. 카탈로그 검사는 모르는 키를 막지 않는다.

1. 카탈로그 항목에 `builder: "external"`과 `source`를 넣는다.
   ```json
   "builder": "external",
   "source": {
     "id": "sf_366_armchair",
     "model": "data/external/models/sf_366_armchair.glb",
     "rotate_deg": [0, 0, 180],
     "scale": "fit",
     "parts": {}
   }
   ```
2. `blender/apartment/assets/external.py`에 `@asset`이 아닌 범용 빌더 `external`을 등록한다. 할 일: glTF 가져오기(`bpy.ops.import_scene.gltf`), 변환 굽기, 회전, 크기 맞추기, 메시를 루트 아래 부품으로 붙이기, 재질 이름 바꾸기. 마지막은 기존 `Asset.finish()`가 원점을 맞추고, 기존 `export_glb`가 내보낸다. 그러면 산출 경로(`assets/<분류>/<종류>.glb`)·scene.json·apt-check·twin-home 계약이 그대로다.
3. `blender/lib/geo.py`의 `Asset`에는 만든 메시만 붙이는 `part()`뿐이다. 가져온 객체를 부품으로 들이는 메서드(예: `adopt(label, obj)`: 루트 아래로 옮기고 `part` 속성을 붙임)를 더해야 한다.
4. 상태가 있는 종류에 외부 모델을 쓰려면 `source.parts`로 노드 이름을 `extras.part`에 이어 주고 경첩 축을 만들어야 한다. apt-check `_wiring`이 빠진 부품을 잡는다. 이번 범위에서는 쓰지 않는다(1절).
5. 검사 추가: `source`가 있는 종류는 manifest에 항목이 있고, CC-BY면 작가·주소·라이선스가 비어 있지 않아야 apt-check를 통과하게 한다.

재질(텍스처) 쪽:
- 지금 `blender/lib/materials.py` `Spec`은 색 텍스처와 노멀만 받고, 텍스처는 numpy 생성 함수만 등록된다. 사진 텍스처를 쓰려면 파일에서 읽는 등록과 거칠기·AO(ARM) 연결을 더해야 한다.
- 권장: twin-studio가 재질 표(`materials.json`: 재질 이름 → 텍스처 세트 id, 실제 크기 m, 색 보정, 거칠기)와 텍스처 파일을 산출물로 낸다. 새 렌더러는 GLB 재질 이름(`floor_wood`, `tile_*`, `paint_warm`, `oak`, `fabric_*`)으로 찾아 덮어쓴다. 반복 수 = 재질 `tile` 값 ÷ 텍스처 실제 크기. 같은 텍스처를 Blender 미리보기에도 쓰면 두 화면이 맞는다.

### 7.4 압축(웹용 별도 산출물)

apt-check가 Draco·meshopt를 막으므로 압축본은 따로 낸다. 예: `homes/<id>/web/assets/<분류>/<종류>.glb`(meshopt + KTX2). scene.json의 `asset` 경로는 그대로 두고, 새 렌더러가 `web/` 쪽이 있으면 그것을 읽는다. twin-studio 명령(예: `apt-pack`)으로 만들지 twin-home 빌드 단계로 만들지는 설계에서 정한다.

도구 설치 상태(이 PC, 2026-11-06):

| 도구 | 상태 | 비고 |
|---|---|---|
| @gltf-transform/cli | 없음(npm 최신 4.5.1) | `npx`로 실행 가능. meshopt·draco·resize·webp는 자체 처리(sharp 포함) |
| KTX-Software(toktx) | 없음 | gltf-transform `etc1s`·`uastc`에 필요. 따로 설치 |
| gltfpack | 없음(npm 1.3.0) | npm(wasm)판은 텍스처 압축 미지원. KTX2까지 하려면 네이티브 바이너리 |
| Blender | 5.2 있음 | 정규화·임포트용 |
| meshoptimizer | twin-home ui/node_modules에 1.1.1 | 디코더는 three 예제(`meshopt_decoder.module.js`)를 쓴다 |

명령 기준:
- 형상: **meshopt**를 쓴다. 디코더가 작고 빠르며 별도 wasm 파일이 없다. Draco는 디코더 파일이 따로 필요하고 풀기가 느리다.
- 텍스처: **KTX2**. 기본색·ARM은 ETC1S, 노멀은 UASTC(+zstd). 1024px 기준 GPU 메모리가 RGBA8 약 5.6MB → BC7 약 1.4MB, BC1 약 0.7MB로 준다. 내장 그래픽(전용 2GB)에서 효과가 크다.
- `gltf-transform optimize` 기본값은 `--join`·`--flatten`·`--instance`·`--palette`·`--simplify`가 모두 켜져 있어 이름 붙은 부품·경첩 축·extras를 망가뜨린다. 상태 있는 종류와 문은 `optimize` 대신 `dedup`·`prune`·`resize`·`meshopt`·`etc1s`/`uastc`를 하나씩 쓰거나 이 옵션들을 모두 끈다. gltfpack이면 `-kn -km -ke`.
- 프리셋별 텍스처: High 1024, Balanced 512, Performance 256(또는 색만).
- 헤드리스 크롬(SwiftShader)에서 KTX2 변환 결과 형식은 확인 필요(압축 형식을 못 쓰면 RGBA로 풀린다).

### 7.5 three.js 쪽 로딩

- `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`, `setKTX2Loader(new KTX2Loader().setTranscoderPath(<basis 폴더>).detectSupport(renderer))`. basis 변환기 파일(`three/examples/jsm/libs/basis/`)은 ui 정적 폴더로 복사해 같은 출처에서 낸다(CDN 의존 없음).
- 같은 종류는 한 번만 받고 복제한다(armchair 2개, bed_queen 2개는 형상·재질 공유).
- HDR: `HDRLoader` → `PMREMGenerator.fromEquirectangular` → `scene.environment`, 원본 텍스처는 바로 dispose.

### 7.6 출처 표기(ATTRIBUTION)

1. 원본 목록: twin-studio `data/external/manifest.json`. 항목: `id`, `source`(polyhaven·ambientcg·sketchfab), `kind`(model·texture·hdri), `title`, `author`, `url`, `license`(CC0-1.0·CC-BY-4.0), `license_url`, `downloaded`, `files`[이름·sha256·바이트], `changes`(축척·색 바꿈·삼각형 줄임 등), `used_by`(종류·재질 이름).
2. 빌드 때 `homes/<id>/ATTRIBUTION.md`와 `ATTRIBUTION.json`을 만든다(쓴 것만). twin-home은 `/twin/ATTRIBUTION.json`으로 읽어 설정 화면 "3D 출처"에 보인다. CC-BY는 사용자가 볼 수 있는 곳에 표기해야 한다.
3. GLB 안에도 넣는다: `asset.copyright`에 "제목 — 작가, CC BY 4.0, 주소, 수정함". gltf-transform이 이 값을 유지한다.
4. CC-BY 한 줄 형식: `"366 Armchair" by hectopod (https://sketchfab.com/3d-models/97e53f749df14e8c9de7a22bf99be753), CC BY 4.0, 크기·재질 수정`. CC0는 의무는 없지만 같은 표에 남긴다.
5. 제외: CC BY-NC·ND, 상표·로고가 보이는 가전 모델.

## 8. 예산(제안)

| 항목 | High | Balanced | Performance |
|---|---|---|---|
| 외부 주요 모델 1개 | 25k 삼각형 이하, 압축 후 1.5MB 이하 | 같은 파일, 텍스처 512 | 단순화 LOD(약 8k) |
| 집 전체 보이는 삼각형 | 40만 이하 | 25만 이하 | 15만 이하 |
| 텍스처 GPU 메모리 | 150MB 이하(KTX2) | 80MB 이하 | 40MB 이하 |
| 첫 내려받기 | 15MB 이하(HDR 1.6MB 포함) | 8MB 이하 | 5MB 이하 |

지금 장면 전체(문·창·벽·바닥 포함)는 약 30만 삼각형, 가구·가전 30개는 약 15만(객체당 3.6k~11k). 외부 모델 후보는 원본 1만~10만 삼각형이라 줄이지 않으면 예산을 넘는다.

## 9. 확인 필요·사용자 판단 필요

- **사용자 판단 필요**: 데이터에 없는 욕실 설비·싱크·식탁 의자·러그·식물을 넣을지. 넣으면 공개 도면에 그려진 설비(변기·세면대·욕조·싱크)는 "도면 기준" 표시로 placement에 넣고, 식물·러그·액자는 별도 장식 층(선택·기기 연결·에이전트 대상에서 제외, 화면에 장식 표시)으로 둔다.
- **사용자 판단 필요**: 레퍼런스의 세로 목재 패널 벽처럼 데이터에 없는 마감을 시각 선택으로 넣을지.
- **사용자 판단 필요**: 정규화한 외부 GLB·텍스처(약 20~40MB 예상)를 저장소에 바로 넣을지, LFS를 쓸지.
- 확인 필요: Sketchfab 후보는 받아서 실제 크기·정면·내부 바닥판 유무를 봐야 한다. 특히 침대(슈퍼싱글 폭 1.30), 식탁(1.44×0.79).
- 확인 필요: 각 Sketchfab 모델의 CC-BY 버전.
- 확인 필요: ambientCG 다수 항목은 실제 크기가 0(미기재)이다. 판재 폭(보통 0.15~0.2m)으로 반복 수를 맞춘다.
- 확인 필요: Poly Haven 모델 정면 방향(대부분 Blender −Y지만 모델마다 다름).
- 확인 필요: 헤드리스 크롬(SwiftShader)의 KTX2 압축 형식 지원.

## 출처

- Poly Haven 라이선스(CC0, 표기 의무 없음): https://polyhaven.com/license
- ambientCG 라이선스(CC0): https://docs.ambientcg.com/license/
- Sketchfab CC 표기 안내: https://help.sketchfab.com/en/articles/16152215-crediting-users-for-3d-model-downloads , https://sketchfab.com/developers/download-api/guidelines
- gltf-transform CLI: https://gltf-transform.dev/cli (optimize 기본값은 `packages/cli/src/cli.ts`)
- gltfpack: https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md
- 모델 주소: Poly Haven `https://polyhaven.com/a/<id>`, ambientCG `https://ambientcg.com/a/<id>`, Sketchfab `https://sketchfab.com/3d-models/<uid>`
