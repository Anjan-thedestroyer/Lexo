//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ArbitrationCourt is Ownable{
    address public arbitrationRegisterGuardian;
    using SafeERC20 for IERC20;
    IIdentityRegister public identityRegister;
    IERC20 public token;
    uint256 public MINIMUM_STAKE = 500 * 1e6 ;// 500$ worth of usdt
    address owner;

    error UserNotVerified();
    error Unauthorized();


    constructor(address _identityRegister, IERC20 _token) Ownable(msg.sender) {
        identityRegister = IIdentityRegister(_identityRegister);
        token = _token;
        owner = msg.sender;
    }
     modifier onlyVerified() {
        if (!identityRegister.isVerified(msg.sender)) revert UserNotVerified();
        _;
    }

    struct Arbitrator{
        uint256 stake;
        uint256 activeCase;
        uint256 reputation;
        bool active;
    }

    mapping (address => Arbitrator) public arbitrator;

    error NotEnoughStake();

    function addArbitrator(uint256 _stake ) onlyVerified  external {
        if(msg.sender == arbitrationRegisterGuardian || msg.sender == owner) revert Unauthorized();
        if(_stake < MINIMUM_STAKE ) revert NotEnoughStake();
        Arbitrator storage arb = arbitrator[msg.sender];
        arb.stake = _stake;
        arb.reputation = 100; //standard reputation 
        arb.active = true;
        token.safeTransferFrom( msg.sender, address(this), _stake);
    }

    


    
}