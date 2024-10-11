import * as React from "react";
import { Button, ButtonProps } from "./button";
import { cn } from "../../lib/utils";

export interface GenerateButtonProps extends ButtonProps {
    children: React.ReactNode;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

const GenerateButton = React.forwardRef<HTMLButtonElement, GenerateButtonProps>(
    ({ className, children, leftIcon, rightIcon, ...props }, ref) => {
        return (
            <Button
                ref={ref}
                className={cn(
                    `
                      group relative flex items-center justify-center shadow-md w-full
                      bg-[#0988FF] border-[1.5px] border-[#086DCC] hover:bg-[#2997FF] active:bg-[#006FD6] active:border-[#075FB1]
                      text-white font-semibold rounded py-3
                      hover:shadow-lg active:shadow-none transition duration-150
                      overflow-hidden
                    `,
                    className,
                )}
                {...props}
            >
                {/* Animated border effect */}
                <span className="absolute bottom-0 left-0 h-1 w-full bg-[#086DCC] transition-all duration-150 ease-in-out transform group-active:translate-y-full"></span>
                <span className="absolute top-0 left-0 h-1 w-full bg-[#075FB1] transition-all duration-150 ease-in-out transform -translate-y-1 group-active:translate-y-0"></span>

                <div className="flex items-center justify-center gap-4 group-active:gap-1.5 -translate-y-0.5 group-active:translate-y-0.5 transition-all duration-150 ease-in-out">
                    <span>{leftIcon ?? "🫱"}</span>
                    {children}
                    <span>{rightIcon ?? "🫲"}</span>
                </div>
            </Button>
        );
    },
);

GenerateButton.displayName = "GenerateButton";

export { GenerateButton };
