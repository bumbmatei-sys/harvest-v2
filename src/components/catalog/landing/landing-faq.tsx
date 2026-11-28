/** Derived from Shadcn UI Kit item faq7 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/** The owner's questions and answers as an accordion; the first one starts open. */
export function LandingFaq({ faqs }: { faqs: { question: string; answer: string }[] }) {
  const t = useTranslations("CatalogLanding.faq");
  return (
    <section className="w-full" aria-labelledby="landing-faq">
      <div>
        <div className="mb-10 flex items-end justify-between gap-6">
          <p className="text-muted-foreground text-sm">
            {t("lead")}
          </p>
          <h2 id="landing-faq" className="text-foreground text-4xl tracking-tight sm:text-5xl">
            {t("title")}{" "}
            <ArrowUpRight
              aria-hidden="true"
              className="mb-1 inline-block size-8 sm:size-10"
            />
          </h2>
        </div>

        <Accordion type="single" collapsible defaultValue="item-0">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="items-center gap-6 p-6 text-base hover:no-underline sm:text-xl">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-6">
                <div className="grid sm:grid-cols-2">
                  <div />
                  <p className="text-muted-foreground text-sm text-balance whitespace-pre-line">
                    {faq.answer}
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
