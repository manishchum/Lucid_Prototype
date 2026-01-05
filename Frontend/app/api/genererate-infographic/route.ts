import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { content } = await req.json();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Convert this study text into 5–6 infographic sections.
Each section should have:
- short heading
- 3–5 very short points

Return ONLY valid JSON in this exact format:
[
  { "heading": "Section title", "points": ["p1","p2","p3"] }
]

Study Text:
${content}`,
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  const sections = JSON.parse(resultText);
  const formatted = sections.map((s: any) => ({
    heading: s.heading || "",
    points: s.points || [],
  }));

  return Response.json(formatted);
}
