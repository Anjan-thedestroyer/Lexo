//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IIdentityRegisterTest {
    function isVerified(address wallet) external view returns (bool);
    function getIdentity(bytes32 identityHash) external view returns (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory walletList);
}