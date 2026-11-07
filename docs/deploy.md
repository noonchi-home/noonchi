# 배포: AWS GPU 서버 한 대

NOONCHI는 이 저장소 하나로 AWS EC2 GPU 서버 한 대에서 돈다. CPU에서 noonchi(서버·YOLOX)와 PAM 서비스가, GPU에서 vLLM 모델 서버 두 개가 돈다. 서버에는 이 저장소만 받는다.

## 1. 서버 준비

1. 서비스 할당량(Service Quotas)에서 서울 리전(`ap-northeast-2`) 「Running On-Demand G and VT instances」 vCPU 한도 증가를 먼저 신청한다. 새 계정은 0이라 인스턴스를 못 띄운다.
2. 인스턴스: g6e.2xlarge(8 vCPU, 64GiB, L40S 48GB). PAM 27B 4비트(약 14GB)와 Qwen3-VL-4B를 GPU에 함께 올리고, CPU로 noonchi·YOLOX·PAM 서비스를 돌린다. g5·g6(24GB)면 PAM 모델을 줄인다. 처음 띄운 뒤 `docker stats`와 `/api/brain`의 `detect_ms`·VLM 분석 없음 수를 보고 크기를 정한다.
3. AMI: NVIDIA 드라이버와 NVIDIA Container Toolkit이 든 Deep Learning AMI(Ubuntu). 다른 AMI면 드라이버, Docker, NVIDIA Container Toolkit을 설치한다.
4. 저장소: 루트 볼륨과 따로 EBS 볼륨(gp3, 200GB 이상)을 `/srv`에 붙이고, Docker 데이터 폴더를 거기로 둔다(`/etc/docker/daemon.json`: `{"data-root": "/srv/docker"}`). 기록 DB, 기억, 사진 찍기 사진, 모델 캐시가 여기 남아 인스턴스를 멈춰도 그대로다.
5. 보안 그룹: 들어오는 규칙을 모두 지운다. 나가는 규칙만 둔다.

## 2. Tailscale

1. tailnet 관리 화면(login.tailscale.com/admin/dns)에서 MagicDNS를 켜고, 같은 화면의 HTTPS Certificates를 켠다. 둘 다 켜야 `tailscale serve`가 `<서버>.<tailnet>.ts.net` 인증서를 받는다.
2. 서버에서:

    ```bash
    curl -fsSL https://tailscale.com/install.sh | sh
    sudo tailscale up --ssh
    sudo tailscale serve --bg --https=443 http://127.0.0.1:8200
    sudo tailscale serve --bg --https=8443 http://127.0.0.1:8210
    tailscale serve status
    ```

- 대시보드: `https://<서버>.<tailnet>.ts.net/`, 폰: `https://<서버>.<tailnet>.ts.net:8443/phone/`
- 첫 접속 때 인증서를 받느라 몇 초 걸린다.
- Funnel은 켜지 않는다. 폰·PC는 같은 tailnet에 로그인한다.

## 3. 받기와 설정

```bash
git clone <NOONCHI 저장소 주소> /srv/noonchi && cd /srv/noonchi
cp .env.example .env
```

`.env`에 넣는 값:

| 이름 | 값 |
|---|---|
| `INFERENCE_MODE` | `live`(GPU 서버) / `mock`(외부 API) |
| `ALLOWED_ORIGINS` | `https://<서버>.<tailnet>.ts.net` |
| `PHONE_URL` | `https://<서버>.<tailnet>.ts.net:8443/phone/` |
| `BRAIN` | `1` |
| `VLM_LIVE_MODEL` | live VLM Hugging Face 모델(기본 `Qwen/Qwen3-VL-4B-Instruct`). vLLM은 `vlm`이라는 이름으로 내건다 |
| `PAM_LIVE_MODEL` | live PAM LLM Hugging Face 모델(기본 `Qwen/Qwen3.5-27B-GPTQ-Int4`, Qwen3.5-27B 4비트). vLLM은 `pam`이라는 이름으로 내건다 |
| `PAM_MAX_MODEL_LEN` | PAM LLM 문맥 길이(기본 32768). vLLM과 PAM 서비스가 같이 쓴다 |
| `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL` | 비우면 모드 기본값(mock: OpenRouter `qwen/qwen3.5-27b` provider alibaba, live: `http://vllm-pam:8000/v1`의 `pam`) |
| `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` | 에이전트(폰 음성 요청). mock·live 두 모드 모두 필요하다 |
| `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | mock의 VLM·PAM LLM |
| `HF_TOKEN` | 받기 제한이 있는 Hugging Face 모델만 |
| `THINQ_TOKEN` | 실제 모드를 쓸 때만 |

- 키는 `.env`에만 둔다. 이미지에는 들어가지 않는다.
- 다른 파일을 쓰려면 `NOONCHI_ENV_FILE=<파일>`로 띄운다.
- 컨테이너 안의 주소·포트·데이터 폴더(`HOST`, `PORT`, `PHONE_PORT`, `RUNTIME_DIR=/data`, `MATTER_TRANSPORT=local`, `PAM_URL=http://pam:8300`)는 compose가 정한다. 호스트 포트만 `NOONCHI_PORT`(기본 8200)·`NOONCHI_PHONE_PORT`(기본 8210)·`PAM_HOST_PORT`(기본 8300)로 바꾼다.

