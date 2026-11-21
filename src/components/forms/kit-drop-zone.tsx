/** Derived from Shadcn UI Kit item form-layout15 (premium), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { CloudUploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The kit's dashed upload button look (icon in a circle, title, hint), inert: uploads are not part of this version, so it only shows where a file would go. */
export function DropZone({ title, hint }: { title: string; hint: string }) {
  return (
    <div aria-disabled="true" className={cn("flex h-auto flex-col items-center gap-3 rounded-2xl border border-dashed bg-transparent px-4 py-6 text-center font-normal opacity-80")}>
      <span className="bg-muted flex size-10 items-center justify-center rounded-full border">
        <CloudUploadIcon className="size-4" aria-hidden="true" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </div>
  );
}
