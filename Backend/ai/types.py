from dataclasses import dataclass, field
from typing import Any, Optional


# ============================================================
# MODEL CONFIG
# ============================================================

@dataclass(slots=True)
class ModelConfig:
    provider: str
    model: str
    feature_id: str = ""
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    input_cost_per_million: float = 0.0
    output_cost_per_million: float = 0.0
    priority: int = 1
    enabled: bool = True


# ============================================================
# PROMPT CONFIG
# ============================================================

@dataclass(slots=True)
class PromptConfig:
    feature: str

    prompt_type: str

    version: int

    prompt: str

    enabled: bool = True

    variables: list[str] = field(default_factory=list)

    feature_id: str = ""



# ============================================================
# AI REQUEST
# ============================================================

@dataclass(slots=True)
class AIRequest:

    # Required

    feature: str

    company_id: str

    user_id: str

    route: str

    variables: dict[str, Any]


    # Optional

    prompt_type: str = "default"

    system_prompt: Optional[str] = None

    images: list[Any] = field(default_factory=list)

    files: list[Any] = field(default_factory=list)

    audio: Any = None
    
    stream: bool = False

    response_format: str = "text"

    generation_config: dict[str, Any] = field(default_factory=dict)

    metadata: dict[str, Any] = field(default_factory=dict)


# ============================================================
# AI RESPONSE
# ============================================================

@dataclass(slots=True)
class AIResponse:

    success: bool

    content: Any

    provider: str

    model: str

    prompt_version: int

    finish_reason: Optional[str] = None

    input_tokens: int = 0

    output_tokens: int = 0

    total_tokens: int = 0

    latency_ms: int = 0

    raw_response: Any = None

    error: Optional[str] = None


# ============================================================
# USAGE LOG
# ============================================================

@dataclass(slots=True)
class UsageLog:

    company_id: str

    user_id: str

    feature_id: str

    provider: str

    model: str

    route: str

    prompt_version: int

    input_tokens: int

    output_tokens: int

    total_tokens: int

    cost_usd: float

    cost_inr: float

    latency_ms: int

    status: str

    error_message: Optional[str] = None
    
@dataclass(slots=True)
class FeatureConfig:
    feature_id: str
    description: str
    enabled: bool