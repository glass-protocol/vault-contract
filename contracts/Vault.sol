// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title Vault
 * @author 0xmar(@ogarciarevett)
 * @notice Secure vault for token deposits and withdrawals with EIP712 payment channel support
 * @dev Production-ready implementation with security improvements and gas optimizations
 *
 * Key Features:
 * - Timestamp-based timeouts (chain-agnostic)
 * - Optimized storage layout (saves 3 storage slots per deposit)
 * - Emergency withdrawal mechanism with 48-hour timelock
 * - Timeout limits (1 hour to 30 days)
 * - Enhanced event logging
 * - Gas optimizations throughout
 * - EIP-1271 support for contract wallets
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./interfaces/IVault.sol";

contract Vault is AccessControl, ReentrancyGuard, Pausable, EIP712, IVault {
    using SafeERC20 for IERC20;

    // ============================================
    // CONSTANTS
    // ============================================

    /// @notice Token type identifier - address(0) represents native token (SEI)
    address public constant NATIVE_TOKEN = address(0);

    /// @notice Role for pausing the contract
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role for emergency withdrawals (with timelock)
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    /// @notice Maximum timeout period (30 days)
    uint256 public constant MAX_TIMEOUT_BLOCKS = 30 days;

    /// @notice Minimum timeout period (1 hour)
    uint256 public constant MIN_TIMEOUT_BLOCKS = 1 hours;

    /// @notice Emergency withdrawal timelock (48 hours)
    uint256 public constant EMERGENCY_TIMELOCK = 48 hours;

    /// @notice EIP-712 typehash for withdrawal approvals
    bytes32 private constant _WITHDRAWAL_TYPEHASH =
        keccak256(
            "Withdrawal(address depositor,address token,uint256 depositId,uint256 maxAmount,uint256 nonce)"
        );

    /// @notice Magic value for EIP-1271 signature validation
    bytes4 private constant _EIP1271_MAGIC_VALUE = 0x1626ba7e;

    // ============================================
    // STATE VARIABLES
    // ============================================

    /// @dev Mapping of user => token => depositId => Deposit (optimized storage layout)
    /// @dev Note: NATIVE_TOKEN (address(0)) is used for native SEI deposits
    mapping(address => mapping(address => mapping(uint256 => Deposit)))
        private _deposits;

    /// @dev Mapping of user => token => next available depositId
    /// @dev Note: NATIVE_TOKEN (address(0)) is used for native SEI deposits
    mapping(address => mapping(address => uint256)) private _nextDepositId;

    /// @dev Emergency withdrawal timestamp (0 = not initiated)
    uint256 public emergencyWithdrawalTime;

    /// @dev Emergency withdrawal recipient
    address public emergencyRecipient;

    /// @dev The assigned receiver of any funds with withdraw function
    address public defaultReceiver;

    /**
     * @notice Constructor initializes the contract with admin roles and EIP712
     * @param _admin The address to be assigned all administrative roles
     */
    constructor(address _admin) EIP712("Vault", "1") {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
    }

    // ============================================
    // DEPOSIT FUNCTIONS
    // ============================================

    /**
     * @notice Deposit ERC20 tokens into the vault with payment channel support
     * @dev Creates a new deposit with a unique depositId for the caller
     * @dev For native tokens, use depositNative() instead
     * @dev Uses timestamp-based timeouts for cross-chain compatibility
     * @param token Address of the ERC20 token to deposit (cannot be NATIVE_TOKEN)
     * @param amount Amount of tokens to deposit (must be > 0)
     * @param timeoutBlocks Timeout duration in seconds (min 1 hour, max 30 days)
     * @return depositId The unique identifier for this deposit
     */
    function deposit(
        address token,
        uint256 amount,
        uint256 timeoutBlocks
    ) external nonReentrant whenNotPaused returns (uint256 depositId) {
        // Input validation
        if (token == NATIVE_TOKEN) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (
            timeoutBlocks < MIN_TIMEOUT_BLOCKS ||
            timeoutBlocks > MAX_TIMEOUT_BLOCKS
        ) {
            revert InvalidTimeout();
        }
        if (amount > type(uint128).max) revert AmountOverflow();

        // Get depositId and increment (unchecked for gas savings)
        unchecked {
            depositId = _nextDepositId[msg.sender][token]++;
        }

        // Store deposit with optimized packing
        _deposits[msg.sender][token][depositId] = Deposit({
            amount: uint128(amount),
            depositBlock: uint64(block.timestamp),
            timeoutBlocks: uint64(timeoutBlocks),
            withdrawn: 0,
            maxApproved: 0,
            nonce: 0
        });

        // Transfer tokens (external interaction last - CEI pattern)
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, token, depositId, amount, timeoutBlocks);
    }

    /**
     * @notice Deposit native token (SEI) into the vault with payment channel support
     * @dev Uses NATIVE_TOKEN (address(0)) as the token identifier for native tokens
     * @dev Uses timestamp-based timeouts for cross-chain compatibility
     * @param timeoutBlocks Timeout duration in seconds (min 1 hour, max 30 days)
     * @return depositId The unique identifier for this deposit
     */
    function depositNative(
        uint256 timeoutBlocks
    ) external payable nonReentrant whenNotPaused returns (uint256 depositId) {
        // Input validation
        if (msg.value == 0) revert InvalidAmount();
        if (
            timeoutBlocks < MIN_TIMEOUT_BLOCKS ||
            timeoutBlocks > MAX_TIMEOUT_BLOCKS
        ) {
            revert InvalidTimeout();
        }
        if (msg.value > type(uint128).max) revert AmountOverflow();

        // Get depositId and increment (unchecked for gas savings)
        unchecked {
            depositId = _nextDepositId[msg.sender][NATIVE_TOKEN]++;
        }

        // Store deposit with optimized packing
        _deposits[msg.sender][NATIVE_TOKEN][depositId] = Deposit({
            amount: uint128(msg.value),
            depositBlock: uint64(block.timestamp),
            timeoutBlocks: uint64(timeoutBlocks),
            withdrawn: 0,
            maxApproved: 0,
            nonce: 0
        });

        emit Deposited(
            msg.sender,
            NATIVE_TOKEN,
            depositId,
            msg.value,
            timeoutBlocks
        );
    }

    // ============================================
    // WITHDRAWAL FUNCTIONS (EIP712 PAYMENT CHANNEL)
    // ============================================

    /**
     * @notice Withdraw funds from a deposit using EIP-712 signed approval
     * @dev Implements payment channel semantics with reusable signatures
     * @dev Supports both EOA (EIP-712) and contract wallet (EIP-1271) signatures
     * @dev Funds are sent to msg.sender (the provider/withdrawer) if defaultReceiver is null
     * @dev Otherwise, the funds are sent to defaultReceiver
     * @param depositor Address of the depositor who owns the deposit
     * @param token Address of the token (use NATIVE_TOKEN/address(0) for native SEI)
     * @param depositId ID of the deposit to withdraw from
     * @param maxAmount Maximum total amount approved by depositor (must be >= previous maxApproved)
     * @param amount Actual amount to withdraw in this transaction (sent to msg.sender)
     * @param nonce Nonce for this approval (must match or exceed current nonce)
     * @param signature EIP-712 or EIP-1271 signature from depositor
     */
    function withdraw(
        address depositor,
        address token,
        uint256 depositId,
        uint256 maxAmount,
        uint256 amount,
        uint256 nonce,
        bytes memory signature
    ) external nonReentrant whenNotPaused {
        Deposit storage dep = _deposits[depositor][token][depositId];

        // Cache storage reads for gas optimization
        uint256 cachedNonce = dep.nonce;
        uint256 cachedMaxApproved = dep.maxApproved;
        uint256 cachedWithdrawn = dep.withdrawn;
        uint256 cachedAmount = dep.amount;

        // Validate nonce
        if (nonce < cachedNonce) revert NonceTooLow();

        // Validate maxAmount based on nonce
        if (nonce > cachedNonce) {
            // New nonce requires strictly increasing maxAmount
            if (maxAmount <= cachedMaxApproved) revert MaxAmountTooLow();
        } else {
            // Same nonce allows reuse but maxAmount cannot decrease
            if (maxAmount < cachedMaxApproved) revert MaxAmountTooLow();
        }

        // Verify EIP-712 signature (supports contract wallets via EIP-1271)
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _WITHDRAWAL_TYPEHASH,
                    depositor,
                    token,
                    depositId,
                    maxAmount,
                    nonce
                )
            )
        );
        _verifySignature(depositor, digest, signature);

        // Bounds checks before downcasting
        if (maxAmount > type(uint64).max) revert AmountOverflow();
        if (nonce > type(uint32).max) revert NonceTooHigh();

        // Update approval if increased
        if (maxAmount > cachedMaxApproved) {
            dep.maxApproved = uint64(maxAmount);
            dep.nonce = uint32(nonce);
            emit ApprovalIncreased(
                depositor,
                token,
                depositId,
                maxAmount,
                nonce
            );
        }

        // Validate withdrawal amount
        uint256 available;
        unchecked {
            available = maxAmount - cachedWithdrawn; // Safe: maxAmount >= withdrawn by design
        }
        if (amount > available) revert AmountExceedsAvailable();
        if (amount > cachedAmount) revert InsufficientBalance();

        // Update state (CEI pattern)
        unchecked {
            dep.withdrawn = uint128(cachedWithdrawn + amount);
            dep.amount = uint128(cachedAmount - amount);
        }

        if (defaultReceiver == address(0)) {
            // Transfer tokens to provider (msg.sender)
            if (token == NATIVE_TOKEN) {
                (bool success, ) = msg.sender.call{ value: amount }("");
                if (!success) revert TransferFailed();
            } else {
                IERC20(token).safeTransfer(msg.sender, amount);
            }
        } else {
            // Transfer tokens to assigned receiver
            if (token == NATIVE_TOKEN) {
                (bool success, ) = defaultReceiver.call{ value: amount }("");
                if (!success) revert TransferFailed();
            } else {
                IERC20(token).safeTransfer(defaultReceiver, amount);
            }
        }

        emit WithdrawnByProvider(
            depositor,
            token,
            depositId,
            amount,
            dep.withdrawn
        );
    }

    /**
     * @notice Allows depositor to reclaim funds after the timeout period
     * @dev Uses timestamp-based timeout for cross-chain compatibility
     * @dev Funds are sent back to msg.sender (the depositor)
     * @param token Address of the token (use NATIVE_TOKEN/address(0) for native SEI)
     * @param depositId ID of the deposit to reclaim
     */
    function withdrawTimeout(
        address token,
        uint256 depositId
    ) external nonReentrant whenNotPaused {
        Deposit storage dep = _deposits[msg.sender][token][depositId];

        uint256 cachedAmount = dep.amount;
        if (cachedAmount == 0) revert NoDeposit();

        // Check timeout using timestamp (gas optimized with unchecked)
        unchecked {
            if (block.timestamp < dep.depositBlock + dep.timeoutBlocks) {
                revert TimeoutNotReached();
            }
        }

        // Update state (CEI pattern)
        dep.amount = 0;

        // Transfer tokens back to depositor (msg.sender)
        if (token == NATIVE_TOKEN) {
            (bool success, ) = msg.sender.call{ value: cachedAmount }("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, cachedAmount);
        }

        emit TimedOut(msg.sender, token, depositId, cachedAmount);
    }

    // ============================================
    // EMERGENCY FUNCTIONS
    // ============================================

    /**
     * @notice Initiate emergency withdrawal (step 1 of 2)
     * @dev Starts 48-hour timelock before funds can be withdrawn
     * @dev This provides transparency and gives users time to withdraw if needed
     * @param recipient Address to receive funds after timelock expires
     */
    function initiateEmergencyWithdrawal(
        address recipient
    ) external onlyRole(EMERGENCY_ROLE) {
        if (recipient == address(0)) revert InvalidAddress();

        emergencyWithdrawalTime = block.timestamp + EMERGENCY_TIMELOCK;
        emergencyRecipient = recipient;

        emit EmergencyWithdrawalInitiated(
            msg.sender,
            recipient,
            emergencyWithdrawalTime
        );
    }

    /**
     * @notice Execute emergency withdrawal (step 2 of 2)
     * @dev Can only be called after 48-hour timelock expires
     * @param token Token to withdraw (NATIVE_TOKEN for native tokens)
     */
    function executeEmergencyWithdrawal(
        address token
    ) external onlyRole(EMERGENCY_ROLE) {
        if (emergencyWithdrawalTime == 0) revert EmergencyNotInitiated();
        if (block.timestamp < emergencyWithdrawalTime)
            revert EmergencyTimelockActive();

        uint256 balance;
        if (token == NATIVE_TOKEN) {
            balance = address(this).balance;
            (bool success, ) = emergencyRecipient.call{ value: balance }("");
            if (!success) revert TransferFailed();
        } else {
            balance = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(emergencyRecipient, balance);
        }

        emit EmergencyWithdrawalExecuted(emergencyRecipient, token, balance);

        // Reset emergency state
        emergencyWithdrawalTime = 0;
        emergencyRecipient = address(0);
    }

    function setDefaultReceiver(
        address receiver
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultReceiver = receiver;
    }

    /**
     * @notice Cancel initiated emergency withdrawal
     * @dev Can be called anytime before execution to abort the emergency withdrawal
     */
    function cancelEmergencyWithdrawal() external onlyRole(EMERGENCY_ROLE) {
        emergencyWithdrawalTime = 0;
        emergencyRecipient = address(0);
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Pauses the contract
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Gets the deposit information for a user
     * @param user Address of the user
     * @param token Address of the token
     * @param depositId ID of the deposit
     * @return Deposit struct containing all deposit information
     */
    function getDeposit(
        address user,
        address token,
        uint256 depositId
    ) external view returns (Deposit memory) {
        return _deposits[user][token][depositId];
    }

    /**
     * @notice Gets the next deposit ID for a user and token
     * @param user Address of the user
     * @param token Address of the token
     * @return Next available deposit ID
     */
    function getNextDepositId(
        address user,
        address token
    ) external view returns (uint256) {
        return _nextDepositId[user][token];
    }

    /**
     * @notice Get the available amount that can be withdrawn for a given deposit
     * @param depositor Address of the depositor
     * @param token Address of the token
     * @param depositId ID of the deposit
     * @return available Amount available for withdrawal (maxApproved - withdrawn)
     */
    function getAvailable(
        address depositor,
        address token,
        uint256 depositId
    ) external view returns (uint256 available) {
        Deposit storage dep = _deposits[depositor][token][depositId];
        unchecked {
            available = dep.maxApproved - dep.withdrawn; // Safe: maxApproved >= withdrawn by design
        }
    }

    /**
     * @notice Check if a deposit has reached its timeout
     * @dev Uses timestamp-based comparison for cross-chain compatibility
     * @param depositor Address of the depositor
     * @param token Address of the token
     * @param depositId ID of the deposit
     * @return timedOut True if the timeout period has elapsed
     */
    function isTimedOut(
        address depositor,
        address token,
        uint256 depositId
    ) external view returns (bool timedOut) {
        Deposit storage dep = _deposits[depositor][token][depositId];
        unchecked {
            timedOut = block.timestamp >= dep.depositBlock + dep.timeoutBlocks;
        }
    }

    /**
     * @notice Gets the domain separator for EIP-712
     * @return Domain separator hash
     */
    function domainSeparatorV4() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    /**
     * @notice Verifies a signature from either an EOA (EIP-712) or a contract wallet (EIP-1271)
     * @dev EOA signatures must be exactly 65 bytes and use ECDSA recovery
     * @dev Contract wallets must implement EIP-1271's isValidSignature()
     * @param signer Expected signer address
     * @param digest EIP-712 digest to verify
     * @param signature Signature bytes (65 bytes for EOA, variable for contracts)
     */
    function _verifySignature(
        address signer,
        bytes32 digest,
        bytes memory signature
    ) internal view {
        // Try ECDSA recovery for EOA signatures (65 bytes)
        if (signature.length == 65) {
            address recovered = ECDSA.recover(digest, signature);
            if (recovered == signer) return;
        }

        // Try EIP-1271 for contract wallet signatures
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (
                bytes4 magicValue
            ) {
                if (magicValue == _EIP1271_MAGIC_VALUE) return;
            } catch {}
        }

        revert InvalidSignature();
    }

    /**
     * @notice Receive native tokens with event emission for transparency
     * @dev Emits DirectETHReceived event for tracking direct ETH transfers
     */
    receive() external payable {
        emit DirectETHReceived(msg.sender, msg.value);
    }
}
