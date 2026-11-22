# World State vocabulary

Use the keys in this guide when writing plan conditions or consuming World State. The Korean labels are the strings produced by the phone, the dashboard and the observation text sent to PAM. The example triggers illustrate what a rule could observe. An example by itself does not authorize an action.

## Perception and object classes

Scene VLM responses supply objects and their attributes. Two matching scene observations can confirm a new object. Three qualifying observations without the object at its expected visible location can mark it gone. An out-of-view location supplies no evidence of disappearance. The twin supplies room and surface geometry, while device signals supply appliance state. The detector also supplies display and pose information. COCO IDs and scores below refer to the detector's class mapping.

<!-- vocab:classes -->
| Key | Korean label | Role | YOLO26s COCO | Min. score | Facet | Example trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `person` | 사람 | Person | 0 person | 0.5 | Posture, Location, Holding, Activity, Momentary action | A person has been out of view for 30 minutes and a cup remains on the dining table. |
| `cup` | 컵 | Object | 40 wine glass, 41 cup | 0.4 | Location, Contents, Body, Use, Momentary action | An empty cup remains on the dining table after the person leaves. |
| `bottle` | 병 | Object | 39 bottle | 0.4 | Location, Contents, Body, Use, Momentary action | A bottle has been on the floor for ten minutes. |
| `beer_can` | 맥주 캔 | Object | — (VLM only) | 0.4 | Location, Contents, Body, Use, Momentary action | The same beer can remains on the coffee table after the viewer leaves. |
| `bowl` | 그릇 | Object | 45 bowl | 0.4 | Location, Contents, Body, Use, Momentary action | A bowl containing food has been on the table for an hour. |
| `fork` | 포크 | Object | 42 fork | 0.45 | Location, Use | A fork remains on the dining table after a meal. |
| `knife` | 칼 | Object | 43 knife | 0.45 | Location, Use | A knife is on the counter when the person leaves the kitchen. |
| `spoon` | 숟가락 | Object | 44 spoon | 0.45 | Location, Use | A spoon was placed in the sink. |
| `book` | 책 | Object | 73 book | 0.4 | Location, Open state, Use | An open book is on the sofa and nobody is visible. |
| `cell_phone` | 휴대폰 | Object | 67 cell phone | 0.4 | Location, Screen, Use | Someone leaves home while their phone is on the table. |
| `remote` | 리모컨 | Object | 65 remote | 0.45 | Location, Use | The remote is on the floor. |
| `laptop` | 노트북 | Object | 63 laptop | 0.4 | Location, Open state, Screen, Use | A laptop is open with its screen on and nobody has been visible for 30 minutes. |
| `scissors` | 가위 | Object | 76 scissors | 0.5 | Location, Use | Scissors are on the floor. |
| `toothbrush` | 칫솔 | Object | 79 toothbrush | 0.5 | Location, Use | A toothbrush is on the floor. |
| `hair_drier` | 드라이어 | Object | 78 hair drier | 0.5 | Location, Use | A hair dryer has been in use for over ten minutes. |
| `teddy_bear` | 인형 | Object | 77 teddy bear | 0.5 | Location | A toy is on the floor. |
| `backpack` | 배낭 | Object | 24 backpack | 0.4 | Location, Open state | An open backpack is on the floor. |
| `handbag` | 가방 | Object | 26 handbag | 0.4 | Location, Open state | Someone is leaving home while their bag is on the sofa. |
| `suitcase` | 여행 가방 | Object | 28 suitcase | 0.45 | Location, Open state | A suitcase is visible as someone leaves home. |
| `umbrella` | 우산 | Object | 25 umbrella | 0.4 | Location, Open state | An umbrella remains on the floor after the person leaves. |
| `banana` | 바나나 | Object | 46 banana | 0.5 | Location | A banana has been on the dining table for three days. |
| `apple` | 사과 | Object | 47 apple | 0.5 | Location | An apple is on the dining table after a meal. |
| `orange` | 오렌지 | Object | 49 orange | 0.5 | Location | An orange is on the counter. |
| `broccoli` | 브로콜리 | Object | 50 broccoli | 0.5 | Location | Broccoli is on the counter while someone is cooking. |
| `carrot` | 당근 | Object | 51 carrot | 0.5 | Location | A carrot is on the counter while someone is cooking. |
| `sandwich` | 샌드위치 | Object | 48 sandwich | 0.5 | Location | A sandwich has been on the dining table for an hour and nobody is visible. |
| `hot_dog` | 핫도그 | Object | 52 hot dog | 0.5 | Location | A hot dog has been on the dining table for an hour. |
| `pizza` | 피자 | Object | 53 pizza | 0.5 | Location | Pizza remains on the dining table into the night. |
| `donut` | 도넛 | Object | 54 donut | 0.5 | Location | A doughnut is on the dining table. |
| `cake` | 케이크 | Object | 55 cake | 0.5 | Location | A cake has been on the dining table for an hour. |
| `pot` | 냄비 | Object | — (VLM only) | 0.5 | Location, Open state, Use | A pot is on the cooktop when the person leaves the kitchen. |
| `ramen` | 라면 | Object | — (VLM only) | 0.5 | Location, Open state | An open packet of noodles is on the counter. |
| `cat` | 고양이 | Object | 15 cat | 0.5 | Location | A cat is on the counter. |
| `dog` | 개 | Object | 16 dog | 0.5 | Location | A dog is on the sofa after the person leaves home. |
| `tv` | TV | Fixture | 62 tv | 0.5 | Screen | The TV is on and nobody has been visible for 30 minutes. |
| `refrigerator` | 냉장고 | Fixture | 72 refrigerator | 0.5 | Open state | The refrigerator door is visibly open after the person leaves the kitchen. |
| `microwave` | 전자레인지 | Fixture | 68 microwave | 0.5 | Open state, Use | The microwave has stopped running and its door is closed. |
| `oven` | 오븐 | Fixture | 69 oven | 0.5 | Open state, Use | The oven is running and nobody is in the kitchen. |
| `toaster` | 토스터 | Fixture | 70 toaster | 0.5 | Use | The toaster is in use and nobody is visible. |
| `sink` | 싱크대 | Fixture | 71 sink | 0.5 | Use | The tap has been running for over five minutes and nobody is visible. |
| `chair` | 의자 | Scene furniture (filtered) | 56 chair | — | — | — |
| `couch` | 소파 | Scene furniture (filtered) | 57 couch | — | — | — |
| `potted_plant` | 화분 | Scene furniture (filtered) | 58 potted plant | — | — | — |
| `bed` | 침대 | Scene furniture (filtered) | 59 bed | — | — | — |
| `dining_table` | 식탁 | Scene furniture (filtered) | 60 dining table | — | — | — |
| `toilet` | 변기 | Scene furniture (filtered) | 61 toilet | — | — | — |
| `mouse` | 마우스 | Scene furniture (filtered) | 64 mouse | — | — | — |
| `keyboard` | 키보드 | Scene furniture (filtered) | 66 keyboard | — | — | — |
| `clock` | 시계 | Scene furniture (filtered) | 74 clock | — | — | — |
| `vase` | 꽃병 | Scene furniture (filtered) | 75 vase | — | — | — |
<!-- /vocab:classes -->

