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
  FunctionDeclaration,
} from "@google/genai";


export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface GeminiLiveConfig {
  model: string;
  systemInstruction: string;
}

// Tool definitions for Gemini function calling
const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "start_recording",
    description: "Start recording a patient session or clinical note. Use this when the user wants to begin a recording session.",
  },
  {
    name: "stop_recording",
    description: "Stop the current recording session. Use this when the user wants to end or finish the recording.",
  },
  {
    name: "emr_assistance",
    description: "Provide assistance with EMR (Electronic Medical Records), patient records, medical documentation, or any healthcare-related queries. Use this for questions about patient information, medical history, or record management.",
    parameters: {
      type: "OBJECT" as any,
      properties: {
        conversation: {
          type: "STRING" as any,
          description: "The conversation text or medical notes to be processed into the EMR.",
        },
        sourceId: {
          type: "STRING" as any,
          description: "Optional ID of the source window or application to target for automation.",
        },
      },
      required: ["conversation"],
    },
  },
];

export const DEFAULT_GEMINI_LIVE_CONFIG: GeminiLiveConfig = {
  model: "gemini-2.5-flash-native-audio-preview-09-2025",
  systemInstruction: `You are Heidi (or "Hi Dee"), a friendly and helpful voice assistant for healthcare professionals. 
You help with recording patient sessions, taking notes, and answering questions.

You have access to three tools:
- start_recording: Use this when the user wants to start recording a session
- stop_recording: Use this when the user wants to stop or end recording
- emr_assistance: Use this for questions about patient records, EMR, or medical documentation

Listen carefully to what the user says after "Hi Dee" and select the appropriate tool.
Keep responses concise and natural for voice interaction.
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

      // Build configuration for debugging
      // Testing with minimal config to isolate the invalid argument error
      const sessionConfig = {
        model: this.config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.config.systemInstruction,  // Testing if this causes the error
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      };

      // Log the full configuration for debugging
      console.log("[GeminiLive] 📋 Session configuration:");
      console.log(JSON.stringify(sessionConfig, null, 2));

      this.session = await this.ai.live.connect({
        ...sessionConfig,
        callbacks: {
          onopen: () => {
            console.log("[GeminiLive] ✓ Session connected");
            this.isConnected = true;
            this.emit("connected");
          },
          onmessage: (message: LiveServerMessage) => {
            console.log(message);
            this.handleMessage(message);
          },
          onerror: (error: ErrorEvent) => {
            console.error("[GeminiLive] ✗ Session error:", error.message);
            console.error("[GeminiLive] Full error:", error);
            this.emit("error", new Error(error.message));
          },
          onclose: (event: CloseEvent) => {
            console.log("[GeminiLive] Session closed:", event.reason);
            console.log("[GeminiLive] Close code:", event.code);
            console.log("[GeminiLive] Was clean:", event.wasClean);
            this.isConnected = false;
            this.session = null;
            this.emit("disconnected");
          },
        },
      });

      console.log("[GeminiLive] ✓ Session started");
    } catch (error) {
      console.error("[GeminiLive] ✗ Failed to start session:");
      console.error("[GeminiLive] Error type:", typeof error);
      console.error("[GeminiLive] Error:", error);
      if (error instanceof Error) {
        console.error("[GeminiLive] Error message:", error.message);
        console.error("[GeminiLive] Error stack:", error.stack);
      }
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
      console.log("[GeminiLive] 📨 Server content:", JSON.stringify(content, null, 2));

      // Check for tool calls (function calling)
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          // Handle text response
          if (part.text) {
            console.log(`[GeminiLive] 📝 Text response: "${part.text}"`);
            this.emit("textResponse", part.text);
          }

          // Handle tool/function calls
          if (part.functionCall && part.functionCall.name) {
            const toolCall: ToolCall = {
              name: part.functionCall.name,
              args: part.functionCall.args || {},
            };
            console.log(`[GeminiLive] 🔧 Tool call: ${toolCall.name}`, toolCall.args);
            
            // Execute tool locally
            if (toolCall.name === 'emr_assistance') {
                  this.emit("textResponse", part.text);
                  console.log("[GeminiLive] Executing emr_assistance...");
                  this.emit("toolCall", toolCall);
                  this.endSession();
            }

          }
        }
      }

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
