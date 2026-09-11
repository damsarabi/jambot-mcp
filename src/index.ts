#!/usr/bin/env node
// =============================================================================
// src/index.ts — Jambot MCP Server (Stdio transport)
// =============================================================================
// This is the entry point for the MCP server. It registers all tools and
// resources, then connects to Claude Desktop via the Stdio transport.
//
// Tools (state-mutating actions Claude can invoke):
//   • play_sequence      — Generate and play a new chord sequence
//   • modify_transport   — Change tempo, key, or toggle drone mode
//   • query_state        — Read a specific field from the live app state
//
// Resources (read-only data Claude can reference):
//   • jamprovise://styles       — Available music style presets
//   • jamprovise://instruments  — Available instruments per track
//   • jamprovise://schema       — Full intent schema reference
//
// Usage (Claude Desktop config):
//   {
//     "mcpServers": {
//       "jambot": {
//         "command": "node",
//         "args": ["/path/to/jambot-mcp/dist/index.js"],
//         "env": {
//           "JAMPROVISE_API_URL": "http://localhost:8000",
//           "JAMPROVISE_API_KEY": "your-dev-key"
//         }
//       }
//     }
//   }
// =============================================================================

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

import {
  PlaySequenceInputSchema,
  ModifyTransportInputSchema,
  QueryStateInputSchema,
  GetInstrumentsInputSchema,
  AVAILABLE_STYLES,
  INSTRUMENTS_BY_TRACK,
  MAX_GLOBAL_BARS,
  mapTrackAlias,
} from './schemas.js';

import { sendCommand, readState } from './jamprovise-client.js';

// ---------------------------------------------------------------------------
// Server initialisation
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'jambot-mcp',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// TOOL: play_sequence
// ---------------------------------------------------------------------------
// The primary creative tool. Constructs a PLAY_NEW_SEQUENCE command from
// structured Zod-validated input and dispatches it to Jamprovise.
//
// The key insight: instead of Claude generating free-form JSON (which can
// hallucinate field names, wrong types, or invalid chord qualities), the
// MCP server's inputSchema enforces the contract BEFORE the command is sent.
// Invalid input throws a Zod error that Claude sees and can self-correct.
// ---------------------------------------------------------------------------

