/**
 * Voice Activity Detection (VAD)
 * Simple energy-based VAD to detect when someone is speaking
 * This helps reduce API costs by only streaming when speech is detected
 */

import { EventEmitter } from 'events';

export interface VADConfig {
  // Energy threshold for speech detection (0-1)
  energyThreshold: number;
  // Number of consecutive frames above threshold to trigger speech start
  speechStartFrames: number;
  // Number of consecutive frames below threshold to trigger speech end
  speechEndFrames: number;
  // Frame size in samples
  frameSize: number;
  // Sample rate
  sampleRate: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 0.02,
  speechStartFrames: 3,
  speechEndFrames: 15,  // ~240ms at 16kHz with 256 sample frames
  frameSize: 256,
  sampleRate: 16000,
};

export type VADState = 'silence' | 'speech';

export class VAD extends EventEmitter {
  private config: VADConfig;
  private state: VADState = 'silence';
  private buffer: Buffer = Buffer.alloc(0);
  private consecutiveFrames = 0;

  constructor(config: Partial<VADConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  /**
   * Process an audio chunk and detect voice activity
   */
  process(chunk: Buffer): void {
    // Append to buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Process complete frames
    const bytesPerFrame = this.config.frameSize * 2; // 16-bit = 2 bytes per sample
    
    while (this.buffer.length >= bytesPerFrame) {
      const frame = this.buffer.subarray(0, bytesPerFrame);
      this.buffer = this.buffer.subarray(bytesPerFrame);
      
      const energy = this.calculateEnergy(frame);
      const isSpeech = energy > this.config.energyThreshold;
      
      this.updateState(isSpeech, chunk);
    }
  }

  private lastEnergyLogTime = 0;
  private maxEnergySeen = 0;

  /**
   * Calculate RMS energy of a frame
   */
  private calculateEnergy(frame: Buffer): number {
    let sum = 0;
    const samples = frame.length / 2;
    
    for (let i = 0; i < frame.length; i += 2) {
      // Read 16-bit signed integer (little-endian)
      const sample = frame.readInt16LE(i);
      // Normalize to -1 to 1
      const normalized = sample / 32768;
      sum += normalized * normalized;
    }
    
    const energy = Math.sqrt(sum / samples);
    
    // Track max energy and log periodically
    if (energy > this.maxEnergySeen) {
      this.maxEnergySeen = energy;
    }
    
    const now = Date.now();
    if (now - this.lastEnergyLogTime > 3000) {
      console.log(`[VAD] Energy: ${energy.toFixed(4)} (max seen: ${this.maxEnergySeen.toFixed(4)}, threshold: ${this.config.energyThreshold})`);
      this.lastEnergyLogTime = now;
    }
    
    return energy;
  }

  /**
   * Update VAD state based on frame analysis
   */
  private updateState(isSpeech: boolean, chunk: Buffer): void {
    if (this.state === 'silence') {
      if (isSpeech) {
        this.consecutiveFrames++;
        if (this.consecutiveFrames >= this.config.speechStartFrames) {
          this.state = 'speech';
          this.consecutiveFrames = 0;
          console.log('[VAD] 🎤 Speech STARTED');
          this.emit('speechStart');
          this.emit('speech', chunk);
        }
      } else {
        this.consecutiveFrames = 0;
      }
    } else {
      // In speech state
      this.emit('speech', chunk);
      
      if (!isSpeech) {
        this.consecutiveFrames++;
        if (this.consecutiveFrames >= this.config.speechEndFrames) {
          this.state = 'silence';
          this.consecutiveFrames = 0;
          console.log('[VAD] 🔇 Speech ENDED');
          this.emit('speechEnd');
        }
      } else {
        this.consecutiveFrames = 0;
      }
    }
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    this.state = 'silence';
    this.buffer = Buffer.alloc(0);
    this.consecutiveFrames = 0;
  }

  /**
   * Get current state
   */
  getState(): VADState {
    return this.state;
  }
}