## Observable facts

A fact belongs to a facet such as location, contents, posture or activity. Use the key and value together. An opaque cup whose interior is hidden supplies no evidence that it is empty. A closer inspection can establish its contents when the camera sees inside. Drinking or pouring can invalidate a previous contents reading.

<!-- vocab:states -->
| Key | Korean label | Facet | Target | Evidence | Example trigger |
| --- | --- | --- | --- | --- | --- |
| `on_table` | 식탁 위 | Location | Object | VLM, Use the twin surface name when the projection intersects a dining table. | An empty cup is on the dining table. |
| `on_counter` | 조리대 위 | Location | Object | VLM, Use the twin surface name when the projection intersects a counter. | A bowl has been on the counter for 30 minutes. |
| `on_desk` | 책상 위 | Location | Object | VLM, Use the twin surface name when the projection intersects a desk. | A cup is on the desk overnight. |
| `on_shelf` | 선반 위 | Location | Object | VLM | A bottle moved from a shelf into someone's hand. |
| `on_sofa` | 소파 위 | Location | Object, Person | VLM | A person is lying on the sofa, with a remote on the cushion. |
| `on_bed` | 침대 위 | Location | Object, Person | VLM | A person is lying on the bed at night. |
| `on_chair` | 의자 위 | Location | Object, Person | VLM | A person is sitting on a chair using a laptop. |
| `on_floor` | 바닥 | Location | Object, Person | VLM | A person is lying on the floor, or a cup is resting on it. |
| `in_sink` | 싱크대 안 | Location | Object | VLM, Use the mapped sink basin when available. | A bowl has been in the sink for an hour. |
| `in_dish_rack` | 식기 건조대 안 | Location | Object | VLM, The dish rack must be visible. | A bowl is in the dish rack. |
| `in_fridge` | 냉장고 안 | Location | Object | VLM, The open door must expose the interior. | A bowl was placed inside the refrigerator. |
| `in_hand` | 손에 있음 | Location | Object | VLM, A wrist near an object alone does not establish a grip. | The cup moved from a hand to the table. |
| `empty` | 비어 있음 | Contents | Object | VLM, The interior must be visible. | The cup on the dining table is empty. |
| `has_contents` | 내용물 있음 | Contents | Object | VLM, The interior must be visible. | A bowl has held food for two hours. |
| `contents_unknown` | 안이 안 보임 | Contents | Object | VLM | The inside of a cup is out of view. |
| `see_through` | 속이 비침 | Body | Object | VLM, Contents can be seen through the side. | The water level is visible through a glass. |
| `opaque` | 불투명 | Body | Object | VLM, Contents cannot be seen through the side. | The contents of a white mug cannot be seen from the side. |
| `open` | 열림 | Open state | Object, Fixture | VLM | A laptop or refrigerator door is open. |
| `closed` | 닫힘 | Open state | Object, Fixture | VLM | The microwave door is closed. |
| `in_use` | 쓰는 중 | Use | Object, Fixture | VLM, The object is being used or the appliance is running. | The microwave finished running. |
| `not_in_use` | 꺼져 있음 | Use | Fixture | VLM, Look for explicit off evidence, such as an unlit display or an extinguished flame. | The microwave is visibly off. |
| `water_running` | 물이 흐름 | Use | Fixture | VLM | The sink tap has been running for over five minutes. |
| `screen_on` | 화면 켜짐 | Screen | Object, Fixture | VLM | The TV screen is on and nobody is visible. |
| `screen_off` | 화면 꺼짐 | Screen | Object, Fixture | VLM | The TV screen turned off. |
| `standing` | 서 있음 | Posture | Person | Pose and VLM, Pose cue: upright torso and nearly vertical thighs. | A seated person stood up. |
| `sitting` | 앉아 있음 | Posture | Person | Pose and VLM, Pose cue: thighs angled more than 45° from vertical. | A person is sitting at the dining table. |
| `lying` | 누워 있음 | Posture | Person | Pose and VLM, Pose cue: torso angled more than 60° from vertical. | A person is lying on the floor. |
| `fall_suspected` | 쓰러짐 의심 | Posture | Person | Pose, A rapid change from standing to a horizontal torso and thighs within two seconds persists for three seconds. Furniture and scene evidence can identify a bed or sofa. | Someone fell and has not stood up. |
| `holding_object` | 물건을 들고 있음 | Holding | Person | VLM, The scene observation describes a held object. | A person's hands are empty. |
| `eating` | 먹는 중 | Activity | Person | VLM | A person is eating at the dining table. |
| `drinking` | 마시는 중 | Activity | Person | VLM | A person drank and then put down the cup. |
| `cooking` | 요리하는 중 | Activity | Person | VLM | A person is cooking and the cooktop is on. |
| `washing_dishes` | 설거지하는 중 | Activity | Person | VLM | A person is washing dishes. |
| `cleaning` | 청소하는 중 | Activity | Person | VLM | A person is cleaning. |
| `doing_laundry` | 빨래하는 중 | Activity | Person | VLM | A person is handling laundry after the washer stopped. |
| `putting_away` | 정리하는 중 | Activity | Person | VLM | A person is putting things away. |
| `picking_up` | 물건을 집어 듦 | Momentary action | Person | VLM, An action observed within the sequence of frames. | A person picked up an object. |
| `putting_down` | 물건을 내려놓음 | Momentary action | Person | VLM, An action observed within the sequence of frames. | A person put an object down. |
| `throwing_away` | 버리는 중 | Momentary action | Person | VLM, An action observed within the sequence of frames. | A person discarded something and the cup disappeared. |
| `drank` | 마심 | Momentary action | Object | VLM, Attach the event to that vessel. Its contents need to be checked again. | Someone drank from the cup after its contents were confirmed. |
| `poured` | 따름 | Momentary action | Object | VLM, Attach the event to the receiving vessel. Its contents need to be checked again. | Someone poured water into an empty cup. |
| `watching_tv` | TV 보는 중 | Activity | Person | VLM | A person is watching TV on the sofa. |
| `using_phone` | 휴대폰 쓰는 중 | Activity | Person | VLM | A person is using a phone in bed at night. |
| `using_laptop` | 노트북 쓰는 중 | Activity | Person | VLM | A person has been using a laptop for two hours. |
| `reading` | 읽는 중 | Activity | Person | VLM | A person is reading. |
| `talking` | 이야기하는 중 | Activity | Person | VLM | Two people are visible and talking. |
| `taking_medicine` | 약 먹는 중 | Activity | Person | VLM, The camera can observe something being put in the mouth, but cannot verify swallowing. | Taking medication was not observed this morning. |
| `exercising` | 운동하는 중 | Activity | Person | VLM | A person is exercising and the air conditioner is off. |
| `grooming` | 씻거나 단장하는 중 | Activity | Person | VLM | A person is washing or grooming. |
| `dressing` | 옷을 입거나 벗는 중 | Activity | Person | VLM | A person is getting dressed on a weekday morning. |
| `resting` | 쉬거나 자는 중 | Activity | Person | VLM, Stillness or lying down alone cannot establish sleep. | A person is resting on the sofa with the TV on. |
| `walking` | 걷는 중 | Activity | Person | VLM | A person is walking. |
| `entering_home` | 집에 들어옴 | Momentary action | Person | VLM, Someone comes in through the entrance during the observed sequence. | A person entered the home. |
| `leaving_home` | 집을 나섬 | Momentary action | Person | VLM, Someone leaves through the entrance during the observed sequence. | A person left home while the air conditioner was on. |
| `lying_on_floor` | 바닥에 누워 있음 | Activity | Person | VLM, Lying on a floor away from a bed or sofa is distinct from the fall alert. | A person has been lying motionless on the floor for 30 seconds. |
| `other` | 다른 일을 하는 중 | Activity | Person | VLM | A person is doing an activity outside the vocabulary. |
| `unknown` | 하는 일 모름 | Activity | Person | VLM | The activity cannot be determined. |
<!-- /vocab:states -->

