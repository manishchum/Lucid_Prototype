# Backend/ingestion/coach_parser.py
"""
Universal Multi-Format Document & Spreadsheet Parser for Employee Performance Coach.
Supports: PDF, DOCX, DOC, CSV, XLSX, XLS, PPTX, PPT.
Extracts clean text chunks with strict proof coordinates (page, slide, sheet, row).
"""

import os
import re
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


def match_employee_in_text(text: str, employee_roster: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Check if any known company employee name appears in the text block or row.
    Returns the matching employee dict with 'user_id' and 'name' if found.
    """
    if not text or not employee_roster:
        return None
    
    text_lower = text.lower()
    for emp in employee_roster:
        emp_name = emp.get("name", "").strip().lower()
        if not emp_name or len(emp_name) < 3:
            continue
        # Exact word match for employee name
        pattern = r'\b' + re.escape(emp_name) + r'\b'
        if re.search(pattern, text_lower):
            return emp
    return None


# ============================================================================
# 1. PDF PARSER (Preserves Page Number & Section Context)
# ============================================================================
def parse_pdf(file_path: str, file_name: str, employee_roster: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    if not fitz:
        raise ImportError("PyMuPDF (fitz) is required for PDF parsing.")
    
    doc = fitz.open(file_path)
    chunks = []
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_num = page_idx + 1
        page_text = clean_text(page.get_text("text"))
        
        if not page_text:
            continue
        
        # Detect if an employee is explicitly referenced on this page
        matched_emp = match_employee_in_text(page_text, employee_roster)
        emp_id = matched_emp.get("user_id") if matched_emp else None
        
        # Split long pages into digestible chunks
        sub_chunks = chunk_words(page_text, size=300, overlap=40)
        for sc in sub_chunks:
            chunks.append({
                "content": sc,
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
                    "eval_period": None
                }
            })
            
    doc.close()
    return chunks


# ============================================================================
# 2. DOCX / WORD PARSER (Preserves Headings & Section Titles)
# ============================================================================
def parse_docx(file_path: str, file_name: str, employee_roster: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    if not docx:
        raise ImportError("python-docx is required for DOCX parsing.")
    
    doc = docx.Document(file_path)
    chunks = []
    
    current_heading = "General"
    current_paragraphs = []
    
    def flush_section(heading: str, paragraphs: List[str]):
        if not paragraphs:
            return
        full_text = clean_text("\n\n".join(paragraphs))
        if not full_text:
            return
        
        matched_emp = match_employee_in_text(full_text, employee_roster)
        emp_id = matched_emp.get("user_id") if matched_emp else None
        
        sub_chunks = chunk_words(full_text, size=300, overlap=40)
        for sc in sub_chunks:
            # Prepend section heading for context preservation
            content_with_ctx = f"[{heading}]\n{sc}" if heading != "General" else sc
            chunks.append({
                "content": content_with_ctx,
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
                    "eval_period": None
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
    
    # Also parse tables inside Word document
    for table_idx, table in enumerate(doc.tables):
        rows_data = []
        for row in table.rows:
            cell_texts = [clean_text(cell.text) for cell in row.cells]
            if any(cell_texts):
                rows_data.append(" | ".join(cell_texts))
        if rows_data:
            table_text = "\n".join(rows_data)
            matched_emp = match_employee_in_text(table_text, employee_roster)
            chunks.append({
                "content": f"[Table {table_idx + 1}]\n{table_text}",
                "chunk_type": "table_row",
                "target_employee_id": matched_emp.get("user_id") if matched_emp else None,
                "citation": {
                    "file_name": file_name,
                    "file_type": "docx",
                    "page_number": None,
                    "slide_number": None,
                    "sheet_name": None,
                    "row_number": None,
                    "section_title": f"Table {table_idx + 1}",
                    "evaluator_name": None,
                    "eval_period": None
                }
            })
            
    return chunks


# ============================================================================
# 3. PPTX / POWERPOINT PARSER (Preserves Slide Number & Slide Title)
# ============================================================================
def parse_pptx(file_path: str, file_name: str, employee_roster: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    if not pptx:
        raise ImportError("python-pptx is required for PPTX parsing.")
    
    prs = pptx.Presentation(file_path)
    chunks = []
    
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
                        table_rows.append(" | ".join(cells))
                if table_rows:
                    slide_texts.append("\n".join(table_rows))
                    
        # Extract speaker notes if any
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = clean_text(slide.notes_slide.notes_text_frame.text)
            if notes:
                slide_texts.append(f"Speaker Notes: {notes}")
                
        full_slide_content = "\n\n".join(slide_texts).strip()
        if not full_slide_content and not slide_title:
            continue
            
        heading = slide_title or f"Slide {slide_num}"
        content = f"[{heading}]\n{full_slide_content}" if full_slide_content else f"[{heading}]"
        
        matched_emp = match_employee_in_text(content, employee_roster)
        chunks.append({
            "content": content,
            "chunk_type": "slide",
            "target_employee_id": matched_emp.get("user_id") if matched_emp else None,
            "citation": {
                "file_name": file_name,
                "file_type": "pptx",
                "page_number": None,
                "slide_number": slide_num,
                "sheet_name": None,
                "row_number": None,
                "section_title": heading,
                "evaluator_name": None,
                "eval_period": None
            }
        })
        
    return chunks


# ============================================================================
# 4. EXCEL & CSV SPREADSHEET PARSER (Heterogeneous Format Handling)
# ============================================================================
def parse_spreadsheet(
    file_path: str,
    file_name: str,
    file_type: str,
    employee_roster: List[Dict[str, Any]] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Parses arbitrary Excel sheets (.xlsx, .xls) and CSV files.
    Generates:
      1. Contextualized semantic markdown chunks for vector search.
      2. High-level sheet summary chunks.
      3. Structured JSON records for exact SQL calculations (coach_spreadsheet_rows).
    """
    chunks = []
    spreadsheet_rows = []
    sheet_names_found = []
    
    # Load sheet dict
    if file_type == "csv":
        # Handle potential encoding variances
        try:
            df_dict = {"CSV_Data": pd.read_csv(file_path)}
        except UnicodeDecodeError:
            df_dict = {"CSV_Data": pd.read_csv(file_path, encoding="latin1")}
    else:
        # Excel: load all sheets
        excel_file = pd.ExcelFile(file_path)
        sheet_names_found = excel_file.sheet_names
        df_dict = {sheet: pd.read_excel(file_path, sheet_name=sheet) for sheet in sheet_names_found}
        
    total_valid_rows = 0
    
    for sheet_name, df in df_dict.items():
        if df.empty:
            continue
            
        # Clean column names (strip whitespace, stringify)
        df.columns = [str(c).strip() for c in df.columns]
        # Remove completely empty rows and columns
        df = df.dropna(how="all").dropna(axis=1, how="all")
        if df.empty:
            continue
            
        columns_list = list(df.columns)
        num_rows = len(df)
        total_valid_rows += num_rows
        
        # 1. Tier B: High-Level Sheet Summary Chunk
        summary_text = (
            f"Spreadsheet: {file_name} | Sheet Tab: {sheet_name}\n"
            f"Columns: {', '.join(columns_list)}\n"
            f"Total Records: {num_rows} rows.\n"
            f"This sheet tracks employee performance, KPIs, goals, evaluation scores, or team feedback."
        )
        chunks.append({
            "content": summary_text,
            "chunk_type": "sheet_summary",
            "target_employee_id": None,
            "citation": {
                "file_name": file_name,
                "file_type": file_type,
                "page_number": None,
                "slide_number": None,
                "sheet_name": sheet_name,
                "row_number": None,
                "section_title": f"Summary of {sheet_name}",
                "evaluator_name": None,
                "eval_period": None
            }
        })
        
        # Identify possible Employee Name column
        emp_col = None
        for col in columns_list:
            if any(term in col.lower() for term in ["employee", "staff", "name", "team member", "person"]):
                emp_col = col
                break
                
        # 2. Iterate each row: Generate Structured Row + Semantic Markdown Chunk
        for row_idx, row in df.iterrows():
            actual_row_number = int(row_idx) + 2  # 1-indexed Excel row (+1 for 0-index, +1 for header)
            
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
                
            # Extract employee identity
            raw_emp_name = str(row_dict.get(emp_col, "")).strip() if emp_col else None
            matched_emp = None
            if raw_emp_name:
                matched_emp = match_employee_in_text(raw_emp_name, employee_roster)
            if not matched_emp:
                # Fallback: scan whole row text
                row_text_joined = " ".join([str(v) for v in row_dict.values()])
                matched_emp = match_employee_in_text(row_text_joined, employee_roster)
                
            emp_id = matched_emp.get("user_id") if matched_emp else None
            
            # Store in spreadsheet_rows list
            spreadsheet_rows.append({
                "sheet_name": sheet_name,
                "row_index": actual_row_number,
                "target_employee_id": emp_id,
                "employee_name": raw_emp_name or (matched_emp.get("name") if matched_emp else None),
                "row_data": row_dict
            })
            
            # Convert row into self-contained semantic Markdown text
            row_details = " | ".join([f"{k}: {v}" for k, v in row_dict.items()])
            semantic_content = (
                f"[Source: {file_name} | Sheet: {sheet_name} | Row: {actual_row_number}]\n"
                f"{row_details}"
            )
            
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
                    "eval_period": None
                }
            })
            
    parsed_metadata = {
        "sheet_names": sheet_names_found or ["CSV_Data"],
        "total_rows": total_valid_rows,
        "format": file_type
    }
    
    return chunks, spreadsheet_rows, parsed_metadata


# ============================================================================
# MASTER PARSER ROUTER
# ============================================================================
def parse_manual_upload(
    file_path: str,
    file_name: str,
    file_type: str,
    employee_roster: List[Dict[str, Any]] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Main entry point for manual upload parsing.
    Returns:
      (chunks, spreadsheet_rows, parsed_metadata)
    """
    ext = file_type.lower().replace(".", "")
    
    if ext == "pdf":
        chunks = parse_pdf(file_path, file_name, employee_roster)
        return chunks, [], {"format": "pdf", "total_chunks": len(chunks)}
        
    elif ext in ["docx", "doc"]:
        chunks = parse_docx(file_path, file_name, employee_roster)
        return chunks, [], {"format": "docx", "total_chunks": len(chunks)}
        
    elif ext in ["pptx", "ppt"]:
        chunks = parse_pptx(file_path, file_name, employee_roster)
        return chunks, [], {"format": "pptx", "total_chunks": len(chunks)}
        
    elif ext in ["xlsx", "xls", "csv"]:
        return parse_spreadsheet(file_path, file_name, ext, employee_roster)
        
    else:
        raise ValueError(f"Unsupported file format for Performance Coach: .{ext}")
