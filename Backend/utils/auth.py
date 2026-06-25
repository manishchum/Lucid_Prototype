import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from fastapi import Header, HTTPException, Request
from utils.auth_bridge import (
	BridgeConfigurationError,
	BridgeResolutionError,
	log_bridge_event,
	resolve_user_context_from_claims,
)
from utils.supabase_client import supabase
from utils.auth_bridge import get_service_supabase_client
import uuid as _uuid


@dataclass
class RequestAuth:
	user_id: Optional[str]
	email: Optional[str]
	source: str
	claims: Optional[Dict[str, Any]] = None
	company_id: Optional[str] = None


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
	if not authorization:
		return None

	parts = authorization.strip().split(" ", 1)
	if len(parts) != 2:
		return None

	scheme, token = parts[0].lower(), parts[1].strip()
	if scheme != "bearer" or not token:
		return None

	return token


def _ensure_firebase_admin_initialized() -> None:
	try:
		import firebase_admin
		from firebase_admin import credentials
	except Exception as exc:  # pragma: no cover - import guard
		raise HTTPException(
			status_code=500,
			detail="firebase-admin is not installed on backend",
		) from exc

	if firebase_admin._apps:
		return

	service_account_b64 = os.getenv("FIREBASE_ADMIN_KEY")
	service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
	service_account_file = os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

	try:
		if service_account_b64:
			decoded_json = base64.b64decode(service_account_b64).decode("utf-8")
			cert_payload = json.loads(decoded_json)
			cred = credentials.Certificate(cert_payload)
			firebase_admin.initialize_app(cred)
			print("[auth init] Firebase Admin initialized using source=FIREBASE_ADMIN_KEY(base64)")
			return

		if service_account_json:
			cert_payload = json.loads(service_account_json)
			cred = credentials.Certificate(cert_payload)
			firebase_admin.initialize_app(cred)
			print("[auth init] Firebase Admin initialized using source=FIREBASE_SERVICE_ACCOUNT_JSON")
			return

		if service_account_file:
			cred = credentials.Certificate(service_account_file)
			firebase_admin.initialize_app(cred)
			print("[auth init] Firebase Admin initialized using source=FIREBASE_SERVICE_ACCOUNT_FILE/GOOGLE_APPLICATION_CREDENTIALS")
			return

		# Fallback to application default credentials when running in managed envs.
		firebase_admin.initialize_app()
		print("[auth init] Firebase Admin initialized using source=ApplicationDefaultCredentials")
	except Exception as exc:
		raise HTTPException(
			status_code=500,
			detail="Firebase Admin SDK initialization failed",
		) from exc


def _verify_firebase_token(token: str) -> Dict[str, Any]:
	_ensure_firebase_admin_initialized()

	from firebase_admin import auth as firebase_auth

	try:
		# Allow a small clock skew to avoid false negatives when local time drifts slightly.
		return firebase_auth.verify_id_token(token, clock_skew_seconds=60)
	except Exception as exc:
		raise HTTPException(status_code=401, detail="Invalid or expired bearer token") from exc


def _resolve_internal_user_context(
	email: Optional[str],
	fallback_user_id: str,
	claims: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[str]]:
	context = None

	# Preferred path: resolve app user via auth bridge from verified token claims.
	if claims:
		try:
			context = resolve_user_context_from_claims(claims, fail_fast=True)
		except BridgeConfigurationError as exc:
			raise HTTPException(status_code=500, detail=f"Bridge configuration failure: {exc}") from exc
		except BridgeResolutionError as exc:
			# print("Bridge Failed",{"email":email, "claims":claims})
			raise HTTPException(status_code=401, detail=f"Bridge user resolution failed: {exc}") from exc
	elif email:
		try:
			context = resolve_user_context_from_claims({"email": email}, fail_fast=False)
		except Exception as exc:
			print(f"[auth] Bridge user resolution by email failed: {exc}")

	if context and context.user_id:
		return str(context.user_id), str(context.company_id) if context.company_id else None

	# Legacy fallback: direct lookup by email in users table.
	if email:
		try:
			res = (
				supabase
				.table("users")
				.select("user_id, company_id")
				.eq("email", email)
				.maybe_single()
				.execute()
			)
			data = getattr(res, "data", None)
			if isinstance(data, dict) and data.get("user_id"):
				return str(data.get("user_id")), str(data.get("company_id")) if data.get("company_id") else None
		except Exception as exc:
			print(f"[auth] Fallback lookup by email failed: {exc}")

	return str(fallback_user_id or ""), None


