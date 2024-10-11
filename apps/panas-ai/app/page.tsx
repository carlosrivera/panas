"use client";

import React from "react";
import { motion } from "framer-motion";
import { GenerateButton } from "@panas-ai/ui/components/ui/generate-button";
import { Card } from "@panas-ai/ui/components/ui/card";
import { Textarea } from "@panas-ai/ui/components/ui/textarea";
import { Button } from "@panas-ai/ui/components/ui/button";
import UrlInput from "../components/url-input";

const coolIdeas = [
    "Create a chatbot that translates between programming languages",
    "Build a weather app that suggests outfits based on the forecast",
    "Develop a recipe finder that uses ingredients you have at home",
    "Design a productivity tool that gamifies task completion",
    "Craft a social media analyzer that detects fake news",
];

const Page: React.FC = () => {
    const [description, setDescription] = React.useState("");
    const generateButtonRef = React.useRef<HTMLButtonElement>(null);

    const insertRandomIdea = () => {
        const randomIdea =
            coolIdeas[Math.floor(Math.random() * coolIdeas.length)];
        setDescription(randomIdea!);
        generateButtonRef.current?.focus();
    };

    return (
        <main className="container mx-auto font-sans">
            <section className="flex flex-col max-w-2xl mx-auto text-center items-center justify-center min-h-screen gap-6 py-12">
                <h1 className="text-4xl font-bold z-50">
                    Effortless API Integrations
                </h1>
                <p className="text-lg text-muted-foreground font-light leading-tight z-50">
                    Drop the URLs of the libraries you want to integrate,
                    sprinkle in <br />
                    your idea, and let Panas Al blend up a seamless API
                    integration.
                </p>

                <Card className="w-full h-auto text-left p-6 z-50">
                    <div className="space-y-6">
                        <div className="z-50">
                            <label
                                htmlFor="api-url-1"
                                className="block text-sm font-medium mb-2"
                            >
                                Enter API library URL
                            </label>
                            <div className="grid grid-cols-2 gap-4">
                                <UrlInput
                                    id="api-url-1"
                                    placeholder="Library URL 1"
                                />
                                <UrlInput
                                    id="api-url-2"
                                    placeholder="Library URL 2"
                                />
                            </div>
                        </div>
                        <div>
                            <label
                                htmlFor="description"
                                className="block text-sm font-medium mb-2"
                            >
                                What do you want them to do?
                            </label>
                            <Textarea
                                id="description"
                                className="w-full"
                                rows={6}
                                placeholder="Enter a cool idea..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                        <GenerateButton ref={generateButtonRef}>
                            Make panas
                        </GenerateButton>
                    </div>
                </Card>
            </section>
            <motion.div
                className="fixed bottom-4 left-1/2 transform -translate-x-1/2"
                whileHover={{ scale: 1.025 }}
                whileTap={{ scale: 0.95 }}
            >
                <Button
                    variant="dark"
                    className="fixed bottom-4 left-1/2 transform -translate-x-1/2 font-mono font-extralight z-50"
                    onClick={insertRandomIdea}
                >
                    💡 Try a random cool idea...
                </Button>
            </motion.div>
        </main>
    );
};

export default Page;
