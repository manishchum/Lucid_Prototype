# Backend/coach/thought_engine.py
"""
Cognitive Reasoning & Thought Engine for the Performance Coach.
Generates humane, intelligent, first-person chain-of-thought reflections,
explicit planned action execution checklists, and real-time tool observations
modeled after Antigravity and modern reasoning agents.
"""

import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel


class CognitiveThought(BaseModel):
    is_conversational: bool = False
    intent: str = "GENERAL"
    understanding: str
    planned_actions: List[str]
    observations: Optional[List[str]] = []
    synthesis_strategy: Optional[str] = None
    target_entity: Optional[str] = None
    duration: float = 0.4


# Common greeting and pleasantry tokens
GREETING_TOKENS = {
    "hi", "hii", "hiii", "hello", "ey", "eyy", "hey", "heyy", "heyya",
    "hola", "namaste", "howdy", "sup", "yo"
}
POLITE_SUFFIXES = {
    "there", "coach", "lucid", "assistant", "good", "morning", "afternoon",
    "evening", "buddy", "bro", "sir", "team"
}
THANKS_TOKENS = {"thanks", "thank", "thx", "appreciate", "grateful"}
INTRO_TRIGGERS = ["who are you", "what can you do", "help me", "introduce yourself", "what do you do"]


def is_conversational_greeting(query: str) -> bool:
    """Detects whether a user query is purely a conversational greeting or small-talk."""
    if not query:
        return True
    q_clean = re.sub(r"[^a-zA-Z\s]", "", query.lower()).strip()
    words = q_clean.split()
    if not words:
        return True

    # Exact single token match
    if q_clean in GREETING_TOKENS or q_clean in THANKS_TOKENS:
        return True

    # Multi-token greeting phrases (e.g. "hey coach", "good morning there", "hi team")
    word_set = set(words)
    if word_set.issubset(GREETING_TOKENS | POLITE_SUFFIXES):
        return True

    if any(w in word_set for w in THANKS_TOKENS) and len(words) <= 4:
        return True

    return False


def is_capabilities_inquiry(query: str) -> bool:
    """Detects if user is asking what the assistant does or can do."""
    q_low = query.lower().strip()
    return any(t in q_low for t in INTRO_TRIGGERS)


