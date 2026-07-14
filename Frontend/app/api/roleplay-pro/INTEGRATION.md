<!-- # Role Play Pro - Integration Guide

## Overview
This is a standalone Vite + React app that provides AI-powered sales role-play practice. It's integrated with the main Lucid LMS through a button in the module page.

## How It Works

### User Flow:
1. User clicks "Role Play" button in a module page
2. They're directed to `/employee/roleplay` page in the main app
3. That page has a button to open this app in a new window
4. User completes role-play practice in this separate window
5. Receives AI-generated assessment report

### Technical Integration:
- **Main App**: Next.js (Frontend folder)
- **Role Play App**: Vite + React (this folder)
- **Communication**: Opens in new window (can be enhanced with postMessage)

## Setup Instructions

### 1. Install Dependencies
```bash
cd Frontend/app/api/roleplay-pro
npm install
```

### 2. Configure API Key
Create or edit `.env`:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Run Development Server
```bash
npm run dev
```

The app will run on `http://localhost:5173`

### 4. Access from Main App
1. Go to any module in the main Lucid LMS
2. Click the "Role Play" button (🎭 icon)
3. Click "Open Role Play App" on the roleplay page
4. Select a scenario and start practicing!

## Features

- **Multiple Scenarios**: Different sales situations (product demos, cold calls, etc.)
- **Voice & Text Input**: Support for both voice and text-based interaction
- **AI Client Simulation**: Realistic responses with objections and questions
- **Assessment Reports**: Detailed feedback on performance with improvement suggestions
- **Scoring System**: Ratings on communication, objection handling, pitch clarity, etc.

## App Structure

```
roleplay-pro/
├── components/           # React components
│   ├── ScenarioSelection.tsx
│   ├── RolePlayScreen.tsx
│   ├── AssessmentReport.tsx
│   └── ui/              # Reusable UI components
├── services/            # API services
│   └── geminiService.ts # Gemini AI integration
├── App.tsx              # Main app component
├── types.ts             # TypeScript types
├── constants.ts         # Scenarios and constants
└── index.tsx            # Entry point
```

## Future Enhancements

### Potential Improvements:
1. **Embed in Main App**: Use iframe or micro-frontend approach
2. **Context Passing**: Pass module content to customize scenarios
3. **Progress Tracking**: Save role-play history in Supabase
4. **Team Features**: Allow managers to review employee practice sessions
5. **Mobile App**: Create React Native version
6. **Analytics Dashboard**: Track improvements over time

### Integration Options:

**Option 1: iframe (Current)**
- Simple to implement
- Isolated environment
- Easy to maintain separately

**Option 2: Module Federation (Advanced)**
- Share code between apps
- Better user experience (no new window)
- More complex setup

**Option 3: Full Integration (Long-term)**
- Move all code into main Next.js app
- Convert to Next.js pages/components
- Unified deployment

## Troubleshooting

### App won't open?
- Make sure `npm run dev` is running in roleplay-pro folder
- Check that port 5173 is not blocked
- Verify GEMINI_API_KEY is set in .env

### Voice not working?
- Allow microphone permissions in browser
- Use HTTPS in production (required for mic access)
- Check browser compatibility

### API errors?
- Verify GEMINI_API_KEY is valid
- Check network console for error details
- Ensure Gemini API quota is not exceeded

## Development

### Adding New Scenarios:
Edit `constants.ts` and add to the `SCENARIOS` array:

```typescript
{
  id: "new-scenario",
  title: "Your Scenario Title",
  description: "Description",
  difficulty: "medium",
  industry: "Technology",
  clientPersona: "...",
  objectives: ["..."]
}
```

### Customizing AI Responses:
Edit `services/geminiService.ts` to modify the system prompts and behavior.

## Contact

For questions or issues with the role-play integration, contact the development team. -->
