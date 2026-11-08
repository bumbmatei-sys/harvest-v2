import { handleIntake } from "@/server/connect-intake-http";
export const runtime="nodejs";
export async function POST(request:Request) { return handleIntake(request); }
