# VaultUpgradeable - EIP712 Payment Channel

A secure, upgradeable vault contract with EIP712 payment channel support for GlassAI inference provider payments.

## Overview

The VaultUpgradeable contract implements a payment channel system where:

- Users deposit tokens (ERC20 or native SEI) into the vault
- Users sign EIP-712 approvals off-chain to authorize withdrawals
- Providers can withdraw funds up to the approved amount using these signatures
- Signatures are reusable until the approved amount is reached
- Approvals are monotonically increasing (can only go up)
- Each deposit has a timeout allowing users to reclaim unused funds

## Key Features

### 🔐 EIP712 Signatures

- Users sign withdrawal approvals using EIP-712 standard
- Supports both EOA signatures and EIP-1271 contract wallet signatures
- No centralized signer required - users maintain full control

### 💰 Payment Channel Semantics

- Reusable signatures for multiple partial withdrawals
- Monotonic approvals (maxAmount can only increase)
- Nonce-based invalidation of old signatures
- Per-deposit tracking with independent state

### ⏰ Timeout Protection

- Each deposit has a configurable timeout period (in blocks)
- Users can reclaim unused funds after timeout
- Protects against provider unavailability

### 🔄 Upgradeable

- UUPS proxy pattern for safe upgrades
- Role-based access control
- Pausable for emergency situations

### 🔒 Security Features

- ReentrancyGuard on all state-changing functions
- SafeERC20 for token transfers
- Comprehensive access control roles
- Audited architecture based on battle-tested patterns

## Architecture

### Contract Structure

```
VaultUpgradeable (Proxy)
├── EIP712Upgradeable (for signature verification)
├── AccessControlUpgradeable (role management)
├── ReentrancyGuardUpgradeable (reentrancy protection)
├── PausableUpgradeable (emergency stop)
└── UUPSUpgradeable (upgrade mechanism)
```

### Roles

- `DEFAULT_ADMIN_ROLE`: Can grant/revoke all roles
- `FEE_MANAGER_ROLE`: Can set fee collector address
- `PAUSER_ROLE`: Can pause/unpause the contract
- `DEBUGGER_ROLE`: Can set application ID
- `UPGRADER_ROLE`: Can upgrade the implementation
- `BATCH_MANAGER_ROLE`: Can set batch registry for settlements

## Usage

### Installation

```bash
# Install dependencies
pnpm install

# Compile contracts
pnpm compile

# Run tests
pnpm test:vault
```

### Deployment

#### Using the deployment script:

```bash
# Deploy to Sei testnet
pnpm run deploy:vault:testnet

# Deploy to Sei mainnet
pnpm run deploy:vault:mainnet
```

#### Using Hardhat Ignition:

```bash
# Deploy to Sei testnet with custom parameters
pnpm run deploy:vault:ignition:testnet

# Deploy to Sei mainnet
pnpm run deploy:vault:ignition:mainnet
```

#### Environment Variables

Create a `.env` file:

```bash
# Required
PRIVATE_KEY=your_deployer_private_key

# Optional
VAULT_ADMIN=0x... # Defaults to deployer
APPLICATION_ID=glass-ai-vault # Defaults to 'glass-ai-vault'
```

## User Flow

### 1. User Deposits Tokens

```typescript
// Approve vault to spend tokens
await token.approve(vaultAddress, amount);

// Deposit with timeout
const depositId = await vault.deposit(
    tokenAddress,
    amount,
    timeoutBlocks // e.g., 1000 blocks
);
```

### 2. User Signs Withdrawal Approval (EIP-712)

```typescript
const domain = {
    name: 'VaultUpgradeable',
    version: '1',
    chainId: 1329, // Sei mainnet
    verifyingContract: vaultAddress,
};

const types = {
    Withdrawal: [
        { name: 'depositor', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'depositId', type: 'uint256' },
        { name: 'maxAmount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
    ],
};

const message = {
    depositor: userAddress,
    token: tokenAddress,
    depositId: 0,
    maxAmount: parseUnits('100', 6), // Approve up to 100 USDC
    nonce: 0,
};

const signature = await signer.signTypedData({
    domain,
    types,
    primaryType: 'Withdrawal',
    message,
});
```

