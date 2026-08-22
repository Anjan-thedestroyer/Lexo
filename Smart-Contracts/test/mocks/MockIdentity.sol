// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IIdentityRegister} from "../../src/interfaces/IIdentityRegister.sol";

contract MockIdentityRegister is IIdentityRegister {
    mapping(address => bool) public verifiedUsers;
    mapping(address => bool) public restrictedUsers;
    mapping(address => bytes32) public mockIdentities;
    mapping(bytes32 => address[]) public identityWallets;

    /* ========================================================================= */
    /*                              MOCK HELPERS                                 */
    /* ========================================================================= */

    /// @notice Set whether a wallet is verified or not
    function setVerified(address user, bool verified) external {
        verifiedUsers[user] = verified;
        if (verified && mockIdentities[user] == bytes32(0)) {
            bytes32 idHash = keccak256(abi.encodePacked("MOCK_IDENTITY_", user));
            mockIdentities[user] = idHash;
            identityWallets[idHash].push(user);
        }
    }

    /// @notice Bind a specific identity hash to a wallet (useful for wallet changes)
    function setCustomIdentity(address user, bytes32 identityHash) external {
        mockIdentities[user] = identityHash;
        verifiedUsers[user] = true;
        identityWallets[identityHash].push(user);
    }

    /// @notice Set restriction status (e.g. blacklisted/sanctioned)
    function setRestricted(address user, bool isRestricted) external {
        restrictedUsers[user] = isRestricted;
    }

    /* ========================================================================= */
    /*                         INTERFACE IMPLEMENTATION                          */
    /* ========================================================================= */

    function isVerified(address wallet) external view override returns (bool) {
        return verifiedUsers[wallet];
    }

    function getIdentityHashByWallet(address wallet) external view override returns (bytes32) {
        return mockIdentities[wallet];
    }

    function walletToIdentity(address wallet) external view override returns (bytes32) {
        return mockIdentities[wallet];
    }

    function restricted(bytes32 identityHash) external pure override returns (bool) {
        return false;
    }

    function getIdentity(bytes32 identityHash)
        external
        view
        override
        returns (
            bool isVerifiedStatus,
            bool isRestrictedStatus,
            address root,
            address[] memory walletList
        )
    {
        address[] memory wallets = identityWallets[identityHash];
        address rootWallet = wallets.length > 0 ? wallets[0] : address(0);
        return (true, false, rootWallet, wallets);
    }

    function getWallets(bytes32 identityHash) external view override returns (address[] memory) {
        return identityWallets[identityHash];
    }

    function walletCount(bytes32 identityHash) external view override returns (uint256) {
        return identityWallets[identityHash].length;
    }

    function verifier() external pure override returns (address) {
        return address(0);
    }

    function coreAgreement() external pure override returns (address) {
        return address(0);
    }

    function MAX_WALLET() external pure override returns (uint256) {
        return 5;
    }

    function nonces(address) external pure override returns (uint256) {
        return 0;
    }

    function getAttestationDigest(address, bytes32, uint256, uint256) external pure override returns (bytes32) {
        return bytes32(0);
    }

    /* ========================================================================= */
    /*                                 NO-OPS                                    */
    /* ========================================================================= */

    function addVerifier(address) external override {}
    function registerWithAttestation(bytes32, uint256, bytes calldata) external override {}
    function unverify(bytes32) external override {}
    function restrict(bytes32) external override {}
    function unrestrict(bytes32) external override {}
    function removeWallet(bytes32, address) external override {}
    function changeRootWallet(bytes32, address) external override {}
}