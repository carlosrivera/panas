"use client";
import Link from "next/link";
import { useRef } from "react";
export function BecomePana() {
    const dialog = useRef<HTMLDialogElement>(null),
        trigger = useRef<HTMLButtonElement>(null);
    function close() {
        dialog.current?.close();
    }
    function open() {
        dialog.current?.showModal();
        dialog.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
    return (
        <>
            <aside className="pana-dock" aria-label="Get started with Panas">
                <button
                    ref={trigger}
                    className="dock-cta"
                    type="button"
                    aria-haspopup="dialog"
                    aria-controls="pick-a-side"
                    onClick={open}
                >
                    <span aria-hidden="true">🤝</span> become a pana
                </button>
                <p>test credits only · Apple Silicon Macs</p>
            </aside>
            <dialog
                id="pick-a-side"
                ref={dialog}
                aria-labelledby="pick-title"
                onClose={() => trigger.current?.focus({ preventScroll: true })}
                onClick={(event) => {
                    if (event.target === event.currentTarget) {
                        const bounds =
                            event.currentTarget.getBoundingClientRect();
                        if (
                            event.clientX < bounds.left ||
                            event.clientX > bounds.right ||
                            event.clientY < bounds.top ||
                            event.clientY > bounds.bottom
                        )
                            close();
                    }
                }}
            >
                <div className="pick-header">
                    <span>pick a side</span>
                    <button
                        type="button"
                        onClick={close}
                        aria-label="Close role picker"
                    >
                        esc ✕
                    </button>
                </div>
                <h2 id="pick-title">what kind of pana are you?</h2>
                <div className="pick-options">
                    <Link
                        href="/guides/buyer"
                        onClick={close}
                        className="pick-option"
                    >
                        <span className="pick-verb">seek</span>
                        <span className="pick-line">
                            my agent needs compute.
                        </span>
                        <span className="pick-detail">
                            one local MCP facade · fixed quotes · caps you set
                        </span>
                        <span className="pick-link">connect your agent →</span>
                    </Link>
                    <Link
                        href="/guides/provider"
                        onClick={close}
                        className="pick-option"
                    >
                        <span className="pick-verb">expose</span>
                        <span className="pick-line">
                            my Mac has room to help.
                        </span>
                        <span className="pick-detail">
                            Apple Silicon · native Ollama · launch checks
                        </span>
                        <span className="pick-link">prepare your Mac →</span>
                    </Link>
                </div>
                <p className="pick-footer">
                    you can be both. operator enrollment is required.
                </p>
            </dialog>
        </>
    );
}
