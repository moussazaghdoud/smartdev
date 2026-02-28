/** HTTP client to communicate with the local bridge */

const BRIDGE_URL = () => `http://127.0.0.1:${process.env.BRIDGE_PORT || '7700'}`;
const BRIDGE_TOKEN = () => process.env.BRIDGE_TOKEN || '';

async function bridgeRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${BRIDGE_URL()}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${BRIDGE_TOKEN()}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Bridge returned ${res.status}`);
  }
  return data;
}

export async function bridgeHealth(): Promise<unknown> {
  // Health doesn't need auth
  const res = await fetch(`${BRIDGE_URL()}/health`);
  return res.json();
}

export async function bridgeReadFile(filePath: string): Promise<unknown> {
  return bridgeRequest('POST', '/readFile', { path: filePath });
}

export async function bridgeSearch(query: string, root?: string): Promise<unknown> {
  return bridgeRequest('POST', '/search', { query, root });
}

export async function bridgeGitStatus(): Promise<unknown> {
  return bridgeRequest('GET', '/git/status');
}

export async function bridgeGitDiff(): Promise<unknown> {
  return bridgeRequest('GET', '/git/diff');
}

export async function bridgeRun(commandName: string): Promise<unknown> {
  return bridgeRequest('POST', '/run', { commandName });
}

export async function bridgePatchPrepare(diff: string): Promise<unknown> {
  return bridgeRequest('POST', '/patch/prepare', { diff });
}

export async function bridgePatchApply(patchId: string): Promise<unknown> {
  return bridgeRequest('POST', '/patch/apply', { patchId });
}
