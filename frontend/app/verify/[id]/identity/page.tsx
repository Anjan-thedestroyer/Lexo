"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CustomProofParamsBuilder } from "@rarimo/zk-passport";

import Navbar from "@/component/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { useVerification } from "../layout";
import { useBackgroundImage } from "@/hooks/background";
// TODO: adjust this import to wherever your axiosInstance lives
import axiosInstance from "@/lib/axios";

const RARIMO_API_URL = "https://api.app.rarime.com";
const EVENT_ID = "1337";
const SELECTOR = "55"; // nullifier + birthDate + expirationDate + nationality + citizenship

const ZkPassportQrCode = dynamic(() => import("@rarimo/zk-passport-react"), {
    ssr: false,
    loading: () => (
        <div className="flex h-[260px] w-[260px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
        </div>
    ),
});

type DecodedPassportData = {
    nullifier: string;
    birthDate: string; // YYMMDD
    expirationDate: string; // YYMMDD
    nationality: string;
    citizenship: string;
};

/* ---------- helpers ---------- */

function decodeField(value: string | number): string {
    try {
        let hex = BigInt(value).toString(16);
        if (hex.length % 2) hex = "0" + hex;

        let result = "";
        for (let i = 0; i < hex.length; i += 2) {
            const byte = parseInt(hex.slice(i, i + 2), 16);
            if (byte !== 0) result += String.fromCharCode(byte);
        }
        return result;
    } catch {
        return String(value);
    }
}
function toBytes32(value: string | number | bigint): string {
    const hex = BigInt(value).toString(16);

    if (hex.length > 64) {
        throw new Error("Nullifier exceeds bytes32 length.");
    }

    return `0x${hex.padStart(64, "0")}`;
}
function decodeProof(proof: any): DecodedPassportData {
    const signals = proof?.pubSignals;

    if (!Array.isArray(signals) || signals.length < 14) {
        throw new Error("Rarimo returned an incomplete proof.");
    }

    return {
        nullifier: toBytes32(signals[0]),
        birthDate: decodeField(signals[1]),
        expirationDate: decodeField(signals[2]),
        nationality: decodeField(signals[5]),
        citizenship: decodeField(signals[6]),
    };
}


/** Parses a passport YYMMDD string. `future` = true for expiry dates. */
function parsePassportDate(yymmdd: string, future: boolean): Date | null {
    if (!/^\d{6}$/.test(yymmdd)) return null;

    const yy = Number(yymmdd.slice(0, 2));
    const mm = Number(yymmdd.slice(2, 4));
    const dd = Number(yymmdd.slice(4, 6));

    const currentYear = new Date().getFullYear();
    const currentYY = currentYear % 100;
    const century = Math.floor(currentYear / 100) * 100;

    let year = century + yy;
    if (future) {
        // expiry dates are normally in the present/future
        if (year < currentYear - 20) year += 100;
    } else if (yy > currentYY) {
        // birth dates can't be in the future
        year -= 100;
    }

    return new Date(year, mm - 1, dd);
}

function isAbove17(birthDate: string): boolean {
    const dob = parsePassportDate(birthDate, false);
    if (!dob) return false;

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hadBirthday =
        today.getMonth() > dob.getMonth() ||
        (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hadBirthday) age--;

    return age > 17;
}

function isPassportExpired(expirationDate: string): boolean {
    const exp = parsePassportDate(expirationDate, true);
    if (!exp) return true; // unreadable → treat as expired
    return exp.getTime() < new Date().setHours(0, 0, 0, 0);
}

/* ---------- page ---------- */

