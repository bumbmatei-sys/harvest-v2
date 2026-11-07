"use client";
import { useTranslations } from "next-intl";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const formats = [["png", "downloadPng"], ["svg", "downloadSvg"], ["pdf", "downloadPdf"]] as const;
export function DownloadMenu({ endpoint }: { endpoint: string }) {
  const t = useTranslations("ConnectLinks");
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="min-h-11"><Download aria-hidden="true" />{t("download")}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-64">
      {(["standard", "brand"] as const).map((palette, index) => <DropdownMenuGroup key={palette}>
        {index > 0 && <DropdownMenuSeparator />}
        <DropdownMenuLabel>{t(palette === "standard" ? "downloadStandard" : "downloadBrand")}</DropdownMenuLabel>
        {formats.map(([format, key]) => <DropdownMenuItem key={format} asChild className="min-h-11">
          <a href={`${endpoint}?format=${format}&palette=${palette}`} download>{t(key)}</a>
        </DropdownMenuItem>)}
      </DropdownMenuGroup>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
