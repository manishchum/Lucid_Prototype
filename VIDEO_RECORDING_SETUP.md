# Video Recording Setup Guide

This guide explains how to set up video recording for roleplay sessions in the Lucid Prototype application.

## Overview

The application now records video of roleplay sessions, stores them in Supabase Storage, and displays them in the reports section so users can review their performance.

## Database Migration

First, apply the database migration to add the `video_url` column to the `roleplay_sessions` table:

```sql
-- Run this migration file:
Frontend/migrations/20260117_add_video_url_to_roleplay_sessions.sql
```

This adds:
- `video_url` column (TEXT) to store the public URL of the recorded video
- Index for faster lookups when filtering sessions with videos

## Supabase Storage Setup

### 1. Create Storage Bucket

Go to your Supabase project dashboard:

1. Navigate to **Storage** in the left sidebar
2. Click **New Bucket**
3. Create a bucket with these settings:
   - **Name**: `roleplay-videos`
   - **Public**: ✅ Yes (checked)
   - **File size limit**: 100 MB (or adjust based on your needs)
   - **Allowed MIME types**: `video/webm, video/mp4`

### 2. Set Up Storage Policies

Add these Row Level Security (RLS) policies to the `roleplay-videos` bucket:

#### Policy 1: Allow Authenticated Users to Upload
```sql
-- Name: Allow authenticated users to upload
-- Operation: INSERT
CREATE POLICY "Authenticated users can upload videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'roleplay-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

#### Policy 2: Allow Public Read Access
```sql
-- Name: Public can view videos
-- Operation: SELECT
CREATE POLICY "Public can view videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'roleplay-videos');
```

#### Policy 3: Allow Users to Update Their Videos
```sql
-- Name: Users can update their own videos
-- Operation: UPDATE
CREATE POLICY "Users can update their own videos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'roleplay-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

#### Policy 4: Allow Users to Delete Their Videos
```sql
-- Name: Users can delete their own videos
-- Operation: DELETE
CREATE POLICY "Users can delete their own videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'roleplay-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

### 3. Verify Storage Configuration

In Supabase Dashboard > Storage > roleplay-videos:
- ✅ Public bucket enabled
- ✅ All 4 policies created and enabled
- ✅ File size limit configured

## How It Works

### 1. Recording Start
When a user starts a roleplay conversation:
1. MediaStream is obtained from `getUserMedia()` with video and audio
2. MediaRecorder is initialized with the stream
3. Video chunks are collected in memory during the conversation
4. Recording state is tracked with `isRecording` flag

### 2. Recording Stop
When the conversation ends:
1. MediaRecorder is stopped
2. Video chunks are combined into a single Blob
3. Blob is uploaded to Supabase Storage at `roleplay-sessions/{sessionId}/{timestamp}.webm`
4. Public URL is retrieved and saved to `roleplay_sessions.video_url` column

### 3. Video Playback
In the reports section:
1. Sessions are queried with their video URLs
2. If a video exists, a video player is rendered
3. Users can play/pause, seek, and control volume
4. Video is displayed alongside assessment scores and transcript

## File Structure

### Modified Files

1. **`components/roleplay/RolePlayConversation.tsx`**
   - Added video recording refs: `mediaRecorderRef`, `recordedChunksRef`
   - Added recording state: `isRecording`, `videoUrl`
   - Implemented `uploadVideoToStorage()` function
   - Modified `startConversation()` to start recording
   - Modified `stopConversation()` to stop recording and upload

2. **`components/roleplay/RolePlayReports.tsx`**
   - Added `video_url` to `RolePlaySession` interface
   - Added video player in expanded session view
   - Displays video between summary and performance breakdown

3. **`migrations/20260117_add_video_url_to_roleplay_sessions.sql`**
   - New migration to add video URL column

## Testing

### 1. Test Recording
1. Start a roleplay session
2. Check browser console for recording logs:
   - `🔴 Video recording started`
   - `📹 Video chunk recorded: X bytes`
   - `🛑 Stopping video recording...`
   - `📤 Uploading video to storage...`
   - `✅ Video uploaded successfully`

### 2. Test Storage Upload
1. Go to Supabase Dashboard > Storage > roleplay-videos
2. Verify folder structure: `roleplay-sessions/{sessionId}/`
3. Check that video file exists with `.webm` extension
4. Verify file is accessible (public URL)

### 3. Test Video Playback
1. Navigate to Reports section
2. Expand a completed session
3. Verify video player appears
4. Test playback controls (play, pause, seek, volume)
5. Check video quality and audio sync

## Browser Compatibility

The video recording feature requires:
- MediaRecorder API support
- WebM video codec (VP9)
- getUserMedia API with video constraints

### Supported Browsers
- ✅ Chrome 47+
- ✅ Firefox 25+
- ✅ Edge 79+
- ✅ Safari 14.1+
- ✅ Opera 36+

### Fallback Behavior
If video recording fails:
- Session continues without video
- Error is logged to console
- User sees alert: "Could not access camera"
- Assessment and transcript still work normally

## Storage Considerations

### Video Size
- Average 2-3 minute session: ~10-15 MB
- 5 minute session: ~20-30 MB
- 10 minute session: ~40-60 MB

### Storage Limits
- Free tier: 1 GB storage
- Pro tier: 100 GB storage
- Estimate capacity based on expected usage

### Cleanup Strategy
Consider implementing automatic cleanup:
1. Delete videos older than 90 days
2. Delete videos for deleted sessions
3. Compress videos to reduce storage costs

## Troubleshooting

### Issue: Video not recording
**Solution:**
- Check browser permissions for camera/microphone
- Verify MediaRecorder API support
- Check console for errors

### Issue: Upload fails
**Solution:**
- Verify Supabase storage bucket exists
- Check RLS policies are configured
- Ensure user is authenticated
- Verify bucket is public

### Issue: Video not playing in reports
**Solution:**
- Check video URL is saved in database
- Verify video file exists in storage
- Test video URL directly in browser
- Check browser codec support for WebM

### Issue: Large video files
**Solution:**
- Reduce video quality in MediaRecorder options
- Implement video compression
- Set recording time limits
- Use different codec (H.264 instead of VP9)

## Future Enhancements

Potential improvements:
1. **Video compression** - Compress before upload to reduce storage
2. **Thumbnail generation** - Create preview thumbnails
3. **Download option** - Allow users to download their videos
4. **Video analytics** - Track watch time, replays
5. **Sharing** - Share videos with trainers or managers
6. **Streaming** - Stream directly to storage instead of uploading blob
7. **Multiple camera angles** - Picture-in-picture with screen recording

## Security Notes

- Videos are stored in a public bucket (anyone with URL can view)
- URLs are not guessable (includes session ID and timestamp)
- RLS policies prevent unauthorized uploads
- Consider adding video encryption for sensitive content
- Implement expiring signed URLs for private videos

## References

- [MediaRecorder API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [WebRTC getUserMedia Guide](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