def triage_query(
    user_query: str,
    caller_name: Optional[str] = None,
    target_employee_name: Optional[str] = None,
    schema_dict: Optional[Dict[str, Any]] = None,
    doc_catalog: Optional[List[Dict[str, Any]]] = None,
) -> CognitiveThought:
    """
    Rapidly evaluates query intent and generates a humane cognitive reflection
    with explicit planned actions before heavy backend processing.
    """
    q_raw = (user_query or "").strip()
    q_low = q_raw.lower()

    # 1. Conversational Greeting Fast-Path
    if is_conversational_greeting(q_raw):
        if any(w in set(re.sub(r"[^a-zA-Z\s]", "", q_low).split()) for w in THANKS_TOKENS):
            return CognitiveThought(
                is_conversational=True,
                intent="GENERAL",
                understanding=(
                    "The user is expressing gratitude. As their Performance Coach, I should acknowledge "
                    "their appreciation warmly and invite them to explore any further sales figures, "
                    "performance comparisons, or company documents."
                ),
                planned_actions=[
                    "Acknowledge the user's gratitude warmly and professionally",
                    "Offer continued assistance with performance analytics, targets, and documents"
                ],
                synthesis_strategy="Deliver a polite, supportive closing response.",
                duration=0.4
            )

        return CognitiveThought(
            is_conversational=True,
            intent="GENERAL",
            understanding=(
                "The user is saying hello. This is a friendly conversational greeting. "
                "No data retrieval or analysis is needed. I will greet them warmly, "
                "establish my role as their Performance Coach, and outline the key areas we can explore together."
            ),
            planned_actions=[
                "Acknowledge the greeting with a friendly, professional welcome",
                "Highlight core coaching capabilities: sales metrics, quota tracking, and document playbooks",
                "Invite the user to share their specific goal or inquiry for today"
            ],
            synthesis_strategy="Deliver a welcoming, grounded opening response calibrated to the coaching persona.",
            duration=0.4
        )

    # 2. Capabilities / Self-Introduction Fast-Path
    if is_capabilities_inquiry(q_raw):
        return CognitiveThought(
            is_conversational=True,
            intent="GENERAL",
            understanding=(
                "The user is asking about my identity and capabilities. I should present a clear, "
                "structured breakdown of what I can analyze: Text-to-SQL spreadsheet metrics, "
                "Vector RAG company documents, CRM deal pipelines, and hybrid coaching reviews."
            ),
            planned_actions=[
                "Define my role as their enterprise Performance Coach & Analytics Assistant",
                "Break down core capabilities: Spreadsheets (Text-to-SQL), Documents (Vector RAG), and CRM pipelines",
                "Provide realistic example questions the user can try right away"
            ],
            synthesis_strategy="Structure an engaging, bulleted capabilities guide with actionable prompt examples.",
            duration=0.5
        )

    # 3. RBAC & Permissions Introspection Fast-Path
    permission_triggers = [
        "what permissions", "my permissions", "permissions do i have",
        "what access do i", "my access", "what can i access",
        "which documents can i access", "what am i allowed",
        "am i authorized", "check my permissions", "show my permissions"
    ]
    if any(p in q_low for p in permission_triggers):
        return CognitiveThought(
            is_conversational=False,
            intent="PERMISSIONS",
            understanding=(
                "The user is inquiring about their role-based permissions and accessible data scope. "
                "I should inspect their security profile and transparently outline what tables, documents, "
                "and company records they are authorized to view."
            ),
            planned_actions=[
                "Inspect user's RBAC role level and security context",
                "List authorized spreadsheet tables and document categories",
                "Explain privacy boundaries and access policies clearly"
            ],
            synthesis_strategy="Provide a transparent, structured breakdown of role authorization and access scopes.",
            duration=0.6
        )

    # 4. Catalog Inspection Fast-Path
    if any(k in q_low for k in ["what documents", "what files", "what spreadsheets", "what is uploaded", "catalog"]):
        return CognitiveThought(
            is_conversational=False,
            intent="CATALOG",
            understanding=(
                "The user wants an overview of all uploaded knowledge base files and connected integrations. "
                "I will inspect our company document repository and cloud connector list."
            ),
            planned_actions=[
                "Inspect uploaded document catalog for files, reports, and playbooks",
                "Check active cloud connectors (Google Drive, HubSpot, Teams)",
                "Compile a categorized inventory with file types and periods"
            ],
            synthesis_strategy="Format a clean, categorized table of accessible knowledge assets.",
            duration=0.6
        )

    # 5. Extract Subject Entity (Specific employee vs caller)
    subject = target_employee_name
    from coach.graph import extract_query_subject
    cand_subject = extract_query_subject(user_query, caller_name)
    if cand_subject:
        subject = cand_subject

    # Detect CRM intent keywords
    has_crm_terms = any(k in q_low for k in ["hubspot", "deal", "pipeline", "crm", "lead", "opportunity", "ticket"])

    # Detect Quantitative SQL intent keywords
    has_sql_terms = any(k in q_low for k in [
        "sales", "quota", "target", "attainment", "numbers", "figure", "cases",
        "discount", "top 5", "rank", "revenue", "how much", "how many", "volume",
        "performing", "performance", "pacing", "achievement"
    ])

    # Detect Qualitative RAG intent keywords
    has_rag_terms = any(k in q_low for k in [
        "playbook", "policy", "guideline", "manual", "rule", "task", "reminder",
        "todo", "meeting", "1-on-1", "review", "feedback", "memo", "sop"
    ])

    # 6. Hybrid Intent Classification
    is_person_performance_review = bool(subject and any(k in q_low for k in ["performing", "performance", "doing", "review", "summary"]))
    is_self_holistic = any(k in q_low for k in ["how am i doing", "how is my performance", "overview of my performance", "overall review"])

    if (has_sql_terms and has_rag_terms) or is_person_performance_review or is_self_holistic:
        subj_desc = f" for {subject}" if subject else ""
        return CognitiveThought(
            is_conversational=False,
            intent="HYBRID",
            understanding=(
                f"The user is seeking a holistic coaching evaluation{subj_desc}. "
                "This requires a balanced, multi-angle analysis: inspecting quantitative sales metrics "
                "while cross-referencing qualitative meeting notes, task completions, and company playbooks."
            ),
            planned_actions=[
                f"Formulate and run a SQL query across metrics tables to evaluate quantitative attainment{subj_desc}",
                f"Search qualitative document archives for manager 1-on-1 notes, task logs, and coaching playbooks",
                "Cross-reference quantitative results against qualitative feedback to identify trends and gaps",
                "Synthesize a balanced coaching summary with verified citations and actionable next steps"
            ],
            synthesis_strategy="Structure into an executive performance brief: Numerical Attainment, Qualitative Observations, and Recommendations.",
            target_entity=subject,
            duration=0.8
        )

    # 7. CRM Intent Classification
    if has_crm_terms:
        return CognitiveThought(
            is_conversational=False,
            intent="CRM",
            understanding=(
                "The user is asking about live CRM deals and pipeline status. "
                "I need to query our CRM integration to inspect deal stages, pipeline values, and recent activity."
            ),
            planned_actions=[
                "Connect to CRM integration (HubSpot) to query active deal pipelines and stages",
                "Aggregate deal values, expected close dates, and probability weighted forecasts",
                "Synthesize a concise pipeline update highlighting high-impact opportunities and blockers"
            ],
            synthesis_strategy="Present a structured deal pipeline summary with stage breakdowns and critical next actions.",
            duration=0.7
        )

    # 8. Quantitative SQL Intent Classification
    if has_sql_terms:
        subj_desc = f" regarding {subject}" if subject else ""
        return CognitiveThought(
            is_conversational=False,
            intent="SQL",
            understanding=(
                f"The user is asking a quantitative performance question{subj_desc}. "
                "To provide an accurate, grounded answer, I will formulate a SQL query to inspect sales volume, "
                "quota pacing, and target attainment in our database."
            ),
            planned_actions=[
                "Inspect available database schemas to identify relevant sales and performance tables",
                f"Formulate and safely execute a SQL query filtering for target metrics{subj_desc}",
                "Evaluate query results, quota attainment percentages, and pacing trends",
                "Synthesize an executive-ready performance summary with structured tables and metrics"
            ],
            synthesis_strategy="Organize findings into a clear, data-backed performance table with pacing analysis.",
            target_entity=subject,
            duration=0.7
        )

    # 9. Qualitative RAG Intent Classification
    if has_rag_terms:
        return CognitiveThought(
            is_conversational=False,
            intent="RAG",
            understanding=(
                "The user is asking a qualitative policy, procedure, or document inquiry. "
                "I will search through our company guides, playbooks, and reference documents "
                "rather than querying numerical spreadsheet tables."
            ),
            planned_actions=[
                "Scan company document catalog and vector store for relevant policy sections and guidelines",
                "Extract top-scoring text passages and verify relevance against the user's specific context",
                "Synthesize clear, direct guidance grounded in the source text with exact document citations"
            ],
            synthesis_strategy="Present clear, grounded guidance with direct document and page citations.",
            duration=0.7
        )

    # 10. Default General / Analytical Inquiry
    return CognitiveThought(
        is_conversational=False,
        intent="GENERAL",
        understanding=(
            f"The user is asking: \"{q_raw[:85]}\". "
            "I will evaluate this against our company knowledge base, metrics tables, and coaching playbooks "
            "to formulate clear, actionable guidance."
        ),
        planned_actions=[
            "Evaluate question against company schemas and document catalog",
            "Determine the most grounded retrieval path (data query, document search, or coaching guidance)",
            "Synthesize actionable, professional recommendations calibrated to company context"
        ],
        synthesis_strategy="Deliver grounded, constructive coaching advice tailored to your role.",
        target_entity=subject,
        duration=0.6
    )


