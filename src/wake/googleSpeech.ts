/**
 * Google Cloud Speech-to-Text Streaming Service
 * Handles streaming recognition with auto-reconnect
 *
 * Based on: https://cloud.google.com/speech-to-text/docs/transcribe-streaming-audio
 */

import { EventEmitter } from "events";
import { SpeechClient, protos } from "@google-cloud/speech";

// Type aliases for cleaner code
type IStreamingRecognitionConfig =
  protos.google.cloud.speech.v1.IStreamingRecognitionConfig;
type IStreamingRecognizeResponse =
  protos.google.cloud.speech.v1.IStreamingRecognizeResponse;

export interface GoogleSpeechConfig {
  languageCode: string;
  sampleRateHertz: number;
  enableAutomaticPunctuation: boolean;
  maxStreamDuration: number;
}

export const DEFAULT_GOOGLE_SPEECH_CONFIG: GoogleSpeechConfig = {
  languageCode: "en-US",
  sampleRateHertz: 16000,
  enableAutomaticPunctuation: true,
  maxStreamDuration: 290000,
};

export class GoogleSpeechService extends EventEmitter {
  private client: SpeechClient | null = null;
  private recognizeStream: ReturnType<
    SpeechClient["streamingRecognize"]
  > | null = null;
  private config: GoogleSpeechConfig;
  private streamStartTime = 0;
  private isStreaming = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingAudio: Buffer[] = [];
  private writeCount = 0;
  private lastWriteLogTime = 0;

  constructor(config: Partial<GoogleSpeechConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GOOGLE_SPEECH_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;

      console.log("[GoogleSpeech] Initializing...");
      console.log(
        `[GoogleSpeech] API Key present: ${apiKey ? "YES (" + apiKey.substring(0, 8) + "...)" : "NO"}`
      );

      if (apiKey) {
        this.client = new SpeechClient({ apiKey });
        console.log("[GoogleSpeech] ✓ Initialized with API key");
      } else {
        this.client = new SpeechClient();
        console.log("[GoogleSpeech] ✓ Initialized with default credentials");
      }
    } catch (error) {
      console.error("[GoogleSpeech] ✗ Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Start a new streaming recognition session
   * Following the official Google pattern: pass config to streamingRecognize()
   */
  startStream(): void {
    if (!this.client) {
      console.error("[GoogleSpeech] ✗ Not initialized!");
      throw new Error(
        "GoogleSpeechService not initialized. Call initialize() first."
      );
    }

    if (this.recognizeStream) {
      console.log(
        "[GoogleSpeech] Stopping existing stream before starting new one"
      );
      this.stopStream();
    }

    try {
      console.log("[GoogleSpeech] Starting new stream...");

      // Build the streaming config - this gets passed directly to streamingRecognize
      const streamingConfig: IStreamingRecognitionConfig = {
        config: {
          encoding:
            protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
              .LINEAR16,
          sampleRateHertz: this.config.sampleRateHertz,
          languageCode: this.config.languageCode,
          enableAutomaticPunctuation: this.config.enableAutomaticPunctuation,
          speechContexts: [
            {
              phrases: [
                "Hi Dee",
                "Hi D",
                "Heidi",
                "Hey Dee",
                "Hey D",
                "Hedy",
                "Hide E",
                "Hydie",
                "HeyDee",
                "Hi Di",
                "Hey Di",
                "record",
                "session",
                "start",
                "stop",
                "notes",
                "patient",
              ],
              boost: 15,
            },
          ],
        },
        interimResults: true,
        singleUtterance: false,
      };

      // Create the stream - passing the config here means we ONLY write audio afterwards
      this.recognizeStream = this.client.streamingRecognize(streamingConfig);

      this.streamStartTime = Date.now();
      this.isStreaming = true;
      this.writeCount = 0;

      // Handle responses
      this.recognizeStream.on(
        "data",
        (response: IStreamingRecognizeResponse) => {
          this.handleResponse(response);
        }
      );

      this.recognizeStream.on("error", (error: Error) => {
        console.error("[GoogleSpeech] ✗ Stream error:", error.message);
        this.emit("error", error);
        this.handleStreamEnd();
      });

      this.recognizeStream.on("end", () => {
        console.log("[GoogleSpeech] Stream ended normally");
        this.handleStreamEnd();
      });

      // Set up auto-reconnect before Google's limit
      this.scheduleReconnect();

      console.log("[GoogleSpeech] ✓ Stream started successfully");
      this.emit("streamStart");

      // Flush any pending audio (now we can send audio-only messages)
      this.flushPendingAudio();
    } catch (error) {
      console.error("[GoogleSpeech] ✗ Failed to start stream:", error);
      this.emit("error", error);
    }
  }

  /**
   * Write audio data to the stream
   * Since config was passed to streamingRecognize(), we ONLY send audio content here
   */
  write(audioChunk: Buffer): void {
    if (!this.isStreaming || !this.recognizeStream) {
      // Buffer audio if stream isn't ready
      this.pendingAudio.push(audioChunk);
      if (this.pendingAudio.length > 100) {
        this.pendingAudio.shift();
      }
      return;
    }

    if (!audioChunk || audioChunk.length === 0) {
      return;
    }

    try {
      if (this.writeCount === 0) {
        console.log(
          `[GoogleSpeech] Sending first audio chunk (${audioChunk.length} bytes)...`
        );
      }

      // Write raw audio bytes directly to the stream
      // The streamingRecognize stream expects raw audio data when config was passed at creation
      this.recognizeStream.write(audioChunk);
      this.writeCount++;

      const now = Date.now();
      if (now - this.lastWriteLogTime > 3000) {
        console.log(
          `[GoogleSpeech] Sent ${this.writeCount} audio chunks to Google`
        );
        this.lastWriteLogTime = now;
      }
    } catch (error) {
      console.error("[GoogleSpeech] Write error:", error);
      this.startStream();
    }
  }

  stopStream(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.recognizeStream) {
      try {
        this.recognizeStream.end();
      } catch {
        // Ignore errors when ending stream
      }
      this.recognizeStream = null;
    }

    this.isStreaming = false;
    this.emit("streamEnd");
  }

  private handleResponse(response: IStreamingRecognizeResponse): void {
    if (!response.results || response.results.length === 0) {
      return;
    }

    for (const result of response.results) {
      if (!result.alternatives || result.alternatives.length === 0) {
        continue;
      }

      const transcript = result.alternatives[0].transcript || "";
      const confidence = result.alternatives[0].confidence || 0;
      const isFinal = result.isFinal || false;

      console.log(
        `[GoogleSpeech] 📝 Transcript: "${transcript}" (final: ${isFinal}, confidence: ${confidence.toFixed(2)})`
      );

      this.emit("transcript", {
        text: transcript,
        confidence,
        isFinal,
        timestamp: Date.now(),
      });
    }
  }

  private handleStreamEnd(): void {
    this.isStreaming = false;
    this.recognizeStream = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      console.log("[GoogleSpeech] Reconnecting stream (time limit)");
      this.startStream();
    }, this.config.maxStreamDuration);
  }

  private flushPendingAudio(): void {
    while (
      this.pendingAudio.length > 0 &&
      this.isStreaming &&
      this.recognizeStream
    ) {
      const chunk = this.pendingAudio.shift();
      if (chunk) {
        this.write(chunk);
      }
    }
  }

  get streaming(): boolean {
    return this.isStreaming;
  }

  async destroy(): Promise<void> {
    this.stopStream();
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
