
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import JSZip from "jszip";

import Navbar from "@/component/Navbar";
import { useVerification } from "../layout";
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
        // Backend returns Base64 from GET /core-agreement.
        const base64 = value.replace(/^data:.*?;base64,/, "").replace(/\s/g, "");

        if (!base64) {
            throw new Error("Agreement document is empty.");
        }

        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            return bytes;
        } catch {
            throw new Error(
                "Invalid agreement document encoding. Expected Base64 from the backend."
            );
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
    const paragraphs = Array.from(
        document.getElementsByTagNameNS(namespace, "p")
    );

    return paragraphs.map((paragraph) => {
        const text = Array.from(
            paragraph.getElementsByTagNameNS(namespace, "t")
        )
            .map((node) => node.textContent || "")
            .join("");

        if (!text.trim()) {
            return "<div class='h-4'></div>";
        }

        const style = paragraph.getElementsByTagNameNS(namespace, "pStyle")[0];
        const styleName = style?.getAttributeNS(namespace, "val") || "";
        const safeText = escapeHtml(text);

        if (styleName.toLowerCase().includes("title")) {
            return `<h1 class="mb-6 text-2xl font-bold text-gray-900">${safeText}</h1>`;
        }

        if (styleName.toLowerCase().includes("heading1")) {
            return `<h2 class="mb-4 mt-8 text-xl font-bold text-gray-900">${safeText}</h2>`;
        }

        if (styleName.toLowerCase().includes("heading2")) {
            return `<h3 class="mb-3 mt-6 text-lg font-semibold text-gray-900">${safeText}</h3>`;
        }

        return `<p class="mb-4 text-[15px] leading-7 text-gray-800">${safeText}</p>`;
    }).join("");
}

