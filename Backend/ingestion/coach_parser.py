# Backend/ingestion/coach_parser.py
"""
Universal Multi-Format Document & Spreadsheet Parser for Employee Performance Coach.
Supports: PDF, DOCX, DOC, CSV, XLSX, XLS, PPTX, PPT.
Extracts clean text chunks with strict proof coordinates (page, slide, sheet, row).
"""

import os
import re
import datetime
from typing import List, Dict, Any, Tuple, Optional
import pandas as pd

# Word document parsing
try:
    import docx
except ImportError:
    docx = None

# PDF parsing
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

# PowerPoint parsing
try:
    import pptx
except ImportError:
    pptx = None


def clean_text(text: str) -> str:
    """Normalize whitespace and remove excessive formatting artifacts."""
    if not text:
        return ""
    text = re.sub(r'[\r\t]+', ' ', text)
    text = re.sub(r'\.{3,}', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ ]{2,}', ' ', text)
    return text.strip()


def chunk_words(text: str, size: int = 300, overlap: int = 40) -> List[str]:
    """Split text into word-based chunks with overlap."""
    words = text.split()
    if len(words) <= size:
        return [text] if text.strip() else []
    
    chunks = []
    step = max(1, size - overlap)
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + size])
        if chunk.strip():
            chunks.append(chunk)
        i += step
    return chunks


