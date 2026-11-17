import { expect, it, vi } from "vitest";
import { can } from "../../src/lib/permissions";
import { effectiveNewsletterState, newsletterPage, newsletterStates, subscriberInput } from "../../src/lib/newsletter";
vi.mock('server-only', () => ({}));
it('newsletter permission matrix', () => { for (const role of ['owner', 'admin', 'member', 'viewer', 'unknown']) {
    expect(can(role, 'newsletter:manage')).toBe(['owner', 'admin'].includes(role));
    expect(can(role, 'newsletter:read')).toBe(['owner', 'admin', 'member'].includes(role));
} });
it('suppression always wins and consent never upgrades an opted-out list state', () => { for (const s of newsletterStates)
    for (const allowed of [true, false])
        expect(effectiveNewsletterState(s, true, allowed)).toBe('suppressed'); for (const s of ['unsubscribed', 'bounced', 'suppressed'] as const)
    expect(effectiveNewsletterState(s, false, true)).toBe(s); expect(effectiveNewsletterState('subscribed', false, false)).toBe('unsubscribed'); });
it('bounded UUID keyset and safe tags/provenance', () => { expect(newsletterPage.parse({}).limit).toBe(50); for (const p of [{ limit: 0 }, { limit: 101 }, { after: 'secret' }, { tag: 'email@example.test' }])
    expect(newsletterPage.safeParse(p).success).toBe(false); const id = '00000000-0000-4000-8000-000000000001'; expect(subscriberInput.parse({ contactId: id, tags: ['news', 'news', 'group-a'] }).tags).toEqual(['group-a', 'news']); expect(subscriberInput.safeParse({ contactId: id, source: 'csv_import' }).success).toBe(false); });
it('production route refuses before auth or database work', async () => { const { newsletterEnabled } = await import('../../src/server/newsletter'); const { newsletterRoute } = await import('../../src/server/newsletter-route'); expect(newsletterEnabled({ NODE_ENV: 'production' })).toBe(false); vi.stubEnv('NODE_ENV', 'production'); try {
    const run = vi.fn();
    const r = await newsletterRoute(run, false)(new Request('https://harvest.test'), { params: Promise.resolve({}) });
    expect(r.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
}
finally {
    vi.unstubAllEnvs();
} });
