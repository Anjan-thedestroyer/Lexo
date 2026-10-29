import { createPublicClient, http, isAddress } from "viem";
import { sepolia } from "viem/chains";
import EscrowCoreJSON from "@/abi/EscrowCore.json";
import IdentityRegisterJSON from "@/abi/IdentityRegister.json";

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
});

const ESCROW_ADDRESS =
  "0x4f330Dd6fFFEF2830bd82467dc35A641e5316C77" as const;

const IDENTITY_REGISTER_ADDRESS =
  "0x7c827d0293b7ed891ed589542d1d11450590812d" as const;

const wallet = "0xe8bbb255573f65112abbfc01ecc35dc36713a13b" as const;

async function main() {
  console.log("Chain ID:", await client.getChainId());

  const configuredIdentity = await client.readContract({
    address: ESCROW_ADDRESS,
    abi: EscrowCoreJSON.abi,
    functionName: "identityRegister",
  });

  console.log("IdentityRegister configured in EscrowCore:", configuredIdentity);
  console.log(
    "Matches expected address:",
    String(configuredIdentity).toLowerCase() ===
      IDENTITY_REGISTER_ADDRESS.toLowerCase()
  );

  const verified = await client.readContract({
    address: IDENTITY_REGISTER_ADDRESS,
    abi: IdentityRegisterJSON.abi,
    functionName: "isVerified",
    args: [wallet],
  });

  console.log("Wallet verified:", verified);
}

main().catch(console.error);