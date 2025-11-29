/**
 * Wake Word Detection Types
 */

export type WakeWordEvent = {
  type: 'wake_detected';
  transcript: string;
  confidence: number;
  timestamp: number;
};

export type TranscriptEvent = {
  type: 'transcript';
  text: string;
  isFinal: boolean;
  timestamp: number;
};

export type CommandEvent = {
  type: 'command';
  transcript: string;
  timestamp: number;
};

export type WakeWordStatus =
  | 'idle'           // Waiting for speech
  | 'listening'      // Detected speech, streaming to Google
  | 'wake_detected'  // Wake word detected, starting Gemini
  | 'command_window' // Listening for command via Gemini (5 second window)
  | 'processing'     // Processing command
  | 'error';         // Error state

export type ToolCallEvent = {
  type: 'tool_call';
  toolName: string;
  args: Record<string, any>;
  timestamp: number;
};

export type WakeWordServiceConfig = {
  // Wake word variations to detect
  wakeWords: string[];
  // Minimum confidence threshold for wake word detection (0-1)
  wakeWordThreshold: number;
  // How long to listen for command after wake word (ms)
  commandTimeout: number;
  // Silence duration to end command capture (ms)
  silenceTimeout: number;
  // Google Cloud Speech settings
  languageCode: string;
  sampleRateHertz: number;
};

export const DEFAULT_CONFIG: WakeWordServiceConfig = {
  wakeWords: [
    'hi dee',
    'hi d',
    'heidi',
    'hey dee',
    'hey d',
    'hedy',
    'hide e',
    'hydie',
    'heydee',
    'hi di',
    'hey di',
  ],
  wakeWordThreshold:0.55,
  commandTimeout: 10000,  // 10 seconds max for command
  silenceTimeout: 2000,   // 2 seconds of silence ends command
  languageCode: 'en-US',
  sampleRateHertz: 16000,
};


