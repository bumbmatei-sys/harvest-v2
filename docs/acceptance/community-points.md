# Community points and challenges

The points API is at `/api/workspaces/:tenantId/communities/:communityId/points`. Active community members can read it. Community owners, admins and moderators can configure points and levels, create challenges, confirm or revoke attendance, and hide or restore a member on the leaderboard. Members can join a challenge before its end.

Points and challenges are off until a host enables them in settings. The defaults award 5 points for a visible post, 2 for a visible reply, 10 for completing a published lesson on the community's course shelf, and 15 for confirmed attendance at a published event linked to the community. The first level starts at zero. The default thresholds for the following levels are 25, 100 and 250 points. Changes to weights and thresholds apply to existing activity. Attendance is confirmed by a host after the event starts.

The leaderboard returns up to 100 active, visible members with positive scores for a rolling 7 days, 30 days or all time. Level always uses the lifetime score. Removing or holding a post also removes its replies from the score. An unpublished or removed lesson, removed placement, reversed completion or revoked attendance no longer contributes.

Challenge progress counts eligible actions from the later of enrollment or the challenge start until its exclusive end. A progress read records the date of the qualifying action when the participant first reaches the target. A recorded completion is retained if the underlying progress later changes. The API returns each member's own progress and completion only.
