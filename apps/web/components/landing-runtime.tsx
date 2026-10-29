"use client";
import { useEffect } from "react";
import { initLanding } from "./pr27-runtime.js";
export function LandingRuntime() {
    useEffect(() => initLanding(), []);
    return null;
}
