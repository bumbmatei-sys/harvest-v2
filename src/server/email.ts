import { message } from "../i18n/messages";
import type { Locale } from "../i18n/locale";
import { Resend } from "resend";
import { requiredEnv } from "../lib/env";
export async function sendSignInCode(email: string, otp: string, locale: Locale = "en") {
  const resend = new Resend(requiredEnv("RESEND_API_KEY"));
  const { error } = await resend.emails.send({
    from: requiredEnv("EMAIL_FROM"), to: email, subject: message("Email.signInSubject", undefined, locale),
    text: message("Email.signInBody", { otp }, locale),
  });
  if (error) throw new Error(message("Errors.emailDeliveryFailedPleaseTryAgainLater"));
}
