# Singapore Transport MCP 🇸🇬

[![CI/CD](https://github.com/siva-sub/MCP-Public-Transport/actions/workflows/ci.yml/badge.svg)](https://github.com/siva-sub/MCP-Public-Transport/actions)
[![npm version](https://badge.fury.io/js/%40siva-sub%2Fmcp-public-transport.svg)](https://badge.fury.io/js/%40siva-sub%2Fmcp-public-transport)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive Model Context Protocol (MCP) server for Singapore's transport system, providing real-time data and intelligent routing through LLM interfaces like Claude.

## ⚙️ Configuration

### Environment Variables
The server is configured using environment variables. You can set these in a `.env` file for local development.

- `LTA_ACCOUNT_KEY`: **Required**. Your LTA DataMall API key.
- `ONEMAP_TOKEN`: **Optional**. Your OneMap API token for higher rate limits.
- `CACHE_DURATION`: Cache duration in seconds (default: `300`).
- `LOG_LEVEL`: Logging level (default: `info`).

### GitHub Secrets
For deployment and CI/CD, you should store your API keys as secrets in your GitHub repository settings.

1. Go to your repository on GitHub.
2. Navigate to **Settings** > **Secrets and variables** > **Actions**.
3. Create the following repository secrets:
   - `LTA_ACCOUNT_KEY`: Your LTA DataMall API key.
   - `ONEMAP_TOKEN`: Your OneMap API token.
   - `NPM_TOKEN`: Your NPM token for publishing the package.

## 🚀 Quick Start

### Installation
```bash
npx @siva-sub/mcp-public-transport
```

### Claude Desktop Setup
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "singapore-transport": {
      "command": "npx",
      "args": ["-y", "@siva-sub/mcp-public-transport"],
      "env": {
        "LTA_ACCOUNT_KEY": "your_lta_api_key_here",
        "ONEMAP_TOKEN": "your_onemap_token_here"
      }
    }
  }
}
```

## Available Tools

This MCP server exposes a comprehensive set of tools for accessing Singapore's transport data via the Model Context Protocol.

### Bus
- **get_bus_arrival**: Get real-time bus arrival times and information for a specific bus stop.
- **find_bus_stops**: Find bus stops by location name, coordinates, or road name.

### Train
- **get_train_service_status**: Check current train service status and any disruptions.

### Routing
- **plan_comprehensive_journey**: Plan a comprehensive journey using multiple transport modes with real-time data.

### Taxi
- **get_nearby_taxis**: Find available taxis near a specified location.

### Traffic
- **get_traffic_conditions**: Get current traffic conditions, incidents, and road speeds.

> Each tool is accessible via the MCP protocol and can be invoked from compatible clients. For detailed parameter schemas and usage, see the source code in `src/tools/`.

## Error Handling

The server uses custom `TransportError` exceptions to handle API communication errors and processing issues. This ensures clear and descriptive error messages to assist with troubleshooting.

## Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Create pull request

## License

MIT
