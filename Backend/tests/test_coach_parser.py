# Backend/tests/test_coach_parser.py
"""
Unit tests for the Performance Coach Multi-Format Parser and Ingestion logic.
"""

import os
import tempfile
import pytest
import pandas as pd

from ingestion.coach_parser import (
    clean_text,
    chunk_words,
    match_employee_in_text,
    parse_spreadsheet,
    parse_manual_upload
)


def test_clean_text():
    dirty = "This is a test....\n\n\n\nwith extra spaces   and \t tabs."
    cleaned = clean_text(dirty)
    assert "...." not in cleaned
    assert "\t" not in cleaned
    assert "\n\n\n" not in cleaned
    assert "with extra spaces and tabs." in cleaned


def test_chunk_words():
    text = " ".join([f"word{i}" for i in range(100)])
    chunks = chunk_words(text, size=30, overlap=5)
    assert len(chunks) >= 3
    for c in chunks:
        assert len(c.split()) <= 30


def test_match_employee_in_text():
    roster = [
        {"user_id": "u1", "name": "Sarah Jenkins", "email": "sarah@example.com"},
        {"user_id": "u2", "name": "Alex Rivera", "email": "alex@example.com"}
    ]
    
    text1 = "In Q3, Sarah Jenkins exceeded her sales targets by 20%."
    matched1 = match_employee_in_text(text1, roster)
    assert matched1 is not None
    assert matched1["user_id"] == "u1"
    
    text2 = "General department guidelines for all staff."
    matched2 = match_employee_in_text(text2, roster)
    assert matched2 is None


def test_parse_csv_spreadsheet():
    # Create temporary CSV
    data = {
        "Employee Name": ["Sarah Jenkins", "Alex Rivera"],
        "Quarter": ["Q3 2024", "Q3 2024"],
        "Goal": ["Reduce latency by 20%", "Close 15 Enterprise accounts"],
        "Status": ["Exceeded (28%)", "Achieved (16 accounts)"],
        "Rating": [4.8, 4.5]
    }
    df = pd.DataFrame(data)
    
    roster = [
        {"user_id": "emp_sarah", "name": "Sarah Jenkins"},
        {"user_id": "emp_alex", "name": "Alex Rivera"}
    ]
    
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w", newline="") as f:
        df.to_csv(f.name, index=False)
        temp_csv_path = f.name
        
    try:
        chunks, spreadsheet_rows, metadata = parse_manual_upload(
            file_path=temp_csv_path,
            file_name="Q3_Performance.csv",
            file_type="csv",
            employee_roster=roster
        )
        
        # Verify summary chunk exists
        summary_chunks = [c for c in chunks if c["chunk_type"] == "sheet_summary"]
        assert len(summary_chunks) == 1
        
        # Verify row chunks exist
        row_chunks = [c for c in chunks if c["chunk_type"] == "table_row"]
        assert len(row_chunks) == 2
        
        # Check first row citation and employee resolution
        sarah_chunk = row_chunks[0]
        assert sarah_chunk["target_employee_id"] == "emp_sarah"
        assert sarah_chunk["citation"]["file_name"] == "Q3_Performance.csv"
        assert sarah_chunk["citation"]["row_number"] == 2
        assert "Reduce latency by 20%" in sarah_chunk["content"]
        
        # Check structured spreadsheet rows
        assert len(spreadsheet_rows) == 2
        assert spreadsheet_rows[0]["target_employee_id"] == "emp_sarah"
        assert spreadsheet_rows[0]["row_data"]["Rating"] == "4.8"
        assert spreadsheet_rows[0]["row_index"] == 2

    finally:
        if os.path.exists(temp_csv_path):
            os.remove(temp_csv_path)
