import { describe, expect, it } from 'vitest';
import { fromLocalInput, toLocalInput, setTimezone } from './format';
import en from '../i18n/en';
import th from '../i18n/th';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('timezone conversion for datetime-local inputs', () => {
  it('round-trips in Asia/Bangkok (UTC+7)', () => {
    setTimezone('Asia/Bangkok');
    expect(fromLocalInput('2026-11-01T08:30')).toBe('2026-11-01T01:30:00.000Z');
    expect(toLocalInput('2026-11-01T01:30:00.000Z')).toBe('2026-11-01T08:30');
  });
});

describe('localisation completeness', () => {
  it('Thai and English have identical key sets with non-empty values', () => {
    expect(keys(th).sort()).toEqual(keys(en).sort());
    for (const k of keys(th)) expect(k.split('.').reduce((o: any, x) => o[x], th)).not.toBe('');
  });
});
