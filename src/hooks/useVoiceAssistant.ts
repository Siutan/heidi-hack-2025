import { useState, useEffect, useCallback, useRef } from 'react';
import { ExecContext } from '../voice/types';

// Match the WakeWordStatus from types.d.ts
type VoiceStatus = 'idle' | 'listening' | 'wake_detected' | 'command_window' | 'processing' | 'error';

export function useVoiceAssistant(context: ExecContext) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [geminiResponse, setGeminiResponse] = useState('');
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Audio context for playing Gemini audio responses
  const audioContextRef = useRef<AudioContext | null>(null);

  // Play audio response from Gemini (base64 encoded 24kHz PCM)
  const playAudioResponse = useCallback(async (base64Audio: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }

      const audioContext = audioContextRef.current;

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16Array (16-bit PCM)
      const int16Array = new Int16Array(bytes.buffer);

      // Convert to Float32Array for Web Audio API
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Play the audio
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();

      console.log('[useVoiceAssistant] Playing audio response');
    } catch (err) {
      console.error('[useVoiceAssistant] Error playing audio:', err);
    }
  }, []);

  // Set up wake word event listeners
  useEffect(() => {
    if (!window.electron?.wakeWord) {
      console.error('Wake word API not available');
      return;
    }

    const { wakeWord } = window.electron;

    // Listen for status changes
    const unsubStatus = wakeWord.onStatusChange((newStatus) => {
      console.log('Wake word status:', newStatus);
      setStatus(newStatus as VoiceStatus);

      if (newStatus === 'idle') {
        // Clear transcript after a delay when returning to idle
        setTimeout(() => {
          setTranscript('');
        }, 3000);
      }
    });

    // Listen for wake word detection
    const unsubWake = wakeWord.onWakeDetected((data) => {
      console.log('Wake word detected:', data);
      setTranscript(data.transcript);
      setGeminiResponse(''); // Clear previous response
    });

    // Listen for transcript updates (real-time, for wake word detection only)
    const unsubTranscript = wakeWord.onTranscript((data) => {
      setTranscript(data.text);
    });

    // Listen for Gemini text responses
    const unsubGeminiResponse = wakeWord.onGeminiResponse((data) => {
      console.log('Gemini response:', data.text);
      setGeminiResponse(prev => prev + data.text);
    });

    // Listen for Gemini audio responses
    const unsubGeminiAudio = wakeWord.onGeminiAudio((data) => {
      console.log('Gemini audio received');
      playAudioResponse(data.audio);
    });

    // Listen for errors
    const unsubError = wakeWord.onError((errorMsg) => {
      console.error('Wake word error:', errorMsg);
      setError(errorMsg);
      setStatus('error');
    });

    // Cleanup
    return () => {
      unsubStatus();
      unsubWake();
      unsubTranscript();
      unsubGeminiResponse();
      unsubGeminiAudio();
      unsubError();

      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [playAudioResponse]);

  // Start listening
  const startListening = useCallback(async () => {
    console.log('[useVoiceAssistant] startListening called');

    if (!window.electron?.wakeWord) {
      console.error('[useVoiceAssistant] Wake word API not available!');
      console.log('[useVoiceAssistant] window.electron:', window.electron);
      return;
    }

    try {
      // First request mic permission
      console.log('[useVoiceAssistant] Requesting mic permission...');
      const granted = await window.electron.requestMicPermission();
      console.log('[useVoiceAssistant] Mic permission:', granted ? 'granted' : 'denied');

      if (!granted) {
        setError('Microphone permission denied');
        setStatus('error');
        return;
      }

      console.log('[useVoiceAssistant] Starting wake word service...');
      await window.electron.wakeWord.start();
      console.log('[useVoiceAssistant] Wake word service started!');
      setIsListening(true);
      setError(null);
    } catch (err) {
      console.error('[useVoiceAssistant] Failed to start wake word service:', err);
      setError(err instanceof Error ? err.message : 'Failed to start');
      setStatus('error');
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(async () => {
    if (!window.electron?.wakeWord) {
      return;
    }

    try {
      await window.electron.wakeWord.stop();
      setIsListening(false);
      setStatus('idle');
      setTranscript('');
      setGeminiResponse('');
    } catch (err) {
      console.error('Failed to stop wake word service:', err);
    }
  }, []);

  return {
    isListening,
    transcript,
    geminiResponse,
    status,
    error,
    startListening,
    stopListening,
  };
}
