"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CustomProofParamsBuilder } from "@rarimo/zk-passport";

import Navbar from "@/component/Navbar";
import { useVerification } from "../layout";
import { useBackgroundImage } from "@/hooks/background";

const RARIMO_API_URL = "https://api.app.rarime.com";
const API_URL = process.env.NEXT_PUBLIC_API_URL;
const EVENT_ID = "1337";

const ZkPassportQrCode = dynamic(
    () => import("@rarimo/zk-passport-react"),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-[260px] w-[260px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
            </div>
        ),
    }
);

type DecodedPassportData = {
    nullifier: string;
    birthDateRaw: string;
    birthDate: string;
    expirationDateRaw: string;
    expirationDate: string;
    nationalityRaw: string;
    nationality: string;
    citizenshipRaw: string;
    citizenship: string;
    eventId: string;
    selector: string;
    currentDate: string;
};

type AttestationResponse = {
    success?: boolean;
    message?: string;
    data?: {
        status?: string;
        nextUrl?: string;
        [key: string]: unknown;
    };
};

function decodeField(value: string | number): string {
    try {
        const hex = BigInt(value).toString(16);

        const paddedHex =
            hex.length % 2 === 0
                ? hex
                : "0" + hex;

        let result = "";

        for (let i = 0; i < paddedHex.length; i += 2) {
            const byte = parseInt(
                paddedHex.slice(i, i + 2),
                16
            );

            if (byte !== 0) {
                result += String.fromCharCode(byte);
            }
        }

        return result;
    } catch {
        return String(value);
    }
}

function decodePassportDate(
    value: string | number
): string {
    return decodeField(value);
}

function decodeProof(proof: any): DecodedPassportData {
    if (!proof?.pubSignals) {
        throw new Error("Rarimo did not return pubSignals.");
    }

    const signals = proof.pubSignals;

    if (!Array.isArray(signals) || signals.length < 14) {
        throw new Error(
            "Rarimo returned an incomplete proof."
        );
    }

    return {
        nullifier: String(signals[0]),

        birthDateRaw: String(signals[1]),
        birthDate: decodePassportDate(signals[1]),

        expirationDateRaw: String(signals[2]),
        expirationDate: decodePassportDate(signals[2]),

        nationalityRaw: String(signals[5]),
        nationality: decodeField(signals[5]),

        citizenshipRaw: String(signals[6]),
        citizenship: decodeField(signals[6]),

        eventId: String(signals[9]),
        selector: String(signals[12]),
        currentDate: String(signals[13]),
    };
}

