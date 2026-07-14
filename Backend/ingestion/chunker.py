def chunk_text(text: str, size: int, overlap: int):
    if size <= 0:
        raise ValueError("size must be > 0")
    if overlap < 0:
        raise ValueError("overlap must be >= 0")
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")

    words = text.split()
    chunks = []

    i = 0
    step = size - overlap

    while i < len(words):
        chunks.append(" ".join(words[i:i + size]))
        i += step

    return chunks