def _resolve_internal_user_id(email: Optional[str], fallback_user_id: str) -> str:
	user_id, _ = _resolve_internal_user_context(email, fallback_user_id)
	return user_id


def _build_request_auth_from_verified_claims(claims: Dict[str, Any]) -> RequestAuth:
	token_user_id = claims.get("uid") or claims.get("user_id") or claims.get("sub")
	email = claims.get("email")
	# print("AUTH START",{"token_user_id": token_user_id, "email": email, "claims": claims})
	user_id, company_id = _resolve_internal_user_context(
		str(email) if email else None,
		str(token_user_id) if token_user_id else "",
		claims,
	)
	# print("AUTH RESOLVED",{"user_id": user_id, "company_id": company_id})

	if not user_id or (token_user_id and str(user_id) == str(token_user_id)):
		raise HTTPException(status_code=401, detail="Authenticated Firebase user is not linked to an app user")

	log_bridge_event(
		"auth_context_resolved",
		firebase_uid=str(token_user_id) if token_user_id else None,
		app_user_id=str(user_id),
		company_id=company_id,
		token_exp=claims.get("exp"),
		source="firebase",
	)

	return RequestAuth(
		user_id=str(user_id),
		email=str(email) if email else None,
		source="firebase",
		claims=claims,
		company_id=str(company_id) if company_id else None,
	)


def get_request_auth_optional(
	authorization: Optional[str] = Header(None, alias="Authorization"),
	x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
) -> RequestAuth:
	token = _extract_bearer_token(authorization)

	if token:
		try:
			claims = _verify_firebase_token(token)
			auth_ctx = _build_request_auth_from_verified_claims(claims)
			print(
				f"[auth optional] Bearer verified successfully; "
				f"uid={claims.get('uid') or claims.get('user_id') or claims.get('sub')}; "
				f"resolved_user_id={auth_ctx.user_id}"
			)
			return auth_ctx
		except HTTPException as exc:
			if exc.detail == "Authenticated Firebase user is not linked to an app user":
				raise
			if isinstance(exc.detail, str) and exc.detail.startswith("Bridge"):
				raise
			cause = exc.__cause__
			cause_msg = str(cause) if cause else exc.detail
			if exc.status_code == 401:
				print(f"[auth optional] Bearer verification failed (401), falling back to X-User-ID: {exc.detail}; cause={cause_msg}")
			else:
				print(f"[auth optional] Firebase verification infrastructure issue, falling back to X-User-ID: {exc.detail}; cause={cause_msg}")
			# Optional mode stays backward-compatible:
			# if bearer verification fails, fall through to legacy header.
		except Exception as exc:
			# Catch any other exceptions (e.g., Firebase SDK not available, network errors)
			print(f"[auth optional] Firebase verification exception, falling back to X-User-ID: {str(exc)}")

	if x_user_id:
		# Try resolving legacy firebase_uid -> internal user_id (UUID) so
		# downstream DB queries that expect UUIDs don't fail.
		def _is_uuid(val: str) -> bool:
			try:
				_uuid.UUID(str(val))
				return True
			except Exception:
				return False

		def _resolve_firebase_uid_to_user_id(val: str) -> str:
			if _is_uuid(val):
				return val
			try:

				# NEW: lookup through mapping table first
				mapping_resp = (
					supabase
					.table("user_firebase_uids")
					.select("user_id")
					.eq("firebase_uid", val)
					.maybe_single()
					.execute()
				)

				mapping_data = getattr(mapping_resp, "data", None)

				if isinstance(mapping_data, dict) and mapping_data.get("user_id"):
					return str(mapping_data.get("user_id"))

				# Fallback to legacy users.firebase_uid
				resp = (
					supabase
					.table("users")
					.select("user_id")
					.eq("firebase_uid", val)
					.maybe_single()
					.execute()
				)

				data = getattr(resp, "data", None)

				if isinstance(data, dict) and data.get("user_id"):
					return str(data.get("user_id"))

			except Exception as e:
				print(f"[auth] firebase_uid lookup failed: {e}")
			return val

		resolved = _resolve_firebase_uid_to_user_id(x_user_id)
		print(f"[auth optional] Using X-User-ID fallback; x_user_id={x_user_id}; resolved_user_id={resolved}")
		return RequestAuth(user_id=resolved, email=None, source="legacy-x-user-id", claims=None)

	return RequestAuth(user_id=None, email=None, source="anonymous", claims=None)


