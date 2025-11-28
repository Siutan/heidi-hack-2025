import { useState, useEffect, useRef } from 'react';
import { inferIntent } from '../voice/nlu';
import { decide } from '../voice/policy';
import { runDecision } from '../voice/executor';
import { ExecContext } from '../voice/types';

// Extend Window interface for webkitSpeechRecognition
declare global {
  interface Window {
    webkitSpeechRecognition: {
      new(): SpeechRecognition;
    };
  }
}

export function useVoiceAssistant(context: ExecContext) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'executing'>('idle');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isWakeWordDetected, setIsWakeWordDetected] = useState(false);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentTranscript = finalTranscript || interimTranscript;
        setTranscript(currentTranscript);

        if (window.electron) {
          window.electron.sendTranscript(currentTranscript);
        }

        const lowerTranscript = currentTranscript.toLowerCase().trim();

        // Wake Word Logic
        if (!isWakeWordDetected) {
          if (lowerTranscript.includes('hi dee') || lowerTranscript.includes('heidi')) {
            setIsWakeWordDetected(true);
            setStatus('listening');
            // Do not clear transcript so user can see "Hi Dee..."
            // Optionally play a sound or give feedback
          }
        } else {
          // Command Capture Logic
          // If we have a final result, process it
          if (finalTranscript) {
            // Basic debounce/silence detection could go here
            processUtterance(finalTranscript);
            setIsWakeWordDetected(false); // Reset after command
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          setIsListening(false);
          setStatus('idle');
        }
      };

      recognition.onend = () => {
        // Auto-restart if we are supposed to be listening
        if (isListening) {
          try {
            recognition.start();
          } catch (e) {
            // Ignore if already started
          }
        }
      };

      recognitionRef.current = recognition;
    } else {
      console.error('Web Speech API not supported');
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isListening, isWakeWordDetected]);

  const startListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        setStatus('idle'); // Waiting for wake word
      } catch (e) {
        console.error("Error starting recognition:", e);
      }
    }
  };

  const stopListening = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      setStatus('idle');
    }
  };

  const processUtterance = async (text: string) => {
    console.log("Processing:", text);
    setStatus('processing');
    const candidates = await inferIntent(text);
    if (candidates.length === 0) {
      setStatus('idle'); // Keep listening?
      return;
    }

    const topCandidate = candidates[0];
    const decision = decide(topCandidate, context);

    if (decision.allow) {
      if (decision.needsConfirm) {
        console.log("Needs confirmation:", topCandidate.tool);
      }

      setStatus('executing');
      await runDecision(topCandidate, context);
      setStatus('idle');
    } else {
      console.warn("Action blocked:", decision.reason);
      setStatus('idle');
    }
  };

  return {
    isListening,
    transcript,
    status,
    startListening,
    stopListening,
    processUtterance // Exposed for manual testing
  };
}
