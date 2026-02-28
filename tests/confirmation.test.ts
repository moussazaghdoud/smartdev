import { describe, it } from 'node:test';
import assert from 'node:assert';

// Inline the parser since we can't easily import ESM from test runner without build
function parseConfirmBlock(text: string) {
  const match = text.match(
    /CONFIRM:\s*\n\s*Question:\s*(.+)\n\s*Options:\s*\n((?:\s*\d+\)\s*.+\n?)+)/
  );
  if (!match) return null;
  const question = match[1].trim();
  const optionsBlock = match[2];
  const options = [...optionsBlock.matchAll(/\d+\)\s*(.+)/g)].map(m => m[1].trim());
  if (options.length === 0) return null;
  return { question, options };
}

describe('parseConfirmBlock', () => {
  it('should parse a valid CONFIRM block', () => {
    const text = `CONFIRM:
Question: Apply patch abc123?
Options:
1) Yes, apply it
2) No, cancel
3) Show diff first
Reply with: 1 / 2 / 3`;

    const result = parseConfirmBlock(text);
    assert.ok(result);
    assert.strictEqual(result.question, 'Apply patch abc123?');
    assert.deepStrictEqual(result.options, ['Yes, apply it', 'No, cancel', 'Show diff first']);
  });

  it('should parse a 2-option CONFIRM block', () => {
    const text = `CONFIRM:
Question: Delete file main.ts?
Options:
1) Yes
2) No`;

    const result = parseConfirmBlock(text);
    assert.ok(result);
    assert.strictEqual(result.question, 'Delete file main.ts?');
    assert.deepStrictEqual(result.options, ['Yes', 'No']);
  });

  it('should return null for non-CONFIRM text', () => {
    const result = parseConfirmBlock('This is just normal text');
    assert.strictEqual(result, null);
  });

  it('should return null for malformed CONFIRM block', () => {
    const text = `CONFIRM:
Question: Missing options section`;
    const result = parseConfirmBlock(text);
    assert.strictEqual(result, null);
  });

  it('should handle CONFIRM block embedded in other text', () => {
    const text = `I found the issue. Let me prepare the fix.

CONFIRM:
Question: Apply the fix to utils.ts?
Options:
1) Apply (recommended)
2) Cancel

Please choose.`;

    const result = parseConfirmBlock(text);
    assert.ok(result);
    assert.strictEqual(result.question, 'Apply the fix to utils.ts?');
    assert.deepStrictEqual(result.options, ['Apply (recommended)', 'Cancel']);
  });
});
