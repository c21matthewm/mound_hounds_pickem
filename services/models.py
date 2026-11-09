"""Wire models only; league mapping and validation remain in the Next.js service."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator
from services.config import official_url

Number = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-10000, le=10000)]
Integer = Annotated[StrictInt, Field(ge=-10000, le=10000)]
Text = Annotated[StrictStr, Field(min_length=1, max_length=120)]

class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

class ResultRow(WireModel):
    position: Integer | None = None
    driver_name: Text
    car_number: Annotated[StrictStr, Field(min_length=1, max_length=10)] | None = None
    laps: Integer | None = None
    status: Text | None = None
    points: Integer | None = None
    average_speed: Number | None = None

class OfficialEvidence(WireModel):
    kind: Literal["html_header","pdf_header"]
    header: Annotated[StrictStr,Field(min_length=1,max_length=150)]
    sha256: Annotated[StrictStr,Field(pattern=r"^[a-f0-9]{64}$")]
    source_url: Annotated[StrictStr,Field(min_length=1,max_length=1800)]

class ResultsPayload(WireModel):
    official_evidence: OfficialEvidence | None = None
    race_id: Annotated[StrictInt, Field(gt=0, le=9007199254740991)]
    season: Annotated[StrictInt, Field(ge=2000, le=2200)]
    event_id: Annotated[StrictStr, Field(min_length=1, max_length=128)]
    session_id: Annotated[StrictStr, Field(min_length=1, max_length=64)]
    source_url: Annotated[StrictStr, Field(max_length=1800)]
    source_status: Literal["official", "provisional", "unknown"]
    race_average_speed: Number | None = None
    rows: Annotated[list[ResultRow], Field(min_length=1, max_length=100)]

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        return official_url(value)

class Candidate(WireModel):
    poll_token: str | None = None
    has_provisional: bool = False
    race_id: Annotated[StrictInt, Field(gt=0, le=9007199254740991)]
    race_name: Annotated[StrictStr, Field(min_length=1, max_length=200)]
    season: Annotated[StrictInt, Field(ge=2000, le=2200)]
    event_id: Annotated[StrictStr, Field(min_length=1, max_length=128)]
    session_id: Annotated[StrictStr, Field(min_length=1, max_length=64)]
    source_url: Annotated[StrictStr, Field(max_length=1800)]

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        return official_url(value)
