//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICoreAgreement {
    function publishAgreement(bytes32 _documentHash) external;
    function setAgreementStatus(uint256 _version, bool _active) external;
    function signAgreement() external;
    function hasSignedCurrentAgreement(address _user) external view returns (bool);
    function getAgreement(uint256 _version) external view returns (bytes32 documentHash, uint256 publishedAt, bool active);
}