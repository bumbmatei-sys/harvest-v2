/** Production always wins over the opt-in development flag. */
export function uiShowcaseEnabled(environment: string | undefined, flag: string | undefined) {
  return environment === "development" && flag === "1";
}

/** Metadata only: examples use direct canonical imports, not a generic JSX engine. */
export const uiShowcaseEntries = [
  { id: "actions", sources: ["src/components/ui/button.tsx", "src/components/ui/button-group.tsx", "src/components/ui/tooltip.tsx"], consumers: ["src/components/app-shell.tsx", "src/components/crm/list-toolbar.tsx", "src/components/connect-admin/create-link-dialog.tsx"] },
  { id: "fields", sources: ["src/components/ui/field.tsx", "src/components/ui/input.tsx", "src/components/ui/textarea.tsx", "src/components/ui/native-select.tsx", "src/components/ui/checkbox.tsx", "src/components/ui/radio-group.tsx"], consumers: ["src/components/contact-form.tsx", "src/components/connect-admin/landing-editor.tsx"] },
  { id: "overlays", sources: ["src/components/ui/dialog.tsx", "src/components/ui/alert-dialog.tsx", "src/components/ui/sheet.tsx", "src/components/ui/popover.tsx", "src/components/ui/command.tsx", "src/components/ui/dropdown-menu.tsx"], consumers: ["src/components/crm/filter-builder.tsx", "src/components/connect-admin/link-actions.tsx"] },
  { id: "feedback", sources: ["src/components/ui/alert.tsx", "src/components/ui/empty.tsx", "src/components/ui/skeleton.tsx", "src/components/ui/badge.tsx", "src/components/ui/avatar.tsx"], consumers: ["src/components/crm/list-page.tsx", "src/components/connect-admin/landing-editor.tsx"] },
] as const;
export type UiShowcaseCategory = typeof uiShowcaseEntries[number]["id"];
