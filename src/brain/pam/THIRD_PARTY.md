# 출처와 자료 구분

이 프로젝트는 저자의 공식 구현이 아닙니다. 제공받은 논문과 공개 자료를 참고해 작성한 별도의 Python 구현입니다.

- 논문: Dohyun Lee, Minho Park 외, **An Agentic Framework for Proactive Robots with Procedural Assistance Memory**, arXiv:2610.21211v1. https://arxiv.org/abs/2610.21211
- 저자 저장소: https://github.com/DAVIAN-Robotics/PAM
- 검토한 저장소 버전: `656a63ef4607177dd3b404042086486531a573f4`
- 검토한 제공 PDF SHA-256: `1fe0e4954d4fefaffb1e9d1619a2e52e1918b2872ca789485ec437e95f82a364`
- `prompts/paper/`의 일곱 프롬프트는 논문 부록 E·F에서 전사했습니다. 출처와 영역, 해시는 `prompts/source_map.json`에 있습니다. 이 문구를 우리 독자 저작으로 표시하지 않습니다.
- `pam/`, 검증 도구, 테스트 및 아침 상황 설정은 이 프로젝트에서 구현했습니다.
- `examples/`의 3D 사진은 이 프로젝트의 Blender 스크립트로 생성했습니다. API 응답은 실제 실험 기록이며 모델 성능 보증이 아닙니다.

원논문 PDF, 저자 저장소 전체 사본과 그림·영상, 과거 문서 사본, 로컬 발표 HTML은 기본 Git 포함 대상에서 제외했습니다. 이 자료들은 로컬 `papers/`, `reference/`, `presentation/`에 보존됩니다. 특히 발표 HTML에는 원논문 그림이 내장되어 있습니다.

이 검토에서 보관된 저자 저장소 루트에 LICENSE 파일은 없었습니다. 외부 자료에 임의로 MIT 등 다른 라이선스를 붙이지 않았으며, 이 파일은 재배포 권한을 부여하는 문서가 아닙니다. 코드 공개 시 적용할 라이선스는 별도로 결정해야 합니다.
