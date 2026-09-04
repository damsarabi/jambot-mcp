// =============================================================================
// src/jamprovise-client.ts — HTTP Client for the Jamprovise API
// =============================================================================
// This module is the bridge between the MCP server and the running Jamprovise
// backend. The MCP server is a separate process (Stdio), so it calls the
// Jamprovise Python FastAPI backend via HTTP — the same endpoint the frontend
// uses. This means the MCP server works with the REAL validation, REAL auth,
// and REAL synthesis engine.
//
// Configuration:
//   JAMPROVISE_API_URL  — The base URL (default: http://localhost:8000)
//   JAMPROVISE_API_KEY  — API key for the backend (use a dev key locally)
// =============================================================================

const BASE_URL = process.env.JAMPROVISE_API_URL ?? 'http://localhost:8000';
const API_KEY  = process.env.JAMPROVISE_API_KEY ?? '';

export interface CommandResult {
  success: boolean;
  intent: string;
  message: string;
  data?: unknown;
}

export interface AppState {
  tempo: number;
  key: string;
  isPlaying: boolean;
  sections: unknown[];
  tracks: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Send a validated command payload to the Jamprovise /mcp/command endpoint.
 * The backend applies the same Pydantic validation as the regular /command
 * endpoint, so Pro-tier gating, rate limiting, and schema enforcement all
 * apply identically.
 */
export async function sendCommand(
  intent: string,
  payload: unknown,
  isPro: boolean = false,
): Promise<CommandResult> {
  const response = await fetch(`${BASE_URL}/mcp/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCP-API-Key': API_KEY,
      'X-MCP-Is-Pro': isPro ? 'true' : 'false',
    },
    body: JSON.stringify({ intent, payload }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jamprovise API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<CommandResult>;
}

/**
 * Read a specific field from the live Jamprovise app state.
 * Returns the value at the dot-notation path, or undefined if not found.
 */
export async function readState(field: string): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/mcp/state?field=${encodeURIComponent(field)}`, {
    headers: { 'X-MCP-API-Key': API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Failed to read state field "${field}": ${response.statusText}`);
  }

  const data = await response.json() as { field: string; value: unknown };
  return data.value;
}

/**
 * Resolve a dot-notation path against a nested object.
 * Used locally when state is passed directly (e.g., in tests or dry-run mode).
 */
export function resolveFieldPath(state: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj === undefined || obj === null) return undefined;
    const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, arrKey, idx] = arrayMatch;
      const arr = (obj as Record<string, unknown[]>)[arrKey];
      return Array.isArray(arr) ? arr[parseInt(idx, 10)] : undefined;
    }
    return (obj as Record<string, unknown>)[key];
  }, state);
}