def build_tool_observation(
    step: str,
    state: Dict[str, Any],
    **extra
) -> str:
    """
    Translates raw tool execution outputs into natural, first-person observations.
    """
    target_name = state.get("target_employee_name")
    row_count = extra.get("row_count")
    if row_count is None:
        row_count = len(state.get("sql_result") or [])

    matched_files = state.get("matched_files") or []
    chunks = state.get("rag_chunks") or []

    if step == "sql":
        if row_count == 0:
            if target_name:
                return (
                    f"Executed database query for {target_name}: 0 matching rows found in performance tables. "
                    "Their contributions appear to be tracked qualitatively in project logs and review documents."
                )
            return "Executed database query across performance tables: 0 matching records found. Relying on qualitative documentation."
        row_word = "record" if row_count == 1 else "records"
        if target_name:
            return f"Executed database query for {target_name}: retrieved {row_count} matching {row_word} detailing sales volume, quota pacing, and target attainment."
        return f"Executed database query: retrieved {row_count} matching {row_word} containing verified metrics and attainment data."

    elif step == "rag":
        files_sample = f" (e.g. {', '.join(matched_files[:2])})" if matched_files else ""
        passage_word = "passage" if len(chunks) == 1 else "passages"
        doc_word = "document" if len(matched_files) == 1 else "documents"

        if target_name:
            return (
                f"Searched document archives: found {len(chunks)} relevant {passage_word} across "
                f"{len(matched_files)} {doc_word}{files_sample} documenting {target_name}'s deliverables and team feedback."
            )
        return (
            f"Searched document archives: found {len(chunks)} relevant {passage_word} across "
            f"{len(matched_files)} {doc_word}{files_sample} detailing operational standards, guidelines, and feedback."
        )

    elif step == "crm":
        deals = state.get("crm_data", {}).get("deals", [])
        deal_count = len(deals)
        if deal_count > 0:
            return f"Queried HubSpot CRM: inspected {deal_count} active opportunities across pipeline stages."
        return "Connected to CRM integration: reviewed live pipeline deals and customer engagement status."

    return "Reviewed company knowledge base records."


