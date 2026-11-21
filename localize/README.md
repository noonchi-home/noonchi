# 집 사진으로 폰 위치 찾기

Python 3.11, OpenCV CPU 스레드 2개를 쓴다. 작업 폴더는 저장소 뿌리다. 집마다 지도 하나를 메모리에 올린다. JPEG는 메모리에서 읽고, 버스와 기록에는 프레임 번호와 위치 결과만 보낸다.

## 트윈 기준 자료와 시험

이 PC에서는 매 작업 전에 남은 메모리가 3GiB 이상인지 확인한다. Chromium 촬영과 시험은 한 번에 하나씩 실행한다. 촬영 경로에는 새 폴더 이름을 쓴다.

```powershell
uv venv --python 3.11 runtime/localize-venv
npm run heavy -- uv pip install --python runtime/localize-venv/Scripts/python.exe -r localize/requirements.txt
$env:Path = (Resolve-Path runtime/localize-venv/Scripts).Path + ';' + $env:Path

npm run capture -- --home-shots --depth --out runtime/localize-reference
npm run capture -- --home-shots --holdout --out runtime/localize-holdout
npm run heavy -- python -B localize/worker.py build --home mokryeon_180b --manifest runtime/localize-reference/manifest.json --map runtime/homes/mokryeon_180b/localize/map.npz
npm run heavy -- python -B localize/worker.py evaluate --home mokryeon_180b --manifest runtime/localize-holdout/manifest.json --map runtime/homes/mokryeon_180b/localize/map.npz --report runtime/localize-holdout/evaluation.json
```

각 줄에 `id, file, position, yaw_deg, pitch_deg, width, height`와 `projection` 또는 `vfov_deg`가 필요하다. 위치는 트윈 [x, 높이, z] 미터, yaw는 +X에서 +Z 방향, pitch는 위쪽이 양수다. 카메라가 기울어진 실사진에는 시계방향 `roll_deg`도 쓸 수 있다. 등록된 깊이 PNG는 `depth_file`과 `depth_encoding="axial_mm_rg16"`로 잇는다. 빨강 × 256 + 초록이 광축 방향 거리(mm)이고 0은 유효한 면이 없는 픽셀이다.

평가는 기준 카메라에서 수평 10cm, 높이 3cm, yaw 4°, pitch 2° 옮겨 다시 찍는다. 폰 기본 가로 너비 480px·JPEG 품질 80을 쓰며, 평가 사진의 정답 자세는 풀이가 끝난 뒤 오차 계산에만 쓴다. 보고서에 인식 수, 모름, 위치·시선 오차, JPEG 해제부터 자세 계산까지의 시간, 평가 프로세스의 최대 메모리가 남는다.

## 폰과 관찰 노드

`BRAIN=1`과 `PHONE_PORT`로 기존 관찰 흐름을 켜고 `RUNTIME_DIR/homes/<집>/localize/map.npz`를 두면 집을 열 때 Python이 시작된다. `LOCALIZE_MAP`과 `LOCALIZE_PYTHON`으로 경로를 지정할 수 있다. `GET /api/localize`에서 지도 판본, 기준 수, 최근 결과를 읽는다.

전역 색 배치와 시각 단어 분포로 후보 5장을 고른 뒤 SIFT 특징을 대응시키고 PnP RANSAC으로 자세를 푼다. 지도는 사진 경계의 깊이 단차를 제외한다. 특징점이 한곳에 몰리거나 두 후보의 위치가 충돌하면 모름을 낸다. 폰 맞춤, 10초 확인, 집 사진용 VLM 프레임에서 요청하고 처리 중에는 최신 대기 한 장만 보관한다.

맞은 점이 20개 이상이고 입력 사진 픽셀 기준 재투영 RMS가 1.25px 이하여야 자세를 채택한다. 사진과 같은 시점의 AR 위치가 16cm 또는 시선이 15° 넘게 다르면 폰은 어림으로 돌아간다. 세계 상태는 사진마다 위치가 맞았을 때만 빈 구역 근거를 남긴다. 관찰 자리에서는 도착 후 촬영한 사진의 위치, 바라볼 곳, 해당 가전을 함께 확인한다.

## 6.15절 이름과 기준값

Python 폴더와 버스 노드 이름은 `localize`다. `/perception/localize`로 요청하고 `/perception/localized`로 응답한다. 둘 다 RELIABLE이다. 첫 맞춤과 그 뒤 10초마다 들어온 첫 원본 프레임을 확인한다. 그 사이 집 사진이나 관찰 자리 도착에 쓴 장면도 요청할 수 있다. 같은 장면에서 두 조건이 겹치면 한 번 푼다.

