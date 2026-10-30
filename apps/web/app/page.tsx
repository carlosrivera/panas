import "./pr27.css";
import Link from "next/link";
import { sitePath } from "../lib/site-metadata";
import { LandingRuntime } from "../components/landing-runtime";
import { NeedTabs } from "../components/need-tabs";
import { TopPanas } from "../components/top-panas";
export default function Home() {
    return (
        <>
            <video
                id="v"
                src={sitePath("/video.mp4")}
                muted
                playsInline
                preload="auto"
            ></video>

            <div className="pr27-page page">
                <nav aria-label="Main">
                    <Link className="logo" href="/">
                        🤝 panas<span>_</span>
                    </Link>
                    <ul>
                        <li>
                            <Link href="/guides/buyer">docs</Link>
                        </li>
                        <li>
                            <Link href="/providers">find a pana</Link>
                        </li>
                        <li>
                            <a href="https://github.com/carlosrivera/panas">
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
                        your agent needs compute. your pana has it.
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
                        <Link className="pick-option" href="/guides/buyer">
                            <span className="pick-verb">seek</span>
                            <span className="pick-line">
                                my agent needs compute.
                            </span>
                            <span className="pick-detail">
                                one mcp connection · free or paid · caps you set
                            </span>
                            <span className="pick-link">
                                connect your agent →
                            </span>
                        </Link>
                        <Link className="pick-option" href="/guides/provider">
                            <span className="pick-verb">expose</span>
                            <span className="pick-line">my mac is bored.</span>
                            <span className="pick-detail">
                                docker inference · your price · your
                                availability
                            </span>
                            <span className="pick-link">share your mac →</span>
                        </Link>
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
                        encrypted p2p · mcp · free or solana devnet usdc
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