## Rooms and people

Room and surface IDs come from the active home's scene. The table below uses the Mokryeon sample home. People outside the camera's field of view cannot be identified as having left the home. A count of visible people alone does not establish which person performed an action.

<!-- vocab:rooms -->
| Room ID | Label (Korean) |
| --- | --- |
| `vestibule` | 전실 |
| `entrance` | 현관 |
| `bath_west` | 욕실 1 |
| `closet` | 수납공간 |
| `alpha` | 알파룸 |
| `balcony_west` | 서측 발코니 |
| `bed_sw` | 침실 1 |
| `bed_se` | 침실 2 |
| `bed_ne` | 침실 3 |
| `bath_center` | 욕실 2 |
| `bath_east` | 욕실 3 |
| `kitchen` | 주방·식당 |
| `balcony_north` | 후면 발코니 |
| `living` | 거실·복도 |
| `balcony_front` | 전면 발코니 |
<!-- /vocab:rooms -->

## Appliance states and events

Hub signals map to the keys below. A state reports what is true now. An event records a transition, so receiving the first state is insufficient to establish that a transition just occurred. The device registry also defines elapsed-time events, such as a refrigerator door remaining open.

<!-- vocab:devices -->
| Key | Twin attribute | State text (Korean) | Event text (Korean) | Always shown | Example trigger |
| --- | --- | --- | --- | --- | --- |
| `running` | running = true | 작동 중 | 작동 시작 | Yes | The washer is running. |
| `stopped` | running = false | 멈춤 | 작동 멈춤 | No | The washer has been stopped for over 30 minutes and its door is closed. |
| `on` | power = on | 켜짐 | 켜짐 | Yes | Someone left home while the air conditioner was on. |
| `off` | power = off | 꺼짐 | 꺼짐 | No | The cooktop turned off. |
| `door_open` | door = open | 문 열림 | 문 열림 | Yes | The refrigerator door remains open. |
| `door_closed` | door = closed | 문 닫힘 | 문 닫힘 | No | The refrigerator door closed. |
| `unlocked` | lock = unlocked | 잠금 풀림 | 잠금 풀림 | Yes | The front door was unlocked at night. |
| `locked` | lock = locked | 잠김 | 잠김 | No | The front door was locked. |
| `faucet_on` | faucet = on | 물 나옴 | 물 틀어짐 | Yes | The sink tap is running and nobody is visible. |
| `faucet_off` | faucet = off | 물 잠김 | 물 잠김 | No | The sink tap was turned off. |
| `water_on` | water = on | 물 나옴 | 물 틀어짐 | Yes | The shower has been running for 30 minutes. |
| `water_off` | water = off | 물 잠김 | 물 잠김 | No | The shower was turned off. |
| `heating_on` | heating = on | 난방 중 | 난방 켜짐 | Yes | The heating is on as someone leaves home. |
| `heating_off` | heating = off | 난방 꺼짐 | 난방 꺼짐 | No | The heating was turned off. |
| `charging` | charging = on | 충전 중 | 충전 시작 | No | The robot vacuum is charging. |
| `not_charging` | charging = off | 충전 안 함 | 충전 끝남 | No | The robot vacuum finished charging. |
| `curtain_open` | curtain = open | 열림 | 열림 | No | The curtains are open at night. |
| `curtain_closed` | curtain = closed | 닫힘 | 닫힘 | No | The curtains are closed in the morning. |
| `blind_open` | blind = open | 열림 | 열림 | No | The blinds are open at night. |
| `blind_closed` | blind = closed | 닫힘 | 닫힘 | No | The blinds are closed in the morning. |
| `door_open_long` | door_open for over 60 s | — | 문이 1분 넘게 열림 | — | The refrigerator door has been open for over one minute. Kinds: fridge, lock |
<!-- /vocab:devices -->

