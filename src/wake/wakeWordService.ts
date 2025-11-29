/**
 * Wake Word Service
 * Main orchestrator that combines audio capture, VAD, Google Speech, and wake word matching
 */

import { EventEmitter } from "events";
import { AudioCapture, checkSoxInstalled } from "./audioCapture";
import { VAD } from "./vad";
import { GoogleSpeechService } from "./googleSpeech";
import { WakeWordMatcher } from "./wakeWordMatcher";
import { WakeWordStatus, WakeWordServiceConfig, DEFAULT_CONFIG } from "./types";

export interface WakeWordServiceEvents {
  statusChange: (status: WakeWordStatus) => void;
  wakeDetected: (data: { transcript: string; confidence: number }) => void;
  commandCaptured: (data: { command: string; fullTranscript: string }) => void;
  transcript: (data: { text: string; isFinal: boolean }) => void;
  error: (error: Error) => void;
}

export class WakeWordService extends EventEmitter {
  private config: WakeWordServiceConfig;
  private audioCapture: AudioCapture;
  private vad: VAD;
  private googleSpeech: GoogleSpeechService;
  private wakeWordMatcher: WakeWordMatcher;

  private status: WakeWordStatus = "idle";
  private isRunning = false;
  private currentTranscript = "";
  private commandTranscript = ""; // Separate transcript for command capture
  private wakeDetectedAt = 0;
  private lastSpeechAt = 0;
  private commandTimeout: NodeJS.Timeout | null = null;
  private silenceCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<WakeWordServiceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.audioCapture = new AudioCapture(this.config.sampleRateHertz, 1);
    this.vad = new VAD({ sampleRate: this.config.sampleRateHertz });
    this.googleSpeech = new GoogleSpeechService({
      languageCode: this.config.languageCode,
      sampleRateHertz: this.config.sampleRateHertz,
    });
    this.wakeWordMatcher = new WakeWordMatcher(
      this.config.wakeWords,
      this.config.wakeWordThreshold
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Audio capture → VAD
    this.audioCapture.on("data", (chunk: Buffer) => {
      this.vad.process(chunk);
    });

    this.audioCapture.on("error", (error: Error) => {
      console.error("[WakeWordService] Audio capture error:", error);
      this.emit("error", error);
      this.setStatus("error");
    });

    // VAD events
    this.vad.on("speechStart", () => {
      console.log("[WakeWordService] 🎤 Speech started");
      this.lastSpeechAt = Date.now();

      // Start streaming to Google when speech is detected
      if (!this.googleSpeech.streaming) {
        this.googleSpeech.startStream();
      }

      if (this.status === "idle") {
        this.setStatus("listening");
      }
    });

    this.vad.on("speech", (chunk: Buffer) => {
      // Forward speech audio to Google
      this.googleSpeech.write(chunk);
      this.lastSpeechAt = Date.now();
    });

    this.vad.on("speechEnd", () => {
      console.log("[WakeWordService] 🔇 Speech ended");

      // When speech ends in idle/listening state, stop the stream to get fresh results next time
      if (this.status === "idle" || this.status === "listening") {
        // Give Google a moment to send final results, then stop stream
        setTimeout(() => {
          if (this.status === "idle" || this.status === "listening") {
            this.googleSpeech.stopStream();
            this.currentTranscript = "";
          }
        }, 500);
      }

      // Check if we should end command capture
      if (this.status === "wake_detected") {
        this.checkSilenceTimeout();
      }
    });

    // Google Speech events
    this.googleSpeech.on(
      "transcript",
      (data: { text: string; confidence: number; isFinal: boolean }) => {
        this.handleTranscript(data);
      }
    );

    this.googleSpeech.on("error", (error: Error) => {
      console.error("[WakeWordService] Google Speech error:", error);
      // Try to recover
      if (this.isRunning && this.status !== "error") {
        setTimeout(() => {
          if (this.isRunning) {
            this.googleSpeech.stopStream();
          }
        }, 1000);
      }
    });
  }

  private handleTranscript(data: {
    text: string;
    confidence: number;
    isFinal: boolean;
  }): void {
    const text = data.text.trim();
    if (!text) return;

    console.log(
      `[WakeWordService] 📝 "${text}" (status: ${this.status}, final: ${data.isFinal})`
    );

    // Emit transcript for UI
    this.emit("transcript", { text, isFinal: data.isFinal });

    if (this.status === "listening") {
      this.currentTranscript = text;

      // Check for wake word
      const match = this.wakeWordMatcher.match(text);

      if (match.matched) {
        console.log(
          `[WakeWordService] 🎉 WAKE WORD DETECTED! "${match.matchedPhrase}"`
        );

        // Stop current stream and start fresh for command capture
        this.googleSpeech.stopStream();

        this.setStatus("wake_detected");
        this.wakeDetectedAt = Date.now();
        this.commandTranscript = "";

        this.emit("wakeDetected", {
          transcript: text,
          confidence: match.confidence,
        });

        // Start fresh stream for command capture
        setTimeout(() => {
          if (this.status === "wake_detected" && this.isRunning) {
            console.log(
              "[WakeWordService] Starting fresh stream for command capture..."
            );
            this.googleSpeech.startStream();
          }
        }, 100);

        // Start command timeout
        this.startCommandTimeout();
      }
    } else if (this.status === "wake_detected") {
      // Capture command - this is a fresh transcript after wake word
      this.commandTranscript = text;
      this.lastSpeechAt = Date.now();

      // If we got a final result with actual content, capture the command
      if (data.isFinal && text.length > 0) {
        this.captureCommand(text);
      }
    }
  }

