def chunk_text(text: str, size: int, overlap: int):
    words = text.split()
    chunks = []

    i = 0
    while i < len(words):
        chunks.append(" ".join(words[i:i + size]))
        i += size - overlap

    return chunks