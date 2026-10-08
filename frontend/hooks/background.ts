"use client";

import { useEffect } from "react";

const backgroundImage =
    "https://wallpapers4screen.com/Uploads/5-10-2025/89989/ethereum-3d-dark-yellow-logo-4k-eth-dark-yellow-motherboard-ethereum-logo.jpg";

export function useBackgroundImage() {
    useEffect(() => {
        document.body.style.position = "relative";
        document.body.style.zIndex = "0";

        const background = document.createElement("div");

        background.id = "lexo-background";
        background.style.position = "fixed";
        background.style.inset = "0";
        background.style.zIndex = "-1";
        background.style.pointerEvents = "none";
        background.style.backgroundImage = `
            linear-gradient(
                rgba(8, 11, 20, 0.78),
                rgba(8, 11, 20, 0.88)
            ),
            url("${backgroundImage}")
        `;
        background.style.backgroundSize = "cover";
        background.style.backgroundPosition = "center";
        background.style.backgroundRepeat = "no-repeat";

        document.body.prepend(background);

        return () => {
            background.remove();
            document.body.style.position = "";
            document.body.style.zIndex = "";
        };
    }, []);
}
