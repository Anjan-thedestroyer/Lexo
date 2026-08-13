//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICoreAgreement {
    function signAgreement() external;
    function hasSignedAgreement(address _user) external view returns (bool);
    function getAgreement(uint256 _version) external view returns (bytes32 documentHash);
}