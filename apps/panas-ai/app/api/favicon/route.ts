import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const domain = searchParams.get("domain");

    if (!domain) {
        return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&size=64`;

    try {
        const response = await fetch(faviconUrl);
        if (response.ok) {
            return NextResponse.json({ faviconUrl });
        } else {
            return NextResponse.json(
                { error: "Favicon not found" },
                { status: 404 },
            );
        }
    } catch (error) {
        console.error("Error fetching favicon:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
