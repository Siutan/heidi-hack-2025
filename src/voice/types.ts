export type ToolResult = {
  ok: boolean;
  data?: any;
  error?: string;
};

export type ExecContext = {
  isRecording: boolean;
  recorder: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  };
  ui: {
    showDetails: (entity: string) => void;
  };
  userPref: {
    alwaysConfirm: boolean;
  };
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, any>; // JSON Schema
  safetyLevel: 'safe' | 'guarded' | 'dangerous';
  preconditions: (ctx: ExecContext) => boolean;
  execute: (input: any, ctx: ExecContext) => Promise<ToolResult>;
};

export type IntentCandidate = {
  tool: string;
  args: any;
  confidence: number;
  rationale?: string;
};

export type PolicyDecision = {
  allow: boolean;
  reason?: string;
  needsConfirm?: boolean;
};
