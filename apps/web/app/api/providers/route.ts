import { createPublicRead } from "../../../lib/public-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    return createPublicRead({ url: process.env.PUBLIC_REGISTRY_URL })(
        new URL(request.url).searchParams,
    );
}
