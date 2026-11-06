import Link from "next/link";
import { ArrowUpRight, BookOpen, CircleHelp, Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { StarterResourceId } from "@/lib/connect-public";

const icons = { "first-reading": BookOpen, "common-questions": CircleHelp, "keep-exploring": Compass };

export async function ResourceCards({ resourceIds }: { resourceIds: readonly StarterResourceId[] }) {
  const t = await getTranslations("Connect");
  return <div className="grid gap-4 md:grid-cols-3">
    {resourceIds.map((id) => {
      const Icon = icons[id];
      return <Card key={id}>
        <CardHeader>
          <Icon className="mb-3 size-6" aria-hidden="true" />
          <CardTitle><h2 className="text-xl leading-snug">{t(`resources.${id}.title`)}</h2></CardTitle>
          <CardDescription className="text-base leading-relaxed">{t(`resources.${id}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className="mt-auto"><p className="text-sm text-muted-foreground">{t(`resources.${id}.format`)}</p></CardContent>
        <CardFooter><Button asChild variant="outline" className="min-h-11 w-full justify-between whitespace-normal text-start">
          <Link prefetch={false} href={`/resources/start/${id}`}>{t(`resources.${id}.action`)}<ArrowUpRight aria-hidden="true" /></Link>
        </Button></CardFooter>
      </Card>;
    })}
  </div>;
}
