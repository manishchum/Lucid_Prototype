import os
import re
from typing import Dict, Any, List, Tuple, Optional
from datetime import datetime

# Two-tier channel limits: [recommended_title, hard_title, recommended_body, hard_body]
CHANNEL_CONSTRAINTS = {
    "PUSH": {
        "title_recommended": 50,
        "title_hard": 120,
        "body_recommended": 150,
        "body_hard": 450,
        "label": "Mobile Push Notification",
    },
    "IN_APP": {
        "title_recommended": 80,
        "title_hard": 200,
        "body_recommended": 300,
        "body_hard": 2000,
        "label": "In-App Notification Drawer",
    },
    "WHATSAPP": {
        "title_recommended": 60,
        "title_hard": 160,
        "body_recommended": 500,
        "body_hard": 1024,
        "label": "WhatsApp Message Template",
    },
    "EMAIL": {
        "title_recommended": 70,
        "title_hard": 255,
        "body_recommended": 1000,
        "body_hard": 100000,
        "label": "Email Alert",
    },
    "ALL": {
        "title_recommended": 50,
        "title_hard": 120,
        "body_recommended": 150,
        "body_hard": 450,
        "label": "Omnichannel (Most Restrictive - Push Bound)",
    },
}

# Regex to safely match tokens with optional filters: {{ key | filter: "arg" }}
TOKEN_REGEX = re.compile(r"\{\{\s*([\w\.]+)(?:\s*\|\s*([^}]+))?\s*\}\}")
UNCLOSED_TOKEN_REGEX = re.compile(r"\{\{[^}]*(?:$|\n)")

# Common shorthand alias mapping to standard namespaced keys
KEY_ALIASES = {
    "first_name": "subscriber.first_name",
    "full_name": "subscriber.full_name",
    "company_name": "subscriber.company_name",
    "manager_name": "subscriber.manager_name",
    "module_name": "curriculum.module_name",
    "due_date": "curriculum.due_date",
    "days_left": "curriculum.days_left",
    "action_url": "curriculum.action_url",
    "score": "assessment.score",
    "passing_score": "assessment.passing_score",
    "feedback_summary": "assessment.feedback_summary",
    "streak_days": "gamification.streak_days",
    "completed_count": "gamification.completed_count",
    "xp_points": "gamification.xp_points",
    "leaderboard_rank": "gamification.leaderboard_rank",
    "badge_name": "gamification.badge_name",
    "content_name": "recommendations.content_name",
}

# Reverse mapping: namespaced -> shorthand
REVERSE_ALIASES = {v: k for k, v in KEY_ALIASES.items()}


def normalize_token_key(key: str) -> str:
    """Returns canonical namespaced key if shorthand is used, or the key itself."""
    clean = key.strip()
    return KEY_ALIASES.get(clean, clean)


def apply_filter(value: Any, filter_expr: str) -> str:
    """
    Safely executes supported template filters on a resolved value.
    Zero code execution (eval/exec).
    """
    if value is None:
        val_str = ""
    else:
        val_str = str(value)

    filter_expr = filter_expr.strip()
    if not filter_expr:
        return val_str

    # Parse filter name and optional argument: default: "fallback"
    parts = filter_expr.split(":", 1)
    filter_name = parts[0].strip().lower()
    filter_arg = parts[1].strip() if len(parts) > 1 else None

    # Strip quotes from argument if present
    if filter_arg:
        if (filter_arg.startswith('"') and filter_arg.endswith('"')) or (
            filter_arg.startswith("'") and filter_arg.endswith("'")
        ):
            filter_arg = filter_arg[1:-1]

    if filter_name == "default":
        if not val_str and filter_arg is not None:
            return filter_arg
        return val_str
    elif filter_name == "uppercase":
        return val_str.upper()
    elif filter_name == "lowercase":
        return val_str.lower()
    elif filter_name == "capitalize":
        return val_str.capitalize()
    elif filter_name == "date":
        try:
            # If already date format or ISO
            dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
            return dt.strftime("%b %d, %Y")
        except Exception:
            return val_str
    elif filter_name == "number":
        try:
            num = float(val_str.replace(",", ""))
            if num.is_integer():
                return f"{int(num):,}"
            return f"{num:,.2f}"
        except Exception:
            return val_str
    elif filter_name == "currency":
        try:
            num = float(val_str.replace("$", "").replace(",", ""))
            return f"${num:,.2f}"
        except Exception:
            return f"${val_str}"

    return val_str


