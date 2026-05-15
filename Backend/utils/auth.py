import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, Request
from utils.supabase_client import supabase


@dataclass
class RequestAuth:
	user_id: Optional[str]
	email: Optional[str]
	source: str
	claims: Optional[Dict[str, Any]] = None


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


def _resolve_internal_user_id(email: Optional[str], fallback_user_id: str) -> str:
	if not email:
		
		return fallback_user_id

	try:
		# print(f"[auth] Attempting to resolve user by email: {email}")
		res = (
			supabase
			.table("users")
			.select("user_id")
			.eq("email", email)
			.execute()
		)
		data = getattr(res, "data", [])
		# print(f"[auth] Email lookup result: {data}")
		if isinstance(data, list) and len(data) > 0 and data[0].get("user_id"):
			resolved_id = str(data[0].get("user_id"))
			# print(f"[auth] Successfully resolved email {email} to user_id={resolved_id}")
			return resolved_id
		else:
			# print(f"[auth] Email {email} not found in users table")
			pass

	except Exception as exc:
		# print(f"[auth] Failed to resolve internal user_id by email: {exc}")
		pass

	# Always return fallback_user_id even if email lookup failed
	# This preserves Firebase-verified identity
	if fallback_user_id:
		# print(f"[auth] Using fallback_user_id from Firebase token: {fallback_user_id}")
		return fallback_user_id

	return fallback_user_id


def get_request_auth_optional(
	authorization: Optional[str] = Header(None, alias="Authorization"),
	x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
) -> RequestAuth:
	token = _extract_bearer_token(authorization)

	if token:
		try:
			claims = _verify_firebase_token(token)
			token_user_id = claims.get("uid") or claims.get("user_id") or claims.get("sub")
			email = claims.get("email")
			
			# Ensure we have some identifier from the verified token
			if not token_user_id:
				print(f"[auth optional] Firebase token verified but missing uid/user_id/sub claims; email={email}; claims_keys={list(claims.keys())}")
				# Fall through to X-User-ID header
			else:
				user_id = _resolve_internal_user_id(str(email) if email else None, str(token_user_id))

				if user_id:
					print(f"[auth optional] Bearer verified successfully; uid={token_user_id}; resolved_user_id={user_id}")
					return RequestAuth(
						user_id=str(user_id),
						email=str(email) if email else None,
						source="firebase",
						claims=claims,
					)
		except HTTPException as exc:
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
		print(f"[auth optional] Using X-User-ID fallback; x_user_id={x_user_id}")
		return RequestAuth(user_id=x_user_id, email=None, source="legacy-x-user-id", claims=None)

	return RequestAuth(user_id=None, email=None, source="anonymous", claims=None)


def get_request_auth_required(
	authorization: Optional[str] = Header(None, alias="Authorization"),
	x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
) -> RequestAuth:
	auth_ctx = get_request_auth_optional(authorization=authorization, x_user_id=x_user_id)
	if not auth_ctx.user_id:
		raise HTTPException(status_code=401, detail="Missing authentication context")
	return auth_ctx


def get_request_auth_jwt_required(
	authorization: Optional[str] = Header(None, alias="Authorization"),
) -> RequestAuth:
	token = _extract_bearer_token(authorization)
	if not token:
		raise HTTPException(status_code=401, detail="Missing bearer token")

	claims = _verify_firebase_token(token)
	token_user_id = claims.get("uid") or claims.get("user_id") or claims.get("sub")
	email = claims.get("email")
	user_id = _resolve_internal_user_id(str(email) if email else None, str(token_user_id) if token_user_id else "")

	if not user_id:
		raise HTTPException(status_code=401, detail="Bearer token missing uid claim")

	return RequestAuth(
		user_id=str(user_id),
		email=str(email) if email else None,
		source="firebase",
		claims=claims,
	)


def get_request_auth_jwt_required_from_request(request: Request) -> RequestAuth:
	authorization = request.headers.get("Authorization")
	return get_request_auth_jwt_required(authorization=authorization)


def get_request_auth_required_from_request(request: Request) -> RequestAuth:
	authorization = request.headers.get("Authorization")
	x_user_id = request.headers.get("X-User-ID")
	auth_ctx = get_request_auth_optional(authorization=authorization, x_user_id=x_user_id)
	if not auth_ctx.user_id:
		raise HTTPException(status_code=401, detail="Missing authentication context")
	return auth_ctx
