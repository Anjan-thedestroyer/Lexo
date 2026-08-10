// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CoreAgreement is Ownable {

    struct AgreementVersion {
        bytes32 documentHash;
        uint256 publishedAt;
        bool active;
    }

    struct UserAgreement {
        uint256 signedAt;
    }

    uint256 public currentVersion;

    mapping(uint256 => AgreementVersion) public agreements;
    // user => version => agreement
    mapping(address => mapping(uint256 => UserAgreement)) public userAgreements;

    event AgreementPublished(uint256 indexed version, bytes32 indexed documentHash);
    event AgreementStatusChanged(uint256 indexed version, bool active);
    event AgreementSigned(address indexed user, uint256 indexed version, uint256 signedAt);

    error UserNotVerified();
    error AgreementNotActive();
    error AlreadySigned();
    error InvalidAddress();
    error AgreementDoesNotExist();

    constructor() Ownable(msg.sender) {
    }


    function publishAgreement(bytes32 _documentHash) external onlyOwner {
        // Deactivate previous version if one exists
        if (currentVersion > 0) {
            agreements[currentVersion].active = false;
        }

        currentVersion++;

        agreements[currentVersion] = AgreementVersion({
            documentHash: _documentHash,
            publishedAt: block.timestamp,
            active: true
        });

        emit AgreementPublished(currentVersion, _documentHash);
    }

    function setAgreementStatus(uint256 _version, bool _active) external onlyOwner {
        if (_version == 0 || _version > currentVersion) revert AgreementDoesNotExist();
        agreements[_version].active = _active;
        emit AgreementStatusChanged(_version, _active);
    }

    function signAgreement() external  {
        if (!agreements[currentVersion].active) revert AgreementNotActive();
        if (userAgreements[msg.sender][currentVersion].signedAt > 0) revert AlreadySigned();

        userAgreements[msg.sender][currentVersion] = UserAgreement({
            signedAt: block.timestamp
        });

        emit AgreementSigned(msg.sender, currentVersion, block.timestamp);
    }

    function hasSignedCurrentAgreement(address _user) external view returns (bool) {
        return userAgreements[_user][currentVersion].signedAt > 0;
    }

    function getAgreement(uint256 _version)
        external
        view
        returns (
            uint256 version,
            bytes32 documentHash,
            uint256 publishedAt,
            bool active
        )
    {
        AgreementVersion memory agreement = agreements[_version];
        return (_version, agreement.documentHash, agreement.publishedAt, agreement.active);
    }
}