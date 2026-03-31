"""
REFACTORING PATTERN FOR REMAINING ROUTE FILES

This file provides the pattern for refactoring remaining routes.

STEP 1: Replace imports
FROM:
from fastapi import APIRouter, HTTPException, Header, Query

TO:
from fastapi import APIRouter, Header, Query
from utils.exceptions import AuthorizationError, NotFoundError, ValidationError, ConflictError, DatabaseError
from utils.logging import ErrorLogger

STEP 2: Wrap endpoint functions in try-except blocks
Pattern for GET endpoints:

OLD:
@router.get("/{id}")
async def get_item(id: str, user_id: str = Header(..., alias="X-User-ID")):
    result = await get_item_by_id(user_id, id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"item": result["data"]}

NEW:
@router.get("/{id}")
async def get_item(id: str, user_id: str = Header(..., alias="X-User-ID")):
    try:
        result = await get_item_by_id(user_id, id)
        if result["error"]:
            ErrorLogger.log_auth_error(result["error"], {"id": id})
            raise AuthorizationError(result["error"])
        
        return {
            "success": True,
            "data": result["data"],
            "error": None
        }
    except AuthorizationError:
        raise
    except Exception as e:
        ErrorLogger.log_unhandled_error(e)
        raise

STEP 3: For validation errors:
OLD:
if not update_data:
    raise HTTPException(status_code=400, detail="No update data provided")

NEW:
if not update_data:
    raise ValidationError("No update data provided")

STEP 4: For 404 errors:
OLD:
if result["error"] == "Not found":
    raise HTTPException(status_code=404, detail=result["error"])

NEW:
if result["error"] == "Not found":
    ErrorLogger.log_error(result["error"], "NOT_FOUND", 404, {"id": id})
    raise NotFoundError("Resource Type", id)

STEP 5: For 409 conflicts:
OLD:
if "already exists" in result["error"]:
    raise HTTPException(status_code=409, detail=result["error"])

NEW:
if "already exists" in result["error"]:
    ErrorLogger.log_error(result["error"], "CONFLICT", 409, data)
    raise ConflictError(result["error"])

STEP 6: All responses must follow format:
{
    "success": True/False,
    "data": {...} or [...] or None,
    "error": None or "error message"
}

EXCEPTION MAPPING:
- 400 Bad Request → ValidationError
- 401 Unauthorized → AuthenticationError
- 403 Forbidden → AuthorizationError
- 404 Not Found → NotFoundError
- 409 Conflict → ConflictError
- 500 Server Error → DatabaseError or InternalServerError
- 502 Bad Gateway → ExternalApiError

FILES TO REFACTOR:
1. routes/roles.py
2. routes/employee_assessment.py
3. routes/training_modules.py
4. routes/processed_modules.py
5. routes/learning_plan.py
6. routes/module_progress.py
7. routes/content_jobs.py
8. routes/dispatch.py
9. routes/learning_style.py
10. routes/unsubscribe.py

Feature routes (in their respective directories):
- change_password/route.py
- openai_upload/route.py
- learning_style/route.py
- And others...
"""
