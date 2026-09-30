
export type LLMVerificationType =
  | "IDENTITY"
  | "ADD_WALLET";

export type LLMDecision =
  | "APPROVE"
  | "MANUAL_REVIEW"
  | "REJECT";

export type RiskTier =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface LLMExplanationPayload {
  // Which CRE workflow is requesting the explanation
  type: LLMVerificationType;

  // Wallet being verified
  wallet: string;

  // Deterministic result
  riskScore: number;
  riskTier: RiskTier;
  decision: LLMDecision;

  // Sanitized deterministic signals
  signals: Record<string, any>;

  // Full AML information can be supplied when relevant.
  // Mainly used by ADD_WALLET.
  amlData?: Record<string, any>;

  // Identity / country information
  nationality?: string;

  // Country risk returned by countryRisk.json
  countryRisk?: {
    countryCode: string;
    country: string | null;
    score: number;
    level: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
    reasons: Array<{
      code: string;
      description: string;
      points: number;
      source: string;
      sourceUrl: string;
    }>;
    policyVersion: string;
    found: boolean;
  };
}

const REQUEST_TIMEOUT_MS = 5000;


// ============================================================
// SIGNAL SANITIZATION
// ============================================================

/**
 * Keeps only deterministic compliance signals that are
 * relevant to the current verification workflow.
 *
 * The LLM receives these signals ONLY to explain the
 * already-computed decision.
 *
 * The LLM MUST NOT independently calculate risk.
 */
function sanitizeSignals(
  signals: Record<string, any>,
  type: LLMVerificationType
): Record<string, any> {

  const identityKeys = [
    "ageAbove17",
    "passportExpired",
    "authLevel",
    "nationality",

    // Country risk from official countryRisk.json
    "countryRisk",
  ];

  const walletKeys = [
    "sanctions",
    "pep",
    "fraud",
    "walletRisk",
    "mixerExposure",
    "highRiskWallet",
    "transactionRisk",
    "amlScore",

    "nationality",

    // Country risk from official countryRisk.json
    "countryRisk",
  ];

  const allowedKeys =
    type === "IDENTITY"
      ? identityKeys
      : walletKeys;

  return Object.keys(signals)
    .filter((key) =>
      allowedKeys.includes(key)
    )
    .reduce(
      (obj, key) => {
        obj[key] = signals[key];
        return obj;
      },
      {} as Record<string, any>
    );
}


// ============================================================
// LLM EXPLANATION
// ============================================================

/**
 * Generates a factual explanation for:
 *
 * 1. Initial identity registration
 * 2. Adding a wallet to an existing identity
 *
 * The deterministic rule engine has ALREADY produced:
 *
 * - Risk score
 * - Risk tier
 * - Decision
 *
 * The LLM ONLY explains those results.
 */
