# NOONCHI 허브 데스크톱 앱

켜면 이 PC의 저장소로 NOONCHI 서버와 Tailscale HTTPS 경로를 띄우고 창에 대시보드를 연다. 창을 닫으면 서버를 정상 종료하고 앱이 연 경로를 닫는다.

## 설치

저장소 뿌리에서 저장소 의존성(`npm ci`)과 대시보드 빌드(`npm run ui:build`)가 끝나 있어야 한다. 그다음:

```
npm ci --prefix apps/desktop
```

Electron 바이너리까지 받는다. `npm --prefix apps/desktop install`은 쓰지 않는다(저장소 뿌리를 의존성으로 넣는다).

바탕화면 바로가기 「NOONCHI 허브」:

```
powershell -NoProfile -ExecutionPolicy Bypass -File apps\desktop\make-shortcut.ps1
```

## 설정

`%APPDATA%\noonchi-hub\config.json`. 첫 실행 때 env 파일을 고르는 창이 뜨고, 고른 경로만 여기에 저장한다. 앱은 env 파일을 읽지 않고 `--env-file`로 서버에 넘긴다.

| 키 | 기본 | 뜻 |
|---|---|---|
| `repoDir` | 앱 폴더 기준 `../..` | 서버를 실행할 저장소 |
| `envFile` | 없음 | 서버 env 파일 경로 |
| `runtimeDir` | `<repoDir>/runtime/hub` | 서버 `RUNTIME_DIR`(늘 절대 경로로 넘김), 로그는 `logs/` |
| `port` / `phonePort` | `8200` / `8210` | 허브·폰 서버 포트 |
| `tailscale` | `{ "enabled": true, "hubHttpsPort": 8444, "phoneHttpsPort": 443 }` | 서버 시작 전에 여는 HTTPS 경로 |
| `twaFingerprints` | 없음 | 있으면 `ANDROID_TWA_SHA256_FINGERPRINTS`로 넘김 |
| `nodePath` | `node` | 서버를 돌릴 node(22.15 이상 23 미만). 바로가기로 켜면 PATH의 node가 다른 버전일 수 있으니 그때 node.exe 경로를 넣는다 |

서버에는 `PORT`, `HOST=127.0.0.1`, `PHONE_PORT`, `REDIS_URL=`(빈 값 = 메모리 버스), `RUNTIME_DIR`, `NOONCHI_STDIN_CONTROL=1`을 넘긴다. 이 값들이 env 파일의 같은 키보다 앞선다. 허브·폰 HTTPS 주소는 서버가 `tailscale serve status`로 스스로 찾는다.

## 실행

바로가기, 또는 저장소 뿌리에서 `npm --prefix apps/desktop start`.

- 이미 떠 있으면 그 창을 앞으로 가져온다.
- `port`·`phonePort`를 이미 쓰고 있으면 서버를 띄우지 않고 오류 창을 띄운다. 그 서버는 끄지 않는다.
- 순서: Tailscale 경로 열기(`tailscale serve --bg --https=<포트> http://127.0.0.1:<포트>`) → 서버 실행 → `GET /api/setup` 200까지 최대 90초 기다림 → 창 열기. 준비 전에는 트레이 아이콘 툴팁으로 상태를 보인다.
- 시작에 실패하면 서버 로그 경로를 담은 오류 창을 띄우고 연 경로를 닫는다.
- 서버 로그: `<runtimeDir>/logs/server-YYYYMMDD-HHmmss.log`

## 종료

창 닫기 또는 트레이 「종료」: 서버 표준 입력에 `shutdown` → 20초 안에 안 끝나면 `taskkill /PID <pid> /T /F` → 앱이 연 Tailscale 경로만 닫기(`tailscale serve --https=<포트> off`) → 앱 끝.

앱이 강제로 끝나면 서버는 표준 입력 끝을 보고 스스로 정상 종료한다. 이때 Tailscale 경로는 열린 채 남는다.

## 시험

```
npm --prefix apps/desktop test
```