### 3. Provider Withdraws Funds

```typescript
// Provider can withdraw multiple times with the same signature
await vault.withdraw(
    userAddress,
    tokenAddress,
    depositId,
    maxAmount,
    actualAmount, // Can be less than maxAmount
    nonce,
    signature
);
```

### 4. User Increases Approval (Optional)

```typescript
// To increase approval, increment nonce and sign new approval
const newMessage = {
    depositor: userAddress,
    token: tokenAddress,
    depositId: 0,
    maxAmount: parseUnits('200', 6), // Increase to 200 USDC
    nonce: 1, // Increment nonce to invalidate old signature
};

const newSignature = await signer.signTypedData({
    domain,
    types,
    primaryType: 'Withdrawal',
    message: newMessage,
});
```

### 5. User Reclaims After Timeout (If Needed)

```typescript
// After timeout period has elapsed
await vault.withdrawTimeout(tokenAddress, depositId);
```

## Smart Contract Interface

### Main Functions

#### Deposits

```solidity
function deposit(address token, uint256 amount, uint256 timeoutBlocks) external returns (uint256 depositId);

function depositNative(uint256 timeoutBlocks) external payable returns (uint256 depositId);
```

#### Withdrawals (EIP712)

```solidity
function withdraw(
    address depositor,
    address token,
    uint256 depositId,
    uint256 maxAmount,
    uint256 amount,
    uint256 nonce,
    bytes memory signature
) external;

function withdrawTimeout(address token, uint256 depositId) external;
```

#### View Functions

```solidity
function getDeposit(address user, address token, uint256 depositId) external view returns (Deposit memory);

function getAvailable(address depositor, address token, uint256 depositId) external view returns (uint256);

function isTimedOut(address depositor, address token, uint256 depositId) external view returns (bool);
```

## Events

```solidity
event Deposited(
    string indexed applicationId,
    address indexed depositor,
    address indexed token,
    uint256 depositId,
    uint256 amount,
    uint256 timeoutBlocks
);

event ApprovalIncreased(
    string indexed applicationId,
    address indexed depositor,
    address indexed token,
    uint256 depositId,
    uint256 newMaxApproved,
    uint256 nonce
);

event WithdrawnByProvider(
    string indexed applicationId,
    address indexed depositor,
    address indexed token,
    uint256 depositId,
    uint256 amount,
    uint256 totalWithdrawn
);

event TimedOut(
    string indexed applicationId,
    address indexed depositor,
    address indexed token,
    uint256 depositId,
    uint256 amount
);
```

## Testing

The test suite includes comprehensive coverage of:

- ✅ Initialization and role setup
- ✅ ERC20 token deposits
- ✅ Native token deposits
- ✅ EIP712 signature verification
- ✅ Partial withdrawals with reusable signatures
- ✅ Monotonic approval increases
- ✅ Timeout withdrawals
- ✅ Admin functions
- ✅ Pause/unpause functionality
- ✅ Access control
- ✅ Error cases

Run tests:

```bash
pnpm test:vault
```

## Security Considerations

1. **Signature Replay**: Each signature is tied to a specific deposit, amount, and nonce
2. **Timeout Protection**: Users can always reclaim funds after timeout period
3. **Monotonic Approvals**: Prevents downgrade attacks
4. **Reentrancy Protection**: All state-changing functions use ReentrancyGuard
5. **Safe Token Transfers**: Uses OpenZeppelin's SafeERC20
6. **Role-Based Access**: Critical functions require specific roles
7. **Pausable**: Can be paused in emergencies

## Gas Optimization

- Uses `unchecked` blocks where safe for gas savings
- Caches storage variables in memory during batch operations
- Minimal storage reads/writes
- Efficient data structures

## Upgrade Process

The contract uses UUPS (Universal Upgradeable Proxy Standard):

1. Only addresses with `UPGRADER_ROLE` can upgrade
2. Upgrades are done through `upgradeTo()` or `upgradeToAndCall()`
3. Storage layout must be maintained across upgrades
4. Use storage gaps for future variable additions

## Integration Example

See `test/VaultUpgradeable.ts` for complete integration examples.

## License

MIT
