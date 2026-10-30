"use client";

import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { ProviderDirectory } from "./provider-directory";

export function ProviderDetail() {
    const params = useSearchParams();
    const id = z.uuid().safeParse(params.get("id"));
    if (params.getAll("id").length !== 1 || !id.success)
        return (
            <p role="status">
                Use a valid provider identifier to view its report.
            </p>
        );
    return <ProviderDirectory providerId={id.data} />;
}
