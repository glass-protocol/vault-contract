import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture, time, mine } from '@nomicfoundation/hardhat-network-helpers';
import type { Address } from 'viem';
import { parseEther, encodePacked, keccak256, toBytes, parseUnits } from 'viem';

describe('Vault', function () {
    async function deployVaultFixture() {
        const [admin, user1, user2, provider, feeCollector] = await hre.viem.getWalletClients();

        // Deploy MockERC20 for testing
        const mockToken = await hre.viem.deployContract('MockERC20', ['Test USDC', 'USDC', 6]);

        // Deploy Vault
        const vault = await hre.viem.deployContract('Vault', [admin.account.address]);

        // Mint tokens to users
        await mockToken.write.mint([user1.account.address, parseUnits('10000', 6)]);
        await mockToken.write.mint([user2.account.address, parseUnits('10000', 6)]);

        // Approve vault to spend tokens
        const mockTokenAsUser1 = await hre.viem.getContractAt('MockERC20', mockToken.address, {
            client: { wallet: user1 },
        });
        await mockTokenAsUser1.write.approve([vault.address, parseUnits('10000', 6)]);

        const mockTokenAsUser2 = await hre.viem.getContractAt('MockERC20', mockToken.address, {
            client: { wallet: user2 },
        });
        await mockTokenAsUser2.write.approve([vault.address, parseUnits('10000', 6)]);

        const publicClient = await hre.viem.getPublicClient();

        return {
            vault,
            mockToken,
            admin,
            user1,
            user2,
            provider,
            feeCollector,
            publicClient,
        };
    }

    describe('Initialization', function () {
        it('Should initialize with correct admin roles', async function () {
            const { vault, admin } = await loadFixture(deployVaultFixture);

            const DEFAULT_ADMIN_ROLE = await vault.read.DEFAULT_ADMIN_ROLE();
            expect(await vault.read.hasRole([DEFAULT_ADMIN_ROLE, admin.account.address])).to.be.true;

            const PAUSER_ROLE = await vault.read.PAUSER_ROLE();
            expect(await vault.read.hasRole([PAUSER_ROLE, admin.account.address])).to.be.true;
        });

        it('Should revert when deploying with zero address', async function () {
            await expect(hre.viem.deployContract('Vault', ['0x0000000000000000000000000000000000000000'])).to.be
                .rejected;
        });
    });

    describe('ERC20 Deposits', function () {
        it('Should allow user to deposit tokens', async function () {
            const { vault, mockToken, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            const timeoutSeconds = 3600n; // 1 hour (minimum allowed)

            const hash = await vaultAsUser1.write.deposit([mockToken.address, depositAmount, timeoutSeconds]);

            const receipt = await publicClient.getTransactionReceipt({ hash });
            expect(receipt.status).to.equal('success');

            // Check deposit was created
            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);

            expect(deposit.amount).to.equal(depositAmount);
            expect(deposit.timeoutBlocks).to.equal(timeoutSeconds);
        });

        it('Should revert deposit with zero amount', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await expect(vaultAsUser1.write.deposit([mockToken.address, 0n, 3600n])).to.be.rejectedWith(
                'InvalidAmount'
            );
        });

        it('Should revert deposit with zero timeout', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await expect(vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 0n])).to.be.rejectedWith(
                'InvalidTimeout'
            );
        });

        it('Should increment deposit ID for multiple deposits', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('50', 6), 3600n]);

            const nextId = await vault.read.getNextDepositId([user1.account.address, mockToken.address]);
            expect(nextId).to.equal(2n);
        });
    });

    describe('Native Token Deposits', function () {
        it('Should allow user to deposit native tokens', async function () {
            const { vault, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseEther('1');
            const timeoutBlocks = 3600n;

            const hash = await vaultAsUser1.write.depositNative([timeoutBlocks], {
                value: depositAmount,
            });

            const receipt = await publicClient.getTransactionReceipt({ hash });
            expect(receipt.status).to.equal('success');

            // Check deposit was created (address(0) represents native token)
            const deposit = await vault.read.getDeposit([
                user1.account.address,
                '0x0000000000000000000000000000000000000000',
                0n,
            ]);

            expect(deposit.amount).to.equal(depositAmount);
        });

        it('Should revert native deposit with zero value', async function () {
            const { vault, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await expect(vaultAsUser1.write.depositNative([3600n], { value: 0n })).to.be.rejectedWith('InvalidAmount');
        });
    });

    describe('EIP712 Withdrawals', function () {
        async function createWithdrawalSignature(
            vault: any,
            signer: any,
            depositor: Address,
            token: Address,
            depositId: bigint,
            maxAmount: bigint,
            nonce: bigint
        ) {
            const domain = {
                name: 'Vault',
                version: '1',
                chainId: 31337,
                verifyingContract: vault.address as Address,
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
                depositor,
                token,
                depositId,
                maxAmount,
                nonce,
            };

            return await signer.signTypedData({
                domain,
                types,
                primaryType: 'Withdrawal',
                message,
            });
        }

        it('Should allow provider to withdraw with valid signature', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            // User deposits tokens
            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // User signs approval for provider to withdraw
            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            // Provider withdraws
            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            const providerBalanceBefore = await mockToken.read.balanceOf([provider.account.address]);

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                maxAmount,
                0n,
                signature,
            ]);

            const providerBalanceAfter = await mockToken.read.balanceOf([provider.account.address]);
            expect(providerBalanceAfter - providerBalanceBefore).to.equal(maxAmount);

            // Check deposit state
            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            expect(deposit.withdrawn).to.equal(maxAmount);
            expect(deposit.maxApproved).to.equal(maxAmount);
        });

        it('Should allow reusable signatures for partial withdrawals', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // User signs approval for max 50 USDC
            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // Provider withdraws 20 USDC
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                parseUnits('20', 6),
                0n,
                signature,
            ]);

            // Provider can reuse the same signature to withdraw another 20 USDC
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                parseUnits('20', 6),
                0n,
                signature,
            ]);

            // Check total withdrawn
            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            expect(deposit.withdrawn).to.equal(parseUnits('40', 6));
        });

        it('Should support monotonic approvals with new nonces', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // First approval: max 30 USDC with nonce 0
            let signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('30', 6),
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('30', 6),
                parseUnits('20', 6),
                0n,
                signature,
            ]);

            // Increase approval: max 60 USDC with nonce 1
            signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('60', 6),
                1n
            );

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('60', 6),
                parseUnits('30', 6),
                1n,
                signature,
            ]);

            // Check total withdrawn (20 + 30 = 50)
            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            expect(deposit.withdrawn).to.equal(parseUnits('50', 6));
        });

        it('Should revert withdrawal with invalid signature', async function () {
            const { vault, mockToken, user1, user2, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // User2 signs (wrong signer)
            const signature = await createWithdrawalSignature(
                vault,
                user2,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            await expect(
                vaultAsProvider.write.withdraw([
                    user1.account.address,
                    mockToken.address,
                    0n,
                    parseUnits('50', 6),
                    parseUnits('50', 6),
                    0n,
                    signature,
                ])
            ).to.be.rejectedWith('InvalidSignature');
        });

        it('Should revert when amount exceeds maxApproved', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // Try to withdraw more than maxApproved
            await expect(
                vaultAsProvider.write.withdraw([
                    user1.account.address,
                    mockToken.address,
                    0n,
                    maxAmount,
                    parseUnits('60', 6), // More than maxApproved
                    0n,
                    signature,
                ])
            ).to.be.rejectedWith('AmountExceedsAvailable');
        });
    });

    describe('Default Receiver', function () {
        it('Should send ERC20 withdrawals to msg.sender first, then to defaultReceiver after set', async function () {
            const { vault, mockToken, admin, user1, provider, feeCollector } = await loadFixture(deployVaultFixture);

            // User deposits tokens
            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // User signs approval for max 50
            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // ---- Step 1: defaultReceiver NOT set -> goes to msg.sender (provider)
            const providerBalBefore1 = await mockToken.read.balanceOf([provider.account.address]);
            const receiverBalBefore1 = await mockToken.read.balanceOf([feeCollector.account.address]);

            const firstWithdraw = parseUnits('20', 6);
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                firstWithdraw,
                0n,
                signature,
            ]);

            const providerBalAfter1 = await mockToken.read.balanceOf([provider.account.address]);
            const receiverBalAfter1 = await mockToken.read.balanceOf([feeCollector.account.address]);

            expect(providerBalAfter1 - providerBalBefore1).to.equal(firstWithdraw);
            expect(receiverBalAfter1 - receiverBalBefore1).to.equal(0n);

            // ---- Step 2: set defaultReceiver -> goes to defaultReceiver
            const vaultAsAdmin = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: admin },
            });
            await vaultAsAdmin.write.setDefaultReceiver([feeCollector.account.address]);

            const providerBalBefore2 = await mockToken.read.balanceOf([provider.account.address]);
            const receiverBalBefore2 = await mockToken.read.balanceOf([feeCollector.account.address]);
            const depositorBalBefore2 = await mockToken.read.balanceOf([user1.account.address]);

            const secondWithdraw = parseUnits('10', 6);
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                secondWithdraw,
                0n,
                signature,
            ]);

            const providerBalAfter2 = await mockToken.read.balanceOf([provider.account.address]);
            const receiverBalAfter2 = await mockToken.read.balanceOf([feeCollector.account.address]);
            const depositorBalAfter2 = await mockToken.read.balanceOf([user1.account.address]);

            // Provider/caller shouldn't receive tokens in step 2
            expect(providerBalAfter2 - providerBalBefore2).to.equal(0n);
            // Depositor's wallet shouldn't change in step 2
            expect(depositorBalAfter2 - depositorBalBefore2).to.equal(0n);
            // Receiver gets paid in step 2
            expect(receiverBalAfter2 - receiverBalBefore2).to.equal(secondWithdraw);
        });

        it('Should send native withdrawals to msg.sender first, then to defaultReceiver after set', async function () {
            const { vault, admin, user1, provider, feeCollector, publicClient } = await loadFixture(deployVaultFixture);

            // User deposits native
            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseEther('1');
            await vaultAsUser1.write.depositNative([3600n], { value: depositAmount });

            // User signs approval for max 0.4
            const maxAmount = parseEther('0.4');
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                '0x0000000000000000000000000000000000000000',
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // ---- Step 1: defaultReceiver NOT set -> goes to msg.sender (provider)
            const providerBalBefore1 = await publicClient.getBalance({ address: provider.account.address });
            const receiverBalBefore1 = await publicClient.getBalance({ address: feeCollector.account.address });

            const firstWithdraw = parseEther('0.1');
            let hash = await vaultAsProvider.write.withdraw([
                user1.account.address,
                '0x0000000000000000000000000000000000000000',
                0n,
                maxAmount,
                firstWithdraw,
                0n,
                signature,
            ]);
            let receipt = await publicClient.getTransactionReceipt({ hash });
            let gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const providerBalAfter1 = await publicClient.getBalance({ address: provider.account.address });
            const receiverBalAfter1 = await publicClient.getBalance({ address: feeCollector.account.address });

            // provider receives amount minus gas
            expect(providerBalAfter1 - providerBalBefore1 + gasUsed).to.equal(firstWithdraw);
            expect(receiverBalAfter1 - receiverBalBefore1).to.equal(0n);

            // ---- Step 2: set defaultReceiver -> goes to defaultReceiver
            const vaultAsAdmin = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: admin },
            });
            await vaultAsAdmin.write.setDefaultReceiver([feeCollector.account.address]);

            const providerBalBefore2 = await publicClient.getBalance({ address: provider.account.address });
            const receiverBalBefore2 = await publicClient.getBalance({ address: feeCollector.account.address });
            const depositorBalBefore2 = await publicClient.getBalance({ address: user1.account.address });

            const secondWithdraw = parseEther('0.1');
            hash = await vaultAsProvider.write.withdraw([
                user1.account.address,
                '0x0000000000000000000000000000000000000000',
                0n,
                maxAmount,
                secondWithdraw,
                0n,
                signature,
            ]);
            receipt = await publicClient.getTransactionReceipt({ hash });
            gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const providerBalAfter2 = await publicClient.getBalance({ address: provider.account.address });
            const receiverBalAfter2 = await publicClient.getBalance({ address: feeCollector.account.address });
            const depositorBalAfter2 = await publicClient.getBalance({ address: user1.account.address });

            // provider only pays gas now
            expect(providerBalBefore2 - providerBalAfter2 - gasUsed).to.equal(0n);
            // depositor doesn't pay gas and shouldn't receive anything in step 2
            expect(depositorBalAfter2 - depositorBalBefore2).to.equal(0n);
            // receiver gets full amount
            expect(receiverBalAfter2 - receiverBalBefore2).to.equal(secondWithdraw);
        });

        it('Should only allow admin to set defaultReceiver', async function () {
            const { vault, user1, feeCollector } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await expect(
                vaultAsUser1.write.setDefaultReceiver([feeCollector.account.address])
            ).to.be.rejected;
        });
    });


    describe('Timeout Withdrawals', function () {
        it('Should allow depositor to reclaim funds after timeout', async function () {
            const { vault, mockToken, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            const timeoutSeconds = 3600n; // 1 hour

            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, timeoutSeconds]);

            // Increase time to reach timeout
            await time.increase(3600);

            const balanceBefore = await mockToken.read.balanceOf([user1.account.address]);

            await vaultAsUser1.write.withdrawTimeout([mockToken.address, 0n]);

            const balanceAfter = await mockToken.read.balanceOf([user1.account.address]);
            expect(balanceAfter - balanceBefore).to.equal(depositAmount);
        });

        it('Should revert timeout withdrawal before timeout period', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            await expect(vaultAsUser1.write.withdrawTimeout([mockToken.address, 0n])).to.be.rejectedWith(
                'TimeoutNotReached'
            );
        });

        it('Should allow timeout withdrawal for native tokens', async function () {
            const { vault, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseEther('1');
            const timeoutSeconds = 3600n; // 1 hour

            await vaultAsUser1.write.depositNative([timeoutSeconds], {
                value: depositAmount,
            });

            // Increase time to reach timeout
            await time.increase(3600);

            const balanceBefore = await publicClient.getBalance({
                address: user1.account.address,
            });

            const hash = await vaultAsUser1.write.withdrawTimeout(['0x0000000000000000000000000000000000000000', 0n]);

            const receipt = await publicClient.getTransactionReceipt({ hash });
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const balanceAfter = await publicClient.getBalance({
                address: user1.account.address,
            });

            // Account for gas costs
            const diff = balanceAfter - balanceBefore + gasUsed;
            expect(Number(diff - depositAmount)).to.be.lessThan(Number(parseEther('0.001')));
        });
    });

    describe('Admin Functions', function () {
        it('Should allow pauser to pause and unpause', async function () {
            const { vault, admin } = await loadFixture(deployVaultFixture);

            await vault.write.pause();
            expect(await vault.read.paused()).to.be.true;

            await vault.write.unpause();
            expect(await vault.read.paused()).to.be.false;
        });

        it('Should prevent operations when paused', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            await vault.write.pause();

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await expect(
                vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n])
            ).to.be.rejectedWith('EnforcedPause');
        });
    });

    describe('View Functions', function () {
        it('Should return correct available amount', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const depositAmount = parseUnits('100', 6);
            await vaultAsUser1.write.deposit([mockToken.address, depositAmount, 3600n]);

            // Initially, no approval
            let available = await vault.read.getAvailable([user1.account.address, mockToken.address, 0n]);
            expect(available).to.equal(0n);

            // After withdrawal approval
            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                parseUnits('20', 6),
                0n,
                signature,
            ]);

            // Available should be maxApproved - withdrawn
            available = await vault.read.getAvailable([user1.account.address, mockToken.address, 0n]);
            expect(available).to.equal(parseUnits('30', 6));
        });

        it('Should return correct timeout status', async function () {
            const { vault, mockToken, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            let timedOut = await vault.read.isTimedOut([user1.account.address, mockToken.address, 0n]);
            expect(timedOut).to.be.false;

            // Increase time
            await time.increase(3600);

            timedOut = await vault.read.isTimedOut([user1.account.address, mockToken.address, 0n]);
            expect(timedOut).to.be.true;
        });

        it('Should return domain separator', async function () {
            const { vault } = await loadFixture(deployVaultFixture);

            const domainSeparator = await vault.read.domainSeparatorV4();
            expect(domainSeparator).to.be.a('string');
            expect(domainSeparator).to.have.lengthOf(66); // 0x + 64 hex chars
        });
    });

    describe('Edge Cases & Security', function () {
        it('Should handle multiple deposits from same user', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);
            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('200', 6), 7200n]); // 2 hours
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('300', 6), 10800n]); // 3 hours

            const deposit0 = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            const deposit1 = await vault.read.getDeposit([user1.account.address, mockToken.address, 1n]);
            const deposit2 = await vault.read.getDeposit([user1.account.address, mockToken.address, 2n]);

            expect(deposit0.amount).to.equal(parseUnits('100', 6));
            expect(deposit1.amount).to.equal(parseUnits('200', 6));
            expect(deposit2.amount).to.equal(parseUnits('300', 6));
        });

        it('Should isolate deposits between different tokens', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            // Deploy second token
            const mockToken2 = await hre.viem.deployContract('MockERC20', ['Test DAI', 'DAI', 18]);
            await mockToken2.write.mint([user1.account.address, parseEther('1000')]);

            const mockToken2AsUser1 = await hre.viem.getContractAt('MockERC20', mockToken2.address, {
                client: { wallet: user1 },
            });
            await mockToken2AsUser1.write.approve([vault.address, parseEther('1000')]);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);
            await vaultAsUser1.write.deposit([mockToken2.address, parseEther('50'), 3600n]);

            const usdcDeposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            const daiDeposit = await vault.read.getDeposit([user1.account.address, mockToken2.address, 0n]);

            expect(usdcDeposit.amount).to.equal(parseUnits('100', 6));
            expect(daiDeposit.amount).to.equal(parseEther('50'));
        });

        it('Should handle withdraw with maxAmount not changing but using same nonce', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            const maxAmount = parseUnits('50', 6);
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // First withdrawal
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                parseUnits('20', 6),
                0n,
                signature,
            ]);

            // Second withdrawal with same signature and same maxAmount (should work)
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                maxAmount,
                parseUnits('15', 6),
                0n,
                signature,
            ]);

            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            expect(deposit.withdrawn).to.equal(parseUnits('35', 6)); // total withdrawn
        });

        it('Should prevent withdrawing more than deposit amount even if approved', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('50', 6), 3600n]);

            // Approve for more than deposit
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('100', 6),
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // Try to withdraw more than deposited
            await expect(
                vaultAsProvider.write.withdraw([
                    user1.account.address,
                    mockToken.address,
                    0n,
                    parseUnits('100', 6),
                    parseUnits('60', 6),
                    0n,
                    signature,
                ])
            ).to.be.rejectedWith('InsufficientBalance');
        });

        it('Should handle native token withdrawal after timeout', async function () {
            const { vault, user1, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });

            const amount = parseEther('2');
            await vaultAsUser1.write.depositNative([3600n], { value: amount });

            // Increase time to reach timeout
            await time.increase(3600);

            const balanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const hash = await vaultAsUser1.write.withdrawTimeout(['0x0000000000000000000000000000000000000000', 0n]);
            const receipt = await publicClient.getTransactionReceipt({ hash });
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
            const balanceAfter = await publicClient.getBalance({ address: user1.account.address });

            const diff = balanceAfter - balanceBefore + gasUsed;
            expect(Number(diff - amount)).to.be.lessThan(Number(parseEther('0.01')));
        });

        it('Should correctly track state after partial withdrawal and timeout', async function () {
            const { vault, mockToken, user1, provider, publicClient } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            // Provider withdraws part
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('40', 6),
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('40', 6),
                parseUnits('40', 6),
                0n,
                signature,
            ]);

            // Increase time and timeout withdraw the rest
            await time.increase(3600);

            const balanceBefore = await mockToken.read.balanceOf([user1.account.address]);
            await vaultAsUser1.write.withdrawTimeout([mockToken.address, 0n]);
            const balanceAfter = await mockToken.read.balanceOf([user1.account.address]);

            expect(balanceAfter - balanceBefore).to.equal(parseUnits('60', 6));
        });

        it('Should handle deposits and withdrawals across different users independently', async function () {
            const { vault, mockToken, user1, user2, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            const vaultAsUser2 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user2 },
            });

            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);
            await vaultAsUser2.write.deposit([mockToken.address, parseUnits('200', 6), 3600n]);

            // User1 approves withdrawal
            const sig1 = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                0n
            );

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                parseUnits('30', 6),
                0n,
                sig1,
            ]);

            // Check user1's deposit decreased but user2's unchanged
            const deposit1 = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            const deposit2 = await vault.read.getDeposit([user2.account.address, mockToken.address, 0n]);

            expect(deposit1.amount).to.equal(parseUnits('70', 6));
            expect(deposit2.amount).to.equal(parseUnits('200', 6));
        });

        it('Should revert when trying to use higher nonce with non-increasing maxAmount', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // Set approval with nonce 0
            let signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                0n
            );
            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                parseUnits('10', 6),
                0n,
                signature,
            ]);

            // Try to use nonce 1 with same maxAmount (should fail)
            signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('50', 6),
                1n
            );

            await expect(
                vaultAsProvider.write.withdraw([
                    user1.account.address,
                    mockToken.address,
                    0n,
                    parseUnits('50', 6),
                    parseUnits('10', 6),
                    1n,
                    signature,
                ])
            ).to.be.rejectedWith('MaxAmountTooLow');
        });

        it('Should accept direct ETH transfers via receive()', async function () {
            const { vault, user1, publicClient } = await loadFixture(deployVaultFixture);

            const amount = parseEther('1');
            const vaultBalanceBefore = await publicClient.getBalance({ address: vault.address });

            await user1.sendTransaction({
                to: vault.address,
                value: amount,
            });

            const vaultBalanceAfter = await publicClient.getBalance({ address: vault.address });
            expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(amount);
        });

        it('Should maintain correct nonce after approval increase', async function () {
            const { vault, mockToken, user1, provider } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            const vaultAsProvider = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: provider },
            });

            // Approval with nonce 5
            const signature = await createWithdrawalSignature(
                vault,
                user1,
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('60', 6),
                5n
            );

            await vaultAsProvider.write.withdraw([
                user1.account.address,
                mockToken.address,
                0n,
                parseUnits('60', 6),
                parseUnits('20', 6),
                5n,
                signature,
            ]);

            const deposit = await vault.read.getDeposit([user1.account.address, mockToken.address, 0n]);
            expect(deposit.nonce).to.equal(5);
        });

        it('Should correctly return domain separator', async function () {
            const { vault } = await loadFixture(deployVaultFixture);

            const domainSeparator = await vault.read.domainSeparatorV4();
            expect(domainSeparator).to.be.a('string');
            expect(domainSeparator).to.have.lengthOf(66); // 0x + 64 hex chars
            expect(domainSeparator.startsWith('0x')).to.be.true;
        });

        it('Should correctly check timeout status before and after timeout', async function () {
            const { vault, mockToken, user1 } = await loadFixture(deployVaultFixture);

            const vaultAsUser1 = await hre.viem.getContractAt('Vault', vault.address, {
                client: { wallet: user1 },
            });
            await vaultAsUser1.write.deposit([mockToken.address, parseUnits('100', 6), 3600n]);

            // Check not timed out initially
            let timedOut = await vault.read.isTimedOut([user1.account.address, mockToken.address, 0n]);
            expect(timedOut).to.be.false;

            // Increase time partially (not enough)
            await time.increase(3599);
            timedOut = await vault.read.isTimedOut([user1.account.address, mockToken.address, 0n]);
            expect(timedOut).to.be.false;

            // Increase time by 1 more second (exactly at timeout)
            await time.increase(1);
            timedOut = await vault.read.isTimedOut([user1.account.address, mockToken.address, 0n]);
            expect(timedOut).to.be.true;
        });
    });

    async function createWithdrawalSignature(
        vault: any,
        signer: any,
        depositor: Address,
        token: Address,
        depositId: bigint,
        maxAmount: bigint,
        nonce: bigint
    ) {
        const domain = {
            name: 'Vault',
            version: '1',
            chainId: 31337,
            verifyingContract: vault.address as Address,
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
            depositor,
            token,
            depositId,
            maxAmount,
            nonce,
        };

        return await signer.signTypedData({
            domain,
            types,
            primaryType: 'Withdrawal',
            message,
        });
    }
});
