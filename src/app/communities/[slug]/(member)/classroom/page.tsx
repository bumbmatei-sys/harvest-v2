import { CommunityShelfPage } from "@/components/communities/community-shelf-page";

type Props = { params: Promise<{ slug: string }> };

// C13: the community Classroom tab. The courses the community shows; opening one follows the canonical course access check.
export default async function ClassroomPage({ params }: Props) { return <CommunityShelfPage slug={(await params).slug} kind="course" />; }
