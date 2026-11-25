"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The bar above a print view (hidden when printing): the print button, and for "PDF" a line on choosing Save as PDF. It opens the print dialog once when asked to. */
export function PrintBar({ auto, pdf }: { auto: boolean; pdf: boolean }) {
  const t = useTranslations("Docs");
  useEffect(() => { if (auto) { const timer = setTimeout(() => window.print(), 400); return () => clearTimeout(timer); } }, [auto]);
  return <div className="mb-6 flex flex-wrap items-center gap-3 border-b pb-3 print:hidden"><Button type="button" className="min-h-11" onClick={() => window.print()}><Printer aria-hidden="true" />{t("print")}</Button>{pdf && <p className="text-sm text-muted-foreground">{t("pdfHint")}</p>}</div>;
}
