from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

class FormatTypeEnum(str, Enum):
    FILL_BLANKS = "FILL_BLANKS"
    VIBE_CHECK = "VIBE_CHECK"
    RISK_RIZZ = "RISK_RIZZ"
    CODE_BREAKER = "CODE_BREAKER"
    FLOW_MASTER = "FLOW_MASTER"
    AUDIT_SPOTTER = "AUDIT_SPOTTER"
    SPEED_RUN = "SPEED_RUN"


# ----------------------------------------------------------------------------
# 1. DRILL PAYLOAD SCHEMAS (Validated during RAG AI Generation & Persistence)
# ----------------------------------------------------------------------------

class FillBlanksOption(BaseModel):
    blank_id: str = Field(..., description="ID of the blank, e.g. blank_1")
    correct_word: str = Field(..., description="The correct term or number")
    options: List[str] = Field(..., description="List of 3-4 distractor choices including correct_word")

class FillBlanksPayload(BaseModel):
    sentence_template: str = Field(..., description="Text containing placeholders like {{blank_1}} or {{blank_2}}")
    blanks: List[FillBlanksOption] = Field(..., description="Configurations for each blank in template")
    explanation: str = Field(..., description="Rule or policy explanation")


class VibeCheckOption(BaseModel):
    id: str = Field(..., description="Option ID, e.g., opt_a")
    text: str = Field(..., description="Option description")
    is_ethical: bool = Field(..., description="Whether this choice is policy-compliant")
    feedback: str = Field(..., description="Immediate contextual feedback when chosen")

class VibeCheckPayload(BaseModel):
    scenario_text: str = Field(..., description="Realistic Workplace/Compliance Scenario")
    options: List[VibeCheckOption] = Field(..., description="Available decision paths")
    takeaway: str = Field(..., description="Key ethical/policy takeaway")


class RiskRizzPayload(BaseModel):
    statement: str = Field(..., description="Operational statement or action to evaluate")
    is_compliant: bool = Field(..., description="True if compliant (Swipe Right), False if violation (Swipe Left)")
    violation_category: Optional[str] = Field(None, description="E.g., Data Security, POS Policy, POSH")
    correct_action: str = Field(..., description="What should be done instead")


class CodeBreakerClue(BaseModel):
    digit_position: int = Field(..., ge=1, le=4, description="Digit position 1-4")
    hint_question: str = Field(..., description="Question or clue revealing the digit")
    options: List[int] = Field(..., description="Numerical options (0-9)")
    correct_digit: int = Field(..., ge=0, le=9, description="The correct digit value")

class CodeBreakerPayload(BaseModel):
    title: str = Field(..., description="Passcode vault scenario title")
    passcode: str = Field(..., min_length=4, max_length=4, description="4-digit target passcode, e.g., '7412'")
    clues: List[CodeBreakerClue] = Field(..., min_items=4, max_items=4, description="4 digit clues")


class FlowMasterStep(BaseModel):
    id: str = Field(..., description="Step ID, e.g., step_1")
    text: str = Field(..., description="Description of the SOP step")
    correct_order: int = Field(..., ge=1, description="1-indexed position in correct sequence")

class FlowMasterPayload(BaseModel):
    procedure_title: str = Field(..., description="SOP procedure title")
    steps: List[FlowMasterStep] = Field(..., min_items=3, description="List of SOP steps in shuffled or ordered format")
    hint: Optional[str] = Field(None, description="Helpful hint for sequencing")


class AuditSpotterSection(BaseModel):
    id: str = Field(..., description="Section ID, e.g., sec_1")
    text: str = Field(..., description="Text segment of document")
    is_red_flag: bool = Field(..., description="Whether this section contains a policy red flag")
    flag_reason: Optional[str] = Field(None, description="Explanation if it is a red flag")

class AuditSpotterPayload(BaseModel):
    document_title: str = Field(..., description="Document memo title")
    sections: List[AuditSpotterSection] = Field(..., min_items=3, description="Document paragraphs/segments")
    total_red_flags: int = Field(..., ge=1, description="Total count of red flags to spot")


class SpeedRunQuestion(BaseModel):
    id: str = Field(..., description="Question ID")
    question: str = Field(..., description="Question text")
    options: List[str] = Field(..., min_items=2, description="Multiple choice options")
    correct_option_index: int = Field(..., ge=0, description="0-indexed correct option")
    explanation: str = Field(..., description="Brief explanation")

class SpeedRunPayload(BaseModel):
    time_limit_seconds: int = Field(default=30, description="Total timer seconds")
    questions: List[SpeedRunQuestion] = Field(..., min_items=3, description="Rapid fire questions")


# ----------------------------------------------------------------------------
# 2. DRILL SUBMISSION & PROGRESSION SCHEMAS (API Requests & Responses)
# ----------------------------------------------------------------------------

class DrillSubmissionRequest(BaseModel):
    drill_id: str = Field(..., description="UUID of the drill")
    sprint_id: str = Field(..., description="UUID of the sprint")
    wrong_attempts: int = Field(default=0, ge=0, description="Number of incorrect attempts made")
    completion_time_seconds: Optional[int] = Field(None, ge=0, description="Time taken in seconds")
    answers_payload: Optional[Dict[str, Any]] = Field(default={}, description="Raw user answer data")


class BadgeUnlockedItem(BaseModel):
    badge_key: str
    badge_title: str
    badge_description: Optional[str]
    icon_symbol: str = "🏆"


class DrillSubmissionResponse(BaseModel):
    progress_id: str
    completed: bool = True
    base_xp: int
    penalty_applied: int
    earned_xp: int
    streak_multiplier: float
    total_xp: int
    current_streak_days: int
    sprint_completed: bool = False
    next_sprint_unlocked: bool = False
    new_badges_unlocked: List[BadgeUnlockedItem] = []
