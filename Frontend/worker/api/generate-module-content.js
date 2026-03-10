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


// Configs 
const TEMPERATURE = 0.2;
const TOP_P = 1.0;



async function generateModuleContent({ moduleId = null } = {}) {
  console.log(`[GENERATE] Starting content generation ${moduleId ? `for module: ${moduleId}` : 'for all modules'}`);
  
  // Fetch all processed_modules with empty or placeholder content (optionally scoped by moduleId)
  let query = supabase
    .from('processed_modules')
    .select(`
      processed_module_id,
      title,
      content,
      original_module_id,
      learning_style,
      training_modules (
        ai_modules,
        ai_topics,
        ai_objectives,
        gpt_summary
      )
    `)
    .or('content.is.null,content.eq.\'\',content.eq.""');

    

  if (moduleId) {
    console.log(`[GENERATE] Filtering by module_id: ${moduleId}`);
    query = query.eq('original_module_id', moduleId);
  }

  console.log(`[GENERATE] Fetching modules from Supabase...`);
  const { data: modules, error } = await query;

  if (error) {
    console.error('[GENERATE] Supabase fetch error:', error);
    throw new Error(error.message);
  }

  console.log(`[GENERATE] Fetched ${modules?.length || 0} modules for content generation`);

  let updated = 0;
  for (const mod of modules || []) {
    console.log(`\n[MODULE] ======================================`);
    console.log(`[MODULE] Processing: ${mod.title}`);
    console.log(`[MODULE] ID: ${mod.processed_module_id}`);
    console.log(`[MODULE] Learning Style: ${mod.learning_style}`);
    console.log(`[MODULE] ======================================\n`);
    
    try {
      let topics = [];
      let objectives = [];
      
      console.log(`[EXTRACT] Found ${mod.training_modules?.length || 0} training modules`);
      function normalizeTitle(title) {
        return title
          ?.toLowerCase()
          .replace(/[^\w\s]/g, '')   // remove punctuation
          .replace(/\s+/g, ' ')      // collapse multiple spaces
          .trim();
      }
      
      if (Array.isArray(mod.training_modules)) {
        for (const tm of mod.training_modules) {
          if (Array.isArray(tm.ai_modules)) {
            // console.log(typeof tm.ai_modules);
            console.log(`[EXTRACT] Checking ${tm.ai_modules.length} AI modules for match`);
            // const matched = tm.ai_modules.find(m =>
            //   m.title?.trim().toLowerCase() === mod.title?.trim().toLowerCase()
            // );
            const matched = tm.ai_modules.find(m =>
              normalizeTitle(m.title) === normalizeTitle(mod.title)
            );
            console.log(`[EXTRACT] Processed title: "${mod.title}"`);
            console.log(`[EXTRACT] AI module titles:`, tm.ai_modules.map(m => m.title));

            if (matched) {
              console.log(`[EXTRACT] Found matching module!`);
              topics = Array.isArray(matched.topics) ? matched.topics : [];
              objectives = Array.isArray(matched.objectives) ? matched.objectives : [];
              console.log(`[EXTRACT] Extracted ${topics.length} topics, ${objectives.length} objectives`);
            } else {
              console.log(`[EXTRACT] No matching module found`);
            }
          }
        }
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
      console.log(`Topics for ${mod.title}`, topicsText,"--notopic");
      console.log(`Objectives for ${mod.title}`, objectivesText);
      
      // -------------------------------------
      // STEP 2: Generate embedding
      // -------------------------------------

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
      const queryEmbedding = await generateEmbedding(semanticQuery);
      
      console.log(`[RAG] Fetching top-K chunks from vector DB...`);
      console.log(`[RAG] Module ID: ${mod.original_module_id}, Match count: 6`);
      
      const { data: matchedChunks, error: matchError } = await supabase.rpc(
        'match_module_chunks',
        {
          query_embedding: queryEmbedding,
          p_module_id: mod.original_module_id,
          match_count: 6
        }
      );
      
      console.log(`[RAG] Matched chunks count: ${matchedChunks?.length || 0}`);

      if (matchError) {
        console.error(`[RAG] Vector search error:`, matchError);
      }

      // -------------------------------------
      // STEP 2.5: Fetch Images for Top-K Chunks
      // -------------------------------------

      let matchedImages = [];

      if (matchedChunks && matchedChunks.length > 0) {
        const chunkIds = matchedChunks.map(c => c.chunk_id);

        console.log(`[IMAGES] Fetching images for ${chunkIds.length} chunks`);

        const { data: images, error: imageError } = await supabase
          .from('vectordb_images')
          .select(`
            image_id,
            image_url,
            caption,
            surrounding_text,
            chunk_id
          `)
          .in('chunk_id', chunkIds);

        if (imageError) {
          console.error('[IMAGES] Error fetching images:', imageError);
        } else {
          matchedImages = images || [];
          console.log(`[IMAGES] Found ${matchedImages.length} related images`);
        }
      }

      // -------------------------------------
      // STEP 2.6: Build Image Context
      // -------------------------------------

      const imageContext = matchedImages.length > 0
        ? `
      -----------------------------
      RETRIEVED IMAGE CONTEXT (AUTHORITATIVE)
      -----------------------------
      The following images were extracted from the source document.
      You MUST use them where contextually relevant.
      Do NOT invent new images.

      ${matchedImages.map((img, idx) => `
      [IMAGE ${idx + 1}]
      URL: ${img.image_url}
      Caption: ${img.caption || 'No caption provided'}
      Related Text: ${img.surrounding_text || 'N/A'}
      Belongs to Chunk: ${img.chunk_id}
      `).join('\n')}
      `
        : '';

      console.log(`[IMAGES] Image context built: ${matchedImages.length}`);
      matchedImages = matchedImages.slice(0, 5);
      console.log("Limit images to top 5 most relevant");

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
      
      console.log(`[RAG] Document context built: ${documentContext ? 'YES' : 'NO'}, Length: ${documentContext.length}`);

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
// * **Topics to Cover:** ${topicsText}
// * **Target Objectives:** ${objectivesText}
// * **Learning Style Focus:** ${style}

────────────────────────────────────
SOURCE CONTEXT (AUTHORITATIVE)
────────────────────────────────────
The following content is extracted verbatim from the source document.
All entities present here are FACTUAL.

${documentContext}
${imageContext}

-----------------------------
MODULE ISOLATION RULE (CRITICAL)
-----------------------------
This module must be fully self-contained.
Do NOT reference other modules, earlier sections, or future modules.
Do NOT assume prior learner knowledge beyond what is implied by the topics.

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

If the source document is conceptual or educational
(e.g., AI, GenAI, leadership theory, etc.) and does NOT contain
company-specific entities:

Do NOT force company references
Stay domain-correct
Do NOT introduce enterprise frameworks not present in the source

**SOURCE TABLE REPLICATION RULE (MANDATORY)**

If ANY table exists in ${documentContext}:

1. You MUST reproduce that table in the module.
2. All rows, columns, headers, numbers, and wording MUST match verbatim.
3. You may reformat it into valid HTML5 table structure,
   but you MUST NOT:
   - Modify wording
   - Add rows
   - Remove rows
   - Summarize content
   - Combine cells
   - Interpret the table
   - Add new comparison columns

If multiple tables exist:
→ Include ALL of them.

If numeric values, thresholds, limits, or caps appear in a table:
→ They MUST appear unchanged.

If no table exists in the document:
→ Only create a table if the document logically structures
   comparative or stepwise content.
→ Do NOT invent comparison categories.
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

----------------------------------
MINIMUM OUTPUT LENGTH REQUIREMENT
----------------------------------

The generated HTML must contain AT LEAST 8000 characters.

If the content is shorter than 8000 characters, the model MUST:

• Expand explanations of existing concepts
• Add additional breakdown tables
• Add deeper clarification paragraphs
• Expand the module summary
• Expand the learning activity instructions

The model must continue expanding until the output length exceeds 8000 characters.

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
          { text: stylePrompt }
        ]
      }
    ];

    function getMimeType(url) {
      if (url.endsWith('.png')) return 'image/png';
      if (url.endsWith('.webp')) return 'image/webp';
      return 'image/jpeg';
    }

    // Attach images if available
    if (matchedImages && matchedImages.length > 0) {
      console.log(`[GEMINI] Attaching ${matchedImages.length} images to prompt`);

      for (const img of matchedImages) {
        geminiContents[0].parts.push({
          fileData: {
            fileUri: img.image_url, // must be public or signed URL
            mimeType: getMimeType(img.image_url)
          }
        });
      }
    }
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 6000,
          temperature: TEMPERATURE,
          topP: TOP_P
        }
      });
      
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




