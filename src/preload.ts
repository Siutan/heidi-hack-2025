import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.send("resize-window", width, height),
  checkAndOpenApp: () => ipcRenderer.invoke("check-and-open-app"),
  executeVoiceCommand: (command: string) =>
    ipcRenderer.invoke("execute-voice-command", command),
  automateEhrNavigation: () => ipcRenderer.invoke("automate-ehr-navigation"),
  transcribeAudio: (base64Audio: string) =>
    ipcRenderer.invoke("transcribe-audio", base64Audio),
});
