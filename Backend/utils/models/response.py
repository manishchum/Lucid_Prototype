"""
Standardized response models for all API endpoints.
Ensures consistent response format across the application.
"""

from typing import Generic, TypeVar, Optional, Any, Dict
from pydantic import BaseModel, Field

T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    """
    Generic API response model for all endpoints.
    
    Attributes:
        success: Whether the operation was successful
        data: The actual response data (can be any type)
        error: Error message if operation failed (None if successful)
    """
    success: bool = Field(..., description="Whether the operation was successful")
    data: Optional[T] = Field(None, description="Response data")
    error: Optional[str] = Field(None, description="Error message if applicable")


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Generic paginated response model for list endpoints.
    
    Attributes:
        success: Whether the operation was successful
        data: List of items
        total: Total number of items (for pagination)
        error: Error message if operation failed
    """
    success: bool = Field(..., description="Whether the operation was successful")
    data: Optional[list[T]] = Field(None, description="List of items")
    total: Optional[int] = Field(None, description="Total count of items")
    error: Optional[str] = Field(None, description="Error message if applicable")


# Specialized response models for common types
class SuccessResponse(BaseModel):
    """Response for operations that only return success/error status."""
    success: bool
    error: Optional[str] = None


class UserResponse(BaseModel):
    """Response containing user data."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class CompanyResponse(BaseModel):
    """Response containing company data."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class AssessmentResponse(BaseModel):
    """Response containing assessment data."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ContentGenerationResponse(BaseModel):
    """Response for content generation operations."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ErrorDetail(BaseModel):
    """Detailed error response."""
    success: bool = False
    data: None = None
    error: str
    error_code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


# Helper functions to create responses
def success_response(data: Any = None) -> Dict[str, Any]:
    """Create a successful response."""
    return {"success": True, "data": data, "error": None}


def error_response(error: str, data: Any = None) -> Dict[str, Any]:
    """Create an error response."""
    return {"success": False, "data": data, "error": error}
