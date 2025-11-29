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
  // Status changes
  statusChange: (status: WakeWordStatus) => void;

  // Wake word detected with optional command
  wakeDetected: (data: { transcript: string; confidence: number }) => void;

  // Command captured after wake word
  commandCaptured: (data: { command: string; fullTranscript: string }) => void;

  // Real-time transcript updates
  transcript: (data: { text: string; isFinal: boolean }) => void;

  // Errors
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
  private commandBuffer = "";
  private wakeDetectedAt = 0;
  private lastSpeechAt = 0;
  private commandTimeout: NodeJS.Timeout | null = null;
  private silenceCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<WakeWordServiceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
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

  /**
   * Set up event handlers for all components
   */
  private setupEventHandlers(): void {
    // Audio capture events
    this.audioCapture.on("data", (chunk: Buffer) => {
      // Process through VAD
      this.vad.process(chunk);
    });

    this.audioCapture.on("error", (error: Error) => {
      console.error("WakeWordService: Audio capture error:", error);
      this.emit("error", error);
      this.setStatus("error");
    });

    // VAD events
    this.vad.on("speechStart", () => {
      console.log("WakeWordService: Speech started");
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
      console.log("WakeWordService: Speech ended");

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
      console.error("WakeWordService: Google Speech error:", error);
      // Try to recover by restarting the stream
      if (this.isRunning) {
        setTimeout(() => {
          if (this.isRunning) {
            this.googleSpeech.startStream();
          }
        }, 1000);
      }
    });
  }

  /**
   * Handle transcript from Google Speech
   */
  private handleTranscript(data: {
    text: string;
    confidence: number;
    isFinal: boolean;
  }): void {
    this.currentTranscript = data.text;

    console.log(
      `[WakeWordService] Transcript received: "${data.text}" (status: ${this.status})`
    );

    // Emit transcript for UI updates
    this.emit("transcript", {
      text: data.text,
      isFinal: data.isFinal,
    });

    if (this.status === "listening") {
      // Check for wake word
      const match = this.wakeWordMatcher.match(data.text);
      console.log(`[WakeWordService] Wake word match result:`, match);

      if (match.matched) {
        console.log(
          `[WakeWordService] 🎉 WAKE WORD DETECTED! "${match.matchedPhrase}" (confidence: ${match.confidence})`
        );

        this.setStatus("wake_detected");
        this.wakeDetectedAt = Date.now();
        this.commandBuffer = match.remainingText;

        this.emit("wakeDetected", {
          transcript: data.text,
          confidence: match.confidence,
        });

        // Start command timeout
        this.startCommandTimeout();

        // If there's already text after the wake word and it's final, capture it
        if (data.isFinal && match.remainingText.trim()) {
          this.captureCommand(match.remainingText);
        }
      }
    } else if (this.status === "wake_detected") {
      // Capture command after wake word
      const match = this.wakeWordMatcher.match(this.currentTranscript);
      this.commandBuffer = match.remainingText || data.text;

      // Reset silence check on new speech
      this.lastSpeechAt = Date.now();

      if (data.isFinal && this.commandBuffer.trim()) {
        // Got a final result with command text
        this.captureCommand(this.commandBuffer);
      }
    }
  }

  /**
   * Start timeout for command capture
   */
  private startCommandTimeout(): void {
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }

    this.commandTimeout = setTimeout(() => {
      if (this.status === "wake_detected") {
        console.log("WakeWordService: Command timeout reached");
        if (this.commandBuffer.trim()) {
          this.captureCommand(this.commandBuffer);
        } else {
          // No command captured, reset to listening
          this.resetToListening();
        }
      }
    }, this.config.commandTimeout);

    // Also start checking for silence
    this.startSilenceCheck();
  }

  /**
   * Start checking for silence to end command capture
   */
  private startSilenceCheck(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.silenceCheckInterval = setInterval(() => {
      this.checkSilenceTimeout();
    }, 100);
  }

  /**
   * Check if silence timeout has been reached
   */
  private checkSilenceTimeout(): void {
    if (this.status !== "wake_detected") {
      return;
    }

    const silenceDuration = Date.now() - this.lastSpeechAt;

    if (silenceDuration >= this.config.silenceTimeout) {
      console.log("WakeWordService: Silence timeout reached");

      if (this.commandBuffer.trim()) {
        this.captureCommand(this.commandBuffer);
      } else {
        this.resetToListening();
      }
    }
  }

  /**
   * Capture the command and emit event
   */
  private captureCommand(command: string): void {
    console.log(`WakeWordService: Command captured: "${command}"`);

    // Clear timeouts
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    this.setStatus("processing");

    this.emit("commandCaptured", {
      command: command.trim(),
      fullTranscript: this.currentTranscript,
    });

    // Reset for next wake word
    setTimeout(() => {
      this.resetToListening();
    }, 500);
  }

  /**
   * Reset to listening state
   */
  private resetToListening(): void {
    this.commandBuffer = "";
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

    if (this.isRunning) {
      this.setStatus("idle");
    }
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: WakeWordStatus): void {
    if (this.status !== status) {
      console.log(`[WakeWordService] Status: ${this.status} → ${status}`);
      this.status = status;
      this.emit("statusChange", status);
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    console.log("[WakeWordService] ========================================");
    console.log("[WakeWordService] Initializing Wake Word Detection System");
    console.log("[WakeWordService] ========================================");

    // Check if SoX is installed
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

    // Initialize Google Speech
    console.log("[WakeWordService] Initializing Google Speech...");
    await this.googleSpeech.initialize();

    console.log("[WakeWordService] ✓ Initialization complete!");
    console.log(
      "[WakeWordService] Wake words:",
      this.config.wakeWords.join(", ")
    );
  }

  /**
   * Start listening for wake word
   */
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

    // Start audio capture
    console.log("[WakeWordService] Starting audio capture...");
    this.audioCapture.start();
  }

  /**
   * Stop listening
   */
  stop(): void {
    console.log("WakeWordService: Stopping...");
    this.isRunning = false;

    // Clear timeouts
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    // Stop all components
    this.audioCapture.stop();
    this.googleSpeech.stopStream();
    this.vad.reset();

    this.setStatus("idle");
    this.commandBuffer = "";
    this.currentTranscript = "";
  }

  /**
   * Get current status
   */
  getStatus(): WakeWordStatus {
    return this.status;
  }

  /**
   * Check if running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.stop();
    await this.googleSpeech.destroy();
  }
}

// Singleton instance for the main process
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
