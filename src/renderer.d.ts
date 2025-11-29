export interface IElectronAPI {
  resizeWindow: (width: number, height: number) => void;
  fillTemplate: (conversation?: string, sourceId?: string) => Promise<void>;
  getSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>;
  onAutomationUpdate: (callback: (event: any, data: { status: string; step?: number; totalSteps?: number; details?: string }) => void) => void;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
