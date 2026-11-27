import { appOrigin, connectClaimLink } from "../lib/site-address";
import { Resend } from "resend";
import { requiredEnv } from "../lib/env";
import { message } from "../i18n/messages";
import type { InvitationSender } from "./connect-invitations";
// Intentionally not an environment toggle. A separate activation change/review is required.
export const CONNECT_INVITATION_LIVE_DELIVERY = false;
export const sendRealInvitation:InvitationSender=async mail=>{
 if(!CONNECT_INVITATION_LIVE_DELIVERY)throw new Error("CONNECT_DELIVERY_DISABLED");
 if(!appOrigin().startsWith("https:"))throw new Error("INVALID_DELIVERY_ORIGIN");
 const url=connectClaimLink(mail.token);
 const {error}=await new Resend(requiredEnv("RESEND_API_KEY")).emails.send({from:requiredEnv("EMAIL_FROM"),to:mail.to,
  subject:message("Invitations.emailSubject"),text:message("Invitations.emailBody",{url})},{idempotencyKey:mail.idempotencyKey,signal:mail.signal});
 if(error)throw new Error("CONNECT_DELIVERY_FAILED");
};
