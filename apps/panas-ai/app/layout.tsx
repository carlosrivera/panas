import "@panas-ai/ui/globals.css";
import type { Metadata } from "next";
import { Inter, Noto_Sans_Mono as Mono } from "next/font/google";
import { Header } from "@panas-ai/ui/components/ui/header";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500"] });
const mono = Mono({ subsets: ["latin"], weight: ["100"] });

export const metadata: Metadata = {
    title: "Panas AI",
    description: "Effortless API integrations",
};

const links = [
    { title: "About Us", href: "/about" },
    { title: "Slack", href: "/slack" },
    { title: "Register", href: "/register" },
    { title: "Buy us a coffee", href: "/buy-us-a-coffee" },
];

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}): JSX.Element {
    return (
        <html className="dark" lang="en">
            <body
                className={`
                    ${inter.className} ${mono.className}
                    relative font-sans
                    before:content-[''] before:inset-0 before:top-14
                    before:bg-[url('/gradient.svg')] 
                    before:opacity-50 before:-z-20 before:fixed before:animate-background-position-spin
                    after:content-[''] after:fixed after:inset-0
                    after:bg-[url('/noise.png')] after:bg-repeat
                    after:-z-10 after:bg-blend-multiply
                `}
            >
                <Header links={links} />
                {children}
            </body>
        </html>
    );
}
