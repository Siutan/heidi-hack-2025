/**
 * Simple Gemini Command Service
 * Records 5 seconds of audio after wake word, sends to Gemini 2.5 Flash,
 * and returns tool call + acknowledgment.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { EventEmitter } from "events";

export interface ToolCallResult {
  toolName: string;
  args: Record<string, any>;
  response: string;
}

export interface GeminiCommandConfig {
  recordingDuration: number; // milliseconds
  sampleRate: number;
}

export const DEFAULT_CONFIG: GeminiCommandConfig = {
  recordingDuration: 5000, // 5 seconds
  sampleRate: 16000,
};

const SYSTEM_PROMPT = `You are Heidi (or "Hi Dee"), a friendly and helpful voice assistant for healthcare professionals.
You help with recording patient sessions, taking notes, and answering questions.

Listen to the user's audio command and:
1. Determine which tool to call based on what they're asking
2. Call the appropriate tool
3. Respond with a brief, natural acknowledgment (1 sentence max)

Be warm, professional, and helpful. Keep your response very short and conversational.`;

// Tool declarations for Gemini function calling
const tools = [
  {
    functionDeclarations: [
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
      },
    ],
  },
];

/**
 * Convert raw PCM audio to WAV format
 * PCM is 16-bit signed, mono, 16kHz
 */
function pcmToWav(pcmData: Buffer, sampleRate: number = 16000, channels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize - 8, 4);
  header.write('WAVE', 8);

  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export class GeminiCommandService extends EventEmitter {
  private config: GeminiCommandConfig;
  private audioBuffer: Buffer[] = [];
  private isRecording = false;
  private recordingStartTime = 0;
  private genAI: GoogleGenerativeAI | null = null;

  constructor(config: Partial<GeminiCommandConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Start recording audio for command capture
   */
  startRecording(): void {
    console.log("[GeminiCommand] Starting 5-second audio recording...");
    this.audioBuffer = [];
    this.isRecording = true;
    this.recordingStartTime = Date.now();
  }

  /**
   * Add audio chunk to buffer during recording
   */
  addAudioChunk(chunk: Buffer): void {
    if (!this.isRecording) return;

    this.audioBuffer.push(chunk);

    // Check if we've recorded enough
    const elapsed = Date.now() - this.recordingStartTime;
    if (elapsed >= this.config.recordingDuration) {
      console.log(
        `[GeminiCommand] Recording complete (${elapsed}ms, ${this.audioBuffer.length} chunks)`
      );
      this.isRecording = false;
      this.emit("recordingComplete");
    }
  }

  /**
   * Get the recorded audio as a single buffer
   */
  getRecordedAudio(): Buffer {
    return Buffer.concat(this.audioBuffer);
  }

  /**
   * Check if still recording
   */
  get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Stop recording early if needed
   */
  stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Process the recorded audio with Gemini 1.5 Flash
   */
  async processAudio(): Promise<ToolCallResult | null> {
    const pcmAudio = this.getRecordedAudio();

    if (pcmAudio.length === 0) {
      console.warn("[GeminiCommand] No audio recorded");
      return null;
    }

    if (!this.genAI) {
      console.error("[GeminiCommand] Gemini API not initialized - missing GEMINI_API_KEY");
      return null;
    }

    console.log(`[GeminiCommand] Processing ${pcmAudio.length} bytes of PCM audio...`);

    // Convert PCM to WAV format (Gemini API requires WAV, not raw PCM)
    const wavAudio = pcmToWav(pcmAudio, this.config.sampleRate);
    const base64Audio = wavAudio.toString("base64");
    
    console.log(`[GeminiCommand] Converted to WAV: ${wavAudio.length} bytes`);

    try {
      const model = this.genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_PROMPT,
        tools,
      });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Audio,
          },
        },
        {
          text: "Listen to my voice command and respond appropriately. Call the relevant tool and give a brief acknowledgment.",
        },
      ]);

      const response = result.response;
      console.log("[GeminiCommand] Response received");

      // Extract tool call info
      let toolName = "none";
      let toolArgs: Record<string, any> = {};
      let textResponse = "";

      // Check for function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        const firstCall = functionCalls[0];
        toolName = firstCall.name;
        toolArgs = firstCall.args || {};
        console.log(`[GeminiCommand] Tool call: ${toolName}`, toolArgs);
      }

      // Get text response
      try {
        const textPart = response.text();
        if (textPart) {
          textResponse = textPart;
          console.log(`[GeminiCommand] Text response: ${textResponse}`);
        }
      } catch (e) {
        // text() throws if there's no text content (e.g., only function call)
        console.log("[GeminiCommand] No text response (function call only)");
      }

      // Use the model's response or generate a default acknowledgment
      const finalResponse = textResponse || getDefaultAcknowledgment(toolName);

      return {
        toolName,
        args: toolArgs,
        response: finalResponse,
      };
    } catch (error) {
      console.error("[GeminiCommand] Error processing audio:", error);
      this.emit("error", error);
      return null;
    }
  }

  /**
   * Clear the audio buffer
   */
  clear(): void {
    this.audioBuffer = [];
    this.isRecording = false;
  }
}

function getDefaultAcknowledgment(toolName: string): string {
  switch (toolName) {
    case "start_recording":
      return "Sure, starting the recording now.";
    case "stop_recording":
      return "Got it, stopping the recording.";
    case "emr_assistance":
      return "Let me help you with that.";
    default:
      return "I'm not sure what you'd like me to do. Could you try again?";
  }
}

// Singleton instance
let instance: GeminiCommandService | null = null;

export function getGeminiCommandService(): GeminiCommandService {
  if (!instance) {
    instance = new GeminiCommandService();
  }
  return instance;
}

export function destroyGeminiCommandService(): void {
  if (instance) {
    instance.clear();
    instance = null;
  }
}
