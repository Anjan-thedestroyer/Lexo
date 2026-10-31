"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { getAddress } from "viem";
import JSZip from "jszip";

import axiosInstance from "@/lib/axios";
import Navbar from "@/component/Navbar";
import {
    useLinkWallet,
    type WalletAttestation,
} from "@/hooks/useLinkWallet";
import { useCoreAgreement } from "@/hooks/coreAgreement";
import { useBackgroundImage } from "@/hooks/background";

type AgreementData = {
    _id: string;
    terms: string;
    termsDocs: string | { type: "Buffer"; data: number[] } | number[];
    termsHash: string;
    contractAddress: string;
};

type ExtractedAgreement = {
    type: "docx" | "xlsx" | "pptx";
    html: string;
    downloadUrl: string;
    fileName: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

function getDocumentBytes(value: AgreementData["termsDocs"]): Uint8Array {
    if (typeof value === "string") {
        const base64 = value.replace(/^data:.*?;base64,/, "").replace(/\s/g, "");
        if (!base64) throw new Error("Agreement document is empty.");

        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } catch {
            throw new Error("Invalid agreement document encoding.");
        }
    }

    if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        value.type === "Buffer" &&
        Array.isArray(value.data)
    ) {
        return new Uint8Array(value.data);
    }

    if (Array.isArray(value)) {
        return new Uint8Array(value);
    }

    throw new Error("Unsupported agreement document format.");
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function xmlToReadableHtml(xml: string) {
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, "application/xml");

    if (document.querySelector("parsererror")) {
        throw new Error("Could not read the agreement document XML.");
    }

    const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, "p"));

    return paragraphs
        .map((paragraph) => {
            const text = Array.from(paragraph.getElementsByTagNameNS(namespace, "t"))
                .map((node) => node.textContent || "")
                .join("");

            if (!text.trim()) return "<div class='h-4'></div>";

            const style = paragraph.getElementsByTagNameNS(namespace, "pStyle")[0];
            const styleName = style?.getAttributeNS(namespace, "val") || "";
            const safeText = escapeHtml(text);

            if (styleName.toLowerCase().includes("title")) {
                return `<h1 class="mb-6 text-2xl font-bold text-gray-900 border-b pb-2">${safeText}</h1>`;
            }
            if (styleName.toLowerCase().includes("heading1")) {
                return `<h2 class="mb-4 mt-8 text-xl font-bold text-gray-900">${safeText}</h2>`;
            }
            if (styleName.toLowerCase().includes("heading2")) {
                return `<h3 class="mb-3 mt-6 text-lg font-semibold text-gray-900">${safeText}</h3>`;
            }

            return `<p class="mb-4 text-[15px] leading-relaxed text-gray-800">${safeText}</p>`;
        })
        .join("");
}

