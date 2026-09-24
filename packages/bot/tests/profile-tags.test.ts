import { describe, expect, it } from 'vitest';
import {
  collectTags,
  formatHandle,
  handleKey,
  identityName,
  normalizeTag,
  parseTagList,
  randomTag,
} from '../src/server/profile-tags';

describe('profile tags', () => {
  it('accepts a short code and a word, stripping the hash', () => {
    expect(normalizeTag('#LAS')).toBe('LAS');
    expect(normalizeTag('  #Cripto ')).toBe('Cripto');
    expect(normalizeTag('a')).toBeNull();
    expect(normalizeTag('con espacio')).toBeNull();
  });

  it('keeps a single tag', () => {
    expect(collectTags(['#LAS'])).toEqual({ tags: ['LAS'] });
    expect(collectTags(['#LAS', 'las'])).toEqual({ tags: ['LAS'] });
    expect(collectTags(['#LAS', '#Cripto'])).toEqual({ error: 'too_many' });
    expect(collectTags(['ok', 'no vale'])).toEqual({ error: 'invalid' });
  });

  it('treats the name and tag together as the identifier', () => {
    expect(formatHandle('LauToro', 'LAS')).toBe('LauToro#LAS');
    expect(handleKey('LauToro', 'LAS')).toBe('lautoro#las');
    expect(handleKey('LauToro', 'LA')).toBe('lautoro#la');
    expect(handleKey('LauToroo', 'LAS')).toBe('lautoroo#las');
    expect(handleKey('LauToro', 'LAS')).not.toBe(handleKey('LauToro', 'LA'));
    expect(handleKey('LauToro', 'LAS')).not.toBe(handleKey('LauToroo', 'LAS'));
    expect(identityName('LauToro', 'other@mail.com')).toBe('LauToro');
    expect(identityName('  ', 'lautoro@mail.com')).toBe('lautoro');
  });

  it('generates a public tag without an email', () => {
    const tag = randomTag();
    expect(normalizeTag(tag)).toBe(tag);
    expect(tag).not.toMatch(/@/);
  });

  it('reads a single tag stored as json', () => {
    expect(parseTagList('["LAS","Cripto"]')).toEqual(['LAS']);
  });
});
