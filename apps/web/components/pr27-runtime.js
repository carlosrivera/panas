/** Original PR27 runtime, with React lifecycle cleanup only. */
export function initLanding() {
    const RAMP =
        " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
    const CELL = 5; // css px per glyph column inside the window
    const CONTRAST = 1.35;
    const INK = [0.42, 0.42, 0.4]; // muted grey glyphs
    const FPS = 30;
    const FRAME_W = 320; // captured luma resolution (height follows aspect)

    // one offscreen GL canvas renders each frame; it is then copied into every window
    let disposed = false,
        frameHandle = 0;
    const abort = new AbortController();
    const listen = (target, type, callback) =>
        target.addEventListener(type, callback, { signal: abort.signal });
    const raf = (callback) => {
        frameHandle = requestAnimationFrame(callback);
    };
    const canvas = document.createElement("canvas");
    const outputs = [...document.querySelectorAll(".clip canvas")].map((c) =>
        c.getContext("2d"),
    );
    const video = document.getElementById("v");
    const cta = document.getElementById("cta");
    const pick = document.getElementById("pick");
    const gl = canvas.getContext("webgl2", {
        antialias: false,
        preserveDrawingBuffer: true,
    });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    listen(cta, "click", () => {
        pick.showModal();
        pick.querySelector(".pick-option").focus();
    });
    listen(pick.querySelector(".pick-close"), "click", () => pick.close());
    listen(pick, "click", (event) => {
        if (event.target === pick) pick.close();
    });
    listen(pick, "close", () => cta.focus());

    const dragCleanups = [];
    initDragWindows();
    if (gl) start();
    return () => {
        disposed = true;
        abort.abort();
        for (const end of dragCleanups) end();
        cancelAnimationFrame(frameHandle);
        video.pause();
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };

    function start() {
        const vert = `#version 300 es
    in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

        const frag = `#version 300 es
    precision highp float;
    uniform sampler2D uFrame;   // single-channel luma
    uniform sampler2D uAtlas;
    uniform vec2 uRes;
    uniform vec2 uFrameSize;
    uniform float uCell;
    uniform float uGlyphs;
    uniform float uContrast;
    uniform vec3 uInk;
    out vec4 outColor;

    vec2 coverUV(vec2 uv) {
        float sr = uRes.x / uRes.y, vr = uFrameSize.x / uFrameSize.y;
        vec2 s = sr > vr ? vec2(1.0, vr / sr) : vec2(sr / vr, 1.0);
        return (uv - 0.5) * s + 0.5;
    }

    void main() {
        vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
        vec2 cellSize = vec2(uCell, uCell * 1.8);
        vec2 cell = floor(px / cellSize);
        float lum = texture(uFrame, coverUV((cell + 0.5) * cellSize / uRes)).r;
        lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);

        float idx = floor(lum * (uGlyphs - 1.0) + 0.5);
        vec2 local = fract(px / cellSize);
        float mask = texture(uAtlas, vec2((idx + local.x) / uGlyphs, local.y)).r;

        vec3 bg = vec3(0.043, 0.043, 0.039);
        outColor = vec4(mix(bg, uInk, mask), 1.0);
    }`;

        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
        gl.linkProgram(prog);
        gl.useProgram(prog);

        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 3, -1, -1, 3]),
            gl.STATIC_DRAW,
        );
        const loc = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const u = (n) => gl.getUniformLocation(prog, n);
        const texture = (unit) => {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_S,
                gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_T,
                gl.CLAMP_TO_EDGE,
            );
            return t;
        };
        const frameTex = texture(0);
        const atlasTex = texture(1);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        let frames = [];
        let frameW = FRAME_W,
            frameH = 180;
        let shown = -1;
        const dpr = Math.min(devicePixelRatio || 1, 3);
        canvas.width = 320 * dpr;
        canvas.height = 180 * dpr;
        for (const o of outputs) {
            o.canvas.width = canvas.width;
            o.canvas.height = canvas.height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);

        const buildAtlas = async () => {
            await document.fonts.load('64px "Paper Mono"').catch(() => {});
            const gw = 48,
                gh = 86;
            const c = document.createElement("canvas");
            c.width = gw * RAMP.length;
            c.height = gh;
            const x = c.getContext("2d");
            x.fillStyle = "#000";
            x.fillRect(0, 0, c.width, c.height);
            x.fillStyle = "#fff";
            x.textAlign = "center";
            x.textBaseline = "middle";
            x.font = '500 64px "Paper Mono", ui-monospace, Menlo, monospace';
            [...RAMP].forEach((ch, i) =>
                x.fillText(ch, i * gw + gw / 2, gh / 2 + 2),
            );
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, atlasTex);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                c,
            );
        };

        // Decode the clip once by seeking so hover playback never waits on the decoder.
        const captureFrames = async () => {
            if (video.readyState < 1)
                await new Promise((r) =>
                    video.addEventListener("loadedmetadata", r, {
                        once: true,
                        signal: abort.signal,
                    }),
                );
            if (disposed) return [];
            frameH = Math.round(
                (FRAME_W * video.videoHeight) / video.videoWidth,
            );
            const c = document.createElement("canvas");
            c.width = frameW;
            c.height = frameH;
            const x = c.getContext("2d", { willReadFrequently: true });
            const count = Math.max(1, Math.floor(video.duration * FPS));
            const out = [];
            for (let i = 0; i < count; i++) {
                if (disposed) return [];
                video.currentTime = Math.min(i / FPS, video.duration - 0.001);
                await new Promise((r) =>
                    video.addEventListener("seeked", r, { once: true }),
                );
                x.drawImage(video, 0, 0, frameW, frameH);
                const rgba = x.getImageData(0, 0, frameW, frameH).data;
                const luma = new Uint8Array(frameW * frameH);
                for (let p = 0, q = 0; p < luma.length; p++, q += 4) {
                    luma[p] =
                        (rgba[q] * 54 + rgba[q + 1] * 183 + rgba[q + 2] * 19) >>
                        8;
                }
                out.push(luma);
            }
            return out;
        };

        function render() {
            if (disposed || !frames.length) return;
            const idx = Math.round(head);
            if (idx !== shown) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, frameTex);
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.R8,
                    frameW,
                    frameH,
                    0,
                    gl.RED,
                    gl.UNSIGNED_BYTE,
                    frames[idx],
                );
                shown = idx;
            }
            gl.uniform1i(u("uFrame"), 0);
            gl.uniform1i(u("uAtlas"), 1);
            gl.uniform2f(u("uRes"), canvas.width, canvas.height);
            gl.uniform2f(u("uFrameSize"), frameW, frameH);
            gl.uniform1f(u("uCell"), CELL * dpr);
            gl.uniform1f(u("uGlyphs"), RAMP.length);
            gl.uniform1f(u("uContrast"), CONTRAST);
            gl.uniform3fv(u("uInk"), INK);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            for (const o of outputs) o.drawImage(canvas, 0, 0);
        }

        // Windows always show a frame. Hover plays once and holds the last frame; leaving resets to the first.
        let head = 0,
            hovering = false,
            last = 0,
            running = false;
        const tick = (now) => {
            if (disposed || !hovering) {
                running = false;
                last = 0;
                return;
            }
            const dt = last ? (now - last) / 1000 : 0;
            last = now;
            const end = frames.length - 1;
            head = Math.min(end, head + dt * FPS);
            render();
            if (head < end) raf(tick);
            else {
                running = false;
                last = 0;
            }
        };
        const enter = () => {
            hovering = true;
            if (!frames.length) return;
            if (reduced) {
                head = frames.length - 1;
                render();
                return;
            }
            render();
            if (!running) {
                running = true;
                raf(tick);
            }
        };
        const leave = () => {
            hovering = false;
            head = 0;
            render();
        };
        listen(cta, "pointerenter", enter);
        listen(cta, "pointerleave", leave);
        listen(cta, "focus", enter);
        listen(cta, "blur", leave);

        Promise.all([buildAtlas(), captureFrames()]).then(([, f]) => {
            if (disposed) return;
            frames = f;
            shown = -1;
            if (hovering) enter();
            else render();
        });
    }
    function initDragWindows() {
        // Drag the handshake windows around. Offsets live in a transform so the
        // responsive base position from CSS stays intact.
        const KEEP_VISIBLE = 48; // px of a window that must stay on screen
        for (const win of document.querySelectorAll(".clip")) {
            let x = 0,
                y = 0,
                drag = null;
            listen(win, "pointerdown", (e) => {
                if (e.button !== 0) return;
                // the latest grabbed window stacks above its siblings (still under the copy)
                win.parentElement.appendChild(win);
                const r = win.getBoundingClientRect();
                drag = {
                    px: e.clientX,
                    py: e.clientY,
                    x,
                    y,
                    left: r.left - x,
                    top: r.top - y,
                    w: r.width,
                    h: r.height,
                };
                win.setPointerCapture(e.pointerId);
                win.classList.add("dragging");
            });
            listen(win, "pointermove", (e) => {
                if (!drag) return;
                const minX = KEEP_VISIBLE - drag.w - drag.left,
                    maxX = innerWidth - KEEP_VISIBLE - drag.left;
                const minY = -drag.top,
                    maxY = innerHeight - KEEP_VISIBLE - drag.top;
                x = Math.min(
                    maxX,
                    Math.max(minX, drag.x + e.clientX - drag.px),
                );
                y = Math.min(
                    maxY,
                    Math.max(minY, drag.y + e.clientY - drag.py),
                );
                win.style.transform = `translate(${x}px, ${y}px)`;
            });
            const end = () => {
                drag = null;
                win.classList.remove("dragging");
            };
            listen(win, "pointerup", end);
            listen(win, "pointercancel", end);
            dragCleanups.push(end);
        }
    }
}
