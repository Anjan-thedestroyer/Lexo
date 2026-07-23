//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
//@title IIdentityRegister
//@dev This interface defines the functions for the Identity Register contract
interface IIdentityRegister {
    function isVerified(address wallet) external view returns (bool);
    function getIdentity(bytes32 identityHash) external view returns (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory walletList);
    function getIdentityHashByWallet(address wallet) external view returns (bytes32 identityHash);
    
}