`GET /api/homes/{집}/scenes`는 manifest의 장면별 카메라 값과 RGB PNG의 `image_url`을 준다. 서버는 `RUNTIME_DIR/homes/<집>/scenes/manifest.json`과 그림을 읽는다. 집 id가 붙은 `runtime/shots`와 `runtime/localize-reference` 렌더도 읽는다. `POST /api/homes/{집}/shots`에 `{"scene_id":"living_standby_C"}`를 보내면 600초짜리 S3 PUT 주소 두 개가 생긴다. 앱은 `photo.url`에 JPEG, `label.url`에 같은 촬영의 JSON을 보내며 각 응답의 `content_type`을 PUT 헤더에 쓴다. 두 객체는 집별 `shots/<장면>/<촬영 id>` 아래 같은 이름으로 짝을 이룬다. 이 API에도 `LOCALIZE_BUCKET`과 서버의 AWS 자격 증명을 쓴다.

`localize/calibrate.py`는 기본 엔진 너비 480px, JPEG 품질 80으로 평가한다. 기준 카메라 위치가 같은 사진은 한 묶음으로 두고 51장으로 문턱을 고른 뒤 나머지 25장으로 검증했다. PnP 문턱 42개 조합을 비교해 틀린 자세와 좌우 반전 대조 사진의 오채택을 먼저 줄이고, 맞은 장수를 늘렸다. 허용 자세 오차는 10cm·4°다. AR 시험은 렌더의 정답과 원래 카메라 자세, 가장 가까운 다른 자리, 좌우 30°로 틀어진 가상 자세를 썼다. 위치와 시선은 각각 오판이 가장 적은 연속 구간의 가운데 값을 썼다.

검증 25장은 성공 17장·모름 8장·오채택 0장이었다. 촬영 자리는 집 자료(stations.json)의 관찰 자리·면 앞 자리에서 읽고, 거실 대기 자리를 [6.98, 6.38]로 옮긴 뒤 옛 자리는 「거실 TV 옆」 기준 장면으로 남긴다. 이 81장 지도에 같은 적용값을 쓰면 검증 25장 중 성공 15장·모름 10장·오채택 0장, 전체 81장 중 57장이다. 반전 대조 25장은 전부 모름이었다. 위치가 나온 17장에서는 가상 AR 위치·방향 오류를 모두 검출했다. 선정용 자료에서는 서로 18cm 떨어진 주방 입구와 걷는 길 사이의 위치 오류를 한 건 놓쳤다. 실제 폰으로 찍은 자료가 생기면 각 평가 줄의 `reference_id`에 대응하는 기준 줄 id를 넣고 같은 명령으로 다시 보정한다. 적용값은 `src/shared/photo-limits.json`에 있다.

```powershell
npm run heavy -- python -B localize/calibrate.py --home mokryeon_180b --map runtime/homes/mokryeon_180b/localize/map.npz --reference runtime/localize-reference/manifest.json --holdout runtime/localize-holdout/manifest.json --report runtime/localize-holdout/calibration.json
```

## 실제 촬영 자료

촬영 앱에서 내보낸 `shots/<scene>/<stamp>.jpg`와 같은 이름의 JSON을 비공개 작업 폴더에 둔다. 앱의 장면 목표 자세와 40°는 촬영 안내값이다. 노출별 실제 측정값은 업로드 JSON의 `measured_camera` 또는 `photo` 경로를 키로 쓰는 별도 보정 JSON으로 받는다. 카메라 위치·방향과 실제 렌즈 내부값을 넣고, 깊이가 없는 장면은 서로 다른 위치에서 겹치게 촬영한다.

```powershell
npm run heavy -- python -B localize/uploads.py --root runtime/real-reference/shots --calibration runtime/real-reference/cameras.json --home mokryeon_180b --output runtime/real-reference/manifest.json
```

기준 자료에 깊이가 없으면 겹친 사진의 특징을 삼각측량한다. 위의 `build`에 실제 기준 manifest를, `evaluate`에 따로 촬영하고 실측한 평가 manifest를 넣는다. 실사진·지도·보고서는 runtime 아래에 둔다.

S3를 쓰는 집에서는 `LOCALIZE_BUCKET`을 설정한다. 서버 권한으로 `homes/<집>/map/latest.json`의 `revision`과 `sha256`을 읽어 같은 폴더의 `<revision>.npz`를 받는다. 체크섬, 지도에 기록된 집과 판본을 검사한다. 버킷을 설정하지 않으면 로컬 지도를 읽는다.
