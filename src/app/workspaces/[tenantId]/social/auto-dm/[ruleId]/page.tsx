import { SenderProvider } from "@/components/social/auto-dm/sender-state";
import { SOCIAL_AUTO_DM_SENDER_ENABLED } from "@/server/social/auto-dm-worker";
import { AccessState } from "@/components/access-state";
import { RuleScreen } from "@/components/social/auto-dm/rule-screen";
import { uuidInput } from "@/lib/contact-input";
import { autoDmPageContext } from "@/server/social-auto-dm-page";

type Props = { params: Promise<{ tenantId: string; ruleId: string }> };

export default async function AutoDmRulePage({ params }: Props) {
  const context = await autoDmPageContext(params);
  const { ruleId } = await params;
  return context && uuidInput.safeParse(ruleId).success ? <SenderProvider sendEnabled={SOCIAL_AUTO_DM_SENDER_ENABLED}><RuleScreen tenantId={context.tenantId} ruleId={ruleId} you={context.you} /></SenderProvider> : <AccessState />;
}
