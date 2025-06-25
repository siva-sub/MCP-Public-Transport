# Singapore Location Intelligence MCP 🇸🇬

[![CI/CD](https://github.com/siva-sub/MCP-Public-Transport/actions/workflows/ci.yml/badge.svg)](https://github.com/siva-sub/MCP-Public-Transport/actions)
[![npm version](https://badge.fury.io/js/%40siva-sub%2Fmcp-public-transport.svg)](https://badge.fury.io/js/%40siva-sub%2Fmcp-public-transport)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **comprehensive Singapore Location Intelligence Platform** built as a Model Context Protocol (MCP) server. Provides enterprise-grade transport routing, postal code resolution, and location intelligence with **Google Maps-level detailed navigation instructions** - all optimized for Singapore's unique transport ecosystem.

## 🌟 Key Features

- 🎯 **Advanced Postal Code Intelligence** - 95% accuracy resolution for all Singapore postal codes
- 🗺️ **Professional Navigation Instructions** - Turn-by-turn directions like "Turn Left To Stay On Thomson Road"
- 🚇 **Multi-Modal Transport Planning** - Seamless integration of MRT, LRT, buses, and walking
- ⏰ **Singapore Time Intelligence** - Business hours, rush hour detection, and timing optimization
- 🔍 **Intelligent Location Search** - Fuzzy matching, typo tolerance, and smart suggestions
- 📍 **Comprehensive Geocoding** - Forward and reverse geocoding with Singapore-specific accuracy
- 🚌 **Real-Time Transport Data** - Live bus arrivals, train status, and service disruptions
- 💡 **Context-Aware Routing** - Peak hour optimization, last train warnings, night bus alternatives

## 🎯 Real-World Problem Solved

**Before**: Basic transport tools with failed postal code resolution
**After**: Enterprise-grade location intelligence platform

![Singapore Transport MCP Demo](./assets/singapore-transport-mcp-demo.gif)

```
INPUT: "How to get to Suntec City from Little India MRT?"

OUTPUT: 
✅ Postal Code 039594 → SUNTEC CITY
🚇 Route: DT Line (8 min) → Walk (6 min) 
💰 Cost: $1.55 | 🕐 Duration: 29 minutes
📍 Step-by-step: "Walk 246m to ROCHOR MRT → Take DT Line from Rochor to Promenade → Walk 450m to destination"
```

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
        "ONEMAP_TOKEN": "your_onemap_token_here",
        "ONEMAP_EMAIL": "your_onemap_email@example.com",
        "ONEMAP_PASSWORD": "your_onemap_password"
      }
    }
  }
}
```

## ⚙️ Configuration

### Required Environment Variables
- `LTA_ACCOUNT_KEY`: **Required**. Your LTA DataMall API key ([Get here](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html))

### Optional Environment Variables  
- `ONEMAP_TOKEN`: OneMap API token for enhanced features ([Register here](https://developers.onemap.sg/register/))
- `ONEMAP_EMAIL`: OneMap account email for authentication
- `ONEMAP_PASSWORD`: OneMap account password for authentication
- `CACHE_DURATION`: Cache duration in seconds (default: `300`)
- `LOG_LEVEL`: Logging level (default: `info`)

## 🛠️ Available Tools

### 🌍 Location Intelligence (NEW!)
- **`search_location`** - Intelligent location search with fuzzy matching and typo tolerance
- **`resolve_postal_code`** - High-accuracy Singapore postal code resolution (95% success rate)
- **`reverse_geocode`** - Convert coordinates to addresses with Singapore-specific accuracy

### 🚌 Public Transport
- **`get_bus_arrival`** - Real-time bus arrival times with crowding information
- **`find_bus_stops`** - Find bus stops by location, name, or coordinates
- **`plan_comprehensive_journey`** - Multi-modal journey planning with detailed instructions

### 🚇 Train Services  
- **`get_train_service_status`** - Real-time MRT/LRT service status and disruptions

### 🚕 Taxis & Ride-Hailing
- **`get_nearby_taxis`** - Find available taxis and estimate wait times

### 🚦 Traffic & Roads
- **`get_traffic_conditions`** - Live traffic conditions, incidents, and road speeds

## 📊 Enterprise Features

### Advanced Routing Capabilities
```javascript
// Multi-modal journey with detailed instructions
{
  "totalDuration": 2340, // seconds
  "totalCost": 2.40,
  "transfers": 2,
  "segments": [
    {
      "mode": "WALK",
      "instructions": ["Head East on Thomson Road for 145m", "Turn Left to continue..."],
      "duration": 400
    },
    {
      "mode": "TRAIN", 
      "service": "EW",
      "operator": "SMRT Corporation",
      "instructions": ["Take EW Line from Jurong East to Tanah Merah"]
    }
  ]
}
```

### Singapore Time Intelligence
```javascript
{
  "singaporeTime": "25/06/2025, 10:58 PM",
  "businessHours": false,
  "rushHour": false,
  "contextInfo": {
    "nextRushHour": "7:00 AM tomorrow",
    "travelRecommendation": "Off-peak travel - comfortable journey expected"
  }
}
```

### Postal Code Intelligence
```javascript
{
  "postalCode": "039594",
  "location": {
    "name": "SUNTEC CITY",
    "address": "3 TEMASEK BOULEVARD SUNTEC CITY SINGAPORE 039594",
    "district": "Downtown Core",
    "areaType": "Central Singapore",
    "confidence": 0.98
  }
}
```

## 🎯 Use Cases

### 1. Navigation Applications
- Detailed turn-by-turn directions
- Multi-modal journey planning
- Real-time traffic integration

### 2. Delivery & Logistics
- Postal code validation and resolution
- Optimal route planning
- Address standardization

### 3. Urban Planning
- Transport accessibility analysis
- Peak hour traffic optimization
- Public transport coverage mapping

### 4. Tourism & Hospitality
- Tourist-friendly directions
- Public transport guidance
- Location discovery

## 📈 Performance & Reliability

- **5-second API timeouts** for responsive user experience
- **Intelligent caching** with location-aware TTL
- **Graceful degradation** during API maintenance
- **95% postal code resolution accuracy** 
- **Real-time data integration** with official Singapore APIs

## 🔧 Advanced Configuration

### Custom Route Preferences
```json
{
  "routingOptions": {
    "maxWalkDistance": 800,
    "preferredModes": ["TRAIN", "BUS"],
    "avoidTransfers": false,
    "timePreference": "fastest"
  }
}
```

### Business Hours Configuration
```typescript
{
  "businessHours": {
    "weekdays": { "start": 9, "end": 18 },
    "saturday": { "start": 9, "end": 13 },
    "sunday": { "closed": true }
  }
}
```

## 🤝 API Integration

### OneMap Integration
- **Authentication**: Automatic token refresh with 3-day TTL
- **Geocoding**: High-accuracy address resolution
- **Routing**: Professional-grade turn-by-turn directions
- **Basemaps**: Singapore-optimized mapping data

### LTA DataMall Integration
- **Real-time Data**: Bus arrivals, train status, traffic conditions
- **Transport Network**: Complete bus and train network data
- **Service Alerts**: Live disruption and maintenance notifications

## 🚀 Development

### Local Development
```bash
git clone https://github.com/siva-sub/MCP-Public-Transport
cd MCP-Public-Transport
npm install
cp .env.example .env.local
# Add your API keys to .env.local
npm run dev
```

### Building
```bash
npm run build    # Builds both ESM and CJS versions
npm run test     # Runs comprehensive test suite
npm run lint     # TypeScript and ESLint checks
```

### Testing
```bash
# Unit tests
npm run test

