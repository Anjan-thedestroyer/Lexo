import type { Metadata } from "next";

import {Providers} from "./provider";

import "./globals.css";

export const metadata: Metadata = {
    title: "Lexo",
    
    description: "Programmable Legal Agreement Infrastructure",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="">
                <Providers>
                    {children}
                </Providers>
            </body>
        </html>
    );
}