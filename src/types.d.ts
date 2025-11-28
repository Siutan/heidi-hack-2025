export { };

declare global {
  interface Window {
    electron: {
      resizeWindow: (width: number, height: number) => void;
      fillTemplate: (conversation?: string, sourceId?: string) => Promise<void>;
      getSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>;
      onAutomationUpdate: (callback: (event: any, data: any) => void) => void;
    };
  }
}
