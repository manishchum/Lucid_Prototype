# Animated Avatar Instructions

## How to Add the Animated AI Avatar

### 📥 Download the Animation

1. **From Pinterest**: https://pin.it/2oMnGvRZx
   - Click on the pin to open it
   - Click the download button or right-click "Save image as..."
   - Save as `ai-avatar.gif` (or `.mp4` if it's a video)

### 📁 Add to Project

2. **Place the file here**: `/public/images/ai-avatar.gif`
   - Full path: `/Frontend/public/images/ai-avatar.gif`
   - The code is already configured to use this filename

### 🎬 Supported Formats

- **GIF** (Recommended) - Already configured ✅
- **MP4/WebM** (Video) - If you prefer video format
- **APNG** (Animated PNG) - Also works

### 🔄 Using Video Instead of GIF

If you have a video file (`.mp4`, `.webm`), you can use it too!
Change the code in `/components/roleplay/RolePlayConversation.tsx` to use a `<video>` tag instead.

### 🎯 Animation Tips

- **Size**: 256x256 pixels or larger (square format)
- **Loop**: Make sure the animation loops seamlessly
- **File Size**: Keep it under 5MB for best performance
- **Background**: Transparent background looks best

### ✨ What You'll Get

- Animated character that loops continuously
- Scales up when AI is speaking
- Animated rings around avatar when speaking
- Falls back to 🎭 emoji if file not found

## Current Setup

✅ Code configured for: `/images/ai-avatar.gif`
✅ Animation will loop automatically
✅ Supports GIF animations
✅ Fallback emoji ready

**Next Step**: Download the animation from Pinterest and save it as `/public/images/ai-avatar.gif` 🎬
