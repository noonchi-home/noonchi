# 한양목련 3D 무거운 일 걸린 시간

잰 날 2026-11-06. PC: Ryzen 7 7730U, 내장 GPU 2GB, RAM 13.8GB. 모두 잠금(`npm run heavy`·`npm run capture`) 아래 하나씩 돌렸다.

| 일 | 명령 | 걸린 시간 | 결과 |
|---|---|---|---|
| 개발 서버 켜기(8201·5174) | `npm run dev3d -- start` | 8초 | 화면 모듈 60개 받음 |
| 기존 화면 기준 캡처 3장(1280×800, 헤드리스) | `npm run capture -- --legacy --url "http://127.0.0.1:8201/twin/viewer/?live=auto&embed=1" … --views overview,room:living,room:kitchen --size 1280x800` | 33초(불러오기 `loadMs` 13.3초) | 오류 0 |
| twin-home 시험 전체 | `npm run heavy -- npm test` | 121초(루트 56초 + 화면 57초) | 루트 53파일 757개, 화면 25파일 143개 통과 |
| 화면 시험만 | `npm run heavy -- npm --prefix ui test` | 60초 | 25파일 143개 통과 |
| twin-studio 시험(Blender 뺌) | `npm --prefix ../twin-home-3d run heavy -- uv run pytest -m "not blender" -q` | 41초 | 493개 통과 |
| Blender 빌드 | Task 4 Step 5에서 더한다 | | |
