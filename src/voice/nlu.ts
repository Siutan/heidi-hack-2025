import { IntentCandidate } from './types';

// Mock NLU for now. In a real app, this would call an LLM or a local model.
export async function inferIntent(utterance: string): Promise<IntentCandidate[]> {
  const lower = utterance.toLowerCase();

  if (lower.includes('start recording') || lower.includes('record session')) {
    return [{ tool: 'startRecording', args: {}, confidence: 0.95 }];
  }

  if (lower.includes('stop recording') || lower.includes('end session')) {
    return [{ tool: 'stopRecording', args: {}, confidence: 0.95 }];
  }

  if (lower.includes('details about')) {
    const entity = lower.split('details about')[1].trim();
    return [{ tool: 'showDetails', args: { entity }, confidence: 0.85 }];
  }

  return [];
}
