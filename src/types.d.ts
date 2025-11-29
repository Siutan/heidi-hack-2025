export {};

// Wake word status type
type WakeWordStatus = 'idle' | 'listening' | 'wake_detected' | 'processing' | 'error';

declare global {
  interface Window {
    electron: {
      // Window management
      resizeWindow: (width: number, height: number) => void;
      
      // Legacy transcript
      sendTranscript: (text: string) => void;
      onTranscriptUpdate: (callback: (text: string) => void) => void;
      
      // App management
      checkAndOpenApp: () => Promise<boolean>;
      
      // Permissions
      requestMicPermission: () => Promise<boolean>;
      
      // Wake word service
      wakeWord: {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        getStatus: () => Promise<WakeWordStatus>;
        
        onStatusChange: (callback: (status: WakeWordStatus) => void) => () => void;
        onWakeDetected: (callback: (data: { transcript: string; confidence: number }) => void) => () => void;
        onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => () => void;
        onGeminiResponse: (callback: (data: { text: string }) => void) => () => void;
        onGeminiAudio: (callback: (data: { audio: string }) => void) => () => void;
        onError: (callback: (error: string) => void) => () => void;
      };
    };
  }

  var webkitSpeechRecognition: {
    new(): SpeechRecognition;
  };

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: SpeechRecognitionErrorEvent) => void;
    onend: () => void;
  }

  interface SpeechRecognitionEvent {
    results: SpeechRecognitionResultList;
    resultIndex: number;
  }

  interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
  }
}
