// =============================================================================
// src/schemas.test.ts — Unit tests for domain validators and schemas
// =============================================================================
// Run with: npm test
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  sanitizeRoot,
  mapTrackAlias,
  ChordSchema,
  SectionSchema,
  PlaySequenceInputSchema,
  MAX_GLOBAL_BARS,
} from './schemas.js';

// ---------------------------------------------------------------------------
// sanitizeRoot
// ---------------------------------------------------------------------------

describe('sanitizeRoot', () => {
  it('normalizes flat roots to enharmonic sharps', () => {
    expect(sanitizeRoot('Bb')).toBe('A#');
    expect(sanitizeRoot('Eb')).toBe('D#');
    expect(sanitizeRoot('Ab')).toBe('G#');
    expect(sanitizeRoot('Db')).toBe('C#');
    expect(sanitizeRoot('Gb')).toBe('F#');
  });

  it('passes through natural and sharp roots unchanged', () => {
    expect(sanitizeRoot('C')).toBe('C');
    expect(sanitizeRoot('F#')).toBe('F#');
    expect(sanitizeRoot('A')).toBe('A');
  });

  it('trims whitespace', () => {
    expect(sanitizeRoot('  Bb ')).toBe('A#');
  });
});

// ---------------------------------------------------------------------------
// mapTrackAlias
// ---------------------------------------------------------------------------

describe('mapTrackAlias', () => {
  it('maps piano aliases to harmony', () => {
    expect(mapTrackAlias('piano')).toBe('harmony');
    expect(mapTrackAlias('keys')).toBe('harmony');
    expect(mapTrackAlias('keyboard')).toBe('harmony');
  });

  it('maps drum aliases to percussion', () => {
    expect(mapTrackAlias('drums')).toBe('percussion');
    expect(mapTrackAlias('drum')).toBe('percussion');
    expect(mapTrackAlias('beat')).toBe('percussion');
  });

  it('maps bass aliases correctly', () => {
    expect(mapTrackAlias('synth')).toBe('bass');
    expect(mapTrackAlias('bassline')).toBe('bass');
  });

  it('is case-insensitive', () => {
    expect(mapTrackAlias('PIANO')).toBe('harmony');
    expect(mapTrackAlias('Drums')).toBe('percussion');
  });

  it('returns canonical names unchanged', () => {
    expect(mapTrackAlias('harmony')).toBe('harmony');
    expect(mapTrackAlias('percussion')).toBe('percussion');
    expect(mapTrackAlias('bass')).toBe('bass');
  });
});

// ---------------------------------------------------------------------------
// ChordSchema
// ---------------------------------------------------------------------------

describe('ChordSchema', () => {
  it('accepts a minimal valid chord', () => {
    const result = ChordSchema.parse({ root: 'C', quality: 'maj7' });
    expect(result.root).toBe('C');
    expect(result.quality).toBe('maj7');
    expect(result.durationInBars).toBe(2); // default
  });

  it('auto-normalizes flat root notes', () => {
    const result = ChordSchema.parse({ root: 'Bb', quality: 'm7' });
    expect(result.root).toBe('A#');
  });

  it('rejects duration below minimum', () => {
    expect(() => ChordSchema.parse({ root: 'C', quality: 'major', durationInBars: 0 }))
      .toThrow();
  });

  it('rejects duration above maximum', () => {
    expect(() => ChordSchema.parse({ root: 'C', quality: 'major', durationInBars: 17 }))
      .toThrow();
  });

  it('rejects voicingIndex out of range', () => {
    expect(() => ChordSchema.parse({ root: 'C', quality: 'major', voicingIndex: 4 }))
      .toThrow();
    expect(() => ChordSchema.parse({ root: 'C', quality: 'major', voicingIndex: -2 }))
      .toThrow();
  });

  it('accepts voicingIndex boundary values', () => {
    expect(ChordSchema.parse({ root: 'C', quality: 'major', voicingIndex: -1 }).voicingIndex).toBe(-1);
    expect(ChordSchema.parse({ root: 'C', quality: 'major', voicingIndex: 3 }).voicingIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// SectionSchema
// ---------------------------------------------------------------------------

describe('SectionSchema', () => {
  const validChord = { root: 'C', quality: 'maj7', durationInBars: 2 };

  it('accepts a minimal valid section', () => {
    const result = SectionSchema.parse({ progression: [validChord] });
    expect(result.progression).toHaveLength(1);
  });

  it('rejects an empty progression', () => {
    expect(() => SectionSchema.parse({ progression: [] })).toThrow();
  });

  it('rejects progression with more than 32 chords', () => {
    const tooMany = Array(33).fill(validChord);
    expect(() => SectionSchema.parse({ progression: tooMany })).toThrow();
  });

  it('accepts optional keyOverride', () => {
    const result = SectionSchema.parse({ progression: [validChord], keyOverride: 'F# minor' });
    expect(result.keyOverride).toBe('F# minor');
  });
});

// ---------------------------------------------------------------------------
// PlaySequenceInputSchema — integration-level validation
// ---------------------------------------------------------------------------

describe('PlaySequenceInputSchema', () => {
  const validSection = {
    progression: [
      { root: 'D', quality: 'm7', durationInBars: 2 },
      { root: 'G', quality: '7', durationInBars: 2 },
      { root: 'C', quality: 'maj7', durationInBars: 4 },
    ],
  };

  it('accepts a valid ii-V-I sequence', () => {
    const result = PlaySequenceInputSchema.parse({
      key: 'C major',
      tempo: 120,
      sections: [validSection],
    });
    expect(result.sections[0].progression).toHaveLength(3);
  });

  it('rejects tempo below range', () => {
    expect(() => PlaySequenceInputSchema.parse({
      key: 'C major', tempo: 10, sections: [validSection],
    })).toThrow();
  });

  it('rejects tempo above range', () => {
    expect(() => PlaySequenceInputSchema.parse({
      key: 'C major', tempo: 400, sections: [validSection],
    })).toThrow();
  });

  it('rejects more than 8 sections', () => {
    const tooManySections = Array(9).fill(validSection);
    expect(() => PlaySequenceInputSchema.parse({
      key: 'C major', tempo: 120, sections: tooManySections,
    })).toThrow();
  });

  it(`reports MAX_GLOBAL_BARS constant as ${MAX_GLOBAL_BARS}`, () => {
    expect(MAX_GLOBAL_BARS).toBe(64);
  });
});
