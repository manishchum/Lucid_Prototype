from datetime import date
from typing import List, Optional, Literal

from pydantic import BaseModel, Field
from typing import Union

class QuizQuestion(BaseModel):
    id: str
    question: str
    type: Literal[
        "single",
        "multiple",
        "written"
    ] = "single"
    options: List[str] = []
    correctAnswer: Optional[str] = None
    correctAnswers: List[str] = []
    writtenAnswer: Optional[str] = None


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=5)
    description: Optional[str] = None
    submission_format: Union[str, List[str]]
    questions: Optional[List[QuizQuestion]] = []
    level: str
    target_module_id: Optional[str] = None
    target_function_id: Optional[str] = None
    target_sub_function_id: Optional[str] = None
    target_user_ids: Optional[List[str]] = []
    due_date: date
    recurrence: str = "none"
    created_by: Optional[str] = None


class TaskResponse(BaseModel):
    task_id: str
    assignment_id: str
    company_id: str
    title: str
    description: Optional[str]
    submission_format: List[str]
    questions: List[dict]
    status: str
    due_date: str
    recurrence: str
    level: str
    audience_display_name: str
    total_target_count: int
    completion_count: int
    created_at: str
    submitted: Optional[bool] = False
    submission: Optional[dict] = None


class TaskListResponse(BaseModel):
    tasks: List[TaskResponse]
    total: int

class SubmissionCreate(BaseModel):
    # ids
    task_id: str
    user_id: str
    assignment_id: Optional[str] = None

    # text/image/audio/video/quiz
    submission_type: Literal[
        "text",
        "image",
        "audio",
        "video",
        "multiple_choice"
    ]

    # submission data
    text_response: Optional[str] = None

    image_url: Optional[str] = None

    audio_url: Optional[str] = None

    video_url: Optional[str] = None


    # quiz answers
    answers: Optional[List[dict]] = []


    # AI evaluation result
    score: Optional[int] = None

    max_score: Optional[int] = None

    ai_validation_pass: Optional[bool] = None

    ai_validation_verdict: Optional[str] = None

    ai_validation_reason: Optional[str] = None

    ai_validation_suggestion: Optional[str] = None

    ai_validation_confidence: Optional[
        Literal[
            "high",
            "medium",
            "low"
        ]
    ] = None


    status: str = "submitted"

    ai_status: Optional[str] = None


class TaskReassignPayload(BaseModel):
    original_assignment_id: str
    mode: Literal["modify", "copy"]
    level: str
    target_sprints: Optional[List[str]] = []
    target_orgs: Optional[List[str]] = []
    target_functions: Optional[List[str]] = []
    target_sub_functions: Optional[List[str]] = []
    target_individuals: Optional[List[str]] = []
    due_date: date
    recurrence: str = "none"