export default function IdentityPage() {
    const params = useParams();
    const router = useRouter();

    const userId = String(params.id);

    const {
        verificationData,
        updateVerificationData,
    } = useVerification();

    useBackgroundImage();

    const [rarimoStatus, setRarimoStatus] =
        useState("waiting");

    const [decodedData, setDecodedData] =
        useState<DecodedPassportData | null>(null);

    const [rarimoVerificationData, setRarimoVerificationData] =
        useState<any>(null);

    const [attestationStatus, setAttestationStatus] =
        useState<
            "idle" |
            "requesting" |
            "success" |
            "error"
        >("idle");

    const [error, setError] = useState("");

    const [attestationResult, setAttestationResult] =
        useState<AttestationResponse | null>(null);

    /*
     * Keep the request ID stable.
     *
     * The same requestId is used by:
     *
     * QR code
     * verification-status endpoint
     * verified-data endpoint
     */
    const requestId = useMemo(
        () => `test-account-1`,
        []
    );

    const proofParams = useMemo(
        () =>
            new CustomProofParamsBuilder()
                .withSelector("55")
                .withEventId(EVENT_ID)
                .build(),
        []
    );

    /*
     * Get the verification status from Rarimo.
     *
     * This follows the same format as your working
     * test implementation.
     */
    const fetchVerificationStatus =
        useCallback(async () => {
            try {
                console.log(
                    "Checking Rarimo verification status..."
                );

                const response = await fetch(
                    `${RARIMO_API_URL}/integrations/verificator-svc/private/verification-status/${requestId}`
                );

                if (!response.ok) {
                    throw new Error(
                        `Rarimo verification status request failed: ${response.status}`
                    );
                }

                const result = await response.json();

                console.log(
                    "===== RARIMO VERIFICATION STATUS ====="
                );

                console.dir(result, {
                    depth: null,
                });

                return result;
            } catch (err) {
                console.error(
                    "Failed to fetch Rarimo verification status:",
                    err
                );

                throw err;
            }
        }, [requestId]);

    /*
     * Get the verified passport data from Rarimo.
     *
     * This is the same endpoint used in your
     * working test application.
     */
    const fetchVerifiedData =
        useCallback(async () => {
            try {
                console.log(
                    "Fetching Rarimo verified data..."
                );

                const response = await fetch(
                    `${RARIMO_API_URL}/integrations/verificator-svc/private/user/${requestId}`
                );

                if (!response.ok) {
                    throw new Error(
                        `Rarimo verified-data request failed: ${response.status}`
                    );
                }

                const result = await response.json();

                console.log(
                    "===== RARIMO VERIFIED DATA ====="
                );

                console.dir(result, {
                    depth: null,
                });

                setRarimoVerificationData(result);

                return result;
            } catch (err) {
                console.error(
                    "Failed to fetch Rarimo verified data:",
                    err
                );

                throw err;
            }
        }, [requestId]);

    /*
     * Request Lexo backend attestation.
     *
     * This happens ONLY after:
     *
     * 1. Rarimo mobile verification completed
     * 2. proof was received
     * 3. Rarimo verification data was retrieved
     */
    const requestAttestation = useCallback(
        async (
            proof: any,
            passportData: DecodedPassportData,
            rarimoData: any
        ) => {
            if (attestationStatus === "requesting") {
                return;
            }

            if (!API_URL) {
                setError(
                    "The backend API URL is not configured."
                );

                setAttestationStatus("error");
                return;
            }

            if (
                !passportData.nullifier ||
                passportData.nullifier === "0"
            ) {
                setError(
                    "Rarimo did not return a valid identity nullifier."
                );

                setAttestationStatus("error");
                return;
            }

            if (!verificationData?.walletAddress) {
                setError(
                    "Your connected wallet data is missing. Return to the wallet verification step."
                );

                setAttestationStatus("error");
                return;
            }

            if (!verificationData?.agreementSigned) {
                setError(
                    "Your Core Agreement signature is missing. Please complete the agreement step first."
                );

                setAttestationStatus("error");
                return;
            }

            setAttestationStatus("requesting");
            setError("");

            try {
                /*
                 * Never send the user's password or an old
                 * client-side Rarimo proof as part of the
                 * trusted accumulated verification data.
                 */
                const {
                    password: _password,
                    rarimoProof: _previousProof,
                    ...previousVerificationData
                } = verificationData;

                const payload = {
                    userId,
                    requestId,

                    /*
                     * Rarimo event information.
                     */
                    eventId:
                        passportData.eventId,

                    selector:
                        passportData.selector,

                    /*
                     * Data accumulated from previous
                     * Lexo verification steps.
                     */
                    ...previousVerificationData,

                    /*
                     * Identity derived from the ZK proof.
                     */
                    identityHash:
                        passportData.nullifier,

                    nullifier:
                        passportData.nullifier,

                    nationality:
                        passportData.nationality,

                    citizenship:
                        passportData.citizenship,

                    birthDate:
                        passportData.birthDate,

                    expirationDate:
                        passportData.expirationDate,

                    /*
                     * Full Rarimo verified-data response.
                     *
                     * Your backend should validate this rather
                     * than blindly trusting client-provided fields.
                     */
                    rarimoData,

                    /*
                     * Full ZK proof.
                     *
                     * Backend must verify it before issuing
                     * any trusted attestation.
                     */
                    rarimoProof: proof,
                };

                console.log(
                    "===== LEXO ATTESTATION PAYLOAD ====="
                );

                console.dir(payload, {
                    depth: null,
                });

                const response = await fetch(
                    `${API_URL}/identity/request-attestation`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json",
                        },
                        credentials: "include",
                        body: JSON.stringify(
                            payload
                        ),
                    }
                );

                const result =
                    (await response.json()) as AttestationResponse;

                if (
                    !response.ok ||
                    result.success !== true
                ) {
                    throw new Error(
                        result.message ||
                        "The attestation request failed."
                    );
                }

                updateVerificationData({
                    identityHash:
                        passportData.nullifier,

                    nullifier:
                        passportData.nullifier,

                    nationality:
                        passportData.nationality,

                    citizenship:
                        passportData.citizenship,

                    birthDate:
                        passportData.birthDate,

                    expirationDate:
                        passportData.expirationDate,

                    rarimoVerified: true,
                });

                setAttestationResult(result);
                setAttestationStatus("success");
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Unable to request the identity attestation."
                );

                setAttestationStatus("error");
            }
        },
        [
            attestationStatus,
            requestId,
            userId,
            verificationData,
            updateVerificationData,
        ]
    );

    /*
     * Mobile verification completed.
     *
     * This now follows the exact sequence from
     * your working test implementation:
     *
     * onSuccess
     *   ↓
     * decode proof
     *   ↓
     * fetch verification status
     *   ↓
     * fetch verified data
     *   ↓
     * request Lexo attestation
     */
    const handleProofSuccess =
        useCallback(
            async (proof: any) => {
                try {
                    setError("");

                    console.log(
                        "======================================"
                    );

                    console.log(
                        "        ZK PROOF SUCCESS"
                    );

                    console.log(
                        "======================================"
                    );

                    console.dir(proof, {
                        depth: null,
                    });

                    /*
                     * Decode pubSignals.
                     */
                    const decoded =
                        decodeProof(proof);

                    console.log(
                        "Decoded passport data:",
                        decoded
                    );

                    setDecodedData(decoded);

                    /*
                     * Fetch the same Rarimo verification
                     * status used by your working test.
                     */
                    const status =
                        await fetchVerificationStatus();

                    console.log(
                        "Rarimo status result:",
                        status
                    );

                    /*
                     * Fetch the verified data associated
                     * with this request ID.
                     */
                    const verifiedData =
                        await fetchVerifiedData();

                    /*
                     * Now send EVERYTHING required to
                     * your Lexo backend.
                     */
                    await requestAttestation(
                        proof,
                        decoded,
                        verifiedData
                    );
                } catch (err) {
                    console.error(
                        "Identity verification processing failed:",
                        err
                    );

                    setError(
                        err instanceof Error
                            ? err.message
                            : "Unable to process the Rarimo verification."
                    );

                    setAttestationStatus(
                        "error"
                    );
                }
            },
            [
                fetchVerificationStatus,
                fetchVerifiedData,
                requestAttestation,
            ]
        );

    const isBusy =
        attestationStatus === "requesting";

    return (
        <div className="relative min-h-screen text-white">
            <div className="relative z-10">
                <Navbar />

                <main className="mx-auto w-full max-w-6xl px-6 py-10">
                    <div className="mb-8">
                        <p className="mb-2 text-sm text-gray-400">
                            Verification Step 3
                        </p>

                        <h1 className="text-3xl font-semibold">
                            Identity Verification
                        </h1>

                        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                            Verify your passport privately
                            with Rarimo zero-knowledge
                            passport verification.
                        </p>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                        <section className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md sm:p-8">
                            <div className="mb-6">
                                <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs text-blue-300">
                                    Zero-Knowledge Verification
                                </span>

                                <h2 className="mt-4 text-xl font-semibold">
                                    Scan with the Rarimo app
                                </h2>

                                <p className="mt-2 text-sm leading-6 text-gray-400">
                                    Open the Rarimo app on
                                    your mobile device and
                                    scan the QR code below.
                                </p>
                            </div>

                            <div className="flex justify-center rounded-2xl border border-white/10 bg-white p-5">
                                <ZkPassportQrCode
                                    apiUrl={
                                        RARIMO_API_URL
                                    }
                                    requestId={
                                        requestId
                                    }
                                    verificationOptions={
                                        proofParams
                                    }
                                    qrProps={{
                                        size: 280,
                                    }}
                                    onStatusChange={(
                                        newStatus: string
                                    ) => {
                                        console.log(
                                            "RARIMO STATUS:",
                                            newStatus
                                        );

                                        setRarimoStatus(
                                            newStatus
                                        );
                                    }}
                                    onSuccess={(
                                        proof: any
                                    ) => {
                                        void handleProofSuccess(
                                            proof
                                        );
                                    }}
                                    onError={(
                                        err: any
                                    ) => {
                                        console.error(
                                            "========== RARIMO ERROR =========="
                                        );

                                        console.error(
                                            "name:",
                                            err?.name
                                        );

                                        console.error(
                                            "message:",
                                            err?.message
                                        );

                                        console.error(
                                            "httpStatus:",
                                            err?.httpStatus
                                        );

                                        console.error(
                                            "meta:",
                                            err?.meta
                                        );

                                        console.error(
                                            "nestedErrors:",
                                            err?.nestedErrors
                                        );

                                        console.dir(
                                            err,
                                            {
                                                depth: null,
                                                showHidden: true,
                                            }
                                        );

                                        setError(
                                            err?.message ||
                                            "Rarimo verification failed."
                                        );

                                        setAttestationStatus(
                                            "error"
                                        );
                                    }}
                                />
                            </div>

                            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <span
                                    className={`h-2.5 w-2.5 rounded-full ${
                                        attestationStatus ===
                                        "success"
                                            ? "bg-emerald-400"
                                            : attestationStatus ===
                                                  "error" ||
                                              rarimoStatus ===
                                                  "error"
                                            ? "bg-red-400"
                                            : isBusy
                                            ? "animate-pulse bg-blue-400"
                                            : "animate-pulse bg-amber-400"
                                    }`}
                                />

                                <div>
                                    <p className="text-sm font-medium">
                                        {attestationStatus ===
                                        "success"
                                            ? "Identity attestation accepted"
                                            : isBusy
                                            ? "Requesting server attestation..."
                                            : attestationStatus ===
                                              "error"
                                            ? "Verification needs attention"
                                            : rarimoStatus ===
                                              "verified"
                                            ? "Passport verified; retrieving identity data..."
                                            : "Waiting for passport verification"}
                                    </p>

                                    <p className="mt-1 text-xs text-gray-500">
                                        Rarimo status:{" "}
                                        {rarimoStatus}
                                    </p>
                                </div>
                            </div>

                            {error && (
                                <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-6 text-red-300">
                                    {error}
                                </div>
                            )}

                            {attestationStatus ===
                                "success" && (
                                <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                    <p className="text-sm font-medium text-emerald-300">
                                        Identity verification
                                        submitted successfully.
                                    </p>

                                    <p className="mt-2 text-xs leading-5 text-gray-300">
                                        Rarimo verification data
                                        was received and the
                                        Lexo backend accepted
                                        the attestation request.
                                    </p>
                                </div>
                            )}
                        </section>

                        <aside className="h-fit rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
                            <p className="text-xs uppercase tracking-wider text-gray-500">
                                Verification Summary
                            </p>

                            <h2 className="mt-2 text-lg font-semibold">
                                Your verification
                            </h2>

                            <div className="my-6 space-y-4">
                                <div>
                                    <p className="text-xs text-gray-500">
                                        Connected Wallet
                                    </p>

                                    <p className="mt-1 break-all font-mono text-xs text-gray-300">
                                        {verificationData?.walletAddress ||
                                            "Not available"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Core Agreement
                                    </p>

                                    <p className="mt-1 text-sm text-gray-300">
                                        {verificationData?.agreementSigned
                                            ? "Signed"
                                            : "Not confirmed"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Passport Verification
                                    </p>

                                    <p className="mt-1 text-sm text-gray-300">
                                        {decodedData
                                            ? "Proof received"
                                            : "Waiting"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Rarimo Verification Data
                                    </p>

                                    <p className="mt-1 text-sm text-gray-300">
                                        {rarimoVerificationData
                                            ? "Received"
                                            : "Waiting"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-gray-500">
                                        Identity Nullifier
                                    </p>

                                    <p className="mt-1 break-all font-mono text-xs text-gray-400">
                                        {decodedData?.nullifier ||
                                            "Not available"}
                                    </p>
                                </div>

                                {decodedData && (
                                    <>
                                        <div>
                                            <p className="text-xs text-gray-500">
                                                Nationality
                                            </p>

                                            <p className="mt-1 text-sm text-gray-300">
                                                {decodedData.nationality ||
                                                    "Not provided"}
                                            </p>
                                        </div>

                                        <div>
                                            <p className="text-xs text-gray-500">
                                                Citizenship
                                            </p>

                                            <p className="mt-1 text-sm text-gray-300">
                                                {decodedData.citizenship ||
                                                    "Not provided"}
                                            </p>
                                        </div>

                                        <div>
                                            <p className="text-xs text-gray-500">
                                                Birth Date
                                            </p>

                                            <p className="mt-1 text-sm text-gray-300">
                                                {decodedData.birthDate ||
                                                    "Not provided"}
                                            </p>
                                        </div>

                                        <div>
                                            <p className="text-xs text-gray-500">
                                                Expiration Date
                                            </p>

                                            <p className="mt-1 text-sm text-gray-300">
                                                {decodedData.expirationDate ||
                                                    "Not provided"}
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <p className="text-xs leading-5 text-gray-400">
                                    Your identity is linked
                                    using the Rarimo nullifier.
                                    The Rarimo proof and
                                    verification response must
                                    be validated before Lexo
                                    issues a trusted identity
                                    attestation.
                                </p>
                            </div>

                            {attestationStatus ===
                                "success" && (
                                <button
                                    onClick={() => {
                                        const nextUrl =
                                            attestationResult?.data &&
                                            typeof attestationResult
                                                .data
                                                .nextUrl ===
                                                "string"
                                                ? attestationResult
                                                      .data
                                                      .nextUrl
                                                : null;

                                        if (
                                            nextUrl?.startsWith(
                                                "/"
                                            )
                                        ) {
                                            router.replace(
                                                nextUrl
                                            );
                                        }
                                    }}
                                    className="mt-5 w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-gray-200"
                                >
                                    Continue
                                </button>
                            )}

                            <button
                                onClick={() =>
                                    router.push(
                                        `/verify/${userId}/wallet`
                                    )
                                }
                                disabled={isBusy}
                                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Back to Wallet
                            </button>
                        </aside>
                    </div>
                </main>
            </div>
        </div>
    );
}
