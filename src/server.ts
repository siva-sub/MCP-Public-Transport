import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { LTAService } from './services/lta.js';
import { OneMapService } from './services/onemap.js';
import { CacheService } from './services/cache.js';
import { Config } from './config/environment.js';
import { logger } from './utils/logger.js';
import { TransportError } from './utils/errors.js';

// Import all tools
import { BusArrivalTool } from './tools/bus/arrival.js';
import { BusStopsTool } from './tools/bus/stops.js';
import { TrainStatusTool } from './tools/train/status.js';
import { JourneyPlanningTool } from './tools/routing/journey.js';
import { TaxiAvailabilityTool } from './tools/taxi/availability.js';
import { LocationSearchTool } from './tools/location/search.js';

// Import enhanced services
import { PostalCodeService } from './services/postalCode.js';
import { SingaporeTimeService } from './services/time.js';

export class SingaporeTransportServer {
  private ltaService: LTAService;
  private oneMapService: OneMapService;
  private cacheService: CacheService;
  private tools: any[] = [];

  constructor(private config: Config) {
    this.cacheService = new CacheService(config.cacheDuration);
    this.ltaService = new LTAService(
      config.ltaAccountKey,
      this.cacheService,
      config.requestTimeout
    );
    this.oneMapService = new OneMapService(
      config.oneMapToken,
      config.oneMapEmail,
      config.oneMapPassword,
      this.cacheService,
      config.requestTimeout
    );
  }

  async setupTools(server: Server): Promise<void> {
    // Initialize enhanced services
    const postalCodeService = new PostalCodeService(this.oneMapService, this.cacheService);
    const timeService = new SingaporeTimeService();

    // Initialize all tools
    this.tools = [
      new BusArrivalTool(this.ltaService),
      new BusStopsTool(this.ltaService, this.oneMapService),
      new TrainStatusTool(this.ltaService),
      new JourneyPlanningTool(this.oneMapService, this.ltaService),
      new TaxiAvailabilityTool(this.ltaService, this.oneMapService),
      new LocationSearchTool(this.oneMapService, postalCodeService, timeService),
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
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
