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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'AIzaSyAo-ttMVlJ-CgkqPhbYG7z6neT350pdAQU' });

// Configs 
const TEMPERATURE = 0.2;
const TOP_P = 1.0;


async function generateModuleContent({ moduleId = null } = {}) {
  // Fetch all processed_modules with empty or placeholder content (optionally scoped by moduleId)
  let query = supabase
    .from('processed_modules')
    .select('processed_module_id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives, gpt_summary)')
    .or('content.is.null,content.eq.\'\',content.eq.""');

  if (moduleId) {
    query = query.eq('original_module_id', moduleId);
  }

  const { data: modules, error } = await query;

  if (error) {
    console.error('Supabase fetch error:', error);
    throw new Error(error.message);
  }

  // console.log(`Fetched ${modules?.length || 0} modules for content generation.`);

  let updated = 0;
  for (const mod of modules || []) {
    try {
      // Extract topics, objectives, and summaries from all related training_modules/ai_modules
      let topics = [];
      let objectives = [];

      if (Array.isArray(mod.training_modules)) {
        for (const tm of mod.training_modules) {
          if (Array.isArray(tm.ai_modules)) {
            const matched = tm.ai_modules.find(m =>
              m.title?.trim().toLowerCase() === mod.title?.trim().toLowerCase()
            );
            console.log("Processed title:", mod.title);
            console.log("AI module titles:", tm.ai_modules.map(m => m.title));


            if (matched) {
              topics = Array.isArray(matched.topics) ? matched.topics : [];
              objectives = Array.isArray(matched.objectives) ? matched.objectives : [];
            }
          }
        }
      }
      topics = [...new Set(topics)];
      objectives = [...new Set(objectives)];
      // globalObjectives = [...new Set(globalObjectives)];
      // summaries = [...new Set(summaries)];
      // if (objectives.length === 0 && globalObjectives.length > 0) {
      //   objectives = globalObjectives;
      // }
      const topicsText = topics.length > 0
        ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
        : '';
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
        : '';

      
      
      //const companyContext = summaries.length > 0
      //  ? `\n\n**COMPANY-SPECIFIC CONTEXT (CRITICAL):**\n${summaries.join('\n\n')}`
      //  : '';

            // -------------------------------------
            // STEP 1: Build semantic query
            // -------------------------------------

            const semanticQuery = `
            Module Title:
            ${mod.title}

            ${topicsText}

            ${objectivesText}
            `;

            console.log("Module:", mod.title);
            
            // -------------------------------------
            // STEP 2: Generate embedding
            // -------------------------------------

            

            async function generateEmbedding(text) {
              const response = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_URL}`, { text });
              return response.data.embedding;
            }
            const queryEmbedding = await generateEmbedding(semanticQuery);


            // -------------------------------------
            // STEP 3: Fetch Top-K chunks
            // -------------------------------------

            const { data: matchedChunks, error: matchError } = await supabase.rpc(
              'match_module_chunks',
              {
                query_embedding: queryEmbedding,
                p_module_id: mod.original_module_id,
                match_count: 6
              }
            );
            console.log("Matched chunks count:", matchedChunks?.length);


            if (matchError) {
              console.error("Vector search error:", matchError);
            }

            // -------------------------------------
            // STEP 4: Build RAG context
            // -------------------------------------

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

            // Compose prompt for the learning style of this row
            const style = mod.learning_style;

            const stylePrompt = `You are an expert Instructional Designer and Technical Writer.

Your task is to write ONE complete, self-contained training module, formatted as a high-quality professional e-learning chapter using rich, structured HTML5.

This module will be generated independently inside a loop. Treat it as fully isolated.

-----------------------------
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

Output ONLY the final HTML5`;

            console.log(`Calling Gemini for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: stylePrompt,
                generationConfig: {
                    maxOutputTokens: 6000,
                    temperature: TEMPERATURE,
                    topP: TOP_P
                }
            });
            let aiContent = response.text;

            // Clean the response to remove any potential markdown code blocks
            if (aiContent) {
                if (aiContent.includes('```html')) {
                    aiContent = aiContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                } else if (aiContent.includes('```')) {
                    aiContent = aiContent.replace(/```[\s\S]*?```/g, '');
                }
                aiContent = aiContent.trim();
            }
            if (!aiContent) {
                console.warn(`No content generated for module: ${mod.processed_module_id} style: ${style}`);
                continue;
            }

            // Remove any learning style code references (CS, CR, AS, AR) from content
            aiContent = aiContent.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
            aiContent = aiContent.replace(/\b(CS|CR|AS|AR)\b/g, '');
            // Upsert the content using processed_module_id as the conflict key.
            const { data: upserted, error: updateError } = await supabase
                .from('processed_modules')
                .update({ content: aiContent })
                .eq('processed_module_id', mod.processed_module_id)
                .select('processed_module_id');
            if (updateError) {
                console.error(`Failed to upsert content for processed_module ${mod.processed_module_id} style ${style}:`, updateError);
            } else {
                updated++;
                // console.log(`Upserted content for processed_module ${mod.processed_module_id} with AI content for style ${style}.`);
            }
        } catch (err) {
            console.error(`Error processing module ${mod.module_id}:`, err);
            console.error(`Error processing module ${mod.processed_module_id}:`, err);
        }
    }

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
