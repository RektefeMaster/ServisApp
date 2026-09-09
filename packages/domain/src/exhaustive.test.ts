import { describe, expect, it } from 'vitest';
import { exhaustive } from './exhaustive.js';

describe('exhaustive', () => {
  it('ulaşılması beklenmeyen dalda hata fırlatır', () => {
    expect(() => exhaustive('BILINMEYEN' as never, 'tripState')).toThrow(/tripState/);
  });
});
