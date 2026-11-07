"""PAM 서비스: POST /predict(pam-predict/2), POST /reflect(pam-reflect/2), GET /health. 계약에 맞지 않으면 400, 문맥 길이를 넘으면 413, LLM 오류는 502.
실행: uvicorn noonchi_pam.app:create_app --factory --host 0.0.0.0 --port 8300"""
from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pam.contracts import ContractError, parse_prediction

from .budget import BudgetError, limits
from .contracts import PredictRequest, PredictResponse, ReflectRequest, ReflectResponse
from .llm import LlmClient, LlmError
from .prompt import build_predict_messages, build_reflect_messages, parse_memory
from .settings import Settings


def create_app(settings: Settings | None = None, client: LlmClient | None = None) -> FastAPI:
    settings = settings or Settings.from_env(os.environ)
    llm = client or LlmClient(settings)
    room = limits(settings)
    app = FastAPI(title="noonchi-pam")

    @app.exception_handler(RequestValidationError)
    async def bad_request(_req: Request, exc: RequestValidationError):
        return JSONResponse(status_code=400, content={"error": str([{k: e.get(k) for k in ("loc", "msg", "type")} for e in exc.errors()[:3]])})

    @app.exception_handler(ContractError)
    async def contract_error(_req: Request, exc: ContractError):
        return JSONResponse(status_code=400, content={"error": str(exc)})

    @app.exception_handler(LlmError)
    async def llm_error(_req: Request, exc: LlmError):
        return JSONResponse(status_code=502, content={"error": str(exc)})

    @app.exception_handler(BudgetError)
    async def budget_error(_req: Request, exc: BudgetError):
        return JSONResponse(status_code=413, content={"error": str(exc)})

    @app.post("/predict", response_model=PredictResponse)
    def predict(req: PredictRequest):
        built = build_predict_messages(req)
        raw = llm.complete(built["messages"], built["generation"], role="predictor")
        return parse_prediction(raw, list(req.tasks))

    @app.post("/reflect", response_model=ReflectResponse)
    def reflect(req: ReflectRequest):
        built = build_reflect_messages(req)
        raw = llm.complete(built["messages"], built["generation"], role="reflector")
        try:
            return {"status": "valid", "raw_response": raw, "memory": parse_memory(raw, req.memory_kind), "errors": []}
        except ValueError as e:
            return {"status": "invalid", "raw_response": raw, "memory": None, "errors": [str(e)]}

    @app.get("/health")
    def health():
        return {"ok": True, "llm": {"base_url": settings.base_url, "model": settings.model, "reachable": llm.reachable()}, "limits": room}

    return app
