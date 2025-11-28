Design a gated voice pipeline: wake-word → transcribe → intent+tool selection → policy-checked action execution with confirmations and audit.

Architecture that won’t burn you

You need four hard separations: detection, understanding, decision, execution. Anything else leaks risk.

- Wake Word Gate: Always-on, low-power keyword spotter for “hi dee”. After trigger, open a short interaction window. Use VAD to auto-close.

- ASR + NLU: Transcribe, parse intent, extract entities, and map to tool candidates. Keep prompts stateless and bounded.

- Policy + Orchestration: Decide whether an action is allowed, whether to require confirmation, and how to sequence multi-step plans.

- Action Executor: Strict tool interface (MCP-like), sandboxed, with timeouts, rate limits, and structured results back to the user.

Minimal state machine// states: Idle -> Listening -> Interpreting -> PendingConfirmation -> Executing -> Reporting -> Idle

// events: WakeWord, SilenceTimeout, IntentParsed, NeedsConfirm, ConfirmYes/No, ExecDone, ExecError

Wake phrase detection (robust, low-latency)

- Use a keyword spotting (KWS) model (Porcupine, Vosk KWS, Riva KWS; Snowboy is deprecated). Don’t use a general ASR for wake phrase; it’s wasteful and noisy.

- Pipeline:

 ▫ VAD: gate audio chunks.

 ▫ KWS on gated frames: if “hi dee” confidence > threshold T, transition to Listening.

 ▫ Debounce: require 2–3 consecutive high scores; lockout for N seconds after trigger.

- Personalization: capture 20–30 user utterances to train a custom “dee” variant to reduce false positives.

Intent → Tool/action selection (MCP style)

Define a tool registry with strict schemas, preconditions, and safety levels.// tools.ts

export type Tool = {

  name: string;

  description: string;

  inputSchema: Record<string, any>; // JSON Schema

  safetyLevel: 'safe' | 'guarded' | 'dangerous';

  preconditions: (ctx: ExecContext) => boolean;

  execute: (input: any, ctx: ExecContext) => Promise<ToolResult>;

};

export const tools: Tool[] = [

  {

    name: 'startRecording',

    description: 'Start microphone capture',

    inputSchema: {},

    safetyLevel: 'guarded',

    preconditions: ctx => !ctx.isRecording,

    execute: async (_, ctx) => { await ctx.recorder.start(); return {ok:true}; }

  },

  {

    name: 'stopRecording',

    description: 'Stop microphone capture',

    inputSchema: {},

    safetyLevel: 'safe',

    preconditions: ctx => ctx.isRecording,

    execute: async (_, ctx) => { await ctx.recorder.stop(); return {ok:true}; }

  },

  {

    name: 'showDetails',

    description: 'Display details for an entity',

    inputSchema: { type:'object', properties:{ entity:{type:'string'} }, required:['entity'] },

    safetyLevel: 'safe',

    preconditions: ctx => true,

    execute: async (input, ctx) => ctx.ui.showDetails(input.entity)

  }

];

Map text → intent with a constrained prompt or a local classifier:// nlu.ts

type IntentCandidate = { tool: string; args: any; confidence: number; rationale?: string };

export async function inferIntent(utterance: string, context: any): Promise<IntentCandidate[]> {

  // Option A: small local classifier (few-shot + rules)

  // Option B: LLM with strict JSON output schema and tool names from registry

  const candidates = [

    // e.g., "start recording" → {tool:'startRecording', args:{}, confidence:0.84}

  ];

  return rankAndFilter(candidates);

}

Decision policy (never let the model free-drive)

Put a policy layer between NLU and execution. Reject or confirm based on confidence, safety level, and preconditions.// policy.ts

export function decide(c: IntentCandidate, ctx: ExecContext) {

  const tool = tools.find(t => t.name === c.tool);

  if (!tool) return {allow:false, reason:'UnknownTool'};

  if (!tool.preconditions(ctx)) return {allow:false, reason:'PreconditionFailed'};

  // Confidence gates

  const min = tool.safetyLevel === 'safe' ? 0.60

            : tool.safetyLevel === 'guarded' ? 0.75

            : 0.90;

  if (c.confidence < min) return {allow:false, reason:'LowConfidence'};

  // Confirmation rules

  const needsConfirm = tool.safetyLevel !== 'safe' || ctx.userPref.alwaysConfirm;

  return {allow:true, needsConfirm};

}

Execution and reporting (deterministic, auditable)

- Enforce timeouts, rate limits, idempotency where relevant.

- Always return structured output and a human-readable summary.

