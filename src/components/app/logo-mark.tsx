import { APP_NAME } from "@/lib/brand-constants";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M4 15h16l-2 5H6z" />
          <path d="M8 15c0-4 2-6 4-9 2 3 4 5 4 9" className="text-ember" stroke="var(--ember)" />
        </svg>
      </span>
      <span>{APP_NAME}</span>
    </span>
  );
}
