"""pam-predict/2·pam-reflect/2 계약. 사진 칸이 없고 모르는 칸은 거절한다."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Prediction(Strict):
    observation: str
    reasoning: str
    task_index: int


class PredictRequest(Strict):
    contract: Literal["pam-predict/2"]
    final_time: AwareDatetime
    observation_text: str = Field(min_length=1, max_length=20_000)
    memory_kind: Literal["list", "fsm"]
    memory: dict
    tasks: list[str] = Field(min_length=1)


class PredictResponse(Strict):
    status: Literal["valid", "invalid"]
    raw_response: str
    prediction: Prediction | None
    selected_action: str | None
    errors: list[str]


class ReflectRequest(Strict):
    contract: Literal["pam-reflect/2"]
    day: date
    memory_kind: Literal["list", "fsm"]
    memory: dict
    observation_text: str = Field(min_length=1, max_length=100_000)
    action_summary: str = Field(min_length=1, max_length=50_000)
    feedback: str | None = Field(default=None, max_length=8_000)


class ReflectResponse(Strict):
    status: Literal["valid", "invalid"]
    raw_response: str
    memory: dict | None
    errors: list[str]
