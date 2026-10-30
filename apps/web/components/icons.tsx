const paths = {
    mac: (
        <>
            <rect x="2.5" y="3.5" width="11" height="7" rx="1" />
            <path d="M1 13h14" />
        </>
    ),
    context: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
    output: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
    deadline: (
        <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3l2 1.5" />
        </>
    ),
    concurrency: <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />,
    tag: (
        <>
            <path d="M8.5 2H13a1 1 0 0 1 1 1v4.5L8 13.5 2.5 8z" />
            <circle cx="11" cy="5" r="0.8" />
        </>
    ),
    refresh: <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.5H11" />,
    info: (
        <>
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7.5v3.5M8 5h.01" />
        </>
    ),
};
export type IconName = keyof typeof paths;
/** Decorative 16-unit stroke icons; pair each with visible or screen-reader text. */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
    return (
        <svg
            aria-hidden="true"
            className="icon"
            viewBox="0 0 16 16"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[name]}
        </svg>
    );
}
