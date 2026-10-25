
const AML_ENDPOINT = "https://intelapi.publicaml.org/v1/enrich";

const REQUEST_TIMEOUT_MS = 10000;
const UNKNOWN_WALLET_SCORE = 20;

const screenWallet = async (walletAddress) => {
    if (
        typeof walletAddress !== "string" ||
        !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
        throw new Error("A valid EVM wallet address is required");
    }

    const response = await fetch(AML_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            addresses: [
                {
                    wallet_address: walletAddress,
                    chain: "ETH",
                },
            ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");

        throw new Error(
            `AML wallet screening failed [HTTP ${response.status}]: ${
                errorBody || "No error body"
            }`
        );
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Invalid JSON response from AML service");
    }

    console.log(
        "[AML] API RESPONSE:",
        JSON.stringify(data, null, 2)
    );

    const walletData = data?.entities?.find(
        (entity) =>
            entity.wallet_address?.toLowerCase() ===
            walletAddress.toLowerCase()
    );

    // Wallet not found in the AML provider's results.
    if (!walletData) {
        const result = {
            amlScore: UNKNOWN_WALLET_SCORE,
            amlData: null,
            amlStatus: "UNKNOWN",
            riskLevel: "LOW",
            amlRiskLevel: "LOW",
            reason: "Wallet not found in AML screening data; fallback score applied",
        };

        console.log(
            "[AML] UNKNOWN WALLET RESULT:",
            JSON.stringify(result, null, 2)
        );

        return result;
    }

    const providerScore =
        typeof walletData.aml_score === "number" &&
        Number.isFinite(walletData.aml_score)
            ? walletData.aml_score
            : null;

    const hasScore =
        walletData.scored === true &&
        providerScore !== null;

    // A missing provider score gets the fallback, but is not
    // misrepresented as a completed AML screening.
    const amlScore = hasScore
        ? providerScore
        : UNKNOWN_WALLET_SCORE;

    const amlStatus = hasScore
        ? "SCORED"
        : "INCONCLUSIVE";

    const riskLevel = hasScore
        ? walletData.risk_level ?? "UNKNOWN"
        : "LOW";

    const result = {
        amlScore,
        amlData: walletData,
        amlStatus,
        riskLevel,
        amlRiskLevel: riskLevel,
        reason: hasScore
            ? "AML provider returned a scored result"
            : "AML score unavailable; fallback score applied",
    };

    console.log(
        "[AML] NORMALIZED RESULT:",
        JSON.stringify(result, null, 2)
    );

    return result;
};

export default screenWallet;
