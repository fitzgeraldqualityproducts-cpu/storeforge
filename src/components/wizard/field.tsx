import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control + help/error text with proper aria wiring. */
export function Field({
  id,
  label,
  help,
  error,
  className,
  children,
  optional,
}: {
  id: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  className?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export const fieldAria = (id: string, error?: string) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : `${id}-help`,
});
