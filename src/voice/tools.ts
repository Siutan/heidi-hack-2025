import { Tool } from './types';

export const tools: Tool[] = [
  {
    name: 'startRecording',
    description: 'Start microphone capture',
    inputSchema: {},
    safetyLevel: 'guarded',
    preconditions: (ctx) => !ctx.isRecording,
    execute: async (_, ctx) => {
      await ctx.recorder.start();
      return { ok: true };
    },
  },
  {
    name: 'stopRecording',
    description: 'Stop microphone capture',
    inputSchema: {},
    safetyLevel: 'safe',
    preconditions: (ctx) => ctx.isRecording,
    execute: async (_, ctx) => {
      await ctx.recorder.stop();
      return { ok: true };
    },
  },
  {
    name: 'showDetails',
    description: 'Display details for an entity',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' } },
      required: ['entity'],
    },
    safetyLevel: 'safe',
    preconditions: (ctx) => true,
    execute: async (input, ctx) => {
      ctx.ui.showDetails(input.entity);
      return { ok: true };
    },
  },
];
