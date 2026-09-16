import React from 'react';
import { Button } from '../../components/ui/button';

export interface PaginationBarProps {
  /** Total number of records across all pages. The bar hides itself when this is 0. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (updater: (previous: number) => number) => void;
  onPageSizeChange: (size: number) => void;
  /** Selectable page sizes. Screens page different-sized rows, so this is not fixed. */
  pageSizeOptions?: number[];
  /** Label before the size selector, e.g. "Schools per page:". */
  sizeLabel?: string;
  /** Plural noun for the record count, e.g. "nodes". */
  itemNoun?: string;
  /** Disables paging while a fetch is in flight. */
  busy?: boolean;
}

/**
 * The "N per page / showing X-Y of Z / Previous · page · Next" bar.
 *
 * Existed twice in AdminSchoolManagement, 47 lines each. The two copies had already drifted —
 * one rendered the record noun as "nodes" and the other as "Nodes" — which is the mild,
 * visible end of the failure mode this prevents.
 *
 * Deliberately NOT used by AdminExams: that screen renders numbered pages with ellipsis
 * rather than a single current-page indicator, and collapsing the two into one component
 * would mean silently changing one screen's pagination UI to match the other.
 */
export const PaginationBar: React.FC<PaginationBarProps> = ({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [3, 5, 10, 20],
  sizeLabel = 'Items per page:',
  itemNoun = 'records',
  busy = false
}) => {
  if (total <= 0) return null;

  const firstOnPage = (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(total, page * pageSize);

  return (
    <div className="p-6 border border-slate-200 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">{sizeLabel}</span>
        <select
          value={pageSize}
          aria-label={sizeLabel}
          onChange={(e) => {
            onPageSizeChange(parseInt(e.target.value));
            onPageChange(() => 1);
          }}
          className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none cursor-pointer"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="text-xs font-medium text-slate-400 ml-4 font-mono">
          Showing {firstOnPage} - {lastOnPage} of {total} {itemNoun}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange((p) => Math.max(1, p - 1))}
          disabled={page === 1 || busy}
          className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
        >
          Previous
        </Button>
        <div className="h-9 w-9 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-xs font-black text-indigo-700 font-mono">
          {page}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange((p) => p + 1)}
          disabled={page * pageSize >= total || busy}
          className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
        >
          Next
        </Button>
      </div>
    </div>
  );
};
