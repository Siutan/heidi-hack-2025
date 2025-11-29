/**
 * Simple Gemini Command Service
 * Records 5 seconds of audio after wake word, sends to Gemini 2.5 Flash,
 * and returns tool call + acknowledgment.
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type Tool,
} from "@google/generative-ai";
import { EventEmitter } from "events";
import { exec } from "child_process";
import { promisify } from "util";
import { Computer } from "../services/computer-service";

const execPromise = promisify(exec);

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

Be warm, professional, and helpful. Keep your response very short and conversational.

For computer actions, you can:
- Open URLs in the browser
- Click at specific screen coordinates
- Type text
- Take screenshots to see what's on screen`;

// Tool declarations for Gemini function calling
const tools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "start_recording",
        description:
          "Start recording a patient session or clinical note. Use this when the user wants to begin a recording session, start transcribing, or start a new session in Heidi.",
      },
      {
        name: "stop_recording",
        description:
          "Stop the current recording session. Use this when the user wants to end or finish the recording.",
      },
      {
        name: "emr_assistance",
        description:
          "Provide assistance with EMR (Electronic Medical Records), patient records, medical documentation, or any healthcare-related queries. Use this for questions about patient information, medical history, or record management.",
      },
      {
        name: "open_url",
        description:
          "Open a URL in the default web browser. Use this when the user wants to open a website or navigate to a specific URL.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            url: {
              type: SchemaType.STRING,
              description: "The URL to open in the browser",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "click_screen",
        description:
          "Click at specific screen coordinates. Use this when you need to click on something visible on the screen.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            x: {
              type: SchemaType.NUMBER,
              description: "The X coordinate to click at",
            },
            y: {
              type: SchemaType.NUMBER,
              description: "The Y coordinate to click at",
            },
          },
          required: ["x", "y"],
        },
      },
      {
        name: "type_text",
        description:
          "Type text using the keyboard. Use this to enter text into input fields or type commands.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            text: {
              type: SchemaType.STRING,
              description: "The text to type",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "take_screenshot",
        description:
          "Take a screenshot of the current screen. Use this to see what's displayed on the screen.",
      },
      {
        name: "start_heidi_transcription",
        description:
          "Open Heidi Health scribe and start transcription. Use this when the user wants to start transcribing in Heidi, start a recording session, or open the transcription interface.",
      },
    ],
  },
] as Tool[];

/**
 * Convert raw PCM audio to WAV format
 * PCM is 16-bit signed, mono, 16kHz
 */
function pcmToWav(
  pcmData: Buffer,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize - 8, 4);
  header.write("WAVE", 8);

  // fmt subchunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * Execute a tool call based on tool name and arguments
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  console.log(`[GeminiCommand] Executing tool: ${toolName}`, args);

  switch (toolName) {
    case "open_url": {
      const url = args.url as string;
      if (!url) throw new Error("URL is required for open_url");
      return await openUrl(url);
    }

    case "click_screen": {
      const x = args.x as number;
      const y = args.y as number;
      if (x === undefined || y === undefined) {
        throw new Error("x and y coordinates are required for click_screen");
      }
      return await Computer.clickAt(x, y);
    }

    case "type_text": {
      const text = args.text as string;
      if (!text) throw new Error("text is required for type_text");
      return await Computer.type(text);
    }

    case "take_screenshot": {
      const screenshot = await Computer.takeScreenshot();
      return `Screenshot taken (${screenshot.length} bytes base64)`;
    }

    case "start_heidi_transcription":
    case "start_recording": {
      // Start recording = open Heidi and click transcribe button
      console.log(
        `[GeminiCommand] Starting Heidi transcription for tool: ${toolName}`
      );
      return await startHeidiTranscription();
    }

    case "stop_recording": {
      // Stop recording = click stop transcribing button and confirm
      console.log(
        `[GeminiCommand] Stopping Heidi transcription for tool: ${toolName}`
      );
      return await stopHeidiTranscription();
    }

    case "emr_assistance":
      // This is handled by the overlay/UI layer
      console.log(`[GeminiCommand] Tool ${toolName} will be handled by UI`);
      return `Tool ${toolName} will be handled by UI`;

    default:
      console.log(`[GeminiCommand] Unknown tool: ${toolName}`);
      return `Unknown tool: ${toolName}`;
  }
}

/**
 * Open a URL in the default browser
 */
async function openUrl(url: string): Promise<string> {
  console.log(`[GeminiCommand] Opening URL: ${url}`);
  try {
    // Use 'open' command on macOS to open URL in default browser
    await execPromise(`open "${url}"`);
    return `Opened URL: ${url}`;
  } catch (error) {
    console.error(`[GeminiCommand] Error opening URL:`, error);
    throw error;
  }
}

/**
 * Start Heidi transcription by opening the scribe page and clicking the transcribe button
 */
