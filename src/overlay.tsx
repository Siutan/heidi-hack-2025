import { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import './overlay.css';

type ViewState = 'idle' | 'expanded' | 'recording' | 'response' | 'automating' | 'automating' | 'selecting-source';

interface Source {
  id: string;
  name: string;
  thumbnail: string;
}

const OverlayApp = () => {
  const [view, setView] = useState<ViewState>('expanded');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [automationStatus, setAutomationStatus] = useState<{ status: string; step?: number; totalSteps?: number; details?: string } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const toggleShortcuts = () => {
    setView('expanded');
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
        console.log('Recording finished', audioBlob);
        setTranscript("Patient is a 30 year old male presenting with severe anxiety. Symptoms started 6 months ago. He reports difficulty sleeping and concentrating at work.");
        setView('response');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setView('recording');

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
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const reset = () => {
    setView('idle');
    setTranscript('');
  };

  const handleStartAutomation = async () => {
    try {
      const availableSources = await (window as any).electron.getSources();
      setSources(availableSources);
      setView('selecting-source');
    } catch (e) {
      console.error("Failed to get sources:", e);
    }
  };

  const handleSourceSelected = async (sourceId: string) => {
    setView('automating');
    try {
      await (window as any).electron.fillTemplate(transcript, sourceId);
    } catch (e: any) {
      console.error(e);
      alert("Automation failed. Please check the error dialog.");
    }
    setView('idle');
  };

  useEffect(() => {
    let height = 600;
    if (view === 'expanded') height = 600;
    if (view === 'selecting-source') height = 600;
    
    if (window.electron) {
       window.electron.resizeWindow(document.body.offsetWidth, height);
    }
  }, [view]);

  useEffect(() => {
    if (window.electron && window.electron.onAutomationUpdate) {
      window.electron.onAutomationUpdate((_event, data) => {
        console.log("Automation update:", data);
        setAutomationStatus(data);
      });
    }
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-start p-2">
      <div className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-[#C9B4BB] overflow-hidden transition-all duration-300 ease-in-out w-full flex flex-col`}>
        
        {/* Header Section */}
        <div className="flex items-center justify-between px-2 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100 shrink-0">
              <img onClick={toggleShortcuts} src="assets/logo.svg" alt="Heidi Logo" className="w-8 h-8" />
            </div>
            
            {view === 'response' ? (
              <div className="flex flex-col">
                <span className="font-bold text-lg text-gray-900">From Dee</span>
              </div>
            ) : view === 'automating' ? (
              <div className="flex flex-col w-full pr-4">
                <span className="font-bold text-lg text-gray-900">
                  {automationStatus?.status || 'Automating...'}
                </span>
                <span className="text-xs text-gray-500 truncate">
                  {automationStatus?.details || 'Please wait...'}
                </span>
                {automationStatus?.step && automationStatus?.totalSteps && (
                   <div className="w-full bAngina Evaluation and Medication Adjustmentg-gray-200 rounded-full h-1.5 mt-1.5">
                      <div 
                        className="bg-rose-500 h-1.5 rounded-full transition-all duration-300" 
                        style={{ width: `${(automationStatus.step / automationStatus.totalSteps) * 100}%` }}
                      ></div>
                   </div>
                )}
              </div>
            ) : view === 'selecting-source' ? (
              <div className="flex flex-col">
                <span className="font-bold text-lg text-gray-900">Select EMR Screen</span>
                <span className="text-xs text-gray-500">Choose the window to automate</span>
              </div>
            ) : view === 'recording' ? (
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-gray-900">“Hi Dee...”</span>
                <button onClick={toggleShortcuts}>EMR automation</button>
              </div>
            ) : (
              <div className="flex flex-col cursor-pointer">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-lg text-gray-900 shrink-0">“Hi Dee...”</span>
                  <span className="text-gray-400 text-md shrink-0" onClick={startRecording}>Record a session</span>
                </div>
                <span className="text-xs text-gray-500">Run Heidi shortcuts using your voice</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Drag Handle */}
            <div className="drag-handle p-1 hover:bg-gray-100 rounded-md transition-colors cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600">
              <GripVertical className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Expanded Content (Shortcuts) - Dropdown Style */}
        {view === 'expanded' && (
          <div className="px-2 pb-2 pt-0 animate-in slide-in-from-top-2 duration-200 overflow-y-auto bg-gray-50/50">
            <div className="h-px w-full bg-gray-200 mb-2"></div>
            <div className="space-y-1">
              {['Record a session', 'Update a medical record', 'Get previous session notes', 'Fill EMR Template'].map((shortcut) => (
                <button 
                  key={shortcut}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm text-sm text-gray-700 transition-all flex items-center gap-3 group border border-transparent hover:border-gray-100"
                  onClick={() => {
                    console.log(`Clicked ${shortcut}`);
                    if (shortcut === 'Fill EMR Template') {
                      handleStartAutomation();
                    } else {
                      startRecording();
                    }
                  }}
                >
                  <div className="w-2 h-2 rounded-full bg-gray-300 group-hover:bg-rose-500 transition-colors"></div>
                  {shortcut}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Source Selection View */}
        {view === 'selecting-source' && (
          <div className="px-2 pb-2 pt-0 animate-in slide-in-from-top-2 duration-200 bg-gray-50/50 overflow-y-auto max-h-[500px]">
            <div className="h-px w-full bg-gray-200 mb-2"></div>
            <div className="grid grid-cols-2 gap-2">
              {sources.map((source) => (
                <button 
                  key={source.id}
                  className="flex flex-col items-center p-2 rounded-lg hover:bg-white hover:shadow-md transition-all border border-transparent hover:border-gray-200"
                  onClick={() => handleSourceSelected(source.id)}
                >
                  <img src={source.thumbnail} alt={source.name} className="w-full h-auto rounded-md mb-2 object-cover aspect-video" />
                  <span className="text-xs text-center text-gray-700 truncate w-full" title={source.name}>{source.name}</span>
                </button>
              ))}
            </div>
            <button 
              className="w-full mt-2 text-center text-sm text-gray-500 hover:text-gray-700 py-2"
              onClick={() => setView('expanded')}
            >
              Cancel
            </button>
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