export default function IdentityPage() {
    const params = useParams();
    const router = useRouter();
    const userId = String(params.id);

    const { user } = useAuth();
    const { verificationData, updateVerificationData } = useVerification();

    useBackgroundImage();

    const [rarimoStatus, setRarimoStatus] = useState("waiting");
    const [decodedData, setDecodedData] = useState<DecodedPassportData | null>(null);
    const [status, setStatus] = useState<"idle" | "requesting" | "success" | "error">("idle");
    const [error, setError] = useState("");
    const [nextUrl, setNextUrl] = useState<string | null>(null);

    // Ref guard: prevents double submission even if onSuccess fires twice.
    const submittingRef = useRef(false);

    // Unique per user, stable for the life of the page.
    const requestId = useMemo(() => `lexo-${userId}-${Date.now()}`, [userId]);

    const proofParams = useMemo(
        () =>
            new CustomProofParamsBuilder()
                .withSelector(SELECTOR)
                .withEventId(EVENT_ID)
                .build(),
        []
    );

    const handleProofSuccess = useCallback(
        async (proof: any) => {
            if (submittingRef.current) return;

            try {
                setError("");

                const decoded = decodeProof(proof);
                setDecodedData(decoded);

                if (!decoded.nullifier || decoded.nullifier === "0") {
                    throw new Error("Rarimo did not return a valid identity nullifier.");
                }
                if (!verificationData.walletAddress) {
                    throw new Error("Wallet is missing. Return to the wallet step.");
                }
                if (!verificationData.agreementSigned) {
                    throw new Error("Core Agreement not signed. Complete the agreement step first.");
                }
                if (!verificationData.password) {
                    throw new Error("Password is missing. Restart verification from the first step.");
                }
                if (!user?.email) {
                    throw new Error("Could not read your account email. Please log in again.");
                }

                submittingRef.current = true;
                setStatus("requesting");

                // Exactly what the backend destructures from req.body.
                // (userId comes from the auth session on the server.)
                const payload = {
                    email: user.email,
                    password: verificationData.password,
                    rootWalletAddress: verificationData.walletAddress,
                    nullifier: decoded.nullifier,
                    nationality: decoded.nationality,
                    rarimoProof: proof,
                    ageAbove17: isAbove17(decoded.birthDate),
                    passportExpired: isPassportExpired(decoded.expirationDate),
                };

                const { data } = await axiosInstance.post("/verification/identity-registration", payload);

                if (data?.success === false) {
                    throw new Error(data.message || "The identity request failed.");
                }

                updateVerificationData({
                    rarimoProof: proof,
                    identityHash: decoded.nullifier,
                    nationality: decoded.nationality,
                    ageAbove17: payload.ageAbove17,
                });

                const next = data?.data?.nextUrl;
                setNextUrl(typeof next === "string" && next.startsWith("/") ? next : null);
                setStatus("success");
            } catch (err: any) {
                submittingRef.current = false; // allow retry
                setError(
                    err?.response?.data?.message ||
                        err?.message ||
                        "Unable to process the identity verification."
                );
                setStatus("error");
            }
        },
        [verificationData, user, updateVerificationData]
    );

    const isBusy = status === "requesting";

    const dotClass =
        status === "success"
            ? "bg-emerald-400"
            : status === "error" || rarimoStatus === "error"
            ? "bg-red-400"
            : isBusy
            ? "animate-pulse bg-blue-400"
            : "animate-pulse bg-amber-400";

    const statusText =
        status === "success"
            ? "Identity submitted successfully"
            : isBusy
            ? "Submitting to Lexo..."
            : status === "error"
            ? "Verification needs attention"
            : rarimoStatus === "verified"
            ? "Passport verified; submitting..."
            : "Waiting for passport verification";

    return (
        <div className="relative min-h-screen text-white">
            <div className="relative z-10">
                <Navbar />

                <main className="mx-auto w-full max-w-6xl px-6 py-10">
                    <div className="mb-8">
                        <p className="mb-2 text-sm text-gray-400">Verification Step 3</p>
                        <h1 className="text-3xl font-semibold">Identity Verification</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                            Verify your passport privately with Rarimo zero-knowledge passport
                            verification.
                        </p>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                        <section className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md sm:p-8">
                            <div className="mb-6">
                                <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs text-blue-300">
                                    Zero-Knowledge Verification
                                </span>
                                <h2 className="mt-4 text-xl font-semibold">Scan with the Rarimo app</h2>
                                <p className="mt-2 text-sm leading-6 text-gray-400">
                                    Open the Rarimo app on your mobile device and scan the QR code below.
                                </p>
                            </div>

                            <div className="flex justify-center rounded-2xl border border-white/10 bg-white p-5">
                                <ZkPassportQrCode
                                    apiUrl={RARIMO_API_URL}
                                    requestId={requestId}
                                    verificationOptions={proofParams}
                                    qrProps={{ size: 280 }}
                                    onStatusChange={(s: string) => setRarimoStatus(s)}
                                    onSuccess={(proof: any) => {
                                        void handleProofSuccess(proof);
                                    }}
                                    onError={(err: any) => {
                                        console.error("Rarimo error:", err);
                                        setError(err?.message || "Rarimo verification failed.");
                                        setStatus("error");
                                    }}
                                />
                            </div>

                            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
                                <div>
                                    <p className="text-sm font-medium">{statusText}</p>
                                    <p className="mt-1 text-xs text-gray-500">Rarimo status: {rarimoStatus}</p>
                                </div>
                            </div>

                            {error && (
                                <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-6 text-red-300">
                                    {error}
                                </div>
                            )}

                            {status === "success" && (
                                <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                    <p className="text-sm font-medium text-emerald-300">
                                        Identity verification submitted successfully.
                                    </p>
                                </div>
                            )}
                        </section>

                    </div>
                </main>
            </div>
        </div>
    );
}
