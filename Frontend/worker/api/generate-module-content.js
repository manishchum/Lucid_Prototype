// Standalone version of generate-module-content for VM worker
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateModuleContent({ moduleId = null } = {}) {
  // Fetch all processed_modules with empty or placeholder content (optionally scoped by moduleId)
  let query = supabase
    .from('processed_modules')
    .select('processed_module_id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives)')
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
      // Extract topics and objectives from all related training_modules/ai_modules
      let topics = [];
      let objectives = [];
      let globalObjectives = [];
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
        }
      }
      topics = [...new Set(topics)];
      objectives = [...new Set(objectives)];
      globalObjectives = [...new Set(globalObjectives)];
      if (objectives.length === 0 && globalObjectives.length > 0) {
        objectives = globalObjectives;
      }
      const topicsText = topics.length > 0
        ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
        : '';
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
        : '';

      // Compose prompt for the learning style of this row
      const style = mod.learning_style;
      const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter with rich HTML formatting.

**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}

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

<section class="learning-objectives">
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
- All lists MUST use <ul>/<ol> with <li> elements.
- All emphasis MUST use <strong> or <em> tags, NOT ** or * symbols.
- Close all HTML tags properly.
- Generate 3-5 comprehensive sections, each with supporting tables or structured content where appropriate.`;
      console.log(`Calling Gemini for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
      const model = genAI.getGenerativeModel({ model: 'gemini-3-pro-preview' });
      const result = await model.generateContent(stylePrompt);
      const response = await result.response;
      let aiContent = response.text();
      
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