import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Allow direct execution: python scripts/backfill_firebase_users.py
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.firebase_provisioning import ensure_firebase_user
from utils.supabase_client import supabase
from utils.auth import _ensure_firebase_admin_initialized


def _get_existing_firebase_uid_by_email(email: str) -> Optional[str]:
    _ensure_firebase_admin_initialized()
    from firebase_admin import auth as firebase_auth

    try:
        user = firebase_auth.get_user_by_email(email)
        return user.uid
    except firebase_auth.UserNotFoundError:
        return None


def _fetch_batch(offset: int, batch_size: int, use_server_null_filter: bool = True) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Returns (rows, used_server_null_filter).

    We attempt a server-side null filter first for efficiency. If the SDK/backend rejects
    that operator signature, we gracefully fall back to client-side null filtering.
    """
    base_query = (
        supabase
        .table("users")
        .select("user_id,email,name,is_active,firebase_uid,password")
        .eq("is_active", True)
    )

    try:
        if use_server_null_filter:
            res = base_query.is_("firebase_uid", "null").range(offset, offset + batch_size - 1).execute()
            rows = getattr(res, "data", None) or []
            return rows, True

        res = base_query.range(offset, offset + batch_size - 1).execute()
        rows = getattr(res, "data", None) or []
        rows = [r for r in rows if not r.get("firebase_uid")]
        return rows, False
    except Exception:
        # Retry without server null filter in case SDK/operator syntax differs.
        res = base_query.range(offset, offset + batch_size - 1).execute()
        rows = getattr(res, "data", None) or []
        rows = [r for r in rows if not r.get("firebase_uid")]
        return rows, False


def _link_user(user_id: str, firebase_uid: str, dry_run: bool) -> None:
    if dry_run:
        return

    (
        supabase
        .table("users")
        .update({"firebase_uid": firebase_uid})
        .eq("user_id", user_id)
        .execute()
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill Firebase users for active Supabase users missing firebase_uid."
    )
    parser.add_argument("--batch-size", type=int, default=200, help="Rows to process per page (default: 200)")
    parser.add_argument("--start-offset", type=int, default=0, help="Offset to start paging from (default: 0)")
    parser.add_argument("--max-users", type=int, default=0, help="Stop after this many processed users (0 = no limit)")
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without writing firebase_uid")
    parser.add_argument("--verbose", action="store_true", help="Print per-user processing details")
    args = parser.parse_args()

    if args.batch_size <= 0:
        raise ValueError("--batch-size must be > 0")
    if args.start_offset < 0:
        raise ValueError("--start-offset must be >= 0")
    if args.max_users < 0:
        raise ValueError("--max-users must be >= 0")

    offset = args.start_offset
    total_seen = 0
    processed = 0
    linked = 0
    skipped_no_email = 0
    failed = 0
    used_server_null_filter = True

    print(
        "[backfill] Starting Firebase user backfill "
        f"(dry_run={args.dry_run}, batch_size={args.batch_size}, start_offset={args.start_offset})"
    )
    if args.dry_run:
        print("[backfill] Dry-run mode: no Firebase users will be created and no users.firebase_uid values will be updated.")

    while True:
        rows, used_server_null_filter = _fetch_batch(
            offset=offset,
            batch_size=args.batch_size,
            use_server_null_filter=used_server_null_filter,
        )
        if not rows:
            break

        total_seen += len(rows)

        for row in rows:
            if args.max_users and processed >= args.max_users:
                print("[backfill] Reached --max-users limit. Stopping.")
                print(
                    f"[backfill] Summary: seen={total_seen}, processed={processed}, linked={linked}, "
                    f"skipped_no_email={skipped_no_email}, failed={failed}"
                )
                return 0

            user_id = row.get("user_id")
            email = (row.get("email") or "").strip().lower()
            name = row.get("name")

            if not user_id or not email:
                skipped_no_email += 1
                if args.verbose:
                    print(f"[backfill][skip] user_id={user_id} missing required email/user_id")
                continue

            processed += 1
            try:
                if args.dry_run:
                    firebase_uid = _get_existing_firebase_uid_by_email(email)
                    if args.verbose:
                        action = "link-existing" if firebase_uid else "create-and-link"
                        print(f"[backfill][dry-run] user_id={user_id} email={email} action={action}")
                    if not firebase_uid:
                        continue
                    _link_user(user_id=user_id, firebase_uid=firebase_uid, dry_run=True)
                else:
                    # Existing users do not have known plain passwords; helper will apply DEFAULT_PASSWORD.
                    firebase_uid = ensure_firebase_user(email=email, display_name=name, plain_password_or_none=None)
                    _link_user(user_id=user_id, firebase_uid=firebase_uid, dry_run=False)

                linked += 1

                if args.verbose:
                    suffix = "(dry-run)" if args.dry_run else ""
                    print(f"[backfill][ok] user_id={user_id} email={email} firebase_uid={firebase_uid} {suffix}")
            except Exception as exc:
                failed += 1
                print(f"[backfill][fail] user_id={user_id} email={email}: {exc}")

        offset += args.batch_size

    print(
        f"[backfill] Done. seen={total_seen}, processed={processed}, linked={linked}, "
        f"skipped_no_email={skipped_no_email}, failed={failed}, dry_run={args.dry_run}"
    )
    if args.dry_run:
        print("[backfill] No database writes were performed. Re-run without --dry-run to persist users.firebase_uid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
