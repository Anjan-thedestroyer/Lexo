
import { ethers } from "ethers";
import IdentityRegisterABI from "../abi/IdentityRegister.json" with { type: "json" };

import PassportModel from "../model/Passport.model.js";

const RPC_URL = process.env.RPC_URL;
const IDENTITY_REGISTER_ADDRESS =
    process.env.IDENTITY_REGISTER_ADDRESS;

// Use the actual name of your existing backend verifier key.
const PRIVATE_KEY =
    process.env.PRIVATE_KEY;

if (!RPC_URL || !IDENTITY_REGISTER_ADDRESS || !PRIVATE_KEY) {
    throw new Error("IdentityRegister environment configuration is missing");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

const verifierWallet = new ethers.Wallet(
    PRIVATE_KEY,
    provider
);

const contract = new ethers.Contract(
    IDENTITY_REGISTER_ADDRESS,
    IdentityRegisterABI.abi,
    provider
);

export async function getRegisterationHash(userId, walletAddress) {
    if (!userId || !walletAddress) {
        throw new Error("User ID and wallet address are required");
    }

    const passport = await PassportModel.findOne({
        user: userId,
    });

    if (!passport?.identityHash) {
        throw new Error("Passport identity hash not found");
    }

    const identityHash = passport.identityHash;

    if (!ethers.isHexString(identityHash, 32)) {
        throw new Error("Invalid identity hash");
    }

    if (!ethers.isAddress(walletAddress)) {
        throw new Error("Invalid wallet address");
    }

    const wallet = ethers.getAddress(walletAddress);

    // Read the authoritative current state.
    const [identity, linkedIdentityHash, nonce, network] =
        await Promise.all([
            contract.getIdentity(identityHash),
            contract.walletToIdentity(wallet),
            contract.nonces(wallet),
            provider.getNetwork(),
        ]);

    if (identity[0] || Number(identity[4]) === 1) {
        throw new Error("Identity is already registered on-chain");
    }

    if (identity[1]) {
        throw new Error("Identity is restricted on-chain");
    }

    if (linkedIdentityHash !== ethers.ZeroHash) {
        throw new Error("Wallet is already linked on-chain");
    }

    const deadline = BigInt(
        Math.floor(Date.now() / 1000) + 15 * 60
    );

    const domain = {
        name: "Lexo IdentityRegister",
        version: "1",
        chainId: network.chainId,
        verifyingContract: IDENTITY_REGISTER_ADDRESS,
    };

    const types = {
        RegisterIdentity: [
            { name: "wallet", type: "address" },
            { name: "identityHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
    };

    const value = {
        wallet,
        identityHash,
        nonce,
        deadline,
    };

    const signature = await verifierWallet.signTypedData(
        domain,
        types,
        value
    );

    return {
        wallet,
        identityHash,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature,
    };
}
