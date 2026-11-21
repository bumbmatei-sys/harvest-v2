import { SenderProvider } from "@/components/social/auto-dm/sender-state";
import { SOCIAL_AUTO_DM_SENDER_ENABLED } from "@/server/social/auto-dm-worker";
import { AccessState } from "@/components/access-state";
import { RuleScreen } from "@/components/social/auto-dm/rule-screen";
import { autoDmPageContext } from "@/server/social-auto-dm-page";

type Props = { params: Promise<{ tenantId: string }> };

export default async function NewAutoDmRulePage({ params }: Props) {
  const context = await autoDmPageContext(params);
  return context ? <SenderProvider sendEnabled={SOCIAL_AUTO_DM_SENDER_ENABLED}><RuleScreen tenantId={context.tenantId} ruleId={null} you={context.you} /></SenderProvider> : <AccessState />;
}
