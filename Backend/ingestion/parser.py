from unstructured.partition.auto import partition
from unstructured.cleaners.core import clean_extra_whitespace
from unstructured.documents.elements import (
    Title, NarrativeText, ListItem, Table, Image
)


def parse_pdf_rich(pdf_path: str) -> str:
    print("I am here")
    elements = partition(
        filename=pdf_path,
        extract_images_in_pdf=True,
        infer_table_structure=True,
        strategy="fast",
        ocr_languages="eng",
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
            parts.append(el.text)
            parts.append("\n[/TABLE]\n")

        elif isinstance(el, Image) and el.text:
            parts.append("\n[IMAGE OCR]\n")
            parts.append(el.text)
            parts.append("\n[/IMAGE OCR]\n")

        elif hasattr(el, "text") and el.text:
            parts.append(el.text)

    text = "\n".join(parts)
    return clean_extra_whitespace(text)
