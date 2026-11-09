# 출처

- `pam/`(`__init__.py`, `contracts.py`, `messages.py`, `scenarios.py`), `prompts/`, `config/paper.json`, `config/openrouter.json`, `THIRD_PARTY.md`, `tests/test_contracts.py`: ai 저장소(박석준·김준형) 커밋 cd290d5에서 옮겼다.
- OpenRouter 전송 설정(`config/openrouter.json`: provider alibaba 고정·다른 공급자로 넘기지 않음, max_tokens 판단 2048·반성 16384, 시간 제한 120초)과 요청 칸(`stream: false`, 문맥 압축 끔 `plugins`)은 ai `pam/openrouter.py`의 `build_request`와 같다.
- 논문: Dohyun Lee, Minho Park 외, An Agentic Framework for Proactive Robots with Procedural Assistance Memory, arXiv:2610.21211v1. 저자 저장소 https://github.com/DAVIAN-Robotics/PAM. 논문 프롬프트 일곱 개는 부록 E·F 전사본이고 해시는 `prompts/source_map.json`에 있다. 자세한 출처와 라이선스 상태는 `THIRD_PARTY.md`.
- `noonchi_pam/`, `scenarios/noonchi/`, `tests/`(위 파일 빼고), `Dockerfile`은 NOONCHI에서 만들었다.
