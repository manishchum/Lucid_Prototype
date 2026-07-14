def apply_verification_rules(ai_result, object_validation):
    """
    Final authority layer after Gemini.
    """

    if not object_validation.get("object_check_passed", True):

        ai_result["passed"] = False

        ai_result["score"] = min(
            ai_result.get("score", 0),
            40
        )

        ai_result["feedback"] = (
            object_validation.get("reason")
            or ai_result.get("feedback")
        )

    return ai_result