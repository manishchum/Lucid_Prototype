// import { NextRequest, NextResponse } from 'next/server'
// import { GoogleGenerativeAI } from '@google/generative-ai'
// import { supabase } from '@/lib/supabase'

// /* -------------------------------------------------------------------------- */
// /*                              GEMINI SERVICE LOGIC                          */
// /* -------------------------------------------------------------------------- */

// const apiKey =
//   process.env.GEMINI_API_KEY ||
//   process.env.GOOGLE_API_KEY ||
//   process.env.API_KEY

// console.log('[geminiService] API key configured:', !!apiKey)
// console.log('[geminiService] API key length:', apiKey?.length || 0)

// if (!apiKey) {
//   console.error('[geminiService] No API key found in environment variables')
//   throw new Error(
//     'GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set'
//   )
// }

// const genAI = new GoogleGenerativeAI(apiKey)

// type InfographicData = {
//   title: string
//   sections: {
//     title: string
//     icon: string
//     points: { title: string; text: string }[]
//     subSections: {
//       title: string
//       icon: string
//       color: string
//       points: { title: string; text: string }[]
//     }[]
//   }[]
//   criticalFlags: {
//     title: string
//     flags: {
//       title: string
//       icon: string
//       text: string
//       value?: string | null
//     }[]
//   }
// }

// async function generateInfographicData(
//   fileContent: string
// ): Promise<InfographicData> {
//   const model = genAI.getGenerativeModel({model:'gemini-2.5-flash-lite' })

//   const systemPrompt = `You are an expert at creating professional infographics from educational content. 
// Your task is to analyze the provided content and structure it into a comprehensive visual infographic format.

// The infographic should have:
// 1. A main title that captures the essence of the content
// 2. Two primary sections with detailed points and sub-sections
// 3. A final section highlighting critical warnings or red flags

// Output ONLY valid JSON that follows this structure:
// {
//   "title": "Main title of infographic",
//   "sections": [
//     {
//       "title": "Section title",
//       "icon": "umbrella or clipboard",
//       "points": [
//         { "title": "Point title", "text": "Point description" }
//       ],
//       "subSections": [
//         {
//           "title": "Subsection title",
//           "icon": "person, property, or term",
//           "color": "blue, green, or yellow",
//           "points": [
//             { "title": "Detail title", "text": "Detail description" }
//           ]
//         }
//       ]
//     }
//   ],
//   "criticalFlags": {
//     "title": "Critical Red Flags or Key Warnings",
//     "flags": [
//       {
//         "title": "Flag title",
//         "icon": "mismatch, gauge, or legal",
//         "text": "Description of the warning",
//         "value": "Optional metric value like 65% or null"
//       }
//     ]
//   }
// }

// Keep all text concise and informative. Extract the most important information from the content.`

//   const prompt = `${systemPrompt}\n\nDocument Content:\n---\n${fileContent}\n---`

//   try {
//     console.log('[geminiService] Starting content generation...')
//     const result = await model.generateContent(prompt)
//     const response = await result.response
//     const text = response.text()

//     console.log('[geminiService] Raw Gemini response length:', text.length)
//     console.log(
//       '[geminiService] Raw Gemini response preview:',
//       text.slice(0, 1000)
//     )

//     let jsonText = text.trim()

//     const jsonMatch =
//       text.match(/```json\s*([\s\S]*?)\s*```/) ||
//       text.match(/```\s*([\s\S]*?)\s*```/)

//     if (jsonMatch) {
//       console.log('[geminiService] Found JSON in code block')
//       jsonText = jsonMatch[1].trim()
//     } else {
//       console.log('[geminiService] No code block found, extracting by braces')
//       const firstBrace = text.indexOf('{')
//       const lastBrace = text.lastIndexOf('}')
//       if (firstBrace !== -1 && lastBrace !== -1) {
//         jsonText = text.slice(firstBrace, lastBrace + 1)
//         console.log(
//           '[geminiService] Extracted JSON by braces, length:',
//           jsonText.length
//         )
//       }
//     }

//     console.log(
//       '[geminiService] JSON to parse preview:',
//       jsonText.slice(0, 500)
//     )

//     const data = JSON.parse(jsonText)
//     console.log('[geminiService] Successfully parsed JSON')
//     return data as InfographicData
//   } catch (error) {
//     console.error('[geminiService] Failed to parse Gemini response:', error)
//     console.error(
//       '[geminiService] Error details:',
//       error instanceof Error ? error.message : String(error)
//     )
//     throw new Error('Could not parse the data from the AI model.')
//   }
// }

// /* -------------------------------------------------------------------------- */
// /*                                   ROUTE                                    */
// /* -------------------------------------------------------------------------- */

// export async function POST(req: NextRequest) {
//   try {
//     const { content, title, processed_module_id } = await req.json()

//     if (!content || !title) {
//       return NextResponse.json(
//         { error: 'Content and title are required' },
//         { status: 400 }
//       )
//     }

//     console.log('[generate-infographic] Generating infographic for:', title)
//     console.log('[generate-infographic] Content length:', content.length)
//     console.log('[generate-infographic] Module ID:', processed_module_id)

//     if (processed_module_id) {
//       const { data: existingModule, error: fetchError } = await supabase
//         .from('processed_modules')
//         .select('infographic_data')
//         .eq('processed_module_id', processed_module_id)
//         .single()

//       if (!fetchError && existingModule?.infographic_data) {
//         console.log(
//           '[generate-infographic] Returning cached infographic data'
//         )
//         return NextResponse.json(existingModule.infographic_data)
//       }
//     }

//     const infographicData = await generateInfographicData(content)

//     console.log('[generate-infographic] Successfully generated infographic')

//     if (processed_module_id) {
//       const { error: updateError } = await supabase
//         .from('processed_modules')
//         .update({ infographic_data: infographicData })
//         .eq('processed_module_id', processed_module_id)

//       if (updateError) {
//         console.error(
//           '[generate-infographic] Failed to save to database:',
//           updateError
//         )
//       } else {
//         console.log(
//           '[generate-infographic] Successfully saved to database'
//         )
//       }
//     }

//     return NextResponse.json(infographicData)
//   } catch (error: any) {
//     console.error('[generate-infographic] Error:', error)
//     console.error('[generate-infographic] Error message:', error?.message)
//     console.error('[generate-infographic] Error stack:', error?.stack)

//     return NextResponse.json(
//       { error: error.message || 'Failed to generate infographic' },
//       { status: 500 }
//     )
//   }
// }
