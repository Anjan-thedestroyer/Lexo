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

    const walletData = data?.entities?.[0];

    if (!walletData) {
        throw new Error("No AML screening result returned for wallet");
    }

    return {
    amlScore:
        typeof walletData.aml_score === "number"
            ? walletData.aml_score
            : null,

    amlData: walletData,
};
};

export default screenWallet;