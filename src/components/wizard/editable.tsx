"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Inline-editable text that commits on blur. Keyed by the saved value by callers so a server
 * update (e.g. regeneration) replaces the local draft.
 */
export function EditableText({
  id,
  value,
  onCommit,
  multiline,
  rows = 3,
  maxLength,
  placeholder,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const common = {
    id,
    value: draft,
    maxLength,
    placeholder,
    "aria-label": ariaLabel,
    "aria-describedby": describedBy,
    onBlur: commit,
  };
  return multiline ? (
    <Textarea
      {...common}
      rows={rows}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
    />
  ) : (
    <Input
      {...common}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** A list edited as one item per line. */
export function EditableList({
  id,
  value,
  onCommit,
  rows = 3,
  placeholder,
  className,
}: {
  id?: string;
  value: string[];
  onCommit: (v: string[]) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <EditableText
      id={id}
      key={value.join("\n")}
      multiline
      rows={Math.max(rows, value.length + 1)}
      value={value.join("\n")}
      placeholder={placeholder ?? "One per line"}
      className={cn("text-sm", className)}
      onCommit={(v) =>
        onCommit(
          v
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        )
      }
    />
  );
}