// // Standalone version of generate-module-content for VM worker
// const { createClient } = require('@supabase/supabase-js');
// const OpenAI = require('openai');
// require('dotenv').config();

// const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// async function generateModuleContent({ moduleId = null } = {}) {
//   let query = supabase
//     .from('processed_modules')
//     .select('processed_module_id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives, gpt_summary)')
//     .or('content.is.null,content.eq.\'\',content.eq.""');

//   if (moduleId) {
//     query = query.eq('original_module_id', moduleId);
//   }

//   const { data: modules, error } = await query;

//   if (error) {
//     console.error('Supabase fetch error:', error);
//     throw new Error(error.message);
//   }

//   let updated = 0;

//   for (const mod of modules || []) {
//     try {
//       let topics = [];
//       let objectives = [];
//       let globalObjectives = [];
//       let summaries = [];

//       if (Array.isArray(mod.training_modules)) {
//         for (const tm of mod.training_modules) {
//           if (Array.isArray(tm.ai_modules)) {
//             for (const aimod of tm.ai_modules) {
//               if (Array.isArray(aimod.topics)) topics.push(...aimod.topics);
//               if (Array.isArray(aimod.objectives)) objectives.push(...aimod.objectives);
//             }
//           }
//           if (Array.isArray(tm.ai_objectives)) globalObjectives.push(...tm.ai_objectives);
//           if (tm.gpt_summary && typeof tm.gpt_summary === 'string') summaries.push(tm.gpt_summary);
//         }
//       }

