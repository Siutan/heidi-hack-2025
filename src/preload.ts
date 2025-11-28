import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  resizeWindow: (width: number, height: number) => ipcRenderer.send('resize-window', width, height),
  fillTemplate: (conversation?: string, sourceId?: string) => ipcRenderer.invoke('rpa:fill-template', conversation, sourceId),
  getSources: () => ipcRenderer.invoke('get-sources'),
});
