# Backend/coach/guardrails.py
"""
Enterprise Guardrails Engine for the Performance Coach Intelligence Layer.
Powered by Guardrails AI (guardrails-ai) with local execution speed (< 5ms).

Validators Included:
  1. CrisisSafetyValidator: Intercepts suicide & self-harm with compassionate crisis redirection.
  2. HarmfulViolenceValidator: Blocks requests involving weapons, poisons, and physical violence.
  3. DatabaseSecurityValidator: Rejects destructive SQL operations (DELETE, DROP, TRUNCATE, ALTER).
  4. PromptInjectionValidator: Blocks attempts to override instructions or dump internal system prompts.
  5. TopicScopeValidator: Intercepts all off-topic domains (culinary recipes like "gulab jamun",
     sports scores, celebrity gossip, weather, creative poems, jokes, and gaming).

Easily extensible via Guardrails AI's Guard pipeline and the CUSTOM_RULES list.
"""

import os
import re
import logging
from typing import Optional, Dict, Any, List

# Completely disable OpenTelemetry and Guardrails AI remote telemetry
# to eliminate network latency, timeouts, and exporter error logs
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["GUARDRAILS_DISABLE_TRACING"] = "true"
os.environ["GUARDRAILS_ENABLE_METRICS"] = "false"

logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)
logging.getLogger("opentelemetry.exporter.otlp").setLevel(logging.CRITICAL)

# Try importing Guardrails AI framework
try:
    import guardrails
    from guardrails import Guard, Validator, register_validator
    from guardrails_ai.types import PassResult, FailResult
    from guardrails.settings import settings
    settings.disable_tracing = True
    if hasattr(settings, "rc") and settings.rc:
        settings.rc.enable_metrics = False
        settings.rc.use_remote_inferencing = False
    GUARDRAILS_AI_AVAILABLE = True
except Exception:
    try:
        from guardrails import Guard
        from guardrails.validator_base import Validator, register_validator
        from guardrails_ai.types import PassResult, FailResult
        from guardrails.settings import settings
        settings.disable_tracing = True
        if hasattr(settings, "rc") and settings.rc:
            settings.rc.enable_metrics = False
            settings.rc.use_remote_inferencing = False
        GUARDRAILS_AI_AVAILABLE = True
    except Exception:
        GUARDRAILS_AI_AVAILABLE = False
        Validator = object
        PassResult = None
        FailResult = None
        def register_validator(*args, **kwargs):
            def dec(c):
                return c
            return dec


# ============================================================================
# 1. CRISIS & SELF-HARM CONFIGURATION
# ============================================================================
CRISIS_PATTERNS = [
    r"\bsuicide\b",
    r"\bkill\s+(myself|me)\b",
    r"\bend\s+my\s+life\b",
    r"\bwant\s+to\s+die\b",
    r"\bhang\s+myself\b",
    r"\bslit\s+(my\s+)?wrist",
    r"\bjump(ing)?\s+from\s+(\d+|the|a)?\s*(th|st|nd|rd)?\s*(floor|building|bridge|roof|balcony)",
    r"\b(eat|take|drink|mix(ing)?)\s+(rat\s+)?poison\b",
    r"\boverdose\b",
    r"\bharm(ing)?\s+myself\b",
    r"\bgood\s*bye\b.*\bjump(ing)?\b",
]

CRISIS_RESPONSE = (
    "I'm really sorry to hear that you're going through this, but I cannot assist with this request. "
    "Please know that you are not alone and compassionate support is available right now:\n\n"
    "• **National Crisis Lifeline (US/Canada):** Call or Text **988**\n"
    "• **Tele-MANAS (India):** Call **14416** or **1800-891-4416** (Toll-Free, 24/7)\n"
    "• **Vandrevala Foundation Helpline:** Call **+91 9999 666 555**\n"
    "• **Emergency Services:** Please call your local emergency number (**112** / **911**) immediately.\n\n"
    "Please reach out to a trusted family member, colleague, or healthcare professional who can support you."
)


# ============================================================================
# 2. HARMFUL & VIOLENT ACTIONS (POISONING OTHERS, WEAPONS, ILLEGAL ACTS)
# ============================================================================
HARMFUL_PATTERNS = [
    r"\b(make|making|create|prepare)\s+.*poison\b",
    r"\bpoison\s+.*(my|the|someone|family|people|others)\b",
    r"\bgive\s+.*poison\b",
    r"\b(make|build|construct)\s+(a\s+)?bomb\b",
    r"\bkill\s+(someone|others|my\s+boss|people|my\s+family)\b",
    r"\bhow\s+to\s+(hack|attack|ddos|steal)\b",
    r"\bweapon\s+creation\b",
    r"\bcommit\s+(a\s+)?murder\b",
]

