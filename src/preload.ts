import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  resizeWindow: (width: number, height: number) => ipcRenderer.send('resize-window', width, height),
  sendTranscript: (text: string) => ipcRenderer.send('transcript-update', text),
  onTranscriptUpdate: (callback: (text: string) => void) => ipcRenderer.on('transcript-update', (_event, text) => callback(text)),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
});
