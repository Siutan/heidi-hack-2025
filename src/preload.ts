import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  // Window management
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.send("resize-window", width, height),

  // Legacy transcript (can be removed later)
  sendTranscript: (text: string) => ipcRenderer.send("transcript-update", text),
  onTranscriptUpdate: (callback: (text: string) => void) =>
    ipcRenderer.on("transcript-update", (_event, text) => callback(text)),

  // App management
  checkAndOpenApp: () => ipcRenderer.invoke("check-and-open-app"),

  // Permissions
  requestMicPermission: () => ipcRenderer.invoke("request-mic-permission"),

  // Wake word service controls
  wakeWord: {
    // Start listening for wake word
    start: () => ipcRenderer.invoke("wake-word-start"),
    // Stop listening
    stop: () => ipcRenderer.invoke("wake-word-stop"),
    // Get current status
    getStatus: () => ipcRenderer.invoke("wake-word-status"),

    // Event listeners
    onStatusChange: (callback: (status: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: string) =>
        callback(status);
      ipcRenderer.on("wake-word-status-change", listener);
      return () =>
        ipcRenderer.removeListener("wake-word-status-change", listener);
    },

    onWakeDetected: (
      callback: (data: { transcript: string; confidence: number }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { transcript: string; confidence: number }
      ) => callback(data);
      ipcRenderer.on("wake-word-detected", listener);
      return () => ipcRenderer.removeListener("wake-word-detected", listener);
    },

    onTranscript: (
      callback: (data: { text: string; isFinal: boolean }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { text: string; isFinal: boolean }
      ) => callback(data);
      ipcRenderer.on("wake-word-transcript", listener);
      return () => ipcRenderer.removeListener("wake-word-transcript", listener);
    },

    onGeminiResponse: (callback: (data: { text: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { text: string }
      ) => callback(data);
      ipcRenderer.on("gemini-response", listener);
      return () => ipcRenderer.removeListener("gemini-response", listener);
    },

    onGeminiAudio: (callback: (data: { audio: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { audio: string }
      ) => callback(data);
      ipcRenderer.on("gemini-audio", listener);
      return () => ipcRenderer.removeListener("gemini-audio", listener);
    },

    onError: (callback: (error: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, error: string) =>
        callback(error);
      ipcRenderer.on("wake-word-error", listener);
      return () => ipcRenderer.removeListener("wake-word-error", listener);
    },
  },
  fillTemplate: (conversation?: string, sourceId?: string) =>
    ipcRenderer.invoke("rpa:fill-template", conversation, sourceId),
  getSources: () => ipcRenderer.invoke("get-sources"),
  onAutomationUpdate: (callback: (event: any, data: any) => void) =>
    ipcRenderer.on("automation-update", callback),

  // Start Heidi transcription (opens browser and clicks transcribe button)
  startHeidiTranscription: () =>
    ipcRenderer.invoke("start-heidi-transcription"),
  onPromptSelectSource: (callback: (data: { conversation: string; sourceId?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('rpa:prompt-select-source', listener);
    return () => ipcRenderer.removeListener('rpa:prompt-select-source', listener);
  },

  // Tool call listener
  onToolCall: (
    callback: (data: { name: string; args: Record<string, unknown> }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { name: string; args: Record<string, unknown> }
    ) => callback(data);
    ipcRenderer.on("tool-call", listener);
    return () => ipcRenderer.removeListener("tool-call", listener);
  },
});
