import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { LTAService } from '../../services/lta.js';
import { validateInput, BusStopCodeSchema } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';

const BusArrivalInputSchema = z.object({
  busStopCode: BusStopCodeSchema,
  serviceNo: z.string().optional(),
  format: z.enum(['detailed', 'user_friendly']).default('detailed'),
});

export class BusArrivalTool extends BaseTool {
  constructor(private ltaService: LTAService) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_bus_arrival',
        description: 'Get real-time bus arrival times and information for a specific bus stop',
        inputSchema: this.createSchema({
          busStopCode: {
            type: 'string',
            description: '5-digit bus stop code (e.g., "83139")',
            pattern: '^[0-9]{5}$',
          },
          serviceNo: {
            type: 'string',
            description: 'Optional specific bus service number (e.g., "15")',
          },
          format: {
            type: 'string',
            enum: ['detailed', 'user_friendly'],
            default: 'detailed',
            description: 'Response format preference',
          },
        }, ['busStopCode']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'get_bus_arrival';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const { busStopCode, serviceNo, format } = validateInput(BusArrivalInputSchema, args);
      
      logger.info(`Getting bus arrivals for stop ${busStopCode}`, { serviceNo, format });
      
      const services = await this.ltaService.getBusArrival(busStopCode, serviceNo);
      
      if (format === 'user_friendly') {
        return this.formatUserFriendly(services, busStopCode);
      }
      
      return {
        busStopCode,
        services,
        totalServices: services.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Bus arrival tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private formatUserFriendly(services: any[], busStopCode: string) {
    if (services.length === 0) {
      return {
        message: `No buses arriving soon at stop ${busStopCode}`,
        busStopCode,
        timestamp: new Date().toISOString(),
      };
    }

    const summaries = services.map(service => {
      const nextBus = service.nextBuses[0];
      if (!nextBus) return null;
      
      const timeMsg = nextBus.minutesAway === 0 
        ? 'Arriving now'
        : nextBus.minutesAway === 1
        ? '1 minute'
        : `${nextBus.minutesAway} minutes`;
        
      const wheelchairIcon = nextBus.wheelchairAccessible ? ' ♿' : '';
      
      return `Bus ${service.serviceNo}: ${timeMsg} (${nextBus.loadDescription})${wheelchairIcon}`;
    }).filter(Boolean);

    return {
      busStopCode,
      summary: summaries.join(' • '),
      nextArrivals: summaries,
      services,
      timestamp: new Date().toISOString(),
    };
  }
}
