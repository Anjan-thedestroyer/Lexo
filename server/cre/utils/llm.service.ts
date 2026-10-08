import {
  cre,
  ok,
  json,
  consensusIdenticalAggregation,
  type Runtime,
} from "@chainlink/cre-sdk";

export type LLMVerificationType = "IDENTITY" | "ADD_WALLET";
export type LLMDecision = "APPROVE" | "MANUAL_REVIEW" | "REJECT";
export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface LLMExplanationPayload {
  type: LLMVerificationType;
  wallet: string;
  riskScore: number;
  riskTier: RiskTier;
  decision: LLMDecision;
  signals: Record<string, any>;
  nationality?: string;
  countryRisk?: {
    score: number;
  };
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function sanitizeSignals(
  type: LLMVerificationType,
  signals: Record<string, any>,
): Record<string, any> {
  const allowedKeys =
    type === "IDENTITY"
      ? [
          "ageAbove17",
          "passportExpired",
          "authLevel",
          "nationality",
          "countryRisk",
        ]
      : [
          "sanctions",
          "pep",
          "fraud",
          "walletRisk",
          "mixerExposure",
          "highRiskWallet",
          "transactionRisk",
          "amlScore",
          "nationality",
          "countryRisk",
        ];

  const sanitized: Record<string, any> = {};

  for (const key of allowedKeys) {
    if (signals[key] !== undefined) {
      sanitized[key] = signals[key];
    }
  }

  return sanitized;
}

export function fetchLLMExplanation(
  runtime: Runtime<any>,
  payload: LLMExplanationPayload,
): string {
  const fallbackResponse =
    payload.decision === "APPROVE"
      ? "The verification signals satisfy the configured approval criteria."
      : payload.decision === "MANUAL_REVIEW"
        ? "The verification requires additional human review based on the configured risk signals."
        : "The verification does not satisfy the configured approval criteria.";

  try {
    const apiKeySecret = runtime
      .getSecret({ id: "OPENROUTER_API_KEY" })
      .result();

    const apiKey = apiKeySecret.value;

    if (!apiKey) {
      runtime.log("[CRE] OPENROUTER_API_KEY is not configured.");
      return fallbackResponse;
    }

    const sanitizedSignals = sanitizeSignals(
      payload.type,
      payload.signals,
    );

    const countryRiskContext = payload.countryRisk
      ? `Country risk: ${payload.countryRisk.score}.`
      : "Country risk: unavailable.";

    const systemPrompt = `
You are an explanation assistant for Lexo's identity and wallet verification system.

The deterministic risk engine has already calculated:
- risk score
- risk tier
- final decision

You MUST NOT change, recalculate, or override those results.

Your job is ONLY to explain the existing decision using the supplied verification signals.

Important:
- Country risk is contextual information only.
- Country risk must NOT be treated as proof of sanctions, fraud, criminal activity, or wrongdoing.
- MANUAL_REVIEW means a human reviewer is required.
- Do not invent facts.
- Keep the explanation concise.
- Return exactly 2 or 3 sentences.
`;

    const userPrompt = `
Verification type: ${payload.type}
Wallet: ${payload.wallet}
Decision: ${payload.decision}
Risk score: ${payload.riskScore}
Risk tier: ${payload.riskTier}
Nationality: ${payload.nationality || "Unknown"}
${countryRiskContext}

Verification signals:
${JSON.stringify(sanitizedSignals, null, 2)}
`;

    const httpClient = new cre.capabilities.HTTPClient();

    const result = httpClient
    .sendRequest(
      runtime,
      (sender) => {
        const response = sender
          .sendRequest({
            url: "https://openrouter.ai/api/v1/chat/completions",
            method: "POST",
            multiHeaders: {
              "Content-Type": ["application/json"],
              Authorization: [`Bearer ${apiKey}`],
            },
            body: JSON.stringify({
              model: "openrouter/free",
              max_tokens: 200,
              temperature: 0,
              messages: [
                {
                  role: "system",
                  content: systemPrompt,
                },
                {
                  role: "user",
                  content: userPrompt,
                },
              ],
            }),
          })
          .result();

        if (!ok(response)) {
          throw new Error(
            `OpenRouter HTTP ${response.statusCode}`,
          );
        }

        const data = json(response) as OpenRouterResponse;

        return (
          data.choices?.[0]?.message?.content?.trim() ||
          fallbackResponse
        );
      },
      consensusIdenticalAggregation<string>(),
    )()
  .result();

    return result || fallbackResponse;
  } catch (error) {
    runtime.log(
      `[CRE] LLM explanation failed: ${String(error)}`,
    );

    return fallbackResponse;
  }
}