  private startCommandTimeout(): void {
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }

    this.commandTimeout = setTimeout(() => {
      if (this.status === "wake_detected") {
        console.log("[WakeWordService] ⏰ Command timeout reached");
        if (this.commandTranscript.trim()) {
          this.captureCommand(this.commandTranscript);
        } else {
          // No command captured, reset
          console.log("[WakeWordService] No command captured, resetting...");
          this.resetToListening();
        }
      }
    }, this.config.commandTimeout);

    this.startSilenceCheck();
  }

  private startSilenceCheck(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.silenceCheckInterval = setInterval(() => {
      this.checkSilenceTimeout();
    }, 200);
  }

  private checkSilenceTimeout(): void {
    if (this.status !== "wake_detected") {
      return;
    }

    const silenceDuration = Date.now() - this.lastSpeechAt;

    if (silenceDuration >= this.config.silenceTimeout) {
      console.log("[WakeWordService] 🔇 Silence timeout - capturing command");

      if (this.commandTranscript.trim()) {
        this.captureCommand(this.commandTranscript);
      } else {
        this.resetToListening();
      }
    }
  }

  private captureCommand(command: string): void {
    const cleanCommand = command.trim();
    console.log(`[WakeWordService] ✅ Command captured: "${cleanCommand}"`);

    // Clear timeouts
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    // Stop the stream
    this.googleSpeech.stopStream();

    this.setStatus("processing");

    this.emit("commandCaptured", {
      command: cleanCommand,
      fullTranscript: cleanCommand,
    });

    // Reset for next wake word after a short delay
    setTimeout(() => {
      this.resetToListening();
    }, 500);
  }

  private resetToListening(): void {
    console.log("[WakeWordService] 🔄 Resetting to idle state");

    this.commandTranscript = "";
    this.currentTranscript = "";
    this.wakeDetectedAt = 0;

    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    // Stop any running stream
    this.googleSpeech.stopStream();

    if (this.isRunning) {
      this.setStatus("idle");
    }
  }

  private setStatus(status: WakeWordStatus): void {
    if (this.status !== status) {
      console.log(`[WakeWordService] Status: ${this.status} → ${status}`);
      this.status = status;
      this.emit("statusChange", status);
    }
  }

  async initialize(): Promise<void> {
    console.log("[WakeWordService] ========================================");
    console.log("[WakeWordService] Initializing Wake Word Detection System");
    console.log("[WakeWordService] ========================================");

    console.log("[WakeWordService] Checking for SoX installation...");
    const hasSox = await checkSoxInstalled();
    if (!hasSox) {
      console.error("[WakeWordService] ✗ SoX not found!");
      throw new Error(
        "SoX is not installed. Please install it:\n" +
          "  macOS: brew install sox\n" +
          "  Ubuntu: sudo apt-get install sox\n" +
          "  Windows: Download from https://sox.sourceforge.net/"
      );
    }
    console.log("[WakeWordService] ✓ SoX is installed");

    console.log("[WakeWordService] Initializing Google Speech...");
    await this.googleSpeech.initialize();

    console.log("[WakeWordService] ✓ Initialization complete!");
    console.log(
      "[WakeWordService] Wake words:",
      this.config.wakeWords.join(", ")
    );
  }

  start(): void {
    if (this.isRunning) {
      console.warn("[WakeWordService] Already running");
      return;
    }

    console.log("[WakeWordService] ========================================");
    console.log("[WakeWordService] Starting wake word detection");
    console.log("[WakeWordService] ========================================");

    this.isRunning = true;
    this.setStatus("idle");

    console.log("[WakeWordService] Starting audio capture...");
    this.audioCapture.start();
  }

  stop(): void {
    console.log("[WakeWordService] Stopping...");
    this.isRunning = false;

    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    this.audioCapture.stop();
    this.googleSpeech.stopStream();
    this.vad.reset();

    this.setStatus("idle");
    this.commandTranscript = "";
    this.currentTranscript = "";
  }

  getStatus(): WakeWordStatus {
    return this.status;
  }

  get running(): boolean {
    return this.isRunning;
  }

  async destroy(): Promise<void> {
    this.stop();
    await this.googleSpeech.destroy();
  }
}

// Singleton instance
let instance: WakeWordService | null = null;

export function getWakeWordService(): WakeWordService {
  if (!instance) {
    instance = new WakeWordService();
  }
  return instance;
}

export function destroyWakeWordService(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
