import { IntentCandidate, ExecContext, PolicyDecision } from './types';
import { tools } from './tools';

export function decide(c: IntentCandidate, ctx: ExecContext): PolicyDecision {
  const tool = tools.find((t) => t.name === c.tool);

  if (!tool) return { allow: false, reason: 'UnknownTool' };

  if (!tool.preconditions(ctx)) return { allow: false, reason: 'PreconditionFailed' };

  // Confidence gates
  const min =
    tool.safetyLevel === 'safe'
      ? 0.6
      : tool.safetyLevel === 'guarded'
        ? 0.75
        : 0.9;

  if (c.confidence < min) return { allow: false, reason: 'LowConfidence' };

  // Confirmation rules
  const needsConfirm = tool.safetyLevel !== 'safe' || ctx.userPref.alwaysConfirm;

  return { allow: true, needsConfirm };
}
