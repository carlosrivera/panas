"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import "../app/need-tabs.css";

type NeedTab = "free" | "paid";

export function NeedTabs() {
    const [selected, setSelected] = useState<NeedTab>("free");
    const id = useId();
    const freeTabId = `${id}-free-tab`;
    const paidTabId = `${id}-paid-tab`;
    const freePanelId = `${id}-free-panel`;
    const paidPanelId = `${id}-paid-panel`;
    const tabs = useRef<Array<HTMLButtonElement | null>>([]);

    function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        const currentIndex = event.currentTarget.dataset.index === "0" ? 0 : 1;
        let nextIndex: number | undefined;

        switch (event.key) {
            case "ArrowRight":
                nextIndex = (currentIndex + 1) % 2;
                break;
            case "ArrowLeft":
                nextIndex = (currentIndex + 1) % 2;
                break;
            case "Home":
                nextIndex = 0;
                break;
            case "End":
                nextIndex = 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        const nextTab = nextIndex === 0 ? "free" : "paid";
        setSelected(nextTab);
        tabs.current[nextIndex]?.focus();
    }

    return (
        <section className="use-cases need-tabs" aria-label="Panas use cases">
            <div
                className="need-tabs-list"
                role="tablist"
                aria-label="Panas plans"
            >
                <button
                    ref={(element) => {
                        tabs.current[0] = element;
                    }}
                    className="need-tabs-tab"
                    id={freeTabId}
                    type="button"
                    role="tab"
                    aria-selected={selected === "free"}
                    aria-controls={freePanelId}
                    tabIndex={selected === "free" ? 0 : -1}
                    data-index="0"
                    onClick={() => setSelected("free")}
                    onKeyDown={onTabKeyDown}
                >
                    free panas
                </button>
                <button
                    ref={(element) => {
                        tabs.current[1] = element;
                    }}
                    className="need-tabs-tab"
                    id={paidTabId}
                    type="button"
                    role="tab"
                    aria-selected={selected === "paid"}
                    aria-controls={paidPanelId}
                    tabIndex={selected === "paid" ? 0 : -1}
                    data-index="1"
                    onClick={() => setSelected("paid")}
                    onKeyDown={onTabKeyDown}
                >
                    paid panas
                </button>
            </div>

            <div
                id={freePanelId}
                className="need-tabs-panel"
                role="tabpanel"
                aria-labelledby={freeTabId}
                tabIndex={0}
                hidden={selected !== "free"}
            >
                <p className="prototype-annotation">
                    concept / planned use cases · current prototype: one bounded
                    model request with fixed test credits
                </p>
                <div className="use-cases-inner">
                    <h2>
                        a friend in need
                        <br />
                        is a friend in <span className="lime">deed.</span>
                    </h2>
                    <p className="sub">
                        one small model is a toy. a network of free friends is a
                        tool.
                    </p>
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">the need</th>
                                <th scope="col">the deed</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>your agent hit its rate limit at 3am.</td>
                                <td>
                                    a pana is awake. one bounded request, free.
                                </td>
                            </tr>
                            <tr>
                                <td>500 tiny jobs. zero budget.</td>
                                <td>
                                    split them across every pana online.
                                    map-reduce among friends.
                                </td>
                            </tr>
                            <tr>
                                <td>"is this pana lying to me?"</td>
                                <td>
                                    ask a second pana. same pinned model,
                                    temperature 0, compare answers.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div
                id={paidPanelId}
                className="need-tabs-panel"
                role="tabpanel"
                aria-labelledby={paidTabId}
                tabIndex={0}
                hidden={selected !== "paid"}
            >
                <p className="prototype-annotation">
                    concept / planned · prototype: qwen2.5:0.5b only; no
                    real-money payments, bigger models, or multi-provider
                    fan-out
                </p>
                <div className="use-cases-inner">
                    <h2>
                        panas don't let panas
                        <br />
                        spend gpu without <span className="lime">pay.</span>
                    </h2>
                    <p className="sub">
                        free is for friends. paid is for friends with an m4 max.
                    </p>
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">the situation</th>
                                <th scope="col">the move</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    bought a mac mini to run open claw for one
                                    week. it's been a paperweight since.
                                </td>
                                <td>
                                    list it. set a price. it pays itself off one
                                    request at a time.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    your 128gb m4 max spends the night rendering
                                    a screensaver.
                                </td>
                                <td>
                                    paid panas run bigger models. your ram
                                    finally has a job.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    your agent needs 10,000 jobs done by
                                    morning.
                                </td>
                                <td>
                                    fan out to every paid pana. pay per request,
                                    not per hour.
                                </td>
                            </tr>
                            <tr>
                                <td>"what if the pana flakes halfway?"</td>
                                <td>
                                    reserved up front. charged once, only on
                                    success. refunded otherwise.
                                </td>
                            </tr>
                            <tr>
                                <td>"my agent will spend my rent."</td>
                                <td>
                                    owner-set caps per request, session and day.
                                    the agent can't raise them.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className="prototype-annotation prototype-policy">
                    prototype settlement: uncertain work stays held for
                    reconciliation; definitive failed work settles zero.
                </p>
            </div>
        </section>
    );
}