HARMFUL_RESPONSE = (
    "I cannot assist with requests involving violence, physical harm, weapons, or illegal activities. "
    "As your company's AI Performance Coach, I am dedicated strictly to workplace metrics, sales coaching, "
    "and professional development."
)


# ============================================================================
# 3. DATABASE MUTATION & DELETION REQUESTS (READ-ONLY SECURITY)
# ============================================================================
MUTATION_PATTERNS = [
    r"\bdelete\s+.*(everything|all|rows|data|records|tables?|database|spreadsheet)\b",
    r"\b(delete|drop|wipe|erase|clear|purge|remove)\s+.*(coach_spreadsheet|coach_document|database|tables?|spreadsheet\s+rows|all\s+rows)\b",
    r"\bdelete\s+from\s+[a-zA-Z_0-9]+",
    r"\bdrop\s+(table|database|schema)\b",
    r"\btruncate\s+(table|database)\b",
    r"\bwipe\s+(the\s+|all\s+)?(database|tables?|data)\b",
    r"\berase\s+(the\s+|all\s+)?(database|tables?|data)\b",
    r"\balter\s+table\b",
    r"\bupdate\s+[a-zA-Z_0-9]+\s+set\b",
]

MUTATION_RESPONSE = (
    "I am a **strictly read-only** Performance Coach analytics system. "
    "I do not possess the permission or capability to delete, modify, drop, or alter database tables, "
    "spreadsheet records, or cloud storage files.\n\n"
    "If you need to manage, purge, or upload datasets, please use the **Admin Ingestion Console** or "
    "contact your company database administrator."
)


# ============================================================================
# 4. OFF-TOPIC CREATIVE, CULINARY, ENTERTAINMENT & TRIVIA SCOPE DEFLECTION
# ============================================================================
OFF_TOPIC_PATTERNS = [
    # Culinary Recipes & Food preparation (e.g. "recipe of gulab jamun", "recipe fo pasta", "how to cook pasta")
    r"\brecipes?\b",
    r"\b(how\s+to\s+)?(cook|bake|fry|boil|prepare|make)\s+.*(cake|pasta|biryani|gulab\s+jamun|pizza|curry|dish|food|dessert|tea|coffee|cocktail|noodles|sandwich|burger|soup|salad)",
    r"\b(cake|pasta|biryani|gulab\s+jamun|pizza|curry|noodles|sandwich|burger)\s+recipes?\b",
    r"\bingredients?\s+(of|for|in)\s+(cake|pasta|biryani|gulab\s+jamun|pizza|curry|food|dish)",
    
    # Academic Math, Science & School Homework (e.g. "formula of sin theta", "help with trigonometry")
    r"\b(formula|formaula|equation|theorem)\s+(of|for)\s+[a-zA-Z0-9_\s]+",
    r"\b(sin|cos|tan|cot|sec|cosec)\s*(theta|\(\w+\)|\d+)",
    r"\b(trigonometry|trignosmetry|calculus|pythagoras|photosynthesis|algebra\s+problem|solve\s+for\s+x|homework\s+help)\b",
    
    # Movies, Cinema, TV Series & Comics (e.g. "summary of movie the sky is pink", "spiderman or marvel")
    r"\b(summary|plot|story|review|climax|ending|cast)\s+(of\s+)?(the\s+)?(movie|film|series|show|cinema)\b",
    r"\bmovie\b",
    r"\b(spiderman|marvel|mavel|batman|superman|avengers|iron\s*man|anime|naruto|dc\s+comics)\b",
    
    # Consumer Shopping & Brand Comparisons (e.g. "which is better ajio or amazon or flipkart")
    r"\b(which|who)\s+is\s+better\s+.*(ajio|amazon|flipkart|myntra|zomato|swiggy|uber|ola)\b",
    r"\b(ajio|amazon|flipkart|myntra)\s+(vs|or)\s+(ajio|amazon|flipkart|myntra)\b",

    # Creative writing: Poems, songs, fiction, jokes
    r"\b(write|create|compose)\s+(a\s+)?(poem|poetry|song|lyrics|story|bedtime\s+story|novel)\b",
    r"\bpoem\s+(on|about)\s+[a-zA-Z]+",
    r"\b(write|compose)\s+(a\s+)?song\b",
    r"\b(write|tell)\s+(a\s+)?story\b",
    r"\bbedtime\s+story\b",
    r"\b(tell|write)\s+(me\s+)?a\s+joke\b",
    r"\bwrite\s+code\s+for\s+(flappy\s+bird|snake\s+game|tic\s*tac\s*toe|game)\b",
    
    # Sports scores & tournament trivia
    r"\b(who|which\s+team)\s+won\s+the\s+(world\s+cup|ipl|super\s*bowl|fifa|olympics|championship)\b",
    r"\b(cricket|football|nba|tennis|soccer)\s+(match|score|tournament)\b",
    
    # Weather forecasts
    r"\b(what('s|\s+is)\s+the\s+)?weather\s+in\s+[a-zA-Z]+",
    r"\btemperature\s+in\s+[a-zA-Z]+",
    
    # General celebrity gossip / Hollywood
    r"\bwho\s+is\s+(dating|married\s+to)\s+[a-zA-Z]+",
]