def get_request_auth_required(
	authorization: Optional[str] = Header(None, alias="Authorization"),
) -> RequestAuth:
	token = _extract_bearer_token(authorization)
	if not token:
		raise HTTPException(status_code=401, detail="Missing bearer token")

	claims = _verify_firebase_token(token)
	return _build_request_auth_from_verified_claims(claims)


def get_request_auth_jwt_required(
	authorization: Optional[str] = Header(None, alias="Authorization"),
) -> RequestAuth:
	token = _extract_bearer_token(authorization)
	if not token:
		raise HTTPException(status_code=401, detail="Missing bearer token")

	claims = _verify_firebase_token(token)
	token_user_id = claims.get("uid") or claims.get("user_id") or claims.get("sub")
	email = claims.get("email")
	user_id, company_id = _resolve_internal_user_context(
		str(email) if email else None,
		str(token_user_id) if token_user_id else "",
		claims,
	)

	if not user_id or (token_user_id and str(user_id) == str(token_user_id)):
		raise HTTPException(status_code=401, detail="Authenticated Firebase user is not linked to an app user")

	log_bridge_event(
		"auth_context_resolved",
		firebase_uid=str(token_user_id) if token_user_id else None,
		app_user_id=str(user_id),
		company_id=company_id,
		token_exp=claims.get("exp"),
		source="firebase",
	)

	return RequestAuth(
		user_id=str(user_id),
		email=str(email) if email else None,
		source="firebase",
		claims=claims,
		company_id=str(company_id) if company_id else None,
	)


def get_request_auth_jwt_required_from_request(request: Request) -> RequestAuth:
	authorization = request.headers.get("Authorization")
	return get_request_auth_jwt_required(authorization=authorization)


def get_request_auth_required_from_request(request: Request) -> RequestAuth:
	authorization = request.headers.get("Authorization")
	return get_request_auth_required(authorization=authorization)

from fastapi import Depends

async def get_effective_company_id(
	request: Request,
	x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
	auth_ctx: RequestAuth = Depends(get_request_auth_required)
) -> str:
	"""
	Resolve the effective company ID for multi-tenant requests.
	Validates X-Company-ID or path company_id override against developer/admin roles.
	If no override is provided or allowed, falls back to the user's home company.
	"""
	if not auth_ctx.user_id:
		raise HTTPException(status_code=401, detail="Unauthorized")

	requested_company_id = request.path_params.get("company_id") or x_company_id
	
	# Sanitize requested_company_id format
	if requested_company_id:
		import uuid
		try:
			uuid.UUID(str(requested_company_id))
		except ValueError:
			requested_company_id = None

	home_company_id = auth_ctx.company_id

	# Attempting to query fallback if missing from auth_ctx
	if not home_company_id:
		try:
			from utils.auth_bridge import get_service_supabase_client
			supabase = get_service_supabase_client()
			resp = supabase.table("users").select("company_id").eq("user_id", auth_ctx.user_id).single().execute()
			if resp.data and resp.data.get("company_id"):
				home_company_id = str(resp.data["company_id"])
		except Exception:
			pass

	if not requested_company_id:
		if not home_company_id:
			raise HTTPException(status_code=400, detail="User has no associated company and no override provided")
		return home_company_id

	if home_company_id and str(requested_company_id) == str(home_company_id):
		return home_company_id

	from utils.db.permissions import check_user_permission
	try:
		is_developer = await check_user_permission(auth_ctx.user_id, "developer")
		is_admin = await check_user_permission(auth_ctx.user_id, "super_admin")
	except Exception:
		is_developer = False
		is_admin = False

	if is_developer or is_admin:
		return str(requested_company_id)

	# Forged or unauthorized override => constrain to actual company
	if home_company_id:
		return home_company_id

	raise HTTPException(status_code=403, detail="Not authorized to query this company")