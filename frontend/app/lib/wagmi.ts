import {getDefaultConfig} from "@rainbow-me/rainbowkit";
import {sepolia} from "wagmi/chains";

export const config = getDefaultConfig({
    appName:"Vault",
    projectId:"d2c43b42c724964d5a2dd71d07fd17df",
    chains:[sepolia],
    ssr: true
});