const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

require('../env').loadWorkerEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const sleep = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(
  callFn,
  retries = 3
) {

  let lastError;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {

    try {

      console.log(
        `[GEMINI] Attempt ${attempt}/${retries}`
      );

      return await callFn();

    } catch (err) {

      lastError = err;

      console.error(
        `[GEMINI] Attempt failed`,
        err.message
      );

      if (attempt < retries) {

        const delay =
          attempt * 4000;

        console.log(
          `[GEMINI] Retrying in ${delay}ms`
        );

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

async function generateEmbedding(text) {

  const response = await axios.post(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/embed-query`,
    { text },
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.embedding;
}

async function generateLucidToolContent({
  lucidToolJobId = null
} = {}) {

  if (!lucidToolJobId) {
    throw new Error(
      'lucidToolJobId is required'
    );
  }

  console.log(
    `[LUCID] Generating content for tool job ${lucidToolJobId}`
  );

  const {
    data: tools,
    error
  } = await supabase
    .from('processed_lucid_tools')
    .select(`
      processed_tool_id,
      lucid_tool_job_id,
      source_document_id,
      tool_name,
      semantic_retrieval_query,
      generated_content,
      tools (
        output_format_prompt
      )
    `)
    .eq(
      'lucid_tool_job_id',
      lucidToolJobId
    )
    .or('generated_content.is.null,generated_content.eq.""')

  if (error) {
    throw new Error(error.message);
  }

  if (!tools?.length) {

    console.log(
      '[LUCID] No pending tools found'
    );

    return {
      updated: 0
    };
  }


  let updated = 0;

  for (const tool of tools) {

    try {

      console.log(
        `\n[LUCID] Processing ${tool.tool_name}`
      );

      //--------------------------------------------------
      // STEP 1
      // EMBEDDING
      //--------------------------------------------------

      const queryText =
        tool.semantic_retrieval_query ||
        tool.tool_name;

      const embedding =
        await generateEmbedding(
          queryText
        );

      //--------------------------------------------------
      // STEP 2
      // VECTOR SEARCH
      //--------------------------------------------------

      const {
        data: matchedChunks,
        error: matchError
      } = await supabase.rpc(
        'match_lucid_tool_chunks',
        {
          query_embedding: embedding,
          p_document_id:
            tool.source_document_id,
          match_count: 5
        }
      );

      if (matchError) {
        throw new Error(
          matchError.message
        );
      }

      const ragContext =
        (matchedChunks || [])
          .map(chunk => chunk.content)
          .join('\n\n');

      const outputFormatPrompt =
        tool.tools?.output_format_prompt || '';

      console.log(
        '[DEBUG TOOL]',
        JSON.stringify(tool, null, 2)
      );

      //--------------------------------------------------
      // STEP 3
      // PROMPT
      //--------------------------------------------------

      const prompt = `
You are an expert Sales Enablement Consultant.

TOOL NAME:
${tool.tool_name}

SEMANTIC QUERY:
${tool.semantic_retrieval_query}

SOURCE CONTEXT:
${ragContext}

TASK

Generate professional sales enablement content.

RULES

- Use only information from source context.
- Do not invent products.
- Do not invent companies.
- Do not invent statistics.
- Preserve factual information.
- Expand explanations only when needed.
- Keep language professional.
- Use only the given output format 

OUTPUT FORMAT

You MUST follow the exact structure below.

${outputFormatPrompt}

Do not add any sections not present in the format.
Do not add explanations outside the format.
Return only the formatted output.
`;

      //--------------------------------------------------
      // STEP 4
      // GEMINI
      //--------------------------------------------------
      console.log("using gemini 2.5 flash");
      
      const response =
        await generateWithRetry(() =>
          ai.models.generateContent({
            model:
              'gemini-2.5-flash',
            contents: prompt,
            generationConfig: {
              temperature: 0.1,
              topP: 1,
              maxOutputTokens: 300
            }
          })
        );

        console.log(
        '[RAG] matched chunks:',
        matchedChunks?.length || 0
        );

        console.log(
        '[RAG] context length:',
        ragContext.length
        );

      let generatedContent = '';

      if (
        response?.candidates?.length
      ) {

        generatedContent =
          response.candidates[0]
            .content.parts
            .filter(p => p.text)
            .map(p => p.text)
            .join('');
      }

      generatedContent =
        generatedContent
          ?.replace(/```html/g, '')
          ?.replace(/```/g, '')
          ?.trim();

      if (!generatedContent) {

        console.warn(
          `[LUCID] Empty content generated for ${tool.tool_name}`
        );

        continue;
      }

      //--------------------------------------------------
      // STEP 5
      // SAVE
      //--------------------------------------------------

      const {
        error: updateError
      } = await supabase
        .from(
          'processed_lucid_tools'
        )
        .update({
          generated_content:
            generatedContent,
          updated_at:
            new Date()
        })
        .eq(
          'processed_tool_id',
          tool.processed_tool_id
        );

      if (updateError) {

        console.error(
          updateError
        );

        continue;
      }

      updated++;

      console.log(
        `[LUCID] Updated ${tool.processed_tool_id}`
      );

    } catch (err) {

      console.error(
        `[LUCID] Error processing tool`,
        tool.processed_tool_id,
        err
      );
    }
  }

  console.log(
    `[LUCID] Finished. Updated ${updated} tools`
  );

  return {
    updated
  };
}

module.exports = {
  generateLucidToolContent
};