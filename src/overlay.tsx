import { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GripVertical, ChevronDown } from 'lucide-react';
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

    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!contentRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const height = entry.contentRect.height;
                // Add some padding to the height to account for shadows/borders if needed, 
                // but the contentRect should be the size of the element.
                // The outer div has p-2 (8px), so we might need to add that if we are measuring the inner div.
                // Let's measure the outer container or add the padding.
                // The structure is:
                // <div className="w-full h-full flex flex-col items-center justify-start p-2"> (Outer)
                //   <div className="bg-white..." ref={contentRef}> (Inner)
                // So if we measure Inner, we need to add 16px (p-2 * 2) to the height for the window size.

                if (window.electron) {
                    // Add padding for the outer container (p-2 = 16px) plus extra space for the shadow-2xl.
                    // shadow-2xl is quite large (~50px spread/blur), so we need significant buffer to avoid clipping.
                    window.electron.resizeWindow(document.body.offsetWidth, height + 60);
                }
            }
        });

        resizeObserver.observe(contentRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    return (
        <div className="w-full h-full flex flex-col items-center justify-start p-2">
            <div ref={contentRef} className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-[#C9B4BB] overflow-hidden transition-all duration-300 ease-in-out w-full flex flex-col`}>

                {/* Header Section */}
                <div className="flex items-center justify-between px-2 py-2 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100 shrink-0">
                            <img src="assets/logo.svg" alt="Heidi Logo" className="w-8 h-8" />
                        </div>


                        <div className="flex flex-col  w-[400px] cursor-pointer" onClick={toggleShortcuts}>
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-lg text-gray-900 shrink-0">“Hi Dee...”</span>
                                <span className="text-gray-400 text-md shrink-0">Record a session</span>
                            </div>
                            <span className="text-xs text-gray-500">Run Heidi shortcuts using your voice</span>
                        </div>
                        <div className={`transition-transform duration-300 ${view === 'expanded' ? 'rotate-180' : ''}`}>
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* <div className="flex items-center gap-1 h-8">
                 {[...Array(8)].map((_, i) => (
                   <div key={i} className="w-1 bg-rose-500 rounded-full animate-pulse" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
                 ))}
               </div> */}
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
                            <button
                                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm text-sm text-gray-700 transition-all flex items-center gap-3 group border border-transparent hover:border-gray-100"
                                onClick={async () => {
                                    if (window.electron) {
                                        const result = await window.electron.checkAndOpenApp();
                                        console.log('App check result:', result);
                                    }
                                }}
                            >
                                <div className="w-2 h-2 rounded-full bg-gray-300 group-hover:bg-blue-500 transition-colors"></div>
                                Open Mock EHR
                            </button>
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
