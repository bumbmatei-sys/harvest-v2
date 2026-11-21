import { CalendarCheck, HandHeart, HeartHandshake, MessageSquareText, Plus, UserPlus, type LucideIcon } from "lucide-react";
import type { TemplateId } from "@/lib/crm-forms";

/** One icon per starter form; the blank form uses the plus. */
export const templateIcon: Record<TemplateId | "scratch", LucideIcon> = { prayer: HandHeart, event: CalendarCheck, volunteer: HeartHandshake, feedback: MessageSquareText, visitor: UserPlus, scratch: Plus };
