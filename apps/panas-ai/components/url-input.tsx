import React from "react";
import { Input } from "@panas-ai/ui/components/ui/input";
import { cn } from "@panas-ai/ui/lib/utils";
import { match, P } from "ts-pattern";
import { z } from "zod";
import { useCallback, useState } from "react";

interface UrlInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    id: string;
    placeholder: string;
}

const urlSchema = z.string().url();

const UrlInput = React.forwardRef<HTMLInputElement, UrlInputProps>(
    ({ className, ...props }, ref) => {
        const [favicon, setFavicon] = useState<string | undefined>(undefined);
        const [isValidUrl, setIsValidUrl] = useState(false);

        const fetchFavicon = useCallback(async (url: string) => {
            try {
                const domain = new URL(url).hostname;
                const response = await fetch(
                    `/api/favicon?domain=${encodeURIComponent(domain)}`,
                );
                if (response.ok) {
                    const data = await response.json();
                    setFavicon(data.faviconUrl);
                }
            } catch (error) {
                console.error("Error fetching favicon:", error);
                setFavicon(undefined);
            }
        }, []);

        const handleInputChange = React.useCallback(
            (event: React.ChangeEvent<HTMLInputElement>) => {
                const inputValue = event.target.value;
                const isValid = urlSchema.safeParse(inputValue).success;
                setIsValidUrl(isValid);

                if (isValid) {
                    fetchFavicon(inputValue);
                } else {
                    setFavicon(undefined);
                }
            },
            [fetchFavicon],
        );

        return (
            <div className="relative">
                {
                    match({ isValidUrl, favicon })
                        .with({ isValidUrl: true, favicon: undefined }, () => (
                            <div className="absolute top-1/2 left-2 rounded bg-[#4A4A4A] flex items-center justify-center w-6 h-6 pointer-events-none -translate-y-1/2">
                                {/* Loading spinner or placeholder */}
                            </div>
                        ))
                        .with(
                            { isValidUrl: true, favicon: P.string },
                            ({ favicon }) => (
                                <div className="absolute top-1/2 left-2 rounded bg-[#4A4A4A]/15 w-6 h-6 pointer-events-none -translate-y-1/2">
                                    <img
                                        src={favicon}
                                        alt="Favicon"
                                        className="h-full w-full p-1"
                                    />
                                </div>
                            ),
                        )
                        .otherwise(() => (
                            <div className="absolute top-1/2 left-2 rounded bg-[#4A4A4A] flex items-center justify-center w-6 h-6 pointer-events-none -translate-y-1/2">
                                {/* Default icon */}
                            </div>
                        )) as React.ReactNode
                }
                <Input
                    ref={ref}
                    className={cn("pl-10", className)}
                    onChange={handleInputChange}
                    {...props}
                />
            </div>
        );
    },
);

UrlInput.displayName = "UrlInput";

export default UrlInput;