# Integration tests with real APIs
npm run test:integration

# Performance tests
npm run test:performance
```

## 📦 Architecture

```
src/
├── services/           # Core business logic
│   ├── lta.ts         # LTA DataMall integration
│   ├── onemap.ts      # OneMap API with authentication
│   ├── time.ts        # Singapore time intelligence
│   ├── postalCode.ts  # Postal code validation & resolution
│   └── cache.ts       # Intelligent caching layer
├── tools/             # MCP tool implementations
│   ├── location/      # Location intelligence tools
│   ├── bus/           # Bus-related tools
│   ├── train/         # Train service tools
│   ├── routing/       # Journey planning tools
│   └── traffic/       # Traffic and road tools
├── types/             # TypeScript interfaces
│   ├── location.ts    # Location and search types
│   ├── transport.ts   # Transport system types
│   ├── search.ts      # Search and query types
│   └── time.ts        # Singapore time types
└── utils/             # Shared utilities
    ├── errors.ts      # Custom error handling
    ├── logger.ts      # Structured logging
    └── validation.ts  # Input validation
```

## 🌟 What Makes This Special

1. **Singapore-Optimized**: Built specifically for Singapore's unique transport ecosystem
2. **Professional-Grade**: Routing instructions comparable to Google Maps
3. **Real-Time Context**: Business hours, rush hour, and timing intelligence  
4. **High Accuracy**: 95% success rate for postal code resolution
5. **Enterprise-Ready**: Comprehensive error handling and performance optimization
6. **Developer-Friendly**: Full TypeScript support with comprehensive documentation

## 🎯 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Priority Areas
- [ ] Additional transport modes (bike-sharing, e-scooters)
- [ ] Enhanced accessibility features
- [ ] Real-time crowd density integration
- [ ] Multi-language support
- [ ] Historical travel time analysis

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 💡 Creator's Motivation

This project was created by **Siva (Sivasubramanian Ramanathan)** out of curiosity about Model Context Protocol (MCP) and how they can be integrated into modern AI applications. With MCPs being "all the rage" in the AI ecosystem, I wanted to test out the capabilities and see what could be built with this exciting new protocol.

What started as an exploration into MCP integration evolved into a comprehensive Singapore Location Intelligence Platform, demonstrating the power of MCPs to create sophisticated, real-world applications that rival commercial solutions.

## 🙏 Acknowledgments

- **Singapore Land Authority (SLA)** for OneMap API
- **Land Transport Authority (LTA)** for DataMall API
- **Model Context Protocol** for the extensible framework
- **Singapore Open Data** initiative for public transport data

---

**Built with ❤️ for Singapore's smart city initiative and MCP exploration**
