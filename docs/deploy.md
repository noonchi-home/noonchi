# 배포: AWS GPU 서버 한 대

NOONCHI는 이 저장소 하나로 AWS EC2 GPU 서버 한 대에서 돈다. CPU에서 noonchi(서버·YOLO26n 감지·관절)와 PAM 서비스가, GPU에서 vLLM 모델 서버 두 개가 돈다. 서버에는 이 저장소만 받는다.

## 1. 서버 준비

1. 서비스 할당량(Service Quotas)에서 서울 리전(`ap-northeast-2`) 「Running On-Demand G and VT instances」 vCPU 한도 증가를 먼저 신청한다. 새 계정은 0이라 인스턴스를 못 띄운다.
2. IAM 역할: `AmazonSSMManagedInstanceCore` 정책을 붙인 EC2용 IAM 역할을 만든다. 인스턴스를 띄울 때 이 역할을 붙인다. 들어오는 포트 없이 Session Manager로 서버에 들어가는 데 쓴다.
3. 인스턴스: g6e.2xlarge(8 vCPU, 64GiB, L40S 48GB). PAM 27B 4비트(약 14GB)와 Qwen3-VL-4B를 GPU에 함께 올리고, CPU로 noonchi·YOLO·PAM 서비스를 돌린다. g5·g6(24GB)면 PAM 모델을 줄인다. 처음 띄운 뒤 `docker stats`와 `/api/brain`의 `detect_ms`·`pose_ms`·VLM 분석 없음 수를 보고 크기를 정한다.
4. AMI: NVIDIA 드라이버, Docker, NVIDIA Container Toolkit, SSM 에이전트가 든 Deep Learning AMI(Ubuntu). 다른 AMI면 넷을 설치한다.
5. 저장 공간: 루트 볼륨과 따로 EBS 볼륨(gp3, 200GB 이상)을 붙인다. 기록 DB, 기억, 사진 찍기 사진, 모델 캐시, 저장소가 여기 남아 인스턴스를 멈춰도 그대로다.
6. 보안 그룹: 들어오는 규칙을 두지 않는다. 나가는 규칙(기본: 모두 허용)만 둔다. Session Manager와 Tailscale은 나가는 연결로 붙는다.
7. 들어가기: EC2 콘솔 → 인스턴스 → 연결 → Session Manager. PC에서는 `aws ssm start-session --target <인스턴스 id> --region ap-northeast-2`(Session Manager 플러그인 필요). 목록에 안 보이면 IAM 역할을 확인한다. Session Manager는 `ssm-user`로 들어오니 `sudo su - ubuntu`로 바꾼 뒤 아래를 한다.
8. EBS를 `/srv`에 붙인다(처음 한 번):

    ```bash
    lsblk                                         # 붙인 EBS 이름(예: nvme1n1, 마운트 없음)
    sudo mkfs -t ext4 /dev/nvme1n1                # 새 볼륨일 때만. 안의 데이터가 지워진다
    sudo mkdir -p /srv && sudo mount /dev/nvme1n1 /srv
    echo "UUID=$(sudo blkid -s UUID -o value /dev/nvme1n1) /srv ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
    sudo umount /srv && sudo mount -a && df -h /srv   # fstab 줄 확인
    ```

9. Docker 데이터 폴더를 `/srv/docker`로 옮긴다. `/etc/docker/daemon.json`에 이미 있는 설정(NVIDIA 런타임 등)은 그대로 두고 `data-root`만 더한다:

    ```bash
    sudo apt-get install -y jq
    sudo systemctl stop docker docker.socket
    [ -f /etc/docker/daemon.json ] || echo '{}' | sudo tee /etc/docker/daemon.json
    sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.bak
    sudo jq '. + {"data-root": "/srv/docker"}' /etc/docker/daemon.json.bak | sudo tee /etc/docker/daemon.json
    sudo systemctl start docker
    docker info --format '{{.DockerRootDir}}'     # /srv/docker가 나와야 한다
    ```

- `docker` 명령이 권한 오류면 `sudo usermod -aG docker ubuntu` 뒤 다시 들어온다.

## 2. Tailscale

