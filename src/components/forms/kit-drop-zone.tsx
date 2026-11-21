/** Derived from Shadcn UI Kit item file-upload1 (free), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { ImageUpIcon } from "lucide-react";

/** The kit's drop zone, inert: uploads are not part of this version, so it only shows where a file would go. */
export function DropZone({ title, hint }: { title: string; hint: string }) {
  return (
    <div aria-disabled="true" className="border-input relative flex min-h-40 w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 outline-none">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="border-input text-muted-foreground flex size-14 items-center justify-center rounded-full border">
          <ImageUpIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}
