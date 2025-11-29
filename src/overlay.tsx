import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GripVertical, ChevronDown } from "lucide-react";
import "./overlay.css";

type ViewState = "idle" | "expanded" | "recording" | "response";

const OverlayApp = () => {
    const [view, setView] = useState<ViewState>("idle");
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState("");
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const phrases = [
        "record a session",
        "lets fill out a file",
        "Who is next",
        "catch me up on the next patient",
    ];
    const [activePhraseIndex, setActivePhraseIndex] = useState(0);
    const [isPhraseVisible, setIsPhraseVisible] = useState(true);
    const phraseIntervalRef = useRef<number | null>(null);
    const phraseTimeoutRef = useRef<number | null>(null);

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
            setError("");
            setTranscript("");

            console.log("Requesting microphone access...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("Microphone access granted");

            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                console.log("Audio data available:", event.data.size, "bytes");
                audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                // MediaRecorder typically outputs webm/ogg, not wav
                const mimeType = mediaRecorder.mimeType || "audio/webm";
                const audioBlob = new Blob(audioChunksRef.current, {
                    type: mimeType,
                });
                console.log(
                    "Recording finished",
                    audioBlob.size,
                    "bytes, MIME:",
                    mimeType
                );
                setView("response");

                if (audioBlob.size === 0) {
                    setError("No audio data recorded");
                    setTranscript("Error: No audio data recorded");
                    return;
                }

                try {
                    // Convert blob to base64
                    const reader = new FileReader();
                    const base64Audio = await new Promise<string>((resolve, reject) => {
                        reader.onloadend = () => {
                            const base64 = (reader.result as string).split(",")[1];
                            resolve(base64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(audioBlob);
                    });

                    console.log(
                        "Sending audio for transcription...",
                        base64Audio.length,
                        "chars"
                    );
                    // Transcribe audio
                    if (window.electron) {
                        const result = await window.electron.transcribeAudio(base64Audio);
                        console.log("Transcription result:", result);

                        if (result.success) {
                            setTranscript(result.transcript);
                            console.log("Transcript:", result.transcript);

                            // Execute the voice command
                            const cmdResult = await window.electron.executeVoiceCommand(
                                result.transcript
                            );
                            console.log("Command result:", cmdResult);
                        } else {
                            console.error("Transcription failed:", result.error);
                            setError(result.error || "Transcription failed");
                            setTranscript(
                                "Error: " + (result.error || "Transcription failed")
                            );
                        }
                    }
                } catch (error) {
                    console.error("Error transcribing audio:", error);
                    setError(String(error));
                    setTranscript("Error: " + String(error));
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            setView("recording");
            console.log("Recording started");

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
        if (recordingTimeoutRef.current) {
            clearTimeout(recordingTimeoutRef.current);
            recordingTimeoutRef.current = null;
        }

        if (mediaRecorderRef.current && isRecording) {
            console.log("Stopping recording...");
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            // Stop all tracks
            mediaRecorderRef.current.stream
                .getTracks()
                .forEach((track) => track.stop());
        }
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

    useEffect(() => {
        const DISPLAY_MS = 3000;
        const TRANSITION_MS = 500;
        phraseIntervalRef.current = window.setInterval(() => {
            setIsPhraseVisible(false);
            phraseTimeoutRef.current = window.setTimeout(() => {
                setActivePhraseIndex((prev) => (prev + 1) % phrases.length);
                setIsPhraseVisible(true);
            }, TRANSITION_MS);
        }, DISPLAY_MS);
        return () => {
            if (phraseIntervalRef.current)
                window.clearInterval(phraseIntervalRef.current);
            if (phraseTimeoutRef.current)
                window.clearTimeout(phraseTimeoutRef.current);
        };
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
                            <img src="assets/logo.svg" alt="Heidi Logo" className="w-8 h-8" />
                        </div>

                        <div
                            className="flex flex-col  w-[300px] cursor-pointer"
                            onClick={toggleShortcuts}
                        >
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-lg text-gray-900 shrink-0">
                                    “Hi Dee...”
                                </span>
                                <span
                                    className={`text-gray-400 text-md shrink-0 transition-all duration-500 ease-in-out ${isPhraseVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
                                >
                                    {phrases[activePhraseIndex]}
                                </span>
                            </div>
                            <div className="flex items-end gap-1">
                                <span className="text-xs text-gray-500">
                                    Run Heidi shortcuts using your voice
                                </span>
                                <div
                                    className={`transition-transform duration-300 ${view === "expanded" ? "rotate-180" : ""}`}
                                >
                                    <ChevronDown className="w-3 h-3 text-gray-400" />
                                </div>
                            </div>
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
                {view === "expanded" && (
                    <div className="px-2 pb-2 pt-0 animate-in slide-in-from-top-2 duration-200 bg-gray-50/50">
                        <div className="h-px w-full bg-gray-200 mb-2"></div>
                        <div className="space-y-1">
                            {[
                                "Record a session",
                                "Update a medical record",
                                "Get previous session notes",
                            ].map((shortcut) => (
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
                                        console.log("App check result:", result);
                                        if (result) {
                                            console.log("Starting EHR navigation automation...");
                                            const automationResult =
                                                await window.electron.automateEhrNavigation();
                                            console.log("Automation result:", automationResult);
                                        }
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

                {/* Response Content */}
                {view === "response" && (
                    <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
                        <div className="h-px w-full bg-gray-200 mb-3"></div>
                        {error ? (
                            <div>
                                <p className="text-xs text-red-500 mb-2">Error:</p>
                                <p className="text-sm text-red-600 leading-relaxed">{error}</p>
                                <button
                                    onClick={() => setView("idle")}
                                    className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                                >
                                    ← Back
                                </button>
                            </div>
                        ) : transcript ? (
                            <div>
                                <p className="text-xs text-gray-500 mb-2">Transcript:</p>
                                <p className="text-sm text-gray-700 leading-relaxed">
                                    "{transcript}"
                                </p>
                                <p className="text-xs text-green-600 mt-2">
                                    ✓ Command executed
                                </p>
                                <button
                                    onClick={() => setView("idle")}
                                    className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                                >
                                    ← Back
                                </button>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-700 leading-relaxed">
                                Processing your recording...
                            </p>
                        )}
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