1. tailnet 관리 화면(login.tailscale.com/admin/dns)에서 MagicDNS를 켜고, 같은 화면의 HTTPS Certificates를 켠다. 둘 다 켜야 `tailscale serve`가 `<서버>.<tailnet>.ts.net` 인증서를 받는다.
2. 서버에서(Session Manager 창):

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
- 그 뒤로는 tailnet 안 PC에서 `tailscale ssh ubuntu@<서버>`로도 들어간다.

## 3. 받기와 설정

저장소(`noonchi-home/twin-home`)는 비공개라 읽기 전용 배포 키로 받는다.

1. 서버에서 키를 만든다:

    ```bash
    ssh-keygen -t ed25519 -N "" -f ~/.ssh/noonchi_deploy
    cat ~/.ssh/noonchi_deploy.pub
    ```

2. GitHub 저장소 Settings → Deploy keys → Add deploy key에 공개 키를 붙인다. 「Allow write access」는 끈다.
3. 받는다(`git pull`도 같은 키를 쓴다):

    ```bash
    printf 'Host github.com\n  IdentityFile ~/.ssh/noonchi_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
    sudo mkdir -p /srv/noonchi && sudo chown ubuntu: /srv/noonchi
    git clone git@github.com:noonchi-home/twin-home.git /srv/noonchi && cd /srv/noonchi
    cp .env.example .env
    ```

`.env`에 넣는 값:

| 이름 | 값 |
|---|---|
| `INFERENCE_MODE` | `live`(GPU 서버) / `mock`(외부 API) |
| `ALLOWED_ORIGINS` | `https://<서버>.<tailnet>.ts.net` |
| `PHONE_URL` | `https://<서버>.<tailnet>.ts.net:8443/phone/` |
| `BRAIN` | `1`(`.env.example` 기본값) |
| `PLAN_TOKEN` | 계획기가 계획(`POST /api/plan`)을 보낼 때 붙이는 토큰. 긴 무작위 글(`openssl rand -hex 32`) |
| `VLM_LIVE_MODEL` | live VLM Hugging Face 모델(기본 `Qwen/Qwen3-VL-4B-Instruct`). vLLM은 `vlm`이라는 이름으로 내건다 |
| `PAM_LIVE_MODEL` | live PAM LLM Hugging Face 모델(기본 `Qwen/Qwen3.5-27B-GPTQ-Int4`, Qwen3.5-27B 4비트). vLLM은 `pam`이라는 이름으로 내건다 |
| `PAM_MAX_MODEL_LEN` | PAM LLM 문맥 길이(기본 32768). vLLM과 PAM 서비스가 같이 쓴다 |
| `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL` | 비우면 모드 기본값(mock: OpenRouter `qwen/qwen3.5-27b` provider alibaba, live: `http://vllm-pam:8000/v1`의 `pam`) |
| `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` | 에이전트(폰 음성 요청). 두 모드 모두 이 키로 상용 LLM을 부른다. `ANTHROPIC_API_KEY`가 없으면 OpenAI다. 키가 없으면 에이전트가 준비 안 됨(`ready.agent`)이고 폰 대화가 실패하며, 시작 로그에 경고가 한 줄 남는다 |
| `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | mock의 VLM·PAM LLM |
| `HF_TOKEN` | 받기 제한이 있는 Hugging Face 모델만 |
| `THINQ_TOKEN` | 실제 모드를 쓸 때만 |

- 키는 `.env`에만 둔다. 이미지에는 들어가지 않는다.
- `.env`는 compose 파일 안의 `${…}`(모델 이름·포트·GPU 몫·문맥 길이)와 컨테이너 설정에 쓰인다. 다른 env 파일은 `--env-file`로 준다: `docker compose --env-file prod.env --profile gpu up -d`
- 컨테이너는 `compose.yaml`의 서비스마다 적은 이름만 받는다. 키는 그 키를 쓰는 서비스만 받는다: `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`·`VLM_API_KEY`·`THINQ_TOKEN`·`PLAN_TOKEN`은 noonchi, `OPENROUTER_API_KEY`·`PAM_LLM_API_KEY`는 pam, `HF_TOKEN`은 vLLM 두 개, `VLLM_API_KEY`는 noonchi·pam·vLLM 두 개(`scripts/compose-keys.ts`, 시험이 본다). 새 설정을 컨테이너에 넘기려면 그 서비스의 `environment`에 이름을 더한다. 셸에 같은 이름이 있으면 셸 값이 앞선다.
- 컨테이너 안의 주소·포트·데이터 폴더(`HOST`, `PORT`, `PHONE_PORT`, `RUNTIME_DIR=/data`, 영상 모드 영상 폴더 `PHONE_VIDEO_DIR=/data/videos`, `MATTER_TRANSPORT=local`, `PAM_URL=http://pam:8300`)는 compose가 정한다. 컨테이너 안 주소는 밖에서 열 수 없어 대시보드 폰 주소는 `PHONE_URL`뿐이다(`PHONE_LAN_URLS=0`). 호스트 포트만 `NOONCHI_PORT`(기본 8200)·`NOONCHI_PHONE_PORT`(기본 8210)·`PAM_HOST_PORT`(기본 8300)로 바꾼다.

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
- `/api/health`의 `ready`: `vlm.reachable`(VLM 주소 응답), `pam.reachable`·`pam.llm.reachable`(PAM 서비스와 그 LLM), `agent.key`·`agent.reachable`(에이전트 키와 주소 응답), `db`(기록 DB). 하나라도 false면 `ready.ok`가 false다.
- PAM 서비스 `/health`의 `limits`: 판단·반성에 넣을 수 있는 글 크기(UTF-8 바이트). `PAM_MAX_MODEL_LEN`을 바꾸면 같이 바뀐다.

