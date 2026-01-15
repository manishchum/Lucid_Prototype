# Role-Play System Setup Guide

## Environment Configuration

### 1. Add Gemini API Key to .env

Add this to your `.env` file in the `Frontend` directory:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Get Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Create a new API key or use an existing one
3. Copy the key and paste it in your `.env` file

### 3. Restart the Development Server

After adding the API key, restart your Next.js development server:

```bash
cd Frontend
npm run dev
```

> **Note**: The `.env` file is already configured in your `.gitignore` to prevent accidentally committing sensitive API keys.

## System Features

### ✅ Complete Integration
- **Scenario Selection**: 4 pre-built role-play scenarios
- **Voice Input**: Uses your existing Speech-to-Text service
- **Text Input**: Type responses if preferred
- **Voice Output**: Uses your existing Text-to-Speech service
- **AI Conversation**: Powered by Gemini 2.0 Flash
- **Assessment Reports**: Automated performance analysis with scores and recommendations

### 🎯 User Flow

1. Navigate to any module
2. Click **🎭 Role Play** button
3. Select a scenario (Customer Complaint, Budget Negotiation, Sales Pitch, or Performance Review)
4. Click "Start Role-Play"
5. Have a conversation with the AI (voice or text)
6. Click "End Session" when done
7. Receive detailed assessment report with:
   - Overall performance score
   - Breakdown by skill (Communication, Objection Handling, Value Proposition, etc.)
   - Specific recommendations for improvement

### 🎙️ Voice Capabilities

**Voice Input:**
- Click microphone icon to toggle voice mode
- Click the mic button to start recording
- Speak your response
- Click again to stop and transcribe
- Automatically sends to AI for response

**Voice Output:**
- Every AI response includes a speaker icon
- Click to hear the AI's response read aloud
- Uses your existing Text-to-Speech service
- Natural-sounding voice output

### 📊 Assessment Report

After ending a session, you receive:
- **Overall Score** (0-100) with badge
- **Performance Breakdown** with individual scores for:
  - Communication Clarity
  - Objection Handling
  - Value Proposition
  - Active Listening
  - Confidence & Professionalism
- **Recommendations** for improvement
- Visual progress bars and color coding

## API Routes Created

### 1. `/api/roleplay/conversation` (POST)
**Purpose**: Handle conversation turns with AI
**Input**: 
```json
{
  "message": "user message",
  "conversationHistory": [...],
  "scenarioTitle": "...",
  "scenarioRole": "...",
  "initialPrompt": "..."
}
```
**Output**:
```json
{
  "response": "AI response text",
  "timestamp": "ISO timestamp"
}
```

### 2. `/api/roleplay/assessment` (POST)
**Purpose**: Generate performance assessment report
**Input**:
```json
{
  "messages": [...conversation history],
  "scenarioTitle": "...",
  "scenarioRole": "..."
}
```
**Output**:
```json
{
  "overallScore": 85,
  "summary": "...",
  "parameters": [...],
  "recommendations": [...]
}
```

## Components Created

1. **RolePlayConversation.tsx** - Main conversation interface
2. **AssessmentReport.tsx** - Performance report display
3. **Types & Constants** in `/lib/roleplay/`

## Testing

1. Navigate to a module page
2. Click the Role Play button
3. Select "Sales Pitch for New Software" (Easy difficulty)
4. Use voice or text to pitch a product
5. AI will respond with questions and objections
6. Handle 3-5 turns of conversation
7. Click "End Session"
8. Review your assessment report

## Troubleshooting

**"Gemini API key not configured"**
- Check that `GEMINI_API_KEY` is in your `.env` file
- Restart the development server

**Voice input not working**
- Check microphone permissions in browser
- Ensure Speech-to-Text service is configured (GOOGLE_STT_JSON)

**Voice output not working**
- Ensure Text-to-Speech service is configured
- Check browser audio permissions

**AI not responding**
- Check Gemini API key is valid
- Check browser console for errors
- Verify API quota hasn't been exceeded
