/** Derived from Shadcn UI Kit item dashboard-modal24 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import {
  ArrowRightLeftIcon,
  CheckIcon,
  FileTextIcon,
  MailIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The frozen consent wording of a sign-up form, laid out as the kit's connect dialog body shown in place: the form-to-list mark with the wording
 * version, the lines a visitor agrees to, and the fine print (what the wording becomes while link clicks are counted).
 */
export function ConsentWordingPanel({ wordingVersion, heading, lines, footnote }: { wordingVersion: string; heading: string; lines: string[]; footnote: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm" data-signup-wording>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg border">
          <FileTextIcon className="size-5" aria-hidden="true" />
        </span>
        <ArrowRightLeftIcon
          className="text-muted-foreground size-4"
          aria-hidden="true"
        />
        <span className="flex size-10 items-center justify-center rounded-lg border">
          <MailIcon
            className="size-5"
            aria-hidden="true"
          />
        </span>
        <Badge variant="outline" className="ms-auto">{wordingVersion}</Badge>
      </div>

      <div className="flex flex-col gap-3">
        <p className="font-medium">{heading}</p>
        <ul className="flex flex-col gap-2">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <CheckIcon
                className="text-success mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-muted-foreground text-xs" data-counted-wording>
        {footnote}
      </p>
    </div>
  );
}
