import { FormError, id, textField, type Form } from './validation.js';
export const LIST_LIMIT = 25;
export function listInput(query: Record<string, unknown> = {}) {
  const q = textField(query, 'q', 200);
  const raw = query.page ?? '1';
  if (typeof raw !== 'string' || !/^[1-9]\d{0,4}$/.test(raw))
    throw new FormError('page', 'Choose a valid page.');
  const page = Number(raw);
  return { q, page, limit: LIST_LIMIT, offset: (page - 1) * LIST_LIMIT };
}
// Literal case-insensitive substring; SQL parameters still bind the complete value.
export function searchPattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (character) => '\\' + character)}%`;
}
export function pagination(
  total: number,
  input: ReturnType<typeof listInput>,
  path: string,
  extra: Record<string, string> = {},
) {
  const href = (page: number) => {
    const query = new URLSearchParams({
      ...extra,
      ...(input.q ? { q: input.q } : {}),
      page: String(page),
    });
    return path + '?' + query.toString();
  };
  const pages = Math.max(1, Math.ceil(total / input.limit));
  return {
    ...input,
    total,
    pages,
    previous: input.page > 1 ? href(input.page - 1) : null,
    next: input.page < pages ? href(input.page + 1) : null,
  };
}
export function selectedIds(form: Form) {
  const input = form.selected;
  const ids = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? [input]
      : [];
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length)
    throw new FormError('selected', 'Select 1–50 distinct rows on this page.');
  return ids.map((value) => id(value, 'selected')).sort();
}
export type BulkResult = {
  updated: number;
  skipped: number;
  failed: number;
  rows: {
    id: string;
    name: string;
    result: 'updated' | 'skipped' | 'failed';
    reason: string;
  }[];
};

export function listingQuery(
  input: Pick<ReturnType<typeof listInput>, 'q' | 'page'>,
  stock = '',
) {
  const query = new URLSearchParams({
    ...(input.q ? { q: input.q } : {}),
    ...(input.page > 1 ? { page: String(input.page) } : {}),
    ...(stock ? { stock } : {}),
  }).toString();
  return query ? '?' + query : '';
}
