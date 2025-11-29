/**
 * Wake Word Matcher
 * Detects wake word variations using fuzzy matching and phonetic similarity
 */

import { DEFAULT_CONFIG } from './types';

export interface WakeWordMatch {
  matched: boolean;
  matchedPhrase: string;
  matchedWakeWord: string;
  confidence: number;
  remainingText: string;
}

export class WakeWordMatcher {
  private wakeWords: string[];
  private threshold: number;

  constructor(
    wakeWords: string[] = DEFAULT_CONFIG.wakeWords,
    threshold: number = DEFAULT_CONFIG.wakeWordThreshold
  ) {
    // Normalize wake words to lowercase
    this.wakeWords = wakeWords.map(w => w.toLowerCase().trim());
    this.threshold = threshold;
  }

  /**
   * Check if the transcript contains a wake word
   */
  match(transcript: string): WakeWordMatch {
    const normalized = transcript.toLowerCase().trim();
    
    // Try exact substring match first
    for (const wakeWord of this.wakeWords) {
      const index = normalized.indexOf(wakeWord);
      if (index !== -1) {
        return {
          matched: true,
          matchedPhrase: wakeWord,
          matchedWakeWord: wakeWord,
          confidence: 1.0,
          remainingText: normalized.substring(index + wakeWord.length).trim(),
        };
      }
    }

    // Try phonetic/fuzzy matching
    const words = this.extractPotentialWakeWords(normalized);
    
    for (const candidate of words) {
      for (const wakeWord of this.wakeWords) {
        const similarity = this.calculateSimilarity(candidate.text, wakeWord);
        
        if (similarity >= this.threshold) {
          return {
            matched: true,
            matchedPhrase: candidate.text,
            matchedWakeWord: wakeWord,
            confidence: similarity,
            remainingText: candidate.remaining,
          };
        }
      }
    }

    return {
      matched: false,
      matchedPhrase: '',
      matchedWakeWord: '',
      confidence: 0,
      remainingText: transcript,
    };
  }

  /**
   * Extract potential wake word candidates from transcript
   * Looks at 2-word combinations that could be the wake word
   */
  private extractPotentialWakeWords(text: string): Array<{ text: string; remaining: string }> {
    const words = text.split(/\s+/);
    const candidates: Array<{ text: string; remaining: string }> = [];

    // Single words (for "heidi", "hedy", etc.)
    for (let i = 0; i < words.length; i++) {
      candidates.push({
        text: words[i],
        remaining: words.slice(i + 1).join(' '),
      });
    }

    // Two-word combinations (for "hi dee", "hey d", etc.)
    for (let i = 0; i < words.length - 1; i++) {
      candidates.push({
        text: `${words[i]} ${words[i + 1]}`,
        remaining: words.slice(i + 2).join(' '),
      });
    }

    return candidates;
  }

  /**
   * Calculate similarity between two strings using multiple methods
   */
  private calculateSimilarity(a: string, b: string): number {
    const levenshteinSim = this.levenshteinSimilarity(a, b);
    const phoneticSim = this.phoneticSimilarity(a, b);
    const soundsSimilar = this.soundsLike(a, b);
    
    // Weight phonetic matching higher for wake words
    const score = (levenshteinSim * 0.3) + (phoneticSim * 0.4) + (soundsSimilar ? 0.3 : 0);
    
    return score;
  }

  /**
   * Levenshtein distance-based similarity
   */
  private levenshteinSimilarity(a: string, b: string): number {
    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1;
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Simple phonetic similarity using Soundex-like approach
   */
  private phoneticSimilarity(a: string, b: string): number {
    const codeA = this.phoneticCode(a);
    const codeB = this.phoneticCode(b);
    
    if (codeA === codeB) return 1;
    
    // Partial match
    const minLen = Math.min(codeA.length, codeB.length);
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
      if (codeA[i] === codeB[i]) matches++;
    }
    
    return matches / Math.max(codeA.length, codeB.length);
  }

  /**
   * Generate a phonetic code for a word (simplified Soundex)
   */
  private phoneticCode(word: string): string {
    if (!word) return '';
    
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return '';

    // Phonetic mapping
    const map: Record<string, string> = {
      'b': '1', 'f': '1', 'p': '1', 'v': '1',
      'c': '2', 'g': '2', 'j': '2', 'k': '2', 'q': '2', 's': '2', 'x': '2', 'z': '2',
      'd': '3', 't': '3',
      'l': '4',
      'm': '5', 'n': '5',
      'r': '6',
    };

    let code = w[0].toUpperCase();
    let lastCode = map[w[0]] || '';

    for (let i = 1; i < w.length; i++) {
      const c = map[w[i]];
      if (c && c !== lastCode) {
        code += c;
        lastCode = c;
      } else if (!c) {
        lastCode = '';
      }
    }

    return code.substring(0, 4).padEnd(4, '0');
  }

  /**
   * Check if two phrases sound similar based on common mishearings
   */
  private soundsLike(a: string, b: string): boolean {
    // Normalize both strings
    const normA = this.normalizePhonetics(a);
    const normB = this.normalizePhonetics(b);
    
    return normA === normB;
  }

  /**
   * Normalize common phonetic variations
   */
  private normalizePhonetics(text: string): string {
    let result = text.toLowerCase().trim();
    
    // Common substitutions for "heidi" / "hi dee" variations
    const substitutions: [RegExp, string][] = [
      // "hi" / "hey" / "hy" are similar
      [/^(hi|hey|hy|high)\s*/i, 'HI'],
      // "dee" / "d" / "di" / "dy" are similar  
      [/\s*(dee|di|dy|d|de|the|thee)$/i, 'DEE'],
      // "heidi" / "hedy" / "hydie" as single word
      [/^(heidi|hedy|hydie|haidee|haydi|heedy|hide|hidey?)$/i, 'HIDEE'],
      // Combined forms
      [/^(hide|heyd|hayd)/i, 'HIDEE'],
    ];

    for (const [pattern, replacement] of substitutions) {
      result = result.replace(pattern, replacement);
    }

    // Remove remaining spaces for comparison
    result = result.replace(/\s+/g, '');
    
    return result;
  }

  /**
   * Add a new wake word variant
   */
  addWakeWord(word: string): void {
    const normalized = word.toLowerCase().trim();
    if (!this.wakeWords.includes(normalized)) {
      this.wakeWords.push(normalized);
    }
  }

  /**
   * Update threshold
   */
  setThreshold(threshold: number): void {
    this.threshold = Math.max(0, Math.min(1, threshold));
  }
}


