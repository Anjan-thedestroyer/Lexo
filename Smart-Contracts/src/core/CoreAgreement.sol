// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;


contract CoreAgreement {

    bytes32 public immutable agreementHash;
    uint256 public immutable publishedAt;

    mapping(address => uint256) public signedAt;

    event AgreementSigned(
        address indexed user,
        uint256 indexed timestamp
    );

    error UserNotVerified();
    error AlreadySigned();
    error InvalidAddress();
    error InvalidAgreementHash();

    constructor(
        bytes32 _agreementHash
    ){
        if (_agreementHash == bytes32(0)) {
            revert InvalidAgreementHash();
        }

        agreementHash = _agreementHash;
        publishedAt = block.timestamp;
    }

    function signAgreement() external  {
        if (signedAt[msg.sender] != 0) {
            revert AlreadySigned();
        }

        signedAt[msg.sender] = block.timestamp;

        emit AgreementSigned(
            msg.sender,
            block.timestamp
        );
    }

    function hasSignedAgreement(
        address _user
    ) external view returns (bool) {
        return signedAt[_user] != 0;
    }
}