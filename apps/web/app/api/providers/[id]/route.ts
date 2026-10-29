import { createPublicRead } from "../../../../lib/public-server";
export const dynamic = "force-dynamic";
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    return createPublicRead({ url: process.env.PUBLIC_REGISTRY_URL })(
        new URLSearchParams(),
        id,
    );
}
