// ============================================================
// Dental Agent — Tool-calling provider adapters.
//
// Dedicated tool-calling wrappers for OpenAI and Anthropic.
// Reuses error handling, usage normalization, and network
// utilities from the existing AI layer (src/lib/ai/providers/shared.ts).
//
// Built separately from the generic AI layer to avoid changing
// the blast radius of the existing text-in/text-out auto-reply
// (see Phase 0 design doc for the trade-off analysis).
// ============================================================

import { AiError } from '@/lib/ai/types';
import {
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  mergeConsecutive,
} from '@/lib/ai/providers/shared';
import { MAX_OUTPUT_TOKENS } from '@/lib/ai/defaults';
import type {
  ToolCallingArgs,
  ToolCallingResult,
  ToolCallingMessage,
  ToolCall,
  ToolDefinition,
} from './types';

// -------------------------------------------------------
// OpenAI tool-calling
// -------------------------------------------------------

const OPENAI_URL =
  process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1/chat/completions';

interface OpenAiToolCallResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function toOpenAiMessages(
  messages: ToolCallingMessage[],
): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content ?? '',
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}

function toOpenAiTools(
  tools: ToolDefinition[],
): Array<{ type: 'function'; function: ToolDefinition }> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: t,
  }));
}

export async function generateWithToolsOpenAi(
  args: ToolCallingArgs,
): Promise<ToolCallingResult> {
  const { apiKey, model, messages, tools, timeoutMs } = args;

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(messages),
        tools: toOpenAiTools(tools),
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw toNetworkError(err);
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res);
  }

  const data = (await res.json().catch(() => null)) as OpenAiToolCallResponse | null;
  const choice = data?.choices?.[0];
  const message = choice?.message;

  if (!message) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    });
  }

  const text = message.content?.trim() ?? '';
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeParseJson(tc.function.arguments),
  }));

  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  });

  const done = toolCalls.length === 0;

  return { text, toolCalls, usage, done };
}

// -------------------------------------------------------
// Anthropic tool-calling
// -------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicToolCallResponse {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function toAnthropicMessages(
  messages: ToolCallingMessage[],
): { system: string; messages: Array<Record<string, unknown>> } {
  // Extract system message
  const systemMsg = messages.find((m) => m.role === 'system');
  const system = systemMsg?.content ?? '';

  // Build conversation messages (skip system)
  const conversationMsgs = messages.filter((m) => m.role !== 'system');
  const result: Array<Record<string, unknown>> = [];

  for (const m of conversationMsgs) {
    if (m.role === 'tool') {
      // Anthropic represents tool results as user messages with tool_result content blocks
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content ?? '',
          },
        ],
      });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      // Assistant with tool calls → content blocks
      const content: Array<Record<string, unknown>> = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      result.push({ role: 'assistant', content });
    } else {
      result.push({ role: m.role, content: m.content ?? '' });
    }
  }

  // Anthropic requires alternating roles starting with user.
  // Merge consecutive same-role messages.
  const merged: Array<Record<string, unknown>> = [];
  for (const msg of result) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role && typeof msg.content === 'string' && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      merged.push(msg);
    }
  }

  // Drop leading assistant messages
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift();
  }

  // Ensure we have at least one user message
  if (merged.length === 0) {
    merged.push({ role: 'user', content: '(The customer has not sent a message yet.)' });
  }

  return { system, messages: merged };
}

function toAnthropicTools(
  tools: ToolDefinition[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export async function generateWithToolsAnthropic(
  args: ToolCallingArgs,
): Promise<ToolCallingResult> {
  const { apiKey, model, messages, tools, timeoutMs } = args;
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: anthropicMsgs,
        tools: toAnthropicTools(tools),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw toNetworkError(err);
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res);
  }

  const data = (await res.json().catch(() => null)) as AnthropicToolCallResponse | null;
  if (!data?.content || data.content.length === 0) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    });
  }

  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of data.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input,
      });
    }
  }

  text = text.trim();

  const usage = normalizeUsage({
    prompt: data?.usage?.input_tokens,
    completion: data?.usage?.output_tokens,
  });

  const done = toolCalls.length === 0 && data.stop_reason !== 'tool_use';

  return { text, toolCalls, usage, done };
}

// -------------------------------------------------------
// Dispatcher — picks the right provider
// -------------------------------------------------------

export async function generateWithTools(
  provider: 'openai' | 'anthropic',
  args: ToolCallingArgs,
): Promise<ToolCallingResult> {
  switch (provider) {
    case 'openai':
      return generateWithToolsOpenAi(args);
    case 'anthropic':
      return generateWithToolsAnthropic(args);
    default:
      throw new AiError(`Unsupported AI provider for tool-calling: ${provider}`, {
        code: 'unsupported_provider',
        status: 400,
      });
  }
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/** Safely parse a JSON string, returning an empty object on failure. */
function safeParseJson(jsonStr: string): Record<string, unknown> {
  try {
    return JSON.parse(jsonStr);
  } catch {
    console.error('[dental agent] failed to parse tool call arguments:', jsonStr);
    return {};
  }
}
