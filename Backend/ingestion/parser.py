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

    print("\n--- Parsing Text Per Page (Unstructured HI_RES) ---")

    elements = partition(
        filename=pdf_path,
        strategy="hi_res",
        infer_table_structure=True,
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

def extract_images_per_page(pdf_path: str):

    print("\n--- Extracting Images (PyMuPDF) ---")

    doc = fitz.open(pdf_path)
    images = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        image_list = page.get_images(full=True)

        for img in image_list:
            xref = img[0]
            width = img[2]
            height = img[3]

            # Filter tiny images
            if width < 50 or height < 50:
                print(f"Skipping tiny image on page {page_index+1} with size {width}x{height}")
                continue

            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]

            if len(image_bytes) < 5000:
                print(f"Skipping small image on page {page_index+1} with byte size {len(image_bytes)}")
                continue

            try:
                print("try ke andar")
                Image.open(io.BytesIO(image_bytes))
            except Exception as e:
                print(f"except ke andr hai: {e}")
                continue

            images.append({
                
                "page_number": page_index + 1,
                "bytes": image_bytes,
                "ext": base_image["ext"]
            })
            print(f"Extracted image from page {page_index+1} with size {width}x{height} and byte size {len(image_bytes)}")
            print(f"Total images so far: {len(images)}")

    print("Total filtered images:", len(images))

    return images


# ==============================
# COMBINED PARSER ENTRY
# ==============================

def parse_pdf(pdf_path: str):
    text_blocks = parse_text_per_page_unstructured(pdf_path)
    images = extract_images_per_page(pdf_path)

    return text_blocks, images
