/** Confirmation state machine for the orchestrator */

export interface ConfirmationRequest {
  id: string;
  question: string;
  options: string[];
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
}

export interface ConfirmationState {
  pending: ConfirmationRequest | null;
}

export function createConfirmationState(): ConfirmationState {
  return { pending: null };
}

/** Tools that require user confirmation before execution */
const CONFIRM_REQUIRED_TOOLS = new Set(['patch_apply']);

export function needsConfirmation(toolName: string): boolean {
  return CONFIRM_REQUIRED_TOOLS.has(toolName);
}

/** Parse a CONFIRM block from text (for legacy text-based confirmation) */
export function parseConfirmBlock(text: string): ConfirmationRequest | null {
  // Match pattern:
  // CONFIRM:
  // Question: <question>
  // Options:
  // 1) <option1>
  // 2) <option2>
  // ...
  const match = text.match(
    /CONFIRM:\s*\n\s*Question:\s*(.+)\n\s*Options:\s*\n((?:\s*\d+\)\s*.+\n?)+)/
  );

  if (!match) return null;

  const question = match[1].trim();
  const optionsBlock = match[2];
  const options = [...optionsBlock.matchAll(/\d+\)\s*(.+)/g)].map(m => m[1].trim());

  if (options.length === 0) return null;

  return {
    id: Date.now().toString(36),
    question,
    options,
    toolName: '',
    toolInput: null,
    toolUseId: '',
  };
}

/** Resolve a user choice (1-indexed) into the selected option text */
export function resolveChoice(request: ConfirmationRequest, choice: number): string | null {
  if (choice < 1 || choice > request.options.length) return null;
  return request.options[choice - 1];
}
