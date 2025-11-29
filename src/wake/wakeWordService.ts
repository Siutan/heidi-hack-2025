/**
 * Wake Word Service
 * Simplified service that ONLY detects the wake word "Hi Dee"
 * After detection, it hands off to Gemini Live for the actual conversation
 */

import { EventEmitter } from "events";
import { AudioCapture, checkSoxInstalled } from "./audioCapture";
import { VAD } from "./vad";
import { GoogleSpeechService } from "./googleSpeech";
import { WakeWordMatcher } from "./wakeWordMatcher";
import { GeminiLiveService, getGeminiLiveService } from "./geminiLive";
import { WakeWordStatus, WakeWordServiceConfig, DEFAULT_CONFIG } from "./types";

export interface WakeWordServiceEvents {
  statusChange: (status: WakeWordStatus) => void;
  wakeDetected: (data: { transcript: string; confidence: number }) => void;
  transcript: (data: { text: string; isFinal: boolean }) => void;
  geminiResponse: (data: { text: string }) => void;
  geminiAudio: (data: { audio: Buffer }) => void;
  error: (error: Error) => void;
}

export class WakeWordService extends EventEmitter {
  private config: WakeWordServiceConfig;
  private audioCapture: AudioCapture;
  private vad: VAD;
  private googleSpeech: GoogleSpeechService;
  private wakeWordMatcher: WakeWordMatcher;
  private geminiLive: GeminiLiveService;

  private status: WakeWordStatus = "idle";
  private isRunning = false;
  private currentTranscript = "";
  private speechBuffer: Buffer[] = [];
  private speechStartTime = 0;
  private maxSpeechDuration = 3000; // Only buffer 3 seconds max for wake word detection
  private silenceTimer: NodeJS.Timeout | null = null;
  private commandWindowTimer: NodeJS.Timeout | null = null;
  private processingTimer: NodeJS.Timeout | null = null;
  private commandWindowDuration = 5000; // 5 second window to start speaking
  private processingTimeoutDuration = 6000; // 6 seconds to wait for Gemini response

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
    this.geminiLive = getGeminiLiveService();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Audio capture → VAD + Gemini (when in command window)
    this.audioCapture.on("data", (chunk: Buffer) => {
      this.vad.process(chunk);

      // Send to Gemini during command window AND processing (continuous streaming)
      if ((this.status === "command_window" || this.status === "processing") && this.geminiLive.connected) {
        this.geminiLive.sendAudio(chunk);
      }
    });

    this.audioCapture.on("error", (error: Error) => {
      console.error("[WakeWordService] Audio capture error:", error);
      this.emit("error", error);
      this.setStatus("error");
    });

    // VAD events - only used for wake word detection
    this.vad.on("speechStart", () => {
      if (this.status === "idle") {
        console.log("[WakeWordService] 🎤 Speech started - checking for wake word");
        this.speechBuffer = [];
        this.speechStartTime = Date.now();
        this.setStatus("listening");

        // Start Google Speech stream for wake word detection
        if (!this.googleSpeech.streaming) {
          this.googleSpeech.startStream();
        }
      } else if (this.status === "command_window" || this.status === "processing") {
        console.log("[WakeWordService] 🎤 Command speech started/resumed");

        // If we were "thinking", go back to "listening" because user resumed speaking
        if (this.status === "processing") {
          this.setStatus("command_window");
        }

        // Clear any timeouts since user is speaking
        if (this.commandWindowTimer) {
          clearTimeout(this.commandWindowTimer);
          this.commandWindowTimer = null;
        }
        if (this.processingTimer) {
          clearTimeout(this.processingTimer);
          this.processingTimer = null;
        }
      }
    });

