import {
  cre,
  ok,
  json,
  consensusIdenticalAggregation,
  type Runtime,
} from "@chainlink/cre-sdk";

// ============================================================
// TYPES
// ============================================================

export type LLMVerificationType = "IDENTITY" | "ADD_WALLET";

export type LLMDecision =
  | "APPROVE"
  | "MANUAL_REVIEW"
  | "REJECT";

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

type OpenRouterContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>
  | null
  | undefined;

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: OpenRouterContent;
      refusal?: string | null;
    };
  }>;
  error?: {
    message?: string;
    code?: number;
  };
}

// ============================================================
// FALLBACK EXPLANATION
// ============================================================

function getFallbackExplanation(
  payload: LLMExplanationPayload,
): string {
  const {
    decision,
    type,
    signals,
    riskScore,
    riskTier,
  } = payload;

  // ----------------------------------------------------------
  // IDENTITY FALLBACK
  // ----------------------------------------------------------

  if (type === "IDENTITY") {
    const ageAbove17 = signals.ageAbove17;
    const passportExpired = signals.passportExpired;

    if (decision === "APPROVE") {
      return (
        `The identity verification was approved with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
        `${
          ageAbove17 === true
            ? "The applicant meets the configured age eligibility requirement."
            : "The available age verification signals satisfy the configured approval criteria."
        } ` +
        `${
          passportExpired === false
            ? "The passport is recorded as valid and unexpired."
            : "The available passport signals satisfy the configured approval criteria."
        }`
      );
    }

    if (decision === "MANUAL_REVIEW") {
      return (
        `The identity verification requires additional human review with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
        `The available identity and risk signals require further assessment before a final decision can be made.`
      );
    }

    const reasons: string[] = [];

    if (ageAbove17 === false) {
      reasons.push(
        "the applicant does not meet the configured age eligibility requirement",
      );
    }

    if (passportExpired === true) {
      reasons.push("the passport is recorded as expired");
    }

    const reasonText = reasons.length
      ? reasons.join(" and ")
      : "the identity verification signals do not satisfy the configured approval criteria";

    return (
      `The identity verification was rejected with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
      `This decision was based on ${reasonText}.`
    );
  }

  // ----------------------------------------------------------
  // ADD WALLET FALLBACK
  // ----------------------------------------------------------

  const reasons: string[] = [];

  if (signals.sanctions === true) {
    reasons.push("a sanctions exposure indicator");
  }

  if (signals.pep === true) {
    reasons.push("a politically exposed person (PEP) indicator");
  }

  if (signals.fraud === true) {
    reasons.push("a fraud risk indicator");
  }

  if (signals.mixerExposure === true) {
    reasons.push("mixer exposure");
  }

  if (signals.highRiskWallet === true) {
    reasons.push("a high-risk wallet indicator");
  }

  if (
    typeof signals.walletRisk === "string" &&
    signals.walletRisk.toUpperCase() === "HIGH"
  ) {
    reasons.push("a high wallet risk classification");
  }

  if (
    typeof signals.transactionRisk === "string" &&
    signals.transactionRisk.toUpperCase() === "HIGH"
  ) {
    reasons.push("a high transaction risk classification");
  }

  if (decision === "APPROVE") {
    return (
      `The wallet addition was approved with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
      `The available AML and wallet screening signals satisfy the configured approval criteria.`
    );
  }

  if (decision === "MANUAL_REVIEW") {
    const reasonText = reasons.length
      ? reasons.join(", ")
      : "the available wallet screening signals";

    return (
      `The wallet addition requires additional human review with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
      `The decision reflects ${reasonText}, which require further assessment.`
    );
  }

  const reasonText = reasons.length
    ? reasons.join(", ")
    : "the available wallet screening results";

  const amlScore =
    typeof signals.amlScore === "number"
      ? ` The wallet also received an AML score of ${signals.amlScore}/100.`
      : "";

  return (
    `The wallet addition was rejected with a ${riskTier.toLowerCase()} risk score of ${riskScore}/100. ` +
    `The decision was based on ${reasonText}.${amlScore}`
  );
}

// ============================================================
// SANITIZE SIGNALS
// ============================================================

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

// ============================================================
// SYSTEM PROMPT
// ============================================================

function getSystemPrompt(
  type: LLMVerificationType,
): string {
  const verificationDescription =
    type === "IDENTITY"
      ? `
You are explaining an identity verification decision.

Consider relevant signals such as:
- Age eligibility
- Passport validity
- Authentication level
- Nationality and contextual country risk
- Identity verification evidence
`
      : `
You are explaining a wallet addition verification decision.

Consider relevant signals such as:
- Sanctions exposure
- Politically exposed person (PEP) indicators
- Fraud indicators
- Wallet risk
- Mixer exposure
- High-risk wallet indicators
- Transaction risk
- AML score
`;

  return `
You are Lexo's AI verification explanation assistant.

${verificationDescription}

The deterministic risk engine has already calculated:
- Risk score
- Risk tier
- Final decision

You MUST NOT change, recalculate, or override these results.

Your responsibility is ONLY to explain the existing decision using the supplied signals.

IMPORTANT RULES:

1. Never change the supplied decision, risk score, or risk tier.
2. Never invent verification evidence or unsupported allegations.
3. Country risk is contextual information only.
4. Country risk must not be treated as proof of sanctions, fraud, criminal activity, or individual wrongdoing.
5. APPROVE means the verification satisfies the configured approval criteria.
6. MANUAL_REVIEW means additional human review is required.
7. REJECT means the verification does not satisfy the configured approval criteria.
8. Explain relevant positive and negative signals.
9. Only describe signals explicitly present in the supplied data.
10. Keep the explanation professional and concise.
11. Return exactly 2 or 3 sentences.
12. Return only the explanation, without headings or bullet points.
`;
}

// ============================================================
// USER PROMPT
// ============================================================

function getUserPrompt(
  payload: LLMExplanationPayload,
  signals: Record<string, any>,
): string {
  return `
Verification type: ${payload.type}

Wallet: ${payload.wallet}

Decision: ${payload.decision}

Risk score: ${payload.riskScore}/100

Risk tier: ${payload.riskTier}

Nationality: ${payload.nationality || "Unknown"}

Country risk score: ${
    payload.countryRisk?.score ?? "Unavailable"
  }

Verification signals:

${JSON.stringify(signals, null, 2)}

Explain why the deterministic verification system reached this decision.
`;
}

// ============================================================
// EXTRACT OPENROUTER EXPLANATION
// ============================================================

function extractExplanation(
  content: OpenRouterContent,
): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (item: { type?: string; text?: string }) =>
          item.type === "text" &&
          typeof item.text === "string",
      )
      .map(
        (item: { type?: string; text?: string }) =>
          item.text!,
      )
      .join(" ")
      .trim();
  }

  return "";
}

// ============================================================
// SHARED LLM EXPLANATION SERVICE
// ============================================================

export function fetchLLMExplanation(
  runtime: Runtime<any>,
  payload: LLMExplanationPayload,
): string {
  const fallbackResponse = getFallbackExplanation(payload);

  try {
    // --------------------------------------------------------
    // 1. LOAD API KEY
    // --------------------------------------------------------

    runtime.log(
      `[CRE] Requesting ${payload.type} AI explanation...`,
    );

    const apiKeySecret = runtime
      .getSecret({
        id: "OPENROUTER_API_KEY",
      })
      .result();

    const apiKey = apiKeySecret.value;

    if (
      typeof apiKey !== "string" ||
      !apiKey.trim()
    ) {
      runtime.log(
        "[CRE] ERROR: OPENROUTER_API_KEY is missing or empty.",
      );

      return fallbackResponse;
    }

    runtime.log(
      "[CRE] OpenRouter API key loaded successfully.",
    );

    // --------------------------------------------------------
    // 2. PREPARE PROMPTS
    // --------------------------------------------------------

    const sanitizedSignals = sanitizeSignals(
      payload.type,
      payload.signals,
    );

    const systemPrompt = getSystemPrompt(
      payload.type,
    );

    const userPrompt = getUserPrompt(
      payload,
      sanitizedSignals,
    );

    // --------------------------------------------------------
    // 3. OPENROUTER REQUEST
    // --------------------------------------------------------

    runtime.log(
      `[CRE] Sending ${payload.type} explanation request to OpenRouter...`,
    );

    const httpClient = new cre.capabilities.HTTPClient();

    const result = httpClient
      .sendRequest(
        runtime,
        (sender) => {
          const requestBody = {
            model: "openrouter/free",
            max_tokens: 300,
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
          };

          // CRE requires Base64-encoded request bodies.
          const bodyBytes = new TextEncoder().encode(
            JSON.stringify(requestBody),
          );

          const body = Buffer.from(
            bodyBytes,
          ).toString("base64");

          const response = sender
            .sendRequest({
              url: "https://openrouter.ai/api/v1/chat/completions",
              method: "POST",
              timeout: "30s",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body,
            })
            .result();

          runtime.log(
            `[CRE] OpenRouter HTTP status: ${response.statusCode}`,
          );

          if (!ok(response)) {
            throw new Error(
              `OpenRouter HTTP ${response.statusCode}`,
            );
          }

          const data = json(
            response,
          ) as OpenRouterResponse;

          if (data.error) {
            throw new Error(
              data.error.message || "OpenRouter API error",
            );
          }

          const choice = data.choices?.[0];

          const explanation = extractExplanation(
            choice?.message?.content,
          );

          if (!explanation) {
            runtime.log(
              `[CRE] OpenRouter returned no text. Finish reason: ${
                choice?.finish_reason ?? "unknown"
              }`,
            );

            runtime.log(
              `[CRE] OpenRouter model: ${data.model ?? "unknown"}`,
            );

            runtime.log(
              `[CRE] OpenRouter choices: ${data.choices?.length ?? 0}`,
            );

            if (choice?.message?.refusal) {
              runtime.log(
                `[CRE] OpenRouter refusal: ${choice.message.refusal}`,
              );
            }

            throw new Error(
              "OpenRouter returned an empty explanation",
            );
          }

          runtime.log(
            `[CRE] ${payload.type} AI explanation generated successfully.`,
          );

          return explanation;
        },
        consensusIdenticalAggregation<string>(),
      )()
      .result();

    // --------------------------------------------------------
    // 4. RETURN RESULT
    // --------------------------------------------------------

    if (
      typeof result !== "string" ||
      !result.trim()
    ) {
      runtime.log(
        "[CRE] Empty LLM result. Using fallback explanation.",
      );

      return fallbackResponse;
    }

    return result.trim();

  } catch (error) {
    runtime.log(
      `[CRE] ${payload.type} LLM explanation failed: ${String(error)}`,
    );

    runtime.log(
      "[CRE] Using fallback explanation.",
    );

    return fallbackResponse;
  }
}
