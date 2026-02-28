/** Allowlisted commands the bridge can execute */
export const ALLOWED_COMMANDS: Record<string, { cmd: string; args: string[]; description: string }> = {
  test: {
    cmd: 'npm',
    args: ['test'],
    description: 'Run project tests',
  },
  lint: {
    cmd: 'npm',
    args: ['run', 'lint'],
    description: 'Run linter',
  },
  build: {
    cmd: 'npm',
    args: ['run', 'build'],
    description: 'Run project build',
  },
};

export function isAllowed(commandName: string): boolean {
  return commandName in ALLOWED_COMMANDS;
}

export function getCommand(commandName: string) {
  return ALLOWED_COMMANDS[commandName] ?? null;
}
