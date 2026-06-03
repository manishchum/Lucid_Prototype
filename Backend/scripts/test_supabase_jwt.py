from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_ROOT / ".env"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(dotenv_path=ENV_PATH, override=True)

from utils.auth_bridge import (  # noqa: E402
    BridgeUserContext,
    get_supabase_anon_key,
    get_supabase_jwt_secret,
    get_supabase_service_role_key,
    get_supabase_url,
    mint_supabase_access_token,
)


def _mask(value: str, *, visible: int = 4) -> str:
    value = value or ""
    if len(value) <= visible * 2:
        return "*" * len(value)
    return f"{value[:visible]}...{value[-visible:]}"


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def _print_json(label: str, value: object) -> None:
    print(f"{label}: {json.dumps(value, sort_keys=True, default=str)}")


def _build_context(args: argparse.Namespace) -> BridgeUserContext:
    user_id = args.user_id or str(uuid4())
    email = args.email or "jwt-check@example.com"
    company_id = args.company_id or None
    firebase_uid = args.firebase_uid or "firebase-jwt-check"

    return BridgeUserContext(
        user_id=user_id,
        email=email,
        company_id=company_id,
        firebase_uid=firebase_uid,
        claims={
            "sub": user_id,
            "email": email,
            "company_id": company_id,
            "firebase_uid": firebase_uid,
        },
    )


def _local_verify(token: str) -> dict[str, object]:
    secret = get_supabase_jwt_secret()
    header = jwt.get_unverified_header(token)
    payload = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience="authenticated",
        leeway=30,
        options={"require": ["sub", "role", "email", "exp", "iat"]},
    )
    return {
        "header": header,
        "payload": payload,
        "secret_sha256_12": _fingerprint(secret),
        "secret_length": len(secret),
    }


def _remote_request(
    *,
    url: str,
    table: str,
    select: str,
    limit: int,
    apikey: str,
    authorization: str | None,
) -> dict[str, object]:
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}"
    params = {"select": select, "limit": str(limit)}
    headers = {
        "apikey": apikey,
        "Accept": "application/json",
    }
    if authorization:
        headers["Authorization"] = authorization

    response = httpx.get(endpoint, params=params, headers=headers, timeout=30)
    body_text = response.text
    try:
        body = response.json()
    except Exception:
        body = body_text

    return {
        "url": str(response.request.url),
        "status_code": response.status_code,
        "ok": response.is_success,
        "body": body,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnose Supabase JWT bridge tokens and PGRST301 failures."
    )
    parser.add_argument("--user-id", help="UUID to use for the sub claim. Defaults to a random UUID.")
    parser.add_argument("--email", help="Email to embed in the token.")
    parser.add_argument("--company-id", help="Optional company_id claim.")
    parser.add_argument("--firebase-uid", help="Optional firebase_uid claim.")
    parser.add_argument("--ttl-seconds", type=int, default=300, help="Token TTL in seconds (default: 300).")
    parser.add_argument("--issuer", default="lucid-backend", help="JWT issuer to embed in the token.")
    parser.add_argument("--audience", default="authenticated", help="JWT audience to embed in the token.")
    parser.add_argument("--table", default="users", help="Supabase table to query during remote checks.")
    parser.add_argument("--select", default="user_id", help="PostgREST select clause for remote checks.")
    parser.add_argument("--limit", type=int, default=1, help="Row limit for remote checks.")
    parser.add_argument(
        "--remote-check",
        action="store_true",
        help="Call Supabase REST with the minted token and with the service-role key.",
    )
    args = parser.parse_args()

    supabase_url = get_supabase_url()
    anon_key = get_supabase_anon_key()
    service_role_key = get_supabase_service_role_key()
    secret = get_supabase_jwt_secret()
    context = _build_context(args)

    token, expires_at = mint_supabase_access_token(
        context,
        ttl_seconds=args.ttl_seconds,
        issuer=args.issuer,
        audience=args.audience,
    )

    print("Supabase JWT diagnostic")
    print(f"backend_root: {BACKEND_ROOT}")
    print(f"supabase_url: {supabase_url}")
    print(f"anon_key_prefix: {_mask(anon_key)}")
    print(f"service_role_key_prefix: {_mask(service_role_key)}")
    print(f"jwt_secret_present: {bool(secret)}")
    print(f"jwt_secret_sha256_12: {_fingerprint(secret)}")
    print(f"token_expires_at_utc: {expires_at.isoformat()}")
    _print_json(
        "minted_claims",
        {
            "sub": context.user_id,
            "email": context.email,
            "company_id": context.company_id,
            "firebase_uid": context.firebase_uid,
            "aud": args.audience,
            "iss": args.issuer,
            "role": "authenticated",
        },
    )

    try:
        local = _local_verify(token)
        _print_json("jwt_header", local["header"])
        _print_json("jwt_verified_payload", local["payload"])
        print("local_verify: ok")
    except Exception as exc:
        print(f"local_verify: failed: {exc}")
        return 1

    if not args.remote_check:
        print("remote_check: skipped (use --remote-check)")
        return 0

    try:
        user_result = _remote_request(
            url=supabase_url,
            table=args.table,
            select=args.select,
            limit=args.limit,
            apikey=anon_key,
            authorization=f"Bearer {token}",
        )
        _print_json("remote_user_token_result", user_result)

        service_result = _remote_request(
            url=supabase_url,
            table=args.table,
            select=args.select,
            limit=args.limit,
            apikey=service_role_key,
            authorization=None,
        )
        _print_json("remote_service_role_result", service_result)
    except Exception as exc:
        print(f"remote_check: failed: {exc}")
        return 2

    status = int(user_result["status_code"])
    body = user_result["body"]
    if status == 401 and isinstance(body, dict) and body.get("code") == "PGRST301":
        print(
            "diagnosis: Supabase rejected the JWT signature/key. "
            "The running backend secret or token algorithm does not match the project's JWT setup."
        )
        return 3

    print("diagnosis: user token reached Supabase successfully or failed for a non-JWT reason.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())