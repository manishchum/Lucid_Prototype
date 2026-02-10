import os
import pickle
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
import config
from google import genai
from typing import List, Dict
from google.genai import types

# =========================
# CONFIG (EDIT THESE)
# =========================
EMBEDDING_MODEL = config.EMBEDDING_MODEL_NAME  # "BAAI/bge-large-en-v1.5"
DEVICE = "cpu"          # change to "cuda" if available
TOP_K = config.TOP_K              # number of results to retrieve
GEMINI_MODEL = "gemini-2.5-flash-lite"

# =========================
# LOAD EMBEDDING MODEL
# =========================
print("[INFO] Loading embedding model...")
embedder = SentenceTransformer(EMBEDDING_MODEL, device=DEVICE)
GEMINI_API_KEY = config.GEMINI_API_KEY
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set in environment variables")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

# =========================
# LOAD FAISS DB
# =========================
def load_faiss_db(db_folder: str):
    index_path = os.path.join(db_folder, "index.faiss")
    # Backend\storage\vector_db\05abc20e-bba0-4978-ae36-c72114517f85\index.faiss
    print(index_path)

    chunks_path = os.path.join(db_folder, "chunks.pkl")
    print(chunks_path)

    if not os.path.exists(index_path):
        raise FileNotFoundError(f"index.faiss not found in {db_folder}")
    if not os.path.exists(chunks_path):
        raise FileNotFoundError(f"chunks.pkl not found in {db_folder}")

    print(f"[INFO] Loading FAISS index from {index_path}")
    index = faiss.read_index(index_path)

    print(f"[INFO] Loading chunks from {chunks_path}")
    with open(chunks_path, "rb") as f:
        chunks = pickle.load(f)

    return index, chunks


# =========================
# EMBED QUERY
# =========================
def embed_query(text: str) -> np.ndarray:
    emb = embedder.encode(
        [text],
        normalize_embeddings=True,
        convert_to_numpy=True
    )
    return emb.astype("float32")


# =========================
# QUERY FAISS
# =========================
def query_faiss(index, chunks, query: str, top_k: config.TOP_K):
    query_embedding = embed_query(query)

    scores, indices = index.search(query_embedding, top_k)

    results = []
    for rank, idx in enumerate(indices[0]):
        if idx == -1:
            continue

        results.append({
            "rank": rank + 1,
            "score": float(scores[0][rank]),
            "text": chunks[idx]
        })

    return results



# =========================
# GEMINI CALL
# =========================

