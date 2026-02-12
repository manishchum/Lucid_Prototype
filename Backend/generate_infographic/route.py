import os
import re
import json
from typing import Dict, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
# from supabase import create_client, Client
from utils.supabase_client import supabase

import google.generativeai as genai

# --------------------------------------------------------------------------
# GEMINI SERVICE LOGIC
# --------------------------------------------------------------------------

apiKey = os.getenv("GEMINI_API_KEY")

print("[geminiService] API key configured:", bool(apiKey))
print("[geminiService] API key length:", len(apiKey) if apiKey else 0)

if not apiKey:
    print("[geminiService] No API key found in environment variables")
    raise Exception("GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")

genai.configure(api_key=apiKey)
model = genai.GenerativeModel("gemini-2.5-flash-lite")

# --------------------------------------------------------------------------
# SUPABASE INIT (same as TS import)
# --------------------------------------------------------------------------

# supabase: Client = create_client(
#     os.environ["NEXT_PUBLIC_SUPABASE_URL"],
#     os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# )

# --------------------------------------------------------------------------
# TYPES (Python equivalent)
# --------------------------------------------------------------------------

InfographicData = Dict[str, Any]


# --------------------------------------------------------------------------
# GENERATE INFOGRAPHIC DATA
# --------------------------------------------------------------------------

async def generateInfographicData(fileContent: str) -> InfographicData:
    systemPrompt = """You are an expert at creating professional infographics from educational content. 
Your task is to analyze the provided content and structure it into a comprehensive visual infographic format.

The infographic should have:
1. A main title that captures the essence of the content
2. Two primary sections with detailed points and sub-sections
3. A final section highlighting critical warnings or red flags

Output ONLY valid JSON that follows this structure:
{
  "title": "Main title of infographic",
  "sections": [
    {
      "title": "Section title",
      "icon": "umbrella or clipboard",
      "points": [
        { "title": "Point title", "text": "Point description" }
      ],
      "subSections": [
        {
          "title": "Subsection title",
          "icon": "person, property, or term",
          "color": "blue, green, or yellow",
          "points": [
            { "title": "Detail title", "text": "Detail description" }
          ]
        }
      ]
    }
  ],
  "criticalFlags": {
    "title": "Critical Red Flags or Key Warnings",
    "flags": [
      {
        "title": "Flag title",
        "icon": "mismatch, gauge, or legal",
        "text": "Description of the warning",
        "value": "Optional metric value like 65% or null"
      }
    ]
  }
}

Keep all text concise and informative. Extract the most important information from the content."""

    prompt = f"{systemPrompt}\n\nDocument Content:\n---\n{fileContent}\n---"
    print("[geminiService] Sending prompt to Gemini model")
    try:
        print("[geminiService] Starting content generation...")
        response = model.generate_content(prompt)
        text = response.text or ""

        print("[geminiService] Raw Gemini response length:", len(text))
        print("[geminiService] Raw Gemini response preview:", text[:1000])

        jsonText = text.strip()

        jsonMatch = re.search(r"```json\s*([\s\S]*?)\s*```", text) or \
                    re.search(r"```\s*([\s\S]*?)\s*```", text)

        if jsonMatch:
            print("[geminiService] Found JSON in code block")
            jsonText = jsonMatch.group(1).strip()
        else:
            print("[geminiService] No code block found, extracting by braces")
            firstBrace = text.find("{")
            lastBrace = text.rfind("}")
            if firstBrace != -1 and lastBrace != -1:
                jsonText = text[firstBrace:lastBrace + 1]
                print("[geminiService] Extracted JSON by braces, length:", len(jsonText))

        print("[geminiService] JSON to parse preview:", jsonText[:500])

        data = json.loads(jsonText)
        print("[geminiService] Successfully parsed JSON")
        return data

    except Exception as error:
        print("[geminiService] Failed to parse Gemini response:", error)
        raise Exception("Could not parse the data from the AI model.")


# --------------------------------------------------------------------------
# ROUTE
# --------------------------------------------------------------------------

router = APIRouter()

@router.post("/generate-infographic")
async def POST(request: Request):
    print("[generate-infographic] Received request")
    try:
        body = await request.json()
        content = body.get("content")
        title = body.get("title")
        processed_module_id = body.get("processed_module_id")

        if not content or not title:
            return JSONResponse(
                {"error": "Content and title are required"},
                status_code=400
            )

        print("[generate-infographic] Generating infographic for:", title)
        print("[generate-infographic] Content length:", len(content))
        print("[generate-infographic] Module ID:", processed_module_id)

        if processed_module_id:
            existingModule = supabase.table("processed_modules") \
                .select("infographic_data") \
                .eq("processed_module_id", processed_module_id) \
                .execute()

            if existingModule.data and existingModule.data[0].get("infographic_data"):
                print("[generate-infographic] Returning cached infographic data")
                return JSONResponse(existingModule.data[0]["infographic_data"])

        infographicData = await generateInfographicData(content)

        print("[generate-infographic] Successfully generated infographic")

        if processed_module_id:
            supabase.table("processed_modules") \
                .update({"infographic_data": infographicData}) \
                .eq("processed_module_id", processed_module_id) \
                .execute()

            print("[generate-infographic] Successfully saved to database")

        return JSONResponse(infographicData)

    except Exception as error:
        print("[generate-infographic] Error:", error)
        return JSONResponse(
            {"error": str(error) or "Failed to generate infographic"},
            status_code=500
        )
