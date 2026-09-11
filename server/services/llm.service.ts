export interface LLMExplanationPayload {
  wallet: string;
  riskScore: number;
  decision: "APPROVE" | "REJECT";
  signals: Record<string, any>;
  amlData?: Record<string, any>;
}

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Keeps only the rule-engine signals.
 * Raw AML data is passed separately so the AI can interpret it.
 */
function sanitizeSignals(
  signals: Record<string, any>
): Record<string, any> {
  const allowedKeys = [
    "ageAbove17",
    "passportExpired",
    "authLevel",
    "isHighRiskJurisdiction",
  ];

  return Object.keys(signals)
    .filter((key) => allowedKeys.includes(key))
    .reduce((obj, key) => {
      obj[key] = signals[key];
      return obj;
    }, {} as Record<string, any>);
}

export async function fetchLLMExplanation(
  payload: LLMExplanationPayload
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  const fallbackResponse =
    `Automated verification completed with a risk score of ` +
    `${payload.riskScore}/100. Decision: ${payload.decision}.`;

  if (!apiKey) {
    return fallbackResponse;
  }

  const cleanSignals = sanitizeSignals(payload.signals);

  const systemPrompt =
    "You explain automated identity and wallet verification decisions. " +
    "The deterministic rule engine has already calculated the risk score and decision. " +
    "You MUST NOT change the decision, recalculate the score, or make an independent risk decision. " +
    "Use the AML screening data to interpret relevant wallet risk indicators and explain why " +
    "the existing decision was reached. " +
    "Do not request or expose personal data. " +
    "Provide a concise, neutral explanation in 2-3 sentences.";

  const userPrompt = `Decision: ${payload.decision}
Risk Score: ${payload.riskScore}/100
Wallet: ${payload.wallet}

Verification Signals:
${JSON.stringify(cleanSignals, null, 2)}

AML Screening Data:
${JSON.stringify(payload.amlData ?? {}, null, 2)}

Explain the existing decision using the verification signals and relevant AML findings.
Do not change the decision or score.`;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openrouter/free",
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");

      console.error(
        `[llmService] OpenRouter request failed [HTTP ${response.status}]:`,
        errorBody
      );

      return fallbackResponse;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return (
      data.choices?.[0]?.message?.content?.trim() ||
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