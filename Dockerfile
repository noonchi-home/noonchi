# noonchi 서버 이미지: 화면 빌드 → 운영 의존성 → YOLOX 모델(sha256 검사) → 실행.
# 키·.env는 이미지에 넣지 않는다(.dockerignore). 설정은 compose가 이 서비스에 적은 이름만 실행 때 준다.
ARG NODE_IMAGE=node:22.15.0-bookworm-slim

FROM ${NODE_IMAGE} AS ui
WORKDIR /app
COPY ui/package.json ui/package-lock.json ui/
RUN npm --prefix ui ci
COPY src src
COPY ui ui
RUN npm --prefix ui run build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# YOLOX는 CPU로 돈다. onnxruntime-node가 linux/x64에서 따로 받는 CUDA 파일은 받지 않는다
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
# 리눅스에서 쓰지 않는 onnxruntime 바이너리(darwin·win32, 약 220MB)는 지운다
RUN npm ci --omit=dev && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32

FROM ${NODE_IMAGE} AS yolox
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG YOLOX_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
ARG YOLOX_SHA256=427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7
RUN curl -fsSL -o /yolox_tiny.onnx "$YOLOX_URL" && echo "$YOLOX_SHA256  /yolox_tiny.onnx" | sha256sum -c -

FROM ${NODE_IMAGE} AS run
# ORT_DISABLE_TELEMETRY=1: onnxruntime 원격 측정(기기 id·측정 DB를 ~/.cache/Microsoft/DeveloperTools/.onnxruntime에 쓰고 HTTPS로 보냄)을 끈다.
# onnxruntime v1.31.1 docs/Privacy.md "Disabling Telemetry": onnxruntime이 뜨기 전에 준다
ENV NODE_ENV=production HOST=0.0.0.0 PHONE_HOST=0.0.0.0 PORT=8200 PHONE_PORT=8210 RUNTIME_DIR=/data \
    MATTER_STORAGE_DIR=/data/matter HUB=matter MATTER_TRANSPORT=local BRAIN_YOLO_PATH=/app/models/yolox_tiny.onnx TZ=Asia/Seoul \
    ORT_DISABLE_TELEMETRY=1
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.json ./
COPY src src
COPY twin twin
COPY scripts scripts
COPY --from=ui /app/ui/dist ui/dist
COPY --from=yolox /yolox_tiny.onnx models/yolox_tiny.onnx
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8200 8210
CMD ["node", "--import", "tsx", "src/server/main.ts"]