## 4. 띄우기

```bash
docker compose up -d --build                  # mock: CPU 서비스만(noonchi, pam)
docker compose --profile gpu up -d --build    # live: vLLM 두 개를 더한다
docker compose ps                             # 모두 healthy인지
curl -s http://127.0.0.1:8200/api/health      # ready.ok가 true인지
curl -s http://127.0.0.1:8300/health          # PAM 서비스: llm.reachable, limits
```

- vLLM 이미지는 `vllm/vllm-openai:v0.17.0`(Qwen3-VL·Qwen3.5 지원)이다. 바꿀 때만 `VLLM_IMAGE`에 적는다. vllm-pam은 vllm-vlm이 healthy가 된 뒤에 뜬다. 처음에는 모델을 받느라 수십 분 걸린다.
- vllm-pam은 `--reasoning-parser qwen3`로 띄운다. 반성(생각 켬)의 생각 글은 `reasoning_content`로 빠지고 `content`에는 답만 남는다.
- 두 모델이 떴는지 본다(각각 id `vlm`, `pam`이 나와야 한다):

    ```bash
    curl -s http://127.0.0.1:8410/v1/models
    curl -s http://127.0.0.1:8420/v1/models
    docker compose --profile gpu logs --tail 50 vllm-vlm vllm-pam
    ```

- `VLLM_API_KEY`를 넣었으면 위 두 명령에 `-H "Authorization: Bearer $VLLM_API_KEY"`를 붙인다.
- GPU 메모리 몫: `VLLM_VLM_GPU_SHARE`(기본 0.30), `VLLM_PAM_GPU_SHARE`(기본 0.60). 두 값의 합은 0.9를 넘기지 않는다. PAM LLM이 메모리 부족으로 못 뜨면 `PAM_MAX_MODEL_LEN`을 줄인다.
- `/api/health`의 `ready`: `vlm.reachable`(VLM 주소 응답), `pam.reachable`·`pam.llm.reachable`(PAM 서비스와 그 LLM), `db`(기록 DB). 하나라도 false면 `ready.ok`가 false다.
- PAM 서비스 `/health`의 `limits`: 판단·반성에 넣을 수 있는 글 크기(UTF-8 바이트). `PAM_MAX_MODEL_LEN`을 바꾸면 같이 바뀐다.

## 5. 호출량

엔진 프레임 간격은 `ENGINE_FRAME_MS`(기본 1000)다. 사진 한 장마다 VLM을 한 번 부르므로 1초 간격이면 한 시간에 약 3,600번이다. mock에서는 이만큼 OpenAI를 부른다.

## 6. 멈추기·고치기

```bash
docker compose --profile gpu down             # 볼륨은 남는다
git pull && docker compose --profile gpu up -d --build
```

- 인스턴스를 멈추면 대시보드·폰·판단이 함께 멈춘다. 데이터는 EBS에 남는다.
- 컨테이너는 SIGTERM을 받으면 기록을 마치고 닫는다(최대 20초).

## 7. 키 없는 확인(개발 PC·CI)

```bash
docker build -t noonchi:check .
docker build -t noonchi-pam:check services/pam
npx tsx scripts/container-smoke.ts
```

- 저장소 `.env`와 셸의 키를 넘기지 않고, 확인용 값만 적은 임시 env 파일로 띄운다: noonchi `127.0.0.1:8500`(허브)·`8510`(폰), pam `8520`, `--profile check`의 가짜 OpenAI 호환 서버 `fake-openai`(포트를 열지 않음).
- `INFERENCE_MODE=live`로 VLM·PAM LLM·에이전트 주소를 모두 `http://fake-openai:8500/v1`에 붙인다. 실제 AI API를 부르지 않는다.
- `ready.ok` true, 에이전트 답 「가짜 답」, PAM 서비스 판단(`pam-predict/2`, 가짜 PAM LLM은 대기 −1)과 `/health` 입력 한도, 트윈·기록 DB, 폰 화면, `docker stop` 뒤 종료 코드 0을 본 뒤 볼륨까지 지운다.
