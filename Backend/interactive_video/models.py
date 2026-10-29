"""
Pydantic models for the Interactive Video Course Pipeline.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import uuid


# ---------------------------------------------------------------------------
# Quiz / Simulation sub-models
# ---------------------------------------------------------------------------

class QuizQuestion(BaseModel):
    id: str = Field(default_factory=lambda: f"q_{uuid.uuid4().hex[:8]}")
    text: str
    options: List[str]          # 4 options, A/B/C/D
    correct: int                # 0-indexed correct option index
    explanation: str            # Why this answer is correct
    segment_ref: str            # Which segment this question tests


class Quiz(BaseModel):
    questions: List[QuizQuestion]
    pass_threshold: float = 0.8    # 80% correct to pass
    max_attempts: int = 2          # Max wrong attempts before replay
    on_fail: str = "replay_segment"
    replay_segment_id: Optional[str] = None


class SimulationStep(BaseModel):
    screenshot_url: str
    instruction: str
    hotspot: Optional[Dict[str, float]] = None   # {x, y, w, h} in px
    highlight_text: Optional[str] = None


class Simulation(BaseModel):
    steps: List[SimulationStep]
    title: str = "Try It Yourself"


# ---------------------------------------------------------------------------
# Subtitle cue
# ---------------------------------------------------------------------------

class SubtitleCue(BaseModel):
    start: float    # seconds
    end: float      # seconds
    text: str


# ---------------------------------------------------------------------------
class ModuleImage(BaseModel):
    url: str
    storage_path: Optional[str] = None
    caption: Optional[str] = ""
    surrounding_text: Optional[str] = ""
    chunk_id: Optional[str] = None
    source_type: Optional[str] = None


class ParsedDocumentContext(BaseModel):
    processed_module_id: str
    original_module_id: Optional[str] = None
    module_title: str
    clean_content: str
    headings: List[str] = []
    word_count: int = 0
    estimated_duration_minutes: float = 0.0
    company_id: str
    company_name: str
    company_logo: Optional[str] = None
    uploaded_by: Optional[str] = None
    images: List[ModuleImage] = []
    subscription_addons: List[str] = []


# ---------------------------------------------------------------------------
# Segment
# ---------------------------------------------------------------------------

class Segment(BaseModel):
    id: str = Field(default_factory=lambda: f"seg_{uuid.uuid4().hex[:8]}")
    title: str
    type: str = "lecture"      # "lecture" | "quiz_gate" | "simulation"
    order: int = 0

    # Lecture / video fields
    video_url_en: Optional[str] = None
    video_url_hi: Optional[str] = None
    video_en_path: Optional[str] = None
    video_hi_path: Optional[str] = None
    # Audio / narration fields
    audio_en_path: Optional[str] = None
    audio_hi_path: Optional[str] = None
    duration_en: float = 0.0
    duration_hi: float = 0.0
    subtitles_en: List[SubtitleCue] = []
    subtitles_hi: List[SubtitleCue] = []
    duration: float = 0.0          # seconds

    # Slide content (rendered to video)
    script_en: Optional[str] = None
    script_hi: Optional[str] = None
    slide_bullets: List[str] = []
    key_takeaway: Optional[str] = None
    visual_prompt: Optional[str] = None
    matched_image_url: Optional[str] = None
    slide_image_path: Optional[str] = None

    # Quiz gate
    quiz: Optional[Quiz] = None

    # Simulation
    simulation: Optional[Simulation] = None


# ---------------------------------------------------------------------------
# Course Manifest
# ---------------------------------------------------------------------------

class CourseManifest(BaseModel):
    course_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    processed_module_id: str
    title: str
    description: str = ""
    segments: List[Segment] = []
    total_segments: int = 0
    quiz_gates: int = 0
    estimated_duration_minutes: float = 0.0
    final_video_en_path: Optional[str] = None
    final_video_hi_path: Optional[str] = None
    video_url: Optional[str] = None
    video_url_hinglish: Optional[str] = None
    created_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Job models
# ---------------------------------------------------------------------------

class StartJobRequest(BaseModel):
    processed_module_id: str
    force_regenerate: bool = False   # if True, overwrites existing


class JobStatus(BaseModel):
    job_id: str
    processed_module_id: str
    status: str
    current_worker: int
    worker_name: str
    error: Optional[str] = None
    course_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Quiz attempt tracking (stored in module_progress)
# ---------------------------------------------------------------------------

class QuizAttempt(BaseModel):
    segment_id: str
    question_id: str
    chosen_index: int
    is_correct: bool
    attempt_number: int


class SubmitQuizRequest(BaseModel):
    processed_module_id: str
    segment_id: str
    answers: List[Dict[str, Any]]   # [{question_id, chosen_index}]


class QuizResult(BaseModel):
    segment_id: str
    total_questions: int
    correct: int
    score: float                 # 0.0 - 1.0
    passed: bool
    attempt_number: int
    should_replay: bool
    replay_segment_id: Optional[str] = None
    feedback: List[Dict[str, Any]] = []   # per-question feedback
