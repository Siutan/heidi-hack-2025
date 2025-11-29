import { IntentCandidate, ExecContext, ToolResult } from './types';
import { tools } from './tools';

export async function runDecision(c: IntentCandidate, ctx: ExecContext): Promise<{ tool: string; input: any; result: ToolResult }> {
  const tool = tools.find((t) => t.name === c.tool);
  if (!tool) throw new Error(`Tool ${c.tool} not found`);

  // Basic validation (in a real app, use a JSON schema validator like Ajv)
  const input = c.args;

  // Timeout wrapper
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
    ]);
  };

  try {
    const result = await withTimeout(tool.execute(input, ctx), 5000);
    return { tool: tool.name, input, result };
  } catch (error) {
    return { tool: tool.name, input, result: { ok: false, error: String(error) } };
  }
}
