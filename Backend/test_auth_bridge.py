import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from utils.auth_bridge import (
    BridgeUserContext,
    build_user_scoped_supabase_client_options,
    decode_supabase_access_token,
    ensure_supabase_access_token,
    mint_supabase_access_token,
)


class AuthBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env_patch = patch.dict(
            os.environ,
            {
                "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": "anon-key",
                "SUPABASE_JWT_SECRET": "test-super-secret-bridge-key-32b",
            },
            clear=False,
        )
        self.env_patch.start()

    def tearDown(self) -> None:
        self.env_patch.stop()

    def test_minted_token_contains_expected_claims(self) -> None:
        context = BridgeUserContext(
            user_id="11111111-1111-1111-1111-111111111111",
            email="yomit.khurana@workfloww.ai",
            company_id="22222222-2222-2222-2222-222222222222",
            firebase_uid="firebase-uid-123",
        )
        now = datetime.now(timezone.utc)

        token, expires_at = mint_supabase_access_token(context, ttl_seconds=300, now=now)
        decoded = decode_supabase_access_token(token)

        self.assertEqual(decoded["sub"], context.user_id)
        self.assertEqual(decoded["email"], context.email)
        self.assertEqual(decoded["company_id"], context.company_id)
        self.assertEqual(decoded["role"], "authenticated")
        self.assertEqual(int(decoded["exp"]), int(expires_at.timestamp()))
        self.assertGreater(int(decoded["exp"]) - int(decoded["iat"]), 0)

    def test_existing_token_is_reused_until_refresh_window(self) -> None:
        context = BridgeUserContext(
            user_id="11111111-1111-1111-1111-111111111111",
            email="yomit.khurana@workfloww.ai",
        )
        now = datetime.now(timezone.utc)
        token, _ = mint_supabase_access_token(context, ttl_seconds=300, now=now)

        reused_token, expires_at, refreshed = ensure_supabase_access_token(
            context,
            existing_token=token,
            ttl_seconds=300,
            refresh_window_seconds=60,
            now=now + timedelta(seconds=120),
        )

        self.assertEqual(reused_token, token)
        self.assertFalse(refreshed)
        self.assertGreater(expires_at, now)

    def test_token_refreshes_when_close_to_expiry(self) -> None:
        context = BridgeUserContext(
            user_id="11111111-1111-1111-1111-111111111111",
            email="yomit.khurana@workfloww.ai",
        )
        now = datetime.now(timezone.utc)
        token, _ = mint_supabase_access_token(context, ttl_seconds=120, now=now)

        refreshed_token, expires_at, refreshed = ensure_supabase_access_token(
            context,
            existing_token=token,
            ttl_seconds=300,
            refresh_window_seconds=60,
            now=now + timedelta(seconds=70),
        )

        self.assertTrue(refreshed)
        self.assertNotEqual(refreshed_token, token)
        self.assertGreater(expires_at, now)

    def test_client_options_attach_authorization_header(self) -> None:
        options = build_user_scoped_supabase_client_options("supabase-jwt")
        self.assertEqual(options.headers.get("Authorization"), "Bearer supabase-jwt")
        self.assertFalse(options.auto_refresh_token)
        self.assertFalse(options.persist_session)


if __name__ == "__main__":
    unittest.main()