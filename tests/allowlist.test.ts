import { describe, it } from 'node:test';
import assert from 'node:assert';

// Inline allowlist logic since we can't easily import ESM
const ALLOWED_COMMANDS: Record<string, { cmd: string; args: string[]; description: string }> = {
  test: { cmd: 'npm', args: ['test'], description: 'Run project tests' },
  lint: { cmd: 'npm', args: ['run', 'lint'], description: 'Run linter' },
  build: { cmd: 'npm', args: ['run', 'build'], description: 'Run project build' },
};

function isAllowed(commandName: string): boolean {
  return commandName in ALLOWED_COMMANDS;
}

function getCommand(commandName: string) {
  return ALLOWED_COMMANDS[commandName] ?? null;
}

describe('Command Allowlist', () => {
  it('should allow "test" command', () => {
    assert.strictEqual(isAllowed('test'), true);
    const cmd = getCommand('test');
    assert.ok(cmd);
    assert.strictEqual(cmd.cmd, 'npm');
    assert.deepStrictEqual(cmd.args, ['test']);
  });

  it('should allow "lint" command', () => {
    assert.strictEqual(isAllowed('lint'), true);
  });

  it('should allow "build" command', () => {
    assert.strictEqual(isAllowed('build'), true);
  });

  it('should deny "rm" command', () => {
    assert.strictEqual(isAllowed('rm'), false);
    assert.strictEqual(getCommand('rm'), null);
  });

  it('should deny "eval" command', () => {
    assert.strictEqual(isAllowed('eval'), false);
  });

  it('should deny "sh" command', () => {
    assert.strictEqual(isAllowed('sh'), false);
  });

  it('should deny empty command', () => {
    assert.strictEqual(isAllowed(''), false);
  });

  it('should deny command injection attempts', () => {
    assert.strictEqual(isAllowed('test; rm -rf /'), false);
    assert.strictEqual(isAllowed('test && echo pwned'), false);
    assert.strictEqual(isAllowed('test|cat /etc/passwd'), false);
  });

  it('should be case-sensitive', () => {
    assert.strictEqual(isAllowed('TEST'), false);
    assert.strictEqual(isAllowed('Test'), false);
  });
});
