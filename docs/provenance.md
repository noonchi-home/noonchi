# 옮긴 동작의 출처

이 저장소로 옮겨 온 동작과 그 출처다. 코드 주석에는 옆 저장소 이름을 쓰지 않고 이 문서를 가리킨다.

| 이 저장소 | 출처 | 옮긴 것 |
|---|---|---|
| `src/world/confirm.ts` | noonchi-server(신지훈) f8545a1 `noonchi/changes.py` | 사람 2장·물건 3장 연속일 때 등장·사라짐 인정 |
| `src/world/relations.ts` | noonchi-server(신지훈) f8545a1 `noonchi/relations.py`·`packet.py`·`remaining.py`, `config/noonchi.yaml` relations·device_status | 물건 → 관련 가전(컵·병, 여기서 그릇을 더함), 가전 상태 이름(작동 중·이용 가능), 남은 시간(running을 받은 시각 + course_min, 코스 없으면 비움) |
| `src/history/summary.ts` | noonchi-server(신지훈) f8545a1 `noonchi/reflection.py` `build_summary` | 그날 기록으로 시각 순 하루 요약(등장·사라짐, 가전 변화). 잦은 줄은 넣지 않음 |
| `src/world/trigger.ts` (periodic) | noonchi-server(신지훈) f8545a1 `noonchi/sendrule.py` | 사람이 보이는 동안 주기마다 판단, 사람 없음·등장 사라짐 없음 30분이면 멈춤, 등장·사라짐이 생기면 다시 |
| `src/observe/ring.ts` | noonchi-server(신지훈) f8545a1 `noonchi/sources.py` `TwinEyeSource.next` | 직전 프레임과 SHA-256이 같으면 새 프레임으로 받지 않고 중복 수를 셈 |
| `src/history/db.ts` | noonchi-server(신지훈) f8545a1 `noonchi/store.py` `Store` | 런타임 폴더의 SQLite 파일 하나에 가전 변화·감지 등장 사라짐·판단·사건을 시각과 함께 남김. 여기서는 표 하나(events)의 종류별 줄로 합침 |
| `src/history/reflect.ts` | noonchi-server(신지훈) f8545a1 `noonchi/reflection.py` `run_reflection` | 하루가 끝나면 그날 요약을 AI 서버의 반성으로 보냄. 여기서는 사진 대신 하루 관찰 텍스트·행동 요약·피드백을 pam-reflect/2로 보냄 |
| `src/history/retention.ts`, `src/server/start.ts` 보관 기간 | noonchi-server(신지훈) f8545a1 `noonchi/pipeline.py` `Pipeline.start`, `noonchi/vault.py` `Vault.cleanup` | 시작 때 지난 사진 파일과 그 기록 줄을 지움. 여기서는 시작 때와 1시간마다, 보관 기간(기본 7일)이 지난 사진 찍기 사진·시험 자료만 지움 |
| `src/world/decide.ts` link·trigger 기록 | noonchi-server(신지훈) f8545a1 `noonchi/pipeline.py` `link_tick`·`send_tick` | AI 연결·끊김과 전송 멈춤·재개를 바뀔 때 한 번씩 기록. 여기서는 PAM 연결 끊김·연결됨과 판단 멈춤·다시 시작 |
