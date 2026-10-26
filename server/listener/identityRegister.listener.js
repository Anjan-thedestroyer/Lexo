
import { ethers } from "ethers";

import UserModel from "../model/User.model.js";
import WalletModel from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import PassportModel from "../model/Passport.model.js";

import IdentityRegisterABI from "../abi/IdentityRegister.json"
    with { type: "json" };


// ============================================================
// CONFIG
// ============================================================

const RPC_URL = process.env.RPC_URL;
const IDENTITY_REGISTER_ADDRESS =
    process.env.IDENTITY_REGISTER_ADDRESS;

if (!RPC_URL) {
    throw new Error("RPC_URL is not configured");
}

if (!IDENTITY_REGISTER_ADDRESS) {
    throw new Error("IDENTITY_REGISTER_ADDRESS is not configured");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

const identityRegister = new ethers.Contract(
    IDENTITY_REGISTER_ADDRESS,
    IdentityRegisterABI.abi,
    provider
);


// ============================================================
// HELPERS
// ============================================================

function getEventId(event) {
    if (!event) return null;

    return `${event.log.transactionHash}-${event.log.index}`;
}

async function findVerification(identityHash) {
    return Verification.findOne({
        nullifier: identityHash,
    }).sort({
        createdAt: -1,
    });
}

/**
 * Finds or creates one wallet safely.
 *
 * Both IdentityRegistered and WalletLinked can fire for
 * the same root wallet. MongoDB's unique address index
 * remains the final protection against duplicate documents.
 */
async function findOrCreateWallet(address, userId) {
    const normalizedAddress = address.toLowerCase();

    let wallet = await WalletModel.findOne({
        address: normalizedAddress,
    });

    if (!wallet) {
        try {
            wallet = await WalletModel.create({
                address: normalizedAddress,
                user: userId,
                status: "Active",
                linkedAt: new Date(),
            });

            console.log(
                `Wallet created: ${normalizedAddress}`
            );
        } catch (error) {
            // Another event handler may have created it first.
            if (error.code !== 11000) {
                throw error;
            }

            wallet = await WalletModel.findOne({
                address: normalizedAddress,
            });

            // If the wallet still cannot be found, preserve
            // the original error instead of hiding it.
            if (!wallet) {
                throw error;
            }
        }
    }

    // Never silently attach another user's wallet.
    if (
        !wallet.user ||
        wallet.user.toString() !== userId.toString()
    ) {
        throw new Error(
            `Wallet ownership mismatch for ${normalizedAddress}`
        );
    }

    return wallet;
}


// ============================================================
// 1. IDENTITY REGISTERED
// ============================================================

async function handleIdentityRegistered(
    identityHash,
    rootWallet,
    event
) {
    const eventId = getEventId(event);
    const normalizedWallet = rootWallet.toLowerCase();

    console.log(
        `IdentityRegistered: ${identityHash} -> ${normalizedWallet}`
    );

    const verification = await findVerification(identityHash);

    if (!verification) {
        console.error(
            `No verification found for identity ${identityHash}`
        );
        return;
    }

    const user = await UserModel.findById(verification.user);

    if (!user) {
        console.error(
            `User not found for verification ${verification._id}`
        );
        return;
    }

    // Race-safe: WalletLinked may be processing this address too.
    const wallet = await findOrCreateWallet(
        normalizedWallet,
        user._id
    );

    const alreadyInUser = user.wallets?.some(
        (walletId) =>
            walletId.toString() === wallet._id.toString()
    );

    if (!alreadyInUser) {
        user.wallets.push(wallet._id);
    }

    user.rootWallet = wallet._id;
    user.identityVerification = "VERIFIED";
    user.eventId = eventId;

    await user.save();

    if (user.passport) {
        await PassportModel.findByIdAndUpdate(
            user.passport,
            { status: "Approved" }
        );
    }

    await Verification.findByIdAndUpdate(
        verification._id,
        {
            eventId,
            attestationTxHash: event.log.transactionHash,
        }
    );

    console.log(
        `Identity ${identityHash} synchronized successfully`
    );
}


// ============================================================
// 2. WALLET LINKED
// ============================================================

async function handleWalletLinked(
    identityHash,
    walletAddress,
    isRoot,
    event
) {
    const eventId = getEventId(event);
    const normalizedWallet = walletAddress.toLowerCase();

    console.log(
        `WalletLinked: ${normalizedWallet} -> ${identityHash}`
    );

    const verification = await findVerification(identityHash);

    if (!verification) {
        console.error(
            `No verification found for identity ${identityHash}`
        );
        return;
    }

    const user = await UserModel.findById(verification.user);

    if (!user) {
        console.error(
            `User not found for identity ${identityHash}`
        );
        return;
    }

    // Uses the same helper as IdentityRegistered.
    const wallet = await findOrCreateWallet(
        normalizedWallet,
        user._id
    );

    // Restore a previously removed wallet when the contract
    // successfully emits WalletLinked for it again.
    if (wallet.status !== "Active") {
        wallet.status = "Active";
        wallet.removedAt = null;
        wallet.linkedAt = new Date();

        await wallet.save();
    }

    const alreadyLinked = user.wallets?.some(
        (walletId) =>
            walletId.toString() === wallet._id.toString()
    );

    if (!alreadyLinked) {
        user.wallets.push(wallet._id);
    }

    if (isRoot) {
        user.rootWallet = wallet._id;
    }

    user.eventId = eventId;

    await user.save();

    console.log(
        `Wallet ${normalizedWallet} synchronized`
    );
}


// ============================================================
// 3. WALLET REMOVED
// ============================================================

async function handleWalletRemoved(
    identityHash,
    walletAddress,
    event
) {
    const eventId = getEventId(event);
    const normalizedWallet = walletAddress.toLowerCase();

    console.log(`WalletRemoved: ${normalizedWallet}`);

    const wallet = await WalletModel.findOne({
        address: normalizedWallet,
    });

    if (!wallet) {
        console.log(
            `Wallet ${normalizedWallet} does not exist in MongoDB`
        );
        return;
    }

    wallet.status = "Removed";
    wallet.removedAt = new Date();

    await wallet.save();

    const user = await UserModel.findById(wallet.user);

    if (!user) {
        console.error(
            `User not found for wallet ${normalizedWallet}`
        );
        return;
    }

    user.wallets = (user.wallets || []).filter(
        (walletId) =>
            walletId.toString() !== wallet._id.toString()
    );

    // Do not leave a removed wallet as the user's root wallet.
    if (
        user.rootWallet &&
        user.rootWallet.toString() === wallet._id.toString()
    ) {
        user.rootWallet = null;
    }

    user.eventId = eventId;

    await user.save();

    console.log(
        `Wallet ${normalizedWallet} marked as removed`
    );
}


// ============================================================
// 4. UNVERIFIED
// ============================================================

async function handleUnverified(identityHash, event) {
    const eventId = getEventId(event);

    console.log(`Unverified: ${identityHash}`);

    const verification = await findVerification(identityHash);

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );
        return;
    }

    const user = await UserModel.findById(verification.user);

    if (user) {
        user.identityVerification = "NOT_VERIFIED";
        user.eventId = eventId;
        await user.save();
    }

    await Verification.findByIdAndUpdate(
        verification._id,
        {
            status: "REJECTED",
            shouldIssueAttestation: false,
            eventId,
        }
    );

    if (verification.passport) {
        await PassportModel.findByIdAndUpdate(
            verification.passport,
            { status: "Rejected" }
        );
    }

    const wallets = await WalletModel.find({
        user: verification.user,
    });

    for (const wallet of wallets) {
        wallet.status = "Removed";
        wallet.removedAt = new Date();
        await wallet.save();
    }

    if (user) {
        user.wallets = [];
        user.rootWallet = null;
        await user.save();
    }

    console.log(
        `Identity ${identityHash} marked unverified`
    );
}


