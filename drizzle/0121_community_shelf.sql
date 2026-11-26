-- C13 classroom and C16 products shelf: members read what their community shows. Policies only, no new table, no definer and no session flag.
-- A shelf link stays a pointer to the canonical catalogue item: it grants nothing. Opening an item still needs the person's own free enrolment
-- (public.catalog_access), so access follows the existing course and product rules.
-- The links of a community the caller can read (active membership with a valid grant, or a community host role), the same test as the forum.
CREATE POLICY community_shelf_member ON public.community_product_links FOR SELECT TO harvest_app
  USING (public.community_can_read(tenant_id, community_id));--> statement-breakpoint
-- Published listed or unlisted items on such a shelf. Drafts, hidden and archived items stay with the ministry's catalogue staff.
CREATE POLICY catalog_community_shelf ON public.catalog_items FOR SELECT TO harvest_app
  USING (state = 'published' AND visibility IN ('listed', 'unlisted') AND EXISTS (
    SELECT FROM public.community_product_links l
    WHERE l.tenant_id = catalog_items.tenant_id AND l.item_id = catalog_items.id AND public.community_can_read(l.tenant_id, l.community_id)));
