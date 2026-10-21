const AML_ENDPOINT = "https://intelapi.publicaml.org/v1/enrich";

const REQUEST_TIMEOUT_MS = 10000;

const screenWallet = async (walletAddress) => {
    if (!walletAddress) {
        throw new Error("Wallet address is required");
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

    // No screening data: apply the hackathon's LOW default policy.
    // Keep UNKNOWN status so the result remains auditable.
    if (!walletData) {
        console.log(
            "[AML] No screening data found; applying LOW default tier"
        );

        return {
            amlScore: null,
            amlData: null,
            amlStatus: "UNKNOWN",
            riskLevel: "LOW",
            reason: "No AML screening data available",
        };
    }

    const amlScore =
        typeof walletData.aml_score === "number"
            ? walletData.aml_score
            : null;

    const amlStatus =
        walletData.scored === true && amlScore !== null
            ? "SCORED"
            : "INCONCLUSIVE";

    // Do not silently convert an absent provider score to zero.
    const riskLevel =
        amlStatus === "SCORED"
            ? walletData.risk_level ?? "UNKNOWN"
            : "LOW";

    const result = {
        amlScore,
        amlData: walletData,
        amlStatus,
        riskLevel,
        reason:
            amlStatus === "SCORED"
                ? "AML provider returned a scored result"
                : "AML score unavailable; LOW default tier applied",
    };

    console.log(
        "[AML] NORMALIZED RESULT:",
        JSON.stringify(result, null, 2)
    );

    return result;
};

export default screenWallet;
