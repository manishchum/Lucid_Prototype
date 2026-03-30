"""
Custom exception classes for consistent error handling.
"""

from typing import Optional, Any, Dict


class ApiException(Exception):
    """Base exception for API errors."""
    
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        error_code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize API exception.
        
        Args:
            message: Human-readable error message
            status_code: HTTP status code (default: 500)
            error_code: Error code for client handling (optional)
            details: Additional error details (optional)
        """
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self):
        """Convert exception to response dictionary."""
        return {
            "success": False,
            "data": None,
            "error": self.message,
            "error_code": self.error_code,
            "details": self.details if self.details else None
        }


class ValidationError(ApiException):
    """Raised when input validation fails."""
    
    def __init__(self, message: str, field: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        if details is None:
            details = {}
        if field:
            details["field"] = field
        super().__init__(message, 400, "VALIDATION_ERROR", details)


class AuthenticationError(ApiException):
    """Raised when authentication fails."""
    
    def __init__(self, message: str = "Authentication required", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 401, "AUTH_ERROR", details)


class AuthorizationError(ApiException):
    """Raised when user doesn't have permission."""
    
    def __init__(self, message: str = "Insufficient permissions", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 403, "PERMISSION_ERROR", details)


class NotFoundError(ApiException):
    """Raised when a resource is not found."""
    
    def __init__(
        self,
        resource_type: str,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        if details is None:
            details = {}
        details["resource_type"] = resource_type
        if resource_id:
            details["resource_id"] = resource_id
        
        message = f"{resource_type} not found"
        if resource_id:
            message += f" (ID: {resource_id})"
        
        super().__init__(message, 404, "NOT_FOUND_ERROR", details)


class ConflictError(ApiException):
    """Raised when a resource already exists."""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 409, "CONFLICT_ERROR", details)


class DatabaseError(ApiException):
    """Raised when a database operation fails."""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 500, "DATABASE_ERROR", details)


class ExternalApiError(ApiException):
    """Raised when an external API call fails."""
    
    def __init__(
        self,
        message: str,
        api_name: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        if details is None:
            details = {}
        if api_name:
            details["api_name"] = api_name
        super().__init__(message, 502, "EXTERNAL_API_ERROR", details)


class RateLimitError(ApiException):
    """Raised when rate limit is exceeded."""
    
    def __init__(self, message: str = "Rate limit exceeded", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 429, "RATE_LIMIT_ERROR", details)


class InternalServerError(ApiException):
    """Raised when an unexpected server error occurs."""
    
    def __init__(self, message: str = "Internal server error", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, 500, "INTERNAL_ERROR", details)
