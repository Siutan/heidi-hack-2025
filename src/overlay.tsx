import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Command, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import './overlay.css';

type ViewState = 'idle' | 'expanded' | 'recording' | 'response';

const OverlayApp = () => {
  const [view, setView] = useState<ViewState>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const toggleShortcuts = () => {
    if (view === 'idle') setView('expanded');
    else if (view === 'expanded') setView('idle');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        // Here you would send the audioBlob to your backend or process it
        console.log('Recording finished', audioBlob);
        setView('response');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setView('recording');

      // Simulate recording duration for demo purposes
      setTimeout(() => {
        stopRecording();
      }, 3000);

    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const reset = () => {
    setView('idle');
    setTranscript('');
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-2">
      <div className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 overflow-hidden transition-all duration-300 ease-in-out ${view === 'expanded' ? 'h-auto' : 'h-[68px]'} w-[350px]`}>
        
        {/* Header Section */}
        <div className="flex items-center justify-between px-4 py-3 h-[68px]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100">
              <Command className="w-6 h-6 text-gray-800" />
            </div>
            
            {view === 'response' ? (
              <div className="flex flex-col">
                <span className="font-bold text-lg text-gray-900">From Dee</span>
              </div>
            ) : view === 'recording' ? (
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-gray-900">“Hi Dee...”</span>
              </div>
            ) : (
              <div className="flex flex-col cursor-pointer" onClick={startRecording}>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-lg text-gray-900">“Hi Dee...”</span>
                  <span className="text-gray-400 text-lg">Record a session</span>
                </div>
                <span className="text-xs text-gray-500">Run Heidi shortcuts using your voice</span>
              </div>
            )}
          </div>

          {view === 'recording' ? (
             <div className="flex items-center gap-1 h-8">
               {/* Fake waveform animation */}
               {[...Array(8)].map((_, i) => (
                 <div key={i} className="w-1 bg-rose-500 rounded-full animate-pulse" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
               ))}
             </div>
          ) : view === 'response' ? (
            <div className="text-xs text-gray-500 cursor-pointer hover:text-gray-700" onClick={reset}>Close</div>
          ) : (
            <button 
              onClick={toggleShortcuts}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              View Shortcuts
              {view === 'expanded' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Expanded Content (Shortcuts) */}
        {view === 'expanded' && (
          <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
            <div className="h-px w-full bg-gray-200 mb-3"></div>
            <div className="space-y-2">
              {['Record a session', 'Update a medical record', 'Get previous session notes'].map((shortcut) => (
                <button 
                  key={shortcut}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors flex items-center gap-2 group"
                  onClick={() => {
                    console.log(`Clicked ${shortcut}`);
                    startRecording();
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-rose-500 transition-colors"></span>
                  {shortcut}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Response Content */}
        {view === 'response' && (
          <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
             <div className="h-px w-full bg-gray-200 mb-3"></div>
             <p className="text-sm text-gray-700 leading-relaxed">
               Yes of course! Your Session has started. I will record the transcript... Just let me know when you want to end it.
             </p>
          </div>
        )}
      </div>
    </div>
  );
};

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(<OverlayApp />);
}
