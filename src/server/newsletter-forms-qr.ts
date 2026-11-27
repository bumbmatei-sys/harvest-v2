import type { Database } from "../db/client";
import { newsletterSignupLink } from "../lib/site-address";
import { qrColors, qrMatrix, qrPng, qrSvg } from "./connect-qr";
import { getCrmForm } from "./crm-forms";
import { message } from "../i18n/messages";

/** Null unless the form is a sign-up form that is published right now. The encoded text is only the public address. */
export async function signupFormQr(db: Database, userId: string, workspace: string, formId: string, format: "svg" | "png") {
  const form = await getCrmForm(db, userId, workspace, formId);
  if (!form.definition.newsletter || form.publication?.state !== "published") return null;
  const matrix = qrMatrix(newsletterSignupLink(form.publication.slug)), colors = qrColors("standard");
  return format === "png"
    ? { type: "image/png", body: new Uint8Array(qrPng(matrix, colors)), slug: form.publication.slug }
    : { type: "image/svg+xml", body: qrSvg(matrix, colors, message("NewsletterForms.share.qrTitle", { title: form.definition.title })), slug: form.publication.slug };
}
