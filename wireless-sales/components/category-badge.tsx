import { categoryStyle } from "@/lib/sale-display";

export function CategoryBadge({ category }: { category: string }) {
  if (!category) return <span className="text-ink-muted">-</span>;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${categoryStyle(category)}`}
    >
      {category}
    </span>
  );
}
