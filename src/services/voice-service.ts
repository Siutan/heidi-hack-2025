/**
 * VoiceCommand - Handles speech recognition and sends commands to main process
 *
 * This component uses the Web Speech API to capture voice input,
 * convert it to text, and send it to the main process for automation.
 */

export class VoiceCommand {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isListening = false;
  private onTranscriptCallback?: (transcript: string) => void;
  private onStatusChangeCallback?: (status: string) => void;
  private onErrorCallback?: (error: string) => void;

  constructor() {
    // MediaRecorder will be initialized when starting recording
  }

  private getErrorMessage(error: string): string {
    const errorMessages: { [key: string]: string } = {
      "no-speech": "No speech detected. Please try again.",
      "audio-capture": "Microphone not found or not accessible.",
      "not-allowed": "Microphone permission denied.",
      network: "Network error occurred.",
      aborted: "Speech recognition aborted.",
    };
    return errorMessages[error] || `Unknown error: ${error}`;
  }

  private updateStatus(status: string) {
    console.log("Status:", status);
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status);
    }
  }

  private async transcribeAudio(audioBlob: Blob): Promise<string> {
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

    // Send to backend for transcription via Electron IPC
    const result = await window.electron.transcribeAudio(base64Audio);
    return result.transcript;
  }

  private async sendCommandToMainProcess(command: string) {
    try {
      this.updateStatus("Processing command...");

      // Send to main process via IPC
      const result = await window.electron.executeVoiceCommand(command);

      console.log("Command result:", result);
      this.updateStatus(`✓ ${result.message}`);
    } catch (error) {
      console.error("Error executing command:", error);
      this.updateStatus(
        `✗ Failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if (this.onErrorCallback) {
        this.onErrorCallback(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Start listening for voice commands
   */
  public async start() {
    if (this.isListening) {
      console.log("Already listening");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder = mediaRecorder;
      this.audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
        console.log("Recording finished", audioBlob);

        try {
          // Transcribe the audio
          const transcript = await this.transcribeAudio(audioBlob);
          console.log("Transcript:", transcript);

          if (this.onTranscriptCallback) {
            this.onTranscriptCallback(transcript);
          }

          // Send to main process for automation
          this.sendCommandToMainProcess(transcript);

          this.updateStatus("Ready");
        } catch (error) {
          console.error("Error transcribing audio:", error);
          this.updateStatus(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          );

          if (this.onErrorCallback) {
            this.onErrorCallback(
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      };

      mediaRecorder.start();
      this.isListening = true;
      this.updateStatus("Listening...");

      // Simulate recording duration for demo purposes
      setTimeout(() => {
        this.stop();
      }, 3000);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      this.updateStatus("Error starting microphone");

      if (this.onErrorCallback) {
        this.onErrorCallback(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Stop listening for voice commands
   */
  public stop() {
    if (!this.isListening || !this.mediaRecorder) {
      return;
    }

    this.mediaRecorder.stop();
    this.isListening = false;

    // Stop all tracks
    this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }

  /**
   * Set callback for when transcript is received
   */
  public onTranscript(callback: (transcript: string) => void) {
    this.onTranscriptCallback = callback;
  }

  /**
   * Set callback for status changes
   */
  public onStatusChange(callback: (status: string) => void) {
    this.onStatusChangeCallback = callback;
  }

  /**
   * Set callback for errors
   */
  public onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }

  /**
   * Check if currently listening
   */
  public getIsListening(): boolean {
    return this.isListening;
  }
}