OFF_TOPIC_RESPONSE = (
    "I am your company's **AI Performance Coach**, designed specifically to analyze team metrics, "
    "sales targets, commission policies, and workplace performance.\n\n"
    "I do not answer questions regarding culinary recipes, academic homework/math, movies/entertainment, sports, shopping comparisons, or external trivia. "
    "Please feel free to ask about your team's KPI reports, case performance, incentives, or uploaded company documents!"
)


# ============================================================================
# 5. PROMPT INJECTION & SYSTEM INSTRUCTION LEAKS
# ============================================================================
INJECTION_PATTERNS = [
    r"\b(you\s+)?(ignore|disregard|forget|bypass|override|drop|cancel)\s+.*(prompt|instruction|rules|system|guardrail)",
    r"\b(ignore|disregard|forget|bypass|override)\s+(all|your|the|any|previous|prior|system|above)\b",
    r"\b(reveal|output|display|show|dump|print)\s+.*(system\s+prompt|instructions?|initial\s+prompt|developer\s+message)\b",
    r"\bwhat\s+(is|are)\s+(your\s+)?(system\s+prompt|initial\s+instructions?)\b",
    r"\brepeat\s+(all\s+)?(the\s+)?words\s+above\b",
    r"\bact\s+as\s+(dan|developer\s+mode|unrestricted|jailbreak)\b",
    r"\bjailbreak\b",
    r"\bdump\s+(database\s+)?credentials\b",
]

INJECTION_RESPONSE = (
    "I cannot comply with requests to override system instructions, bypass security boundaries, "
    "or reveal internal system prompts."
)


# ============================================================================
# 6. USER CUSTOM RULES (EASILY EXTENSIBLE)
# ============================================================================
CUSTOM_RULES: List[Dict[str, Any]] = [
    # Add your own custom patterns here as you discover them:
    # {
    #     "pattern": r"\bcompetitor\s+(pricing|strategy)\b",
    #     "intent": "CUSTOM_GUARDRAIL",
    #     "response": "Competitor pricing analysis is not permitted."
    # }
]


# ============================================================================
# 7. GUARDRAILS AI NATIVE VALIDATORS & PIPELINE (IF GUARDRAILS-AI INSTALLED)
# ============================================================================
coach_guard: Optional[Any] = None

VALIDATOR_META: Dict[str, Dict[str, str]] = {
    "CrisisSafetyValidator": {
        "guardrail": "CRISIS_SAFETY",
        "intent": "SAFETY",
        "routing_reason": "Triggered Guardrails AI CrisisSafetyValidator.",
    },
    "lucid/crisis_safety": {
        "guardrail": "CRISIS_SAFETY",
        "intent": "SAFETY",
        "routing_reason": "Triggered Guardrails AI CrisisSafetyValidator.",
    },
    "HarmfulViolenceValidator": {
        "guardrail": "HARMFUL_VIOLENCE",
        "intent": "SAFETY",
        "routing_reason": "Triggered Guardrails AI HarmfulViolenceValidator.",
    },
    "lucid/harmful_violence": {
        "guardrail": "HARMFUL_VIOLENCE",
        "intent": "SAFETY",
        "routing_reason": "Triggered Guardrails AI HarmfulViolenceValidator.",
    },
    "DatabaseSecurityValidator": {
        "guardrail": "DATABASE_SECURITY",
        "intent": "SECURITY",
        "routing_reason": "Triggered Guardrails AI DatabaseSecurityValidator.",
    },
    "lucid/database_security": {
        "guardrail": "DATABASE_SECURITY",
        "intent": "SECURITY",
        "routing_reason": "Triggered Guardrails AI DatabaseSecurityValidator.",
    },
    "PromptInjectionValidator": {
        "guardrail": "PROMPT_INJECTION",
        "intent": "SECURITY",
        "routing_reason": "Triggered Guardrails AI PromptInjectionValidator.",
    },
    "lucid/prompt_injection": {
        "guardrail": "PROMPT_INJECTION",
        "intent": "SECURITY",
        "routing_reason": "Triggered Guardrails AI PromptInjectionValidator.",
    },
    "TopicScopeValidator": {
        "guardrail": "OFF_TOPIC_SCOPE",
        "intent": "SCOPE_DEFLECTION",
        "routing_reason": "Triggered Guardrails AI TopicScopeValidator.",
    },
    "lucid/topic_scope": {
        "guardrail": "OFF_TOPIC_SCOPE",
        "intent": "SCOPE_DEFLECTION",
        "routing_reason": "Triggered Guardrails AI TopicScopeValidator.",
    },
}

