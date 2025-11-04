/**
 * Deployment script for Vault to Sei testnet/mainnet
 *
 * Usage:
 *   pnpm run deploy:vault:testnet
 *   pnpm run deploy:vault:mainnet
 */

import hre from 'hardhat';
import { formatEther, parseEther, type Address } from 'viem';

async function main() {
    const network = hre.network.name;
    console.log(`\n🚀 Deploying Vault to ${network}...`);

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

    // Get deployment parameters
    const admin = process.env.VAULT_ADMIN || deployer.account.address;

    console.log(`\n📋 Deployment Parameters:`);
    console.log(`   Admin: ${admin}`);

    // Deploy Vault
    console.log('\n1️⃣  Deploying Vault...');
    const vault = await hre.viem.deployContract('Vault', [admin as Address]);
    console.log(`   ✅ Vault deployed at: ${vault.address}`);

    // Verify deployment
    console.log('\n2️⃣  Verifying deployment...');
    const DEFAULT_ADMIN_ROLE = await vault.read.DEFAULT_ADMIN_ROLE();
    const hasAdminRole = await vault.read.hasRole([DEFAULT_ADMIN_ROLE, admin as Address]);

    console.log(`   Admin has DEFAULT_ADMIN_ROLE: ${hasAdminRole}`);
    const chainId = await vault.read.domainSeparatorV4();
    console.log(`   Domain Separator: ${chainId.slice(0, 10)}...`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Deployment Successful!');
    console.log('='.repeat(60));
    console.log(`Network: ${network}`);
    console.log(`Vault: ${vault.address}`);
    console.log(`Admin: ${admin}`);
    console.log('='.repeat(60));

    // Save deployment info
    const deploymentInfo = {
        network,
        timestamp: new Date().toISOString(),
        vault: vault.address,
        admin,
        deployer: deployer.account.address,
    };

    console.log('\n📝 Deployment Info:');
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // Verification instructions
    if (network !== 'hardhat' && network !== 'localhost') {
        console.log('\n📦 To verify the contract on the block explorer:');
        console.log(`pnpm hardhat verify --network ${network} ${vault.address} ${admin}`);
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