The available devices, labels and event text depend on the selected home. These are the devices loaded for the sample home:

<!-- vocab:home -->
| Device ID | Label (Korean) | Kind | State keys | Event text (Korean) | Camera evidence (Korean) |
| --- | --- | --- | --- | --- | --- |
| `stand_ac_dc22b8f3` | 거실·복도 에어컨 | aircon | `off`, `on` | 거실·복도 에어컨 꺼짐, 거실·복도 에어컨 켜짐 | — |
| `wall_ac_703d00ba` | 침실 1 에어컨 | aircon | `off`, `on` | 침실 1 에어컨 꺼짐, 침실 1 에어컨 켜짐 | — |
| `fridge_bbc363a3` | 주방·식당 냉장고 | fridge | `door_closed`, `door_open` | 주방·식당 냉장고 문 닫힘, 주방·식당 냉장고 문 열림, 주방·식당 냉장고 문이 1분 넘게 열림 | 냉장고 열림·닫힘 |
| `induction_counter_5641ccf0` | 주방·식당 인덕션 | cooktop | `off`, `on` | 주방·식당 인덕션 꺼짐, 주방·식당 인덕션 켜짐 | — |
| `washer_d559f0ae` | 후면 발코니 세탁기 | washer | `stopped`, `running`, `door_closed`, `door_open` | 후면 발코니 세탁기 세탁 멈춤, 후면 발코니 세탁기 세탁 시작, 후면 발코니 세탁기 문 닫힘, 후면 발코니 세탁기 문 열림 | — |
| `dryer_7aa61816` | 후면 발코니 건조기 | dryer | `stopped`, `running` | 후면 발코니 건조기 건조 멈춤, 후면 발코니 건조기 건조 시작 | — |
| `tv_62442cb3` | 거실·복도 TV | tv | `off`, `on` | 거실·복도 TV 꺼짐, 거실·복도 TV 켜짐 | TV 화면 켜짐·화면 꺼짐 |
| `microwave_kitchen` | 주방 전자레인지 | microwave | `off`, `on` | 주방 전자레인지 꺼짐, 주방 전자레인지 켜짐 | 전자레인지 쓰는 중·꺼져 있음 |
| `curtain_living` | 거실 커튼 | covering | `curtain_open`, `curtain_closed` | 거실 커튼 열림, 거실 커튼 닫힘 | — |
| `curtain_bed_sw` | 침실 1 커튼 | covering | `curtain_open`, `curtain_closed` | 침실 1 커튼 열림, 침실 1 커튼 닫힘 | — |
| `light_living` | 거실 조명 | light | `off`, `on` | 거실 조명 꺼짐, 거실 조명 켜짐 | — |
| `light_entrance` | 현관 조명 | light | `off`, `on` | 현관 조명 꺼짐, 현관 조명 켜짐 | — |
<!-- /vocab:home -->