def old_prompt(user_query: str, retrieved: List[Dict]) -> str:
    context_blocks = []
    for r in retrieved:
        # Assign importance labels based on rank
        importance = "CRITICAL PRIMARY SOURCE" if r['rank'] == 1 else f"SUPPORTING SOURCE (Rank {r['rank']})"
        context_blocks.append(f"[{importance}]:\n{r['text']}")

    context = "\n\n".join(context_blocks)
    return f"""
    You are an expert Instructional Designer and Technical Writer.

Your task is to write ONE complete, self-contained training module, formatted as a high-quality professional e-learning chapter using rich, structured HTML5.

This module will be generated independently inside a loop. Treat it as fully isolated.

-----------------------------
MODULE CONTEXT
-----------------------------
**Module Context:**
**Module Title:**
**Topics to Cover:**
**Target Objectives:** 
**Learning Style Focus:**
Based on the following query:
{user_query} 

────────────────────────────────────
SOURCE CONTEXT (AUTHORITATIVE)
────────────────────────────────────
The following content is extracted verbatim from the source document.
All entities present here are FACTUAL.
The information below is retrieved from the knowledge base.
{context}

-----------------------------
MODULE ISOLATION RULE (CRITICAL)
-----------------------------
This module must be fully self-contained.
Do NOT reference other modules, earlier sections, or future modules.
Do NOT assume prior learner knowledge beyond what is implied by the topics.

-----------------------------
CONTENT BOUNDARIES (CRITICAL)
-----------------------------

ALLOWED:
Explain and elaborate on concepts present in the topics
Teach beyond the document by adding clarity, depth, and conceptual examples
Use neutral, generic scenarios (e.g., “an organization”, “a system”, “a team”)
Add analogies, explanations, and conceptual activities

STRICTLY FORBIDDEN:
Do NOT invent or reference company names (real or fictional)
Do NOT invent policies, procedures, KPIs, workflows, or compliance rules
Do NOT attribute practices to any specific organization
Do NOT introduce tools, vendors, platforms, or products unless explicitly listed in the topics
Do NOT introduce unrelated domains outside the subject matter

If information is insufficient:
Stay abstract and educational
Do NOT fabricate specificity

MANDATORY:
If a company name, product name, regulation, or date is present in the provided context, you MUST reuse it verbatim.
if any policies, procedures, KPIs, workflows, or compliance rules are present in the provided context, you MUST reuse it verbatim.
if any practices are present in the provided context, you MUST reuse it verbatim.
if any tools, vendors, platforms, or products are present in the provided context, you MUST reuse it verbatim.
Use only domains present in the subject matter


------------------------------------------
DOCUMENT FIDELITY REQUIREMENT (CRITICAL)
-----------------------------------------

You MUST:
Reuse product names, ingredient names, regulations, timelines, numeric limits,
  thresholds, caps, and process names exactly as provided in the Topics and Objectives.
Prefer concrete references explicitly present in the source.

You MAY:
Explain industry concepts ONLY to the extent required to understand
  the document-specific items.
Use industry terminology ONLY if it is explicitly named or directly implied
  by the document.

You MUST NOT:
Replace document-specific rules, products, regulations, or workflows
  with generic industry explanations.
Introduce canonical frameworks, architectures, or best practices
  unless they are explicitly mentioned in the source.
Introduce examples that could apply equally to any other organization
  or any other domain.

If a concept is mentioned with specifics (numbers, durations, caps, product names),
those specifics MUST appear verbatim in the generated content.
If a concept is mentioned without specifics, keep explanations abstract and
do NOT introduce specificity.

If the source document is conceptual or educational
(e.g., AI, GenAI, leadership theory, etc.) and does NOT contain
company-specific entities:

Do NOT force company references
Stay domain-correct
Do NOT introduce enterprise frameworks not present in the source

-----------------------------
PEDAGOGICAL EXPANSION RULE
-----------------------------
You are encouraged to teach deeply by:
Explaining “what”, “why”, and “how” concepts work
Rephrasing complex ideas in learner-friendly language
Adding neutral reflection questions or conceptual activities

Expansion is allowed ONLY within the scope of the provided topics and objectives.

-----------------------------
HTML FORMATTING REQUIREMENTS (STRICT)
-----------------------------
Output ONLY valid HTML5 (no Markdown)
Use semantic elements: <section>, <article>, <h2>, <h3>, <h4>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <blockquote>
Do NOT use Markdown symbols (#, **, ---, etc)
Close all HTML tags properly
Do NOT wrap the entire output in a single <div>

-----------------------------
TABLE REQUIREMENTS
-----------------------------
Use tables when comparing concepts, steps, or categories
Comparison tables MUST include:
  <table data-comparison="true">
Step tables MUST include columns:
  Step # | Action | Explanation
All tables MUST use <thead> and <tbody>
Every table must have a <caption> OR a heading immediately before it

-----------------------------
VISUAL PLACEHOLDERS
-----------------------------
Where helpful, insert placeholders if needed, if diagrams, charts or infographics are available. eg, 
<img data-type="diagram" alt="Description of the diagram">
<img data-type="chart" alt="Description of the chart">
<img data-type="infographic" alt="Description of the infographic">

Use visuals only when they add learning value.

-----------------------------
LEARNING STYLE ADAPTATION
-----------------------------
CS (Concrete Sequential):
Structured steps, ordered tables, checkpoints

CR (Concrete Random):
Exploratory problems, open-ended prompts

AS (Abstract Sequential):
Conceptual models, comparison tables, structured analysis

AR (Abstract Random):
Narrative explanations, reflective prompts, discussion activities

-----------------------------
REQUIRED HTML STRUCTURE
-----------------------------

<section class="learning-objectives">
  <h2>Learning Objectives</h2>
  <ol>
    <li>Objective 1</li>
    <li>Objective 2</li>
    <li>Objective 3</li>
  </ol>
</section>

<section class="module-section">
  <h2>Section 1: Descriptive Title</h2>

  <h3>Concept Explanation</h3>
  <p>Explain the concept clearly and thoroughly.</p>

  <h3>Practical Interpretation</h3>
  <p>Describe how this concept is commonly applied in real-world systems using generic, non-attributed examples.</p>

  <h3>Key Concept Breakdown</h3>
  <table>
    <thead>
      <tr>
        <th>Aspect</th>
        <th>Description</th>
        <th>Illustrative Example</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Aspect 1</td>
        <td>Description</td>
        <td>Example</td>
      </tr>
    </tbody>
  </table>

  <blockquote class="key-takeaway">
    <strong>Key Takeaway:</strong> Summarize the most important learning point.
  </blockquote>
</section>

<section class="activity">
  <h3>Learning Activity</h3>
  <p><strong>Objective:</strong> What the learner should achieve</p>
  <p><strong>Time:</strong> Estimated duration</p>
  <ol>
    <li>Instruction step one</li>
    <li>Instruction step two</li>
    <li>Reflection or deliverable</li>
  </ol>
</section>

<section class="module-summary">
  <h2>Module Summary</h2>
  <ul>
    <li>Key takeaway 1</li>
    <li>Key takeaway 2</li>
    <li>Key takeaway 3</li>
  </ul>
</section>

-----------------------------
FINAL SELF-CHECK (MANDATORY)
-----------------------------
Before responding, confirm:
No company names invented or fabricated, use verbatim company names
No invented policies or procedures appear, use verbatim policies or procedures
No invented tools, vendors, platforms, or products appear, use verbatim tools, vendors, platforms, or products
All content stays within the provided topics

If violations exist, remove them.

Output ONLY the final HTML5

    """.strip()