server.registerTool(
  'play_sequence',
  {
    description:
      'Generate and play a new chord sequence in Jamprovise. ' +
      'Provide a key, tempo, and at least one section with a chord progression. ' +
      `Maximum total bars across all sections: ${MAX_GLOBAL_BARS}.`,
    inputSchema: PlaySequenceInputSchema,
  },
  async (input) => {
    // Validate total bar count across all sections
    const totalBars = input.sections.flatMap(s => s.progression).reduce(
      (sum, chord) => sum + chord.durationInBars, 0
    );

    if (totalBars > MAX_GLOBAL_BARS) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: Total bars (${totalBars}) exceeds maximum of ${MAX_GLOBAL_BARS}. ` +
                `Reduce chord durations or remove sections.`,
        }],
        isError: true,
      };
    }

    const result = await sendCommand('PLAY_NEW_SEQUENCE', input);

    return {
      content: [{
        type: 'text' as const,
        text: result.success
          ? `✅ Playing sequence: ${result.message}\n\nKey: ${input.key} | Tempo: ${input.tempo} BPM | ` +
            `${input.sections.length} section(s) | ${totalBars} bars total`
          : `❌ Command failed: ${result.message}`,
      }],
      isError: !result.success,
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: modify_transport
// ---------------------------------------------------------------------------

server.registerTool(
  'modify_transport',
  {
    description:
      'Modify the global transport settings: tempo, key, drone mode, or playback state. ' +
      'Note: drone mode requires a Pro subscription.',
    inputSchema: ModifyTransportInputSchema,
  },
  async (input) => {
    // Drone mode gate: warn early rather than letting the backend reject
    if (input.droneMode?.isOn) {
      const isPro = process.env.JAMPROVISE_IS_PRO === 'true';
      if (!isPro) {
        return {
          content: [{
            type: 'text' as const,
            text: '⚠️ Drone mode requires a Jamprovise Pro subscription. ' +
                  'Set JAMPROVISE_IS_PRO=true in your MCP config if you have Pro.',
          }],
          isError: true,
        };
      }
    }

    const result = await sendCommand('MODIFY_TRANSPORT', input);
    const changes = Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');

    return {
      content: [{
        type: 'text' as const,
        text: result.success
          ? `✅ Transport updated: ${changes}`
          : `❌ Transport update failed: ${result.message}`,
      }],
      isError: !result.success,
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: query_state
// ---------------------------------------------------------------------------

server.registerTool(
  'query_state',
  {
    description:
      'Read a specific field from the live Jamprovise app state using dot-notation. ' +
      'Examples: "tempo", "key", "isPlaying", "sections[0].progression[0].root", ' +
      '"tracks.harmony.instrument"',
    inputSchema: QueryStateInputSchema,
  },
  async ({ field }) => {
    const value = await readState(field);
    return {
      content: [{
        type: 'text' as const,
        text: value !== undefined
          ? `${field}: ${JSON.stringify(value, null, 2)}`
          : `Field "${field}" not found in app state.`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: get_available_instruments
// ---------------------------------------------------------------------------

server.registerTool(
  'get_available_instruments',
  {
    description: 'List available instruments for a specific track (harmony, bass, percussion).',
    inputSchema: GetInstrumentsInputSchema,
  },
  async ({ track }) => {
    const canonicalTrack = mapTrackAlias(track);
    const instruments = INSTRUMENTS_BY_TRACK[canonicalTrack];

    if (!instruments) {
      return {
        content: [{
          type: 'text' as const,
          text: `Unknown track: "${track}". Valid tracks: harmony, bass, percussion.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Available instruments for ${canonicalTrack}:\n` +
              instruments.map(i => `  • ${i}`).join('\n'),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// RESOURCE: jamprovise://styles
// ---------------------------------------------------------------------------
// Resources are read-only data that Claude can fetch for context.
// The styles resource lets Claude understand what style presets are valid
// before constructing a play_sequence tool call.
// ---------------------------------------------------------------------------

server.registerResource(
  'jamprovise-styles',
  'jamprovise://styles',
  {
    title: 'Available Music Styles',
    description:
      'List of all available music style presets. Use these IDs in the `style` field ' +
      'of play_sequence to apply a genre feel to the generated sequence.',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(AVAILABLE_STYLES, null, 2),
    }],
  })
);

// ---------------------------------------------------------------------------
// RESOURCE: jamprovise://instruments
// ---------------------------------------------------------------------------

server.registerResource(
  'jamprovise-instruments',
  'jamprovise://instruments',
  {
    title: 'Available Instruments',
    description: 'Full instrument manifest organized by track (harmony, bass, percussion).',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(INSTRUMENTS_BY_TRACK, null, 2),
    }],
  })
);

// ---------------------------------------------------------------------------
// RESOURCE: jamprovise://schema
// ---------------------------------------------------------------------------

server.registerResource(
  'jamprovise-schema',
  'jamprovise://schema',
  {
    title: 'Intent Schema Reference',
    description:
      'Complete reference for all supported command intents, their payloads, and constraints. ' +
      'Read this before constructing complex multi-section sequences.',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/markdown',
      text: `# Jamprovise Intent Schema

## Constraints
- Max global bars per sequence: **${MAX_GLOBAL_BARS}**
- Chord duration: 1–16 bars
- Max sections: 8
- Tempo range: 20–300 BPM

## Chord Root Notes
${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].join(', ')}

Flats are auto-normalized: Bb→A#, Eb→D#, Ab→G#, Db→C#, Gb→F#

## Track Aliases
| Alias | Canonical Track |
|-------|----------------|
| piano, keys, guitar, chords | harmony |
| drums, drum, beat | percussion |
| synth, bassline | bass |

## Drone Mode
Drone mode requires **Pro tier**. Set \`JAMPROVISE_IS_PRO=true\` in your MCP config.

## Voicing Index
| Value | Meaning |
|-------|---------|
| 0 | Root position |
| 1 | First inversion |
| 2 | Second inversion |
| 3 | Third inversion |
| -1 | Auto (engine decides) |
`,
    }],
  })
);

// ---------------------------------------------------------------------------
// Connect and start listening
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: do NOT use console.log here — stdout is reserved for the MCP protocol.
  // Use console.error for any debug output (goes to stderr, not the MCP pipe).
  console.error('[jambot-mcp] Server running on stdio');
}

main().catch((err) => {
  console.error('[jambot-mcp] Fatal error:', err);
  process.exit(1);
});
