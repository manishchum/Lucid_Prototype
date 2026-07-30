from unstructured.partition.auto import partition
from unstructured.cleaners.core import clean_extra_whitespace
from unstructured.documents.elements import (
    Title, NarrativeText, ListItem, Table, Image as UnstructuredImage
)
import io
from PIL import Image 
import pytesseract
import pandas as pd
import fitz  # PyMuPDF
import re

def clean_text(text: str) -> str:
    text = re.sub(r'^\s*[•▪\.\-]+\s*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\.{3,}', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ==============================
# TEXT PARSING (Unstructured HI_RES)
# 1 CHUNK PER PAGE
# ==============================

def parse_text_per_page_unstructured(pdf_path: str):

    print("\n--- Parsing Text Per Page (Unstructured FAST) ---")

    elements = partition(
        filename=pdf_path,
        strategy="fast",
        extract_images_in_pdf=False,
    )

    page_map = {}

    for el in elements:
        page_number = getattr(el.metadata, "page_number", None)
        text = getattr(el, "text", None)

        if not page_number or not text:
            continue

        cleaned = clean_text(text)

        # Skip garbage bullet-only chunks
        if not cleaned or re.fullmatch(r'[•▪\-\s]+', cleaned):
            continue

        page_map.setdefault(page_number, "")
        page_map[page_number] += cleaned + "\n\n"

    # Convert to structured list (1 chunk per page)
    blocks = []

    for page_number in sorted(page_map.keys()):
        blocks.append({
            "page_number": page_number,
            "content": page_map[page_number].strip()
        })

        print(f"Page {page_number} text length:",
              len(page_map[page_number]))

    print("\nTotal pages parsed:", len(blocks))

    return blocks


# ==============================
# IMAGE EXTRACTION (PyMuPDF)
# ==============================
# ==============================
# VECTOR DRAWING EXTRACTION
# ==============================

def extract_vector_drawings(pdf_path: str, zoom: float = 2.0):

    print("\n--- Extracting Vector Drawings ---")

    doc = fitz.open(pdf_path)
    vector_images = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        drawings = page.get_drawings()

        for d in drawings:

            rect = d["rect"]

            # Skip very small shapes
            if rect.width < 40 or rect.height < 40:
                continue

            # Skip large background shapes
            if rect.width * rect.height > page.rect.width * page.rect.height * 0.8:
                continue

            try:
                matrix = fitz.Matrix(zoom, zoom)

                pix = page.get_pixmap(
                    matrix=matrix,
                    clip=rect,
                    alpha=False
                )

                image_bytes = pix.tobytes("png")

                vector_images.append({
                    "page_number": page_index + 1,
                    "bytes": image_bytes,
                    "ext": "png"
                })

                print(f"Extracted vector from page {page_index+1}")

            except Exception as e:
                print(f"Vector extraction error on page {page_index+1}: {e}")
                continue

    print("Total vector images:", len(vector_images))

    return vector_images

def extract_images_per_page(pdf_path: str, zoom: float = 2.0):

    print("\n--- Extracting Raster Images (Rendered Clip Mode) ---")

    doc = fitz.open(pdf_path)
    images = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        image_list = page.get_images(full=True)

        for img_index, img in enumerate(image_list):

            xref = img[0]

            # Get all rectangles where this image appears
            rects = page.get_image_rects(xref)

            for rect_index, rect in enumerate(rects):

                # Skip tiny areas
                if rect.width < 40 or rect.height < 40:
                    continue

                try:
                    matrix = fitz.Matrix(zoom, zoom)

                    #  Render only that region from page
                    pix = page.get_pixmap(
                        matrix=matrix,
                        clip=rect,
                        alpha=False
                    )

                    image_bytes = pix.tobytes("png")

                    images.append({
                        "page_number": page_index + 1,
                        "bytes": image_bytes,
                        "ext": "png"
                    })

                    print(
                        f"[Rendered Raster] Page {page_index+1} | "
                        f"Rect: {int(rect.width)}x{int(rect.height)}"
                    )

                except Exception as e:
                    print(f"Render error page {page_index+1}: {e}")
                    continue

    print("Total rendered raster images:", len(images))

    return images

# ==============================
# EXCEL HELPERS
# ==============================

def _excel_cell_to_str(value):
    if pd.isna(value):
        return ""

    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value)

    return str(value).strip()


