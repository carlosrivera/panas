import "./pr27.css";
import { LandingRuntime } from "../components/landing-runtime";
export default function Home() {
    return (
        <>
            <video
                id="v"
                src="/video.mp4"
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
                                one mcp connection · free or paid · caps you set
                            </span>
                            <span className="pick-link">
                                connect your agent →
                            </span>
                        </a>
                        <a className="pick-option" href="/guides/provider">
                            <span className="pick-verb">expose</span>
                            <span className="pick-line">my mac is bored.</span>
                            <span className="pick-detail">
                                docker inference · your price · your
                                availability
                            </span>
                            <span className="pick-link">share your mac →</span>
                        </a>
                    </div>
                    <div className="pick-footer">
                        you can be both. most panas are.
                    </div>
                </dialog>

                <section
                    className="use-cases"
                    aria-labelledby="use-cases-title"
                >
                    <p className="prototype-annotation">
                        the vision: agents sharing work across a network of
                        panas. built on discovery, encrypted inference, and
                        receipts.
                    </p>
                    <div className="use-cases-inner">
                        <h2 id="use-cases-title">
                            a friend in need
                            <br />
                            is a friend in <span>deed.</span>
                        </h2>
                        <p className="sub">
                            one shared model is a start. a network of panas is
                            infrastructure.
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
                                    <td>
                                        your agent hit its rate limit at 3am.
                                    </td>
                                    <td>
                                        a pana is awake. one bounded request,
                                        free.
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
                </section>

                <section className="paid" aria-labelledby="paid-title">
                    <p className="prototype-annotation">
                        built today: free sharing and solana devnet usdc. on the
                        roadmap: bigger models and multi-provider jobs.
                    </p>
                    <div className="paid-inner">
                        <h2 id="paid-title">
                            panas don't let panas
                            <br />
                            spend gpu without <span className="lime">pay.</span>
                        </h2>
                        <p className="sub">
                            free is for friends. paid is for friends with an m4
                            max.
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
                                        bought a mac mini to run open claw for
                                        one week. it's been a paperweight since.
                                    </td>
                                    <td>
                                        list it. set a price. it pays itself off
                                        one request at a time.
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        your 128gb m4 max spends the night
                                        rendering a screensaver.
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
                                        fan out to every paid pana. pay per
                                        request, not per hour.
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
                                        owner-set caps per request, session and
                                        day. the agent can't raise them.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="prototype-annotation prototype-policy">
                        prototype settlement: uncertain work stays held for
                        reconciliation; definitive failed work settles zero.
                    </p>
                </section>

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
