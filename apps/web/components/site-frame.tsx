"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "./site-shell";
import { BecomePana } from "./become-pana";
export function SiteFrame({ children }: { children: ReactNode }) {
    return usePathname() === "/" ? (
        children
    ) : (
        <>
            <SiteHeader />
            {children}
            <SiteFooter />
            <BecomePana />
        </>
    );
}
