export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkNewsletterSuppressionStartup } = await import("./server/newsletter-campaigns/suppression-keys");
    checkNewsletterSuppressionStartup("web");
  }
}
