// Standalone version of generate-module-content for VM worker
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

require('../env').loadWorkerEnv();

const axios = require('axios');
console.log("Environment variables loaded successfully");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log("Fetched supabase url succesfully")

console.log("Fetched supabase key succesfully", Boolean(SUPABASE_KEY))
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("Supabase client created successfully")

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY  });
const WORKER_BUILD_TAG = 'gemini-upload-fix-v3-2026-04-08';
console.log(`[WORKER] Loaded generate-module-content (${WORKER_BUILD_TAG})`);

// Default RAG configuration (fallback)
const DEFAULT_RAG_CONFIG = {
  rag_temperature: 0.1,
  rag_max_output_tokens: 3400,
  rag_top_p: 1.0
};

// Helper function to fetch company RAG configuration
async function getCompanyRagConfig(companyId) {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('rag_temperature, rag_top_p, rag_max_output_tokens')
      .eq('company_id', companyId)
      .single();
    
    if (error || !data) {
      console.log(`[CONFIG] No company config found for ${companyId}, using defaults`);
      return DEFAULT_RAG_CONFIG;
    }
    console.log(`[CONFIG] Fetched company config for ${companyId}:`, data);
    console.log(`Fetched temperature: `, data.rag_temperature);
    
    
    return {
      rag_temperature: data.rag_temperature ?? DEFAULT_RAG_CONFIG.rag_temperature,
      rag_top_p: data.rag_top_p ?? DEFAULT_RAG_CONFIG.rag_top_p,
      rag_max_output_tokens: data.rag_max_output_tokens ?? DEFAULT_RAG_CONFIG.rag_max_output_tokens
    };
  } catch (err) {
    console.error(`[CONFIG] Error fetching company config: ${err.message}`);
    return DEFAULT_RAG_CONFIG;
  }
}

