import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Command, ChevronDown, ChevronUp, Activity, GripVertical } from 'lucide-react';
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

  useEffect(() => {
    // Resize window based on view
    const height = view === 'expanded' ? 600 : 300; // Approximate heights
    // We need to get the current width to maintain it, or just pass the current width if we know it.
    // Since we are full width, we might need to be careful. 
    // Actually, setSize takes (width, height). 
    // If we want to keep the width dynamic, we should probably ask the main process to only change height, 
    // or pass the current outer width.
    // For now, let's assume a fixed width for the content or try to get it.
    // Better yet, let's send a message to resize only height or handle it in main.
    // But the API we made is (width, height).
    // Let's use document.body.scrollWidth or similar.
    
    // Actually, the window width is set in main.ts based on screen size. 
    // If we send a fixed width here, it might resize the window to something wrong.
    // Let's update the preload/main to accept just height or optional width.
    
    // For now, let's just use a hardcoded width that matches the design or try to read it.
    // But wait, the user asked for full width.
    // If I pass a specific width, I might break the full width.
    
    // Let's update the IPC to allow passing null for width to keep current width.
    if (window.electron) {
       window.electron.resizeWindow(document.body.offsetWidth, height);
    }
  }, [view]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-start p-2">
      <div className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 overflow-hidden transition-all duration-300 ease-in-out w-full flex flex-col`}>
        
        {/* Header Section */}
        <div className="flex items-center justify-between px-4 py-3 h-[68px] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100 shrink-0">
              <img src="assets/logo.svg" alt="Heidi Logo" className="w-8 h-8" />
            </div>
            
            
              <div className="flex flex-col cursor-pointer" onClick={startRecording}>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-lg text-gray-900 shrink-0">“Hi Dee...”</span>
                  <span className="text-gray-400 text-md shrink-0">Record a session</span>
                </div>
                <span className="text-xs text-gray-500">Run Heidi shortcuts using your voice</span>
              </div>
          </div>

          <div className="flex items-center gap-3">
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
                className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors shrink-0 bg-gray-100 px-3 py-1.5 rounded-lg"
              >
                View Shortcuts
                {view === 'expanded' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
            
            {/* Drag Handle */}
            <div className="drag-handle p-1 hover:bg-gray-100 rounded-md transition-colors cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600">
              <GripVertical className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Expanded Content (Shortcuts) - Dropdown Style */}
        {view === 'expanded' && (
          <div className="px-2 pb-2 pt-0 animate-in slide-in-from-top-2 duration-200 bg-gray-50/50">
            <div className="h-px w-full bg-gray-200 mb-2"></div>
            <div className="space-y-1">
              {['Record a session', 'Update a medical record', 'Get previous session notes'].map((shortcut) => (
                <button 
                  key={shortcut}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm text-sm text-gray-700 transition-all flex items-center gap-3 group border border-transparent hover:border-gray-100"
                  onClick={() => {
                    console.log(`Clicked ${shortcut}`);
                    startRecording();
                  }}
                >
                  <div className="w-2 h-2 rounded-full bg-gray-300 group-hover:bg-rose-500 transition-colors"></div>
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