async function extractAgreement(
    termsDocs: AgreementData["termsDocs"]
): Promise<ExtractedAgreement> {
    const bytes = getDocumentBytes(termsDocs);

    // A DOCX/XLSX/PPTX file is a ZIP archive and starts with PK.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error(
            "The agreement is not a valid ZIP/DOCX file. Check the Base64 data returned by the backend."
        );
    }

    let zip: JSZip;

    try {
        zip = await JSZip.loadAsync(bytes);
    } catch {
        throw new Error(
            "The agreement file is incomplete or corrupted. Please check the stored document and GET API response."
        );
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
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (zip.file("xl/workbook.xml")) {
        type = "xlsx";
        html = `
            <div class="text-center">
                <h2 class="text-xl font-semibold text-gray-900">Spreadsheet Agreement</h2>
                <p class="mt-3 text-sm text-gray-600">
                    This agreement is stored as an Excel workbook.
                </p>
            </div>
        `;
        fileName = "lexo-core-agreement.xlsx";
        mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (zip.file("ppt/presentation.xml")) {
        type = "pptx";
        html = `
            <div class="text-center">
                <h2 class="text-xl font-semibold text-gray-900">Presentation Agreement</h2>
                <p class="mt-3 text-sm text-gray-600">
                    This agreement is stored as a PowerPoint presentation.
                </p>
            </div>
        `;
        fileName = "lexo-core-agreement.pptx";
        mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
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

export default function AgreementPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.id as string;

    const { address, isConnected } = useAccount();
    const { updateVerificationData } = useVerification();

    const {
        signAgreement,
        isSigning,
        isConfirming,
        isConfirmed,
        signError,
        txHash,
        hasSigned
    } = useCoreAgreement();

    useBackgroundImage();

    const [agreement, setAgreement] = useState<AgreementData | null>(null);
    const [documentUrl, setDocumentUrl] = useState("");
    const [documentFileName, setDocumentFileName] = useState("");
    const [documentHtml, setDocumentHtml] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [accepted, setAccepted] = useState(false);

    // Fetch and extract the agreement.
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = "";

        async function fetchAgreement() {
            try {
                if (!API_URL) {
                    throw new Error("API URL is not configured.");
                }

                setLoading(true);
                setError("");

                const response = await fetch(
                    `${API_URL}/core-agreement`,
                    { signal: controller.signal }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.message || "Failed to retrieve agreement."
                    );
                }

                const data = result.data as AgreementData;
                console.log("Backend contract:", data.contractAddress);

                if (!data?.termsDocs) {
                    throw new Error("Agreement document was not found.");
                }

                const extracted = await extractAgreement(data.termsDocs);

                if (controller.signal.aborted) {
                    URL.revokeObjectURL(extracted.downloadUrl);
                    return;
                }

                objectUrl = extracted.downloadUrl;

                setAgreement(data);
                setDocumentUrl(objectUrl);
                setDocumentFileName(extracted.fileName);
                setDocumentHtml(extracted.html);
            } catch (err) {
                if (controller.signal.aborted) return;

                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load agreement."
                );

                console.error("Error loading agreement:", err);
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }

        fetchAgreement();

        return () => {
            controller.abort();

            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, []);

    // Continue only after the wallet transaction is confirmed.
// Continue only after the wallet transaction is confirmed.
useEffect(() => {
    if (!isConfirmed || !txHash || !address) return;

    updateVerificationData({
        walletAddress: address,
        agreementSigned: true,
        agreementTxHash: txHash,
    });

    router.replace(`/verify/${userId}/identity`);
}, [
    isConfirmed,
    txHash,
    address,
    userId,
    router,
    updateVerificationData,
]);

// If the connected wallet has already signed the agreement,
// skip the signing page.
useEffect(() => {
    if (hasSigned) {
        router.replace(`/verify/${userId}/identity`);
    }
}, [hasSigned, userId, router]);

    function handleSign() {
        if (!isConnected || !address || !accepted || isSigning || isConfirming) {
            return;
        }

        const result = signAgreement();
        console.log(result);
        console.log(signError)
    }

    // Loading state.
    if (loading) {
        return (
            <div className="relative min-h-screen text-white">

                <div className="relative z-10">
                    <Navbar />

                    <main className="flex min-h-[calc(100vh-80px)] items-center justify-center">
                        <div className="text-center">
                            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                            <p className="text-sm text-gray-400">
                                Loading Core Agreement...
                            </p>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    // Error state.
    if (error) {
        return (
            <div className="relative min-h-screen text-white">

                <div className="relative z-10">
                    <Navbar />

                    <main className="flex min-h-[calc(100vh-80px)] items-center justify-center px-6">
                        <div className="w-full max-w-lg rounded-2xl border border-red-500/20 bg-black/30 p-8 text-center backdrop-blur-md">
                            <h1 className="mb-3 text-xl font-semibold">
                                Unable to Load Agreement
                            </h1>

                            <p className="mb-6 text-sm text-red-300">
                                {error}
                            </p>

                            <button
                                onClick={() => router.push(`/verify/${userId}/wallet`)}
                                className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm transition hover:bg-white/10"
                            >
                                Back to Wallet
                            </button>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    // Wallet connection required.
    if (!isConnected || !address) {
        return (
            <div className="relative min-h-screen text-white">

                <div className="relative z-10">
                    <Navbar />

                    <main className="flex min-h-[calc(100vh-80px)] items-center justify-center px-6">
                        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black/30 p-8 text-center backdrop-blur-md">
                            <h1 className="mb-3 text-2xl font-semibold">
                                Wallet Required
                            </h1>

                            <p className="mb-6 text-sm text-gray-400">
                                Connect your wallet before signing the Core Agreement.
                            </p>

                            <button
                                onClick={() => router.push(`/verify/${userId}/wallet`)}
                                className="rounded-lg bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-gray-200"
                            >
                                Back to Wallet
                            </button>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen text-white">

            <div className="relative z-10">
                <Navbar />

                <main className="mx-auto w-full max-w-7xl px-6 py-10">
                    <div className="mb-8">
                        <p className="mb-2 text-sm text-gray-400">
                            Verification Step 2
                        </p>

                        <h1 className="text-3xl font-semibold">
                            Lexo Core Agreement
                        </h1>

                        <p className="mt-2 max-w-2xl text-sm text-gray-400">
                            Review the agreement before signing it with your connected wallet.
                        </p>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                        {/* Agreement document */}
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md">
                            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                                <div>
                                    <h2 className="text-base font-medium">
                                        Agreement Document
                                    </h2>

                                    <p className="mt-1 text-xs text-gray-500">
                                        Read the complete agreement before signing.
                                    </p>
                                </div>

                                {documentUrl && (
                                    <a
                                        href={documentUrl}
                                        download={documentFileName}
                                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-gray-300 transition hover:bg-white/10"
                                    >
                                        Download
                                    </a>
                                )}
                            </div>

                            <div className="bg-gray-100 p-4 sm:p-8">
                                {documentHtml ? (
                                    <article
                                        className="mx-auto min-h-[700px] max-w-4xl rounded-sm bg-white px-8 py-10 shadow-xl sm:px-14 sm:py-12"
                                        dangerouslySetInnerHTML={{
                                            __html: documentHtml,
                                        }}
                                    />
                                ) : (
                                    <div className="flex h-[700px] items-center justify-center">
                                        <p className="text-sm text-gray-500">
                                            Agreement document could not be displayed.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Agreement details and signing */}
                        <div className="h-fit rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
                            <p className="text-xs uppercase tracking-wider text-gray-500">
                                Agreement
                            </p>

                            <h2 className="mt-2 text-lg font-semibold">
                                Lexo Core Agreement
                            </h2>

                            <div className="my-6 space-y-4">
                                <div>
                                    <p className="text-xs text-gray-500">
                                        Agreement ID
                                    </p>

                                    <p className="mt-1 break-all text-sm text-gray-300">
                                        {agreement?._id || "N/A"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Agreement Hash
                                    </p>

                                    <p className="mt-1 break-all font-mono text-xs text-gray-400">
                                        {agreement?.termsHash || "N/A"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Connected Wallet
                                    </p>

                                    <p className="mt-1 break-all font-mono text-xs text-gray-400">
                                        {address}
                                    </p>
                                </div>
                            </div>

                            <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <input
                                    type="checkbox"
                                    checked={accepted}
                                    onChange={(e) => setAccepted(e.target.checked)}
                                    className="mt-1 h-4 w-4"
                                />

                                <span className="text-sm leading-6 text-gray-300">
                                    I have read and understood the Lexo Core Agreement and agree to sign it with my connected wallet.
                                </span>
                            </label>

                            {signError && (
                                <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                                    {signError instanceof Error
                                        ? signError.message
                                        : "Failed to sign the agreement."}
                                </div>
                            )}

                            <button
                                onClick={handleSign}
                                disabled={!accepted || isSigning || isConfirming}
                                className="w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {isSigning
                                    ? "Waiting for Wallet..."
                                    : isConfirming
                                    ? "Confirming Transaction..."
                                    : "Sign Core Agreement"}
                            </button>

                            <button
                                onClick={() => router.push(`/verify/${userId}/wallet`)}
                                disabled={isSigning || isConfirming}
                                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Back
                            </button>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}