// ============================================================
// 5. IDENTITY RESTRICTED
// ============================================================

async function handleIdentityRestricted(
    identityHash,
    isRestricted,
    event
) {
    const eventId = getEventId(event);

    console.log(
        `IdentityRestricted: ${identityHash} = ${isRestricted}`
    );

    const verification = await findVerification(identityHash);

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );
        return;
    }

    // Restriction is not the same as rejection.
    // Preserve the existing verification status behavior.
    await Verification.findByIdAndUpdate(
        verification._id,
        { eventId }
    );

    console.log(
        `Restriction state synchronized for ${identityHash}`
    );
}


// ============================================================
// 6. ROOT WALLET CHANGED
// ============================================================

async function handleRootWalletChanged(
    identityHash,
    newRootWallet,
    event
) {
    const eventId = getEventId(event);
    const normalizedWallet = newRootWallet.toLowerCase();

    console.log(
        `RootWalletChanged: ${identityHash} -> ${normalizedWallet}`
    );

    const verification = await findVerification(identityHash);

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );
        return;
    }

    const user = await UserModel.findById(verification.user);

    if (!user) {
        console.error(
            `User not found for ${identityHash}`
        );
        return;
    }

    const wallet = await WalletModel.findOne({
        address: normalizedWallet,
    });

    if (!wallet) {
        console.error(
            `New root wallet ${normalizedWallet} not found in MongoDB`
        );
        return;
    }

    // Make sure this wallet belongs to the identity's user.
    if (
        !wallet.user ||
        wallet.user.toString() !== user._id.toString()
    ) {
        console.error(
            `Wallet ownership mismatch for ${normalizedWallet}`
        );
        return;
    }

    user.rootWallet = wallet._id;
    user.eventId = eventId;

    await user.save();

    console.log(
        `Root wallet updated to ${normalizedWallet}`
    );
}


