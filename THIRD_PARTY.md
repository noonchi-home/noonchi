# 화면·모델 출처와 라이선스

## 글꼴

- Noto Sans KR Variable: npm `@fontsource-variable/noto-sans-kr` 5.3.1, SIL Open Font License 1.1.
  - 대시보드·설정·폰 화면은 `ui`가 꾸러미를 묶어 내준다. 폰 인코딩 워커는 `ui/src/phone/core/font-faces.js` 목록으로 같은 파일을 넣는다. 외부 CDN을 쓰지 않는다.
  - 라이선스 글: `ui/public/fonts/OFL-noto-sans-kr.txt`.

## 브랜드 그림

- 마스코트 전신·얼굴: noonchi-home/wiki `site/public/brand/`의 팀 브랜드 그림. 만든 파일과 쓰는 법은 `ui/public/brand/README.md`.

## 화면 부품

- `ui/src/components/ui/`의 부품은 21st.dev에서 받은 코드다. 파일마다 맨 위 출처 줄에 21st.dev 이름·id·작성자/slug와 바꾼 것을 적는다.

## 모델

관찰 흐름의 감지·관절 모델이다. 서버 이미지에 그대로 들어간다(`Dockerfile`이 sha256을 확인한다).

| 파일 | 원본 가중치 | 라이선스 | sha256 |
|---|---|---|---|
| `models/yolo26n.onnx` | Ultralytics YOLO26n `yolo26n.pt` (`https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt`, sha256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`) | AGPL-3.0 | `b164246692cd533f5d2ea16426c1e81da686ad64d07740f35ab762715faaf4c3` |
| `models/yolo26n-pose.onnx` | Ultralytics YOLO26n-pose `yolo26n-pose.pt` (`https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n-pose.pt`, sha256 `eb3bb8268828aeaf515cec23a4bfafd793944a86fe9af94ba7823609c14522a9`) | AGPL-3.0 | `dd0e47a03ea0f2b9e766b038559de14fb1dd5e51d8dfb331051740998628d91e` |

- YOLO26 두 파일은 AGPL-3.0이다(<https://ultralytics.com/license>). 이 저장소로 서버를 남에게 제공하면 AGPL-3.0의 소스 공개 조건이 따라온다.
- 내보낸 환경: ultralytics 8.4.208, torch 2.15.0+cpu, onnx 1.23.2, onnxslim 0.1.99. 설정: `format=onnx imgsz=640 opset=17 simplify=True dynamic=False batch=1`, `nms`는 주지 않음(바깥 NMS, ONNX 메타데이터 `end2end=False`). 그래서 출력이 NMS 전 `[1,84,8400]`·`[1,56,8400]`이고, 서버가 NMS를 한다(`src/brain/detector.ts`).
- 다시 내보내기(PC에서, 저장소 밖 폴더):

  ```bash
  python -m venv .venv && .venv/Scripts/pip install ultralytics==8.4.208 onnx==1.23.2 onnxslim==0.1.99 onnxruntime
  .venv/Scripts/yolo export model=yolo26n.pt format=onnx imgsz=640 opset=17 simplify=True
  .venv/Scripts/yolo export model=yolo26n-pose.pt format=onnx imgsz=640 opset=17 simplify=True
  npx tsx scripts/brain-yolo-fetch.ts --from <그 폴더>   # 저장소에서: sha256이 표와 같을 때만 models/에 넣는다
  ```

  ONNX에는 내보낸 시각이 들어가서 다시 내보내면 sha256이 달라진다. 새 파일을 쓰려면 `src/brain/detector.ts` 표와 `Dockerfile` 확인 줄의 sha256을 새 값으로 바꾼 뒤 `--from`을 돌린다. `npx tsx scripts/brain-yolo-fetch.ts`는 지금 `models/` 파일이 표와 같은지 본다.
