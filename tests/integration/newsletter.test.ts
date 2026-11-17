import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDatabase } from '../database';
import { users } from '../../src/db/schema';
import { createWorkspace } from '../../src/server/workspaces';
import { createContact, recordConsent } from '../../src/server/contacts';
import { createNewsletterAudience, createNewsletterList, addNewsletterSubscriber, updateNewsletterSubscriber, setNewsletterSubscription, listNewsletterSubscribers, createNewsletterSegment, pageNewsletterConfiguration } from '../../src/server/newsletter';
import { createView,updateView } from '../../src/server/crm-views';
import { fullState } from '../../src/lib/crm-fields';
import { withTenant } from '../../src/server/tenancy';
import { mayContact } from '../../src/server/consent-gate';
vi.mock('server-only', () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, audience: string, list: string;
let n = 0;
const person = async () => { const p = await createContact(f.db, 'n-owner', a, { name: `Synthetic ${++n}`, email: `synthetic-${n}@example.test`, notes: '' }); return p.id; };
const consent = (id: string, status: 'granted' | 'withdrawn' | 'unknown', channel: 'email' | 'sms' | 'social' = 'email') => recordConsent(f.db, 'n-owner', a, id, { noticeVersion: 'notice-v1', purpose: 'newsletter', channel, status, source: 'synthetic', evidence: 'synthetic test evidence' });
const subscriber = async (grant = true) => { const id = await person(); if (grant)
    await consent(id, 'granted'); return { contact: id, ...await addNewsletterSubscriber(f.db, 'n-owner', a, { contactId: id }) }; };
beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected_network'));
    let upgraded = false;
    f = await testDatabase({ migrationOwner: true, beforeNewsletterMigration: async (admin) => { expect((await admin.query("select to_regclass('public.newsletter_audiences') as t")).rows[0].t).toBeNull(); expect((await admin.query("select to_regclass('public.community_live_events') as t")).rows[0].t).toBeTruthy(); upgraded = true; } });
    expect(upgraded).toBe(true);
    await f.db.insert(users).values(['n-owner', 'n-admin', 'n-member', 'n-viewer', 'n-foreign'].map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
    a = (await createWorkspace(f.db, 'n-owner', 'Newsletter ministry', 'church')).tenantId;
    b = (await createWorkspace(f.db, 'n-foreign', 'Other ministry', 'church')).tenantId;
    await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,'n-admin','admin'),($1,'n-member','member'),($1,'n-viewer','viewer')", [a]);
    audience = (await createNewsletterAudience(f.db, 'n-owner', a, { name: 'Audience' })).id;
    list = (await createNewsletterList(f.db, 'n-owner', a, audience, { name: 'News' })).id;
}, 90000);
afterAll(async () => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); await f?.close(); });
it('permission matrix and two-tenant RLS hold in services and direct SQL', async () => {
    for (const u of ['n-owner', 'n-admin', 'n-member'])
        expect((await pageNewsletterConfiguration(f.db, u, a, 'audiences')).items).toHaveLength(1);
    for (const u of ['n-viewer', 'n-foreign'])
        await expect(pageNewsletterConfiguration(f.db, u, a, 'audiences')).rejects.toMatchObject({ status: 403 });
    for (const u of ['n-member', 'n-viewer'])
        await expect(createNewsletterAudience(f.db, u, a, { name: 'Denied' })).rejects.toMatchObject({ status: 403 });
    await expect(createNewsletterList(f.db, 'n-foreign', b, audience, { name: 'Foreign' })).rejects.toMatchObject({ status: 404 });
    const rows = await withTenant(f.db, 'n-foreign', b, 'newsletter:manage', tx => tx.execute(sql `select * from newsletter_audiences`));
    expect(rows.rows).toEqual([]);
    const direct = await withTenant(f.db, 'n-viewer', a, 'workspace:read', tx => tx.execute(sql `select * from newsletter_audiences`));
    expect(direct.rows).toEqual([]);
    await expect(withTenant(f.db, 'n-member', a, 'workspace:read', tx => tx.execute(sql `insert into newsletter_audiences(tenant_id,name,created_by) values(${a}::uuid,'bypass','n-member')`))).rejects.toThrow();
});
it('subscription requires email grant, no consent creation or copied person data', async () => {
    const s = await subscriber(false);
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 })).rejects.toMatchObject({ status: 403 });
    await consent(s.contact, 'granted', 'sms');
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 })).rejects.toMatchObject({ status: 403 });
    const grant = await consent(s.contact, 'granted');
    const out = await setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 });
    expect(out.state).toBe('subscribed');
    const stored = (await f.admin.query('select consent_id,purpose from newsletter_subscriptions where subscriber_id=$1', [s.id])).rows[0];
    expect(stored).toEqual({ consent_id: grant.id, purpose: 'newsletter' });
    expect((await f.admin.query("select column_name from information_schema.columns where table_name='newsletter_subscribers' and column_name in ('name','email','phone')")).rows).toEqual([]);
});
it('any-channel withdrawals, both clocks and effective read state match mayContact', async () => {
    const s = await subscriber();
    await setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 });
    await consent(s.contact, 'withdrawn', 'social');
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 1 })).rejects.toMatchObject({ status: 403 });
    const page = await listNewsletterSubscribers(f.db, 'n-member', a, list);
    expect(page.subscribers.find(r => r.id === s.id)?.state).toBe('unsubscribed');
    await consent(s.contact, 'granted');
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 1 })).rejects.toMatchObject({ status: 403 });
    // A backdated same-channel grant cannot clear the withdrawal, even if recorded later.
    await recordConsent(f.db, 'n-owner', a, s.contact, { noticeVersion: 'notice-v1', purpose: 'newsletter', channel: 'social', status: 'granted', source: 'synthetic', evidence: 'backdated test', occurredAt: '2000-01-01T00:00:00Z' });
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 1 })).rejects.toMatchObject({ status: 403 });
    await consent(s.contact, 'granted', 'social');
    expect((await setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 1 })).state).toBe('subscribed');
});
it('global/list suppression is sticky across grants and import replay', async () => {
    const s = await subscriber();
    await setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 });
    await updateNewsletterSubscriber(f.db, 'n-owner', a, s.id, { version: 1, suppressed: true });
    await consent(s.contact, 'granted');
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await addNewsletterSubscriber(f.db, 'n-owner', a, { contactId: s.contact })).suppressed).toBe(true);
    expect((await listNewsletterSubscribers(f.db, 'n-member', a, list)).subscribers.find(r => r.id === s.id)?.state).toBe('suppressed');
    await expect(withTenant(f.db, 'n-owner', a, 'newsletter:manage', tx => tx.execute(sql `update newsletter_subscribers set suppressed=false where id=${s.id}::uuid`))).rejects.toThrow();
    const t = await subscriber();
    await setNewsletterSubscription(f.db, 'n-owner', a, list, t.id, { state: 'suppressed', version: 0 });
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, t.id, { state: 'subscribed', version: 1 })).rejects.toMatchObject({ status: 409 });
});
it('bounced/unsubscribed states do not become subscribed after a grant; stale updates fail', async () => {
    const s = await subscriber();
    await setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'bounced', version: 0 });
    await consent(s.contact, 'granted');
    expect((await listNewsletterSubscribers(f.db, 'n-member', a, list)).subscribers.find(r => r.id === s.id)?.state).toBe('bounced');
    await expect(setNewsletterSubscription(f.db, 'n-owner', a, list, s.id, { state: 'subscribed', version: 0 })).rejects.toMatchObject({ status: 409 });
});
it('CRM import provenance is referenced and immutable; fabricated provenance is refused', async () => {
    const s = await person();
    await expect(addNewsletterSubscriber(f.db, 'n-owner', a, { contactId: s, source: 'csv_import', importId: '00000000-0000-4000-8000-000000000001', rowNumber: 1 })).rejects.toThrow();
    const { createImport, previewImport, commitImport } = await import('../../src/server/crm-imports');
    const imp = await createImport(f.db, 'n-owner', a, { entity: 'person', clientKey: '00000000-0000-4000-8000-000000000123', fileName: 'synthetic.csv', csv: 'name,email\nImported subscriber,imported-newsletter@example.test' });
    await previewImport(f.db, 'n-owner', a, imp.id, { version: imp.version });
    await commitImport(f.db, 'n-owner', a, imp.id);
    const importedContact = (await f.admin.query("select contact_id from contact_source_events where import_id=$1", [imp.id])).rows[0].contact_id;
    const imported = await addNewsletterSubscriber(f.db, 'n-owner', a, { contactId: importedContact, source: 'csv_import', importId: imp.id, rowNumber: 1 });
    const stored = (await f.admin.query('select source,import_id,row_number,imported_at,created_by from newsletter_import_provenance where subscriber_id=$1', [imported.id])).rows[0];
    expect(stored).toMatchObject({ source: 'csv_import', import_id: imp.id, row_number: 1, created_by: 'n-owner' });
    expect(stored.imported_at).toBeTruthy();
    expect((await withTenant(f.db, 'n-member', a, 'newsletter:read', tx => tx.execute(sql `select * from newsletter_import_provenance`))).rows).toEqual([]);
    expect((await addNewsletterSubscriber(f.db, 'n-owner', a, { contactId: importedContact })).replayed).toBe(true);
});
it('bounded keyset pages, tag filtering and canonical CRM saved-segment predicates', async () => {
    const localList = (await createNewsletterList(f.db, 'n-owner', a, audience, { name: 'Paged' })).id;
    const ids = [];
    for (let i = 0; i < 5; i++) {
        const s = await subscriber();
        await updateNewsletterSubscriber(f.db, 'n-owner', a, s.id, { version: 1, tags: [i % 2 ? 'odd' : 'even'] });
        await setNewsletterSubscription(f.db, 'n-owner', a, localList, s.id, { state: 'subscribed', version: 0 });
        ids.push(s.id);
    }
    let after: string | undefined;
    const collected: string[] = [];
    do {
        const p = await listNewsletterSubscribers(f.db, 'n-member', a, localList, { limit: 2, ...(after ? { after } : {}) });
        collected.push(...p.subscribers.map(s => s.id));
        after = p.nextCursor ?? undefined;
    } while (after);
    expect(collected).toEqual(ids.sort());
    expect(new Set(collected).size).toBe(5);
    expect((await listNewsletterSubscribers(f.db, 'n-member', a, localList, { tag: 'even' })).subscribers).toHaveLength(3);
    const view = await createView(f.db, 'n-owner', a, { objectType: 'person', name: 'Newsletter people', shared: true, state: fullState({ filters: [{ field: 'name', op: 'contains', value: 'Synthetic' }] }) });
    const seg = await createNewsletterSegment(f.db, 'n-owner', a, audience, { name: 'Shared segment', savedViewId: view.id });
    expect((await listNewsletterSubscribers(f.db, 'n-member', a, localList, { segmentId: seg.id })).subscribers).toHaveLength(5);
});
it('SQL defense matches canonical consent gate for none/grant/unknown/withdrawal/regrant and blocks direct bypass', async () => {
    for (const shape of ['none', 'grant', 'unknown', 'withdrawn', 'regrant']) {
        const s = await subscriber(false);
        if (shape !== 'none')
            await consent(s.contact, 'granted');
        if (['unknown', 'withdrawn', 'regrant'].includes(shape))
            await consent(s.contact, shape === 'unknown' ? 'unknown' : 'withdrawn');
        if (shape === 'regrant')
            await consent(s.contact, 'granted');
        await withTenant(f.db, 'n-owner', a, 'newsletter:manage', async (tx) => { const gate = await mayContact(tx, a, s.contact, 'newsletter', 'email'); const c = gate.allowed ? gate.consentId : (await f.admin.query("select id from contact_consents where contact_id=$1 and status='granted' limit 1", [s.contact])).rows[0]?.id ?? null; const db = (await tx.execute<{
            ok: boolean;
        }>(sql `select coalesce(public.newsletter_consent_allowed(${a}::uuid,${s.contact}::uuid,${c}::uuid),false) as ok`)).rows[0].ok; expect(db).toBe(gate.allowed); });
        if (shape === 'none')
            await expect(withTenant(f.db, 'n-owner', a, 'newsletter:manage', tx => tx.execute(sql `insert into newsletter_subscriptions(tenant_id,list_id,subscriber_id,state) values(${a}::uuid,${list}::uuid,${s.id}::uuid,'subscribed')`))).rejects.toThrow();
    }
});
it('audit metadata excludes contact methods, tags, consent evidence and provider paths', async () => {
    const logs = (await f.admin.query("select metadata from audit_logs where action like 'newsletter.%'")).rows;
    expect(logs.length).toBeGreaterThan(0);
    for (const { metadata } of logs) {
        expect(Object.keys(metadata).every(k => ['contactId', 'source', 'importId', 'rowNumber', 'listId', 'from', 'to', 'version', 'consentId', 'suppressed', 'audienceId', 'savedViewId'].includes(k))).toBe(true);
    }
    const tables = (await f.admin.query("select relname,relforcerowsecurity from pg_class where relname in ('newsletter_audiences','newsletter_lists','newsletter_subscribers','newsletter_subscriptions','newsletter_segments','newsletter_import_provenance')")).rows;
    expect(tables).toHaveLength(6);
    expect(tables.every(t => t.relforcerowsecurity)).toBe(true);
});

it('CRM member edits invalidate a pinned segment instead of silently broadening it',async()=>{
 const v=await createView(f.db,'n-owner',a,{objectType:'person',name:'Pinned view',shared:true,state:fullState({q:'Synthetic'})});
 const segment=await createNewsletterSegment(f.db,'n-owner',a,audience,{name:'Pinned segment',savedViewId:v.id});
 await updateView(f.db,'n-member',a,'person',v.id,{version:v.version,state:fullState({})});
 await expect(listNewsletterSubscribers(f.db,'n-member',a,list,{segmentId:segment.id})).rejects.toMatchObject({status:404});
});
