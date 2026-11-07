# 옮긴 동작의 출처

이 저장소로 옮겨 온 동작과 그 출처다. 코드 주석에는 옆 저장소 이름을 쓰지 않고 이 문서를 가리킨다.

| 이 저장소 | 출처 | 옮긴 것 |
|---|---|---|
| `src/world/confirm.ts` | noonchi-server(신지훈) f8545a1 `noonchi/changes.py` | 사람 2장·물건 3장 연속일 때 등장·사라짐 인정 |
| `src/world/relations.ts` | noonchi-server(신지훈) f8545a1 `noonchi/relations.py`·`packet.py`·`remaining.py`, `config/noonchi.yaml` relations·device_status | 물건 → 관련 가전(컵·병, 여기서 그릇을 더함), 가전 상태 이름(작동 중·이용 가능), 남은 시간(running을 받은 시각 + course_min, 코스 없으면 비움) |