### Camera evidence

The final column gives the configured fallback when a reported fixture lacks a facet. An inferred value and an explicitly observed value carry different evidence. A safety check can require explicit evidence even when the displayed state is the same.

<!-- vocab:sight -->
| Fixture | Twin device kind | Facet | Observed value | If the facet is absent |
| --- | --- | --- | --- | --- |
| `tv` TV | tv | Screen | `screen_on` power = on, `screen_off` power = off | — |
| `refrigerator` 냉장고 | fridge | Open state | `open` door = open, `closed` door = closed | — |
| `microwave` 전자레인지 | microwave | Use | `in_use` power = on, `not_in_use` power = off | power = off |
| `microwave` 전자레인지 | microwave | Open state | `open` door = open, `closed` door = closed | — |
| `sink` 싱크대 | valve | Use | `water_running` faucet = on | faucet = off |
<!-- /vocab:sight -->

## Reading an observation

The first lines are timestamped changes. The 지속 lines report continuing facts and when each started. The date line gives the local weekday and part of day. The eye line gives the phone's room if known. This example is actual Korean output verified by the observation-text tests.

```
21:04:04 사람 보임
21:04:06 VLM: 사람이 소파에 앉아 TV를 본다
21:04:06 사람 앉아 있음
21:04:06 사람 소파 위
21:04:06 사람 TV 보는 중
21:04:12 VLM: 사람이 약을 입에 넣는다
21:04:12 사람 약 먹는 중
21:04:14 후면 발코니 세탁기 세탁 멈춤
[지속] 사람 보임: 21:04:04부터 16초째
[지속] 사람 앉아 있음: 21:04:06부터 14초째
[지속] 사람 약 먹는 중: 21:04:12부터 8초째
[지속] 후면 발코니 세탁기 washer_d559f0ae: 멈춤, 21:04:14부터 6초째
[때] 11월 7일 토요일 밤
[눈] 클로이드 눈: 주방·식당
```