def build_rag_prompt(user_query: str, retrieved: List[Dict]) -> str:
    context_blocks = []
    for r in retrieved:
        # Assign importance labels based on rank
        importance = "CRITICAL PRIMARY SOURCE" if r['rank'] == 1 else f"SUPPORTING SOURCE (Rank {r['rank']})"
        context_blocks.append(f"[{importance}]:\n{r['text']}")

    context = "\n\n".join(context_blocks)

    return f"""
### ROLE
You are a Senior Instructional Designer and Technical Author.
Your responsibility is to create long-form, enterprise-grade e-learning content that prioritizes depth, clarity, and pedagogical completeness over brevity.
You must explain concepts thoroughly, even when the source information is limited, while staying strictly grounded in the provided material.

### SOURCE MATERIAL (STRICT HIERARCHY)
The information below is retrieved from the knowledge base. 
- Use the [CRITICAL PRIMARY SOURCE] to establish the core facts and structure.
- Use [SUPPORTING SOURCES] only to add detail or fill gaps in the primary source.

{context}

### MANDATORY GROUNDING RULES
1. **No Hallucination:** If a topic in the query is not mentioned in the sources, do not include it.
2. **Zero Generic Content:** Do not use general industry knowledge. Use ONLY facts found in the sources above.
3. **Verbatim Fidelity:** All proper names, dates, percentages, and technical terms (e.g., specific company policies, tool names, or KPIs) must be copied exactly.
4. **Depth Requirement (Mandatory):**
Each section must be fully developed with continuous explanatory paragraphs.
Bullets may be used only for summaries, tables, or activities — not for main explanations.
DEPTH ENFORCEMENT RULE (MANDATORY)
- Each SECTION must contain 900–1100 words total
- Each SUBSECTION must contain at least 300 words 
- Each subsection must be in points with detailed explanations (not just bullets)
- If a subsection does not meet the word requirement, the output is INVALID
5. SECTION-BY-SECTION COMPLETION RULE (MANDATORY)
- Complete Section 1 fully before starting Section 2.
- Complete Section 2 fully before starting Section 3.
- Do not shorten later sections due to length.
- Each section must be approximately equal in depth and detail and strictly in points .
6. Use the given below html formatting and structure requirements to format the output. Do not deviate from the required structure or formatting.
7. ANTI-SUMMARY RULE
- Do NOT summarize concepts prematurely.
- Do NOT compress explanations.

### MODULE OBJECTIVE & SCOPE
Based on the following query:
{user_query}

-----------------------------
REQUIRED HTML STRUCTURE
-----------------------------

<section class="learning-objectives">
  <h2>Learning Objectives</h2>
  <ol>
    <li>Objective 1</li>
    <li>Objective 2</li>
    <li>Objective 3</li>
  </ol>
</section>

<section class="module-section">
  <h2>Section 1: Descriptive Title</h2>

  <h3>Concept Explanation</h3>
  <p>Explain the concept clearly and thoroughly.</p>

  <h3>Practical Interpretation</h3>
  <p>Describe how this concept is commonly applied in real-world systems using generic, non-attributed examples.</p>

  <h3>Key Concept Breakdown</h3>
  <table>
    <thead>
      <tr>
        <th>Aspect</th>
        <th>Description</th>
        <th>Illustrative Example</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Aspect 1</td>
        <td>Description</td>
        <td>Example</td>
      </tr>
    </tbody>
  </table>

  <blockquote class="key-takeaway">
    <strong>Key Takeaway:</strong> Summarize the most important learning point.
  </blockquote>
</section>

<section class="activity">
  <h3>Learning Activity</h3>
  <p><strong>Objective:</strong> What the learner should achieve</p>
  <p><strong>Time:</strong> Estimated duration</p>
  <ol>
    <li>Instruction step one</li>
    <li>Instruction step two</li>
    <li>Reflection or deliverable</li>
  </ol>
</section>

<section class="module-summary">
  <h2>Module Summary</h2>
  <ul>
    <li>Key takeaway 1</li>
    <li>Key takeaway 2</li>
    <li>Key takeaway 3</li>
  </ul>
</section>


### FINAL OUTPUT INSTRUCTIONS
- - Produce the output in valid HTML5 using points for core explanations.
- Use <ul> and <li> ONLY in the Learning Objectives, Learning Activity,subsections and Module Summary sections.
- If the source contains data comparisons or metrics, you MUST use a <table>.
- Do not reference "the source" or "Rank 1" in your final text.
-If the source lacks specific details for a topic, simply omit that topic from the output. Do not invent or assume any information.
""".strip()

