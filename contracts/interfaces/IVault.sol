// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IVault
 * @notice Interface for the Vault contract with EIP712 payment channel support
 * @dev Production-ready with gas-optimized storage layout and enhanced security
 */
interface IVault {
    /**
     * @notice Represents a single deposit in the vault (optimized storage layout)
     * @dev Uses smaller types to pack into 3 storage slots instead of 6
     * @param amount Remaining balance in deposit (uint128 supports 340 trillion tokens with 18 decimals)
     * @param withdrawn Total amount withdrawn by provider (uint128)
     * @param depositBlock Timestamp when deposit was made (uint64 supports 584 billion years)
     * @param timeoutBlocks Timeout duration in seconds (uint64)
     * @param maxApproved Highest approved amount (uint64, sufficient for most use cases)
     * @param nonce Current approval nonce (uint32 supports 4.2 billion approvals)
     */
    struct Deposit {
        uint128 amount;
        uint128 withdrawn;
        uint64 depositBlock;
        uint64 timeoutBlocks;
        uint64 maxApproved;
        uint32 nonce;
    }

    // Events
    event Deposited(
        address indexed depositor,
        address indexed token,
        uint256 depositId,
        uint256 amount,
        uint256 timeoutBlocks
    );

    event ApprovalIncreased(
        address indexed depositor,
        address indexed token,
        uint256 depositId,
        uint256 newMaxApproved,
        uint256 nonce
    );

    event WithdrawnByProvider(
        address indexed depositor,
        address indexed token,
        uint256 depositId,
        uint256 amount,
        uint256 totalWithdrawn
    );

    event TimedOut(
        address indexed depositor,
        address indexed token,
        uint256 depositId,
        uint256 amount
    );

    event EmergencyWithdrawalInitiated(
        address indexed initiator,
        address indexed recipient,
        uint256 unlockTime
    );

    event EmergencyWithdrawalExecuted(
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event DirectETHReceived(
        address indexed sender,
        uint256 amount
    );

    // Errors
    error InvalidAddress();
    error InvalidSignature();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidAmount();
    error InvalidTimeout();
    error NonceTooLow();
    error MaxAmountTooLow();
    error AmountExceedsAvailable();
    error TimeoutNotReached();
    error NoDeposit();
    error EmergencyNotInitiated();
    error EmergencyTimelockActive();
    error AmountOverflow();

    // Functions
    function deposit(
        address token,
        uint256 amount,
        uint256 timeoutBlocks
    ) external returns (uint256 depositId);

    function depositNative(
        uint256 timeoutBlocks
    ) external payable returns (uint256 depositId);

    function withdraw(
        address depositor,
        address token,
        uint256 depositId,
        uint256 maxAmount,
        uint256 amount,
        uint256 nonce,
        bytes memory signature
    ) external;

    function withdrawTimeout(
        address token,
        uint256 depositId
    ) external;

    function initiateEmergencyWithdrawal(
        address recipient
    ) external;

    function executeEmergencyWithdrawal(
        address token
    ) external;

    function cancelEmergencyWithdrawal() external;

    function pause() external;

    function unpause() external;

    function getDeposit(
        address user,
        address token,
        uint256 depositId
    ) external view returns (Deposit memory);

    function getNextDepositId(
        address user,
        address token
    ) external view returns (uint256);

    function getAvailable(
        address depositor,
        address token,
        uint256 depositId
    ) external view returns (uint256 available);

    function isTimedOut(
        address depositor,
        address token,
        uint256 depositId
    ) external view returns (bool timedOut);

    function domainSeparatorV4() external view returns (bytes32);
}