- Log everything: audio hash, transcription, intent JSON, policy decision, tool inputs/outputs.

// executor.ts

export async function runDecision(c: IntentCandidate, ctx: ExecContext) {

  const tool = getTool(c.tool);

  const input = validate(tool.inputSchema, c.args); // throw on invalid

  const result = await withTimeout(() => tool.execute(input, ctx), 5000);

  return { tool: tool.name, input, result };

}

Voice UX details that prevent pain

- Auto close listening on silence, barge-in, or end-of-sentence (ASR punctuation or intonation).

- Short interaction window (e.g., 6–8 seconds). If user continues, explicitly say “continue?” or keep open if VAD stays hot.

- Confirmations are single-turn and crisp: “Start recording now?” Expect “yes/no”. On “yes”, execute. On “no”, explain what would have happened, then return to Idle.

- Fallbacks: If confidence is borderline or entity is ambiguous, ask one targeted question, not open Q&A.

Safety: non-negotiables

- Prompt injection hardening: Never pass user text directly into tool parameters without validation. Strip URLs, run allowlists for command-like inputs.

- Tool sandbox: Separate process, minimal permissions. Dangerous tools (filesystem, network) behind explicit confirmations and scopes.

- Context isolation: Never let web content or transcripts modify policy or registry. Tools are static; only inputs vary.

- Privacy: Encrypt audio buffers at rest. Redact PII in logs or hash transcripts. Provide a per-user kill switch to disable always-on wake detection.

- Destructive actions require double gates: high confidence + explicit “yes”.

Practical latencies and budgets

- KWS should respond sub-100 ms on-device CPU. If not, you picked the wrong model or framing.

- VAD frame size 20–30 ms; ASR streaming yields interim results within 200–400 ms.

- End-to-end “hi dee” → action start under 800 ms is achievable on modern phones/desktops.

Example end-to-end SvelteKit + Node

Front-end audio loop with wake gating:// frontend/audio.ts

const audioCtx = new AudioContext();

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

const source = audioCtx.createMediaStreamSource(stream);

const processor = audioCtx.createScriptProcessor(2048, 1, 1);

source.connect(processor);

processor.connect(audioCtx.destination);

let listening = false;

processor.onaudioprocess = (e) => {

  const samples = e.inputBuffer.getChannelData(0);

  const vad = isSpeech(samples);

  const kwsScore = keywordScore(samples); // your KWS model

  if (!listening && kwsScore > 0.85 && vad) {

    listening = true;

    startASRStream();

  } else if (listening) {

    feedASR(samples);

    if (!vad) maybeCloseWindow();

  }

};

Server orchestration:// server/route.ts

import { inferIntent } from './nlu';

import { decide } from './policy';

import { runDecision } from './executor';

export async function handleUtterance(req) {

  const { transcript, context } = await req.json();

  const intents = await inferIntent(transcript, context);

  const top = intents[0];

  const decision = decide(top, context);

  log({ transcript, intents, decision });

  if (!decision.allow) {

    return json({ status:'rejected', reason: decision.reason });

  }

  if (decision.needsConfirm) {

    return json({ status:'confirm', prompt:`${top.tool}?`, args: top.args });

  }

  const exec = await runDecision(top, context);

  return json({ status:'executed', ...exec });

}

Confirmation route:// server/confirm.ts

export async function confirm(req) {

  const { intent, yes } = await req.json();

  if (!yes) return json({ status:'cancelled' });

  const exec = await runDecision(intent, /*ctx*/);

  return json({ status:'executed', ...exec });

}

MCP alignment (without overcomplicating)

- Treat each action as an MCP tool with schema + description.

- The assistant selects a tool with structured arguments; the server enforces policy and runs it.

- Keep registry human-auditable. Changes go through code review, not prompts.

Testing strategy that catches real issues

- Unit tests: KWS thresholds, VAD edge cases, policy gates.

- Adversarial: Test misheard phrases (“ID, D”, “high D”) near wake phrase; ensure no triggers.

- Confidence calibration: Build a dataset of 200–500 utterances; plot ROC; pick thresholds by target false positive rate in your environment.

- End-to-end: Latency budgets per stage; assert p95 < 800 ms.

When not to auto-execute

- Any tool that changes system state beyond your app UI (filesystem, camera, payments).

- Requests with multiple entities when only one is expected.

- Low-context commands (“do it”, “that one”) unless immediately preceded by a disambiguated referent.

You’ll ship faster if you keep the LLM dumb (intent ranking only) and the policy + executor smart (deterministic, small, tested). If you let the model decide execution, you will eventually ship a bug as an incident.