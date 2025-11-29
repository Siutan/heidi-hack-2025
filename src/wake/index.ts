/**
 * Wake Word Detection Module
 * 
 * This module provides:
 * - Wake word detection ("Hi Dee") using Google Speech-to-Text
 * - Real-time conversation using Gemini Live API after wake word
 * - Audio capture via SoX
 * - Voice Activity Detection (VAD) to reduce API costs
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
 * service.on('geminiResponse', ({ text }) => {
 *   console.log('Gemini says:', text);
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
export * from './geminiLive';
export * from './wakeWordService';


