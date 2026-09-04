import { useState } from "react";
import { CustomProofParamsBuilder } from "@rarimo/zk-passport";
import ZkPassportQrCode from "@rarimo/zk-passport-react";

const apiUrl = "https://api.app.rarime.com";
const requestId = "test-account-1";

/*
  Rarimo selector bits:

  bit 0 = nullifier
  bit 1 = birth date
  bit 2 = expiration date
  bit 3 = name
  bit 4 = nationality
  bit 5 = citizenship
  bit 6 = sex
  bit 7 = document number

  We want:

  bit 0 -> nullifier
  bit 1 -> birth date
  bit 2 -> expiration date
  bit 4 -> nationality
  bit 5 -> citizenship

  1 + 2 + 4 + 16 + 32 = 55
*/

const proofParams = new CustomProofParamsBuilder()
  .withSelector("55")
  .withEventId("1337")
  .build();

/*
  Rarimo represents passport strings as field elements.

  Example:

  "NPL"

  ASCII:
  N = 0x4e
  P = 0x50
  L = 0x4c

  0x4e504c = 5132364

  So:

  5132364 -> NPL
*/
function decodeField(value: string | number): string {
  try {
    const hex = BigInt(value).toString(16);

    // Make sure we have complete bytes.
    const paddedHex =
      hex.length % 2 === 0 ? hex : `0${hex}`;

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
  } catch (error) {
    console.error("Failed to decode field:", value, error);

    return String(value);
  }
}

/*
  Passport dates are encoded as YYMMDD.

  Example:

  080101

  means:

  01 January 2008

  We initially keep the raw YYMMDD representation
  instead of making assumptions about the century.
*/
function decodePassportDate(
  value: string | number
): string {
  return decodeField(value);
}

/*
  Extract the useful values from pubSignals.

  TD3 passport layout:

  pubSignals[0]  = nullifier
  pubSignals[1]  = birthDate
  pubSignals[2]  = expirationDate
  pubSignals[3]  = name
  pubSignals[4]  = nameResidual
  pubSignals[5]  = nationality
  pubSignals[6]  = citizenship
  pubSignals[7]  = sex
  pubSignals[8]  = documentNumber
  pubSignals[9]  = eventID
  pubSignals[10] = eventData
  pubSignals[11] = idStateRoot
  pubSignals[12] = selector
  pubSignals[13] = currentDate
*/
function decodeProof(proof: any) {
  if (!proof || !proof.pubSignals) {
    console.error("No pubSignals found in proof");

    return null;
  }

  const signals = proof.pubSignals;

  console.log("======================================");
  console.log("          RAW PUB SIGNALS");
  console.log("======================================");

  console.dir(signals, {
    depth: null,
  });

  console.log("======================================");
  console.log("        DECODED PASSPORT DATA");
  console.log("======================================");

  const decoded = {
    nullifier: signals[0],

    birthDateRaw: signals[1],
    birthDate: decodePassportDate(signals[1]),

    expirationDateRaw: signals[2],
    expirationDate: decodePassportDate(signals[2]),

    nationalityRaw: signals[5],
    nationality: decodeField(signals[5]),

    citizenshipRaw: signals[6],
    citizenship: decodeField(signals[6]),

    eventId: signals[9],

    selector: signals[12],

    currentDate: signals[13],
  };

  console.log("Nullifier:");
  console.log(decoded.nullifier);

  console.log("--------------------------------------");

  console.log("Birth Date:");
  console.log(decoded.birthDate);

  console.log("Birth Date Raw:");
  console.log(decoded.birthDateRaw);

  console.log("--------------------------------------");

  console.log("Expiration Date:");
  console.log(decoded.expirationDate);

  console.log("Expiration Date Raw:");
  console.log(decoded.expirationDateRaw);

  console.log("--------------------------------------");

  console.log("Nationality:");
  console.log(decoded.nationality);

  console.log("Nationality Raw:");
  console.log(decoded.nationalityRaw);

  console.log("--------------------------------------");

  console.log("Citizenship:");
  console.log(decoded.citizenship);

  console.log("Citizenship Raw:");
  console.log(decoded.citizenshipRaw);

  console.log("--------------------------------------");

  console.log("Event ID:");
  console.log(decoded.eventId);

  console.log("--------------------------------------");

  console.log("Selector:");
  console.log(decoded.selector);

  console.log("--------------------------------------");

  console.log("Current Date:");
  console.log(decoded.currentDate);

  console.log("======================================");

  return decoded;
}

