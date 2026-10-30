import "./pr27.css";
import { LandingRuntime } from "../components/landing-runtime";
import { NeedTabs } from "../components/need-tabs";
import { TopPanas } from "../components/top-panas";
export default function Home() {
    return (
        <>
            <video
                id="v"
                data-src="/video.mp4"
                muted
                playsInline
                preload="auto"
            ></video>

            <div className="pr27-page page">
                <nav aria-label="Main">
                    <a className="logo" href="/">
                        🤝 panas<span>_</span>
                    </a>
                    <ul>
                        <li>
                            <a href="/guides/buyer">docs</a>
                        </li>
                        <li>
                            <a href="/providers">find a pana</a>
                        </li>
                        <li>
                            <a href="https://github.com/carlosrivera/mcpwire">
                                github
                            </a>
                        </li>
                    </ul>
                </nav>

                <main id="main">
                    <div className="clip a" aria-hidden="true">
                        <header>epichandshake.vid</header>
                        <canvas></canvas>
                    </div>
                    <div className="clip b" aria-hidden="true">
                        <header>epichandshake.vid</header>
                        <canvas></canvas>
                    </div>
                    <div className="clip c" aria-hidden="true">
                        <header>epichandshake.vid</header>
                        <canvas></canvas>
                    </div>

                    <p className="kicker">
                        panas (n.) — spanish for friends. also: this.
                    </p>
                    <h1>
                        free compute,
                        <br />
                        between panas.
                    </h1>

                    <div className="handshake">
                        <div
                            className="wire"
                            role="img"
                            aria-label="your agent, handshake, a pana's mac"
                        >
                            <span>your agent</span>
                            <i className="node agent"></i>
                            <i className="line out"></i>
                            <span className="pill">panas_ai</span>
                            <i className="line in"></i>
                            <i className="node on mac"></i>
                            <span>a pana's mac</span>
                        </div>
                    </div>
                </main>

                <dialog id="pick" aria-labelledby="pick-title">
                    <div className="pick-header">
                        <span className="pick-label">pick a side</span>
                        <button
                            type="button"
                            className="pick-close"
                            aria-label="close"
                        >
                            esc ✕
                        </button>
                    </div>
                    <h2 id="pick-title">what kind of pana are you?</h2>
                    <div className="pick-options">
                        <a className="pick-option" href="/guides/buyer">
                            <span className="pick-verb">seek</span>
                            <span className="pick-line">
                                my agent needs compute.
                            </span>
                            <span className="pick-detail">
                                one local mcp server · test credits · caps you
                                set
                            </span>
                            <span className="pick-link">
                                connect your agent →
                            </span>
                        </a>
                        <a className="pick-option" href="/guides/provider">
                            <span className="pick-verb">expose</span>
                            <span className="pick-line">my mac is bored.</span>
                            <span className="pick-detail">
                                apple silicon · native ollama · tests itself
                                every launch
                            </span>
                            <span className="pick-link">share your mac →</span>
                        </a>
                    </div>
                    <div className="pick-footer">
                        you can be both. most panas are.
                    </div>
                </dialog>

                <NeedTabs />
                <TopPanas />

                {/*  sticky call to action: a dark arch that rises over the page  */}
                <aside className="dock" aria-label="Get started with Panas">
                    <button
                        type="button"
                        id="cta"
                        className="dock-cta"
                        aria-haspopup="dialog"
                        aria-controls="pick"
                    >
                        🤝 become a pana
                    </button>
                    <p className="dock-note">
                        prototype · fixed test-credit quotes
                    </p>
                </aside>

                <footer>
                    <span>
                        hackathon build. may contain bugs. will contain vibes.
                    </span>
                    <span>
                        no gpus were rented by the hour in the making of this.
                    </span>
                </footer>
            </div>

            <LandingRuntime />
        </>
    );
}
