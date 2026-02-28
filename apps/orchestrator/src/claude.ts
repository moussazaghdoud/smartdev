import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolUseBlock, ToolResultBlockParam, TextBlock } from '@anthropic-ai/sdk/resources/messages.js';
import {
  bridgeReadFile, bridgeSearch, bridgeGitStatus, bridgeGitDiff,
  bridgeRun, bridgePatchPrepare, bridgePatchApply,
} from './bridge-client.js';
import { needsConfirmation } from './confirmation.js';
import { addTranscript } from './session.js';

const client = new Anthropic();

const TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the project',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Relative file path from project root' } },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for text across files in the project',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        root: { type: 'string', description: 'Subdirectory to search in (optional)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'git_status',
    description: 'Get git status (branch, changed files)',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Get git diff (staged and unstaged changes)',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'run_command',
    description: 'Run an allowlisted command (test, lint, or build)',
    input_schema: {
      type: 'object' as const,
      properties: { commandName: { type: 'string', enum: ['test', 'lint', 'build'], description: 'Command to run' } },
      required: ['commandName'],
    },
  },
  {
    name: 'patch_prepare',
    description: 'Prepare a patch (unified diff) for review. Does NOT apply it.',
    input_schema: {
      type: 'object' as const,
      properties: { diff: { type: 'string', description: 'Unified diff content' } },
      required: ['diff'],
    },
  },
  {
    name: 'patch_apply',
    description: 'Apply a previously prepared patch. Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: { patchId: { type: 'string', description: 'ID of the prepared patch' } },
      required: ['patchId'],
    },
  },
];

const SYSTEM_PROMPT = `You are SmartDev, a voice-controlled development assistant. You help developers by reading code, searching files, checking git status, running tests/lint/build, and preparing patches.

You have access to tools that interact with the developer's local workspace through a secure bridge.

RULES:
- Be concise — the developer is using voice, so short answers are better.
- When using tools, explain what you're doing briefly.
- For patch_apply, the system will automatically ask the user for confirmation. Just call the tool normally.
- Never fabricate file contents or command outputs — always use tools to get real data.
- If a command fails, explain the error clearly and suggest fixes.`;

type ToolCallHandler = (input: Record<string, string>) => Promise<unknown>;

const toolHandlers: Record<string, ToolCallHandler> = {
  read_file: (input) => bridgeReadFile(input.path),
  search_code: (input) => bridgeSearch(input.query, input.root),
  git_status: () => bridgeGitStatus(),
  git_diff: () => bridgeGitDiff(),
  run_command: (input) => bridgeRun(input.commandName),
  patch_prepare: (input) => bridgePatchPrepare(input.diff),
  patch_apply: (input) => bridgePatchApply(input.patchId),
};

export interface ConversationTurn {
  type: 'text' | 'confirm';
  content: string;
  confirmData?: {
    toolName: string;
    toolInput: unknown;
    toolUseId: string;
    question: string;
    options: string[];
  };
}

/** Conversation message history */
let conversationHistory: MessageParam[] = [];

export function resetConversation(): void {
  conversationHistory = [];
}

/**
 * Process a user message through Claude, handling tool calls.
 * Returns an async generator of ConversationTurn to allow streaming responses.
 */
export async function* processMessage(userText: string): AsyncGenerator<ConversationTurn> {
  addTranscript('user', userText);
  conversationHistory.push({ role: 'user', content: userText });

  let continueLoop = true;

  while (continueLoop) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: conversationHistory,
    });

    // Collect text blocks
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');

    // Emit any text response
    if (textBlocks.length > 0) {
      const text = textBlocks.map(b => b.text).join('\n');
      if (text.trim()) {
        addTranscript('assistant', text);
        yield { type: 'text', content: text };
      }
    }

    // If stop_reason is end_turn or no tool calls, we're done
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      conversationHistory.push({ role: 'assistant', content: response.content });
      continueLoop = false;
      break;
    }

    // Process tool calls
    conversationHistory.push({ role: 'assistant', content: response.content });

    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // Check if this tool needs confirmation
      if (needsConfirmation(toolUse.name)) {
        yield {
          type: 'confirm',
          content: `Tool "${toolUse.name}" requires your confirmation.`,
          confirmData: {
            toolName: toolUse.name,
            toolInput: toolUse.input,
            toolUseId: toolUse.id,
            question: `Apply patch ${(toolUse.input as Record<string, string>).patchId}?`,
            options: ['Yes, apply it', 'No, cancel', 'Show diff first'],
          },
        };
        // Return — the ws-handler will call resumeAfterConfirmation when the user responds
        return;
      }

      // Execute the tool
      const handler = toolHandlers[toolUse.name];
      if (!handler) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
          is_error: true,
        });
        continue;
      }

      try {
        const result = await handler(toolUse.input as Record<string, string>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: msg }),
          is_error: true,
        });
      }
    }

    // Add tool results and continue the loop
    conversationHistory.push({ role: 'user', content: toolResults });
  }
}

/**
 * Resume conversation after user confirmation.
 */
export async function* resumeAfterConfirmation(
  toolUseId: string,
  toolName: string,
  toolInput: unknown,
  approved: boolean
): AsyncGenerator<ConversationTurn> {
  let toolResult: ToolResultBlockParam;

  if (approved) {
    const handler = toolHandlers[toolName];
    if (handler) {
      try {
        const result = await handler(toolInput as Record<string, string>);
        toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ error: msg }), is_error: true };
      }
    } else {
      toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ error: 'Unknown tool' }), is_error: true };
    }
  } else {
    toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ cancelled: true, message: 'User cancelled the operation' }) };
  }

  conversationHistory.push({ role: 'user', content: [toolResult] });

  // Continue the conversation
  yield* processMessage('');

  // Remove the empty user message we just pushed
  // Actually, processMessage adds its own user message, so let's fix this
}

/**
 * Alternate resume: directly push tool result and get Claude's next response.
 */
export async function* resumeWithToolResult(
  toolUseId: string,
  toolName: string,
  toolInput: unknown,
  approved: boolean
): AsyncGenerator<ConversationTurn> {
  let toolResult: ToolResultBlockParam;

  if (approved) {
    const handler = toolHandlers[toolName];
    if (handler) {
      try {
        const result = await handler(toolInput as Record<string, string>);
        toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ error: msg }), is_error: true };
      }
    } else {
      toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ error: 'Unknown tool' }), is_error: true };
    }
  } else {
    toolResult = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify({ cancelled: true, message: 'User cancelled this operation' }) };
  }

  // Push the tool result into conversation
  conversationHistory.push({ role: 'user', content: [toolResult] });

  // Now get Claude's response to the tool result
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: conversationHistory,
  });

  conversationHistory.push({ role: 'assistant', content: response.content });

  const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
  if (textBlocks.length > 0) {
    const text = textBlocks.map(b => b.text).join('\n');
    if (text.trim()) {
      addTranscript('assistant', text);
      yield { type: 'text', content: text };
    }
  }
}
