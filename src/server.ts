const { Server } = require('@modelcontextprotocol/sdk/server/index');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types');

const { LTAService } = require('./services/lta');
const { OneMapService } = require('./services/onemap');
const { CacheService } = require('./services/cache');
const { Config } = require('./config/environment');
const { logger } = require('./utils/logger');
const { TransportError } = require('./utils/errors');

// Import all tools
const { BusArrivalTool } = require('./tools/bus/arrival');
const { BusStopsTool } = require('./tools/bus/stops');
const { TrainStatusTool } = require('./tools/train/status');
const { JourneyPlanningTool } = require('./tools/routing/journey');
const { TaxiAvailabilityTool } = require('./tools/taxi/availability');

class SingaporeTransportServer {
  private ltaService: any;
  private oneMapService: any;
  private cacheService: any;
  private tools: any[] = [];

  constructor(private config: any) {
    this.cacheService = new CacheService(config.cacheDuration);
    this.ltaService = new LTAService(
      config.ltaAccountKey,
      this.cacheService,
      config.requestTimeout
    );
    this.oneMapService = new OneMapService(
      config.oneMapToken,
      this.cacheService,
      config.requestTimeout
    );
  }

  async setupTools(server: any): Promise<void> {
    // Initialize all tools
    this.tools = [
      new BusArrivalTool(this.ltaService),
      new BusStopsTool(this.ltaService, this.oneMapService),
      new TrainStatusTool(this.ltaService),
      new JourneyPlanningTool(this.oneMapService, this.ltaService),
      new TaxiAvailabilityTool(this.ltaService, this.oneMapService),
    ];

    // Get all tool definitions
    const toolDefinitions = this.tools.flatMap(tool => tool.getDefinitions());
    
    // Set up tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing available tools');
      return {
        tools: toolDefinitions,
      };
    });

    // Set up tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;
      
      try {
        logger.info(`Executing tool: ${name}`, { 
          arguments: args ? Object.keys(args) : [],
        });
        
        // Find and execute the appropriate tool
        for (const tool of this.tools) {
          if (tool.canHandle(name)) {
            const startTime = Date.now();
            const result = await tool.execute(name, args || {});
            const duration = Date.now() - startTime;
            
            logger.info(`Tool executed successfully: ${name}`, {
              duration: `${duration}ms`,
              hasError: !!result.error,
            });
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }
        }
        
        throw new TransportError(`Unknown tool: ${name}`, 'TOOL_NOT_FOUND');
        
      } catch (error) {
        logger.error(`Tool execution failed: ${name}`, error);
        
        if (error instanceof TransportError) {
          throw error;
        }
        
        throw new TransportError(
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'TOOL_EXECUTION_ERROR'
        );
      }
    });

    logger.info(`Singapore Transport MCP Server initialized with ${toolDefinitions.length} tools`);
  }

  async healthCheck(): Promise<any> {
    const checks = {
      lta_api: false,
      onemap_api: false,
      cache: false,
    };

    try {
      // Test LTA API
      await this.ltaService.getBusStops(0, 1);
      checks.lta_api = true;
    } catch (error) {
      logger.warn('LTA API health check failed', error);
    }

    try {
      // Test OneMap API
      await this.oneMapService.geocode('Singapore');
      checks.onemap_api = true;
    } catch (error) {
      logger.warn('OneMap API health check failed', error);
    }

    // Test cache
    try {
      const testKey = 'health_check_test';
      const testValue = { status: 'ok' };
      this.cacheService.set(testKey, testValue, 10);
      const retrievedValue = this.cacheService.get<{ status: string }>(testKey);
      if (retrievedValue?.status === 'ok') {
        checks.cache = true;
      }
      this.cacheService.del(testKey);
    } catch (error) {
      logger.warn('Cache health check failed', error);
    }

    const isHealthy = Object.values(checks).every(Boolean);

    return {
      status: isHealthy ? 'healthy' : 'degraded',
      checks,
      cache_stats: this.cacheService.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { SingaporeTransportServer };