function App() {
  const [status, setStatus] = useState<string>(
    "waiting"
  );

  const [decodedData, setDecodedData] =
    useState<any>(null);

  const [rawProof, setRawProof] =
    useState<any>(null);

  /*
    Fetch verification status from Rarimo.

    This is useful because the QR/proof flow and
    verification status are separate pieces of data.
  */
  const fetchVerificationStatus = async () => {
    try {
      console.log(
        "Checking Rarimo verification status..."
      );

      const response = await fetch(
        `${apiUrl}/integrations/verificator-svc/private/verification-status/${requestId}`
      );

      const result = await response.json();

      console.log(
        "===== VERIFICATION STATUS ====="
      );

      console.dir(result, {
        depth: null,
      });

      return result;
    } catch (error) {
      console.error(
        "Failed to fetch verification status:",
        error
      );
    }
  };

  /*
    Fetch verified data.

    Note:

    Rarimo's verified-data endpoint is intended
    for backend usage. Your browser may receive
    a 405/authorization response.

    That's okay for this frontend-only experiment.

    In Lexo, this request should eventually happen
    from your backend.
  */
  const fetchVerifiedData = async () => {
    try {
      console.log(
        "Fetching Rarimo verified data..."
      );

      const response = await fetch(
        `${apiUrl}/integrations/verificator-svc/private/user/${requestId}`
      );

      const result = await response.json();

      console.log(
        "===== RARIMO VERIFIED DATA ====="
      );

      console.dir(result, {
        depth: null,
      });

      return result;
    } catch (error) {
      console.error(
        "Failed to fetch verified data:",
        error
      );
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        <h1>Lexo × Rarimo ZK Passport Test</h1>

        <p>
          Scan the QR code using the Rarimo App,
          then complete passport verification.
        </p>

        <div
          style={{
            marginBottom: "30px",
            padding: "15px",
            border: "1px solid #ccc",
            borderRadius: "8px",
          }}
        >
          <strong>Status:</strong>{" "}
          {status}
        </div>

        {/* RARIMO QR CODE */}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "30px",
          }}
        >
          <ZkPassportQrCode
            apiUrl={apiUrl}
            requestId={requestId}
            verificationOptions={proofParams}
            qrProps={{
              size: 300,
            }}
            onStatusChange={(newStatus) => {
              console.log(
                "STATUS:",
                newStatus
              );

              setStatus(newStatus);

              if (
                newStatus === "verified"
              ) {
                fetchVerificationStatus();
              }
            }}
            onSuccess={(result) => {
              console.log(
                "======================================"
              );

              console.log(
                "        ZK PROOF SUCCESS"
              );

              console.log(
                "======================================"
              );

              console.dir(result, {
                depth: null,
              });

              setRawProof(result);

              const decoded =
                decodeProof(result);

              setDecodedData(decoded);
            }}
            onError={(error: any) => {
              console.log(
                "======================================"
              );

              console.log(
                "          RARIMO ERROR"
              );

              console.log(
                "======================================"
              );

              console.log(
                "Name:",
                error?.name
              );

              console.log(
                "Message:",
                error?.message
              );

              console.log(
                "HTTP Status:",
                error?.httpStatus
              );

              console.log(
                "Meta:",
                error?.meta
              );

              console.log(
                "Nested Errors:",
                error?.nestedErrors
              );

              console.dir(error, {
                depth: null,
                showHidden: true,
              });
            }}
          />
        </div>

        {/* BUTTONS */}

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "30px",
          }}
        >
          <button
            onClick={fetchVerificationStatus}
          >
            Check Verification Status
          </button>

          <button
            onClick={fetchVerifiedData}
          >
            Get Verified Data
          </button>
        </div>

        {/* DECODED DATA */}

        {decodedData && (
          <div
            style={{
              marginBottom: "30px",
              padding: "20px",
              border: "1px solid #ccc",
              borderRadius: "10px",
            }}
          >
            <h2>
              Decoded Passport Data
            </h2>

            <div
              style={{
                display: "grid",
                gap: "15px",
              }}
            >
              <div>
                <strong>
                  Citizenship:
                </strong>

                <div>
                  {decodedData.citizenship}
                </div>
              </div>

              <div>
                <strong>
                  Nationality:
                </strong>

                <div>
                  {decodedData.nationality}
                </div>
              </div>

              <div>
                <strong>
                  Birth Date:
                </strong>

                <div>
                  {decodedData.birthDate}
                </div>
              </div>

              <div>
                <strong>
                  Expiration Date:
                </strong>

                <div>
                  {
                    decodedData.expirationDate
                  }
                </div>
              </div>

              <div>
                <strong>
                  Selector:
                </strong>

                <div>
                  {decodedData.selector}
                </div>
              </div>
            </div>

            <h3>
              Raw Values
            </h3>

            <pre
              style={{
                overflowX: "auto",
              }}
            >
              {JSON.stringify(
                decodedData,
                null,
                2
              )}
            </pre>
          </div>
        )}

        {/* RAW PROOF */}

        {rawProof && (
          <div
            style={{
              padding: "20px",
              border: "1px solid #ccc",
              borderRadius: "10px",
            }}
          >
            <h2>
              Raw ZK Proof
            </h2>

            <pre
              style={{
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "12px",
              }}
            >
              {JSON.stringify(
                rawProof,
                null,
                2
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;