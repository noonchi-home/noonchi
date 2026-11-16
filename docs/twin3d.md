# 대시보드 3D 트윈

한양목련 180B(`mokryeon_180b`)는 대시보드 트윈 칸에 구운 빛 three.js 트윈으로 그린다(`ui/src/twin/3d/`). 다른 집은 트윈 칸에 iframe 뷰어를 둔다.

## 트윈 자산

| 자리 | 내용 |
|---|---|
| `twin/homes/mokryeon_180b/bake/` | `mokryeon_180b_baked.glb`(19.8 MB), 빛 지도 `lm0.webp`~`lm3.webp`, 땅 그림자 `ground.png`, `manifest.json`. 모두 약 21 MB |
| `twin/SOURCE.json` | 위 7개 파일의 twin-studio 커밋과 sha256 |
| `ui/src/twin/3d/homes/mokryeon_180b.light.json` | 반구광 하늘·아래 색(하늘빛 `studio_small_09`, 세기 0.72에서 셈). 대시보드는 HDR을 받지 않는다 |

- 서버는 `/twin/<경로>`를 지금 집 폴더에서 찾는다: `/twin/bake/manifest.json`, `/twin/bake/mokryeon_180b_baked.glb`, `/twin/bake/lm<n>.webp`, `/twin/bake/ground.png`.
- 배치를 바꾸면 트윈에 바로 보인다. 다시 굽기 전까지 옛 자리 그림자가 남고 새 물건은 그림자가 없다.

## 다시 굽고 들이기

그림자를 지금 배치에 맞추려면 손으로 다시 굽는다(약 7분). 무거운 일은 단계마다 이 저장소 잠금으로 돌린다(`npm --prefix <twin-home 폴더> run heavy -- <명령>`).

1. twin-studio 저장소의 main(굽기 코드와 `docs/bake.md`)에서 굽는다. 결과는 그 폴더의 `homes/mokryeon_180b/bake/`에 쌓인다.

   ```powershell
   uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step scene --density 32 --max-size 1024
   uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step bake --samples 128
   uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step finish
   ```

2. 이 저장소로 들인다. 7개 파일과 `twin/SOURCE.json`의 그 7줄만 바뀐다.

   ```powershell
   npx tsx scripts/twin-assets.ts --from <twin-studio 폴더> --only homes/mokryeon_180b/bake/
   ```

3. 반구광을 다시 셈한다. 하늘빛이나 그 세기를 바꿨을 때만 값이 바뀐다.

   ```powershell
   npx tsx ui/scripts/bake-light.ts --hdr <twin-studio 폴더>/external_cache/studio_small_09/studio_small_09_1k.hdr --manifest twin/homes/mokryeon_180b/bake/manifest.json --out ui/src/twin/3d/homes/mokryeon_180b.light.json
   ```

4. 화면을 다시 빌드한다: `npm run heavy -- npm --prefix ui run build`.

## 띄워 보기

- 서버: `npm run heavy -- npm --prefix ui run build` 뒤 `npm run dev3d -- start`(서버 8201이 `ui/dist`를 내줌, 화면 Vite 5174). 끄기는 `npm run dev3d -- stop`.
- dev3d 서버는 시험 모드다: VLM·PAM·에이전트 주소는 닫힌 이 PC 포트(`127.0.0.1:9`), 모델 키는 빈 값이라 `/api/health` 준비 검사가 밖으로 나가지 않는다. 다른 방법으로 서버를 띄울 때도 이 값을 넣는다.
- `runtime-3d/`에 설정을 끝낸 적이 없으면 `/`가 `/setup/`으로 간다. 처음 한 번 `http://127.0.0.1:8201/setup/`에서 집을 고르고 끝낸다.

### 가짜 단계

`http://127.0.0.1:8201/?debug=steps&step=N`은 서버 자료 대신 `ui/src/dashboard/fake-run.json`의 순간을 보인다. 트윈과 health는 서버 것이다.

