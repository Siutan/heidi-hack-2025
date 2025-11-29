/**
 * Gemini Live API Service
 * Handles real-time voice conversation using Gemini's Live API
 *
 * Docs: https://ai.google.dev/gemini-api/docs/live
 */

import { EventEmitter } from "events";
import {
  GoogleGenAI,
  Modality,
  Session,
  LiveServerMessage,
} from "@google/genai";

export interface GeminiLiveConfig {
  model: string;
  systemInstruction: string;
}

export const DEFAULT_GEMINI_LIVE_CONFIG: GeminiLiveConfig = {
  model: "gemini-2.5-flash-preview-native-audio-dialog",
  systemInstruction: `You are Heidi (or "Hi Dee"), a friendly and helpful voice assistant for healthcare professionals. 
You help with recording patient sessions, taking notes, and answering questions.
Keep responses concise and natural for voice interaction.
When the user asks to record a session, acknowledge it and let them know you're ready.
Be warm, professional, and helpful.`,
};

export class GeminiLiveService extends EventEmitter {
  private ai: GoogleGenAI | null = null;
  private session: Session | null = null;
  private config: GeminiLiveConfig;
  private isConnected = false;
  private audioBuffer: Buffer[] = [];
  private responseQueue: LiveServerMessage[] = [];

  constructor(config: Partial<GeminiLiveConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GEMINI_LIVE_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

    console.log("[GeminiLive] Initializing...");
    console.log(
      `[GeminiLive] API Key present: ${apiKey ? "YES (" + apiKey.substring(0, 8) + "...)" : "NO"}`
    );

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY or GEMINI_API_KEY environment variable is required"
      );
    }

    this.ai = new GoogleGenAI({ apiKey });
    console.log("[GeminiLive] ✓ Initialized");
  }

  /**
   * Start a live session for conversation
   */
  async startSession(): Promise<void> {
    if (!this.ai) {
      throw new Error(
        "GeminiLiveService not initialized. Call initialize() first."
      );
    }

    if (this.session) {
      console.log("[GeminiLive] Closing existing session...");
      this.session.close();
      this.session = null;
    }

    try {
      console.log("[GeminiLive] Starting live session...");
      console.log(`[GeminiLive] Model: ${this.config.model}`);

      this.session = await this.ai.live.connect({
        model: this.config.model,
        config: {
          responseModalities: [Modality.AUDIO, Modality.TEXT],
          systemInstruction: this.config.systemInstruction,
        },
        callbacks: {
          onopen: () => {
            console.log("[GeminiLive] ✓ Session connected");
            this.isConnected = true;
            this.emit("connected");
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleMessage(message);
          },
          onerror: (error: ErrorEvent) => {
            console.error("[GeminiLive] ✗ Session error:", error.message);
            this.emit("error", new Error(error.message));
          },
          onclose: (event: CloseEvent) => {
            console.log("[GeminiLive] Session closed:", event.reason);
            this.isConnected = false;
            this.session = null;
            this.emit("disconnected");
          },
        },
      });

      console.log("[GeminiLive] ✓ Session started");
    } catch (error) {
      console.error("[GeminiLive] ✗ Failed to start session:", error);
      throw error;
    }
  }

  /**
   * Send audio chunk to Gemini Live
   * Audio should be 16-bit PCM, 16kHz, mono
   */
  sendAudio(audioChunk: Buffer): void {
    if (!this.session || !this.isConnected) {
      this.audioBuffer.push(audioChunk);
      if (this.audioBuffer.length > 50) {
        this.audioBuffer.shift();
      }
      return;
    }

    try {
      // Convert Buffer to base64
      const base64Audio = audioChunk.toString("base64");

      this.session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: "audio/pcm;rate=16000",
        },
      });
    } catch (error) {
      console.error("[GeminiLive] Error sending audio:", error);
    }
  }

  /**
   * Send text message to Gemini
   */
  async sendText(text: string): Promise<void> {
    if (!this.session || !this.isConnected) {
      console.warn("[GeminiLive] Cannot send text - not connected");
      return;
    }

    try {
      console.log(`[GeminiLive] Sending text: "${text}"`);
      await this.session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (error) {
      console.error("[GeminiLive] Error sending text:", error);
    }
  }

  private handleMessage(message: LiveServerMessage): void {
    this.responseQueue.push(message);

    // Handle different message types
    if (message.serverContent) {
      const content = message.serverContent;

      // Check for text response
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.text) {
            console.log(`[GeminiLive] 📝 Text response: "${part.text}"`);
            this.emit("textResponse", part.text);
          }
        }
      }

      // Check if turn is complete
      if (content.turnComplete) {
        console.log("[GeminiLive] ✓ Turn complete");
        this.emit("turnComplete");
      }
    }

    // Handle audio data
    if (message.data) {
      // Audio data comes as base64
      const audioBuffer = Buffer.from(message.data, "base64");
      this.emit("audioResponse", audioBuffer);
    }
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (this.session) {
      console.log("[GeminiLive] Ending session...");
      this.session.close();
      this.session = null;
      this.isConnected = false;
    }
    this.audioBuffer = [];
    this.responseQueue = [];
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async destroy(): Promise<void> {
    this.endSession();
    this.ai = null;
  }
}

// Singleton instance
let instance: GeminiLiveService | null = null;

export function getGeminiLiveService(): GeminiLiveService {
  if (!instance) {
    instance = new GeminiLiveService();
  }
  return instance;
}

export function destroyGeminiLiveService(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