## Plan conditions

The [condition schema](../src/world/conditions.ts) describes the accepted JSON. A condition can evaluate to true, false or unknown. A step advances only on true. Negating unknown still gives unknown. Use observations fresh enough for the condition and use IDs from the active home.

| Example | Meaning |
|---|---|
| `{"person":"visible"}` | A person is visible in a recent observation. |
| `{"person_in_room":"kitchen"}` | A visible person's location is inside the named room. |
| `{"person_near":"sink_counter_kitchen","within_m":1.5}` | The person is within the specified horizontal distance. |
| `{"person_fact":"activity","value":"drinking"}` | A recent person observation reports the given fact. |
| `{"person_holding":"cup_1"}` | Check holding evidence for a particular object. |
| `{"people_at_least":2}` | At least two people are visible. |
| `{"object":"cup_1","surface":"sink_counter_kitchen","part":"basin","follow":true}` | Check the tracked cup against the basin, separately from the surrounding counter. |
| `{"fixture":"microwave","facts":{"use":"in_use"}}` | A fixture reports the specified fact. |
| `{"device":"cooktop","state":"off"}` | The appliance is off. Use `became` to require a transition after the step began. |
| `{"phone_near":"sink_counter_kitchen","within_m":1.2}` | The phone is close to the target in the same room. |
| `{"elapsed_s":300}` | Five minutes have passed since the step started. |
| `{"day_part":"night"}` | The local time is in the specified part of day. |
| `{"for_s":10,"cond":{"person":"not_visible"}}` | The inner condition stays true for the given duration. |
| `{"seq":[{"person":"not_visible"},{"person":"visible"}]}` | The conditions become true in order. |
| `{"all":[{"person":"visible"},{"device":"tv","state":"on"}]}` | All conditions hold. |
| `{"any":[{"person":"visible"},{"device":"tv","state":"on"}]}` | At least one condition holds. |
| `{"not":{"person":"visible"}}` | The inner condition is false. |

