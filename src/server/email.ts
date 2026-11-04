import { Resend } from "resend";
import { requiredEnv } from "../lib/env";
export async function sendSignInCode(email: string, otp: string) {
  const resend = new Resend(requiredEnv("RESEND_API_KEY"));
  const { error } = await resend.emails.send({
    from: requiredEnv("EMAIL_FROM"), to: email, subject: "Your Harvest sign-in code",
    text: `Your Harvest sign-in code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
  });
  if (error) throw new Error("Email delivery failed. Please try again later.");
}
