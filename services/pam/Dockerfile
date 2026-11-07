# PAM 서비스 이미지: pam-predict/2·pam-reflect/2를 8300에서 내준다. LLM은 OpenAI 호환 주소(PAM_LLM_BASE_URL)로 부른다.
# pam.messages.PROJECT_ROOT가 pam/의 부모(/app)라서 패키지 폴더를 /app에 그대로 두고 의존성만 설치한다.
# 의존성은 하위 의존성까지 판과 sha256을 고정한 requirements.lock으로 깐다(pyproject.toml과 같은 판).
# 키·.env는 이미지에 넣지 않는다. 설정은 compose env_file로 실행 때 준다.
FROM python:3.13.9-slim-bookworm
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock && useradd -m pam
COPY pam pam
COPY noonchi_pam noonchi_pam
COPY prompts prompts
COPY config config
COPY scenarios scenarios
COPY THIRD_PARTY.md PROVENANCE.md ./
ENV PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER pam
EXPOSE 8300
CMD ["uvicorn", "noonchi_pam.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8300"]
