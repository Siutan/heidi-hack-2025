/**
 * Audio Capture Service
 * Captures microphone audio in the main process using node-record-lpcm16 (SoX under the hood)
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import record from 'node-record-lpcm16';

export interface AudioCaptureEvents {
  data: (chunk: Buffer) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

type RecorderInstance = {
  stream: () => NodeJS.ReadableStream;
  stop: () => void;
};

export class AudioCapture extends EventEmitter {
  private recorder: RecorderInstance | null = null;
  private audioStream: NodeJS.ReadableStream | null = null;
  private isCapturing = false;
  private sampleRate: number;
  private channels: number;
  private chunkCount = 0;
  private lastLogTime = 0;

  constructor(sampleRate = 16000, channels = 1) {
    super();
    this.sampleRate = sampleRate;
    this.channels = channels;
  }

  /**
   * Start capturing audio from the microphone
   */
  start(): void {
    if (this.isCapturing) {
      console.warn('[AudioCapture] Already capturing');
      return;
    }

    console.log('[AudioCapture] Starting audio capture via node-record-lpcm16...');
    console.log(`[AudioCapture] Sample rate: ${this.sampleRate}, Channels: ${this.channels}`);

    try {
      this.recorder = record.record({
        sampleRateHertz: this.sampleRate,
        threshold: 0,
        thresholdStart: 0,
        thresholdEnd: 0,
        verbose: true,
        recordProgram: 'rec',  // Force using SoX
        silence: '0.0',
        device: 'default',
      }) as RecorderInstance;

      this.audioStream = this.recorder.stream();

      if (!this.audioStream) {
        throw new Error('Audio stream is null');
      }

      this.audioStream.on('data', (chunk: Buffer) => {
        this.chunkCount++;
        const now = Date.now();
        if (now - this.lastLogTime > 3000) {
          console.log(`[AudioCapture] ✓ Received ${this.chunkCount} chunks (~${(this.chunkCount * chunk.length / 1024).toFixed(1)} KB)`);
          this.lastLogTime = now;
          this.chunkCount = 0;
        }
        this.emit('data', chunk);
      });

      this.audioStream.on('error', (error) => {
        console.error('[AudioCapture] Stream error:', error);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });

      this.audioStream.on('end', () => {
        console.log('[AudioCapture] Stream ended');
      });

      this.isCapturing = true;
      this.emit('started');
      console.log('[AudioCapture] ✓ Started capturing audio successfully');

    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    if (!this.isCapturing) {
      return;
    }

    try {
      if (this.audioStream) {
        this.audioStream.removeAllListeners();
        this.audioStream = null;
      }

      if (this.recorder) {
        this.recorder.stop();
        this.recorder = null;
      }

      this.isCapturing = false;
      this.emit('stopped');
      console.log('[AudioCapture] Stopped capturing audio');

    } catch (error) {
      console.error('[AudioCapture] Error stopping:', error);
    }
  }

  /**
   * Check if currently capturing
   */
  get capturing(): boolean {
    return this.isCapturing;
  }
}

/**
 * Check if SoX is installed
 */
export async function checkSoxInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn('which', ['rec']);
    process.on('close', (code) => {
      resolve(code === 0);
    });
    process.on('error', () => {
      resolve(false);
    });
  });
}