## 5. 호출량

엔진 프레임은 `ENGINE_FRAME_MS`(기본 100)마다 오고 YOLO는 모든 프레임에 돈다(이 서버 안, 호출 비용 없음). VLM은 `VLM_FRAME_MS`(기본 2000)마다 한 장만 부르므로 한 시간에 약 1,800번이다. mock에서는 이만큼 OpenAI를 부른다.

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

- 저장소 `.env`와 셸의 키를 넘기지 않고, 확인용 값만 적은 임시 env 파일로 띄운다: noonchi `127.0.0.1:8500`(허브)·`8510`(폰), pam `8530`, `--profile check`의 가짜 OpenAI 호환 서버 `fake-openai`(포트를 열지 않음).
- 호스트 포트는 `CHECK_HUB_PORT`·`CHECK_PHONE_PORT`·`CHECK_PAM_PORT`로 바꾼다. 예: `CHECK_PAM_PORT=8535 npx tsx scripts/container-smoke.ts`. 셋이 겹치거나 포트가 아니면 띄우기 전에 멈춘다. 8520~8529는 화면 캡처 서버 자리라 기본값으로 쓰지 않는다.
- `INFERENCE_MODE=live`로 VLM·PAM LLM·에이전트 주소를 모두 `http://fake-openai:8500/v1`에 붙인다. 실제 AI API를 부르지 않는다.
- `ready.ok` true, 에이전트 답 「가짜 답」, PAM 서비스 판단(`pam-predict/2`, 가짜 PAM LLM은 대기 −1)과 `/health` 입력 한도, 트윈·기록 DB, 폰 화면, 이미지 안 YOLO(`/api/brain`의 `detector`가 `yolo26n-seg`, `pose`가 `yolo26n-pose`, 엔진 프레임 분석 수), 호스트에서 보낸 계획(토큰 없으면 403, `PLAN_TOKEN`을 붙이면 200), `/api/health` 폰 주소가 확인용 `PHONE_URL` 하나뿐인지, `docker stop` 뒤 종료 코드 0, 멈춘 noonchi 컨테이너에 onnxruntime 원격 측정 파일(`~/.cache/Microsoft/DeveloperTools/.onnxruntime`)이 없는지(`docker diff`)를 본 뒤 볼륨까지 지운다.
- 띄우기 전에 모든 키에 확인용 값을 넣은 env 파일로 `docker compose --profile gpu --profile check config`를 풀어, 키가 그 키를 쓰는 서비스에만 가는지 본다.
- noonchi 이미지는 저장소 `models/`의 `yolo26n-seg.onnx`·`yolo26n-pose.onnx`를 복사하고 sha256을 확인한다. 모델을 받지 않는다.
- noonchi 이미지는 onnxruntime 원격 측정(기기 id·측정 DB를 쓰고 HTTPS로 보냄)을 `ORT_DISABLE_TELEMETRY=1`로 끈다(onnxruntime `docs/Privacy.md` 「Disabling Telemetry」).
