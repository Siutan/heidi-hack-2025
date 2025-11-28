export {};

declare global {
  interface Window {
    electron: {
      resizeWindow: (width: number, height: number) => void;
      checkAndOpenApp: () => Promise<boolean>;
      executeVoiceCommand: (command: string) => Promise<{
        success: boolean;
        message: string;
        actions?: string[];
      }>;
      transcribeAudio: (base64Audio: string) => Promise<{
        success: boolean;
        transcript: string;
        error?: string;
      }>;
    };
  }
}
