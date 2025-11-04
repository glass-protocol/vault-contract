/**
 * Verification script for Vault contract on Sei testnet/mainnet
 *
 * Usage:
 *   VAULT_ADDRESS=0x... pnpm hardhat run scripts/verify-vault.ts --network seitestnet
 *   VAULT_ADDRESS=0x... pnpm hardhat run scripts/verify-vault.ts --network sei
 */

import hre from 'hardhat';

async function main() {
    console.log(`\n🔍 Verifying Vault contract on ${hre.network.name}...`);

    // Get addresses from environment or use deployed address
    const VAULT_ADDRESS = process.env.VAULT_ADDRESS || '0x48aa70c45d103665e58274c9dfe8f55e29785f75';
    const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS || '0x9452fe1f7cdffcb2819c052656746be795598055';

    console.log(`\n📋 Verification Parameters:`);
    console.log(`   Network: ${hre.network.name}`);
    console.log(`   Vault Address: ${VAULT_ADDRESS}`);
    console.log(`   Admin Address: ${ADMIN_ADDRESS}`);

    // Verify Vault contract
    try {
        console.log(`\n🔄 Verifying Vault at ${VAULT_ADDRESS}...`);

        await hre.run('verify:verify', {
            address: VAULT_ADDRESS,
            constructorArguments: [ADMIN_ADDRESS],
            contract: 'contracts/Vault.sol:Vault',
        });

        console.log(`✅ Vault verified successfully!`);
    } catch (error: unknown) {
        if (error instanceof Error) {
            if (error.message.includes('already verified')) {
                console.log(`✅ Vault is already verified`);
            } else if (error.message.includes('does not have bytecode')) {
                console.log(`❌ Vault not found at ${VAULT_ADDRESS}`);
                console.log(`   Make sure the contract is deployed on ${hre.network.name}`);
            } else if (error.message.includes('Etherscan')) {
                console.log(`⚠️  Etherscan API error (this is normal for Sei - the contract is still deployed)`);
                console.log(`   Error: ${error.message}`);
            } else {
                console.error(`❌ Failed to verify Vault:`, error.message);
            }
        } else {
            console.error(`❌ Unexpected error:`, error);
        }
    }

    // Print verification links
    console.log('\n' + '='.repeat(60));
    console.log('📦 Block Explorer Links');
    console.log('='.repeat(60));

    const explorerBase = hre.network.name === 'sei' ? 'https://seiscan.io' : 'https://seitrace.com';

    const chainParam = hre.network.name === 'seitestnet' ? '?chain=atlantic-2' : '';

    console.log(`\nVault Contract:`);
    console.log(`  ${explorerBase}/address/${VAULT_ADDRESS}${chainParam}`);

    // Alternative explorers
    if (hre.network.name === 'seitestnet') {
        console.log(`\nAlternative Explorers:`);
        console.log(`  Seitrace: https://seitrace.com/address/${VAULT_ADDRESS}?chain=atlantic-2`);
        console.log(`  Celatone: https://www.seiscan.app/atlantic-2/accounts/${VAULT_ADDRESS}`);
    } else if (hre.network.name === 'sei') {
        console.log(`\nAlternative Explorers:`);
        console.log(`  Seitrace: https://seitrace.com/address/${VAULT_ADDRESS}?chain=pacific-1`);
        console.log(`  Celatone: https://www.seiscan.app/pacific-1/accounts/${VAULT_ADDRESS}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📝 Contract Info');
    console.log('='.repeat(60));
    console.log(`Network: ${hre.network.name}`);
    console.log(`Vault: ${VAULT_ADDRESS}`);
    console.log(`Admin: ${ADMIN_ADDRESS}`);
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Verification failed:', error);
        process.exit(1);
    });
