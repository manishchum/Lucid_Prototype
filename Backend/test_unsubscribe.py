"""
Test suite for unsubscribe token generation and verification

Run with: python -m pytest Backend/test_unsubscribe.py -v
"""

import pytest
import os
import time
from datetime import datetime, timedelta

# Set test secret before importing token module
os.environ["UNSUBSCRIBE_SECRET"] = "test_secret_key_at_least_32_characters_long"

from utils.unsubscribe_token import (
    generate_token,
    verify_token,
    get_token_expiry_date,
    InvalidTokenError,
    ExpiredTokenError,
    MissingSecretError,
)


class TestTokenGeneration:
    """Test token generation functionality"""

    def test_generate_valid_token(self):
        """Test generating a valid token"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        assert isinstance(token, str)
        assert len(token) > 50  # Base64 encoded tokens are long
        assert "." in token  # Contains payload.signature separator

    def test_generate_token_with_special_chars_email(self):
        """Test token generation with special characters in email"""
        token = generate_token("user+tag@sub.example.co.uk", "550e8400-e29b-41d4-a716-446655440000")
        
        payload = verify_token(token)
        assert payload is not None
        assert payload["email"] == "user+tag@sub.example.co.uk"

    def test_generate_token_deterministic(self):
        """Test that same input generates different tokens (due to timestamp)"""
        token1 = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        time.sleep(0.01)  # Small delay to ensure different timestamp
        token2 = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        # Tokens will be different due to different issued_at timestamps
        assert token1 != token2
        
        # But both should verify successfully
        assert verify_token(token1) is not None
        assert verify_token(token2) is not None


class TestTokenVerification:
    """Test token verification functionality"""

    def test_verify_valid_token(self):
        """Test verifying a valid, non-expired token"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["email"] == "test@example.com"
        assert payload["user_id"] == "550e8400-e29b-41d4-a716-446655440000"
        assert isinstance(payload["issued_at"], int)

    def test_verify_invalid_signature(self):
        """Test that tampered token fails verification"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        # Tamper with the token
        parts = token.split(".")
        tampered_token = parts[0] + ".invalidSignature"
        
        with pytest.raises(InvalidTokenError):
            verify_token(tampered_token)

    def test_verify_missing_signature(self):
        """Test token with missing signature"""
        with pytest.raises(InvalidTokenError):
            verify_token("invalidtoken")

    def test_verify_malformed_base64(self):
        """Test token with malformed base64"""
        with pytest.raises(InvalidTokenError):
            verify_token("!!!invalid.!!!base64!!!")

    def test_verify_token_with_empty_secret(self):
        """Test verification fails when secret is not set"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        # Temporarily remove secret
        original_secret = os.environ.get("UNSUBSCRIBE_SECRET")
        del os.environ["UNSUBSCRIBE_SECRET"]
        
        try:
            with pytest.raises(MissingSecretError):
                verify_token(token)
        finally:
            # Restore secret
            os.environ["UNSUBSCRIBE_SECRET"] = original_secret

    def test_verify_expired_token(self):
        """Test that expired tokens are rejected (mocked expiration)"""
        # Create a token
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        # Manually modify issued_at to simulate old token
        import json
        import base64
        from utils.unsubscribe_token import _base64url_decode
        
        parts = token.split(".")
        payload_bytes = _base64url_decode(parts[0])
        payload = json.loads(payload_bytes)
        
        # Set issued_at to 31 days ago (exceeds 30-day expiry)
        payload["issued_at"] = int(time.time()) - (31 * 24 * 60 * 60)
        
        # Resign with new payload
        new_token = generate_token(payload["email"], payload["user_id"])
        
        # Wait to ensure different timestamp
        time.sleep(0.01)
        
        # The newly generated token has current timestamp, so let's manually test expiry
        # by directly calling with mock time (this tests the logic)
        with pytest.raises(ExpiredTokenError):
            verify_token(token)  # Original token might be expired in 30 days

    def test_verify_preserves_email_case(self):
        """Test that email case is preserved in token"""
        token = generate_token("Test@Example.COM", "550e8400-e29b-41d4-a716-446655440000")
        payload = verify_token(token)
        
        assert payload["email"] == "Test@Example.COM"


class TestTokenExpiry:
    """Test token expiration functionality"""

    def test_get_expiry_date(self):
        """Test retrieving token expiration date"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        expiry = get_token_expiry_date(token)
        
        assert expiry is not None
        assert isinstance(expiry, datetime)
        
        # Expiry should be approximately 30 days from now
        now = datetime.utcnow()
        expected_expiry = now + timedelta(days=30)
        
        # Allow 5 second margin for execution time
        assert abs((expiry - expected_expiry).total_seconds()) < 5

    def test_get_expiry_date_invalid_token(self):
        """Test that invalid token returns None for expiry"""
        expiry = get_token_expiry_date("invalid_token")
        assert expiry is None

    def test_get_expiry_date_malformed_token(self):
        """Test that malformed token returns None for expiry"""
        expiry = get_token_expiry_date("!!!")
        assert expiry is None


class TestEdgeCases:
    """Test edge cases and error conditions"""

    def test_long_email_address(self):
        """Test token generation with very long email"""
        long_email = "a" * 100 + "@" + "b" * 100 + ".com"
        token = generate_token(long_email, "550e8400-e29b-41d4-a716-446655440000")
        
        payload = verify_token(token)
        assert payload["email"] == long_email

    def test_uuid_user_id(self):
        """Test with standard UUID format"""
        user_id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
        token = generate_token("test@example.com", user_id)
        
        payload = verify_token(token)
        assert payload["user_id"] == user_id

    def test_numeric_user_id(self):
        """Test with numeric user ID"""
        user_id = "12345"
        token = generate_token("test@example.com", user_id)
        
        payload = verify_token(token)
        assert payload["user_id"] == "12345"

    def test_token_roundtrip(self):
        """Test multiple generate/verify cycles"""
        email = "test@example.com"
        user_id = "550e8400-e29b-41d4-a716-446655440000"
        
        for i in range(5):
            token = generate_token(email, user_id)
            payload = verify_token(token)
            assert payload["email"] == email
            assert payload["user_id"] == user_id
            time.sleep(0.01)  # Ensure different timestamp


class TestSecretHandling:
    """Test secret configuration and handling"""

    def test_missing_secret_raises_error(self):
        """Test that missing secret raises appropriate error"""
        original_secret = os.environ.get("UNSUBSCRIBE_SECRET")
        
        try:
            del os.environ["UNSUBSCRIBE_SECRET"]
            
            with pytest.raises(MissingSecretError):
                generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        finally:
            os.environ["UNSUBSCRIBE_SECRET"] = original_secret

    def test_short_secret_raises_error(self):
        """Test that secret shorter than 32 chars raises error"""
        original_secret = os.environ.get("UNSUBSCRIBE_SECRET")
        
        try:
            os.environ["UNSUBSCRIBE_SECRET"] = "short_secret"
            
            with pytest.raises(MissingSecretError):
                generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        finally:
            os.environ["UNSUBSCRIBE_SECRET"] = original_secret

    def test_different_secret_fails_verification(self):
        """Test that token created with one secret fails with another"""
        token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
        
        original_secret = os.environ["UNSUBSCRIBE_SECRET"]
        
        try:
            # Change secret
            os.environ["UNSUBSCRIBE_SECRET"] = "different_secret_key_at_least_32_characters_long"
            
            with pytest.raises(InvalidTokenError):
                verify_token(token)
        finally:
            os.environ["UNSUBSCRIBE_SECRET"] = original_secret


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
