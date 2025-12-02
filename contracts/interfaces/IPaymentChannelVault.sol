// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPaymentChannelVault {
    // ============================================
    // ERRORS
    // ============================================

    error InvalidAddress();
    error InvalidAmount();
    error InvalidTimeout();
    error AmountOverflow();

    // ============================================
    // EVENTS
    // ============================================

    event Deposited(
        address indexed depositor,
        address indexed token,
        uint256 indexed depositId,
        uint256 amount,
        uint256 timeoutBlocks
    );

    // ============================================
    // DEPOSITS
    // ============================================

    function deposit(
        address token,
        uint256 amount,
        uint256 timeoutBlocks
    ) external returns (uint256 depositId);

    function depositNative(
        uint256 timeoutBlocks
    ) external payable returns (uint256 depositId);
}
