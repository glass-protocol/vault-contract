/**
 * Deployment script for MockERC20 (samUSDC) to Sei testnet/mainnet
 *
 * Usage:
 *   pnpm run deploy:mock-erc20:testnet
 *   pnpm run deploy:mock-erc20:mainnet
 */

import hre from 'hardhat';
import { formatEther, parseEther, parseUnits } from 'viem';

async function main() {
    const network = hre.network.name;
    console.log(`\n🚀 Deploying MockERC20 (samUSDC) to ${network}...`);

    // Get deployer account
    const [deployer] = await hre.viem.getWalletClients();
    console.log(`📍 Deployer address: ${deployer.account.address}`);

    // Check balance
    const publicClient = await hre.viem.getPublicClient();
    const balance = await publicClient.getBalance({ address: deployer.account.address });
    console.log(`💰 Deployer balance: ${formatEther(balance)} SEI`);

    if (balance < parseEther('0.1')) {
        console.warn('⚠️  Warning: Low balance. Make sure you have enough SEI for deployment.');
    }

    // Token parameters
    const TOKEN_NAME = 'samUSDC';
    const TOKEN_SYMBOL = 'sUSDC';
    const TOKEN_DECIMALS = 6; // USDC typically uses 6 decimals

    console.log(`\n📋 Token Parameters:`);
    console.log(`   Name: ${TOKEN_NAME}`);
    console.log(`   Symbol: ${TOKEN_SYMBOL}`);
    console.log(`   Decimals: ${TOKEN_DECIMALS}`);

    // Deploy MockERC20
    console.log('\n1️⃣  Deploying MockERC20...');
    const mockERC20 = await hre.viem.deployContract('MockERC20', [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_DECIMALS,
    ]);
    console.log(`   ✅ MockERC20 deployed at: ${mockERC20.address}`);

    // Verify deployment
    console.log('\n2️⃣  Verifying deployment...');
    const name = await mockERC20.read.name();
    const symbol = await mockERC20.read.symbol();
    const decimals = await mockERC20.read.decimals();

    console.log(`   Token Name: ${name}`);
    console.log(`   Token Symbol: ${symbol}`);
    console.log(`   Token Decimals: ${decimals}`);

    // Optional: Mint initial supply to deployer
    const INITIAL_MINT = parseUnits('1000000', TOKEN_DECIMALS); // 1M tokens
    console.log('\n3️⃣  Minting initial supply...');
    const mintTx = await mockERC20.write.mint([deployer.account.address, INITIAL_MINT]);
    console.log(`   ✅ Minted ${formatEther(INITIAL_MINT * BigInt(10 ** (18 - TOKEN_DECIMALS)))} ${TOKEN_SYMBOL} to deployer`);
    console.log(`   Transaction: ${mintTx}`);

    const deployerBalance = await mockERC20.read.balanceOf([deployer.account.address]);
    console.log(`   Deployer balance: ${Number(deployerBalance) / 10 ** TOKEN_DECIMALS} ${TOKEN_SYMBOL}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Deployment Successful!');
    console.log('='.repeat(60));
    console.log(`Network: ${network}`);
    console.log(`MockERC20 (${TOKEN_SYMBOL}): ${mockERC20.address}`);
    console.log(`Token Name: ${TOKEN_NAME}`);
    console.log(`Token Symbol: ${TOKEN_SYMBOL}`);
    console.log(`Decimals: ${TOKEN_DECIMALS}`);
    console.log(`Deployer: ${deployer.account.address}`);
    console.log('='.repeat(60));

    // Save deployment info
    const deploymentInfo = {
        network,
        timestamp: new Date().toISOString(),
        contract: mockERC20.address,
        tokenName: TOKEN_NAME,
        tokenSymbol: TOKEN_SYMBOL,
        decimals: TOKEN_DECIMALS,
        deployer: deployer.account.address,
        initialSupply: INITIAL_MINT.toString(),
    };

    console.log('\n📝 Deployment Info:');
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // Verification instructions
    if (network !== 'hardhat' && network !== 'localhost') {
        console.log('\n📦 To verify the contract on the block explorer:');
        console.log(
            `pnpm hardhat verify --network ${network} ${mockERC20.address} "${TOKEN_NAME}" "${TOKEN_SYMBOL}" ${TOKEN_DECIMALS}`,
        );
    }
}

main()
    .then(() => process.exit(0))
    .catch((error: Error) => {
        console.error('\n❌ Deployment failed:');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    });

