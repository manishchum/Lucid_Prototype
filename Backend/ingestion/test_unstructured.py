# from unstructured.partition.auto import partition
# from unstructured.documents.elements import Image
# import os
# import uuid
# from PIL import Image as PILImage

# def extract_images_unstructured(pdf_path, output_dir="unstructured_images"):

#     os.makedirs(output_dir, exist_ok=True)

#     elements = partition(
#         filename=pdf_path,
#         extract_images_in_pdf=True,
#         strategy="fast",  # DO NOT use hi_res for this test
#     )

#     image_count = 0

#     for el in elements:
#         if isinstance(el, Image) and hasattr(el, "image") and el.image:
#             image_count += 1

#             file_path = os.path.join(
#                 output_dir,
#                 f"image_{image_count}_{uuid.uuid4().hex[:6]}.png"
#             )

#             el.image.save(file_path)
#             print(f"Saved: {file_path}")

#     print(f"\nTotal images extracted (unstructured): {image_count}")


# if __name__ == "__main__":
#     pdf_path = "Food Safety Module Pubs.pdf"
#     extract_images_unstructured(pdf_path)

# import fitz  # PyMuPDF
# import os
# import uuid
# from PIL import Image
# import io

# def extract_images_pymupdf(pdf_path, output_dir="pymupdf_images"):

#     os.makedirs(output_dir, exist_ok=True)

#     doc = fitz.open(pdf_path)

#     image_count = 0

#     for page_index in range(len(doc)):
#         page = doc[page_index]
#         image_list = page.get_images(full=True)

#         print(f"Page {page_index}: Found {len(image_list)} images")

#         for img_index, img in enumerate(image_list):
#             xref = img[0]
#             base_image = doc.extract_image(xref)
#             image_bytes = base_image["image"]

#             image = Image.open(io.BytesIO(image_bytes))

#             image_count += 1

#             file_path = os.path.join(
#                 output_dir,
#                 f"page{page_index}_img{img_index}_{uuid.uuid4().hex[:6]}.png"
#             )

#             image.save(file_path)
#             print(f"Saved: {file_path}")

#     print(f"\nTotal images extracted (PyMuPDF): {image_count}")


# import fitz
# import os

# def render_pages_as_images(pdf_path, output_dir="rendered_pages"):

#     os.makedirs(output_dir, exist_ok=True)

#     doc = fitz.open(pdf_path)

#     for page_index in range(len(doc)):
#         page = doc[page_index]

#         # Increase zoom for higher resolution
#         zoom = 2  # 2x resolution
#         matrix = fitz.Matrix(zoom, zoom)

#         pix = page.get_pixmap(matrix=matrix)

#         file_path = os.path.join(output_dir, f"page_{page_index}.png")
#         pix.save(file_path)

#         print(f"Saved: {file_path}")

#     print("\nAll pages rendered successfully.")

import fitz
# import os
# import uuid
# from PIL import Image
# import io

# def extract_real_images(pdf_path, output_dir="filtered_images"):

#     os.makedirs(output_dir, exist_ok=True)

#     doc = fitz.open(pdf_path)
#     image_count = 0

#     for page_index in range(len(doc)):
#         page = doc[page_index]
#         image_list = page.get_images(full=True)

#         print(f"\nPage {page_index} → Found {len(image_list)} raw images")

#         for img in image_list:
#             xref = img[0]
#             smask = img[1]  # soft mask reference
#             width = img[2]
#             height = img[3]

#             # 🔴 FILTER 1: Skip tiny images
#             if width < 50 or height < 50:
#                 continue

#             # Extract image bytes
#             base_image = doc.extract_image(xref)
#             image_bytes = base_image["image"]

#             # 🔴 FILTER 2: Skip very small files
#             if len(image_bytes) < 5000:
#                 continue

#             try:
#                 image = Image.open(io.BytesIO(image_bytes))
#             except:
#                 continue

#             image_count += 1

#             file_path = os.path.join(
#                 output_dir,
#                 f"page{page_index}_{uuid.uuid4().hex[:6]}.png"
#             )

#             image.save(file_path)
#             print(f"Saved real image: {file_path}")

#     print(f"\nTotal REAL images extracted: {image_count}")


# if __name__ == "__main__":
#     pdf_path = "Food Safety Module Pubs.pdf"
#     extract_real_images(pdf_path)


import os
import re
import fitz  # PyMuPDF
from PIL import Image
import io
from unstructured.partition.auto import partition


