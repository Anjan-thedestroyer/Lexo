export type LLMVerificationType =
  | "IDENTITY"
  | "ADD_WALLET";

export interface LLMExplanationPayload {
  type: LLMVerificationType;

  wallet: string;
  riskScore: number;

  decision: "APPROVE" | "REJECT";

  signals: Record<string, any>;

  // AML data is mainly relevant for wallet addition,
  // but can also be provided during identity verification.
  amlData?: Record<string, any>;

  // Identity-related information
  nationality?: string;
}

const REQUEST_TIMEOUT_MS = 5000;


/**
 * Keeps only the signals that are relevant to the
 * deterministic rule engine.
 *
 * Supports both:
 *
 * 1. Identity verification
 * 2. Wallet addition
 */
function sanitizeSignals(
  signals: Record<string, any>,
  type: LLMVerificationType
): Record<string, any> {

  const identityKeys = [
    "ageAbove17",
    "passportExpired",
    "authLevel",
    "isHighRiskJurisdiction",
  ];

  const walletKeys = [
    "sanctions",
    "pep",
    "fraud",
    "walletRisk",
    "mixerExposure",
    "highRiskWallet",
    "transactionRisk",
    "isHighRiskJurisdiction",
  ];

  const allowedKeys =
    type === "IDENTITY"
      ? identityKeys
      : walletKeys;

  return Object.keys(signals)
    .filter((key) =>
      allowedKeys.includes(key)
    )
    .reduce((obj, key) => {
      obj[key] = signals[key];
      return obj;
    }, {} as Record<string, any>);
}


/**
 * Generates an explanation for either:
 *
 * - Initial identity verification
 * - Adding a new wallet to an existing identity
 *
 * The deterministic rule engine has already made
 * the decision. The LLM ONLY explains it.
 */
export async function fetchLLMExplanation(
  payload: LLMExplanationPayload
): Promise<string> {

  const apiKey =
    process.env.OPENROUTER_API_KEY;

  const fallbackResponse =
    payload.type === "ADD_WALLET"
      ? `Wallet verification completed with a risk score of ` +
        `${payload.riskScore}/100. Decision: ${payload.decision}.`
      : `Identity verification completed with a risk score of ` +
        `${payload.riskScore}/100. Decision: ${payload.decision}.`;

  if (!apiKey) {
    return fallbackResponse;
  }

  const cleanSignals =
    sanitizeSignals(
      payload.signals,
      payload.type
    );


  // --------------------------------------------------
  // Different explanation context
  // --------------------------------------------------

  const verificationContext =
    payload.type === "ADD_WALLET"
      ? "wallet addition and AML verification"
      : "identity and passport verification";


  // --------------------------------------------------
  // System prompt
  // --------------------------------------------------

  const systemPrompt =
    "You explain automated verification decisions. " +

    "The deterministic rule engine has already calculated " +
    "the risk score and decision. " +

    "You MUST NOT change the decision, recalculate the score, " +
    "or make an independent risk decision. " +

    `The current verification concerns ${verificationContext}. ` +

    "Use the provided verification signals and relevant AML " +
    "findings to explain why the existing decision was reached. " +

    "Do not request or expose personal data. " +

    "Do not invent facts that are not present in the provided data. " +

    "Provide a concise, neutral explanation in 2-3 sentences.";


  // --------------------------------------------------
  // User prompt
  // --------------------------------------------------

  const userPrompt = `
Verification Type: ${payload.type}

Decision: ${payload.decision}

Risk Score: ${payload.riskScore}/100

Wallet: ${payload.wallet}

${
  payload.nationality
    ? `Nationality: ${payload.nationality}\n`
    : ""
}

Verification Signals:
${JSON.stringify(cleanSignals, null, 2)}

AML Screening Data:
${JSON.stringify(
  payload.amlData ?? {},
  null,
  2
)}

Explain the existing ${verificationContext} decision.

Use only the provided information.

Do not change the decision.
Do not change the risk score.
Do not make an independent risk decision.
`;


  // --------------------------------------------------
  // OpenRouter
  // --------------------------------------------------

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


    // ------------------------------------------------
    // OpenRouter error
    // ------------------------------------------------

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


    // ------------------------------------------------
    // Parse response
    // ------------------------------------------------

    const data =
      (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };


    return (
      data
        .choices?.[0]
        ?.message
        ?.content
        ?.trim() ||
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
