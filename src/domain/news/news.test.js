import { describe, expect, it } from 'vitest';
import {
  normalizeNewsArticle,
  isNewsPublished,
  duplicateNewsArticle,
  slugifyNewsTitle,
  estimateReadingMinutes,
  buildNewsCmsStats,
} from './news';

describe('news cms domain', () => {
  it('slugify y lectura', () => {
    expect(slugifyNewsTitle('Torneo de Pádel 2026')).toBe('torneo-de-padel-2026');
    expect(estimateReadingMinutes('palabra '.repeat(400))).toBe(2);
  });

  it('normaliza estados y featured', () => {
    const draft = normalizeNewsArticle({ title: 'A', excerpt: 'b', content: 'c', status: 'draft' });
    expect(draft.isPublished).toBe(false);
    expect(isNewsPublished(draft)).toBe(false);

    const pub = normalizeNewsArticle({ title: 'A', excerpt: 'b', content: 'c', status: 'published', featured: true });
    expect(isNewsPublished(pub)).toBe(true);
    expect(pub.featured).toBe(true);
  });

  it('respeta programación', () => {
    const future = normalizeNewsArticle({
      title: 'A', excerpt: 'b', content: 'c', status: 'scheduled',
      scheduledAt: '2099-01-01T12:00',
    });
    expect(isNewsPublished(future)).toBe(false);
    const past = normalizeNewsArticle({
      title: 'A', excerpt: 'b', content: 'c', status: 'scheduled',
      scheduledAt: '2020-01-01T12:00',
    });
    expect(isNewsPublished(past)).toBe(true);
  });

  it('duplica como borrador', () => {
    const copy = duplicateNewsArticle({
      id: '1', title: 'Nota', excerpt: 'x', content: 'y', status: 'published', featured: true,
    });
    expect(copy.status).toBe('draft');
    expect(copy.featured).toBe(false);
    expect(copy.title).toContain('copia');
  });

  it('stats cms', () => {
    const stats = buildNewsCmsStats([
      { status: 'published' },
      { status: 'draft' },
      { status: 'scheduled' },
      { featured: true, status: 'published' },
    ]);
    expect(stats.total).toBe(4);
    expect(stats.scheduled).toBe(1);
    expect(stats.featured).toBe(1);
  });
});
