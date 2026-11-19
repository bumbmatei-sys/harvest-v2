/*
Adapted from Studio Admin at c16e1af271a1c522a01feb43074b32abfe114241.
MIT License

Copyright (c) 2024 Mohammed Arham Khan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
"use client";

import type { ComponentProps } from "react";
import { MessageScroller as Primitive, useMessageScroller, useMessageScrollerScrollable } from "@shadcn/react/message-scroller";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MessageScrollerProvider = Primitive.Provider;
export { useMessageScroller, useMessageScrollerScrollable };

export function MessageScroller({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="message-scroller" className={cn("relative flex size-full min-h-0 flex-col overflow-hidden", className)} {...props} />;
}

export function MessageScrollerViewport({ className, ...props }: ComponentProps<typeof Primitive.Viewport>) {
  return <Primitive.Viewport data-slot="message-scroller-viewport" preserveScrollOnPrepend
    className={cn("size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content data-pending-scroll:invisible", className)} {...props} />;
}

export function MessageScrollerContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content data-slot="message-scroller-content" className={cn("flex h-max min-h-full min-w-0 flex-col gap-4", className)} {...props} />;
}

export function MessageScrollerItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="message-scroller-item" className={cn("min-w-0 shrink-0", className)} {...props} />;
}

export function MessageScrollerButton({ label }: { label: string }) {
  return <Primitive.Button direction="end" behavior="instant" aria-label={label}
    className="absolute inset-s-1/2 bottom-3 z-10 size-11 -translate-x-1/2 border bg-background text-foreground data-[active=false]:invisible"
    render={<Button variant="outline" size="icon" />}><ArrowDown aria-hidden="true" /></Primitive.Button>;
}
