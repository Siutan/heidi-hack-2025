import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GripVertical, ChevronDown } from "lucide-react";
import "./overlay.css";
import { useVoiceAssistant } from "./hooks/useVoiceAssistant";

type ViewState = "idle" | "expanded" | "recording" | "response" | 'automating' | 'selecting-source';


interface Source {
  id: string;
  name: string;
  thumbnail: string;
}

const OverlayApp = () => {
  const [view, setView] = useState<ViewState>("expanded");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [automationStatus, setAutomationStatus] = useState<{ status: string; step?: number; totalSteps?: number; details?: string } | null>(null);
  const [pendingConversation, setPendingConversation] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Define the context for the assistant (used for local actions)
  const assistantContext = {
    isRecording,
    recorder: {
      start: async () => {
        console.log("Assistant starting recording...");
        startRecording();
      },
      stop: async () => {
        console.log("Assistant stopping recording...");
        stopRecording();
      },
    },
    ui: {
      showDetails: (entity: string) => {
        console.log("Showing details for:", entity);
        setView("response");
        setTranscript(`Showing details for ${entity}`);
      },
    },
    userPref: {
      alwaysConfirm: false,
    },
  };

  const {
    startListening: startVoice,
    status: voiceStatus,
    transcript: voiceTranscript,
    geminiResponse,
    isListening,
  } = useVoiceAssistant(assistantContext);

  // Auto-start wake word detection on mount
  useEffect(() => {
    console.log("[Overlay] Component mounted, starting wake word detection...");
    // Small delay to ensure everything is initialized
    const timer = setTimeout(() => {
      startVoice();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Update transcript from voice assistant
  useEffect(() => {
    if (voiceTranscript) {
      setTranscript(voiceTranscript);
    }
  }, [voiceTranscript]);

  // Log status changes
  useEffect(() => {
    console.log(
      "[Overlay] Voice status:",
      voiceStatus,
      "isListening:",
      isListening
    );
  }, [voiceStatus, isListening]);

  const toggleShortcuts = () => {
    switch (view) {
      case "recording":
      case "response":
        return; // Do nothing during recording or response
      case "expanded":
        setView("idle");
        break;
      case "idle":
        setView("expanded");
        break;
    }
  };

  const startRecording = async () => {
    try {
      if (window.electron) {
        const granted = await window.electron.requestMicPermission();
        if (!granted) {
          console.error("Microphone permission denied");
          return;
        }
      }

      const savedDeviceId = localStorage.getItem("selectedMicId");
      const constraints: MediaStreamConstraints = {
        audio: savedDeviceId ? { deviceId: { exact: savedDeviceId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        console.log("Recording finished", blob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setView("recording");

      // Simulate recording duration for the "Record a session" button click
      // If triggered by voice, we might want manual stop
      // setTimeout(() => {
      //   stopRecording();
      // }, 3000);

      // Auto-stop after 5 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        console.log("Auto-stopping recording after 5 seconds");
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state === "recording"
        ) {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
          // Stop all tracks
          mediaRecorderRef.current.stream
            .getTracks()
            .forEach((track) => track.stop());
        }
      }, 5000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setTranscript("Error: " + errorMsg);
      setView("response");
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      setView("response"); // Go to response after recording
    }
  };

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check permission on mount
    if (window.electron) {
      window.electron.requestMicPermission().then((granted) => {
        if (!granted) {
          console.warn("Microphone permission denied on startup");
        } else {
          console.log("Microphone permission granted on startup");
        }
      });
    }
  }, []);

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
      const textToProcess = pendingConversation || transcript;
      await (window as any).electron.fillTemplate(textToProcess, sourceId);
      setPendingConversation(null);
    } catch (e: any) {
      console.error(e);
      alert("Automation failed. Please check the error dialog.");
    }
    setView('idle');
  };

  useEffect(() => {
    // Resize window based on view
    const height = view === "expanded" ? 600 : 300; // Approximate heights
    
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

  useEffect(() => {
    if ((window as any).electron && (window as any).electron.onPromptSelectSource) {
      (window as any).electron.onPromptSelectSource((data: any) => {
        console.log("Received prompt to select source", data);
        setPendingConversation(data.conversation);
        handleStartAutomation();
      });
    }
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-start p-2">
      <div
        ref={contentRef}
        className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-[#C9B4BB] overflow-hidden transition-all duration-300 ease-in-out w-full flex flex-col`}
      >
        {/* Header Section */}
        <div className="flex items-center justify-between px-2 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100 shrink-0">
              <img onClick={toggleShortcuts} src="assets/logo.svg" alt="Heidi Logo" className="w-8 h-8" />
            </div>

            {view === "response" || geminiResponse && view !== "automating" ? (
              <div className="flex flex-col">
                <span className="font-bold text-lg text-gray-900 shrink-0">
                  🤖 Dee says...
                </span>
              </div>
            ) : voiceStatus === "processing" ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="relative space-y-1">
                    <div className="w-4 h-4 bg-purple-500 rounded-full animate-bounce"></div>
                    <div className="w-4 h-4 bg-purple-500 rounded-full animate-bounce delay-75"></div>
                    <div className="w-4 h-4 bg-purple-500 rounded-full animate-bounce delay-150"></div>
                  </div>
                  <span className="font-bold text-lg text-purple-600 shrink-0">
                    Thinking...
                  </span>
                </div>
                <span className="text-xs text-gray-500 ml-7">
                  Processing your command
                </span>
              </div>
            ) : voiceStatus === "command_window" ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                    <div className="absolute inset-0 w-4 h-4 bg-green-500 rounded-full animate-ping opacity-75"></div>
                  </div>
                  <span className="font-bold text-lg text-green-600 shrink-0">
                    Speak your command!
                  </span>
                </div>
                <span className="text-xs text-gray-500 ml-7">
                  I'm listening... (5 seconds)
                </span>
              </div>
            ) : voiceStatus === "wake_detected" ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-gray-900 shrink-0">
                    🎉 Wake word detected!
                  </span>
                  <span className="animate-pulse text-blue-500">●</span>
                </div>
                <span className="text-xs text-gray-500">
                  Starting Gemini...
                </span>
              </div>
            ) : view === "recording" ||
              voiceStatus === "listening" ? (
              <div className="flex items-center overflow-hidden whitespace-nowrap max-w-[300px]">
                {transcript ? (
                  <span className="text-lg text-gray-900 shrink-0">
                    Listening...
                  </span>
                ) : (
                  <span className="font-bold text-lg text-gray-900 shrink-0">
                    Listening for "Hi Dee"...
                  </span>
                )}
              </div>
            ) : isListening ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-gray-900 shrink-0">
                    Say "Hi Dee"
                  </span>
                  <span className="animate-pulse text-green-500">●</span>
                </div>
                <span className="text-xs text-gray-500">
                  Status: {voiceStatus} | Waiting for wake word...
                </span>
              </div>
            ) : (
              <div
                className="flex flex-col cursor-pointer"
                onClick={() => {
                  // For now, clicking this triggers the voice assistant simulation
                  console.log("[Overlay] Manual start clicked");
                  startVoice();
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="font-bold text-lg text-gray-900 shrink-0">
                    "Hi Dee..."
                  </span>
                  <span className="text-gray-400 text-md shrink-0" onClick={startRecording}>
                    Record a session
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  Status: {voiceStatus} | Click to start listening
                </span>
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
        {view === "expanded" && (
          <div className="px-2 pb-2 pt-0 animate-in slide-in-from-top-2 duration-200 overflow-y-auto bg-gray-50/50">
            <div className="h-px w-full bg-gray-200 mb-2"></div>
            <div className="space-y-1">
              {[
                "Record a session",
                "Update a medical record",
                "Get previous session notes",
              , 'Fill EMR'].map((shortcut) => (
                <button
                  key={shortcut}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm text-sm text-gray-700 transition-all flex items-center gap-3 group border border-transparent hover:border-gray-100"
                  onClick={() => {
                    console.log(`Clicked ${shortcut}`);
                    if (shortcut === 'Fill EMR') {
                      handleStartAutomation();
                    } else {
                      // Simulate voice command for this shortcut
                    // In reality, this would just run the action directly
                    if (shortcut === "Record a session") startRecording();
                    }
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
                    console.log("App check result:", result);
                  }
                }}
              >
                <div className="w-2 h-2 rounded-full bg-gray-300 group-hover:bg-blue-500 transition-colors"></div>
                Open Mock EHR
              </button>
              <button
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm text-sm text-gray-700 transition-all flex items-center gap-3 group border border-transparent hover:border-gray-100"
                onClick={() => {
                  console.log("Voice automation clicked");
                  startRecording();
                }}
              >
                <div className="w-2 h-2 rounded-full bg-gray-300 group-hover:bg-purple-500 transition-colors"></div>
                Voice Desktop Automation
              </button>
            </div>
          </div>
        )}

        {/* Recording Content */}
        {view === "recording" && (
          <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
            <div className="h-px w-full bg-gray-200 mb-3"></div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  Recording... Speak now!
                </p>
              </div>
              <button
                onClick={stopRecording}
                className="px-3 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600 transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        )}

  

        {/* Automating View */}
        {view === 'automating' && (
          <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
            <div className="h-px w-full bg-gray-200 mb-3"></div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="relative w-12 h-3">
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce absolute left-0"></div>
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce delay-75 absolute left-4"></div>
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce delay-150 absolute left-8"></div>
                </div>
                <div className="flex flex-col">
                   <span className="font-bold text-gray-900 text-sm">
                    {automationStatus?.status || "Starting automation..."}
                   </span>
                   {automationStatus?.details && (
                     <span className="text-xs text-gray-500">{automationStatus.details}</span>
                   )}
                </div>
              </div>
              
              {automationStatus?.totalSteps ? (
                <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1 overflow-hidden">
                  <div 
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${((automationStatus.step || 0) / automationStatus.totalSteps) * 100}%` }}
                  ></div>
                </div>
              ) : null}
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
        {(view === "response" || geminiResponse) && (
          <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
            <div className="h-px w-full bg-gray-200 mb-3"></div>
            <p className="text-sm text-gray-700 leading-relaxed">
              {geminiResponse || transcript ||
                "Yes of course! Your Session has started. I will record the transcript... Just let me know when you want to end it."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);
  root.render(<OverlayApp />);
}

