export { };

declare global {
  interface Window {
    electron: {
      resizeWindow: (width: number, height: number) => void;
    };
  }
}
