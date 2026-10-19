import { describe, expect, it } from 'vitest';
import { isEmailIdentifier, isValidUsername, normalizeUsername } from './username';

describe('PIKAS usernames (6A)', () => {
  it('normalizes to trimmed lowercase', () => expect(normalizeUsername('  Cajera.Norte ')).toBe('cajera.norte'));
  it.each(['abc', 'cajera.norte', 'pos_2', 'a-b.c_d'])('accepts %s', v => expect(isValidUsername(v)).toBe(true));
  it.each(['ab', '.abc', 'abc.', 'a..b', 'a._b', 'a b', 'ABC', 'x@y.com', 'ñandu', 'a'.repeat(41)])('rejects %s', v => expect(isValidUsername(v)).toBe(false));
  it('an identifier with @ is always treated as an email', () => { expect(isEmailIdentifier('x@y.com')).toBe(true); expect(isEmailIdentifier('cajera.norte')).toBe(false); });
});