// ============================================================
// 7. VERIFIER CHANGED
// ============================================================

async function handleVerifierChanged(newVerifier, event) {
    console.log(`VerifierChanged: ${newVerifier}`);

    console.log(
        `Transaction: ${event.log.transactionHash}`
    );

    // No MongoDB user-data update is required.
}


// ============================================================
// EVENT LISTENERS
// ============================================================

export function startIdentityRegisterListener() {
    console.log("Starting IdentityRegister listeners...");

    identityRegister.on(
        "IdentityRegistered",
        async (identityHash, rootWallet, event) => {
            try {
                await handleIdentityRegistered(
                    identityHash,
                    rootWallet,
                    event
                );
            } catch (error) {
                console.error(
                    "IdentityRegistered listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "WalletLinked",
        async (identityHash, wallet, isRoot, event) => {
            try {
                await handleWalletLinked(
                    identityHash,
                    wallet,
                    isRoot,
                    event
                );
            } catch (error) {
                console.error(
                    "WalletLinked listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "WalletRemoved",
        async (identityHash, wallet, event) => {
            try {
                await handleWalletRemoved(
                    identityHash,
                    wallet,
                    event
                );
            } catch (error) {
                console.error(
                    "WalletRemoved listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "Unverified",
        async (identityHash, event) => {
            try {
                await handleUnverified(
                    identityHash,
                    event
                );
            } catch (error) {
                console.error(
                    "Unverified listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "IdentityRestricted",
        async (identityHash, isRestricted, event) => {
            try {
                await handleIdentityRestricted(
                    identityHash,
                    isRestricted,
                    event
                );
            } catch (error) {
                console.error(
                    "IdentityRestricted listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "RootWalletChanged",
        async (identityHash, newRootWallet, event) => {
            try {
                await handleRootWalletChanged(
                    identityHash,
                    newRootWallet,
                    event
                );
            } catch (error) {
                console.error(
                    "RootWalletChanged listener error:",
                    error
                );
            }
        }
    );

    identityRegister.on(
        "VerifierChanged",
        async (newVerifier, event) => {
            try {
                await handleVerifierChanged(
                    newVerifier,
                    event
                );
            } catch (error) {
                console.error(
                    "VerifierChanged listener error:",
                    error
                );
            }
        }
    );

    console.log(
        "IdentityRegister listeners started successfully"
    );
}
