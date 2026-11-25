import { BookOpen, Bus, CalendarCheck, CalendarDays, ChartColumn, Church, Clapperboard, ClipboardList, Compass, FolderOpen, HandCoins, HandHeart, HandHelping, Handshake,
  Mail, Map, Megaphone, MessagesSquare, Music, Network, Package, PiggyBank, QrCode, Receipt, Route, Share2, ShieldPlus, Sparkles, Sprout, SquareKanban, Users,
  type LucideIcon } from "lucide-react";
import type { DepartmentKey, ModuleKey } from "@/lib/campaign-wizard";
import type { Accent } from "@/lib/theme-registry";

type Mark = { icon: LucideIcon; accent: Accent };

/** Each department's chip on the Teams step: its own icon, accents spread so neighbours differ. Decorative; the name is always beside it. */
export const departmentMarks: Record<DepartmentKey, Mark> = {
  campaign_leadership: { icon: Compass, accent: "indigo" },
  church_mobilization: { icon: Church, accent: "violet" },
  evangelistic_outreach: { icon: Megaphone, accent: "pink" },
  prayer_intercession: { icon: HandHeart, accent: "sky" },
  marketing_media: { icon: Clapperboard, accent: "amber" },
  logistics_equipment: { icon: Package, accent: "teal" },
  finance_fundraising: { icon: PiggyBank, accent: "emerald" },
  volunteers: { icon: Users, accent: "pink" },
  counseling: { icon: MessagesSquare, accent: "violet" },
  discipleship_follow_up: { icon: BookOpen, accent: "sky" },
  worship_production: { icon: Music, accent: "indigo" },
  security_medical: { icon: ShieldPlus, accent: "teal" },
  transportation_hospitality: { icon: Bus, accent: "amber" },
};

/** Each feature card's chip on the Features step. */
export const moduleMarks: Record<ModuleKey, Mark> = {
  tasks_boards: { icon: SquareKanban, accent: "violet" },
  departments_teams: { icon: Network, accent: "indigo" },
  events_checkin: { icon: CalendarCheck, accent: "pink" },
  volunteer_management: { icon: HandHelping, accent: "emerald" },
  church_partnerships: { icon: Handshake, accent: "amber" },
  church_maps: { icon: Map, accent: "teal" },
  outreach_planning: { icon: Route, accent: "pink" },
  social_marketing: { icon: Share2, accent: "sky" },
  budget_expenses: { icon: Receipt, accent: "amber" },
  fundraising_donations: { icon: HandCoins, accent: "emerald" },
  registration_forms: { icon: ClipboardList, accent: "violet" },
  qr_response_forms: { icon: QrCode, accent: "indigo" },
  discipleship_follow_up: { icon: Sprout, accent: "teal" },
  campaign_calendar: { icon: CalendarDays, accent: "pink" },
  documents_files: { icon: FolderOpen, accent: "amber" },
  communications: { icon: Mail, accent: "sky" },
  campaign_analytics: { icon: ChartColumn, accent: "violet" },
  ai_copilot: { icon: Sparkles, accent: "indigo" },
};
