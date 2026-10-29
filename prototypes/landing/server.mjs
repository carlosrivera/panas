import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const VIDEO = process.env.VIDEO ?? join(here, "video.mp4");
const PORT = Number(process.env.PORT ?? 6666);

createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        createReadStream(join(here, "index.html")).pipe(res);
        return;
    }
    if (url.pathname === "/video.mp4") {
        const { size } = statSync(VIDEO);
        const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
        if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Number(range[2]) : size - 1;
            res.writeHead(206, {
                "Content-Type": "video/mp4",
                "Content-Range": `bytes ${start}-${end}/${size}`,
                "Content-Length": end - start + 1,
                "Accept-Ranges": "bytes",
            });
            createReadStream(VIDEO, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                "Content-Type": "video/mp4",
                "Content-Length": size,
                "Accept-Ranges": "bytes",
            });
            createReadStream(VIDEO).pipe(res);
        }
        return;
    }
    res.writeHead(404).end();
}).listen(PORT, () => console.log(`ascii video → http://localhost:${PORT}`));