export async function fetchLLMExplanation(
  payload: LLMExplanationPayload
): Promise<string> {

  const apiKey =
    process.env.OPENROUTER_API_KEY;

  // ----------------------------------------------------------
  // Fallback
  // ----------------------------------------------------------

  const verificationName =
    payload.type === "IDENTITY"
      ? "identity verification"
      : "wallet addition";

  const fallbackResponse =
    `${verificationName} completed with a risk score of ` +
    `${payload.riskScore}/100 (${payload.riskTier}). ` +
    `Decision: ${payload.decision}.`;

  if (!apiKey) {
    return fallbackResponse;
  }


  // ----------------------------------------------------------
  // Sanitize signals
  // ----------------------------------------------------------

  const cleanSignals =
    sanitizeSignals(
      payload.signals,
      payload.type
    );


  // ----------------------------------------------------------
  // Verification context
  // ----------------------------------------------------------

  const verificationContext =
    payload.type === "IDENTITY"
      ? "initial identity registration and verification"
      : "adding a wallet to an existing verified identity";


  // ----------------------------------------------------------
  // Country risk context
  // ----------------------------------------------------------

  const countryRiskContext =
    payload.countryRisk
      ? {
          countryCode:
            payload.countryRisk.countryCode,

          country:
            payload.countryRisk.country,

          score:
            payload.countryRisk.score,

          level:
            payload.countryRisk.level,

          reasons:
            payload.countryRisk.reasons,

          policyVersion:
            payload.countryRisk.policyVersion,

          found:
            payload.countryRisk.found,
        }
      : null;


  // ----------------------------------------------------------
  // System prompt
  // ----------------------------------------------------------

  const systemPrompt = `
You are an explanation assistant for Lexo's automated
compliance verification system.

The deterministic compliance engine has already calculated:

- Risk score
- Risk tier
- Final decision

Your ONLY responsibility is to explain that existing result.

You MUST NOT:

- Change the decision
- Recalculate the risk score
- Assign another risk tier
- Make an independent risk decision
- Override the deterministic rule engine
- Invent facts
- Assume missing facts
- Treat nationality as evidence of criminal activity
- Treat country-level risk as a sanctions match
- Expose unnecessary personal information

The verification type is:

${verificationContext}

Possible decisions:

APPROVE
MANUAL_REVIEW
REJECT

Possible risk tiers:

LOW
MEDIUM
HIGH

Country risk is an additional deterministic signal.

A country being present in the country-risk dataset does NOT
mean that the person or wallet has committed wrongdoing.

Country risk must be described as one factor in the overall
assessment.

Country risk must NOT be described as:

- proof of criminal activity
- proof of sanctions
- proof of fraud
- proof that the applicant is dangerous
- an automatic reason for rejection

Person-level and wallet-level sanctions screening are separate
from country-level risk.

If the decision is MANUAL_REVIEW, explain that the available
signals require additional human review.

Do NOT claim that the applicant failed verification when the
decision is MANUAL_REVIEW.

For IDENTITY verification, focus on:

- age verification
- passport validity
- verification assurance
- country-level risk

For ADD_WALLET verification, focus on:

- sanctions
- PEP indicators
- fraud indicators
- wallet risk
- mixer exposure
- transaction risk
- AML score
- country-level risk

Only discuss signals that are actually supplied.

Return exactly 2-3 concise sentences.

Use neutral, factual language.
`;


  // ----------------------------------------------------------
  // User prompt
  // ----------------------------------------------------------

  const userPrompt = `
Verification Type:
${payload.type}

Verification Context:
${verificationContext}

Decision:
${payload.decision}

Risk Tier:
${payload.riskTier}

Risk Score:
${payload.riskScore}/100

Wallet:
${payload.wallet}

${
  payload.nationality
    ? `Nationality / Country Code: ${payload.nationality}\n`
    : ""
}

Country Risk:
${JSON.stringify(
  countryRiskContext,
  null,
  2
)}

Verification Signals:
${JSON.stringify(
  cleanSignals,
  null,
  2
)}

AML Screening Data:
${
  payload.type === "ADD_WALLET"
    ? JSON.stringify(
        payload.amlData ?? {},
        null,
        2
      )
    : "Not applicable to this verification."

}

Explain the existing deterministic
${verificationContext} decision.

Use ONLY the supplied information.

Do not change:

- the decision
- the risk score
- the risk tier

Do not independently calculate risk.

If the decision is MANUAL_REVIEW,
state that additional human review is required.

If country risk is present, describe it only as
one factor in the overall deterministic assessment.
`;


  // ==========================================================
  // OPENROUTER REQUEST
  // ==========================================================

  try {

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${apiKey}`,
        },

        body: JSON.stringify({

          model:
            process.env.OPENROUTER_MODEL ||
            "openrouter/free",

          max_tokens: 200,

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

        signal:
          AbortSignal.timeout(
            REQUEST_TIMEOUT_MS
          ),
      }
    );


    // ========================================================
    // OPENROUTER ERROR
    // ========================================================

    if (!response.ok) {

      const errorBody =
        await response
          .text()
          .catch(() => "");

      console.error(
        `[llmService] OpenRouter request failed ` +
        `[HTTP ${response.status}]:`,
        errorBody
      );

      return fallbackResponse;
    }


    // ========================================================
    // PARSE RESPONSE
    // ========================================================

    const data =
      (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };


    const explanation =
      data
        .choices?.[0]
        ?.message
        ?.content
        ?.trim();


    return (
      explanation ||
      fallbackResponse
    );

  } catch (error) {

    console.error(
      "[llmService] OpenRouter request failed:",
      error
    );

    return fallbackResponse;
  }
}
