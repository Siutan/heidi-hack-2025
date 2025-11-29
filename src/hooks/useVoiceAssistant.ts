import { useState, useEffect, useCallback } from 'react';
import { inferIntent } from '../voice/nlu';
import { decide } from '../voice/policy';
import { runDecision } from '../voice/executor';
import { ExecContext } from '../voice/types';

type VoiceStatus = 'idle' | 'listening' | 'wake_detected' | 'processing' | 'executing' | 'error';

export function useVoiceAssistant(context: ExecContext) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Process a command through the NLU pipeline
  const processCommand = useCallback(async (command: string) => {
    console.log("Processing command:", command);
    setStatus('processing');
    
    try {
      const candidates = await inferIntent(command);
      if (candidates.length === 0) {
        console.log("No intent matched");
        setStatus('idle');
        return;
      }

      const topCandidate = candidates[0];
      const decision = decide(topCandidate, context);

      if (decision.allow) {
        if (decision.needsConfirm) {
          console.log("Needs confirmation:", topCandidate.tool);
          // TODO: Implement confirmation UI
        }

        setStatus('executing');
        await runDecision(topCandidate, context);
        setStatus('idle');
      } else {
        console.warn("Action blocked:", decision.reason);
        setStatus('idle');
      }
    } catch (err) {
      console.error("Error processing command:", err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [context]);

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
      
      if (newStatus === 'idle' || newStatus === 'listening') {
        // Clear transcript when returning to listening state
        // Actually, keep it for a moment so user can see what was said
      }
    });

    // Listen for wake word detection
    const unsubWake = wakeWord.onWakeDetected((data) => {
      console.log('Wake word detected:', data);
      setTranscript(data.transcript);
    });

    // Listen for transcript updates (real-time)
    const unsubTranscript = wakeWord.onTranscript((data) => {
      setTranscript(data.text);
    });

    // Listen for command capture
    const unsubCommand = wakeWord.onCommandCaptured((data) => {
      console.log('Command captured:', data);
      setTranscript(data.fullTranscript);
      processCommand(data.command);
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
      unsubCommand();
      unsubError();
    };
  }, [processCommand]);

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
    } catch (err) {
      console.error('Failed to stop wake word service:', err);
    }
  }, []);

  return {
    isListening,
    transcript,
    status,
    error,
    startListening,
    stopListening,
    processCommand, // Exposed for manual testing
  };
}
