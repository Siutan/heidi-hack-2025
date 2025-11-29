/**
 * Wake Word Detection Module
 * 
 * This module provides always-on wake word detection using:
 * - Audio capture via SoX
 * - Voice Activity Detection (VAD) to reduce API costs
 * - Google Cloud Speech-to-Text for streaming recognition
 * - Phonetic matching for wake word variations
 * 
 * Usage in main process:
 * ```
 * import { getWakeWordService } from './wake';
 * 
 * const service = getWakeWordService();
 * await service.initialize();
 * 
 * service.on('wakeDetected', ({ transcript, confidence }) => {
 *   console.log('Wake word detected:', transcript);
 * });
 * 
 * service.on('commandCaptured', ({ command }) => {
 *   console.log('Command:', command);
 * });
 * 
 * service.start();
 * ```
 */

export * from './types';
export * from './audioCapture';
export * from './vad';
export * from './googleSpeech';
export * from './wakeWordMatcher';
export * from './wakeWordService';