//       topics = [...new Set(topics)];
//       objectives = [...new Set(objectives)];
//       globalObjectives = [...new Set(globalObjectives)];
//       summaries = [...new Set(summaries)];

//       if (objectives.length === 0 && globalObjectives.length > 0) {
//         objectives = globalObjectives;
//       }

//       const topicsText = topics.length > 0
//         ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
//         : '';

//       const objectivesText = objectives.length > 0
//         ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
//         : '';

//       const companyContext = summaries.length > 0
//         ? `\n\n**COMPANY-SPECIFIC CONTEXT (CRITICAL):**\n${summaries.join('\n\n')}`
//         : '';

//       const style = mod.learning_style;

//       const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter with rich HTML formatting.

// **Module Context:**
// * **Module Title:** "${mod.title}"
// * **Topics to Cover:** ${topicsText}
// * **Target Objectives:** ${objectivesText}
// * **Learning Style Focus:** ${style}${companyContext}

// **CRITICAL COMPANY-SPECIFIC REQUIREMENTS:**
// 1. This training module is for a SPECIFIC COMPANY whose context is provided above.
// 2. You MUST reference the company name, policies, procedures, and specific business context throughout the content.
// 3. DO NOT write generic textbook content - all examples must be tailored.
// 4. Extract and use company-specific terminology from the context.
// 5. Tie concepts directly to how they apply within THIS organization.
// 6. Use the company name naturally throughout the module.
// 7. All activities must reflect the company's real environment.

// **Core Instructions:**
// - Output ONLY valid HTML5 (no Markdown)
// - Use semantic tags: <section>, <h2>, <h3>, <p>, <table>, <ul>, <ol>, <blockquote>
// - Tables must use <thead> and <tbody>
// - Lists must use <ul>/<ol> with <li>
// - Use <strong>/<em> for emphasis
// - Close all HTML tags
// - Generate 3–5 detailed sections with structured tables and activities`;

//       console.log(`Calling OpenAI for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);

//       const response = await openai.responses.create({
//         model: 'gpt-5.2-2025-12-11',
//         input: stylePrompt,
//         max_output_tokens: 7000
//       });

//       let aiContent = response.output_text;

//       if (aiContent) {
//         if (aiContent.includes('```html')) {
//           aiContent = aiContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');
//         } else if (aiContent.includes('```')) {
//           aiContent = aiContent.replace(/```[\s\S]*?```/g, '');
//         }
//         aiContent = aiContent.trim();
//       }

//       if (!aiContent) {
//         console.warn(`No content generated for module: ${mod.processed_module_id} style: ${style}`);
//         continue;
//       }

//       aiContent = aiContent.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
//       aiContent = aiContent.replace(/\b(CS|CR|AS|AR)\b/g, '');

//       const { error: updateError } = await supabase
//         .from('processed_modules')
//         .update({ content: aiContent })
//         .eq('processed_module_id', mod.processed_module_id);

//       if (updateError) {
//         console.error(`Failed to update module ${mod.processed_module_id}:`, updateError);
//       } else {
//         updated++;
//       }

//     } catch (err) {
//       console.error(`Error processing module ${mod.processed_module_id}:`, err);
//     }
//   }

//   return { message: `Updated ${updated} modules with AI-generated content.` };
// }

// module.exports = { generateModuleContent };