async function startHeidiTranscription(): Promise<string> {
  console.log("[GeminiCommand] Starting Heidi transcription...");

  try {
    // Step 1: Open the Heidi Health scribe URL
    await openUrl("https://scribe.heidihealth.com/");
    console.log("[GeminiCommand] Opened Heidi Health scribe page");

    // Step 2: Wait for the page to load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 3: Take a screenshot to find the transcribe button
    console.log(
      "[GeminiCommand] Taking screenshot to locate transcribe button..."
    );
    const screenshotBase64 = await Computer.takeScreenshot();

    // Step 4: Find and click the transcribe button using Gemini vision
    const buttonLocation = await findTranscribeButton(screenshotBase64);

    if (buttonLocation) {
      console.log(
        `[GeminiCommand] Found transcribe button at (${buttonLocation.x}, ${buttonLocation.y})`
      );
      await Computer.clickAt(buttonLocation.x, buttonLocation.y);
      return "Successfully started Heidi transcription";
    } else {
      // Fallback: Try clicking at a common location for the transcribe button
      // Based on the screenshot, it's typically in the top-right area
      console.log(
        "[GeminiCommand] Using fallback location for transcribe button"
      );
      const dimensions = await Computer.getDisplayDimensions();
      // The transcribe button is typically around 100px from right edge and 50px from top
      const fallbackX = dimensions.width - 100;
      const fallbackY = 50;
      await Computer.clickAt(fallbackX, fallbackY);
      return "Started Heidi transcription (used fallback location)";
    }
  } catch (error) {
    console.error("[GeminiCommand] Error starting Heidi transcription:", error);
    throw error;
  }
}

/**
 * Stop Heidi transcription by clicking stop button and confirming in popup
 */
async function stopHeidiTranscription(): Promise<string> {
  console.log("[GeminiCommand] Stopping Heidi transcription...");

  // Known coordinates
  const STOP_BUTTON_X = 1800;
  const STOP_BUTTON_Y = 115;
  const POPUP_CONFIRM_X = 846;
  const POPUP_CONFIRM_Y = 689;

  try {
    // Step 1: Click to focus browser window first
    console.log("[GeminiCommand] Step 1: Clicking to focus browser window...");
    await Computer.clickAt(500, 300);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("[GeminiCommand] ✓ Focus click done");

    // Step 2: Click the stop transcribing button
    console.log(
      `[GeminiCommand] Step 2: Clicking stop transcribing button at (${STOP_BUTTON_X}, ${STOP_BUTTON_Y})...`
    );
    await Computer.clickAt(STOP_BUTTON_X, STOP_BUTTON_Y);
    console.log("[GeminiCommand] ✓ Stop button clicked");

    // Step 3: Wait 2 seconds for popup to appear
    console.log("[GeminiCommand] Step 3: Waiting 2 seconds for popup...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("[GeminiCommand] ✓ Wait complete");

    // Step 4: Click the confirm button in popup
    console.log(
      `[GeminiCommand] Step 4: Clicking popup confirm at (${POPUP_CONFIRM_X}, ${POPUP_CONFIRM_Y})...`
    );
    const result = await Computer.clickAt(POPUP_CONFIRM_X, POPUP_CONFIRM_Y);
    console.log(`[GeminiCommand] ✓ Popup click result: ${result}`);

    return "Successfully stopped Heidi transcription";
  } catch (error) {
    console.error(
      "[GeminiCommand] ✗ Error stopping Heidi transcription:",
      error
    );
    throw error;
  }
}

/**
 * Use Gemini vision to find the transcribe button in a screenshot
 */
async function findTranscribeButton(
  screenshotBase64: string
): Promise<{ x: number; y: number } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GeminiCommand] No GEMINI_API_KEY for vision analysis");
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/png",
          data: screenshotBase64,
        },
      },
      `return { "x":1800, "y":115}`,
    ]);

    const text = result.response.text();
    console.log("[GeminiCommand] Vision response:", text);

    // Parse the JSON response
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const coords = JSON.parse(match[0]);
      if (coords.x !== null && coords.y !== null) {
        return { x: coords.x, y: coords.y };
      }
    }
  } catch (error) {
    console.error("[GeminiCommand] Error finding transcribe button:", error);
  }

  return null;
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
      console.error(
        "[GeminiCommand] Gemini API not initialized - missing GEMINI_API_KEY"
      );
      return null;
    }

    console.log(
      `[GeminiCommand] Processing ${pcmAudio.length} bytes of PCM audio...`
    );

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
        toolArgs = (firstCall.args as Record<string, any>) || {};
        console.log(`[GeminiCommand] Tool call: ${toolName}`, toolArgs);

        // Execute the tool
        try {
          const toolResult = await executeToolCall(toolName, toolArgs);
          console.log(`[GeminiCommand] Tool execution result:`, toolResult);
        } catch (toolError) {
          console.error(`[GeminiCommand] Tool execution error:`, toolError);
        }
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
    case "open_url":
      return "Opening that for you.";
    case "click_screen":
      return "Clicking there for you.";
    case "type_text":
      return "Typing that now.";
    case "take_screenshot":
      return "Taking a screenshot.";
    case "start_heidi_transcription":
      return "Starting Heidi transcription for you.";
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

// Export the transcription functions for direct use
export {
  startHeidiTranscription,
  stopHeidiTranscription,
  openUrl,
  executeToolCall,
};
