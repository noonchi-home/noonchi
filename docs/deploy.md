# Deploy NOONCHI on an AWS GPU instance

A single EC2 instance runs NOONCHI on the CPU. Its nodes exchange messages over an in-process memory bus, so the deployment has no Redis service. In GPU mode, two vLLM services serve the vision model and the PAM language model. Run the commands below from the root of the NOONCHI checkout.

## 1. Prepare the host

- In Seoul (`ap-northeast-2`), check the EC2 quota for running On-Demand G and VT instances. Attach an IAM role with `AmazonSSMManagedInstanceCore` so you can connect through Session Manager without opening an inbound SSH port.
- The reference host is a `g6e.2xlarge` with 8 vCPUs, 64 GiB RAM and a 48 GB L40S GPU. It can run the 4-bit PAM model and the vision model together. Smaller GPUs may require a smaller model. Inspect `docker stats` and the detection and pose timings in `/api/brain`.
- Use an Ubuntu Deep Learning AMI with the NVIDIA driver, Docker, NVIDIA Container Toolkit and the SSM agent. Attach a persistent gp3 EBS data volume of at least 200 GB for the checkout, runtime records and model cache. Identify the volume with `lsblk`; only format a new, empty volume. Mount it at `/srv` and configure the mount by UUID in `/etc/fstab`.
- If storing Docker data on EBS, stop Docker and its socket, back up `/etc/docker/daemon.json` and set `data-root` to `/srv/docker` without replacing the NVIDIA runtime settings. Restart Docker and verify `docker info --format '{{.DockerRootDir}}'`. Use Session Manager or `aws ssm start-session --target <instance-id> --region ap-northeast-2` for administration.

## 2. Connect the phone with Tailscale

Enable **MagicDNS** and **HTTPS Certificates** in the tailnet. Sign the server, phone and dashboard computer into the same tailnet. On the server, after installing Tailscale:

```bash
sudo tailscale up --ssh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8200
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8210
tailscale serve status
```

Open the dashboard on the hub's HTTPS origin. Its connection QR points to `/mobile/` on that origin. Scan it inside the [NOONCHI Android app](../apps/android/README.md) to pair, or open the same URL in a phone browser for the web portal. The setup endpoint supports pairing before a home has been registered. Register the home on the phone. In the web portal, tap **클로이드 켜기** to start the camera and **카메라 끄기** to return home.

The hub handles `/events` for the dashboard and `/mobile/phone-events` for the mobile web camera. The camera listener handles `/phone/`, `/phone/events`, and video playback. Preserve the matching host and origin and pass WebSocket upgrades on both listeners. The ports above are examples. Keep existing Serve mappings and choose an unused hub HTTPS port when a deployment already reserves 443 for the AR listener. Use Serve within the tailnet and leave Funnel disabled.

### Android camera TWA

The Android app pairs with the dashboard HTTPS `/mobile/` QR. Before launch it reads `android_twa.phone_url` and `android_twa.assetlinks_url` from the hub's `GET /api/setup`. Chrome verifies the HTTPS camera origin, including its port. The dashboard can use a different origin. Expo Go can exercise the native screens. Use a signed installed APK for the TWA bridge.

Set `ANDROID_TWA_SHA256_FINGERPRINTS` to the public SHA-256 certificate fingerprint of the installed `app.noonchi.android` APK. Use 32 colon-separated hex bytes per fingerprint and commas between fingerprints. The camera listener serves `/.well-known/assetlinks.json` directly as JSON. Route that path to the camera listener if a reverse proxy splits paths on a shared origin.

Read `GET /api/setup` at the hub to check `mobile_urls`, `android_twa.package_name`, both camera URLs, and `android_twa.statements_configured`. Fetch `/mobile/` from the hub and `/phone/` and `assetlinks_url` from the configured camera origin. Expect HTTP 200 for all three and an Asset Links statement for the installed package and its public certificate. A successful HTTP check establishes server configuration.

On the actual phone, check that **클로이드 켜기** opens the verified TWA without an address bar. Then tap **카메라 켜기** to start immersive WebXR. Once the session starts, the page requests a landscape orientation lock. If the lock fails while the phone is in portrait, the page asks the user to rotate it. Check camera and microphone permissions, tracking, and audible speech on the target phone.

### Reference photos and optional S3 uploads

For each registered home, put `manifest.json` and its reference PNGs in `RUNTIME_DIR/homes/<home>/scenes/`. On the sample Compose deployment, `RUNTIME_DIR` is `/data` in the server container. Check the catalog at `GET /api/homes/<home>/scenes` before capturing a reference photo. A missing catalog returns HTTP 404 and leaves the app without reference views.

To enable private S3 uploads, set `LOCALIZE_BUCKET` and give the server AWS permissions for the target objects. The signer runs `localize/sign_shot.py` using Python with `boto3` installed. Use `LOCALIZE_PYTHON` to select that interpreter if needed. The default Docker runtime image serves the API but requires a custom runtime with the signer script and Python dependencies for S3 signing. [Signing route](../src/server/routes/home-shots.ts)

For a valid scene, `POST /api/homes/<home>/shots` returns separate signed PUT URLs for the JPEG and JSON label. If signing returns HTTP 503, Android keeps the photo on the phone. If either PUT fails after the URLs are issued, Android reports a save error. After both PUTs succeed, Android keeps a local copy for review.

## 3. Check out the repository and configure services

```bash
git clone https://github.com/noonchi-home/noonchi.git /srv/noonchi
cd /srv/noonchi
cp .env.example .env
```

Create the checkout directory with suitable ownership if needed. Supply credentials locally on the host. The root environment file is selected explicitly with `--env-file .env`.

