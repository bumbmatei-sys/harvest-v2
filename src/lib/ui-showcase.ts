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
  { id: "primitives", sources: ["src/components/ui/spinner.tsx", "src/components/ui/scroll-area.tsx", "src/components/ui/toggle-group.tsx", "src/components/ui/kbd.tsx"], consumers: ["src/components/ministry-settings-form.tsx", "src/components/crm/tasks/notifications-menu.tsx", "src/components/dev/ui-showcase.tsx"] },
  { id: "toast", sources: ["src/components/ui/sonner.tsx", "src/lib/toast.ts"], consumers: ["src/components/ministry-settings-form.tsx", "src/app/layout.tsx"] },
  { id: "shell", sources: ["src/components/app-shell.tsx", "src/components/ministry-switcher.tsx", "src/lib/ministry-switcher.ts"], consumers: ["src/app/dev/ui/page.tsx", "src/app/workspaces/[tenantId]/layout.tsx", "src/app/profile/page.tsx"] },
  { id: "pageParts", sources: ["src/components/data-table.tsx", "src/components/empty-state.tsx", "src/components/status-badge.tsx", "src/components/confirm-dialog.tsx", "src/lib/data-table.ts", "src/lib/status-tone.ts"], consumers: ["src/components/files/file-list.tsx", "src/components/communities/communities-table.tsx", "src/components/crm/company-people.tsx", "src/components/communities/community-invites.tsx", "src/components/crm/list-page.tsx", "src/components/erase-contact.tsx", "src/components/communities/community-editor.tsx", "src/components/connect-admin/link-actions.tsx"] },
  { id: "forms", sources: ["src/components/stepper.tsx", "src/components/wizard-layout.tsx", "src/components/form-section.tsx", "src/components/sticky-save-bar.tsx", "src/hooks/use-harvest-form.ts", "src/lib/stepper.ts", "src/lib/form.ts", "src/lib/sticky-save-bar.ts"],
    consumers: ["src/components/editor/editor-shell.tsx", "src/components/communities/community-editor.tsx", "src/components/ministry-settings-form.tsx", "src/components/workspace-form.tsx", "src/components/account-profile-form.tsx", "src/app/workspaces/[tenantId]/crm/imports/[importId]/page.tsx"] },
  { id: "crm", sources: ["src/components/copy-button.tsx", "src/components/status-tracker.tsx", "src/components/crm/list-row-summary.tsx", "src/lib/copy-text.ts", "src/lib/status-tracker.ts"],
    consumers: ["src/components/crm/inline-field.tsx", "src/components/crm/contact-actions.tsx", "src/components/crm/record-grid.tsx", "src/app/workspaces/[tenantId]/crm/deals/[dealId]/page.tsx"] },
  { id: "permission", sources: ["src/components/permission-card.tsx", "src/lib/consent-controls.ts"],
    consumers: ["src/components/crm/associations/permission-row.tsx", "src/components/connect-admin/follow-up-consent.tsx", "src/components/crm/associations/contact-permissions.tsx"] },
  { id: "kit", sources: ["src/lib/ui-provenance.ts", "src/lib/theme-registry.ts"], consumers: ["src/components/dev/ui-showcase.tsx", "src/app/globals.css"] },
] as const;
export type UiShowcaseCategory = typeof uiShowcaseEntries[number]["id"];
