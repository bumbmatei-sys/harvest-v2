import { BookOpen, Bus, CalendarCheck, CalendarDays, ChartColumn, Church, Clapperboard, ClipboardList, Compass, FolderOpen, HandCoins, HandHeart, HandHelping, Handshake,
  Mail, Map, Megaphone, MessagesSquare, Music, Network, Package, PiggyBank, QrCode, Receipt, Route, Share2, ShieldPlus, Sparkles, Sprout, SquareKanban, Users,
  type LucideIcon } from "lucide-react";
import type { DepartmentKey, ModuleKey } from "@/lib/campaign-wizard";
import type { Accent } from "@/lib/theme-registry";

type Mark = { icon: LucideIcon; accent: Accent };

/**
 * Each department's chip on the Teams step: its own icon on a neutral tile, in the palette's primary accent (Harvest: gold); money-related items use
 * the second supporting tone. Decorative; the name is always beside it.
 */
export const departmentMarks: Record<DepartmentKey, Mark> = {
  campaign_leadership: { icon: Compass, accent: "primary" },
  church_mobilization: { icon: Church, accent: "primary" },
  evangelistic_outreach: { icon: Megaphone, accent: "primary" },
  prayer_intercession: { icon: HandHeart, accent: "primary" },
  marketing_media: { icon: Clapperboard, accent: "primary" },
  logistics_equipment: { icon: Package, accent: "primary" },
  finance_fundraising: { icon: PiggyBank, accent: "support-2" },
  volunteers: { icon: Users, accent: "primary" },
  counseling: { icon: MessagesSquare, accent: "primary" },
  discipleship_follow_up: { icon: BookOpen, accent: "primary" },
  worship_production: { icon: Music, accent: "primary" },
  security_medical: { icon: ShieldPlus, accent: "primary" },
  transportation_hospitality: { icon: Bus, accent: "primary" },
};

/** Each feature card's chip on the Features step. */
export const moduleMarks: Record<ModuleKey, Mark> = {
  tasks_boards: { icon: SquareKanban, accent: "primary" },
  departments_teams: { icon: Network, accent: "primary" },
  events_checkin: { icon: CalendarCheck, accent: "primary" },
  volunteer_management: { icon: HandHelping, accent: "primary" },
  church_partnerships: { icon: Handshake, accent: "primary" },
  church_maps: { icon: Map, accent: "primary" },
  outreach_planning: { icon: Route, accent: "primary" },
  social_marketing: { icon: Share2, accent: "primary" },
  budget_expenses: { icon: Receipt, accent: "support-2" },
  fundraising_donations: { icon: HandCoins, accent: "support-2" },
  registration_forms: { icon: ClipboardList, accent: "primary" },
  qr_response_forms: { icon: QrCode, accent: "primary" },
  discipleship_follow_up: { icon: Sprout, accent: "primary" },
  campaign_calendar: { icon: CalendarDays, accent: "primary" },
  documents_files: { icon: FolderOpen, accent: "primary" },
  communications: { icon: Mail, accent: "primary" },
  campaign_analytics: { icon: ChartColumn, accent: "primary" },
  ai_copilot: { icon: Sparkles, accent: "primary" },
};
