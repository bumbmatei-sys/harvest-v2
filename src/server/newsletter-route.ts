import { getDb } from "@/db/client";
import { errorResponse, verifiedSessionUser, verifyOrigin } from "./http";
import { newsletterEnabled } from "./newsletter";
export function newsletterRoute<P>(run: (args: {
    db: ReturnType<typeof getDb>;
    getOwnAddress: () => string | undefined;
    user: string;
    params: P;
    body: unknown;
    request: Request;
}) => Promise<unknown>, write: boolean) {
    return async (request: Request, context: {
        params: Promise<P>;
    }) => {
        if (!newsletterEnabled())
            return new Response(null, { status: 404 });
        try {
            if (write)
                verifyOrigin(request);
            const sessionUser = await verifiedSessionUser(request), params = await context.params;
            const body = write && request.body ? await request.json() : undefined;
            return Response.json(await run({ db: getDb(), user: sessionUser.id, getOwnAddress: () => sessionUser.emailVerified ? sessionUser.email : undefined, params, body, request }), { headers: { 'Cache-Control': 'private, no-store' } });
        }
        catch (e) {
            return errorResponse(e);
        }
    };
}
export const newsletterQuery = (request: Request) => Object.fromEntries(new URL(request.url).searchParams.entries());
