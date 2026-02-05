// Standalone version of generate-module-content for VM worker
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
      let globalObjectives = [];
      let summaries = [];
      if (Array.isArray(mod.training_modules)) {
        for (const tm of mod.training_modules) {
          if (Array.isArray(tm.ai_modules)) {
            for (const aimod of tm.ai_modules) {
              if (Array.isArray(aimod.topics)) {
                topics.push(...aimod.topics);
              }
              if (Array.isArray(aimod.objectives)) {
                objectives.push(...aimod.objectives);
              }
            }
          }
          if (Array.isArray(tm.ai_objectives)) {
            globalObjectives.push(...tm.ai_objectives);
          }
          if (tm.gpt_summary && typeof tm.gpt_summary === 'string') {
            summaries.push(tm.gpt_summary);
          }
        }
      }
      topics = [...new Set(topics)];
      objectives = [...new Set(objectives)];
      globalObjectives = [...new Set(globalObjectives)];
      summaries = [...new Set(summaries)];
      if (objectives.length === 0 && globalObjectives.length > 0) {
        objectives = globalObjectives;
      }
      const topicsText = topics.length > 0
        ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
        : '';
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
        : '';
      const companyContext = summaries.length > 0
        ? `\n\n**COMPANY-SPECIFIC CONTEXT (CRITICAL):**\n${summaries.join('\n\n')}`
        : '';

      console.log(companyContext);
      // Compose prompt for the learning style of this row
      const style = mod.learning_style;
      const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter with rich HTML formatting.

**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}${companyContext}

**CRITICAL COMPANY-SPECIFIC REQUIREMENTS:**
1. This training module is for a SPECIFIC COMPANY whose context is provided above.
2. You MUST reference the company name, policies, procedures, and specific business context throughout the content.
3. DO NOT write generic textbook content - all examples, scenarios, and explanations must be tailored to THIS company's operations.
4. Extract and use company-specific terminology, processes, and examples from the context provided.
5. When discussing concepts, tie them directly to how they apply within THIS organization.
6. If the company name appears in the context, use it naturally throughout the module (minimum 3-5 times).
7. All activities and examples must reflect the company's actual work environment and challenges.

**Core Instructions:**
1.  **Content Fidelity:** Create comprehensive content based on the topics and objectives provided.
2.  **Tone & Style:** Professional, engaging, and instructive. Adapt the delivery to the specific Learning Style provided below.
3.  **HTML Formatting (STRICT REQUIREMENT):**
    * Use semantic HTML5 elements: <h2>, <h3>, <p>, <strong>, <em>, <table>, <ul>, <ol>, <li>, <blockquote>, <section>, <article>.
    * For tables: Use proper <table>, <thead>, <tbody>, <tr>, <th>, <td> tags. Add data-comparison="true" attribute to comparison tables.
    * For callouts/tips: Use <div class="callout tip">, <div class="callout warning">, or <div class="callout definition">.
    * For lists: Use <ul> for unordered and <ol> for ordered lists with proper <li> items.
    * For key takeaways: Use <blockquote class="key-takeaway">.
    * NO Markdown syntax - output pure HTML only. Do NOT use **, ##, ---, etc.
    * Do NOT wrap everything in a single <div> - use semantic section organization.
4.  **Table Requirements (CRITICAL):**
    * When comparing concepts, create comparison tables with clear headers and rows.
    * When listing steps, create step tables with Step #, Action, and Details columns.
    * When presenting data, use appropriate data visualization tables.
    * Tables MUST use <thead> for headers and <tbody> for content.
    * Each table MUST have a descriptive <caption> element or preceding context.
5.  **Visual Aids:** Insert descriptive <img> tags with data-type="diagram", data-type="chart", data-type="infographic" attributes and clear alt text. These will be replaced with actual assets later. Do not use them just for decoration.

**Learning Style Adaptation (${style}):**
* **If CS (Concrete Sequential):** Use structured step tables, numbered lists, clear procedural content with checkpoints, and factual headings.
* **If CR (Concrete Random):** Use problem-solving scenarios, interactive prompts, open-ended formatting, and "Try this" sections.
* **If AS (Abstract Sequential):** Use comparison tables, theoretical models, logical frameworks, data tables, and deep analysis.
* **If AR (Abstract Random):** Use group scenario sections, emotional context, narrative examples, collaborative prompts, and discussion tables.

---

**REQUIRED HTML STRUCTURE:**

<section class="learning
-objectives">
<h2>Learning Objectives</h2>
<ol>
<li>Clear, measurable objective 1</li>
<li>Clear, measurable objective 2</li>
<li>Clear, measurable objective 3</li>
</ol>
</section>

<section class="module-section">
<h2>Section 1: [Descriptive Title]</h2>

<h3>Concept</h3>
<p>Explain the core concept in depth. Use 300+ words with clear explanations.</p>

<h3>Real-World Context</h3>
<p>Provide specific business examples. Include practical applications.</p>

<h3>Key Points Comparison</h3>
<table>
<thead>
<tr><th>Aspect</th><th>Description</th><th>Example</th></tr>
</thead>
<tbody>
<tr><td>Point 1</td><td>Details</td><td>Example</td></tr>
</tbody>
</table>

<blockquote class="key-takeaway"><strong>Key Takeaway:</strong> State the most important point from this section.</blockquote>
</section>

<section class="activity">
<h3>Activity 1: [Activity Name]</h3>
<p><strong>Objective:</strong> What will the learner achieve?</p>
<p><strong>Time:</strong> [Estimated time]</p>
<h4>Instructions</h4>
<ol>
<li>First instruction step</li>
<li>Second instruction step</li>
<li>Reflection question or deliverable</li>
</ol>
</section>

(Continue with Section 2, 3, etc. following the same HTML structure with tables, comparisons, and activities)

<section class="module-summary">
<h2>Module Summary</h2>
<h3>Key Takeaways</h3>
<ul>
<li>Takeaway 1</li>
<li>Takeaway 2</li>
<li>Takeaway 3</li>
</ul>
</section>

---

**IMPORTANT REMINDERS:**
- Output ONLY valid HTML5, no Markdown syntax.
- Ensure proper semantic structure with <section>, <h2>, <h3>, <p>, <table>, <ul>, <ol> tags.
- Do NOT output any markdown characters like #, ##, ***, ---, >, etc.
- Do NOT output code blocks with \`\`\`.
- Do NOT use any markdown formatting - use HTML only.
- All tables MUST have proper <thead> and <tbody> structure.
- All lists MUST use <ul>/<ol> with <li> elements
- All emphasis MUST use <strong> or <em> tags, NOT ** or * symbols.
- Close all HTML tags properly.
- Generate 3-5 comprehensive sections, each with supporting tables or structured content where appropriate.`;
      console.log(`Calling Gemini for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: stylePrompt,
        generationConfig: {
          maxOutputTokens: 65000,
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
