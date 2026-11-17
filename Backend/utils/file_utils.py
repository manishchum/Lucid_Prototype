# Backend/utils/file_utils.py
"""
File Utility functions for secure filename sanitization and path traversal prevention.
"""

import os
import re


def sanitize_filename(filename: str, fallback: str = "document") -> str:
    """
    Sanitizes user-supplied filenames to eliminate directory traversal risks and illegal path characters.
    1. Normalizes path separators (converts backslashes to slashes) and extracts os.path.basename.
    2. Strips directory traversal sequences ('..').
    3. Whitelists safe filename characters (alphanumeric, dots, hyphens, underscores, spaces).
    4. Trims leading/trailing dots and whitespace to avoid hidden or empty file names.
    5. Falls back to a safe default if the filename is empty or sanitized away.
    """
    if not filename or not isinstance(filename, str):
        return fallback

    # 1. Normalize separators and strip path components using os.path.basename
    normalized = filename.replace("\\", "/").rstrip("/")
    base_name = os.path.basename(normalized)

    # 2. Strip any directory traversal patterns
    base_name = base_name.replace("..", "")

    # 3. Whitelist: allow alphanumeric, dots, hyphens, underscores, and spaces
    sanitized = re.sub(r"[^a-zA-Z0-9._\- ]", "_", base_name).strip()

    # 4. Strip leading/trailing dots and spaces (e.g. '.hidden', '..', '   ')
    sanitized = sanitized.strip(". ")

    if not sanitized:
        return fallback

    return sanitized