def _normalize_headers(headers):

    clean_headers = []
    seen = {}

    for i, h in enumerate(headers, start=1):

        name = _excel_cell_to_str(h)
        name = re.sub(r"\s+", " ", name).strip()

        if not name or name.lower().startswith("unnamed"):
            name = f"column_{i}"

        base = name
        count = seen.get(base, 0)

        if count > 0:
            name = f"{base}_{count+1}"

        seen[base] = count + 1

        clean_headers.append(name)

    return clean_headers

def _find_header_row(df):

    for idx, row in df.iterrows():

        non_empty = sum(1 for v in row if _excel_cell_to_str(v))

        if non_empty >= 2:
            return idx

    return 0

# ==============================
# EXCEL PARSER (FIRST SHEET ONLY)
# ==============================

def parse_excel_first_sheet(
    excel_path: str,
    rows_per_chunk: int = 30,
    overlap: int = 5
):

    print("\n--- Parsing Excel First Sheet ---")

    # workbook = pd.ExcelFile(excel_path)
    # sheet_name = workbook.sheet_names[0]
    raw_df = pd.read_excel(
        excel_path,
        sheet_name=0,
        header=None,
        dtype=object
    )

    sheet_name = "Sheet1"

    if raw_df.empty:
        return []

    raw_df = raw_df.dropna(how="all").dropna(axis=1, how="all")

    raw_df = raw_df.apply(lambda col: col.map(_excel_cell_to_str))

    header_row_idx = _find_header_row(raw_df)

    headers = _normalize_headers(raw_df.loc[header_row_idx].tolist())

    data_df = raw_df.loc[header_row_idx + 1:].reset_index(drop=True)

    data_df.columns = headers

    data_df = data_df[
        data_df.apply(lambda r: any(str(v).strip() for v in r), axis=1)
    ]

    blocks = []

    step = max(rows_per_chunk - overlap, 1)

    for start in range(0, len(data_df), step):

        chunk_df = data_df.iloc[start:start + rows_per_chunk]

        if chunk_df.empty:
            continue

        row_lines = []

        excel_row_start = header_row_idx + 2 + start
        excel_row_end = header_row_idx + 1 + start + len(chunk_df)

        for i, (_, row) in enumerate(chunk_df.iterrows()):

            excel_row_num = excel_row_start + i

            pairs = []

            for col in headers:

                val = str(row[col]).strip()

                if val:
                    pairs.append(f"{col}: {val}")

            if pairs:
                row_lines.append(
                    f"Row {excel_row_num} -> " + " | ".join(pairs)
                )

        if not row_lines:
            continue

        content = f"""
File Type: Excel
Sheet: {sheet_name}
Rows: {excel_row_start}-{excel_row_end}
Headers: {", ".join(headers)}

""" + "\n".join(row_lines)

        blocks.append({
            "sheet_name": sheet_name,
            "row_start": excel_row_start,
            "row_end": excel_row_end,
            "headers": headers,
            "content": clean_text(content)
        })

    print("Excel sheet:", sheet_name)
    print("Headers:", headers)
    print("Total blocks:", len(blocks))

    return blocks
# ==============================
# COMBINED PARSER ENTRY
# ==============================

def parse_pdf(pdf_path: str):
    text_blocks = parse_text_per_page_unstructured(pdf_path)
    raster_images = extract_images_per_page(pdf_path)
    # vector_images = extract_vector_drawings(pdf_path)
    images = raster_images 
    

    return text_blocks, images



def parse_excel(excel_path: str):

    text_blocks = parse_excel_first_sheet(excel_path)

    images = []  # excel does not produce images

    return text_blocks, images