def ask_gemini(prompt: str) -> str:
    config = types.GenerateContentConfig(
        temperature=0.3, 
        top_p=1.0
        
    )
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[prompt],
        config= config
    )
    return (getattr(response, "text", "") or "").strip()


# =========================
# MAIN TEST RUNNER
# =========================
def run_test(db_folder: str, query: str, top_k: int = config.TOP_K):
    index, chunks = load_faiss_db(db_folder)

    print("\n==============================")
    print("QUERY:")
    print(query)
    print("==============================\n")

    results = query_faiss(index, chunks, query, top_k = top_k)

    if not results:
        print("[WARN] No results found")
        return

    print("🔍 TOP MATCHES\n")
    for r in results:
        print(f"--- Rank {r['rank']} ---")
        print(f"Similarity Score: {r['score']:.4f}")
        print("Retrieved Text:")
        print(r["text"])
        print("\n--------------------------\n")

    # prompt = build_rag_prompt(query, results)
    prompt = old_prompt(query, results)

    print("\n Sending grounded prompt to Gemini...\n")
    answer = ask_gemini(prompt)

    print("\n")
    print("✅ GEMINI RESPONSE:")
    print(answer)
    print("\n")


# =========================
# ENTRY POINT
# =========================
if __name__ == "__main__":
    # 🔹 CHANGE THIS PATH
    # VECTOR_DB_FOLDER = "storage/vector_db/b451cfe9-13e9-4e9b-b85f-f7a0dd62b162"
    VECTOR_DB_FOLDER = "storage/vector_db/05abc20e-bba0-4978-ae36-c72114517f85"
    
   
    # 🔹 YOUR TEST QUERY
    QUERY = """  
"title": "Merchandising Operations and Execution",
"topics": [
"Third-Party Merchandising Agency Management",
"Point-of-Sale Material (PoSM) Deployment",
"Merchandising KPIs (Share of Shelf and Planogram Compliance)"
]
,
"objectives": [
"Learners will oversee merchandising agencies to ensure flawless setup of 2D/3D visualizations and store designs.",
"Learners will perform retail audits using geotagged photos to verify planogram compliance.",
"Learners will calculate Merchandising KPIs, including Share of Shelf (SoS) and Planogram Compliance percentages."
]
    """

    run_test(VECTOR_DB_FOLDER, QUERY)
