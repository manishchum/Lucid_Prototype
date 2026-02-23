import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';

interface VoiceButtonProps {
  onTranscript?: (transcript: string) => void;
  onMessage?: (message: string) => void;
  onError?: (error: string) => void;
  moduleId?: string;
  disabled?: boolean;
}

// VoiceButton component has been removed.