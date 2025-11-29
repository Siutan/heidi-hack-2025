/**
 * Wake Word Service
 * Simplified service that detects the wake word "Hi Dee"
 * After detection, records 5 seconds of audio and sends to Gemini 2.5 Flash
 */

import { EventEmitter } from "events";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { AudioCapture, checkSoxInstalled } from "./audioCapture";
import { VAD } from "./vad";
import { GoogleSpeechService } from "./googleSpeech";
import { WakeWordMatcher } from "./wakeWordMatcher";
import {
  GeminiCommandService,
  getGeminiCommandService,
  ToolCallResult,
} from "./geminiCommand";
import { WakeWordStatus, WakeWordServiceConfig, DEFAULT_CONFIG } from "./types";

const execPromise = promisify(exec);

// Google Cloud TTS client (singleton)
let ttsClient: TextToSpeechClient | null = null;

function getTTSClient(): TextToSpeechClient {
  if (!ttsClient) {
    ttsClient = new TextToSpeechClient({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ttsClient;
}

/**
 * Speak text using Google Cloud Text-to-Speech with Gemini TTS
 * Uses the gemini-2.5-flash-tts model for natural, controllable speech
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts
 */
async function speakText(text: string): Promise<void> {
  try {
    console.log("[WakeWordService] 🔊 Generating TTS audio with Gemini TTS...");

    const client = getTTSClient();

    // Use Gemini TTS model with Aoede voice (friendly female voice)
    // Available voices: Aoede, Charon, Fenrir, Kore, Puck, etc.
    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "en-US",
        name: "Aoede", // Gemini TTS voice - friendly and natural
      },
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 24000,
      },
    });

    if (response.audioContent) {
      console.log("[WakeWordService] 🔊 Playing TTS audio...");

      // Play the audio using sox's play command
      const playProcess = spawn("play", [
        "-t",
        "raw",
        "-r",
        "24000",
        "-e",
        "signed",
        "-b",
        "16",
        "-c",
        "1",
        "-",
      ]);

      // Write audio data to stdin
      playProcess.stdin.write(response.audioContent);
      playProcess.stdin.end();

      // Wait for playback to complete
      await new Promise<void>((resolve, reject) => {
        playProcess.on("close", (code) => {
          if (code === 0) {
            console.log("[WakeWordService] 🔊 TTS playback complete");
            resolve();
          } else {
            reject(new Error(`play exited with code ${code}`));
          }
        });
        playProcess.on("error", reject);
      });
    }
  } catch (error) {
    console.error("[WakeWordService] TTS error:", error);
    // Fallback to macOS say command
    try {
      console.log("[WakeWordService] Falling back to macOS TTS...");
      const escapedText = text.replace(/'/g, "'\\''");
      await execPromise(`say -v Samantha '${escapedText}'`);
      console.log("[WakeWordService] 🔊 Fallback TTS complete");
    } catch (fallbackError) {
      console.error(
        "[WakeWordService] Fallback TTS also failed:",
        fallbackError
      );
    }
  }
}

export interface WakeWordServiceEvents {
  statusChange: (status: WakeWordStatus) => void;
  wakeDetected: (data: { transcript: string; confidence: number }) => void;
  transcript: (data: { text: string; isFinal: boolean }) => void;
  geminiResponse: (data: { text: string }) => void;
  toolCall: (data: { name: string; args: Record<string, any> }) => void;
  error: (error: Error) => void;
}

export class WakeWordService extends EventEmitter {
  private config: WakeWordServiceConfig;
  private audioCapture: AudioCapture;
  private vad: VAD;
  private googleSpeech: GoogleSpeechService;
  private wakeWordMatcher: WakeWordMatcher;
  private geminiCommand: GeminiCommandService;

  private status: WakeWordStatus = "idle";
  private isRunning = false;
  private currentTranscript = "";
  private speechBuffer: Buffer[] = [];
  private speechStartTime = 0;
  private maxSpeechDuration = 3000; // Only buffer 3 seconds max for wake word detection
  private silenceTimer: NodeJS.Timeout | null = null;
  private recordingTimer: NodeJS.Timeout | null = null;

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
    this.geminiCommand = getGeminiCommandService();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Audio capture → VAD + Gemini recording (when in command window)
    this.audioCapture.on("data", (chunk: Buffer) => {
      this.vad.process(chunk);

      // Send audio to Gemini command service during recording
      if (this.status === "command_window" && this.geminiCommand.recording) {
        this.geminiCommand.addAudioChunk(chunk);
      }
    });

    this.audioCapture.on("error", (error: Error) => {
      console.error("[WakeWordService] Audio capture error:", error);
      this.emit("error", error);
      this.setStatus("error");
    });

