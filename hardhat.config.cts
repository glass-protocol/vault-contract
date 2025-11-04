import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox-viem';
import '@nomicfoundation/hardhat-viem';
import { ChainId, NetworkName, rpcUrls } from './constants/networks';
import 'dotenv/config';

const { PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;
if (!PRIVATE_KEY) {
    throw new Error('HardhatConfig: The private key is required');
}

const GAS_PRICE = 2000000000; // 2 gwei = 2 nsei

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.28',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        [NetworkName.Sei]: {
            url: rpcUrls[ChainId.Sei],
            accounts: [PRIVATE_KEY],
            chainId: ChainId.Sei,
            gasPrice: GAS_PRICE,
        },
        [NetworkName.SeiTestnet]: {
            url: rpcUrls[ChainId.SeiTestnet],
            accounts: [PRIVATE_KEY],
            chainId: ChainId.SeiTestnet,
            gasPrice: GAS_PRICE,
        },
        [NetworkName.Hardhat]: {
            chainId: ChainId.Hardhat,
        },
    },
    sourcify: {
        enabled: false, // Sourcify doesn't support Sei chain yet
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY || 'DUMMY_KEY', // Use Etherscan v2 API
        customChains: [
            {
                network: NetworkName.SeiTestnet,
                chainId: ChainId.SeiTestnet,
                urls: {
                    apiURL: 'https://api.etherscan.io/v2/api',
                    browserURL: 'https://testnet.seiscan.io',
                },
            },
            {
                network: NetworkName.Sei,
                chainId: ChainId.Sei,
                urls: {
                    apiURL: 'https://api.etherscan.io/v2/api',
                    browserURL: 'https://seiscan.io',
                },
            },
        ],
    },
};

export default config;
