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
      // Use paste instead of type for better reliability with long text and special characters
      return await Computer.paste(text);
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

    case "emr_assistance": {
      // Execute EMR assistance - open Careflow and paste
      console.log(
        `[GeminiCommand] Executing EMR assistance for tool: ${toolName}`
      );
      return await executeEMRAssistance();
    }

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

  // Known coordinates for the Transcribe button
  const TRANSCRIBE_BUTTON_X = 1800;
  const TRANSCRIBE_BUTTON_Y = 115;

  try {
    // Step 1: Open the Heidi Health scribe URL
    console.log("[GeminiCommand] Step 1: Opening Heidi Health scribe URL...");
    await openUrl("https://scribe.heidihealth.com/");
    console.log("[GeminiCommand] ✓ Opened Heidi Health scribe page");

    // Step 2: Wait for the page to load
    console.log(
      "[GeminiCommand] Step 2: Waiting 4 seconds for page to load..."
    );
    await new Promise((resolve) => setTimeout(resolve, 4000));
    console.log("[GeminiCommand] ✓ Wait complete");

    // Step 3: Bring browser to foreground using AppleScript
    console.log("[GeminiCommand] Step 3: Bringing browser to foreground...");
    try {
      await execPromise(
        `osascript -e 'tell application "Google Chrome" to activate'`
      );
    } catch {
      try {
        await execPromise(
          `osascript -e 'tell application "Safari" to activate'`
        );
      } catch {
        try {
          await execPromise(
            `osascript -e 'tell application "Arc" to activate'`
          );
        } catch {
          console.log(
            "[GeminiCommand] Could not activate browser, continuing anyway..."
          );
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("[GeminiCommand] ✓ Browser activation attempted");

    // Step 4: Click the transcribe button at known coordinates (verify=false for exact click)
    console.log(
      `[GeminiCommand] Step 4: Clicking transcribe button at (${TRANSCRIBE_BUTTON_X}, ${TRANSCRIBE_BUTTON_Y})...`
    );
    // 1 second pause before clicking
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await Computer.clickAt(TRANSCRIBE_BUTTON_X, TRANSCRIBE_BUTTON_Y, false);
    console.log("[GeminiCommand] ✓ Transcribe button clicked");

    return "Successfully started Heidi transcription";
  } catch (error) {
    console.error(
      "[GeminiCommand] ✗ Error starting Heidi transcription:",
      error
    );
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
    // Step 1: Bring browser to foreground using AppleScript
    console.log("[GeminiCommand] Step 1: Bringing browser to foreground...");
    try {
      await execPromise(
        `osascript -e 'tell application "Google Chrome" to activate'`
      );
    } catch {
      // Try Safari if Chrome fails
      try {
        await execPromise(
          `osascript -e 'tell application "Safari" to activate'`
        );
      } catch {
        // Try Arc browser
        try {
          await execPromise(
            `osascript -e 'tell application "Arc" to activate'`
          );
        } catch {
          console.log(
            "[GeminiCommand] Could not activate browser, continuing anyway..."
          );
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("[GeminiCommand] ✓ Browser activation attempted");

    // Step 2: Click the stop transcribing button (use verify=false for exact coordinates)
    console.log(
      `[GeminiCommand] Step 2: Clicking stop transcribing button at (${STOP_BUTTON_X}, ${STOP_BUTTON_Y})...`
    );
    // 1 second pause before clicking
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await Computer.clickAt(STOP_BUTTON_X, STOP_BUTTON_Y, false);
    console.log("[GeminiCommand] ✓ Stop button clicked");

    // Step 3: Wait 2 seconds for popup to appear
    console.log("[GeminiCommand] Step 3: Waiting 2 seconds for popup...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("[GeminiCommand] ✓ Wait complete");

    // Step 4: Click the confirm button in popup (use verify=false for exact coordinates)
    console.log(
      `[GeminiCommand] Step 4: Clicking popup confirm at (${POPUP_CONFIRM_X}, ${POPUP_CONFIRM_Y})...`
    );
    // 1 second pause before clicking
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await Computer.clickAt(POPUP_CONFIRM_X, POPUP_CONFIRM_Y, false);
    console.log("[GeminiCommand] ✓ Popup confirm clicked");

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
 * Execute EMR assistance - open mock EHR app, click, select all, delete, and paste
 */
async function executeEMRAssistance(): Promise<string> {
  console.log("[GeminiCommand] Executing EMR assistance...");

  // Known coordinates for the text field
  const TEXT_FIELD_X = 900;
  const TEXT_FIELD_Y = 540;

  try {
    // Step 0a: Click at (1000, 285)
    console.log("[GeminiCommand] Step 0a: Clicking at (1000, 285)...");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Computer.clickAt(1000, 285, false);
    console.log("[GeminiCommand] ✓ Click at (1000, 285) done");

    // Step 0b: Click at (1000, 328)
    console.log("[GeminiCommand] Step 0b: Clicking at (1000, 328)...");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Computer.clickAt(1000, 328, false);
    console.log("[GeminiCommand] ✓ Click at (1000, 328) done");

    // Step 0c: Delay 1 second
    console.log("[GeminiCommand] Step 0c: Waiting 1 second...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("[GeminiCommand] ✓ Wait complete");

    // Step 1: Try to open/bring to foreground the mock EHR desktop app
    console.log("[GeminiCommand] Step 1: Opening mock ehr desktop app...");
    let appOpened = false;
    try {
      await execPromise(`open -a "mock ehr desktop app"`);
      appOpened = true;
      console.log("[GeminiCommand] ✓ mock ehr desktop app opened");
    } catch {
      console.log(
        "[GeminiCommand] Could not open with 'open -a', trying AppleScript..."
      );
      // Try using AppleScript to activate the app
      try {
        await execPromise(
          `osascript -e 'tell application "mock ehr desktop app" to activate'`
        );
        appOpened = true;
        console.log(
          "[GeminiCommand] ✓ mock ehr desktop app activated via AppleScript"
        );
      } catch {
        console.log("[GeminiCommand] AppleScript failed too");
      }
    }

    if (!appOpened) {
      console.log(
        "[GeminiCommand] Could not open mock ehr desktop app, will use current window"
      );
    }

    // Step 2: Wait for app to come to foreground
    console.log("[GeminiCommand] Step 2: Waiting for app to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log("[GeminiCommand] ✓ Wait complete");

    // Step 3: Click on the text field
    console.log(
      `[GeminiCommand] Step 3: Clicking on text field at (${TEXT_FIELD_X}, ${TEXT_FIELD_Y})...`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await Computer.clickAt(TEXT_FIELD_X, TEXT_FIELD_Y, false);
    console.log("[GeminiCommand] ✓ Text field clicked");

    // Step 4: Select all (Cmd+A)
    console.log("[GeminiCommand] Step 4: Selecting all text (Cmd+A)...");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Computer.pressKey("cmd+a");
    console.log("[GeminiCommand] ✓ Select all done");

    // Step 5: Delete selected text
    console.log("[GeminiCommand] Step 5: Deleting selected text...");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Computer.pressKey("backspace");
    console.log("[GeminiCommand] ✓ Text deleted");

    // Step 6: Paste from clipboard (Cmd+V)
    console.log("[GeminiCommand] Step 6: Pasting from clipboard (Cmd+V)...");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Computer.pressKey("cmd+v");
    console.log("[GeminiCommand] ✓ Paste complete");

    return "Successfully executed EMR assistance";
  } catch (error) {
    console.error("[GeminiCommand] ✗ Error executing EMR assistance:", error);
    throw error;
  }
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
      return "Sure, I'll help you with auto filling the form.";
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
  executeEMRAssistance,
  openUrl,
  executeToolCall,
};
