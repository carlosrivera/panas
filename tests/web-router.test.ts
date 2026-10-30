import { expect, it, vi } from "vitest";
import { routeWebRequest } from "../scripts/edge/web-router.mjs";

it.each(["/registry", "/registry/mcp", "/accounting/purchase?request=x%2Fy"])(
    "preserves the original API request and streaming response at %s",
    async (path) => {
        const request = new Request(`https://panas.mcpwire.co${path}`, {
            method: "POST",
            headers: {
                authorization: "Bearer fixture",
                "content-type": "application/json",
            },
            body: '{"signed":"fixture"}',
        });
        const response = new Response("event: message\ndata: fixture\n\n", {
            headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
            },
        });
        const upstream = vi.fn<typeof fetch>(async () => response);
        expect(await routeWebRequest(request, upstream)).toBe(response);
        expect(upstream).toHaveBeenCalledExactlyOnceWith(request);
        expect(await request.text()).toBe('{"signed":"fixture"}');
    },
);

it("loads static assets from Pages without forwarding credentials or query strings", async () => {
    const upstream = vi.fn<typeof fetch>(
        async () => new Response("video", { status: 206 }),
    );
    const response = await routeWebRequest(
        new Request("https://panas.mcpwire.co/video.mp4?token=fixture", {
            headers: {
                authorization: "Bearer fixture",
                cookie: "private=fixture",
                range: "bytes=0-99",
            },
        }),
        upstream,
    );
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe("https://carlosrivera.github.io/panas/video.mp4");
    expect(new Headers(init?.headers).get("range")).toBe("bytes=0-99");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(init?.redirect).toBe("manual");
    expect(response.status).toBe(206);
    expect(response.headers.get("x-panas-web-host")).toBe("github-pages");
});

it("keeps trailing-slash redirects and provider IDs on the public hostname", async () => {
    const response = await routeWebRequest(
        new Request("https://panas.mcpwire.co/providers/detail?id=fixture"),
        async () =>
            new Response(null, {
                status: 301,
                headers: {
                    location:
                        "https://carlosrivera.github.io/panas/providers/detail/",
                },
            }),
    );
    expect(response.headers.get("location")).toBe(
        "https://panas.mcpwire.co/providers/detail/?id=fixture",
    );
});

it("does not follow or expose unexpected upstream redirects", async () => {
    const response = await routeWebRequest(
        new Request("https://panas.mcpwire.co/"),
        async () =>
            new Response(null, {
                status: 302,
                headers: { location: "https://other.example/" },
            }),
    );
    expect(response.status).toBe(502);
    expect(response.headers.has("location")).toBe(false);
});

it("rejects website writes before contacting GitHub", async () => {
    const upstream = vi.fn();
    const response = await routeWebRequest(
        new Request("https://panas.mcpwire.co/guides/provider/", {
            method: "POST",
            body: "private",
        }),
        upstream,
    );
    expect(response.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
});
