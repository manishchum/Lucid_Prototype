from unstructured.partition.auto import partition
from unstructured.cleaners.core import clean_extra_whitespace
from unstructured.documents.elements import (
    Title, NarrativeText, ListItem, Table, Image
)
import io
from PIL import Image as PILImage
import pytesseract
import pandas as pd

def ocr_image(el):
    if hasattr(el, "image") and el.image:
        # el.image is usually a PIL.Image object
        return pytesseract.image_to_string(el.image, lang="eng")
    return ""


def parse_pdf_rich(pdf_path: str) -> str:
    
    elements = partition(
        filename=pdf_path,
        extract_images_in_pdf=False,  # we will work on image RAG later and will directly extract images to supabase
        infer_table_structure=True,
        strategy="fast",  # Changed from "hi_res" to avoid Tesseract dependency
        # ocr_languages="eng",  # Removed - not needed for "fast" strategy
    )

    parts = []

    for el in elements:
        if isinstance(el, Title):
            parts.append(f"\n## {el.text}\n")

        elif isinstance(el, NarrativeText):
            parts.append(el.text)

        elif isinstance(el, ListItem):
            parts.append(f"- {el.text}")

        elif isinstance(el, Table):
            parts.append("\n[TABLE]\n")
            html_str = el.metadata.text_as_html

            if html_str:
                try:
                    # Wrap the string in StringIO so pandas treats it as a file
                    dfs = pd.read_html(io.StringIO(html_str))
                    if dfs:
                        # Convert the first found table to markdown
                        parts.append(dfs[0].to_markdown(index=False))
                except Exception as e:
                    print(f"Error parsing table: {e}")
                    parts.append(el.text) # Fallback to raw text
            else:
                parts.append(el.text)

            parts.append("\n[/TABLE]\n")


        
        elif isinstance(el, Image):
            ocr_text = el.text or ocr_image(el)
            if ocr_text.strip():
                parts.append("\n[IMAGE OCR]\n")
                parts.append(ocr_text)
                parts.append("\n[/IMAGE OCR]\n")        

        elif isinstance(el, Image) and el.text:
            parts.append("\n[IMAGE OCR]\n")
            parts.append(el.text)
            parts.append("\n[/IMAGE OCR]\n")

        elif hasattr(el, "text") and el.text:
            parts.append(el.text)

    text = "\n".join(parts)
    return clean_extra_whitespace(text)
