// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

/**
 * @title ArbitratorRegistry
 * @notice Manages arbitrator registration, staking lifecycle, reputation, and eligibility.
 */
contract ArbitratorRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---
    IERC20 public immutable token;
    IIdentityRegister public immutable identityRegister;
    address public arbitrationCourt;

    uint256 public constant MINIMUM_STAKE = 500 * 1e6; // 500 USDT (6 decimals)
    uint256 public constant UNSTAKE_COOL_DOWN = 7 days;
    uint256 public constant MAX_ACTIVE_CASES = 3;

    struct Arbitrator {
        uint256 stake;
        uint256 activeCases;
        uint256 reputation;
        uint256 unstakeRequestedAt;
        bool active;
        bool suspended;
    }

    mapping(address => Arbitrator) public arbitrators;
    address[] public arbitratorList;
    mapping(address => uint256) private arbitratorIndex; // For O(1) array removal

    // --- Custom Errors ---
    error Unauthorized();
    error UserNotVerified();
    error AlreadyRegistered();
    error NotRegistered();
    error NotEnoughStake();
    error InvalidAmount();
    error ActiveCasesPending();
    error UnstakeAlreadyRequested();
    error UnstakeNotRequested();
    error UnstakeCooldownActive();
    error ArbitratorSuspended();
    error NotEnoughEligibleArbitrators();

    // --- Events ---
    event ArbitratorAdded(address indexed arbitrator, uint256 stake);
    event StakeIncreased(address indexed arbitrator, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(address indexed arbitrator, uint256 timestamp);
    event UnstakeCompleted(address indexed arbitrator, uint256 amountReturned);
    event Slashed(address indexed arbitrator, uint256 amount, address indexed recipient);
    event ReputationUpdated(address indexed arbitrator, uint256 newReputation);
    event CaseAssigned(address indexed arbitrator, uint256 newActiveCases);
    event CaseFinished(address indexed arbitrator, uint256 newActiveCases);
    event StatusChanged(address indexed arbitrator, bool suspended, bool active);

    // --- Modifiers ---
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

    // --- 1 & 2. Registration & Stake Management ---

    function addArbitrator(uint256 _stake) external onlyVerified(msg.sender) {
        if (msg.sender == owner()) revert Unauthorized();
        if (_stake < MINIMUM_STAKE) revert NotEnoughStake();

        Arbitrator storage arb = arbitrators[msg.sender];
        if (arb.active || arb.stake > 0) revert AlreadyRegistered();

        arb.stake = _stake;
        arb.reputation = 100;
        arb.active = true;

        arbitratorIndex[msg.sender] = arbitratorList.length;
        arbitratorList.push(msg.sender);

        token.safeTransferFrom(msg.sender, address(this), _stake);
        emit ArbitratorAdded(msg.sender, _stake);
    }

    function increaseStake(uint256 _stake) external onlyVerified(msg.sender) {
        if (_stake == 0) revert InvalidAmount();
        Arbitrator storage arb = arbitrators[msg.sender];
        if (!arb.active) revert Unauthorized();

        arb.stake += _stake;
        token.safeTransferFrom(msg.sender, address(this), _stake);

        emit StakeIncreased(msg.sender, _stake, arb.stake);
    }

    // --- 3 & 4. Unstaking Protocol ---

    /// @notice Request unstaking. Initiates 7-day cooldown period.
    function requestUnstake() external {
        Arbitrator storage arb = arbitrators[msg.sender];
        if (!arb.active) revert NotRegistered();
        if (arb.activeCases > 0) revert ActiveCasesPending();
        if (arb.unstakeRequestedAt > 0) revert UnstakeAlreadyRequested();

        arb.unstakeRequestedAt = block.timestamp;
        arb.active = false; // Immediately stop receiving new cases

        emit UnstakeRequested(msg.sender, block.timestamp);
    }

    /// @notice Complete unstaking after 7 days have passed.
    function unstake() external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        if (arb.unstakeRequestedAt == 0) revert UnstakeNotRequested();
        if (block.timestamp < arb.unstakeRequestedAt + UNSTAKE_COOL_DOWN) revert UnstakeCooldownActive();
        if (arb.activeCases > 0) revert ActiveCasesPending();

        uint256 payout = arb.stake;
        arb.stake = 0;
        arb.unstakeRequestedAt = 0;

        _removeArbitratorFromList(msg.sender);

        token.safeTransfer(msg.sender, payout);
        emit UnstakeCompleted(msg.sender, payout);
    }

    // --- 5 & 6. Slashing & Reputation ---

    function slash(address _arbitrator, uint256 _amount, address _recipient) external onlyCourt {
        Arbitrator storage arb = arbitrators[_arbitrator];
        if (_amount > arb.stake) revert InvalidAmount();

        arb.stake -= _amount;
        token.safeTransfer(_recipient, _amount);

        emit Slashed(_arbitrator, _amount, _recipient);
    }

    function updateReputation(address _arbitrator, int256 _delta) external onlyCourt {
        Arbitrator storage arb = arbitrators[_arbitrator];
        if (_delta < 0) {
            uint256 penalty = uint256(-_delta);
            arb.reputation = arb.reputation > penalty ? arb.reputation - penalty : 0;
        } else {
            arb.reputation += uint256(_delta);
        }
        emit ReputationUpdated(_arbitrator, arb.reputation);
    }

    // --- 7 & 8. Case Counter Management ---

    function assignCase(address _arbitrator) external onlyCourt {
        Arbitrator storage arb = arbitrators[_arbitrator];
        if (!isEligible(_arbitrator)) revert Unauthorized();
        arb.activeCases += 1;
        emit CaseAssigned(_arbitrator, arb.activeCases);
    }

    function finishCase(address _arbitrator) external onlyCourt {
        Arbitrator storage arb = arbitrators[_arbitrator];
        if (arb.activeCases > 0) {
            arb.activeCases -= 1;
        }
        emit CaseFinished(_arbitrator, arb.activeCases);
    }

    // --- 9 & 10. Eligibility & Views ---

    function isEligible(address _arbitrator) public view returns (bool) {
        Arbitrator memory arb = arbitrators[_arbitrator];
        return (
            arb.active &&
            !arb.suspended &&
            arb.stake >= MINIMUM_STAKE &&
            arb.activeCases < MAX_ACTIVE_CASES &&
            identityRegister.isVerified(_arbitrator)
        );
    }

    function getArbitrator(address _arbitrator) external view returns (
        uint256 stake,
        uint256 reputation,
        uint256 activeCases,
        bool active,
        bool suspended
    ) {
        Arbitrator memory arb = arbitrators[_arbitrator];
        return (arb.stake, arb.reputation, arb.activeCases, arb.active, arb.suspended);
    }

    // --- 11 & 12. Suspension Controls ---

    function suspend(address _arbitrator) external onlyOwner {
        arbitrators[_arbitrator].suspended = true;
        emit StatusChanged(_arbitrator, true, arbitrators[_arbitrator].active);
    }

    function reactivate(address _arbitrator) external onlyOwner {
        arbitrators[_arbitrator].suspended = false;
        emit StatusChanged(_arbitrator, false, arbitrators[_arbitrator].active);
    }

    // --- 13 & 14. Pool Querying & Random Selection ---

    function getEligibleArbitrators() public view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < arbitratorList.length; i++) {
            if (isEligible(arbitratorList[i])) {
                count++;
            }
        }

        address[] memory eligible = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < arbitratorList.length; i++) {
            if (isEligible(arbitratorList[i])) {
                eligible[index] = arbitratorList[i];
                index++;
            }
        }
        return eligible;
    }

    /// @notice Selects N random arbitrators from the eligible pool.
    /// @dev Uses block.prevrandao for basic pseudorandomness. Swap for Chainlink VRF in production.
    function selectRandom(uint256 count) external view returns (address[] memory) {
        address[] memory pool = getEligibleArbitrators();
        if (pool.length < count) revert NotEnoughEligibleArbitrators();

        address[] memory selected = new address[](count);
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, pool.length)));

        for (uint256 i = 0; i < count; i++) {
            uint256 index = uint256(keccak256(abi.encodePacked(seed, i))) % pool.length;
            selected[i] = pool[index];
            
            // Swap & pop pattern to ensure distinct selections without duplicates
            pool[index] = pool[pool.length - 1];
            assembly { mstore(pool, sub(mload(pool), 1)) }
        }

        return selected;
    }

    // --- Helper Functions ---

    function _removeArbitratorFromList(address _arbitrator) internal {
        uint256 index = arbitratorIndex[_arbitrator];
        uint256 lastIndex = arbitratorList.length - 1;

        if (index != lastIndex) {
            address lastArb = arbitratorList[lastIndex];
            arbitratorList[index] = lastArb;
            arbitratorIndex[lastArb] = index;
        }

        arbitratorList.pop();
        delete arbitratorIndex[_arbitrator];
        delete arbitrators[_arbitrator];
    }
}