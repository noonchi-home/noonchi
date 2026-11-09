# 카메라로 가전 상태 맞추기 계획

**목표:** 폰 카메라가 본 가전 모습(TV 화면 켜짐, 냉장고 문 열림, 전자레인지 돌아감, 싱크대 물 흐름)이 트윈 가전 상태로 이어진다.

**출처:** 사용자 「비전으로도 가전상태 동기화 가능하면 좋겠네」.

## 정한 것

- **맞추기(src/world/sight.ts):** YOLO가 본 가전 설비 상자 하나마다, 그 사진을 찍은 눈의 방에서 같은 종류 트윈 가전 가운데 시야(가운데가 화면 안, 여유 0.25) 안에 있는 것만 후보로 둔다. 상자 가운데 광선과 가전 가운데 방향의 각이 가장 작은 것을 고른다. 25° 넘으면 고르지 않고, 둘 이상인데 다음 것과 8° 안으로 붙으면 애매해서 고르지 않는다. 맞추기 전(카메라 없음)·방 모름·후보 없음도 고르지 않는다. 결과는 가전 설비의 `link`에 남는다.
- **값(src/world/vocab.ts `SIGHT`):** TV 화면 켜짐·꺼짐 → power on·off, 냉장고 열림·닫힘 → door, 전자레인지 쓰는 중 → power on(답에 쓰는 중이 없으면 off), 열림·닫힘 → door(그 속성이 있는 가전만), 싱크대 물이 흐름 → faucet on(답에 쓰는 중이 없으면 off). 오븐·토스터는 트윈 가전 종류가 없어 맞추지 않는다.
- **안정:** 같은 기기·속성에서 같은 값이 연속 2번(앞 값과 4초 안)이어야 넘긴다. 시야 밖이면 값이 없을 뿐 마지막 상태를 그대로 둔다.
- **우선(src/hub/signals.ts `observe`):** 실제 출처가 있으면 실제 상태가 이긴다. 실제 출처: ThinQ 짝 기기는 읽은 값이 있을 때, 가상 기기는 명령·센서 값이 한 번이라도 들어온 뒤(안쪽 허브가 바뀜을 알림). 실제 출처가 없으면(신호 없음, 읽기 전 ThinQ, 명령 받은 적 없는 가상) 본 값이 기기 상태다. 상태에 `vision: { twin, at, applied }`가 붙는다. 실제 상태와 다르면 실제 상태를 두고 다름을 한 번만 알린다(같은 다름은 다시 알리지 않고, 같아지면 다시 셈).
- **글:** 변화 줄 「주방·식당 냉장고 문 열림 · 카메라로 봄」, `[지속]` 줄 끝 「카메라로 봄, 마지막 확인 21:04:08」, 다름 줄 「거실 TV 카메라로는 켜짐 · 기기 값은 꺼짐」(판단 계기 아님).
- **화면:** 트윈 3D는 state 메시지 twin 그대로. 대시보드 말풍선 줄 끝에 「카메라로 봄」. 말풍선은 지금처럼 판단에서 확인한 기기에만.

## 파일

| 파일 | 할 일 |
|---|---|
| `src/world/vocab.ts` | `SIGHT`(설비 사실 → 트윈 값), `SIGHT_STABLE`, `SIGHT_MATCH` |
| `src/world/sight.ts` | 맞추기(`linkDevice`), 값 뽑기(`sightValues`), 안정(`SightReadings`) |
| `src/world/place.ts` | 화면 좌표(`ndc`), `inView`가 그것을 씀 |
| `src/world/state.ts`, `src/world/labels.ts`, `src/world/text.ts` | 프레임별 맞춤, 넘기기, 카메라 글 |
| `src/contract/world.ts`, `src/hub/types.ts` | `WorldFixture.link`, `WorldDevice.vision`, `DeviceState.vision`, `VisionResult` |
| `src/hub/signals.ts` | `observe`, 실제 출처 판단, 보기 상태 |
| `src/server/home.ts` | WorldState에 가전 자리·`observe` 잇기, 다름 로그 |
| `src/history/recorder.ts` | 기록 줄에도 카메라 글 |
| `ui/src/bubbles/summary.ts` | 말풍선 줄 「카메라로 봄」 |
| `scripts/world-vocab-doc.ts` | 문서 표 `vocab:sight` |
| 시험 | `tests/vision-devices.test.ts`, `tests/vision-e2e.test.ts`, `ui/tests/summary.test.ts` |
| 문서 | `docs/world-vocabulary.md`, `docs/reference.md`, `docs/plan.md` |

## Task

- [x] 실패하는 시험: 허브 우선(신호 없음·가상·ThinQ), World State 맞추기·안정·시야 밖·애매함, 관찰 텍스트 글, 한양목련 끝까지(냉장고 문), 말풍선 줄
- [x] 구현
- [x] 문서
- [x] lint·tsc·vitest·ui 시험·ui 빌드(npm run heavy), 커밋

## 실제 프레임으로 맞출 것

- 시야 여유 0.25, 각 기준 25°·8°: 실제 맞춤 오차와 가전 크기(가까운 냉장고는 가운데가 화면 밖)로 맞춘다.
- 연속 2번·4초: VLM이 화면 켜짐·문 열림을 흔들리게 답하는지 보고 정한다.
- 쓰는 중이 답에 없으면 꺼짐: VLM이 전자레인지·싱크대를 말하지 않고 넘기는 일이 잦으면 꺼짐이 잘못 나온다.
- YOLO tv가 모니터·노트북 화면을 TV로 잡는 일: 같은 방 TV 방향과 25° 넘게 떨어지면 거른다.