// Configs (now will be overridden per company)
const TEMPERATURE = 0.1;
const TOP_P = 1.0;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function generateWithRetry(callFn, retries = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[GEMINI] generateContent attempt ${attempt}/${retries}`);
      return await callFn();
    } catch (err) {
      lastErr = err;
      console.warn(`[GEMINI] Attempt ${attempt} failed: ${err?.message || err}`);

      if (attempt < retries) {
        const delay = attempt * 4000;
        console.log(`[GEMINI] Waiting ${delay}ms before retry...`);
        await sleep(delay);
      }
    }
  }

  throw lastErr;
}

async function generateModuleContent({ moduleId = null } = {}) {
  console.log(`[GENERATE] Starting content generation ${moduleId ? `for module: ${moduleId}` : 'for all modules'}`);
  
  if (!moduleId) {
    throw new Error('[GENERATE] moduleId is required.');
  }

  // Fetch all processed_modules with empty or placeholder content (optionally scoped by moduleId)
  let query = supabase
    .from('processed_modules')
    .select(`
      processed_module_id,
      title,
      original_module_id,
      learning_style
    `)
    .eq('original_module_id', moduleId)
    .or(`content.is.null,content.eq.'',content.eq.""`)
    .limit(100);

  console.log(`[GENERATE] Filtering by module_id: ${moduleId}`);

  console.log(`[GENERATE] Fetching modules from Supabase...`);
  const { data: modules, error } = await query;

  if (error) {
    console.error('[GENERATE] Supabase fetch error:', error);
    throw new Error(error.message);
  }

  console.log(`[GENERATE] Fetched ${modules?.length || 0} modules for content generation`);

  let updated = 0;
  let isFirstGeminiCall = true;
  for (const mod of modules || []) {
    console.log(`\n[MODULE] ======================================`);
    console.log(`[MODULE] Processing: ${mod.title}`);
    console.log(`[MODULE] ID: ${mod.processed_module_id}`);
    console.log(`[MODULE] Learning Style: ${mod.learning_style}`);
    console.log(`[MODULE] ======================================\n`);
    
    // Fetch company-specific RAG configuration
    let ragConfig = DEFAULT_RAG_CONFIG;
    let trainingModuleData = null;

    if (mod.original_module_id) {
      console.log(`[FETCH] Fetching training_module data for original_module_id: ${mod.original_module_id}`);
      const { data: tmData, error: tmError } = await supabase
        .from('training_modules')
        .select('ai_modules, ai_topics, ai_objectives, match_chunks, company_id')
        .eq('module_id', mod.original_module_id)
        .single();

      if (tmError) {
        console.error(`[FETCH] Error fetching training_module:`, tmError.message);
      } else if (tmData) {
        console.log(`[FETCH] Successfully fetched training_module data.`);
        trainingModuleData = tmData;
      } else {
        console.warn(`[FETCH] No training_module found for original_module_id: ${mod.original_module_id}`);
      }
    } else {
        console.warn(`[FETCH] original_module_id is missing from processed_module, cannot fetch training data.`);
    }
    
    const companyId = trainingModuleData?.company_id;
    if (companyId) {
      console.log(`[CONFIG] Fetching RAG config for company: ${companyId}`);
      ragConfig = await getCompanyRagConfig(companyId);
      console.log(`[CONFIG] Using temperature=${ragConfig.rag_temperature}, topP=${ragConfig.rag_top_p}, maxOutputTokens=${ragConfig.rag_max_output_tokens}`);
    } else {
      console.log(`[CONFIG] No company_id found, using default RAG config`);
    }
    
    try {
      let topics = [];
      let objectives = [];
      
      if (trainingModuleData) {
        console.log(`[EXTRACT] Processing training_module data.`);
        const aiModules = typeof trainingModuleData.ai_modules === 'string' 
          ? JSON.parse(trainingModuleData.ai_modules) 
          : trainingModuleData.ai_modules;

        if (Array.isArray(aiModules)) {
          console.log(`[EXTRACT] Checking ${aiModules.length} AI modules for match`);
          
          const matched = aiModules.find(m =>
            normalizeTitle(m.title) === normalizeTitle(mod.title)
          );

          if (matched) {
            console.log(`[EXTRACT] Found matching module!`);
            topics = Array.isArray(matched.topics) ? matched.topics : [];
            objectives = Array.isArray(matched.objectives) ? matched.objectives : [];
            console.log(`[EXTRACT] Extracted ${topics.length} topics, ${objectives.length} objectives`);
          } else {
            console.log(`[EXTRACT] No matching module found for title: "${mod.title}"`);
          }
        }
      } else {
        console.log(`[EXTRACT] No training_module data available to extract topics/objectives.`);
      }
      
      function normalizeTitle(title) {
        return title
          ?.toLowerCase()
          .replace(/[^\w\s]/g, '')   // remove punctuation
          .replace(/\s+/g, ' ')      // collapse multiple spaces
          .trim();
      }
      
      topics = [...new Set(topics)];
      console.log("Extracted topics:", topics);
      objectives = [...new Set(objectives)];
      console.log(`[EXTRACT] Final counts - Topics: ${topics.length}, Objectives: ${objectives.length}`);
      
      const topicsText = topics.length > 0
        ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
        : '';
      
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
        : '';
      
      console.log(`[QUERY] Building semantic query...`);
      
      // -------------------------------------
      // STEP 1: Build semantic query
      // -------------------------------------

      const semanticQuery = `
Module Title:
${mod.title}

${topicsText}

${objectivesText}
`;

      console.log(`[QUERY] Semantic query built for: ${mod.title}`);
      console.log("Module:", mod.title);
      console.log(`Topics for ${mod.title}`);
      console.log(`Objectives for ${mod.title}`, objectivesText);
      
      // -------------------------------------
      // STEP 2: Generate embedding
      // -------------------------------------
      async function generateEmbeddingWithRetry(text, retries = 3, delay = 2000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            console.log(`[EMBEDDING] Attempt ${attempt}/${retries}`);
            return await generateEmbedding(text);

          } catch (err) {
            if (attempt === retries) {
              console.error(`[EMBEDDING] All ${retries} attempts failed`);
              throw err;
            }

            console.warn(`[EMBEDDING] Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
          }
        }
      }
      async function generateEmbedding(text) {
        try {
          console.log(`[EMBEDDING] Starting embedding generation for text length: ${text.length}`);
          console.log(`[EMBEDDING] Backend URL: ${process.env.NEXT_PUBLIC_BACKEND_URL}/api/embed-query`);
          
          const response = await axios.post(
            `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/embed-query`, 
            { text },
            {
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
          
          console.log(`[EMBEDDING] Successfully generated embedding`);
          return response.data.embedding;
        } catch(err) {
          console.error(`[EMBEDDING] Error generating embedding:`, err.message);
          console.error(`[EMBEDDING] Error code:`, err.code);
          if (err.response) {
            console.error(`[EMBEDDING] Response status:`, err.response.status);
            console.error(`[EMBEDDING] Response data:`, err.response.data);
          }
          throw err;
        }
      }
   
      console.log(`[RAG] Generating embedding for module: ${mod.title}`);
      // const queryEmbedding = await generateEmbedding(semanticQuery);
      const queryEmbedding = await generateEmbeddingWithRetry(semanticQuery);
      
      console.log(`[RAG] Fetching top-K chunks from vector DB...`);
      console.log(`[RAG] Module ID: ${mod.original_module_id}`);
      
      let matchChunks = 2; // fallback

      const tm = trainingModuleData;

      const parsedMatchChunks = Number(tm?.match_chunks);

      if (Number.isInteger(parsedMatchChunks) && parsedMatchChunks > 0) {
        matchChunks = parsedMatchChunks;
      }

      
      console.log('[RAG] fetched match_chunks =', tm?.match_chunks);
      console.log('[RAG] final matchChunks =', matchChunks);


      const { data: matchedChunks, error: matchError } = await supabase.rpc(
        'match_module_chunks',
        {
          query_embedding: queryEmbedding,
          p_module_id: mod.original_module_id,
          match_count: matchChunks

        }
      );

      
      console.log(`[RAG] Matched chunks count: ${matchedChunks?.length || 0}`);

      if (matchedChunks) {
        console.log('[CHUNKS] Matched chunk IDs:', matchedChunks.map(c => c.chunk_id));
        console.log('[QUERY] Semantic Query:', semanticQuery);
      }

      if (matchError) {
        console.error(`[RAG] Vector search error:`, matchError);
      }

      // -------------------------------------
      // STEP 2.5: Fetch Images, Upload to Gemini, and Build Context
      // -------------------------------------
      const imageContextParts = [];
      const imageUrlReferences = [];
      if (matchedChunks && matchedChunks.length > 0) {
        const rankedChunkIds = matchedChunks.map(c => c.chunk_id);
        console.log(`[IMAGES] Fetching images for ranked chunk IDs:`, rankedChunkIds);

        const { data: images, error: imageError } = await supabase
          .from('vectordb_images')
          .select('image_id, storage_path, caption, surrounding_text, chunk_id, module_id')
          .in('chunk_id', rankedChunkIds);

        if (imageError) {
          console.error('[IMAGES] Error fetching images:', imageError);
        } else {
          const allImages = images || [];
          console.log(`[IMAGES] Total fetched images: ${allImages.length}`);

          const imagesByChunkId = new Map();
          for (const img of allImages) {
            if (!imagesByChunkId.has(img.chunk_id)) {
              imagesByChunkId.set(img.chunk_id, []);
            }
            imagesByChunkId.get(img.chunk_id).push(img);
          }

          const prioritizedImages = [];
          const MAX_TOTAL_IMAGES = Number(process.env.MAX_GEMINI_CONTEXT_IMAGES || 4);
          const primaryChunks = (matchedChunks || []).slice(0, Math.min(matchChunks, 4));

          for (let i = 0; i < primaryChunks.length; i++) {
            const chunk = primaryChunks[i];
            const chunkImages = imagesByChunkId.get(chunk.chunk_id) || [];
            for (const img of chunkImages) {
              if (prioritizedImages.length < MAX_TOTAL_IMAGES) {
                prioritizedImages.push({ ...img, chunk_rank: i + 1 });
              }
            }
          }

          console.log(`[GEMINI] Uploading ${prioritizedImages.length} images...`);
          for (const [index, img] of prioritizedImages.entries()) {
            try {
              const path = img.storage_path;
              if (!path) {
                  console.warn(`[GEMINI] Image object is missing storage_path`, img);
                  continue;
              }

              console.log(`[GEMINI] Downloading from private path: ${path}`);
              // console.log(`[GEMINI] Full image object:`, JSON.stringify(img, null, 2)); // Added for detailed logging
              const { data: blob, error: downloadError } = await supabase.storage
                .from('module-assets')
                .download(path);

              if (downloadError) {
                console.error(`[GEMINI] Supabase download error for path ${path}:`, downloadError.message);
                throw downloadError;
              }

              const buffer = Buffer.from(await blob.arrayBuffer());

              // Determine mimeType from file extension as a fallback
              const fileName = path.split('/').pop();
              const extension = fileName.split('.').pop().toLowerCase();
              let mimeType = blob.type;
              if (!mimeType || mimeType === 'application/octet-stream') {
                switch (extension) {
                  case 'png': mimeType = 'image/png'; break;
                  case 'jpg':
                  case 'jpeg':
                    mimeType = 'image/jpeg'; break;
                  case 'gif': mimeType = 'image/gif'; break;
                  case 'webp': mimeType = 'image/webp'; break;
                  default:
                    console.warn(`[GEMINI] Unknown extension ${extension} for ${path}, using application/octet-stream`);
                    mimeType = 'application/octet-stream';
                }
              }

              console.log(`[GEMINI] Upload prep -> file: ${fileName}, ext: ${extension}, blob.type: ${blob.type || 'n/a'}, mimeType: ${mimeType}`);

              const { data: signedUrlData, error: signedUrlError } = await supabase.storage
                .from('module-assets')
                .createSignedUrl(path, 60 * 60);

              if (signedUrlError) {
                console.warn(`[GEMINI] Failed to create signed URL for ${path}:`, signedUrlError.message);
              } else if (signedUrlData?.signedUrl) {
                imageUrlReferences.push({
                  url: signedUrlData.signedUrl,
                  caption: img.caption || 'No caption',
                  surroundingText: img.surrounding_text || 'N/A',
                  storagePath: path,
                  chunkId: img.chunk_id || '',
                  chunkRank: img.chunk_rank || ''
                });
              }

              const fileBlob = new Blob([buffer], { type: mimeType });
              const file = await ai.files.upload({
                file: fileBlob,
                config: {
                  mimeType,
                  displayName: fileName
                }
              });

              console.log(`[GEMINI] Uploaded ${file.displayName} as ${file.name}`);

              imageContextParts.push(
                { text: `\n[IMAGE ${index + 1} START]\n` },
                { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                { text: `\nCaption: ${img.caption || 'No caption'}\nRelated Text: ${img.surrounding_text || 'N/A'}\n[IMAGE ${index + 1} END]\n` }
              );

            } catch (err) {
              console.error(`[GEMINI] Failed to process and upload image ${img.storage_path || img.image_id}:`, err.message);
              if (err?.stack) {
                console.error('[GEMINI] Upload error stack:', err.stack);
              }
            }
          }
        }
      }

      // -------------------------------------
      // STEP 3: Build RAG context
      // -------------------------------------
      console.log(`[RAG] Building RAG context from matched chunks...`);
      
      const ragContext = (matchedChunks || [])
        .map((c, idx) => {
          const importance =
            idx === 0
              ? "CRITICAL PRIMARY SOURCE"
              : `SUPPORTING SOURCE (Rank ${idx + 1})`;

          return `[${importance}]:\n${c.content}`;
        })
        .join("\n\n");

      const documentContext = ragContext
        ? `
-----------------------------
SOURCE DOCUMENT CONTEXT (AUTHORITATIVE)
-----------------------------
The following content is retrieved using semantic similarity from the uploaded document.
All entities present here are FACTUAL and must be reused verbatim when relevant.

${ragContext}
`
        : '';

      const imageUrlContext = imageUrlReferences.length > 0
  ? `
-----------------------------
AVAILABLE IMAGE URLS (USE ONLY THESE)
-----------------------------
${imageUrlReferences.map((img, idx) => `${idx + 1}. URL: ${img.url}\n   Chunk ID: ${img.chunkId || 'N/A'}\n   Chunk Rank: ${img.chunkRank || 'N/A'}\n   Caption: ${img.caption}\n   Related Text: ${img.surroundingText}`).join('\n\n')}
`
  : `
-----------------------------
AVAILABLE IMAGE URLS (USE ONLY THESE)
-----------------------------
No image URLs are available for this module.
`;
      
      console.log(`[RAG] Document context built: ${documentContext ? 'YES' : 'NO'}, Length: ${documentContext.length}`);
      console.log(`[IMAGES] Signed URLs available for output: ${imageUrlReferences.length}`);

      // Compose prompt for the learning style of this row
      const style = mod.learning_style;

            const stylePrompt = `You are an expert Instructional Designer and Technical Writer.

Your task is to write ONE complete, self-contained training module, formatted as a high-quality professional e-learning chapter using rich, structured HTML5.

This module will be generated independently inside a loop. Treat it as fully isolated.

-----------------------------c
MODULE CONTEXT
-----------------------------
**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}

────────────────────────────────────
SOURCE CONTEXT (AUTHORITATIVE)
────────────────────────────────────
The following content is extracted verbatim from the source document.
All entities present here are FACTUAL.

${documentContext}

${imageUrlContext}

ANTI-REPETITION RULE (CRITICAL)

The model MUST NOT begin the module with a generic introduction to the overall subject domain.

The following are STRICTLY FORBIDDEN unless explicitly required by the source context:
- General definitions of the overall subject (e.g., "Food safety is...")
- Broad introductory statements that apply to all modules
- Repeated explanations of foundational concepts already implied across modules

The module MUST start directly with topic-specific content derived from the provided context.

If introductory context is necessary:
→ It must be strictly limited to 1–2 sentences
→ It must be directly tied to the module topic
→ It must not repeat general domain definitions

MODULE START RULE (MANDATORY)

The module MUST begin directly with structured section content.

The model MUST NOT:
- Start with a broad paragraph introducing the entire subject
- Provide a general overview before sections

The first section must immediately address a concept specific to the module title.

STRICT TOPIC FOCUS RULE (CRITICAL)
The model MUST focus exclusively on the topic defined by the **Module Title**.
Do NOT introduce or discuss other topics, even if they are related.
The entire module must be about the single, specific topic of "${mod.title}".
If the source context contains information about multiple topics, you must ONLY use the information relevant to "${mod.title}".
-----------------------------
MODULE ISOLATION RULE (CRITICAL)
-----------------------------
The module must be self-contained for its specific topic, 
but must not repeat general concepts unless they are directly required.
Do NOT reference other modules, earlier sections, or future modules.
Do NOT assume prior learner knowledge beyond what is required for the current module topic.

If a concept is NOT central to the module topic:
→ DO NOT introduce it as a general introduction.

The module must be self-contained ONLY for its specific topic,
NOT for the entire subject domain.
The response MUST NEVER be empty.

If any instruction conflict occurs,
the model must prioritize generating valid HTML content
instead of refusing or returning zero characters.

-----------------------------
CONTENT BOUNDARIES (CRITICAL)
-----------------------------

ALLOWED:
Explain and elaborate on concepts present in the topics
If the document contains specific rules, numbers, policies, or entities,
they must be reused verbatim.

If the document is conceptual and lacks detailed explanation,
the model may expand explanations while staying within the same domain.

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

IMAGE USAGE POLICY (MANDATORY – NO EXCEPTIONS)

1. You are provided with a fixed list of image URLs.
2. You MUST use ONLY those exact image URLs.
3. You are NOT allowed to:
   - Invent image URLs
   - Create placeholder images
   - Use <img data-type="...">
   - Generate generic or descriptive-only <img> tags
   
4. If a relevant image URL is not available:
   - DO NOT generate any image.
   - Do NOT create a placeholder.
   - Do NOT simulate an infographic.
   - Simply skip the image.

5. Every image MUST:
   - Use a valid provided URL.
   - Be wrapped inside the required <figure> structure.
   - Appear immediately under the correct section heading.

6. Standalone <img> tags are STRICTLY FORBIDDEN.

7. If you cannot match a provided image URL to the section concept:
   - Do NOT include an image.
   - It is better to have no image than a fake image.

8. Before inserting an image, verify:
   - Does this section concept clearly match one of the provided image URLs?
   - If no exact match exists, skip image.

10. FULL-PAGE IMAGE REJECTION RULE (MANDATORY)

Some extracted images may represent an entire scanned PDF page 
(e.g., a full page screenshot of text, headers, footers, margins).

These are NOT considered instructional images.

You MUST NOT use:
- Full-page scans
- Entire document pages
- Images that contain mostly paragraph text
- Images that replicate full sections of written content
- Images that look like a full A4/letter page
- Images that include page numbers, headers, or large text blocks

You may ONLY use:
- Diagrams
- Charts
- Tables
- Process visuals
- Infographics
- Product visuals
- Visual illustrations that support learning

If an image appears to be a full page of text:
→ DO NOT include it.
→ Skip it completely.

Under no circumstances should a full document page image be inserted into the module.

CRITICAL VALIDATION STEP:
If the image does not have a real working URL, DO NOT OUTPUT THE IMAGE.

-----------------------------
IMAGE STRUCTURE REQUIREMENT (CRITICAL)
-----------------------------

If images are provided:

You MUST use the EXACT HTML structure below.
Raw <img> tags are STRICTLY FORBIDDEN.

Do NOT output standalone <img> tags.

Every image MUST be wrapped inside a <figure> element.

Use this EXACT template:

<figure style="margin: 24px 0; text-align: center;">
  <img 
    src="IMAGE_URL"
    alt="Descriptive alt text"
    style="width:250px; max-width:100%; height:auto; display:block; margin-left:auto; margin-right:auto;"
    loading="lazy"
  />
  <figcaption style="margin-top:8px; text-align:center;">
    Image caption text here (if available)
  </figcaption>
</figure>

Rules:
• width MUST be 250px
• max-width MUST be 100%
• height MUST be auto
• display MUST be block
• margin MUST be 0 auto
• loading="lazy" MUST be included
• If no caption → remove <figcaption> but keep <figure>
• No custom CSS classes
• No div wrappers
• No alternative structures allowed

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


Do NOT force company references
Stay domain-correct
Do NOT introduce enterprise frameworks not present in the source

SOURCE TABLE USAGE RULE (OPTIONAL, NOT MANDATORY)

If a relevant table exists in ${documentContext}, the model MAY reproduce it in the module only when it directly helps explain the specific module topic.

The model is NOT required to include a table in every module.

If a table is included:

All rows, columns, headers, numbers, and wording must match the source verbatim.
The table may be reformatted into valid HTML5 table structure.
The model MUST NOT:
Modify wording
Add rows
Remove rows
Summarize content
Combine cells
Interpret the table
Add new comparison columns

If multiple tables exist in the source:
→ Include only those that are directly relevant to "${mod.title}".
→ Do NOT include unrelated tables just because they exist.

If numeric values, thresholds, limits, or caps appear in an included table:
→ They MUST appear unchanged.

If no relevant table exists for this module topic:
→ Do NOT create a table.
→ Tables are optional and should only be used when clearly useful.
-----------------------------
CONTROLLED EXPLANATION RULE
-----------------------------

Explanation is allowed ONLY to clarify document-stated content.

You MAY:
- Rephrase document language for clarity
- Break long sentences into simpler explanations
- Explain terminology only if used in the document
- Add structural learning aids (headings, bullet organization)

You MUST NOT:
- Add conceptual depth beyond document scope
- Add analogies
- Add stories
- Add hypothetical scenarios
- Add industry comparisons
- Add external examples
- Add exploratory activities not grounded in document language

All expansion must remain semantically equivalent to the source.
No net-new conceptual information may be introduced.

----------------------------------
GENERATION FAIL-SAFE RULE (MANDATORY)
----------------------------------

The model MUST always return a valid HTML response.

Returning an empty response or zero characters is NOT allowed.

If the instructions above create a logical conflict, the model MUST:

1. Prioritize producing a valid HTML module.
2. Prefer abstract educational explanations over returning nothing.
3. Relax the STRICT DOCUMENT LOCK rule only when necessary to avoid empty output.
4. Maintain domain correctness but avoid inventing organization-specific details.

Under no circumstances should the response be empty.

SECTION RULE:

Do NOT include all sections every time.

Use only what is needed from below:

Concept Overview → for explanation
Key Points → for listing
Steps → only if process exists
Comparison → only if comparing items
Key Takeaway → optional (1–2 lines)

IMPORTANT:

Use maximum 2–3 sections only
Do NOT repeat same idea in multiple sections
----------------------------------
OUTPUT LENGTH REQUIREMENT
----------------------------------

The generated HTML for this module should target approximately 1400 characters total.

Preferred range:
- Minimum: 8000 characters
- Target: 5500 to 8500 characters
- Hard upper preference: 8000 characters

Rules:
- Stop once the module is complete within the preferred range
- Do NOT expand content artificially
- Do NOT repeat the same explanation in different sections
- Do NOT add filler tables or filler bullets
- Keep the module concise but complete
- If the source is too small, produce the best complete module possible without forced padding
- If the content grows too long, prioritize the most relevant material for this module title only

----------------------------------
DEADLOCK RESOLUTION RULE
----------------------------------

If the model determines that strict interpretation of the rules would prevent generation:

1. The model MUST still produce the module.
2. The model may use generic explanations of the same domain.
3. The model must not invent companies, vendors, tools, or regulations.

Producing content is ALWAYS preferable to producing an empty response.

-----------------------------
HTML FORMATTING REQUIREMENTS (STRICT)
-----------------------------
Output ONLY valid HTML5 (no Markdown)
Use semantic elements: <section>, <article>, <h2>, <h3>, <h4>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <blockquote>
Do NOT use Markdown symbols (#, **, ---, etc)
Close all HTML tags properly
Do NOT wrap the entire output in a single <div>



STRICT DOCUMENT LOCK:

Every explanatory paragraph must be traceable to a specific concept,
statement, number, or table found in ${documentContext}.

If a reviewer cannot directly trace a sentence back to the document,
that sentence MUST NOT exist.

No conceptual expansion unless directly supported by document language.
No contextual padding.
No generic instructional filler.
No external domain knowledge.

// -----------------------------
// LEARNING STYLE ADAPTATION
// -----------------------------
// CS (Concrete Sequential):
// Structured steps, ordered tables, checkpoints

// CR (Concrete Random):
// Exploratory problems, open-ended prompts

// AS (Abstract Sequential):
// Conceptual models, comparison tables, structured analysis

// AR (Abstract Random):
// Narrative explanations, reflective prompts, discussion activities

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

  <h3>Concept Overview</h3>
  <p>Explain only the content needed for this module topic.</p>

  <!-- Optional blocks: include only if needed by the source -->
  <!-- <h3>Key Points</h3>
  <ul>
    <li>Point 1</li>
    <li>Point 2</li>
  </ul> -->

  <!-- <h3>Steps</h3>
  <table>
    <thead>
      <tr>
        <th>Step #</th>
        <th>Action</th>
        <th>Explanation</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>Action</td>
        <td>Explanation</td>
      </tr>
    </tbody>
  </table> -->

  <!-- <h3>Comparison</h3>
  <table data-comparison="true">
    <thead>
      <tr>
        <th>Aspect</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Aspect</td>
        <td>Description</td>
      </tr>
    </tbody>
  </table> -->

  <blockquote class="key-takeaway">
    <strong>Key Takeaway:</strong> Summarize only the most important point if useful.
  </blockquote>
</section>

<section class="activity">
  <h3>Learning Activity</h3>
  <p><strong>Objective:</strong> What the learner should achieve</p>
  <ol>
    <li>Instruction step one</li>
    <li>Instruction step two</li>
  </ol>
</section>

<section class="module-summary">
  <h2>Module Summary</h2>
  <ul>
    <li>Key takeaway 1</li>
    <li>Key takeaway 2</li>
  </ul>
</section>

-----------------------------
FINAL SELF-CHECK (MANDATORY)
-----------------------------
Before responding, confirm:
No company names invented or fabricated, use verbatim company names
No invented policies or procedures appear, use verbatim policies or procedures
No invented tools, vendors, or platforms appear, use verbatim tools, vendors, or platforms
All examples are generic or domain-specific only
Module is fully self-contained
`;

      console.log(`[GEMINI] Calling Gemini API...`);
      console.log(`[GEMINI] Module: ${mod.title} (${mod.processed_module_id})`);
      console.log(`[GEMINI] Learning style: ${style}`);
      console.log(`[GEMINI] Prompt length: ${stylePrompt.length} chars`);

      const geminiContents = [
        {
          role: "user",
          parts: [
            { text: stylePrompt },
            ...imageContextParts
          ]
        }
      ];

      // const response = await ai.models.generateContent({
      //   model: 'gemini-3-pro-preview',
      //   contents: geminiContents,
      //   generationConfig: {
      //     maxOutputTokens: 6000,
      //     temperature: TEMPERATURE,
      //     topP: TOP_P
      //   }
      // });

      let response;

      // wait only before the first Gemini call
      if (isFirstGeminiCall) {
        console.log("[WAIT] First Gemini call detected, waiting 3 seconds...");
        await sleep(3000);
        isFirstGeminiCall = false;
      }

      // try {
      //   response = await ai.models.generateContent({
      //     model: 'gemini-3-pro-preview',
      //     contents: geminiContents,
      //     generationConfig: {
      //       maxOutputTokens: 3000,
      //       temperature: TEMPERATURE,
      //       topP: TOP_P
      //     }
      //   });

      // } catch (err) {
      // const msg = err?.message || "";

      // console.warn("[GEMINI] First attempt failed:", msg);
      // console.warn("[GEMINI] Error cause:", err?.cause || "No cause available");

      // const shouldRetryWithoutImages =
      //   /fetch failed|sending request|cannot fetch content/i.test(msg);

      // if (shouldRetryWithoutImages) {
      //   console.warn("[GEMINI] Retrying without images after 3 seconds...");

      //   await sleep(3000);

      //   // remove all image parts
      //   geminiContents[0].parts = geminiContents[0].parts.filter(p => !p.fileData);

      //   try {
      //     response = await ai.models.generateContent({
      //       model: 'gemini-3-pro-preview',
      //       contents: geminiContents,
      //       generationConfig: {
      //         maxOutputTokens: 4000,
      //         temperature: TEMPERATURE,
      //         topP: TOP_P
      //       }
      //     });
      //   } catch (retryErr) {
      //     console.error("[GEMINI] Retry without images also failed:", retryErr?.message || retryErr);
      //     console.error("[GEMINI] Retry error cause:", retryErr?.cause || "No cause available");
      //     throw retryErr;
      //   }
      // } else {
      //   throw err;
      // }
      // }

      try {
        response = await generateWithRetry(() =>
          ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: ragConfig.rag_max_output_tokens,
              temperature: ragConfig.rag_temperature,
              topP: ragConfig.rag_top_p
            }
          })
        );
      } catch (err) {
        const msg = err?.message || "";
        console.warn("[GEMINI] Full request failed:", msg);
        console.warn("[GEMINI] Error cause:", err?.cause || "No cause available");

        const shouldRetryWithoutImages =
          /fetch failed|sending request|cannot fetch content/i.test(msg);

        if (shouldRetryWithoutImages) {
          console.warn("[GEMINI] Retrying without images after 3 seconds...");
          await sleep(3000);

          geminiContents[0].parts = geminiContents[0].parts.filter(p => !p.fileData);

          response = await generateWithRetry(() =>
            ai.models.generateContent({
              model: 'gemini-3-pro-preview',
              contents: geminiContents,
              generationConfig: {
                maxOutputTokens: ragConfig.rag_max_output_tokens,
                temperature: ragConfig.rag_temperature,
                topP: ragConfig.rag_top_p
              }
            })
          );
        } else {
          throw err;
        }
      }


    // Clean up uploaded files
    for (const part of imageContextParts) {
      if (part.fileData) {
        try {
          const fileUri = part.fileData.fileUri;
          const fileName = fileUri.split('/').pop();
          await ai.files.delete({ name: `files/${fileName}` });
          console.log(`[GEMINI] Deleted uploaded file: ${fileName}`);
        } catch (err) {
          console.warn(`[GEMINI] Failed to delete file:`, err.message);
        }
      }
    }
      
      let aiContent = '';

      if (response?.candidates?.length) {
        aiContent = response.candidates[0].content.parts
          .filter(p => p.text)
          .map(p => p.text)
          .join('');
      }
      
      console.log(`[CLEAN] Cleaning AI content...`);
      if (aiContent) {
        if (aiContent.includes('```html')) {
          console.log(`[CLEAN] Removing HTML code blocks`);
          aiContent = aiContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');
        } else if (aiContent.includes('```')) {
          console.log(`[CLEAN] Removing generic code blocks`);
          aiContent = aiContent.replace(/```[\s\S]*?```/g, '');
        }
        aiContent = aiContent.trim();
      }
      
      if (!aiContent) {
        console.warn(`[CLEAN] No content generated for module: ${mod.processed_module_id} style: ${style}`);
        continue;
      }

      if (imageUrlReferences.length > 0 && !/<img\b/i.test(aiContent)) {
        const fallbackFigures = imageUrlReferences.slice(0, 2).map((img) => {
          const safeCaption = String(img.caption || 'Supporting visual')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

          return `<figure style="margin: 24px 0; text-align: center;">\n  <img \n    src="${img.url}"\n    alt="${safeCaption}"\n    style="width:250px; max-width:100%; height:auto; display:block; margin-left:auto; margin-right:auto;"\n    loading="lazy"\n  />\n  <figcaption style="margin-top:8px; text-align:center;">${safeCaption}</figcaption>\n</figure>`;
        }).join('\n');

        aiContent += `\n\n<section class="module-section">\n  <h2>Visual Reference</h2>\n  ${fallbackFigures}\n</section>`;
        console.log('[GEMINI] Injected fallback figures because model output contained no <img> tags.');
      }

      // Remove any learning style code references (CS, CR, AS, AR) from content
      console.log(`[CLEAN] Removing learning style references...`);
      aiContent = aiContent.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
      

      aiContent = aiContent.replace(/\b(CS|CR|AS|AR)\b/g, '');
      
      console.log(`[DB] Updating database for module: ${mod.processed_module_id}`);
      const { data: upserted, error: updateError } = await supabase
        .from('processed_modules')
        .update({ content: aiContent })
        .eq('processed_module_id', mod.processed_module_id)
        .select('processed_module_id');
      
      if (updateError) {
        console.error(`[DB] Failed to update content for processed_module ${mod.processed_module_id}:`, updateError);
      } else {
        updated++;
        console.log(`[DB] ✅ Successfully updated module ${mod.processed_module_id} (${updated} total)`);
      }
    } catch (err) {
      console.error(`[ERROR] Error processing module ${mod.processed_module_id}:`, err.message);
      console.error(`[ERROR] Stack trace:`, err.stack);
    }
  }

  console.log(`\n[GENERATE] ========================================`);
  console.log(`[GENERATE] Content generation complete`);
  console.log(`[GENERATE] Total modules updated: ${updated}`);
  console.log(`[GENERATE] ========================================\n`);
  
  return { message: `Updated ${updated} modules with AI-generated content.` };
}

module.exports = { generateModuleContent };