    this.vad.on("speech", (chunk: Buffer) => {
      if (this.status === "listening") {
        // Buffer speech for wake word detection
        this.speechBuffer.push(chunk);
        this.googleSpeech.write(chunk);

        // Reset silence timer
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
        }

        // Check if we've been speaking too long without wake word
        const duration = Date.now() - this.speechStartTime;
        if (duration > this.maxSpeechDuration) {
          console.log("[WakeWordService] ⏰ Max speech duration reached without wake word");
          this.resetToIdle();
        }
      }
    });

    this.vad.on("speechEnd", () => {
      if (this.status === "listening") {
        console.log("[WakeWordService] 🔇 Speech ended");

        // Wait a bit for final transcript, then reset if no wake word
        this.silenceTimer = setTimeout(() => {
          if (this.status === "listening") {
            console.log("[WakeWordService] No wake word detected, resetting...");
            this.resetToIdle();
          }
        }, 1500);
      } else if (this.status === "command_window") {
        console.log("[WakeWordService] 🔇 Command speech ended - waiting for response (but keeping stream open)");

        // Switch to processing state for UI feedback ("Thinking...")
        // But we continue streaming audio in case user resumes
        this.setStatus("processing");

        // Start processing timer - wait for Gemini response
        // If user speaks again, this will be cleared in speechStart
        if (this.processingTimer) {
          clearTimeout(this.processingTimer);
        }

        this.processingTimer = setTimeout(() => {
          console.log("[WakeWordService] ⏰ Processing timeout - no response from Gemini");
          if (this.status === "processing") {
            this.resetToIdle();
          }
        }, this.processingTimeoutDuration);
      }
    });

    // Google Speech events - only for wake word detection
    this.googleSpeech.on(
      "transcript",
      (data: { text: string; confidence: number; isFinal: boolean }) => {
        if (this.status !== "listening") return;

        const text = data.text.trim();
        if (!text) return;

        console.log(`[WakeWordService] 📝 "${text}" (final: ${data.isFinal})`);
        this.currentTranscript = text;
        this.emit("transcript", { text, isFinal: data.isFinal });

        // Check for wake word
        const match = this.wakeWordMatcher.match(text);
        if (match.matched) {
          console.log(`[WakeWordService] 🎉 WAKE WORD DETECTED! "${match.matchedPhrase}"`);
          this.handleWakeWordDetected(text, match.confidence);
        }
      }
    );

    this.googleSpeech.on("error", (error: Error) => {
      console.error("[WakeWordService] Google Speech error:", error);
    });

    // Gemini Live events
    this.geminiLive.on("textResponse", (text: string) => {
      console.log(`[WakeWordService] 🤖 Gemini: "${text}"`);

      // Clear processing timer as we got a response
      if (this.processingTimer) {
        clearTimeout(this.processingTimer);
        this.processingTimer = null;
      }

      this.emit("geminiResponse", { text });
    });

    this.geminiLive.on("audioResponse", (audio: Buffer) => {
      console.log(`[WakeWordService] 🔊 Received audio response (${audio.length} bytes)`);
      this.emit("geminiAudio", { audio });
    });

    // Handle tool calls from Gemini
    this.geminiLive.on("toolCall", (toolCall: any) => {
      console.log(`[WakeWordService] 🔧 Tool called: ${toolCall.name}`);
      this.handleToolCall(toolCall);
    });

    this.geminiLive.on("turnComplete", () => {
      console.log("[WakeWordService] ✓ Gemini turn complete");
      // After Gemini responds, go back to listening for wake word
      this.resetToIdle();
    });

    this.geminiLive.on("error", (error: Error) => {
      console.error("[WakeWordService] Gemini error:", error);
      this.resetToIdle();
    });

    this.geminiLive.on("disconnected", () => {
      console.log("[WakeWordService] Gemini disconnected");
      if (this.status === "command_window" || this.status === "wake_detected") {
        this.resetToIdle();
      }
    });
  }

  private async handleWakeWordDetected(
    transcript: string,
    confidence: number
  ): Promise<void> {
    // CRITICAL: Stop Google Speech immediately - we're done with it
    console.log("[WakeWordService] 🛑 Stopping Google STT");
    this.googleSpeech.stopStream();

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    this.setStatus("wake_detected");
    this.emit("wakeDetected", { transcript, confidence });

    // Start Gemini Live session for command processing
    try {
      console.log("[WakeWordService] Starting Gemini Live session...");
      await this.geminiLive.startSession();

      // Enter command window state - 5 seconds to speak command
      this.setStatus("command_window");
      console.log("[WakeWordService] 🟢 Command window active (5 seconds)");

      // Start 5-second command window timer
      if (this.commandWindowTimer) {
        clearTimeout(this.commandWindowTimer);
      }

      this.commandWindowTimer = setTimeout(() => {
        console.log("[WakeWordService] ⏰ Command window timeout");
        if (this.status === "command_window") {
          this.resetToIdle();
        }
      }, this.commandWindowDuration);

      console.log("[WakeWordService] ✓ Ready for command via Gemini Live");
    } catch (error) {
      console.error("[WakeWordService] Failed to start Gemini session:", error);
      this.emit("error", error as Error);
      this.resetToIdle();
    }
  }

  private handleToolCall(toolCall: { name: string; args: Record<string, any> }): void {
    console.log(`[WakeWordService] Executing tool: ${toolCall.name}`);

    // Clear timers since we got a command
    if (this.commandWindowTimer) {
      clearTimeout(this.commandWindowTimer);
      this.commandWindowTimer = null;
    }
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }

    // Emit the tool call event so the UI/main process can handle it
    this.emit("toolCall", toolCall);

    // After tool is called, reset to idle to listen for next wake word
    setTimeout(() => {
      this.resetToIdle();
    }, 1000); // Small delay to let any Gemini response finish
  }

  private resetToIdle(): void {
    console.log("[WakeWordService] 🔄 Resetting to idle state");

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.commandWindowTimer) {
      clearTimeout(this.commandWindowTimer);
      this.commandWindowTimer = null;
    }

    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }

    this.googleSpeech.stopStream();
    this.geminiLive.endSession();
    this.speechBuffer = [];
    this.currentTranscript = "";
    this.vad.reset();

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

    console.log("[WakeWordService] Initializing Google Speech (for wake word)...");
    await this.googleSpeech.initialize();

    console.log("[WakeWordService] Initializing Gemini Live (for conversation)...");
    await this.geminiLive.initialize();

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

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.commandWindowTimer) {
      clearTimeout(this.commandWindowTimer);
      this.commandWindowTimer = null;
    }

    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }

    this.audioCapture.stop();
    this.googleSpeech.stopStream();
    this.geminiLive.endSession();
    this.vad.reset();

    this.setStatus("idle");
    this.speechBuffer = [];
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
    await this.geminiLive.destroy();
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
