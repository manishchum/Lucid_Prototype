"""
Structured error logging utility for consistent error handling.
"""

import logging
import traceback
from typing import Optional, Any, Dict
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


class ErrorLogger:
    """Utility class for structured error logging."""
    
    @staticmethod
    def log_error(
        error_msg: str,
        error_type: str = "GENERAL_ERROR",
        status_code: int = 500,
        context: Optional[Dict[str, Any]] = None,
        exception: Optional[Exception] = None
    ) -> Dict[str, Any]:
        """
        Log an error with structured information.
        
        Args:
            error_msg: Human-readable error message
            error_type: Type of error (e.g., "VALIDATION_ERROR", "AUTH_ERROR", "DB_ERROR")
            status_code: HTTP status code
            context: Additional context information
            exception: The exception object if available
            
        Returns:
            Dictionary with error details for HTTP response
        """
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "error_message": error_msg,
            "error_type": error_type,
            "status_code": status_code,
            "context": context or {}
        }
        
        if exception:
            log_data["exception_type"] = type(exception).__name__
            log_data["exception_message"] = str(exception)
            log_data["traceback"] = traceback.format_exc()
        
        # Log at appropriate level
        if status_code >= 500:
            logger.error(f"[{error_type}] {error_msg}", extra=log_data)
        elif status_code >= 400:
            logger.warning(f"[{error_type}] {error_msg}", extra=log_data)
        else:
            logger.info(f"[{error_type}] {error_msg}", extra=log_data)
        
        return log_data
    
    @staticmethod
    def log_validation_error(error_msg: str, field: Optional[str] = None, context: Optional[Dict[str, Any]] = None):
        """Log a validation error."""
        ctx = context or {}
        if field:
            ctx["field"] = field
        return ErrorLogger.log_error(error_msg, "VALIDATION_ERROR", 400, ctx)
    
    @staticmethod
    def log_auth_error(error_msg: str, context: Optional[Dict[str, Any]] = None):
        """Log an authentication/authorization error."""
        return ErrorLogger.log_error(error_msg, "AUTH_ERROR", 403, context)
    
    @staticmethod
    def log_not_found_error(resource_type: str, resource_id: Optional[str] = None):
        """Log a not found error."""
        msg = f"{resource_type} not found"
        if resource_id:
            msg += f" (ID: {resource_id})"
        return ErrorLogger.log_error(msg, "NOT_FOUND_ERROR", 404, {"resource_type": resource_type, "resource_id": resource_id})
    
    @staticmethod
    def log_database_error(error_msg: str, exception: Optional[Exception] = None, context: Optional[Dict[str, Any]] = None):
        """Log a database error."""
        return ErrorLogger.log_error(error_msg, "DATABASE_ERROR", 500, context, exception)
    
    @staticmethod
    def log_external_api_error(error_msg: str, api_name: str, exception: Optional[Exception] = None, context: Optional[Dict[str, Any]] = None):
        """Log an external API error."""
        ctx = context or {}
        ctx["api_name"] = api_name
        return ErrorLogger.log_error(error_msg, "EXTERNAL_API_ERROR", 502, ctx, exception)
    
    @staticmethod
    def log_unhandled_error(exception: Exception, context: Optional[Dict[str, Any]] = None):
        """Log an unhandled error."""
        return ErrorLogger.log_error(
            f"Unhandled exception: {str(exception)}",
            "UNHANDLED_ERROR",
            500,
            context,
            exception
        )
