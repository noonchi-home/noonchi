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
| `tailscale` | `{ "enabled": true, "hubHttpsPort": 8444, "phoneHttpsPort": 443 }` | 서버 시작 전에 여는 HTTPS 경로. `false`면 끔. `enabled`는 따옴표 없는 `true`·`false`만 받는다 |
| `twaFingerprints` | 없음 | 있으면 `ANDROID_TWA_SHA256_FINGERPRINTS`로 넘김 |
| `serverEnv` | 없음 | 서버 환경 변수 표(`{ "PAM_LLM_MODEL": "gpt-5.4-mini" }`처럼 이름 → 따옴표로 감싼 값). env 파일의 같은 키보다 앞선다. 이름이 `KEY`·`TOKEN`·`SECRET`·`PASSWORD`로 끝나는 비밀과 아래의 앱이 정하는 값은 넣을 수 없다(넣으면 시작 전에 막는다) |
| `nodePath` | `node` | 서버를 돌릴 node(22.15 이상 23 미만). `node`(PATH에서 찾음) 또는 node.exe 절대 경로(`C:\...\node.exe`, `C:node.exe` 같은 드라이브 상대 경로는 안 됨). 바로가기로 켜면 PATH의 node가 다른 버전일 수 있으니 그때 절대 경로를 넣는다 |

BOM이 붙은 파일도 읽는다.

서버에는 `PORT`, `HOST=127.0.0.1`, `PHONE_PORT`, `PHONE_HOST=127.0.0.1`, `REDIS_URL=`(빈 값 = 메모리 버스), `RUNTIME_DIR`, `NOONCHI_STDIN_CONTROL=1`을 넘긴다. 이 값들이 env 파일·`serverEnv`의 같은 키보다 앞선다. 허브·폰 서버는 이 PC(127.0.0.1)에서만 열리고, 폰은 Tailscale HTTPS로만 붙는다. 허브·폰 HTTPS 주소는 서버가 `tailscale serve status`로 스스로 찾는다.

## 실행

바로가기, 또는 저장소 뿌리에서 `npm --prefix apps/desktop start`.

- 이미 떠 있으면 그 창을 앞으로 가져온다.
- 시작하지 않고 오류 창만 띄우는 경우: 설정 값이 잘못됨(`tailscale.enabled`가 불리언이 아님, `nodePath`가 상대 경로), `port`·`phonePort` 중 하나라도 이미 쓰임(그 서버는 끄지 않음), node가 22.15 이상 23 미만이 아님, env 파일 없음, `<repoDir>/ui/dist/index.html` 없음(`npm run ui:build`를 먼저 실행).
- Tailscale 경로: 시작 전에 `tailscale serve status --json`을 읽는다. 경로가 없으면(`null`·빈 값 포함) 연다(`tailscale serve --bg --https=<포트> http://127.0.0.1:<포트>`). 같은 HTTPS 포트에 같은 대상(`http://127.0.0.1:<포트>`)이 HTTPS로 이미 있으면 그대로 쓰고 닫지도 않는다. 그 포트에 Funnel이 켜져 있으면 「Funnel이 켜져 있어요: https <포트>」 오류 창을 띄우고 멈춘다(서버에 인증이 없어 인터넷에 열면 안 된다). 다른 대상이나 HTTP로만 연 경로가 있으면 덮어쓰지 않고 그 포트와 대상을 적은 오류 창을 띄운다. 종료를 누른 뒤 온 시작 실패는 오류 창 없이 끝낸다.
- 순서: Tailscale 경로 → 서버 실행 → `GET /api/setup` 200까지 최대 90초 기다림 → 창 열기. 준비 전에는 트레이 아이콘 툴팁으로 상태를 보인다.
- 시작에 실패하면 서버 로그 경로를 담은 오류 창을 띄우고 연 경로를 닫는다.
- 준비 뒤 서버가 혼자 끝나면 로그 경로를 담은 오류 창 → 연 경로 닫기 → 앱 종료.
- 서버 로그: `<runtimeDir>/logs/server-YYYYMMDD-HHmmss.log`

## 종료

창 닫기 또는 트레이 「종료」: 여는 중인 Tailscale 경로가 있으면 다 열릴 때까지 기다림 → 서버 표준 입력에 `shutdown` → 20초 안에 안 끝나면 `taskkill /PID <pid> /T /F` → 앱이 연 Tailscale 경로만 닫기(`tailscale serve --https=<포트> off`) → 앱 끝.

종료하는 중에는 창을 다시 띄우지 않고, 두 번째 실행은 트레이 툴팁에 「종료하는 중」을 보인다.

앱이 강제로 끝나면 서버는 표준 입력 끝을 보고 스스로 정상 종료한다. 이때 Tailscale 경로는 열린 채 남는다.

## 시험

```
npm --prefix apps/desktop test
```
