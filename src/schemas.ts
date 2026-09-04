// =============================================================================
// src/schemas.ts — Jamprovise Intent Schema (Zod v4)
// =============================================================================
// Ported from backend/shared/responseParser.js and frontend/CommandExecutor.ts.
// This is the core domain contract: the typed interface between Claude and
// the Jamprovise application state. Zod v4 schemas double as:
//   1. Validation constraints (input to the MCP tools)
//   2. TypeScript type inference (zero-duplication type safety)
//   3. Self-documenting API surface (tool descriptions reference field names)
// =============================================================================

import * as z from 'zod';

// ---------------------------------------------------------------------------
// SECTION 1: Primitive Constraints
// Mirrors the constants in CommandExecutor.ts and responseParser.js
// ---------------------------------------------------------------------------

/** All valid musical root notes. Flats are normalized to their enharmonic sharp. */
export const VALID_ROOTS = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** All valid chord qualities supported by the Jamprovise synthesis engine. */
export const VALID_QUALITIES = [
  'major', 'minor', 'm', 'maj', 'M',
  'maj7', 'Maj7', 'M7',
  'm7', 'min7',
  '7', 'dom7',
  'dim', 'dim7',
  'aug', 'aug7',
  'sus2', 'sus4',
  'add9', 'madd9',
  '9', 'maj9', 'm9',
  '11', 'maj11', 'm11',
  '13', 'maj13', 'm13',
  '#11', 'b9', '#9', 'b13', 'alt',
  'm7b5', 'half-dim',
  '6', 'm6',
] as const;

/** All supported musical intent types — the command verbs. */
export const INTENT_VALUES = [
  'PLAY_NEW_SEQUENCE',
  'MODIFY_SEQUENCE',
  'MODIFY_TRANSPORT',
  'MODIFY_TRACK',
  'APPLY_STYLE',
  'QUERY_STATE',
  'CHAT',
  'INTERACTIVE_REPLY',
] as const;

export type Intent = typeof INTENT_VALUES[number];

// ---------------------------------------------------------------------------
// SECTION 2: Domain Validators
// These enforce Jamprovise-specific business rules, not just JSON types.
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a chord root note.
 * Converts flats to enharmonic sharps: Bb→A#, Eb→D#, Ab→G#, Db→C#, Gb→F#
 */
export function sanitizeRoot(root: string): string {
  const flatToSharp: Record<string, string> = {
    'Bb': 'A#', 'Eb': 'D#', 'Ab': 'G#', 'Db': 'C#', 'Gb': 'F#',
  };
  const normalized = root.trim();
  return flatToSharp[normalized] ?? normalized;
}

/**
 * Map track alias strings to canonical track IDs.
 * Mirrors CommandExecutor.ts mapTrackAlias().
 */
export function mapTrackAlias(alias: string): string {
  const aliases: Record<string, string> = {
    piano: 'harmony',
    keys: 'harmony',
    keyboard: 'harmony',
    chords: 'harmony',
    guitar: 'harmony',
    drums: 'percussion',
    drum: 'percussion',
    beat: 'percussion',
    rhythm: 'percussion',
    synth: 'bass',
    bassline: 'bass',
  };
  return aliases[alias.toLowerCase()] ?? alias.toLowerCase();
}

// ---------------------------------------------------------------------------
// SECTION 3: Core Schema Definitions
// ---------------------------------------------------------------------------

/** A single chord within a progression. */
export const ChordSchema = z.object({
  root: z.string()
    .transform(sanitizeRoot)
    .describe('Root note of the chord (e.g. "C", "F#", "A#"). Flats are auto-normalized.'),
  quality: z.string()
    .describe('Chord quality (e.g. "maj7", "m7", "dim", "alt"). See VALID_QUALITIES for full list.'),
  durationInBars: z.number().int().min(1).max(16).default(2)
    .describe('How many bars this chord lasts. Must be 1–16. Default is 2.'),
  extensions: z.array(z.string()).optional()
    .describe('Additional chord extensions (e.g. ["9", "#11"]). Applied on top of quality.'),
  voicingIndex: z.number().int().min(-1).max(3).optional()
    .describe('Inversion: 0=root, 1=first inv, 2=second inv, 3=third inv, -1=auto.'),
  isArpeggiated: z.boolean().optional()
    .describe('If true, the chord plays as an arpeggio/solo rather than a block chord.'),
  arpSettings: z.object({
    pattern: z.enum(['up', 'down', 'random', 'updown']).optional(),
    scaleMode: z.string().optional()
      .describe('Scale for arpeggiation: "blues", "pentatonic", "dorian", etc.'),
    noteDuration: z.string().optional(),
  }).optional(),
});

export type Chord = z.infer<typeof ChordSchema>;