class TemplateCompiler:
    """Safe, Sandboxed Template Parser and Renderer."""

    @staticmethod
    def extract_tokens(text: Optional[str]) -> List[Tuple[str, str, Optional[str]]]:
        """
        Extracts all tokens from a template string.
        Returns list of (full_match, raw_key, filter_expr).
        """
        if not text:
            return []
        tokens = []
        for match in TOKEN_REGEX.finditer(text):
            full_match = match.group(0)
            raw_key = match.group(1).strip()
            filter_expr = match.group(2).strip() if match.group(2) else None
            tokens.append((full_match, raw_key, filter_expr))
        return tokens

    @staticmethod
    def check_syntax_errors(text: Optional[str]) -> List[str]:
        """Detects unclosed curly braces and malformed expressions."""
        if not text:
            return []
        errors = []

        # Find unclosed {{ without matching }}
        unclosed = UNCLOSED_TOKEN_REGEX.findall(text)
        for u in unclosed:
            if "}}" not in u:
                errors.append(f"Unclosed variable expression: '{u[:30]}...'")

        # Find empty {{}}
        if re.search(r"\{\{\s*\}\}", text):
            errors.append("Empty variable expression '{{}}' detected.")

        return errors

    @staticmethod
    def render(
        template_str: Optional[str],
        context: Dict[str, Any],
        variable_registry: Optional[Dict[str, Any]] = None,
        use_fallbacks: bool = True,
    ) -> Tuple[str, List[str]]:
        """
        Safely interpolates variables into the template string with filters.
        Returns (rendered_output, list_of_unresolved_required_keys).
        """
        if not template_str:
            return "", []

        unresolved_required = []

        def replacer(match):
            raw_key = match.group(1).strip()
            filter_expr = match.group(2).strip() if match.group(2) else None

            canonical_key = normalize_token_key(raw_key)

            # Resolve value from context: try canonical first, then raw, then reverse alias
            val = None
            if canonical_key in context:
                val = context[canonical_key]
            elif raw_key in context:
                val = context[raw_key]
            elif canonical_key in REVERSE_ALIASES and REVERSE_ALIASES[canonical_key] in context:
                val = context[REVERSE_ALIASES[canonical_key]]

            # Strict Variable Resolution: No synthetic database fallbacks.
            # If an in-template filter provides a default (e.g. {{ first_name | default: 'there' }}), apply it.
            if filter_expr:
                filtered_val = apply_filter(val, filter_expr)
                if val is None and filtered_val:
                    return filtered_val

            # If still unresolved and has no in-template default filter:
            if val is None or val == "":
                # Check if required in variable contract
                is_req = False
                if variable_registry:
                    reg_entry = variable_registry.get(canonical_key) or variable_registry.get(raw_key)
                    if reg_entry and reg_entry.get("is_required"):
                        is_req = True
                else:
                    # By default contract, key subscriber/curriculum identifiers are required
                    if canonical_key in ["subscriber.first_name", "curriculum.module_name", "assessment.score"]:
                        is_req = True

                if is_req:
                    unresolved_required.append(canonical_key)

            if filter_expr:
                return apply_filter(val, filter_expr)

            return str(val) if val is not None else ""

        rendered = TOKEN_REGEX.sub(replacer, template_str)
        return rendered, unresolved_required


class TemplateLinter:
    """Real-Time Template Syntax and Channel Constraint Validator."""

    @staticmethod
    def lint(
        title_template: Optional[str],
        body_template: str,
        channel: str,
        known_variables: Dict[str, Any],
        sample_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        hard_errors: List[str] = []
        warnings: List[str] = []
        channel_key = channel.upper() if channel else "ALL"
        constraints = CHANNEL_CONSTRAINTS.get(channel_key, CHANNEL_CONSTRAINTS["ALL"])

        # 1. Syntax validation
        title_syntax_errors = TemplateCompiler.check_syntax_errors(title_template)
        body_syntax_errors = TemplateCompiler.check_syntax_errors(body_template)

        for err in title_syntax_errors:
            hard_errors.append(f"Title: {err}")
        for err in body_syntax_errors:
            hard_errors.append(f"Body: {err}")

        if not body_template or not body_template.strip():
            hard_errors.append("Body template cannot be empty.")

        # 2. Variable contract validation
        all_tokens = TemplateCompiler.extract_tokens(title_template) + TemplateCompiler.extract_tokens(body_template)
        tokens_found = []
        unknown_tokens = []

        for full_match, raw_key, filter_expr in all_tokens:
            canonical = normalize_token_key(raw_key)
            tokens_found.append(canonical)

            # Check if token exists in registered known_variables
            is_known = (
                canonical in known_variables
                or raw_key in known_variables
                or (canonical in REVERSE_ALIASES and REVERSE_ALIASES[canonical] in known_variables)
            )

            if not is_known:
                unknown_tokens.append(raw_key)
                hard_errors.append(
                    f"Unknown variable '{{{{{raw_key}}}}}'. Variable must be registered in the Variable Registry before use."
                )

        # 3. Channel Character Constraints (evaluated on sample rendered estimation)
        rendered_title, _ = TemplateCompiler.render(title_template, sample_context, known_variables)
        rendered_body, _ = TemplateCompiler.render(body_template, sample_context, known_variables)

        title_len = len(rendered_title)
        body_len = len(rendered_body)

        # Title constraints
        if title_template:
            if title_len > constraints["title_hard"]:
                hard_errors.append(
                    f"Title exceeds provider hard limit ({title_len}/{constraints['title_hard']} chars) for {constraints['label']}."
                )
            elif title_len > constraints["title_recommended"]:
                warnings.append(
                    f"Title is over recommended length ({title_len}/{constraints['title_recommended']} chars, +{title_len - constraints['title_recommended']} over) for {constraints['label']}."
                )

        # Body constraints
        if body_len > constraints["body_hard"]:
            hard_errors.append(
                f"Body exceeds provider hard limit ({body_len}/{constraints['body_hard']} chars) for {constraints['label']}."
            )
        elif body_len > constraints["body_recommended"]:
            warnings.append(
                f"Body is over recommended length ({body_len}/{constraints['body_recommended']} chars, +{body_len - constraints['body_recommended']} over) for {constraints['label']}."
            )

        return {
            "valid": len(hard_errors) == 0,
            "hard_errors": hard_errors,
            "warnings": warnings,
            "tokens_found": list(set(tokens_found)),
            "unknown_tokens": list(set(unknown_tokens)),
            "metrics": {
                "channel": channel_key,
                "title_rendered_length": title_len,
                "title_recommended": constraints["title_recommended"],
                "title_hard": constraints["title_hard"],
                "body_rendered_length": body_len,
                "body_recommended": constraints["body_recommended"],
                "body_hard": constraints["body_hard"],
            },
            "rendered_preview": {
                "title": rendered_title,
                "body": rendered_body,
            },
        }
