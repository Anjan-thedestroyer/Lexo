// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

/// @title ArbitratorRegistry
/// @notice Manages arbitrator staking, unique identity mapping, eligibility, and dynamic O(1) random selection.
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

    // --- Dynamic Active Pool (O(1) Selection Engine) ---
    // Contains strictly eligible arbitrator wallets ready for immediate selection
    address[] public eligiblePool;
    // wallet => (index in eligiblePool + 1). 0 indicates wallet is not in the pool.
    mapping(address => uint256) private eligibleIndex;

    // Master list of all registered wallets (historical & active)
    address[] public arbitratorList;
    mapping(address => uint256) private arbitratorIndex;

    // Nonce incremented on every random selection to guarantee fresh seeds within the same block
    uint256 public selectionNonce;

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
    event ArbitratorSelected(uint256 indexed caseId, address indexed wallet, uint256 randomIndex, uint256 poolSize);

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

        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);
        Arbitrator storage arb = arbitrators[idHash];
        
        if (arb.active || arb.stake > 0) revert IdentityAlreadyRegistered();

        arb.wallet = msg.sender;
        arb.stake = _stake;
        arb.reputation = 100;
        arb.active = true;

        arbitratorToIdentity[msg.sender] = idHash;
        arbitratorIndex[msg.sender] = arbitratorList.length;
        arbitratorList.push(msg.sender);

        token.safeTransferFrom(msg.sender, address(this), _stake);

        _syncEligibility(msg.sender);
        emit ArbitratorAdded(idHash, msg.sender, _stake);
    }

    // --- 2. Change Registered Wallet ---

    function changeWallet(address _toWallet) external onlyVerified(msg.sender) {
        if (_toWallet == address(0) || _toWallet == msg.sender) revert InvalidAmount();
        if (arbitratorToIdentity[_toWallet] != bytes32(0)) revert IdentityAlreadyRegistered();

        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);
        bytes32 toIdHash = identityRegister.getIdentityHashByWallet(_toWallet);

        if (idHash == bytes32(0) || idHash != toIdHash) revert Unauthorized();

        Arbitrator storage arb = arbitrators[idHash];
        if (arb.wallet != msg.sender || !arb.active) revert Unauthorized();
        if (arb.activeCases > 0) revert ActiveCasesPending();

        // 1. Remove old wallet from active eligible pool
        _removeFromEligiblePool(msg.sender);

        // 2. Update reverse lookup mappings
        delete arbitratorToIdentity[msg.sender];
        arbitratorToIdentity[_toWallet] = idHash;

        // 3. Update master list index
        uint256 index = arbitratorIndex[msg.sender];
        arbitratorList[index] = _toWallet;
        arbitratorIndex[_toWallet] = index;
        delete arbitratorIndex[msg.sender];

        // 4. Update main record and add new wallet to pool if eligible
        arb.wallet = _toWallet;
        _syncEligibility(_toWallet);

        emit WalletChanged(idHash, msg.sender, _toWallet);
    }

    // --- 3. Increase Stake ---

    function increaseStake(uint256 _stake) external onlyVerified(msg.sender) {
        if (_stake == 0) revert InvalidAmount();
        
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        if (!arb.active || arb.wallet != msg.sender) revert Unauthorized();

        token.safeTransferFrom(msg.sender, address(this), _stake);
        arb.stake += _stake;

        _syncEligibility(msg.sender);
        emit StakeIncreased(idHash, msg.sender, _stake, arb.stake);
    }

    // --- 4 & 5. Unstake Flow ---

    function requestUnstake() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];

        if (!arb.active || arb.wallet != msg.sender) revert NotRegistered();
        if (arb.activeCases > 0) revert ActiveCasesPending();
        if (arb.unstakeRequestedAt > 0) revert UnstakeAlreadyRequested();

        arb.unstakeRequestedAt = block.timestamp;
        arb.active = false;

        _removeFromEligiblePool(msg.sender);
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

        _removeFromEligiblePool(msg.sender);
        _removeArbitratorFromList(msg.sender, idHash);

        token.safeTransfer(msg.sender, payout);
        emit UnstakeCompleted(idHash, msg.sender, payout);
    }

    // --- 6. Slashing & Reactivation ---

    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];
        
        if (arb.wallet == address(0)) revert NotRegistered();
        if (_amount > arb.stake) revert InvalidAmount();

        arb.stake -= _amount;
        token.safeTransfer(_recipient, _amount);

        if (arb.stake < MINIMUM_STAKE) {
            arb.suspended = true;
            emit StatusChanged(idHash, arb.suspended, arb.active);        
        }

        if (arb.reputation > 0) {
            uint256 penalty = _amount / 10; // Deduct 10% of slashed amount from reputation
            arb.reputation = arb.reputation > penalty ? arb.reputation - penalty : 0;
            emit ReputationUpdated(idHash, arb.reputation);
        }

        _syncEligibility(_arbitratorWallet);
        emit Slashed(idHash, _arbitratorWallet, _amount, _recipient);
    }

    function reactivate() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        if (arb.wallet != msg.sender) revert Unauthorized();
        if (arb.stake < MINIMUM_STAKE) revert NotEnoughStake();
        
        arb.suspended = false;
        _syncEligibility(msg.sender);
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

    // --- 7. Case Management (Manual & Finished) ---

    function assignCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (!isEligible(_arbitratorWallet)) revert Unauthorized();
        arb.activeCases += 1;

        _syncEligibility(_arbitratorWallet);
        emit CaseAssigned(idHash, _arbitratorWallet, arb.activeCases);
    }

    function finishCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (arb.activeCases > 0) {
            arb.activeCases -= 1;
        }

        _syncEligibility(_arbitratorWallet);
        emit CaseFinished(idHash, _arbitratorWallet, arb.activeCases);
    }

    // --- 8. O(1) Instant Random Selection ---

    /// @notice Selects an eligible arbitrator in O(1) constant gas regardless of total registered user count.
    function assignRandomCase(uint256 _caseId) external onlyCourt returns (address selected) {
        uint256 poolSize = eligiblePool.length;
        if (poolSize == 0) revert NotEnoughEligibleArbitrators();

        uint256 randomIndex = _pseudoRandom(_caseId) % poolSize;
        selected = eligiblePool[randomIndex];

        bytes32 idHash = arbitratorToIdentity[selected];
        Arbitrator storage arb = arbitrators[idHash];
        arb.activeCases += 1;

        // If capacity reached, automatically remove from selection pool
        _syncEligibility(selected);

        emit CaseAssigned(idHash, selected, arb.activeCases);
        emit ArbitratorSelected(_caseId, selected, randomIndex, poolSize);
    }

    // --- Views ---

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

    function getEligiblePoolSize() external view returns (uint256) {
        return eligiblePool.length;
    }

    // --- Internal Helpers: Dynamic Active Pool (O(1) Swap-and-Pop) ---

    function _syncEligibility(address _wallet) internal {
        if (isEligible(_wallet)) {
            _addToEligiblePool(_wallet);
        } else {
            _removeFromEligiblePool(_wallet);
        }
    }

    function _addToEligiblePool(address _wallet) internal {
        if (eligibleIndex[_wallet] == 0) {
            eligiblePool.push(_wallet);
            eligibleIndex[_wallet] = eligiblePool.length; // 1-based index storage
        }
    }

    function _removeFromEligiblePool(address _wallet) internal {
        uint256 indexPlusOne = eligibleIndex[_wallet];
        if (indexPlusOne == 0) return; // Not in pool

        uint256 indexToSwap = indexPlusOne - 1;
        uint256 lastIndex = eligiblePool.length - 1;

        if (indexToSwap != lastIndex) {
            address lastWallet = eligiblePool[lastIndex];
            eligiblePool[indexToSwap] = lastWallet;
            eligibleIndex[lastWallet] = indexToSwap + 1;
        }

        eligiblePool.pop();
        delete eligibleIndex[_wallet];
    }

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

    function _pseudoRandom(uint256 _salt) internal returns (uint256) {
        selectionNonce++;
        return uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    blockhash(block.number - 1),
                    _salt,
                    selectionNonce
                )
            )
        );
    }
}