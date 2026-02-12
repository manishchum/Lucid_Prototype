from retriever import retrieve_chunks

doc_id = "dabur"   # or your moduleId

query = "What is Dabur's core philosophy?"

results = retrieve_chunks(
    query=query,
    doc_id=doc_id,
    top_k=2
)

for i, r in enumerate(results, 1):
    print(f"\n--- Result {i} (score={r['score']:.3f}) ---")
    print(r["text"][:500])