| 붙이는 것 | 보이는 것 |
|---|---|
| `step=0` | 지켜보기(계획 없음) |
| `step=1`~`step=4` | 컵 치우기 1~4단계 |
| `play=4000` | 트윈 첫 그림 뒤 4초마다 다음 순간(2→3→4→0→1→2…) |
| `eye=0` | 대시보드 폰 칸에 연결 QR |
| `offline=1` | 서버 연결 끊김 칩 |
| `settings=1` | 설정 창을 연 채 |

- `npm run dev3d`는 폰 서버를 끈다. 그래서 `eye=0`은 QR 대신 「폰 서버가 꺼져 있어요.」를 보이고 설정 창에도 QR이 없다. QR을 보려면 폰 서버를 켠 서버(`PHONE_PORT`)를 쓴다.
- 페이지 안에서 `window.__dash.step(n)`으로 바로 그 순간으로 간다.
- 자료 다시 만들기: `npx tsx scripts/twin3d/fake-run.ts`.

### 사진

```powershell
npm run capture -- --url "http://127.0.0.1:8201/?debug=steps&step=2" --ready "main[data-ready]" --script <줄 파일> --size 1920x1080 --out <폴더>
```

- 줄 파일은 `wait:1500`, `shot:<이름>` 두 줄이다. 기기 말풍선·방 이름표는 카메라가 멈춘 뒤 떠오르므로 1.5초 기다려 찍는다.
- 마지막 사진: `runtime-3d/shots/final-1920x1080/`, `runtime-3d/shots/final-1440x900/`(watch, step1~4, qr, offline, settings).

### 처음부터 끝까지

`ui/dist`를 그대로 내주므로 먼저 화면을 빌드한다. 옛 빌드면 옛 화면으로 판정한다.

```powershell
npm run heavy -- npm --prefix ui run build
npm run heavy -- npx tsx scripts/twin3d/e2e-dashboard.ts --out runtime-3d/e2e
```

가짜 모델 서버·시험 모드로 컵 치우기를 실제 대시보드에서 끝까지 돌린다(기본 포트 8202, `--port`로 바꿈). 끝 코드 0이면 통과이고, `step-0.png`~`step-4.png`·`step-done.png`·`result.json`이 남는다.

## 끊김 재기

```powershell
npm run heavy -- node ui/scripts/measure-switch.mjs --mode visible
```

- 서버 8201이 떠 있어야 한다. 포트가 다르면 `--url`·`--port`로 바꾼다.
- 재는 동안(90초) 보이는 크롬 창이 뜨니 PC를 쓰지 않는다.
- 통과: 바뀜마다 가장 긴 그림 간격 50 ms 이하, 창 안 그림 수 기대의 90% 이상, 주 스레드 일 50 ms 이하. 떨군 그림 몫은 모두 합해 5% 이하.
- 규칙과 원인 찾기는 `docs/view-switch.md`.

## 잰 값

2026-11-09, 이 PC(AMD Radeon 내장).

**끊김**(ANGLE D3D11, 크롬 창 1522×722 배율 1.25, 새 프로필, 90초)

| 바뀜 | 가장 긴 간격 | 떨군 그림 | 가장 긴 주 스레드 일 | 판정 |
|---|---|---|---|---|
| 22번 | 33.4 ms | 10/1210 (0.8%) | 24 ms | 통과 |

화면이 뜬 뒤 첫 바뀜이 가장 빠듯하다.

**칸 자리**(CSS px, 왼쪽·위·너비×높이)

| | 1920×1080 | 1440×900 |
|---|---|---|
| 트윈 칸(캔버스와 같음) | 16, 16, 1298×1048 | 12, 12, 922×876 |
| 대시보드 폰 칸 | 1315, 16, 590×1048 | 935, 12, 493×876 |
| 말풍선 카드 | 36, 970, 1197×74 | 28, 798, 839×74 |
| 마스코트 | 1237, 756, 153×324(아래 끝 1080) | 871, 630, 127×270(아래 끝 900) |

- 마스코트 가운데 축은 두 칸 나눔선 위다.
- 글 크기: 부품 원래 크기(12·14 px, 설정 창 제목 18 px). 말풍선 카드 글만 16 px 굵게 가운데.
- 불러오기: 헤드리스 크롬(GPU 없음)에서 주소를 연 뒤 `main[data-ready]`까지 3.3~4.7초.
