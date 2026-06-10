from fastapi import APIRouter, Depends, HTTPException

from utils.auth import RequestAuth, get_request_auth_required
from utils.db.employees_db import get_employees_bootstrap


router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("/bootstrap/{company_id}")
async def employees_bootstrap(
	company_id: str,
	auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
	result = await get_employees_bootstrap(auth_ctx.user_id, company_id)

	if result.get("error"):
		error_message = result["error"]
		status_code = 403 if "permission denied" in error_message.lower() else 500
		raise HTTPException(status_code=status_code, detail=error_message)

	return result.get("data") or {
		"users": [],
		"roles": [],
		"departments": [],
		"training_modules": [],
		"learning_plans": [],
	}
