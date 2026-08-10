//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IArbitrationRegister} from "../interfaces/IArbitrationRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";
contract ArbitrationCourt {
    enum CaseStatus {
        Created,
        WaitingForResponse,
        EvidenceSubmission,
        Voting,
        Reveal,
        Decided,
        Executed,
        Cancelled
    }

    using SafeERC20 for IERC20;
    /// @notice Hardcoded  token instance
    IERC20 public immutable token;
    IArbitrationRegister public arbitrationRegister;
    IEscrowCore public escrowCore;
    IIdentityRegister public identityRegister;

    constructor(
        address _token,
        address _identityRegister,
        address _arbiterRegistry,
        address _escrowCore
    )  {
        if (_token == address(0) || _identityRegister == address(0) || _arbiterRegistry == address(0) || _escrowCore == address(0)) {
            revert InvalidAddress();
        }
        token = IERC20(_token);
        identityRegister = IIdentityRegister(_identityRegister);
        arbitrationRegister = IArbitrationRegister(_arbiterRegistry);
        escrowCore = IEscrowCore(_escrowCore);
    }

        error InvalidAddress();

    function createCase(uint256 dealId, string calldata reason) external returns(uint256 caseId){

    }
}