# ==============================
# TEXT PARSING (Unstructured)
# ==============================

def clean_text(text: str) -> str:
    text = re.sub(r'^\s*[•\.\-]+\s*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\.{3,}', '', text)
    text = re.sub(r'^[^\w\s]+$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def parse_text_unstructured(pdf_path: str):
    print("\n--- Parsing Text with Unstructured ---")

    elements = partition(
        filename=pdf_path,
        extract_images_in_pdf=False,
        strategy="hi_res",
        infer_table_structure=True,
    )

    blocks = []

    for el in elements:
        page = getattr(el.metadata, "page_number", None)
        text = getattr(el, "text", None)

        if text and page:
            cleaned = clean_text(text)
            if cleaned:
                blocks.append({
                    "content": cleaned,
                    "page": page
                })

    print("Total text blocks:", len(blocks))

    unique_pages = sorted(set(b["page"] for b in blocks))
    print("Text pages:", unique_pages)

    # Print small sample
    if blocks:
        print("\nSample Text (first block):\n")
        print(blocks[0]["content"][:500])

    return blocks
def parse_text_per_page(pdf_path: str):
    print("\n--- Parsing Text Per Page (PyMuPDF) ---")

    doc = fitz.open(pdf_path)

    blocks = []

    for page_index in range(len(doc)):
        page = doc[page_index]

        # Extract full page text
        text = page.get_text("text")

        cleaned = clean_text(text)

        blocks.append({
            "page": page_index + 1,
            "content": cleaned
        })

        print(f"Page {page_index+1} text length:", len(cleaned))

    print("\nTotal pages:", len(blocks))
    return blocks

# ==============================
# IMAGE EXTRACTION (PyMuPDF)
# ==============================

def extract_images_pymupdf(pdf_path: str, output_dir="extracted_images"):
    print("\n--- Extracting Images with PyMuPDF ---")

    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    images = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        image_list = page.get_images(full=True)

        print(f"Page {page_index + 1} raw image count:", len(image_list))

        for img in image_list:
            xref = img[0]
            width = img[2]
            height = img[3]

            # Filter tiny images
            if width < 50 or height < 50:
                continue

            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]

            if len(image_bytes) < 5000:
                continue

            try:
                image = Image.open(io.BytesIO(image_bytes))
            except:
                continue

            file_path = os.path.join(
                output_dir,
                f"page_{page_index + 1}_{xref}.png"
            )

            image.save(file_path)

            images.append({
                "page": page_index + 1,
                "path": file_path
            })

    print("\nTotal filtered images:", len(images))

    unique_pages = sorted(set(img["page"] for img in images))
    print("Image pages:", unique_pages)

    return images


# ==============================
# TEST MAPPING
# ==============================

def test_mapping(text_blocks, images):

    print("\n--- Testing Page Mapping ---")

    page_text_map = {}
    for block in text_blocks:
        page = block["page"]
        page_text_map.setdefault(page, 0)
        page_text_map[page] += 1

    for page in sorted(page_text_map.keys()):
        image_count = len([img for img in images if img["page"] == page])
        print(f"Page {page}: {page_text_map[page]} text blocks, {image_count} images")


def write_chunks_to_file(text_blocks, output_file="parsed_chunks.txt"):
    print("\n--- Writing All Chunks to File ---")

    with open(output_file, "w", encoding="utf-8") as f:
        for i, block in enumerate(text_blocks, start=1):
            f.write("=" * 80 + "\n")
            f.write(f"CHUNK {i}\n")
            f.write(f"PAGE: {block['page']}\n")
            f.write("-" * 80 + "\n")
            f.write(block["content"])
            f.write("\n\n")

    print(f"Chunks written to: {os.path.abspath(output_file)}")
    return output_file
# ==============================
# MAIN
# ==============================

if __name__ == "__main__":

    pdf_path = "Food Safety Module Pubs.pdf"  # 🔴 change this Backend\ingestion\

    # text_blocks = parse_text_unstructured(pdf_path)
    text_blocks = parse_text_per_page(pdf_path)
    # print (text_blocks[0])
    # print("\n--- Sample Text Block ---")
    # print(text_blocks[0]["content"][:500])
    chunks_file = write_chunks_to_file(text_blocks)
    images = extract_images_pymupdf(pdf_path)

    test_mapping(text_blocks, images)

    print("\nDone.")