### Common combinations

| Example | Condition |
|---|---|
| Leave the dining table | `{"seq": [{"person_near": "dining_table_978b20c7"}, {"for_s": 10, "cond": {"not": {"person_near": "dining_table_978b20c7"}}}]}` |
| Leave the kitchen | `{"seq": [{"person_in_room": "kitchen"}, {"for_s": 10, "cond": {"not": {"person_in_room": "kitchen"}}}]}` |
| Return into view | `{"seq": [{"for_s": 10, "cond": {"person": "not_visible"}}, {"person": "visible"}]}` |
| Finish drinking | `{"seq": [{"person_fact": "activity", "value": "drinking"}, {"any": [{"object": "cup", "facts": {"contents": "empty"}}, {"for_s": 30, "cond": {"all": [{"not": {"person_fact": "activity", "value": "drinking"}}, {"person_fact": "posture", "value": "standing"}]}}]}]}` |
| Finish a meal | `{"seq": [{"person_fact": "activity", "value": "eating"}, {"any": [{"object": "bowl", "facts": {"contents": "empty"}}, {"for_s": 60, "cond": {"not": {"person_fact": "activity", "value": "eating"}}}]}]}` |
| Stand up | `{"person_fact": "posture", "value": "standing"}` |
| Pick up a cup | `{"any": [{"object": "cup_1", "follow": true, "facts": {"place": "in_hand"}}, {"person_holding": "cup"}]}` |
| Washer stops | `{"device": "washer", "became": "stopped"}` |
| Washer starts | `{"device": "washer", "became": "running"}` |
| Dryer stops | `{"device": "dryer", "became": "stopped"}` |
| Cooktop is off | `{"device": "cooktop", "state": "off"}` |
| Microwave finishes (visual evidence) | `{"seq": [{"fixture": "microwave", "facts": {"use": "in_use"}}, {"for_s": 6, "cond": {"not": {"fixture": "microwave", "facts": {"use": "in_use"}}}}]}` |
| Dishwasher stops | `{"device": "dishwasher", "became": "stopped"}` |
| Cup is empty and in the sink | `{"object": "cup_1", "follow": true, "facts": {"contents": "empty", "place": "in_sink"}}` |
| Bowl is inside the refrigerator | `{"object": "bowl", "facts": {"place": "in_fridge"}}` |
| Cup is on the selected table | `{"object": "cup", "surface": "dining_table_978b20c7"}` |
| Place the tracked cup in the sink | `{"all": [{"any": [{"object": "cup_1", "follow": true, "facts": {"place": "in_sink"}}, {"all": [{"object": "cup_1", "follow": true, "surface": "sink_counter_kitchen", "part": "basin"}, {"not": {"object": "cup_1", "follow": true, "facts": {"place": "in_hand"}}}]}]}, {"not": {"person_holding": "cup_1"}}]}` |
| Phone is near the sink | `{"phone_near": "sink_counter_kitchen"}` |
| Wait five minutes | `{"elapsed_s": 300}` |

## Maintaining the vocabulary

The [world vocabulary](../src/world/vocab.ts) and [device registry](../src/devices/kinds.ts) define the keys. The [documentation examples](../src/world/vocab-doc.ts) explain their use. From the repository root, run `npx tsx scripts/world-vocab-doc.ts` after changing a definition and `npx tsx scripts/world-vocab-doc.ts --check` to verify the tables.

The object categories follow COCO (Lin et al., 2014). The activity vocabulary draws on Charades (Sigurdsson et al., 2016), EPIC-KITCHENS-100 (Damen et al., 2022) and ETRI-Activity3D (Jang et al., 2020). HD-EPIC (Perrett et al., 2025) informs the association between movements and mapped kitchen surfaces.
