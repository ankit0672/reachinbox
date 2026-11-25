import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** "21–40 of 135" with previous/next. Hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page <= 1) return null;
  const from = Math.min(total, (page - 1) * pageSize + 1);
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 px-4 py-3 text-sm">
      <span className="text-ink-muted">
        {total === 0 || from > to ? `Page ${page}` : `${from}–${to} of ${total}`}
      </span>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-control p-1.5 enabled:hover:bg-surface-muted disabled:opacity-40"
      >
        <ChevronLeft aria-hidden size={16} />
      </button>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-control p-1.5 enabled:hover:bg-surface-muted disabled:opacity-40"
      >
        <ChevronRight aria-hidden size={16} />
      </button>
    </nav>
  );
}
