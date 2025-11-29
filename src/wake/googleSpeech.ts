/**
 * Google Cloud Speech-to-Text Streaming Service
 * Handles streaming recognition with auto-reconnect
 */

import { EventEmitter } from "events";
import { SpeechClient } from "@google-cloud/speech";
import type { google } from "@google-cloud/speech/build/protos/protos";

export interface GoogleSpeechConfig {
  languageCode: string;
  sampleRateHertz: number;
  enableAutomaticPunctuation: boolean;
  // Maximum streaming duration before reconnect (Google limit is ~305 seconds)
  maxStreamDuration: number;
}

export const DEFAULT_GOOGLE_SPEECH_CONFIG: GoogleSpeechConfig = {
  languageCode: "en-US",
  sampleRateHertz: 16000,
  enableAutomaticPunctuation: true,
  maxStreamDuration: 290000, // 290 seconds (under the 305s limit)
};

type StreamingRecognizeStream = ReturnType<SpeechClient["streamingRecognize"]>;

export class GoogleSpeechService extends EventEmitter {
  private client: SpeechClient | null = null;
  private stream: StreamingRecognizeStream | null = null;
  private config: GoogleSpeechConfig;
  private streamStartTime = 0;
  private isStreaming = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingAudio: Buffer[] = [];

  constructor(config: Partial<GoogleSpeechConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GOOGLE_SPEECH_CONFIG, ...config };
  }

  /**
   * Initialize the Google Speech client
   */
  async initialize(): Promise<void> {
    try {
      // The client will use GOOGLE_APPLICATION_CREDENTIALS env var
      // or fall back to API key if set
      const apiKey = process.env.GOOGLE_API_KEY;

      console.log("[GoogleSpeech] Initializing...");
      console.log(
        `[GoogleSpeech] API Key present: ${apiKey ? "YES (" + apiKey.substring(0, 8) + "...)" : "NO"}`
      );

      if (apiKey) {
        // Use API key authentication
        this.client = new SpeechClient({
          apiKey,
        });
        console.log("[GoogleSpeech] ✓ Initialized with API key");
      } else {
        // Use default credentials (service account or ADC)
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
   */
  startStream(): void {
    if (!this.client) {
      console.error("[GoogleSpeech] ✗ Not initialized!");
      throw new Error(
        "GoogleSpeechService not initialized. Call initialize() first."
      );
    }

    if (this.stream) {
      console.log(
        "[GoogleSpeech] Stopping existing stream before starting new one"
      );
      this.stopStream();
    }

    try {
      console.log("[GoogleSpeech] Starting new stream...");

      const streamingConfig: google.cloud.speech.v1.IStreamingRecognitionConfig =
      {
        config: {
          encoding: "LINEAR16" as const,
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

      this.stream = this.client.streamingRecognize();
      this.streamStartTime = Date.now();
      this.isStreaming = true;
      this.writeCount = 0;

      // First message must contain config (no audio)
      console.log("[GoogleSpeech] Sending streaming config...");
      this.stream.write({
        streamingConfig,
      });

      // Wait a tick to ensure config is processed before sending audio? 
      // Actually, just ensure we don't send audio in the same tick if possible, 
      // but Node streams should handle this. 
      // However, let's be safe and set writeCount to 0 here again just in case.
      this.writeCount = 0;

      this.stream.on(
        "data",
        (response: google.cloud.speech.v1.IStreamingRecognizeResponse) => {
          this.handleResponse(response);
        }
      );

      this.stream.on("error", (error: Error) => {
        console.error("[GoogleSpeech] ✗ Stream error:", error.message);
        this.emit("error", error);
        this.handleStreamEnd();
      });

      this.stream.on("end", () => {
        console.log("[GoogleSpeech] Stream ended normally");
        this.handleStreamEnd();
      });

      // Set up auto-reconnect before Google's limit
      this.scheduleReconnect();

      console.log("[GoogleSpeech] ✓ Stream started successfully");
      this.emit("streamStart");

      // Flush any pending audio
      this.flushPendingAudio();
    } catch (error) {
      console.error("[GoogleSpeech] ✗ Failed to start stream:", error);
      this.emit("error", error);
    }
  }

  private writeCount = 0;
  private lastWriteLogTime = 0;

  /**
   * Write audio data to the stream
   */
  write(audioChunk: Buffer): void {
    if (!this.isStreaming || !this.stream) {
      // Buffer audio if stream isn't ready
      this.pendingAudio.push(audioChunk);

      // Limit buffer size
      if (this.pendingAudio.length > 100) {
        this.pendingAudio.shift();
      }
      return;
    }

    if (!audioChunk || audioChunk.length === 0) {
      console.warn("[GoogleSpeech] ⚠️ Attempted to write empty audio chunk, skipping");
      return;
    }

    try {
      if (this.writeCount === 0) {
        console.log(`[GoogleSpeech] Sending FIRST audio chunk (size: ${audioChunk.length} bytes)...`);
      }

      this.stream.write({ audioContent: audioChunk });
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
      // Try to reconnect
      this.startStream();
    }
  }

  /**
   * Stop the streaming session
   */
  stopStream(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.stream) {
      try {
        this.stream.end();
      } catch (error) {
        // Ignore errors when ending stream
      }
      this.stream = null;
    }

    this.isStreaming = false;
    this.emit("streamEnd");
  }

  /**
   * Handle streaming recognition response
   */
  private handleResponse(
    response: google.cloud.speech.v1.IStreamingRecognizeResponse
  ): void {
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

  /**
   * Handle stream end and cleanup
   */
  private handleStreamEnd(): void {
    this.isStreaming = false;
    this.stream = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Schedule automatic reconnect before Google's time limit
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      console.log("GoogleSpeechService: Reconnecting stream (time limit)");
      this.startStream();
    }, this.config.maxStreamDuration);
  }

  /**
   * Flush any audio buffered while stream was starting
   */
  private flushPendingAudio(): void {
    while (this.pendingAudio.length > 0 && this.isStreaming && this.stream) {
      const chunk = this.pendingAudio.shift();
      if (chunk) {
        this.write(chunk);
      }
    }
  }

  /**
   * Check if currently streaming
   */
  get streaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.stopStream();
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
