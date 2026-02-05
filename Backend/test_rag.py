# To make vector db of passed pdf

# from ingestion.pipeline import ingest_pdf_for_rag

# result = ingest_pdf_for_rag(
#     pdf_path="storage/documents/dabur.pdf",
#     doc_id= "dabur"
# )

# print(result)


# Test sentence transformer model loading and embedding

# from sentence_transformers import SentenceTransformer
# print("Loading model...")
# model = SentenceTransformer("BAAI/bge-large-en-v1.5")
# print("Model loaded.")
# emb = model.encode(["hello world"], normalize_embeddings=True)

# print(emb.shape)




# Testing parser independently

# print("Parsing document...")

# from ingestion.chunker import chunk_text
# print("Chunker imported.")
# from ingestion.parser import parse_pdf_rich
# print("Document parser imported.")

# text = parse_pdf_rich("storage\Melaov-Pro.pdf")
# print("Document parsed.")
# print(text[:500])
# print("Testing unstructured partition...")

# from unstructured.partition.auto import partition
# print("Partitioning document...")

# elements = partition("storage/documents/dabur.pdf")
# print("Elements count:", len(elements))

# for i, el in enumerate(elements[:5]):
#     print(f"\n--- Element {i} ---")
#     print(type(el))
#     print(repr(getattr(el, "text", None)))

# Reading chunks from vector db
import pickle
chunkfile = "Backend/storage/vector_db/b451cfe9-13e9-4e9b-b85f-f7a0dd62b162/chunks.pkl"
with open(chunkfile, "rb") as f:
    chunks = pickle.load(f)

print(len(chunks))
print(chunks[1])


# import faiss
# indexfaiss = "storage/vector_db/dabur/index.faiss"
# index = faiss.read_index(indexfaiss)
# print(index.ntotal)