if GUARDRAILS_AI_AVAILABLE:
    try:
        @register_validator(name="lucid/crisis_safety", data_type="string")
        class CrisisSafetyValidator(Validator):
            """Guardrails AI Validator: Immediate mental health & crisis intervention."""
            def __init__(self, on_fail: str = "noop", **kwargs):
                super().__init__(on_fail=on_fail, **kwargs)

            def validate(self, value: Any, metadata: Dict = {}) -> Any:
                text = str(value).lower()
                for pattern in CRISIS_PATTERNS:
                    if re.search(pattern, text):
                        return FailResult(
                            error_message=CRISIS_RESPONSE,
                            fix_value=None
                        )
                return PassResult()

        @register_validator(name="lucid/harmful_violence", data_type="string")
        class HarmfulViolenceValidator(Validator):
            """Guardrails AI Validator: Intercepts weapons, poisons, and physical violence."""
            def __init__(self, on_fail: str = "noop", **kwargs):
                super().__init__(on_fail=on_fail, **kwargs)

            def validate(self, value: Any, metadata: Dict = {}) -> Any:
                text = str(value).lower()
                for pattern in HARMFUL_PATTERNS:
                    if re.search(pattern, text):
                        return FailResult(
                            error_message=HARMFUL_RESPONSE,
                            fix_value=None
                        )
                return PassResult()

        @register_validator(name="lucid/database_security", data_type="string")
        class DatabaseSecurityValidator(Validator):
            """Guardrails AI Validator: Prevents destructive SQL / DB mutations."""
            def __init__(self, on_fail: str = "noop", **kwargs):
                super().__init__(on_fail=on_fail, **kwargs)

            def validate(self, value: Any, metadata: Dict = {}) -> Any:
                text = str(value).lower()
                for pattern in MUTATION_PATTERNS:
                    if re.search(pattern, text):
                        return FailResult(
                            error_message=MUTATION_RESPONSE,
                            fix_value=None
                        )
                return PassResult()

        @register_validator(name="lucid/prompt_injection", data_type="string")
        class PromptInjectionValidator(Validator):
            """Guardrails AI Validator: Blocks jailbreaks and system prompt extraction."""
            def __init__(self, on_fail: str = "noop", **kwargs):
                super().__init__(on_fail=on_fail, **kwargs)

            def validate(self, value: Any, metadata: Dict = {}) -> Any:
                text = str(value).lower()
                for pattern in INJECTION_PATTERNS:
                    if re.search(pattern, text):
                        return FailResult(
                            error_message=INJECTION_RESPONSE,
                            fix_value=None
                        )
                return PassResult()

        @register_validator(name="lucid/topic_scope", data_type="string")
        class TopicScopeValidator(Validator):
            """Guardrails AI Validator: Enforces workplace domain boundary."""
            def __init__(self, on_fail: str = "noop", **kwargs):
                super().__init__(on_fail=on_fail, **kwargs)

            def validate(self, value: Any, metadata: Dict = {}) -> Any:
                text = str(value).lower()
                for pattern in OFF_TOPIC_PATTERNS:
                    if re.search(pattern, text):
                        return FailResult(
                            error_message=OFF_TOPIC_RESPONSE,
                            fix_value=None
                        )
                return PassResult()

        # Build official Guardrails AI Guard Pipeline
        coach_guard = Guard(name="coach_input_guard").use(
            CrisisSafetyValidator(on_fail="noop"),
            HarmfulViolenceValidator(on_fail="noop"),
            DatabaseSecurityValidator(on_fail="noop"),
            PromptInjectionValidator(on_fail="noop"),
            TopicScopeValidator(on_fail="noop"),
        )
    except Exception as e:
        print(f"[GUARDRAILS AI] Warning setting up native Guard instance: {e}")
        coach_guard = None