/** A named section within a multi-section arrangement. */
export const SectionSchema = z.object({
  name: z.string().optional()
    .describe('Optional label (e.g. "Verse", "Chorus", "Bridge").'),
  progression: z.array(ChordSchema).min(1).max(32)
    .describe('The chord progression for this section.'),
  keyOverride: z.string().optional()
    .describe('Transpose this section to a different key (e.g. "F# minor"). Overrides global key.'),
  tempo: z.number().int().min(20).max(300).optional()
    .describe('Section-specific BPM. Overrides transport tempo for this section only.'),
});

export type Section = z.infer<typeof SectionSchema>;

/** UI rendering hints that accompany a sequence command. */
export const UIDirectivesSchema = z.object({
  viewMode: z.enum(['default', 'practice', 'performance']).optional(),
  visualizer: z.enum(['piano', 'guitar', 'none']).optional(),
  randomizerMode: z.object({
    isOn: z.boolean(),
    barsPerChord: z.number().int().min(1).max(16).optional(),
  }).optional(),
}).optional();

// ---------------------------------------------------------------------------
// SECTION 4: Tool Input Schemas
// These are the exact Zod schemas registered with the MCP server's tools.
// ---------------------------------------------------------------------------

/** Input schema for the execute_command tool — PLAY_NEW_SEQUENCE payload. */
export const PlaySequenceInputSchema = z.object({
  key: z.string()
    .describe('Global key signature (e.g. "C major", "A minor", "F# dorian").'),
  tempo: z.number().int().min(20).max(300).default(120)
    .describe('Tempo in BPM. Defaults to 120.'),
  sections: z.array(SectionSchema).min(1).max(8)
    .describe('One or more musical sections. Most simple requests have a single section.'),
  style: z.string().optional()
    .describe('Style preset to apply (e.g. "jazz", "pop", "cinematic"). Must be a known style ID.'),
  uiDirectives: UIDirectivesSchema,
});

/** Input schema for the execute_command tool — MODIFY_TRANSPORT payload. */
export const ModifyTransportInputSchema = z.object({
  tempo: z.number().int().min(20).max(300).optional()
    .describe('New global BPM.'),
  key: z.string().optional()
    .describe('New global key (transposes the entire arrangement).'),
  droneMode: z.object({
    isOn: z.boolean(),
    root: z.string().optional(),
  }).optional()
    .describe('Toggle drone mode. Pro tier only. Free tier calls will be rejected.'),
  isPlaying: z.boolean().optional()
    .describe('Start or stop playback.'),
});

/** Input schema for the query_state tool. */
export const QueryStateInputSchema = z.object({
  field: z.string()
    .describe(
      'Dot-notation path into the Jamprovise app state. ' +
      'Examples: "tempo", "key", "isPlaying", "tracks.harmony.instrument", ' +
      '"sections[0].progression[0].root"'
    ),
});

/** Input schema for get_available_instruments tool. */
export const GetInstrumentsInputSchema = z.object({
  track: z.string()
    .describe('Track name: "harmony", "bass", or "percussion" (aliases like "piano" also accepted).'),
});

// ---------------------------------------------------------------------------
// SECTION 5: Domain Constraint Exports
// ---------------------------------------------------------------------------

/** Maximum bars allowed in a single sequence (mirrors MAX_GLOBAL_BARS in CommandExecutor.ts). */
export const MAX_GLOBAL_BARS = 64;

/** Tracks that require Pro tier. */
export const PRO_ONLY_FEATURES = ['droneMode'] as const;

/** Available style presets — subset of the full MUSIC_STYLES manifest. */
export const AVAILABLE_STYLES = [
  { id: 'jazz', label: 'Jazz', description: 'Swing feel, rich extensions (7ths, 9ths, 13ths)' },
  { id: 'blues', label: 'Blues', description: '12-bar blues structure, dominant 7th chords' },
  { id: 'pop', label: 'Pop', description: 'Clean, diatonic, 4-chord progressions' },
  { id: 'cinematic', label: 'Cinematic', description: 'Dramatic, wide voicings, modal harmony' },
  { id: 'bossa_nova', label: 'Bossa Nova', description: 'Syncopated Brazilian jazz feel' },
  { id: 'rnb', label: 'R&B / Soul', description: 'Smooth extended chords, gospel-influenced' },
  { id: 'funk', label: 'Funk', description: 'Tight, percussive, minor 7th chords' },
  { id: 'latin', label: 'Latin', description: 'Salsa/rumba feel, mixolydian modes' },
  { id: 'classical', label: 'Classical', description: 'Voice-led progressions, counterpoint' },
  { id: 'ambient', label: 'Ambient', description: 'Sustained, pad-like, open voicings' },
] as const;

/** Available instruments by track. Mirrors the Jamprovise instrument manifest. */
export const INSTRUMENTS_BY_TRACK: Record<string, string[]> = {
  harmony: ['grand_piano', 'electric_piano', 'organ', 'synth_pad', 'guitar_acoustic', 'vibraphone', 'strings'],
  bass: ['upright_bass', 'electric_bass', 'synth_bass', 'tuba'],
  percussion: ['jazz_kit', 'rock_kit', 'brush_kit', 'electronic_kit', 'cajon', 'tabla'],
};
