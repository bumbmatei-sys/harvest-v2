import { AccessState } from "@/components/access-state";
import { RuleScreen } from "@/components/social/auto-dm/rule-screen";
import { autoDmPageContext } from "@/server/social-auto-dm-page";

type Props = { params: Promise<{ tenantId: string }> };

export default async function NewAutoDmRulePage({ params }: Props) {
  const context = await autoDmPageContext(params);
  return context ? <RuleScreen tenantId={context.tenantId} ruleId={null} you={context.you} /> : <AccessState />;
}