def match_employee_in_text(
    text: str,
    employee_roster: List[Dict[str, Any]],
    strict_full_name: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Check if any known company employee name appears in the text block or row.
    
    Rules for high confidence:
      - strict_full_name=True (Multi-Employee Sheet Mode / General Document Scanning):
          Requires high-confidence full name (at least 2 words, e.g. first + last name, length >= 5).
          Prevents accidental matches on common single words like 'Kumar', 'Singh', 'May', 'Admin'.
      - strict_full_name=False (Targeted Cell under an Employee/User column):
          Allows matching 2-word names anywhere in the cell, or single-word names if the cell explicitly
          equals that single name.
    """
    if not text or not employee_roster:
        return None
        
    text_clean = text.strip()
    text_lower = text_clean.lower()
    
    # Generic administrative tokens that should never trigger an employee match
    SYSTEM_EXCLUSIONS = {
        "admin", "administrator", "user", "test", "staff", "employee", "person", "manager", "lead",
        "team", "others", "none", "null", "undefined", "total", "overall", "general", "supervisor"
    }

    for emp in employee_roster:
        raw_name = emp.get("name") or ""
        emp_name = raw_name.strip()
        emp_name_lower = emp_name.lower()
        
        if not emp_name_lower or emp_name_lower in SYSTEM_EXCLUSIONS:
            continue
            
        name_parts = emp_name_lower.split()
        
        if strict_full_name:
            # Multi-Employee Mode: MUST have at least 2 words (e.g., First Last) and >= 5 chars
            if len(name_parts) < 2 or len(emp_name_lower) < 5:
                continue
            pattern = r'\b' + re.escape(emp_name_lower) + r'\b'
            if re.search(pattern, text_lower):
                return emp
        else:
            # Cell in an employee column
            if len(name_parts) >= 2 and len(emp_name_lower) >= 5:
                pattern = r'\b' + re.escape(emp_name_lower) + r'\b'
                if re.search(pattern, text_lower):
                    return emp
            elif len(name_parts) == 1 and len(emp_name_lower) >= 3:
                # Single-word name: only match if cell matches name directly
                pattern = r'^' + re.escape(emp_name_lower) + r'(\s+.*|\(.*\))?$'
                if re.match(pattern, text_lower):
                    return emp
                    
    return None


def resolve_employee_name(
    employee_id: Optional[str],
    employee_roster: Optional[List[Dict[str, Any]]]
) -> Optional[str]:
    """Resolves an employee ID into their full name from the company roster."""
    if not employee_id or not employee_roster:
        return None
    for emp in employee_roster:
        if emp.get("user_id") == employee_id:
            return emp.get("name") or emp.get("email")
    return None


def detect_document_period(file_name: str, sample_text: Optional[str] = None) -> Optional[str]:
    """
    Intelligently extracts the reporting/evaluation period from the filename or text content.
    Examples:
      - Quarters: 'Q3 2024', 'Q3_2026', '2026-Q1', 'H1 2026'
      - Months: 'October 2026', 'Oct 2026', 'Oct-2026', '2026-10'
      - Fiscal Years / Sprints: 'FY26', 'FY 2025', 'Sprint 42', 'Annual 2026'
    """
    targets = [file_name]
    if sample_text:
        targets.append(sample_text[:3000])

    months_map = {
        "jan": "January", "feb": "February", "mar": "March", "apr": "April",
        "may": "May", "jun": "June", "jul": "July", "aug": "August",
        "sep": "September", "oct": "October", "nov": "November", "dec": "December"
    }

    for text in targets:
        if not text:
            continue

        # 1. Quarters & Halves with year (e.g. Q3 2026, Q3_2026, 2026-Q3, H1 2025)
        m = re.search(r'\b([Qq][1-4]|[Hh][1-2])[\s\-_]*(20\d{2}|FY\d{2})\b', text)
        if m:
            return f"{m.group(1).upper()} {m.group(2).upper()}"

        m = re.search(r'\b(20\d{2}|FY\d{2})[\s\-_]*([Qq][1-4]|[Hh][1-2])\b', text)
        if m:
            return f"{m.group(2).upper()} {m.group(1).upper()}"

        # 2. Month + Year (e.g. October 2026, Oct-2026, Oct 2026)
        m = re.search(
            r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s\-_]*(20\d{2})\b',
            text,
            re.IGNORECASE
        )
        if m:
            month_key = m.group(1).lower()[:3]
            norm_month = months_map.get(month_key, m.group(1).capitalize())
            return f"{norm_month} {m.group(2)}"

        # 3. Year-Month ISO style (e.g. 2026-10, 2026_04)
        m = re.search(r'\b(20\d{2})[\-_](0[1-9]|1[0-2])\b', text)
        if m:
            year = m.group(1)
            month_num = int(m.group(2))
            month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
            return f"{month_names[month_num - 1]} {year}"

        # 4. Sprints & Cycles (e.g. Sprint 42, Sprint-12, Cycle 4)
        m = re.search(r'\b(Sprint|Cycle)[\s\-_]*(\d+)\b', text, re.IGNORECASE)
        if m:
            return f"{m.group(1).capitalize()} {m.group(2)}"

        # 5. Fiscal Year / Annual (e.g. FY26, FY 2025, Annual 2024)
        m = re.search(r'\b(FY\s*20?\d{2}|Annual\s*20\d{2})\b', text, re.IGNORECASE)
        if m:
            return m.group(1).upper()

    return None


def build_contextual_header(
    file_name: str,
    file_type: str,
    employee_name: Optional[str] = None,
    period: Optional[str] = None,
    source_coordinate: Optional[str] = None
) -> str:
    """
    Constructs a standardized, high-density contextual prefix for vector embeddings and agent reasoning.
    Format:
      [Context | Document: <file_name> | Employee: <name> | Period: <period> | Source: <coordinate>]
    """
    parts = [f"Document: {file_name}"]

    if employee_name:
        parts.append(f"Employee: {employee_name}")
    else:
        parts.append("Scope: Team / Company-Wide")

    if period:
        parts.append(f"Period: {period}")

    if source_coordinate:
        parts.append(f"Source: {source_coordinate}")

    return f"[Context | {' | '.join(parts)}]\n"



def format_as_markdown_table(rows: List[List[Any]]) -> str:
    """
    Converts an arbitrary 2D grid of rows and cells into a clean, GitHub-flavored Markdown table.
    Normalizes whitespace, flattens line breaks within cells, and escapes pipe symbols.
    Example output:
      | Competency | Score (1-5) | Evaluator Comments |
      | --- | --- | --- |
      | Strategic Thinking | 4.2 | Proactive in planning |
    """
    if not rows:
        return ""

    cleaned_grid: List[List[str]] = []
    for row in rows:
        if not row:
            continue
        cleaned_row = []
        for cell in row:
            if cell is None:
                val = ""
            else:
                val = str(cell).replace("\r", " ").replace("\n", " ").strip()
                val = re.sub(r"\s+", " ", val)
                val = val.replace("|", "\\|")
            cleaned_row.append(val)
        if any(cleaned_row):
            cleaned_grid.append(cleaned_row)

    if not cleaned_grid:
        return ""

    max_cols = max(len(r) for r in cleaned_grid)
    if max_cols == 0:
        return ""

    # Pad rows to ensure uniform column width
    for r in cleaned_grid:
        while len(r) < max_cols:
            r.append("")

    header_cells = cleaned_grid[0]
    header_row = [c if c else f"Column {idx + 1}" for idx, c in enumerate(header_cells)]
    separator_row = ["---"] * max_cols

    md_lines = [
        "| " + " | ".join(header_row) + " |",
        "| " + " | ".join(separator_row) + " |"
    ]

    for data_row in cleaned_grid[1:]:
        md_lines.append("| " + " | ".join(data_row) + " |")

    return "\n".join(md_lines)


def extract_pdf_page_tables(page: Any) -> Tuple[List[str], List[Any]]:
    """
    Extracts all structured tables from a PyMuPDF page as Markdown tables using page.find_tables().
    Returns (list_of_markdown_tables, list_of_table_bounding_boxes).
    """
    markdown_tables: List[str] = []
    table_bboxes: List[Any] = []

    if not hasattr(page, "find_tables"):
        return markdown_tables, table_bboxes

    try:
        tabs = page.find_tables()
        if not tabs or not getattr(tabs, "tables", None):
            return markdown_tables, table_bboxes

        for tab in tabs.tables:
            raw_rows = tab.extract()
            if raw_rows and len(raw_rows) >= 1:
                md_tab = format_as_markdown_table(raw_rows)
                if md_tab:
                    markdown_tables.append(md_tab)
                    if hasattr(tab, "bbox"):
                        table_bboxes.append(tab.bbox)
    except Exception as e:
        print(f"[COACH PARSER] Notice: PyMuPDF table extraction encountered: {e}")

    return markdown_tables, table_bboxes


# ============================================================================
# 1. PDF PARSER (Preserves Page Number & Section Context)
# ============================================================================
def parse_pdf(
    file_path: str,
    file_name: str,
    employee_roster: List[Dict[str, Any]] = None,
    target_employee_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if not fitz:
        raise ImportError("PyMuPDF (fitz) is required for PDF parsing.")
    
    doc = fitz.open(file_path)
    chunks = []
    
    parent_emp_name = resolve_employee_name(target_employee_id, employee_roster)
    
    # Collect sample text from first 3 pages for period extraction
    sample_text = ""
    for p_idx in range(min(3, len(doc))):
        sample_text += clean_text(doc[p_idx].get_text("text")) + " "
    doc_period = detect_document_period(file_name, sample_text)
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_num = page_idx + 1

        # 1. Extract structured tables as clean Markdown tables
        md_tables, table_bboxes = extract_pdf_page_tables(page)
        for t_idx, md_table in enumerate(md_tables, start=1):
            if target_employee_id:
                table_emp_id = target_employee_id
                table_emp_name = parent_emp_name
            else:
                matched_emp = match_employee_in_text(md_table, employee_roster, strict_full_name=True)
                table_emp_id = matched_emp.get("user_id") if matched_emp else None
                table_emp_name = matched_emp.get("name") if matched_emp else None

            t_header = build_contextual_header(
                file_name=file_name,
                file_type="pdf",
                employee_name=table_emp_name,
                period=doc_period,
                source_coordinate=f"Page {page_num} - Table {t_idx}"
            )
            chunks.append({
                "content": f"{t_header}[Table {t_idx} (Page {page_num})]\n{md_table}",
                "chunk_type": "table_row",
                "target_employee_id": table_emp_id,
                "citation": {
                    "file_name": file_name,
                    "file_type": "pdf",
                    "page_number": page_num,
                    "slide_number": None,
                    "sheet_name": None,
                    "row_number": None,
                    "section_title": f"Page {page_num} - Table {t_idx}",
                    "evaluator_name": None,
                    "eval_period": doc_period
                }
            })

        # 2. Extract remaining narrative text (excluding table bounding boxes to avoid messy duplicate text)
        if table_bboxes:
            try:
                blocks = page.get_text("blocks")
                narrative_blocks = []
                for b in blocks:
                    if len(b) >= 5 and b[6] == 0:  # block_type 0 is text
                        bx0, by0, bx1, by1 = b[:4]
                        bcx, bcy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
                        in_table = any(tx0 <= bcx <= tx1 and ty0 <= bcy <= ty1 for tx0, ty0, tx1, ty1 in table_bboxes)
                        if not in_table:
                            txt = clean_text(b[4])
                            if txt:
                                narrative_blocks.append(txt)
                page_text = "\n\n".join(narrative_blocks).strip()
            except Exception:
                page_text = clean_text(page.get_text("text"))
        else:
            page_text = clean_text(page.get_text("text"))
        
        if not page_text:
            continue
        
        # Determine employee identity:
        # Parent Inheritance if target_employee_id selected; else high-confidence roster match
        if target_employee_id:
            emp_id = target_employee_id
            emp_name = parent_emp_name
        else:
            matched_emp = match_employee_in_text(page_text, employee_roster, strict_full_name=True)
            emp_id = matched_emp.get("user_id") if matched_emp else None
            emp_name = matched_emp.get("name") if matched_emp else None
        
        # Split long pages into digestible chunks
        sub_chunks = chunk_words(page_text, size=300, overlap=40)
        for sc in sub_chunks:
            header = build_contextual_header(
                file_name=file_name,
                file_type="pdf",
                employee_name=emp_name,
                period=doc_period,
                source_coordinate=f"Page {page_num}"
            )
            chunks.append({
                "content": f"{header}{sc}",
                "chunk_type": "text",
                "target_employee_id": emp_id,
                "citation": {
                    "file_name": file_name,
                    "file_type": "pdf",
                    "page_number": page_num,
                    "slide_number": None,
                    "sheet_name": None,
                    "row_number": None,
                    "section_title": f"Page {page_num}",
                    "evaluator_name": None,
                    "eval_period": doc_period
                }
            })
            
    doc.close()
    return chunks, doc_period


# ============================================================================
# 2. DOCX / WORD PARSER (Preserves Headings & Section Titles)
# ============================================================================
def parse_docx(
    file_path: str,
    file_name: str,
    employee_roster: List[Dict[str, Any]] = None,
    target_employee_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if not docx:
        raise ImportError("python-docx is required for DOCX parsing.")
    
    doc = docx.Document(file_path)
    chunks = []
    
    parent_emp_name = resolve_employee_name(target_employee_id, employee_roster)
    
    # Collect sample text from initial paragraphs for period extraction
    sample_text = " ".join([p.text.strip() for p in doc.paragraphs[:15] if p.text.strip()])
    doc_period = detect_document_period(file_name, sample_text)
    
    current_heading = "General"
    current_paragraphs = []
    
    def flush_section(heading: str, paragraphs: List[str]):
        if not paragraphs:
            return
        full_text = clean_text("\n\n".join(paragraphs))
        if not full_text:
            return
        
        # Parent Inheritance if target_employee_id selected; else high-confidence roster match
        if target_employee_id:
            emp_id = target_employee_id
            emp_name = parent_emp_name
        else:
            matched_emp = match_employee_in_text(full_text, employee_roster, strict_full_name=True)
            emp_id = matched_emp.get("user_id") if matched_emp else None
            emp_name = matched_emp.get("name") if matched_emp else None
        
        source_coord = f"Section: {heading}" if heading != "General" else None
        header = build_contextual_header(
            file_name=file_name,
            file_type="docx",
            employee_name=emp_name,
            period=doc_period,
            source_coordinate=source_coord
        )
        
        sub_chunks = chunk_words(full_text, size=300, overlap=40)
        for sc in sub_chunks:
            # Prepend section heading for context preservation if not general
            body_with_ctx = f"[{heading}]\n{sc}" if heading != "General" else sc
            chunks.append({
                "content": f"{header}{body_with_ctx}",
                "chunk_type": "text",
                "target_employee_id": emp_id,
                "citation": {
                    "file_name": file_name,
                    "file_type": "docx",
                    "page_number": None,
                    "slide_number": None,
                    "sheet_name": None,
                    "row_number": None,
                    "section_title": heading,
                    "evaluator_name": None,
                    "eval_period": doc_period
                }
            })

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        
        # Check if paragraph is a heading
        if p.style.name.startswith("Heading"):
            flush_section(current_heading, current_paragraphs)
            current_heading = text
            current_paragraphs = []
        else:
            current_paragraphs.append(text)
            
    # Flush remaining paragraphs
    flush_section(current_heading, current_paragraphs)
    
    # Also parse tables inside Word document as clean Markdown tables
    for table_idx, table in enumerate(doc.tables):
        raw_rows = []
        for row in table.rows:
            cell_texts = [clean_text(cell.text) for cell in row.cells]
            if any(cell_texts):
                raw_rows.append(cell_texts)
        if raw_rows:
            md_table = format_as_markdown_table(raw_rows)
            if not md_table:
                continue

            if target_employee_id:
                table_emp_id = target_employee_id
                table_emp_name = parent_emp_name
            else:
                matched_emp = match_employee_in_text(md_table, employee_roster, strict_full_name=True)
                table_emp_id = matched_emp.get("user_id") if matched_emp else None
                table_emp_name = matched_emp.get("name") if matched_emp else None

            header = build_contextual_header(
                file_name=file_name,
                file_type="docx",
                employee_name=table_emp_name,
                period=doc_period,
                source_coordinate=f"Table {table_idx + 1}"
            )

            chunks.append({
                "content": f"{header}[Table {table_idx + 1}]\n{md_table}",
                "chunk_type": "table_row",
                "target_employee_id": table_emp_id,
                "citation": {
                    "file_name": file_name,
                    "file_type": "docx",
                    "page_number": None,
                    "slide_number": None,
                    "sheet_name": None,
                    "row_number": None,
                    "section_title": f"Table {table_idx + 1}",
                    "evaluator_name": None,
                    "eval_period": doc_period
                }
            })
            
    return chunks, doc_period


# ============================================================================
# 3. PPTX / POWERPOINT PARSER (Preserves Slide Number & Slide Title)
# ============================================================================
def parse_pptx(
    file_path: str,
    file_name: str,
    employee_roster: List[Dict[str, Any]] = None,
    target_employee_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if not pptx:
        raise ImportError("python-pptx is required for PPTX parsing.")
    
    prs = pptx.Presentation(file_path)
    chunks = []
    
    parent_emp_name = resolve_employee_name(target_employee_id, employee_roster)
    
    # Gather sample text from slide titles & early slides for period extraction
    sample_text = ""
    for s_idx in range(min(3, len(prs.slides))):
        s = prs.slides[s_idx]
        if s.shapes.title and s.shapes.title.text.strip():
            sample_text += s.shapes.title.text.strip() + " "
    doc_period = detect_document_period(file_name, sample_text)
    
    for slide_idx, slide in enumerate(prs.slides):
        slide_num = slide_idx + 1
        slide_title = None
        slide_texts = []
        
        # Extract title if present
        if slide.shapes.title and slide.shapes.title.text.strip():
            slide_title = clean_text(slide.shapes.title.text)
            
        for shape in slide.shapes:
            if shape == slide.shapes.title:
                continue
            if shape.has_text_frame:
                txt = clean_text(shape.text_frame.text)
                if txt:
                    slide_texts.append(txt)
            elif shape.has_table:
                table_rows = []
                for row in shape.table.rows:
                    cells = [clean_text(c.text) for c in row.cells]
                    if any(cells):
                        table_rows.append(cells)
                if table_rows:
                    md_tab = format_as_markdown_table(table_rows)
                    if md_tab:
                        slide_texts.append(md_tab)
                    
        # Extract speaker notes if any
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = clean_text(slide.notes_slide.notes_text_frame.text)
            if notes:
                slide_texts.append(f"Speaker Notes: {notes}")
                
        full_slide_content = "\n\n".join(slide_texts).strip()
        if not full_slide_content and not slide_title:
            continue
            
        heading = slide_title or f"Slide {slide_num}"
        raw_content = f"[{heading}]\n{full_slide_content}" if full_slide_content else f"[{heading}]"
        
        if target_employee_id:
            emp_id = target_employee_id
            emp_name = parent_emp_name
        else:
            matched_emp = match_employee_in_text(raw_content, employee_roster, strict_full_name=True)
            emp_id = matched_emp.get("user_id") if matched_emp else None
            emp_name = matched_emp.get("name") if matched_emp else None

        header = build_contextual_header(
            file_name=file_name,
            file_type="pptx",
            employee_name=emp_name,
            period=doc_period,
            source_coordinate=f"Slide {slide_num} - {heading}"
        )

        chunks.append({
            "content": f"{header}{raw_content}",
            "chunk_type": "slide",
            "target_employee_id": emp_id,
            "citation": {
                "file_name": file_name,
                "file_type": "pptx",
                "page_number": None,
                "slide_number": slide_num,
                "sheet_name": None,
                "row_number": None,
                "section_title": heading,
                "evaluator_name": None,
                "eval_period": doc_period
            }
        })
        
    return chunks, doc_period


# ============================================================================
# 4. EXCEL & CSV SPREADSHEET PARSER (Dynamic Header Detection & Normalization)
# ============================================================================

def _is_number_like(val: Any) -> bool:
    """Checks if a cell value behaves like a number (numeric, currency, percentage)."""
    if val is None or pd.isna(val):
        return False
    if isinstance(val, (int, float, complex)):
        return True
    s = str(val).strip().replace(",", "")
    if not s:
        return False
    return bool(re.match(r"^[\$€£₹]?\s*[-+]?\d+(\.\d+)?%?$", s))


def _is_date_like(val: Any) -> bool:
    """Checks if a cell value behaves like a date/timestamp."""
    if val is None or pd.isna(val):
        return False
    if isinstance(val, (datetime.date, datetime.datetime, pd.Timestamp)):
        return True
    s = str(val).strip()
    if not s:
        return False
    # Matches common international date formats: 2026-10-20, 02.04.26, 10/20/2026, 02-Apr-2026
    if re.match(r"^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$", s):
        return True
    if re.match(r"^\d{1,2}[-/\s][a-zA-Z]{3,}[-/\s]\d{2,4}$", s):
        return True
    return False


SUMMARY_ROW_PATTERN = re.compile(
    r"^(grand\s+total|totals?|sub\s*totals?|sub-totals?|average|avg\.?|mean|median|overall\s+total|company\s+total|team\s+total|net\s+total)(\s*[:\-\(/]|\s*$)",
    re.IGNORECASE
)


def is_summary_or_total_row(row_dict: Dict[str, Any], emp_col: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Detects if a spreadsheet row represents an aggregated calculation / summary row
    (e.g., 'Total', 'Grand Total', 'Average', 'Subtotal') rather than an individual entity record.
    Returns (is_summary, matching_keyword).
    """
    if not row_dict:
        return False, None

    # 1. Check designated employee/identity column first if present
    if emp_col and emp_col in row_dict:
        val_emp = str(row_dict[emp_col]).strip()
        if len(val_emp) <= 40 and SUMMARY_ROW_PATTERN.match(val_emp):
            return True, val_emp

    # 2. Check the first 3 non-empty cells in the row
    non_empty_vals = [str(v).strip() for v in row_dict.values() if str(v).strip()]
    for val in non_empty_vals[:3]:
        if len(val) <= 40:
            if SUMMARY_ROW_PATTERN.match(val):
                return True, val
            val_upper = val.upper()
            if val_upper.startswith("=SUM(") or val_upper.startswith("SUM("):
                return True, val

    return False, None


def detect_header_row_index(df_raw: pd.DataFrame, max_search_rows: int = 25) -> int:
    """
    Intelligently detects the true table header row using purely structural,
    data-type, and statistical heuristics — 100% agnostic of specific column names or domains.
    
    Heuristic rules:
      1. Fill Ratio: Table headers span the full width of the table, whereas
         decorative banners or report titles typically occupy only 1 or 2 merged cells.
      2. Data Types: Header cells are strictly text labels; rows containing numbers,
         floats, currencies, percentages, or dates are heavily penalized.
      3. Uniqueness: Table column headers are distinct labels (not repetitive values).
      4. Brevity: Column headers are concise identifiers (< 60 chars), unlike long narrative text.
      5. Lookahead: A true header row is immediately followed by rows containing populated data.
    """
    total_rows = len(df_raw)
    if total_rows <= 1:
        return 0
        
    search_limit = min(max_search_rows, total_rows)
    best_row_idx = 0
    best_score = -999999.0
    row_0_score = -999999.0

    # Determine maximum non-empty width across the sampled rows
    row_non_empty_counts = [
        sum(1 for v in df_raw.iloc[i] if pd.notna(v) and str(v).strip() != "")
        for i in range(search_limit)
    ]
    max_non_empty = max(row_non_empty_counts) if row_non_empty_counts else 1

    for r in range(search_limit):
        row_vals = df_raw.iloc[r]
        valid_cells = [
            v for v in row_vals
            if pd.notna(v) and str(v).strip() != "" and str(v).strip().lower() != "nan"
        ]
        
        if not valid_cells:
            if r == 0:
                row_0_score = -999.0
            continue
            
        n_cells = len(valid_cells)
        # 1. Fill ratio relative to the widest row in the sheet
        fill_ratio = n_cells / max(1, max_non_empty)
        
        # 2. Type analysis: Headers are text strings; data rows contain numbers/dates
        num_numbers = sum(1 for v in valid_cells if _is_number_like(v))
        num_dates = sum(1 for v in valid_cells if _is_date_like(v))
        num_long_texts = sum(1 for v in valid_cells if len(str(v).strip()) > 60)
        num_texts = max(0, n_cells - num_numbers - num_dates)
        
        text_ratio = num_texts / n_cells
        unique_vals = set(str(v).strip().lower() for v in valid_cells)
        unique_ratio = len(unique_vals) / n_cells
        
        # 3. Lookahead: Check if next row exists and contains populated data
        next_row_bonus = 0.0
        if r + 1 < total_rows:
            next_row_vals = [
                v for v in df_raw.iloc[r + 1]
                if pd.notna(v) and str(v).strip() != "" and str(v).strip().lower() != "nan"
            ]
            if len(next_row_vals) >= max_non_empty * 0.4:
                # Extra bonus if the following row contains numbers or dates (characteristic of data)
                has_data_types = any(_is_number_like(v) or _is_date_like(v) for v in next_row_vals)
                next_row_bonus = 30.0 if has_data_types else 15.0

        # 4. Banner penalty: Rows with only 1 or 2 filled cells when table is wide
        banner_penalty = 0.0
        if max_non_empty >= 4 and n_cells <= 2:
            banner_penalty = 60.0

        score = (
            (fill_ratio * 55.0)
            + (text_ratio * 45.0)
            + (unique_ratio * 25.0)
            + next_row_bonus
            - (num_numbers * 20.0)
            - (num_dates * 30.0)
            - (num_long_texts * 20.0)
            - banner_penalty
        )
        
        if r == 0:
            row_0_score = score
            
        if score > best_score:
            best_score = score
            best_row_idx = r

    # Preference for row 0 if it is already a strong standard header
    if row_0_score >= 80.0 and (best_score - row_0_score) < 25.0:
        return 0
        
    return best_row_idx


def clean_and_disambiguate_headers(raw_headers: List[Any]) -> List[str]:
    """
    Cleans raw header cells:
      - Strips whitespace & removes newlines
      - Replaces empty / NaN / 'Unnamed' with informative Column_1, Column_2...
      - Disambiguates duplicate column names (e.g. Total -> Total, Total_2)
    """
    clean_cols = []
    seen = {}
    
    for i, h in enumerate(raw_headers, start=1):
        if h is None or pd.isna(h):
            col_name = f"Column_{i}"
        else:
            s = str(h).replace("\r", " ").replace("\n", " ").strip()
            s = re.sub(r"\s+", " ", s)
            if not s or s.lower() == "nan" or s.lower().startswith("unnamed"):
                col_name = f"Column_{i}"
            else:
                col_name = s
                
        base = col_name
        count = seen.get(base, 0)
        if count > 0:
            col_name = f"{base}_{count + 1}"
        seen[base] = count + 1
        
        clean_cols.append(col_name)
        
    return clean_cols


def extract_clean_sheet_with_headers(df_raw: pd.DataFrame) -> Tuple[int, List[str], pd.DataFrame]:
    """
    Finds the true header row, extracts and disambiguates column names,
    and returns (header_row_idx, clean_columns, data_df).
    Data rows retain their original df_raw index so that physical Excel row numbers
    can be accurately calculated via: actual_row_number = int(row_idx) + 1.
    """
    if df_raw.empty:
        return 0, [], df_raw
        
    header_idx = detect_header_row_index(df_raw)
    raw_headers = df_raw.iloc[header_idx].tolist()
    clean_columns = clean_and_disambiguate_headers(raw_headers)
    
    # Slice rows strictly after the detected header row (preserve index!)
    df_data = df_raw.iloc[header_idx + 1:].copy()
    
    # Align column count if df_data has more or fewer columns than clean_columns
    if len(clean_columns) < df_data.shape[1]:
        clean_columns += [f"Column_{i+1}" for i in range(len(clean_columns), df_data.shape[1])]
    elif len(clean_columns) > df_data.shape[1]:
        clean_columns = clean_columns[:df_data.shape[1]]
        
    df_data.columns = clean_columns
    
    # Drop rows that are completely NaN
    df_data = df_data.dropna(how="all")
    # Drop columns that are completely NaN across all data rows
    df_data = df_data.dropna(axis=1, how="all")
    
    return header_idx, list(df_data.columns), df_data


def parse_spreadsheet(
    file_path: str,
    file_name: str,
    file_type: str,
    employee_roster: List[Dict[str, Any]] = None,
    target_employee_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Parses arbitrary Excel sheets (.xlsx, .xls) and CSV files.
    Applies dynamic header row detection to eliminate 'Unnamed: 0' issues from banners/blank rows.
    
    Employee Assignment:
      - Parent Inheritance: If target_employee_id is provided (Admin selected employee in UI dropdown),
        all rows and chunks strictly inherit that target_employee_id.
      - Multi-Employee Mode: If target_employee_id is None ('Team / Company Wide'), matches rows against
        employee_roster using high-confidence full name (first + last name) matching.
    """
    chunks = []
    spreadsheet_rows = []
    sheet_names_found = []
    columns_by_sheet = {}
    detected_headers = {}
    
    # Resolve target employee name if parent inheritance is active
    parent_emp_name = resolve_employee_name(target_employee_id, employee_roster)

    # Load sheet dict with header=None to capture raw rows including banners/blanks
    if file_type == "csv":
        try:
            df_raw = pd.read_csv(file_path, header=None)
        except UnicodeDecodeError:
            df_raw = pd.read_csv(file_path, encoding="latin1", header=None)
        df_dict = {"CSV_Data": df_raw}
    else:
        excel_file = pd.ExcelFile(file_path)
        sheet_names_found = excel_file.sheet_names
        df_dict = {
            sheet: pd.read_excel(file_path, sheet_name=sheet, header=None)
            for sheet in sheet_names_found
        }
        
    # Sample initial data rows to detect overall document period
    sample_text_bits = [file_name]
    for s_name, raw_df in df_dict.items():
        if not raw_df.empty:
            head_sample = " ".join([str(v) for v in raw_df.iloc[:5].values.flatten() if pd.notna(v)])
            sample_text_bits.append(head_sample)
            break
    doc_period = detect_document_period(file_name, " ".join(sample_text_bits))

    total_valid_rows = 0
    
    for sheet_name, df_raw in df_dict.items():
        if df_raw.empty:
            continue
            
        header_idx, columns_list, df = extract_clean_sheet_with_headers(df_raw)
        if df.empty or not columns_list:
            continue
            
        columns_by_sheet[sheet_name] = columns_list
        detected_headers[sheet_name] = header_idx + 1  # 1-indexed Excel row
        num_rows = len(df)
        total_valid_rows += num_rows
        
        # Constants for scalability
        MAX_ROW_CHUNKS_PER_SHEET = 250
        MAX_STORED_ROWS_PER_SHEET = 5000

        # 1. Tier B: High-Level Sheet Summary Chunk
        summary_text = (
            f"Spreadsheet: {file_name} | Sheet Tab: {sheet_name}\n"
            f"Detected Header Row: Row {header_idx + 1}\n"
            f"Columns ({len(columns_list)}): {', '.join(columns_list)}\n"
            f"Total Records: {num_rows} rows.\n"
            f"This sheet tracks employee performance, KPIs, goals, evaluation scores, or operational metrics."
        )
        summary_header = build_contextual_header(
            file_name=file_name,
            file_type=file_type,
            employee_name=parent_emp_name,
            period=doc_period,
            source_coordinate=f"Sheet: {sheet_name}"
        )
        chunks.append({
            "content": f"{summary_header}{summary_text}",
            "chunk_type": "sheet_summary",
            "target_employee_id": target_employee_id,
            "citation": {
                "file_name": file_name,
                "file_type": file_type,
                "page_number": None,
                "slide_number": None,
                "sheet_name": sheet_name,
                "row_number": header_idx + 1,
                "section_title": f"Summary of {sheet_name}",
                "evaluator_name": None,
                "eval_period": doc_period
            }
        })
        
        # Identify possible Employee column using standard identity terms
        emp_col = None
        for col in columns_list:
            c_lower = col.lower().strip()
            if any(term in c_lower for term in ["employee", "staff", "user", "person", "agent", "rep", "evaluator", "member"]):
                emp_col = col
                break

        if not emp_col:
            for col in columns_list:
                c_lower = col.lower().strip()
                if c_lower in ["name", "full name", "first name", "staff name", "person name"]:
                    emp_col = col
                    break

        # 2. Add Schema / Column Catalog Chunk if dataset is large
        if num_rows > MAX_ROW_CHUNKS_PER_SHEET:
            sample_row_text = " | ".join([f"{col}: {df.iloc[0][col]}" for col in columns_list[:10]])
            schema_chunk = (
                f"[Dataset Catalog: {file_name} | Sheet: {sheet_name}]\n"
                f"Header Row: Row {header_idx + 1}\n"
                f"Total Records: {num_rows:,} rows across {len(columns_list)} columns.\n"
                f"Available Fields: {', '.join(columns_list)}\n"
                f"Sample Row: {sample_row_text}\n"
                f"This dataset is indexed for exact SQL / metric aggregation and entity lookup."
            )
            schema_header = build_contextual_header(
                file_name=file_name,
                file_type=file_type,
                employee_name=parent_emp_name,
                period=doc_period,
                source_coordinate=f"Sheet: {sheet_name} (Schema Catalog)"
            )
            chunks.append({
                "content": f"{schema_header}{schema_chunk}",
                "chunk_type": "sheet_summary",
                "target_employee_id": target_employee_id,
                "citation": {
                    "file_name": file_name,
                    "file_type": file_type,
                    "page_number": None,
                    "slide_number": None,
                    "sheet_name": sheet_name,
                    "row_number": header_idx + 1,
                    "section_title": f"Schema Catalog of {sheet_name}",
                    "evaluator_name": None,
                    "eval_period": doc_period
                }
            })

        # 3. Iterate rows: vectorize top rows + store structured rows
        rows_vectorized_count = 0
        stored_rows_count = 0

        # Subsample df for structured DB storage if too massive
        df_for_storage = df.iloc[:MAX_STORED_ROWS_PER_SHEET]

        for row_idx, row in df_for_storage.iterrows():
            # Exact physical Excel row number (1-indexed) derived from original df_raw index
            try:
                actual_row_number = int(row_idx) + 1
            except (ValueError, TypeError):
                actual_row_number = header_idx + 2 + stored_rows_count
            
            # Build clean key-value dictionary for JSONB storage
            row_dict = {}
            for col in columns_list:
                val = row[col]
                if pd.isna(val):
                    continue
                # Format floats cleanly
                if isinstance(val, float) and val.is_integer():
                    val = int(val)
                row_dict[col] = str(val).strip()
                
            if not row_dict:
                continue

            # Skip summary / aggregation rows (e.g. 'Total', 'Grand Total', 'Average', 'Subtotal')
            # Prevents AI agent SQL aggregations from double-counting records
            is_summary, summary_marker = is_summary_or_total_row(row_dict, emp_col=emp_col)
            if is_summary:
                print(f"[COACH PARSER] Skipped summary/total row in sheet '{sheet_name}' (Excel Row {actual_row_number}, keyword: '{summary_marker}')")
                continue
                
            # Extract employee identity:
            if target_employee_id:
                # 1. Parent Inheritance: Whole file was uploaded for this employee
                emp_id = target_employee_id
                resolved_emp_name = parent_emp_name
            else:
                # 2. Multi-Employee Sheet Mode: High-Confidence Matching
                raw_cell_name = str(row_dict.get(emp_col, "")).strip() if emp_col else None
                matched_emp = None
                
                # Check identity column first
                if raw_cell_name:
                    matched_emp = match_employee_in_text(raw_cell_name, employee_roster, strict_full_name=False)
                    
                # Fallback: scan whole row text with strict 2-word full name (first + last name) matching
                if not matched_emp:
                    row_text_joined = " ".join([str(v) for v in row_dict.values()])
                    matched_emp = match_employee_in_text(row_text_joined, employee_roster, strict_full_name=True)
                    
                emp_id = matched_emp.get("user_id") if matched_emp else None
                resolved_emp_name = raw_cell_name or (matched_emp.get("name") if matched_emp else None)
            
            # Store in spreadsheet_rows list (capped at MAX_STORED_ROWS_PER_SHEET)
            spreadsheet_rows.append({
                "sheet_name": sheet_name,
                "row_index": actual_row_number,
                "target_employee_id": emp_id,
                "employee_name": resolved_emp_name,
                "row_data": row_dict
            })
            stored_rows_count += 1

            # Only vectorize rows up to MAX_ROW_CHUNKS_PER_SHEET to prevent stalling on 100k-row files
            if rows_vectorized_count < MAX_ROW_CHUNKS_PER_SHEET:
                row_details = " | ".join([f"{k}: {v}" for k, v in row_dict.items()])
                
                # Check for row-specific date/period if available
                row_period = doc_period
                for col_k, col_v in row_dict.items():
                    if _is_date_like(col_v) or any(t in col_k.lower() for t in ["date", "period", "quarter", "month", "follow"]):
                        detected_p = detect_document_period(str(col_v))
                        if detected_p:
                            row_period = detected_p
                            break

                row_header = build_contextual_header(
                    file_name=file_name,
                    file_type=file_type,
                    employee_name=resolved_emp_name,
                    period=row_period,
                    source_coordinate=f"Sheet: {sheet_name} | Row: {actual_row_number}"
                )
                semantic_content = f"{row_header}{row_details}"
                
                chunks.append({
                    "content": semantic_content,
                    "chunk_type": "table_row",
                    "target_employee_id": emp_id,
                    "citation": {
                        "file_name": file_name,
                        "file_type": file_type,
                        "page_number": None,
                        "slide_number": None,
                        "sheet_name": sheet_name,
                        "row_number": actual_row_number,
                        "section_title": f"Row {actual_row_number}",
                        "evaluator_name": None,
                        "eval_period": row_period
                    }
                })
                rows_vectorized_count += 1
            
    first_sheet = sheet_names_found[0] if sheet_names_found else "CSV_Data"
    parsed_metadata = {
        "sheet_names": sheet_names_found or ["CSV_Data"],
        "columns_detected": columns_by_sheet.get(first_sheet, []),
        "columns_by_sheet": columns_by_sheet,
        "header_row_detected": detected_headers.get(first_sheet, 1),
        "total_rows": total_valid_rows,
        "stored_rows": len(spreadsheet_rows),
        "chunks_count": len(chunks),
        "format": file_type,
        "document_period": doc_period,
        "large_file_optimized": total_valid_rows > 300
    }
    
    return chunks, spreadsheet_rows, parsed_metadata


# ============================================================================
# MASTER PARSER ROUTER
# ============================================================================
def parse_manual_upload(
    file_path: str,
    file_name: str,
    file_type: str,
    employee_roster: List[Dict[str, Any]] = None,
    target_employee_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Main entry point for manual upload parsing.
    Returns:
      (chunks, spreadsheet_rows, parsed_metadata)
    """
    ext = file_type.lower().replace(".", "")
    
    if ext == "pdf":
        chunks, doc_period = parse_pdf(file_path, file_name, employee_roster, target_employee_id=target_employee_id)
        return chunks, [], {"format": "pdf", "total_chunks": len(chunks), "document_period": doc_period}
        
    elif ext in ["docx", "doc"]:
        chunks, doc_period = parse_docx(file_path, file_name, employee_roster, target_employee_id=target_employee_id)
        return chunks, [], {"format": "docx", "total_chunks": len(chunks), "document_period": doc_period}
        
    elif ext in ["pptx", "ppt"]:
        chunks, doc_period = parse_pptx(file_path, file_name, employee_roster, target_employee_id=target_employee_id)
        return chunks, [], {"format": "pptx", "total_chunks": len(chunks), "document_period": doc_period}
        
    elif ext in ["xlsx", "xls", "csv"]:
        return parse_spreadsheet(file_path, file_name, ext, employee_roster, target_employee_id=target_employee_id)
        
    else:
        raise ValueError(f"Unsupported file format for Performance Coach: .{ext}")