    // VAD events - for wake word detection
    this.vad.on("speechStart", () => {
      if (this.status === "idle") {
        console.log(
          "[WakeWordService] 🎤 Speech started - checking for wake word"
        );
        this.speechBuffer = [];
        this.speechStartTime = Date.now();
        this.setStatus("listening");

        // Start Google Speech stream for wake word detection
        if (!this.googleSpeech.streaming) {
          this.googleSpeech.startStream();
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
          console.log(
            "[WakeWordService] ⏰ Max speech duration reached without wake word"
          );
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
            console.log(
              "[WakeWordService] No wake word detected, resetting..."
            );
            this.resetToIdle();
          }
        }, 1500);
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
          console.log(
            `[WakeWordService] 🎉 WAKE WORD DETECTED! "${match.matchedPhrase}"`
          );
          this.handleWakeWordDetected(text, match.confidence);
        }
      }
    );

    this.googleSpeech.on("error", (error: Error) => {
      console.error("[WakeWordService] Google Speech error:", error);
    });

    // Gemini command service events
    this.geminiCommand.on("recordingComplete", () => {
      console.log("[WakeWordService] 🎙️ Recording complete, processing...");
      this.setStatus("processing");
      this.processCommand();
    });

    this.geminiCommand.on("error", (error: Error) => {
      console.error("[WakeWordService] Gemini command error:", error);
      this.resetToIdle();
    });
  }

  private async handleWakeWordDetected(
    transcript: string,
    confidence: number
  ): Promise<void> {
    // Stop Google Speech - we're done with wake word detection
    console.log("[WakeWordService] 🛑 Stopping Google STT");
    this.googleSpeech.stopStream();

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    this.setStatus("wake_detected");
    this.emit("wakeDetected", { transcript, confidence });

    // Start recording 5 seconds of audio
    console.log("[WakeWordService] 🎙️ Starting 5-second command recording...");
    this.setStatus("command_window");
    this.geminiCommand.startRecording();

    // Set a backup timer in case the recording doesn't auto-complete
    this.recordingTimer = setTimeout(() => {
      if (this.geminiCommand.recording) {
        console.log(
          "[WakeWordService] ⏰ Recording timer - forcing completion"
        );
        this.geminiCommand.stopRecording();
        this.setStatus("processing");
        this.processCommand();
      }
    }, 5500); // Slightly longer than 5 seconds as backup
  }

  private async processCommand(): Promise<void> {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }

    try {
      console.log("[WakeWordService] 🤖 Processing command with Gemini...");
      const result = await this.geminiCommand.processAudio();

      if (result) {
        console.log(
          `[WakeWordService] 🔧 Tool: ${result.toolName}, Response: "${result.response}"`
        );

        // Emit the response
        this.emit("geminiResponse", { text: result.response });

        // Speak the response using TTS FIRST (before tool execution)
        console.log(
          "[WakeWordService] 🔊 Speaking response before tool execution..."
        );
        try {
          await speakText(result.response);
        } catch (err) {
          console.error("[WakeWordService] TTS error:", err);
        }

        // Emit the tool call AFTER TTS completes
        if (result.toolName !== "none") {
          console.log("[WakeWordService] 🔧 Now executing tool...");
          this.emit("toolCall", { name: result.toolName, args: result.args });
        }
      } else {
        console.log("[WakeWordService] No result from Gemini");
        const fallbackText = "Sorry, I didn't catch that. Could you try again?";
        this.emit("geminiResponse", { text: fallbackText });

        // Speak the fallback response
        try {
          await speakText(fallbackText);
        } catch (err) {
          console.error("[WakeWordService] TTS error:", err);
        }
      }
    } catch (error) {
      console.error("[WakeWordService] Error processing command:", error);
      this.emit("error", error as Error);
    }

    // Reset to idle after processing
    this.resetToIdle();
  }

  private resetToIdle(): void {
    console.log("[WakeWordService] 🔄 Resetting to idle state");

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }

    this.googleSpeech.stopStream();
    this.geminiCommand.clear();
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

    console.log(
      "[WakeWordService] Initializing Google Speech (for wake word)..."
    );
    await this.googleSpeech.initialize();

    console.log("[WakeWordService] ✓ Initialization complete!");
    console.log(
      "[WakeWordService] Wake words:",
      this.config.wakeWords.join(", ")
    );
    console.log(
      "[WakeWordService] Using Gemini 2.5 Flash for command processing"
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

    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }

    this.audioCapture.stop();
    this.googleSpeech.stopStream();
    this.geminiCommand.clear();
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
