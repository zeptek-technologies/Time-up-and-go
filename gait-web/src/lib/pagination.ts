/** Pagination applies after filtering; summaries continue to use the full dataset. */
export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(1, Math.min(Math.floor(requestedPage) || 1, pageCount));
  const offset = (page - 1) * size;
  return { items: items.slice(offset, offset + size), total: items.length, page, pageCount,
    pageSize: size, offset, start: items.length ? offset + 1 : 0, end: Math.min(offset + size, items.length) };
}
