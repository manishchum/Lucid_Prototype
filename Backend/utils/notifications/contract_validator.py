import logging
from typing import Dict, Any, Tuple, List, Optional
import jsonschema
from jsonschema import Draft7Validator
from utils.notifications.template_engine import normalize_token_key, KEY_ALIASES, REVERSE_ALIASES

logger = logging.getLogger("lucid.contract_validator")

# Default registry fallbacks for common variable keys
VARIABLE_FALLBACKS: Dict[str, Any] = {
    "subscriber.first_name": "there",
    "subscriber.full_name": "Valued Learner",
    "subscriber.company_name": "your organization",
    "subscriber.manager_name": "your manager",
    "curriculum.days_left": 3,
    "curriculum.action_url": "https://app.lucid.ai/employee/welcome",
    "assessment.passing_score": 80,
    "assessment.feedback_summary": "Evaluation complete. Tap to review your scorecard.",
    "gamification.xp_points": 50,
    "recommendations.content_name": "recommended module",
}


def normalize_payload_keys(raw_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalizes a dictionary payload so both canonical namespaced keys
    (e.g., 'subscriber.first_name') and common aliases ('first_name') are available.
    """
    normalized: Dict[str, Any] = dict(raw_payload)

    for k, v in list(raw_payload.items()):
        canonical = normalize_token_key(k)
        if canonical not in normalized:
            normalized[canonical] = v
        # Also populate reverse shorthand if missing
        if canonical in REVERSE_ALIASES:
            shorthand = REVERSE_ALIASES[canonical]
            if shorthand not in normalized:
                normalized[shorthand] = v

    return normalized


class EventContractValidator:
    """
    Contract-First Event Parameter Validator.
    Enforces strict schemas, data types, required constraints,
    and applies registered fallbacks for optional fields.
    """

    @classmethod
    def validate_payload(
        cls,
        event_key: str,
        payload: Dict[str, Any],
        schema: Optional[Dict[str, Any]] = None,
        allow_schema_free: bool = False,
    ) -> Tuple[bool, List[str], Optional[str]]:
        """
        Validates event payload against registered parameter contract.
        Returns:
            (is_valid, list_of_error_messages, failure_category)
        """
        if not schema or not schema.get("properties"):
            if allow_schema_free:
                return True, [], None
            # If no schema defined, check if basic payload is a dict
            if not isinstance(payload, dict):
                return False, ["Payload must be a valid JSON object"], "PERMANENT_SCHEMA_VIOLATION"
            return True, [], None

        normalized = normalize_payload_keys(payload)

        # Build validation object from schema
        validator = Draft7Validator(schema)
        errors: List[str] = []

        # Check required fields with alias normalization
        required_fields = schema.get("required", [])
        for req in required_fields:
            canonical_req = normalize_token_key(req)
            if canonical_req not in normalized and req not in normalized:
                errors.append(f"Missing required contract field: '{req}'")
            elif normalized.get(canonical_req) is None and normalized.get(req) is None:
                errors.append(f"Required field '{req}' cannot be null")

        # Check schema type/format constraints
        for err in validator.iter_errors(normalized):
            field_name = ".".join([str(p) for p in err.path]) or "root"
            # If the error is about a missing required field that was already caught, don't duplicate
            if "is a required property" in err.message:
                continue
            errors.append(f"Validation error on '{field_name}': {err.message}")

        if errors:
            logger.warning(
                f"[ContractValidator] Validation failed for event '{event_key}': {errors}"
            )
            return False, errors, "PERMANENT_SCHEMA_VIOLATION"

        return True, [], None

    @classmethod
    def apply_fallbacks(
        cls,
        payload: Dict[str, Any],
        schema: Optional[Dict[str, Any]] = None,
        custom_fallbacks: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Enriches payload with registered default/fallback values for missing optional fields.
        Never replaces required fields that failed validation.
        """
        enriched = normalize_payload_keys(payload)
        fallbacks = dict(VARIABLE_FALLBACKS)
        if custom_fallbacks:
            fallbacks.update(custom_fallbacks)

        for key, default_val in fallbacks.items():
            canonical = normalize_token_key(key)
            if canonical not in enriched or enriched[canonical] is None:
                enriched[canonical] = default_val
                if canonical in REVERSE_ALIASES:
                    enriched[REVERSE_ALIASES[canonical]] = default_val

        return enriched
