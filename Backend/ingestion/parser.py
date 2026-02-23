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
# def extract_images_per_page(pdf_path: str):

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
            if width < 20 or height < 20:
                print(f"Skipping tiny image on page {page_index+1} with size {width}x{height}")
                continue

            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]

            if width*height < 2500:
                print(f"Skipping small image on page {page_index+1} with byte size {len(image_bytes)}")
                continue

            try:
                
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
# def extract_images_per_page(pdf_path: str):

    print("\n--- Extracting Raster Images (White Background Safe) ---")

    doc = fitz.open(pdf_path)
    images = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        image_list = page.get_images(full=True)

        for img in image_list:
            xref = img[0]
            smask = img[1]
            width = img[2]
            height = img[3]

            # Skip tiny images
            if width < 20 or height < 20:
                continue

            try:
                # Base image pixmap
                base_pix = fitz.Pixmap(doc, xref)

                # If image has soft mask, combine it properly
                if smask > 0:
                    mask_pix = fitz.Pixmap(doc, smask)
                    pix = fitz.Pixmap(base_pix, mask_pix)
                else:
                    pix = base_pix

                # 🔥 FORCE WHITE BACKGROUND FLATTENING
                if pix.alpha:
                    white_bg = fitz.Pixmap(fitz.csRGB, pix.width, pix.height)
                    white_bg.clear_with(255)  # fill white
                    white_bg.copy(pix, pix.irect)
                    pix = white_bg
                else:
                    # Convert CMYK or others to RGB safely
                    if pix.n != 3:
                        pix = fitz.Pixmap(fitz.csRGB, pix)

                image_bytes = pix.tobytes("png")

            except Exception as e:
                print(f"Image error on page {page_index+1}: {e}")
                continue

            images.append({
                "page_number": page_index + 1,
                "bytes": image_bytes,
                "ext": "png"
            })

            print(f"[Raster] Page {page_index+1} | Size: {width}x{height}")

    print("Total raster images:", len(images))

    return images
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
                if rect.width < 20 or rect.height < 20:
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
# COMBINED PARSER ENTRY
# ==============================

def parse_pdf(pdf_path: str):
    text_blocks = parse_text_per_page_unstructured(pdf_path)
    raster_images = extract_images_per_page(pdf_path)
    vector_images = extract_vector_drawings(pdf_path)
    images = raster_images + vector_images
    

    return text_blocks, images
