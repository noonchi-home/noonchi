# noonchi 서버 이미지: 화면 빌드 → 운영 의존성 → 실행(저장소 models/의 YOLO26n·YOLO26n-pose, sha256 검사).
# 키·.env는 이미지에 넣지 않는다(.dockerignore). 설정은 compose가 이 서비스에 적은 이름만 실행 때 준다.
ARG NODE_IMAGE=node:22.15.0-bookworm-slim

FROM ${NODE_IMAGE} AS ui
WORKDIR /app
COPY ui/package.json ui/package-lock.json ui/
RUN npm --prefix ui ci
COPY src src
# ui 빌드는 twin/을 읽는다: vite @viewer 별칭(twin/apartment/viewer)과 타입 검사하는 3D 트윈 시험의 장면·구운 목록 JSON
COPY twin twin
COPY ui ui
RUN npm --prefix ui run build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# YOLO는 CPU로 돈다. onnxruntime-node가 linux/x64에서 따로 받는 CUDA 파일은 받지 않는다
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
# 리눅스에서 쓰지 않는 onnxruntime 바이너리(darwin·win32, 약 220MB)는 지운다
RUN npm ci --omit=dev && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32

FROM ${NODE_IMAGE} AS run
# ORT_DISABLE_TELEMETRY=1: onnxruntime 원격 측정(기기 id·측정 DB를 ~/.cache/Microsoft/DeveloperTools/.onnxruntime에 쓰고 HTTPS로 보냄)을 끈다.
# onnxruntime v1.31.1 docs/Privacy.md "Disabling Telemetry": onnxruntime이 뜨기 전에 준다
ENV NODE_ENV=production HOST=0.0.0.0 PHONE_HOST=0.0.0.0 PORT=8200 PHONE_PORT=8210 RUNTIME_DIR=/data \
    MATTER_STORAGE_DIR=/data/matter HUB=matter MATTER_TRANSPORT=local TZ=Asia/Seoul \
    ORT_DISABLE_TELEMETRY=1
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
# 감지·관절 모델(AGPL-3.0, THIRD_PARTY.md). 잘 바뀌지 않는 큰 파일이라 src보다 먼저 복사한다.
# sha256은 src/brain/detector.ts 모델 표와 같다(tests/deploy-files.test.ts)
COPY models models
RUN printf '%s\n' \
      "b164246692cd533f5d2ea16426c1e81da686ad64d07740f35ab762715faaf4c3  models/yolo26n.onnx" \
      "dd0e47a03ea0f2b9e766b038559de14fb1dd5e51d8dfb331051740998628d91e  models/yolo26n-pose.onnx" \
    | sha256sum -c -
COPY package.json tsconfig.json ./
COPY src src
COPY twin twin
COPY scripts scripts
COPY --from=ui /app/ui/dist ui/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8200 8210
CMD ["node", "--import", "tsx", "src/server/main.ts"]