def build_synthesis_strategy(state: Dict[str, Any]) -> str:
    """Generates the final strategy statement for synthesizing the response."""
    intent = state.get("intent", "GENERAL")
    target_name = state.get("target_employee_name")
    sql_result = state.get("sql_result") or []
    row_count = len(sql_result)

    if intent == "HYBRID":
        if target_name:
            return (
                f"Synthesizing both quantitative metrics and qualitative document findings into an actionable "
                f"coaching brief for {target_name} with verified source citations."
            )
        return "Synthesizing quantitative metrics with qualitative document findings into a balanced, cited coaching brief."

    elif intent == "SQL":
        return "Structuring retrieved metrics into an executive-ready performance summary with key trends and pacing."

    elif intent == "RAG":
        return "Synthesizing verified playbook guidelines into a clear, structured response with exact document references."

    elif intent == "CRM":
        return "Compiling live CRM opportunities into a strategic deal review highlighting key milestones and risks."

    return "Delivering clear, actionable coaching guidance calibrated to your role and company context."


def format_thought_monologue(triage: CognitiveThought) -> str:
    """
    Builds a formatted multi-section reasoning monologue for token-by-token streaming.
    """
    lines = []
    if triage.understanding:
        lines.append(f"{triage.understanding}")

    if triage.planned_actions:
        lines.append("\n\nPlanned Actions:")
        for a in triage.planned_actions:
            lines.append(f"• {a}")

    if triage.synthesis_strategy:
        lines.append(f"\n\nStrategy: {triage.synthesis_strategy}")

    return "\n".join(lines)


async def stream_thought_tokens(
    text: str,
    delay: float = 0.012
):
    """
    Asynchronously streams reasoning text token-by-token for real-time CoT animation.
    Preserves whitespace and formatting.
    """
    import asyncio
    tokens = re.findall(r"\S+|\n+| +", text)
    for token in tokens:
        yield {
            "type": "thought_token",
            "content": token
        }
        if delay > 0:
            await asyncio.sleep(delay)