async function extractAgreement(
    termsDocs: AgreementData["termsDocs"]
): Promise<ExtractedAgreement> {
    const bytes = getDocumentBytes(termsDocs);

    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error("The agreement is not a valid ZIP/DOCX file.");
    }

    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch {
        throw new Error("The agreement file is incomplete or corrupted.");
    }

    let type: ExtractedAgreement["type"];
    let html: string;
    let fileName: string;
    let mimeType: string;

    const documentFile = zip.file("word/document.xml");

    if (documentFile) {
        type = "docx";
        html = xmlToReadableHtml(await documentFile.async("text"));
        fileName = "lexo-core-agreement.docx";
        mimeType =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (zip.file("xl/workbook.xml")) {
        type = "xlsx";
        html = `
            <div class="py-12 text-center">
                <h2 class="text-xl font-semibold text-gray-900">Spreadsheet Agreement</h2>
                <p class="mt-2 text-sm text-gray-600">This agreement is stored as an Excel workbook.</p>
            </div>
        `;
        fileName = "lexo-core-agreement.xlsx";
        mimeType =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (zip.file("ppt/presentation.xml")) {
        type = "pptx";
        html = `
            <div class="py-12 text-center">
                <h2 class="text-xl font-semibold text-gray-900">Presentation Agreement</h2>
                <p class="mt-2 text-sm text-gray-600">This agreement is stored as a PowerPoint presentation.</p>
            </div>
        `;
        fileName = "lexo-core-agreement.pptx";
        mimeType =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else {
        throw new Error("The uploaded agreement format could not be detected.");
    }

    const blob = new Blob([bytes], { type: mimeType });

    return {
        type,
        html,
        downloadUrl: URL.createObjectURL(blob),
        fileName,
    };
}

export default function AddWalletPage() {
    const { address, isConnected } = useAccount();
    const { connectAsync, connectors } = useConnect();

    useBackgroundImage();

    const {
        signAgreement,
        isSigning,
        isConfirming: isAgreementConfirming,
        isConfirmed: isAgreementConfirmed,
        signError,
        txHash: agreementTxHash,
        hasSigned,
    } = useCoreAgreement();

    const { linkWallet, isConfirming: isWalletConfirming } = useLinkWallet();

    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [txHash, setTxHash] = useState("");

    // Agreement document states
    const [showAgreement, setShowAgreement] = useState(false);
    const [loadingAgreement, setLoadingAgreement] = useState(false);
    const [agreementError, setAgreementError] = useState("");
    const [agreement, setAgreement] = useState<AgreementData | null>(null);
    const [documentHtml, setDocumentHtml] = useState("");
    const [documentUrl, setDocumentUrl] = useState("");
    const [documentFileName, setDocumentFileName] = useState("");
    const [accepted, setAccepted] = useState(false);

    useEffect(() => {
        return () => {
            if (documentUrl) URL.revokeObjectURL(documentUrl);
        };
    }, [documentUrl]);

    const agreementReady = hasSigned || isAgreementConfirmed;
    const busy =
        isLoading ||
        isSigning ||
        isAgreementConfirming ||
        isWalletConfirming;

    async function handleConnectWallet() {
        try {
            setMessage("");
            const metamaskConnector = connectors.find(
                (c) => c.id === "io.metamask" || c.name === "MetaMask"
            );

            if (!metamaskConnector) {
                throw new Error("MetaMask connector not found.");
            }

            await connectAsync({ connector: metamaskConnector });
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : "Failed to connect wallet."
            );
        }
    }

    async function handleViewAgreement() {
        try {
            setLoadingAgreement(true);
            setAgreementError("");
            setShowAgreement(true);

            if (!API_URL) throw new Error("API URL is not configured.");

            const response = await fetch(`${API_URL}/core-agreement`);
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Failed to retrieve agreement.");
            }

            const data = result.data as AgreementData;
            if (!data?.termsDocs) {
                throw new Error("Agreement document was not found.");
            }

            const extracted = await extractAgreement(data.termsDocs);
            setAgreement(data);
            setDocumentHtml(extracted.html);
            setDocumentUrl(extracted.downloadUrl);
            setDocumentFileName(extracted.fileName);
        } catch (error) {
            setAgreementError(
                error instanceof Error ? error.message : "Failed to load agreement."
            );
        } finally {
            setLoadingAgreement(false);
        }
    }

    async function handleSignAgreement() {
        if (!isConnected || !address || !accepted || !documentHtml || busy) return;

        try {
            setMessage("");
            await signAgreement();
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : "Failed to sign Core Agreement."
            );
        }
    }

    async function handleAddWallet() {
        if (!isConnected || !address) {
            setMessage("Please connect your wallet first.");
            return;
        }

        if (!agreementReady) {
            setMessage("Please sign the Core Agreement before adding your wallet.");
            return;
        }

        try {
            setIsLoading(true);
            setMessage("");
            setTxHash("");

            const normalizedWallet = getAddress(address);
            const response = await axiosInstance.post("/verification/wallet-addition", {
                walletAddress: normalizedWallet,
            });

            const attestation: WalletAttestation | undefined =
                response.data?.data?.attestationPayload;

            if (!attestation) {
                throw new Error("Attestation payload was not returned by the server.");
            }

            if (getAddress(attestation.wallet) !== normalizedWallet) {
                throw new Error("Attestation wallet does not match connected wallet.");
            }

            if (
                !attestation.identityHash ||
                !attestation.signature ||
                attestation.nonce === undefined ||
                attestation.deadline === undefined
            ) {
                throw new Error("Invalid wallet attestation payload.");
            }

            setMessage("Wallet verification approved. Submitting on-chain...");

            const result = await linkWallet(attestation);
            setTxHash(result.hash);
            setMessage(
                "Wallet successfully linked on-chain. Waiting for backend sync."
            );
        } catch (error: any) {
            console.error("Add wallet error:", error);
            setMessage(
                error?.response?.data?.message ||
                error?.shortMessage ||
                error?.message ||
                "Failed to add wallet."
            );
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="relative min-h-screen bg-black text-white selection:bg-white selection:text-black">
            <div className="relative z-10">
                <Navbar />

                <main className="mx-auto mt-17 w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    {/* Header Section */}
                    <div className="mb-8 border-b border-white/10 pb-6">
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                            Wallet Management
                        </span>
                        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                            Add New Wallet
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm text-gray-400">
                            Link an additional wallet to your verified Lexo identity. Complete the Core Agreement requirement to authorize on-chain registration.
                        </p>
                    </div>

                    {/* Content Layout */}
                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                        {/* Control Panel / Form Section */}
                        <div className={`space-y-6 transition-all duration-300 ${showAgreement ? "lg:col-span-5" : "lg:col-span-7 lg:col-start-3"}`}>
                            {/* Step 1: Wallet Connection */}
                            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold">
                                            1
                                        </span>
                                        <h2 className="text-base font-medium">Connect Wallet</h2>
                                    </div>
                                    {isConnected && (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                                            Connected
                                        </span>
                                    )}
                                </div>

                                <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
                                    <p className="text-xs text-gray-500">Connected Address</p>
                                    <p className="mt-1 break-all font-mono text-xs tracking-tight text-gray-300 sm:text-sm">
                                        {address ? address : "No wallet connected"}
                                    </p>
                                </div>

                                {!isConnected && (
                                    <button
                                        onClick={handleConnectWallet}
                                        disabled={busy}
                                        className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:opacity-40"
                                    >
                                        Connect MetaMask
                                    </button>
                                )}
                            </div>

                            {/* Step 2: Core Agreement Requirement */}
                            {isConnected && (
                                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold">
                                                2
                                            </span>
                                            <h2 className="text-base font-medium">Core Agreement</h2>
                                        </div>
                                        {agreementReady && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                                                Signed
                                            </span>
                                        )}
                                    </div>

                                    {agreementReady ? (
                                        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                            <p className="text-sm font-medium text-emerald-300">
                                                Core Agreement verified for this wallet.
                                            </p>
                                            {agreementTxHash && (
                                                <a
                                                    href={`https://sepolia.etherscan.io/tx/${agreementTxHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                                                >
                                                    View transaction status ↗
                                                </a>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="mt-4 space-y-3">
                                            <p className="text-xs leading-relaxed text-gray-400">
                                                You must review and sign the Core Agreement before this wallet can be attached to your identity.
                                            </p>
                                            <button
                                                onClick={showAgreement ? () => setShowAgreement(false) : handleViewAgreement}
                                                disabled={busy}
                                                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:bg-white/10 disabled:opacity-40"
                                            >
                                                {showAgreement ? "Hide Document Viewer" : "Review Core Agreement"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Step 3: Link & Verify */}
                            {isConnected && agreementReady && (
                                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold">
                                            3
                                        </span>
                                        <h2 className="text-base font-medium">Link Identity</h2>
                                    </div>

                                    <p className="mt-2 text-xs leading-relaxed text-gray-400">
                                        Submit your signed attestation on-chain to link this wallet with your verified Lexo user record.
                                    </p>

                                    <button
                                        onClick={handleAddWallet}
                                        disabled={busy}
                                        className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {isLoading
                                            ? "Requesting Attestation..."
                                            : isWalletConfirming
                                            ? "Confirming On-Chain..."
                                            : "Verify & Link Wallet"}
                                    </button>
                                </div>
                            )}

                            {/* Status Messages */}
                            {message && (
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-gray-300">
                                    {message}
                                </div>
                            )}

                            {txHash && (
                                <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                                    <p className="text-xs text-blue-300">Transaction submitted:</p>
                                    <a
                                        href={`https://sepolia.etherscan.io/tx/${txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-1 inline-block text-xs font-mono text-blue-400 hover:underline"
                                    >
                                        {txHash}
                                    </a>
                                </div>
                            )}
                        </div>

                        {/* Document Viewer Column */}
                        {showAgreement && !agreementReady && (
                            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl lg:col-span-7">
                                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                                    <div>
                                        <h2 className="text-lg font-semibold">Lexo Core Agreement</h2>
                                        <p className="text-xs text-gray-400">Review document details before signing</p>
                                    </div>

                                    {documentUrl && (
                                        <a
                                            href={documentUrl}
                                            download={documentFileName}
                                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/10"
                                        >
                                            Download DOCX
                                        </a>
                                    )}
                                </div>

                                {/* Viewer Frame */}
                                <div className="mt-4 flex-1">
                                    {loadingAgreement ? (
                                        <div className="flex h-96 items-center justify-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                                                <p className="text-xs text-gray-400">Loading document...</p>
                                            </div>
                                        </div>
                                    ) : agreementError ? (
                                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
                                            {agreementError}
                                            <button
                                                onClick={handleViewAgreement}
                                                className="ml-2 font-semibold underline"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="max-h-[550px] overflow-y-auto rounded-xl bg-gray-100 p-4 sm:p-6">
                                            {documentHtml ? (
                                                <article
                                                    className="prose prose-sm mx-auto max-w-none rounded-lg bg-white p-6 text-gray-900 shadow-sm sm:p-10"
                                                    dangerouslySetInnerHTML={{ __html: documentHtml }}
                                                />
                                            ) : (
                                                <div className="flex h-64 items-center justify-center text-xs text-gray-500">
                                                    No preview available.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Agreement Sign Footer */}
                                {agreement && !loadingAgreement && !agreementError && (
                                    <div className="mt-6 border-t border-white/10 pt-4 space-y-4">
                                        <div className="grid grid-cols-2 gap-4 text-xs">
                                            <div>
                                                <span className="text-gray-500">Agreement ID</span>
                                                <p className="truncate font-mono text-gray-300">{agreement._id}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Terms Hash</span>
                                                <p className="truncate font-mono text-gray-300">{agreement.termsHash}</p>
                                            </div>
                                        </div>

                                        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={accepted}
                                                onChange={(e) => setAccepted(e.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black accent-white"
                                            />
                                            <span className="text-xs leading-relaxed text-gray-300">
                                                I have read and agree to the Lexo Core Agreement terms on behalf of my connected wallet.
                                            </span>
                                        </label>

                                        {signError && (
                                            <p className="text-xs text-red-400">
                                                {signError instanceof Error ? signError.message : "Signing failed"}
                                            </p>
                                        )}

                                        <button
                                            onClick={handleSignAgreement}
                                            disabled={!accepted || !documentHtml || busy}
                                            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            {isSigning
                                                ? "Awaiting Wallet Signature..."
                                                : isAgreementConfirming
                                                ? "Confirming On-Chain..."
                                                : "Sign Core Agreement"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}