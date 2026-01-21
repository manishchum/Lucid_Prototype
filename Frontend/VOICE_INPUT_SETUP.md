# Voice Input Setup Guide

## Overview
This implementation adds Speech-to-Text functionality to the Lucid Assistant using Google Gemini 1.5 Pro.

## User Flow
1. User clicks the microphone button in the assistant chat
2. Browser records audio (requires microphone permission)
3. User clicks the stop button (red square with pulse animation)
4. Audio is automatically sent to the backend
5. Backend transcribes audio using Gemini
6. Transcribed text is filled into the text input field
7. User can review/edit the text and press Enter to send

## Files Created/Modified

### New Files
1. **`/app/api/speech-to-text/route.ts`** - Backend API route for transcription
2. **`/components/VoiceInput.tsx`** - Reusable voice input component

### Modified Files
1. **`/components/LucidAssistant.tsx`** - Integrated voice input button

## Environment Setup

Add to your `.env.local`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

## Features

### Frontend (VoiceInput Component)
- ✅ Microphone button with visual states
- ✅ Recording indicator (red pulsing button)
- ✅ Processing state (disabled gray button)
- ✅ Audio recording using MediaRecorder API
- ✅ WebM audio format
- ✅ Automatic transcription on stop
- ✅ Error handling with user-friendly alerts
- ✅ Microphone permission handling

### Backend (API Route)
- ✅ Secure API key from environment
- ✅ Accepts multipart/form-data
- ✅ Converts audio to base64
- ✅ Gemini 1.5 Pro for transcription
- ✅ Returns clean JSON response
- ✅ Comprehensive error handling

## Testing

1. Open the Lucid Assistant
2. Click the microphone button (should prompt for mic permission on first use)
3. Speak clearly into your microphone
4. Click the red square button to stop recording
5. Wait for processing (button will be gray)
6. Transcribed text should appear in the input field
7. Review/edit if needed and press Enter to send

## Browser Compatibility

Requires browsers that support:
- MediaRecorder API
- getUserMedia
- FormData
- Fetch API

Tested on:
- Chrome/Edge 85+
- Firefox 80+
- Safari 14+

## Error Handling

The implementation handles:
- Missing microphone permissions
- No audio recorded
- Network errors
- API errors
- Invalid audio format
- Missing API key

## Security Notes

- API key is stored server-side only
- Audio is not persisted on the server
- Base64 encoding is used for secure transmission
- CORS is handled by Next.js API routes

## Customization

### Change Recording Format
In `VoiceInput.tsx`, modify:
```typescript
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm', // Change to 'audio/mp4' or 'audio/ogg'
});
```

### Change Gemini Model
In `/app/api/speech-to-text/route.ts`, modify:
```typescript
const model = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-pro' // or 'gemini-1.5-flash'
});
```

### Styling
The VoiceInput component uses Tailwind classes. Modify the className strings in `VoiceInput.tsx` to match your design system.

## Known Limitations

1. Audio is limited by browser's MediaRecorder codec support
2. Large audio files (>10MB) may take longer to process
3. Background noise may affect transcription accuracy
4. Requires active internet connection

## Troubleshooting

**Microphone permission denied:**
- Check browser settings
- Ensure HTTPS (required for getUserMedia)
- Clear site permissions and retry

**No transcription returned:**
- Check GEMINI_API_KEY is set correctly
- Verify API key has Speech-to-Text enabled
- Check browser console for errors

**Poor transcription quality:**
- Speak clearly and at moderate pace
- Reduce background noise
- Ensure good microphone quality
- Try shorter recordings (30-60 seconds optimal)

## Future Enhancements

Potential improvements:
- [ ] Show audio waveform during recording
- [ ] Add recording time counter
- [ ] Support multiple audio formats
- [ ] Add language selection
- [ ] Enable streaming transcription
- [ ] Save recording history
- [ ] Add pause/resume functionality