# ============================================================================
# 8. MAIN EVALUATION FUNCTION (Fast-Path < 5ms)
# ============================================================================
def check_input_guardrails(user_query: str) -> Optional[Dict[str, Any]]:
    """
    Evaluates incoming query against all Guardrails AI rules in < 5ms.
    Executes through Guardrails AI Guard pipeline when available, with fast regex failsafe.
    Returns rejection payload if triggered, or None if the query is safe to proceed.
    """
    if not user_query or not user_query.strip():
        return None

    query = user_query.strip()

    # 1. Primary Execution: Official Guardrails AI Guard Pipeline
    if GUARDRAILS_AI_AVAILABLE and coach_guard is not None:
        try:
            outcome = coach_guard.validate(query)
            if not outcome.validation_passed:
                summaries = getattr(outcome, "validation_summaries", []) or []
                if summaries:
                    failed = summaries[0]
                    val_name = getattr(failed, "validator_name", "") or getattr(failed, "validatorName", "") or ""
                    reason = getattr(failed, "failure_reason", "") or getattr(failed, "failureReason", "") or ""
                    meta = VALIDATOR_META.get(val_name, {
                        "guardrail": "GUARDRAILS_AI",
                        "intent": "SCOPE_DEFLECTION",
                        "routing_reason": f"Triggered Guardrails AI validator: {val_name}",
                    })
                    return {
                        "triggered": True,
                        "guardrail": meta["guardrail"],
                        "intent": meta["intent"],
                        "routing_reason": meta["routing_reason"],
                        "response": reason or meta.get("response", OFF_TOPIC_RESPONSE),
                        "engine": "guardrails-ai",
                    }
        except Exception as e:
            # Fall through gracefully to deterministic fast-path
            pass

    # 2. Secondary Fast-Path / Failsafe Execution
    q_lower = query.lower()

    # Crisis & Self-Harm
    for pattern in CRISIS_PATTERNS:
        if re.search(pattern, q_lower):
            return {
                "triggered": True,
                "guardrail": "CRISIS_SAFETY",
                "intent": "SAFETY",
                "routing_reason": "Triggered immediate crisis and self-harm protection guardrail.",
                "response": CRISIS_RESPONSE,
                "engine": "failsafe",
            }

    # Harmful / Violent Actions
    for pattern in HARMFUL_PATTERNS:
        if re.search(pattern, q_lower):
            return {
                "triggered": True,
                "guardrail": "HARMFUL_VIOLENCE",
                "intent": "SAFETY",
                "routing_reason": "Triggered violence and harm prevention guardrail.",
                "response": HARMFUL_RESPONSE,
                "engine": "failsafe",
            }

    # Database Mutation & Deletion Requests
    for pattern in MUTATION_PATTERNS:
        if re.search(pattern, q_lower):
            return {
                "triggered": True,
                "guardrail": "DATABASE_SECURITY",
                "intent": "SECURITY",
                "routing_reason": "Triggered database mutation and deletion prevention guardrail.",
                "response": MUTATION_RESPONSE,
                "engine": "failsafe",
            }

    # Prompt Injections & Jailbreaks
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, q_lower):
            return {
                "triggered": True,
                "guardrail": "PROMPT_INJECTION",
                "intent": "SECURITY",
                "routing_reason": "Triggered prompt injection prevention guardrail.",
                "response": INJECTION_RESPONSE,
                "engine": "failsafe",
            }

    # Off-Topic Scope Deflection
    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, q_lower):
            return {
                "triggered": True,
                "guardrail": "OFF_TOPIC_SCOPE",
                "intent": "SCOPE_DEFLECTION",
                "routing_reason": "Triggered off-topic scope deflection guardrail.",
                "response": OFF_TOPIC_RESPONSE,
                "engine": "failsafe",
            }

    # User Custom Rules
    for rule in CUSTOM_RULES:
        if re.search(rule["pattern"], q_lower):
            return {
                "triggered": True,
                "guardrail": rule.get("name", "CUSTOM_RULE"),
                "intent": rule.get("intent", "GUARDRAIL"),
                "routing_reason": rule.get("reason", "Triggered custom user guardrail."),
                "response": rule["response"],
                "engine": "custom_rule",
            }

    # All guardrails passed cleanly!
    return None
