import { handleIntake } from "@/server/connect-intake-http";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{kind:string;code:string}>}) {
  return handleIntake(request,await context.params);
}
