# 출처와 라이선스

이 폴더는 저자의 공식 구현이 아니다. 논문을 보고 따로 만든 구현이다(옮겨 온 내력은 `PROVENANCE.md`).

- 논문: Dohyun Lee, Minho Park 외, **An Agentic Framework for Proactive Robots with Procedural Assistance Memory**, arXiv:2610.21211v1. https://arxiv.org/abs/2610.21211. 논문 라이선스는 CC BY 4.0(https://creativecommons.org/licenses/by/4.0/)이다.
- `prompts/paper/`의 일곱 프롬프트는 이 논문 부록 E·F 원문이다. CC BY 4.0을 따르고 출처는 위 논문이다. 원문 파일은 고치지 않고, 우리가 바꾼 문장은 `scenarios/noonchi/scenario.json`의 `prompt_replacements`로 실행할 때 바꾼다. 영역과 해시는 `prompts/source_map.json`에 있다.
- 저자 저장소 https://github.com/DAVIAN-Robotics/PAM 에는 LICENSE가 없다. 그래서 그 저장소의 코드·그림·문서는 이 저장소에 넣지 않았다.
- 원논문 PDF는 저장소에 넣지 않았다(`config/paper.json`의 `source_pdf`는 로컬 경로다).
- 프롬프트 원문 밖의 코드·시나리오·시험은 이 저장소에서 만들었고, 저장소 라이선스(AGPL-3.0, 뿌리 `LICENSE`)를 따른다.