| Setting | Purpose |
|---|---|
| `INFERENCE_MODE` | `vllm` for the GPU deployment or `openai` for hosted inference. |
| `ALLOWED_ORIGINS` | Dashboard origin, for example `https://<host>.<tailnet>.ts.net`. |
| `HUB_URL` | Dashboard HTTPS origin for the phone QR when the server cannot discover its own Serve mapping. Include it in `ALLOWED_ORIGINS` and use the port that serves the hub. |
| `PHONE_URL` | Tailnet HTTPS URL of the camera page at `/phone/`. Set it to the actual AR origin and port. |
| `ANDROID_TWA_SHA256_FINGERPRINTS` | Public signing certificate SHA-256 fingerprints for the Android camera TWA. |
| `BRAIN` | Use `1` to enable perception and decisions. |
| `PLAN_TOKEN` | Bearer token for external plan submissions. Generate a long random value, for example with `openssl rand -hex 32`. |
| `VLM_LIVE_MODEL` | Defaults to `Qwen/Qwen3-VL-4B-Instruct`, served as `vlm`. |
| `PAM_LIVE_MODEL` | Defaults to `Qwen/Qwen3.5-27B-GPTQ-Int4`, served as `pam`. |
| `PAM_MAX_MODEL_LEN` | Context limit shared with the PAM input budget. Default 32768. |
| `PAM_LLM_BASE_URL`, `PAM_LLM_MODEL` | Override the PAM endpoint and model selected by the inference mode. |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | The voice and planning agent needs a supported provider key in either mode. OpenAI mode also uses an OpenAI key for vision and PAM. |
| `HF_TOKEN` | Required only for restricted Hugging Face model downloads. |
| `THINQ_TOKEN` | Used when connecting to real ThinQ appliances. |
| `TV_RELAY_URL`, `TV_RELAY_TOKEN`, `TV_RELAY_DEVICE` | Optional TV relay for an IR kit without a light sensor ([TV relay](../hardware/ir-bridge/README.md#without-a-light-sensor-use-the-tv-relay)). Use an `https` URL, or `http` only with a Tailscale IP. |

Each container receives only the variables listed for its service in `deploy/compose.yaml`. The ownership rules are in `scripts/compose-keys.ts`.

- NOONCHI uses `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VLM_API_KEY`, `PAM_LLM_API_KEY`, `THINQ_TOKEN`, `THINQ_API_KEY`, `TV_RELAY_TOKEN` and `PLAN_TOKEN`.
- The vLLM services use `HF_TOKEN` for downloads. NOONCHI and both model services can use `VLLM_API_KEY` to authenticate inference traffic.
- Compose sets the internal host and ports, `RUNTIME_DIR=/data`, `PHONE_VIDEO_DIR=/data/videos`, and `MATTER_TRANSPORT=local`. To change published ports, use `NOONCHI_PORT` (8200) and `NOONCHI_PHONE_PORT` (8210). Shell values take precedence over the selected environment file.

## 4. Start and check the services

```bash
# Hosted inference
docker compose --env-file .env -f deploy/compose.yaml up -d --build

# Local GPU inference
docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build
docker compose --env-file .env -f deploy/compose.yaml --profile gpu ps
curl -s http://127.0.0.1:8200/api/health

# Expect the served model IDs vlm and pam respectively
curl -s http://127.0.0.1:8410/v1/models
curl -s http://127.0.0.1:8420/v1/models
docker compose --env-file .env -f deploy/compose.yaml --profile gpu logs --tail 50 vllm-vlm vllm-pam
```

If the model endpoints require a key, pass `-H "Authorization: Bearer $VLLM_API_KEY"`. The default image is `vllm/vllm-openai:v0.17.0`. PAM starts after the vision endpoint is healthy. The first run downloads the models. The default GPU memory shares are 0.30 and 0.60. If PAM cannot start, review available memory and the context limit.

Check `ready.ok` in `/api/health`. The response includes `vlm.reachable`, `pam.reachable`, `agent.key`, `agent.reachable` and database readiness. The served PAM model uses the Qwen reasoning parser so reflection text and the final answer are reported separately.

## 5. Estimate inference traffic

`ENGINE_FRAME_MS` (default 100) controls engine frames. YOLO runs locally. `VLM_FRAME_MS` (default 2000) samples an image every two seconds, about 1,800 samples per hour of continuous observation at that interval. Searches and cup inspections can shorten the interval. Actual model calls depend on frame availability and processing.

## 6. Stop or update

```bash
docker compose --env-file .env -f deploy/compose.yaml --profile gpu down
git pull
docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build
```

The runtime volume persists across a normal shutdown. Stopping the EC2 instance stops the dashboard, phone server and decisions. Keep the EBS volume to retain the records.

## 7. Smoke test without production credentials

```bash
docker build -f deploy/Dockerfile -t noonchi:check .
npx tsx scripts/container-smoke.ts
```

The check runs without forwarding the repository's `.env` or shell credentials. It uses temporary test values and verifies that each key reaches only the services that use it. The check profile connects to `fake-openai` internally. The hub binds to loopback port `8500` and the phone to `8510`. Change these with `CHECK_HUB_PORT` and `CHECK_PHONE_PORT`. For example, run `CHECK_PHONE_PORT=8515 npx tsx scripts/container-smoke.ts`. Use distinct valid ports.

The smoke test checks health, a fake agent reply, a recorded PAM decision, the twin and record database, the phone page, plan authorization, clean shutdown, model checksums, and the absence of ONNX Runtime telemetry files. The image includes both local ONNX models and sets `ORT_DISABLE_TELEMETRY=1`. The check removes its temporary volumes at the end.
