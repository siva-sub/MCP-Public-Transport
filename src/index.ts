#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SingaporeTransportServer } from './server.js';
import { loadEnvironment } from './config/environment.js';
import { logger } from './utils/logger.js';

const PACKAGE_VERSION = '1.0.0';

async function main(): Promise<void> {
  try {
    // Load and validate environment configuration
    const config = loadEnvironment();
    
    logger.info('Starting Singapore Transport MCP Server', {
      version: PACKAGE_VERSION,
      logLevel: config.logLevel,
      cacheDuration: config.cacheDuration,
    });

    // Create MCP server instance
    const server = new Server(
      {
        name: 'singapore-transport-mcp',
        version: PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize Singapore Transport server with tools
    const transportServer = new SingaporeTransportServer(config);
    await transportServer.setupTools(server);

    // Perform health check
    const healthStatus = await transportServer.healthCheck();
    logger.info('Health check completed', healthStatus);

    // Create stdio transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    logger.info('Singapore Transport MCP Server started successfully');
    
    // Keep the process alive
    process.stdin.resume();
    
  } catch (error) {
    logger.error('Failed to start Singapore Transport MCP Server', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
function setupGracefulShutdown(): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  
  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      process.exit(0);
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });
}

// CLI argument handling
function handleCliArgs(): void {
  const args = process.argv.slice(2);
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`Singapore Transport MCP v${PACKAGE_VERSION}`);
    process.exit(0);
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Singapore Transport MCP Server v${PACKAGE_VERSION}

A Model Context Protocol server for Singapore's transport system.

Usage:
  singapore-transport-mcp [options]
  npx @siva-sub/mcp-public-transport [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number

Environment Variables:
  LTA_ACCOUNT_KEY         LTA DataMall API key (required)
  ONEMAP_TOKEN           OneMap API token (optional)
  CACHE_DURATION         Cache duration in seconds (default: 300)
  LOG_LEVEL              Logging level (default: info)
  MAX_WALK_DISTANCE      Max walking distance in meters (default: 1000)

Examples:
  # Start the server
  singapore-transport-mcp

  # Use with Claude Desktop (add to claude_desktop_config.json):
  {
    "mcpServers": {
      "singapore-transport": {
        "command": "npx",
        "args": ["-y", "@siva-sub/mcp-public-transport"],
        "env": {
          "LTA_ACCOUNT_KEY": "your_api_key_here"
        }
      }
    }
  }

For more information: https://github.com/siva-sub/MCP-Public-Transport
    `);
    process.exit(0);
  }
}

// Main execution
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  handleCliArgs();
  setupGracefulShutdown();
  main().catch((error) => {
    logger.error('Fatal error during startup', error);
    process.exit(1);
  });
}

export { SingaporeTransportServer };
