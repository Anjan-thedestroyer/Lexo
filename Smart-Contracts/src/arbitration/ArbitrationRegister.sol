// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

contract ArbitratorRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IIdentityRegister public immutable identityRegister;
    address public arbitrationCourt;

    uint256 public constant MINIMUM_STAKE = 500 * 1e6; // 500 USDT
    uint256 public constant UNSTAKE_COOL_DOWN = 7 days;
    uint256 public constant MAX_ACTIVE_CASES = 3;

    struct Arbitrator {
        address wallet;             
        uint256 stake;
        uint256 activeCases;
        uint256 reputation;
        uint256 unstakeRequestedAt;
        bool active;
        bool suspended;
    }

    // identityHash => Arbitrator details
    mapping(bytes32 => Arbitrator) public arbitrators;
    
    // wallet => identityHash lookup for fast access
    mapping(address => bytes32) public arbitratorToIdentity;

    address[] public arbitratorList;
    mapping(address => uint256) private arbitratorIndex;

    // --- Custom Errors ---
    error Unauthorized();
    error UserNotVerified();
    error IdentityAlreadyRegistered();
    error NotRegistered();
    error NotEnoughStake();
    error InvalidAmount();
    error ActiveCasesPending();
    error UnstakeAlreadyRequested();
    error UnstakeNotRequested();
    error UnstakeCooldownActive();
    error NotEnoughEligibleArbitrators();

    // --- Events ---
    event ArbitratorAdded(bytes32 indexed identityHash, address indexed wallet, uint256 stake);
    event StakeIncreased(bytes32 indexed identityHash, address indexed wallet, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(bytes32 indexed identityHash, address indexed wallet, uint256 timestamp);
    event UnstakeCompleted(bytes32 indexed identityHash, address indexed wallet, uint256 amountReturned);
    event Slashed(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address indexed recipient);
    event ReputationUpdated(bytes32 indexed identityHash, uint256 newReputation);
    event CaseAssigned(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event CaseFinished(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event StatusChanged(bytes32 indexed identityHash, bool suspended, bool active);
    event WalletChanged(bytes32 indexed identityHash, address indexed oldWallet, address indexed newWallet);

    modifier onlyVerified(address _account) {
        if (!identityRegister.isVerified(_account)) revert UserNotVerified();
        _;
    }

    modifier onlyCourt() {
        if (msg.sender != arbitrationCourt) revert Unauthorized();
        _;
    }

    constructor(address _identityRegister, IERC20 _token) Ownable(msg.sender) {
        identityRegister = IIdentityRegister(_identityRegister);
        token = _token;
    }

    function setArbitrationCourt(address _court) external onlyOwner {
        arbitrationCourt = _court;
    }

    // --- 1. Add Arbitrator (Enforces 1 Arbitrator Per Identity) ---

    function addArbitrator(uint256 _stake) external onlyVerified(msg.sender) {
        if (msg.sender == owner()) revert Unauthorized();
        if (_stake < MINIMUM_STAKE) revert NotEnoughStake();

        // Fetch identity hash associated with caller's wallet
        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);

        Arbitrator storage arb = arbitrators[idHash];
        
        // Block registration if identity is already registered under ANY wallet
        if (arb.active || arb.stake > 0) revert IdentityAlreadyRegistered();

        arb.wallet = msg.sender;
        arb.stake = _stake;
        arb.reputation = 100;
        arb.active = true;

        arbitratorToIdentity[msg.sender] = idHash;
        arbitratorIndex[msg.sender] = arbitratorList.length;
        arbitratorList.push(msg.sender);

        token.safeTransferFrom(msg.sender, address(this), _stake);
        emit ArbitratorAdded(idHash, msg.sender, _stake);
    }

    function changeWallet(address _toWallet) external onlyVerified(msg.sender) {
        if (_toWallet == address(0) || _toWallet == msg.sender) revert InvalidAmount();
        
        // 1. Get identity hash of current wallet and incoming wallet
        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);
        bytes32 toIdHash = identityRegister.getIdentityHashByWallet(_toWallet);

        // 2. Ensure both wallets belong to the exact same identity
        if (idHash == bytes32(0) || idHash != toIdHash) revert Unauthorized();

        Arbitrator storage arb = arbitrators[idHash];
        if (arb.wallet != msg.sender || !arb.active) revert Unauthorized();

        // 3. Update reverse mappings
        delete arbitratorToIdentity[msg.sender];
        arbitratorToIdentity[_toWallet] = idHash;

        // 4. Update enumerable array indexes
        uint256 index = arbitratorIndex[msg.sender];
        arbitratorList[index] = _toWallet;
        arbitratorIndex[_toWallet] = index;
        delete arbitratorIndex[msg.sender];

        // 5. Update main state record
        arb.wallet = _toWallet;

        emit WalletChanged(idHash, msg.sender, _toWallet);
    }

    // --- 2. Increase Stake ---

    function increaseStake(uint256 _stake) external onlyVerified(msg.sender) {
        if (_stake == 0) revert InvalidAmount();
        
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        // Ensure the sender is the registered wallet for this identity
        if (!arb.active || arb.wallet != msg.sender) revert Unauthorized();

        arb.stake += _stake;
        token.safeTransferFrom(msg.sender, address(this), _stake);

        emit StakeIncreased(idHash, msg.sender, _stake, arb.stake);
    }

    // --- 3 & 4. Unstake Flow ---

    function requestUnstake() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];

        if (!arb.active || arb.wallet != msg.sender) revert NotRegistered();
        if (arb.activeCases > 0) revert ActiveCasesPending();
        if (arb.unstakeRequestedAt > 0) revert UnstakeAlreadyRequested();

        arb.unstakeRequestedAt = block.timestamp;
        arb.active = false;

        emit UnstakeRequested(idHash, msg.sender, block.timestamp);
    }

    function unstake() external nonReentrant {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];

        if (arb.wallet != msg.sender) revert Unauthorized();
        if (arb.unstakeRequestedAt == 0) revert UnstakeNotRequested();
        if (block.timestamp < arb.unstakeRequestedAt + UNSTAKE_COOL_DOWN) revert UnstakeCooldownActive();
        if (arb.activeCases > 0) revert ActiveCasesPending();

        uint256 payout = arb.stake;
        arb.stake = 0;
        arb.unstakeRequestedAt = 0;

        _removeArbitratorFromList(msg.sender, idHash);

        token.safeTransfer(msg.sender, payout);
        emit UnstakeCompleted(idHash, msg.sender, payout);
    }

    // --- 5 & 6. Slashing & Reputation (Called by Court) ---

    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];
        if (_amount > arb.stake) revert InvalidAmount();

        arb.stake -= _amount;
        token.safeTransfer(_recipient, _amount);
        if(arb.stake < MINIMUM_STAKE){
            arb.suspended = true; // Auto-suspend until top-up
            emit StatusChanged(idHash, arb.suspended, arb.active);        
        }

        emit Slashed(idHash, _arbitratorWallet, _amount, _recipient);
    }
    function reactivate() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        if (arb.wallet != msg.sender) revert Unauthorized();
        if (arb.stake < MINIMUM_STAKE) revert NotEnoughStake();
        
        arb.suspended = false;
        emit StatusChanged(idHash, false, arb.active);
    }

    function updateReputation(address _arbitratorWallet, int256 _delta) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (_delta < 0) {
            uint256 penalty = uint256(-_delta);
            arb.reputation = arb.reputation > penalty ? arb.reputation - penalty : 0;
        } else {
            arb.reputation += uint256(_delta);
        }
        emit ReputationUpdated(idHash, arb.reputation);
    }

    // --- 7 & 8. Case Counter Management ---

    function assignCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (!isEligible(_arbitratorWallet)) revert Unauthorized();
        arb.activeCases += 1;

        emit CaseAssigned(idHash, _arbitratorWallet, arb.activeCases);
    }

    function finishCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (arb.activeCases > 0) {
            arb.activeCases -= 1;
        }
        emit CaseFinished(idHash, _arbitratorWallet, arb.activeCases);
    }

    // --- 9. Eligibility Check ---

    function isEligible(address _arbitratorWallet) public view returns (bool) {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator memory arb = arbitrators[idHash];

        return (
            arb.wallet == _arbitratorWallet &&
            arb.active &&
            !arb.suspended &&
            arb.stake >= MINIMUM_STAKE &&
            arb.activeCases < MAX_ACTIVE_CASES &&
            identityRegister.isVerified(_arbitratorWallet)
        );
    }

    // --- Internal Helpers ---

    function _removeArbitratorFromList(address _wallet, bytes32 _idHash) internal {
        uint256 index = arbitratorIndex[_wallet];
        uint256 lastIndex = arbitratorList.length - 1;

        if (index != lastIndex) {
            address lastArb = arbitratorList[lastIndex];
            arbitratorList[index] = lastArb;
            arbitratorIndex[lastArb] = index;
        }

        arbitratorList.pop();
        delete arbitratorIndex[_wallet];
        delete arbitratorToIdentity[_wallet];
        delete arbitrators[_idHash];
    }
}