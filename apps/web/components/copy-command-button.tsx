"use client";

import { useState } from "react";

export function CopyCommandButton({ command }: { command: string }) {
    const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

    async function copy() {
        try {
            await navigator.clipboard.writeText(command);
            setStatus("copied");
        } catch {
            setStatus("error");
        }
    }

    return (
        <div className="copy-command">
            <button
                type="button"
                onClick={copy}
                className="copy-command-button"
            >
                {status === "copied" ? "Copied" : "Copy command"}
            </button>
            <span role="status" className="copy-command-status">
                {status === "error"
                    ? "Couldn’t copy. Select and copy the command below."
                    : status === "copied"
                      ? "Command copied to clipboard."
                      : ""}
            </span>
        </div>
    );
}
