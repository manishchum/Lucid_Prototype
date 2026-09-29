import sys
import os
import asyncio

# Add parent directory to sys.path so modules can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ingestion.processed_module_rag import _clean_html_text, _chunk_text_simple, _expand_vernacular_query, _chunk_html_structure_aware
from module_chat.route import _resolve_single_module_context

def test_vernacular_query_expansion():
    user_query = "the drum is making a grinding noise"
    expanded = _expand_vernacular_query(user_query)
    assert "abnormal vibration" in expanded
    assert "bearing housing" in expanded
    print(f"[OK] test_vernacular_query_expansion PASSED: '{expanded}'")

def test_html_structure_preservation():
    sample_html = """
    <h2>Safety Regulations Chapter 1</h2>
    <p>All staff must wear protective gear including helmets and gloves at all times inside the plant.</p>
    <div class="warning">Emergency exit doors must remain unlocked during working hours.</div>
    <table><tr><th>Spec</th><th>Value</th></tr><tr><td>Torque</td><td>50 Nm</td></tr></table>
    """
    cleaned = _clean_html_text(sample_html)
    assert "Safety Regulations" in cleaned
    assert "protective gear" in cleaned
    assert "[!WARNING]" in cleaned
    assert "Torque | 50 Nm" in cleaned
    print("[OK] test_html_structure_preservation PASSED (Tables & Callout boxes preserved)")

    chunks = _chunk_html_structure_aware(sample_html, title="Plant Safety")
    assert len(chunks) > 0
    assert "section_title" in chunks[0]
    print(f"[OK] Structured Chunking generated {len(chunks)} chunks cleanly with section metadata")

async def test_module_chat_context_resolution():
    dummy_id = "00000000-0000-0000-0000-000000000000"
    res = await _resolve_single_module_context(dummy_id, "the drum is making a grinding noise")
    assert isinstance(res, dict)
    assert "title" in res
    assert "content" in res
    print("[OK] test_module_chat_context_resolution PASSED")

if __name__ == "__main__":
    test_vernacular_query_expansion()
    test_html_structure_preservation()
    asyncio.run(test_module_chat_context_resolution())
