# Backend/tests/test_filename_sanitization.py
"""
Unit tests for filename sanitization and path traversal prevention.
Tests file utility methods and path confinement checks used in coach upload and connector manager.
"""

import os
import sys
import tempfile
import pytest

# Ensure Backend directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.file_utils import sanitize_filename


class TestFilenameSanitization:
    def test_basic_valid_filenames(self):
        """Standard alphanumeric filenames with extensions should be preserved."""
        assert sanitize_filename("document.pdf") == "document.pdf"
        assert sanitize_filename("annual_report_2026.xlsx") == "annual_report_2026.xlsx"
        assert sanitize_filename("team-notes.txt") == "team-notes.txt"
        assert sanitize_filename("Q1 Review Meeting.pptx") == "Q1 Review Meeting.pptx"

    def test_posix_path_traversal(self):
        """POSIX traversal sequences must be stripped to the base filename."""
        assert sanitize_filename("../../../etc/passwd") == "passwd"
        assert sanitize_filename("/var/log/syslog.log") == "syslog.log"
        assert sanitize_filename("../../../../var/www/html/shell.php") == "shell.php"
        assert sanitize_filename("subfolder/deep/doc.docx") == "doc.docx"

    def test_windows_path_traversal(self):
        """Windows traversal sequences and backslashes must be normalized and stripped."""
        assert sanitize_filename("..\\..\\..\\Windows\\System32\\cmd.exe") == "cmd.exe"
        assert sanitize_filename("C:\\Users\\admin\\secrets.env") == "secrets.env"
        assert sanitize_filename("..\\..\\boot.ini") == "boot.ini"

    def test_mixed_and_nested_traversal(self):
        """Mixed slashes and trick sequences like ....//....// must be neutralized."""
        assert sanitize_filename("....//....//nested_secret.pdf") == "nested_secret.pdf"
        assert sanitize_filename("..\\../..\\../escape.json") == "escape.json"
        assert sanitize_filename(".\\..\\/test.csv") == "test.csv"

    def test_pure_traversal_fallbacks(self):
        """Filenames that consist solely of traversal patterns must resolve to fallback."""
        assert sanitize_filename("..") == "document"
        assert sanitize_filename("...") == "document"
        assert sanitize_filename("../../../") == "document"
        assert sanitize_filename("..\\..\\..\\") == "document"
        assert sanitize_filename("/") == "document"
        assert sanitize_filename("\\") == "document"
        assert sanitize_filename("", fallback="fallback_doc") == "fallback_doc"
        assert sanitize_filename(None, fallback="fallback_doc") == "fallback_doc"

    def test_unsafe_special_characters(self):
        """Unsafe shell and filesystem characters must be replaced with underscores."""
        # Colons, semicolons, quotes, redirects, pipes, wildcards
        result = sanitize_filename('test:file;name"with|special*chars?.pdf')
        assert ":" not in result
        assert ";" not in result
        assert '"' not in result
        assert "|" not in result
        assert "*" not in result
        assert "?" not in result
        assert result.endswith(".pdf")

    def test_leading_and_trailing_dots_and_spaces(self):
        """Leading/trailing dots and whitespace should be trimmed to prevent hidden files or OS oddities."""
        assert sanitize_filename("   spaced_name.pdf   ") == "spaced_name.pdf"
        assert sanitize_filename(".hidden_file.txt") == "hidden_file.txt"
        assert sanitize_filename("trailing_dot.pdf.") == "trailing_dot.pdf"

    def test_path_confinement_guarantee(self):
        """Verify that combining TEMP_DIR with safe_filename stays strictly inside TEMP_DIR."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir_abs = os.path.abspath(temp_dir)

            malicious_inputs = [
                "../../../../evil.sh",
                "..\\..\\..\\evil.bat",
                "....//....//evil.py",
                "/etc/shadow",
                "C:\\Windows\\system.ini",
                "../../",
                "...",
                "test/../../foo.txt",
            ]

            doc_id = "00000000-0000-0000-0000-000000000001"

            for raw_input in malicious_inputs:
                clean_target = sanitize_filename(raw_input)
                safe_filename = sanitize_filename(f"{doc_id}_{clean_target}")
                temp_file_path = os.path.abspath(os.path.join(temp_dir_abs, safe_filename))

                # Confinement check
                assert temp_file_path.startswith(temp_dir_abs + os.sep) or temp_file_path == temp_dir_abs
                assert ".." not in temp_file_path.replace(temp_dir_abs, "")

