import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

/**
 * Deployment module for Vault (non-upgradeable)
 */
const VaultModule = buildModule('VaultModule', (m) => {
    // Get the admin address from parameters or use deployer
    const admin = m.getParameter('admin', m.getAccount(0));

    // Deploy the Vault contract
    const vault = m.contract('Vault', [admin]);

    return { vault };
});

export default VaultModule;
