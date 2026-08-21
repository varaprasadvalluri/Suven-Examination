// Shared page-number pagination contract for every DAO list method. Deliberately
// LIMIT/OFFSET-shaped (page + pageSize in, page + pageSize + total + totalPages out) rather
// than Firestore-cursor-shaped — a Postgres DAO implementing the same interface later maps
// this straight onto `LIMIT pageSize OFFSET (page-1)*pageSize` with no controller/client change.
export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export function normalizePageParams(raw: { page?: any; pageSize?: any }): PageParams {
  let page = parseInt(raw.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let pageSize = parseInt(raw.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  return { page, pageSize };
}

export function paginateInMemory<T>(items: T[], { page, pageSize }: PageParams): PagedResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages
  };
}
