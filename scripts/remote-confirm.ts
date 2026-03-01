#!/usr/bin/env npx tsx
/**
 * Remote Confirmation Script
 *
 * Sends a confirmation request to the voice client via the orchestrator.
 * Used by Claude Code to ask the user for approval on their phone.
 *
 * Usage:
 *   npx tsx scripts/remote-confirm.ts "Apply patch to main.ts?" "Yes, apply" "No, cancel"
 *   npx tsx scripts/remote-confirm.ts "Delete these 5 files?" "Yes" "No" "Show files first"
 */

import 'dotenv/config';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'https://smartdevorchestrator-production.up.railway.app';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: remote-confirm.ts "question" "option1" "option2" ["option3"]');
    process.exit(1);
  }

  const question = args[0];
  const options = args.slice(1);

  console.log(`[remote-confirm] Sending to voice client: "${question}"`);
  console.log(`[remote-confirm] Options: ${options.map((o, i) => `${i + 1}) ${o}`).join(', ')}`);
  console.log(`[remote-confirm] Waiting for response from your phone...`);

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({ question, options }),
    });

    const data = await res.json() as { choice?: number; option?: string; error?: string };

    if (!res.ok) {
      console.error(`[remote-confirm] Error: ${data.error}`);
      process.exit(1);
    }

    console.log(`[remote-confirm] User chose: ${data.choice}) ${data.option}`);
    // Output just the choice number for scripting
    process.stdout.write(`\nRESULT:${data.choice}\n`);
  } catch (err) {
    console.error(`[remote-confirm] Failed:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
