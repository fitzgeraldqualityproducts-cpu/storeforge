import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "rounded-md bg-muted bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--card)_70%,transparent),transparent)] bg-[length:400px_100%] bg-no-repeat animate-shimmer",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
