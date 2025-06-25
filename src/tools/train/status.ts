import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { LTAService } from '../../services/lta.js';
import { SingaporeTimeService } from '../../services/time.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { TrainServiceAlert } from '../../types/transport.js';

const TrainStatusInputSchema = z.object({
  line: z.enum(['EWL', 'NSL', 'CCL', 'DTL', 'NEL', 'BPL', 'SLRT', 'PLRT', 'TEL']).optional(),
});

export class TrainStatusTool extends BaseTool {
  private timeService: SingaporeTimeService;

  constructor(private ltaService: LTAService) {
    super();
    this.timeService = new SingaporeTimeService();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_train_service_status',
        description: 'Check current train service status and any disruptions',
        inputSchema: this.createSchema({
          line: {
            type: 'string',
            enum: ['EWL', 'NSL', 'CCL', 'DTL', 'NEL', 'BPL', 'SLRT', 'PLRT', 'TEL'],
            description: 'Specific train line to check (optional)',
          },
        }),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'get_train_service_status';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const { line } = validateInput(TrainStatusInputSchema, args);
      
      logger.info('Getting train service status', { line });
      
      const alerts = await this.ltaService.getTrainServiceAlerts();
      
      // Filter by line if specified
      const filteredAlerts = line 
        ? alerts.filter(alert => alert.line === line)
        : alerts;

      const allLines = ['EWL', 'NSL', 'CCL', 'DTL', 'NEL', 'BPL', 'SLRT', 'PLRT', 'TEL'];
      const affectedLines = new Set(alerts.map(alert => alert.line));
      const normalLines = allLines.filter(l => !affectedLines.has(l));

      const overallStatus = alerts.length === 0 ? 'normal' : 
                           alerts.length < 3 ? 'minor_disruptions' : 'major_disruptions';

      // Get Singapore time context
      const timeContext = this.timeService.getCurrentTime();
      const operatingStatus = this.getOperatingStatus(timeContext);

      return {
        overallStatus,
        summary: this.createStatusSummary(alerts, operatingStatus),
        disruptions: filteredAlerts,
        affectedLines: Array.from(affectedLines),
        normalLines,
        recommendations: this.generateRecommendations(alerts, operatingStatus),
        singaporeTime: timeContext.formatted.full,
        operatingHours: operatingStatus,
        timestamp: timeContext.datetime,
      };
    } catch (error) {
      logger.error(`Train status tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private getOperatingStatus(timeContext: any): { status: string; description: string } {
    const hour = new Date(timeContext.datetime).getHours();
    
    // MRT/LRT typically operates from 5:30 AM to midnight/1 AM
    if (hour >= 6 && hour < 24) {
      return {
        status: 'operating',
        description: 'All train services are within normal operating hours (6:00 AM - 12:00 AM)'
      };
    } else if (hour >= 0 && hour < 6) {
      return {
        status: 'limited',
        description: 'Train services are currently not operating (Normal hours: 6:00 AM - 12:00 AM)'
      };
    } else {
      return {
        status: 'limited', 
        description: 'Train services may be ending soon (Last trains around 12:00 AM - 1:00 AM)'
      };
    }
  }

  private createStatusSummary(alerts: TrainServiceAlert[], operatingStatus?: any): string {
    if (!operatingStatus || operatingStatus.status !== 'operating') {
      return operatingStatus?.description || 'Train services are not currently operating';
    }

    if (alerts.length === 0) {
      return 'All train services are operating normally';
    }

    const lineCount = new Set(alerts.map(alert => alert.line)).size;
    return `${lineCount} line${lineCount > 1 ? 's' : ''} experiencing disruptions`;
  }

  private generateRecommendations(alerts: TrainServiceAlert[], operatingStatus?: any): string[] {
    const recommendations: string[] = [];

    if (alerts.length === 0) {
      recommendations.push('No service recommendations needed - all lines operating normally');
      return recommendations;
    }

    // Group alerts by line
    const alertsByLine = alerts.reduce((acc, alert) => {
      if (!acc[alert.line]) {
        acc[alert.line] = [];
      }
      acc[alert.line].push(alert);
      return acc;
    }, {} as Record<string, TrainServiceAlert[]>);

    for (const [line, lineAlerts] of Object.entries(alertsByLine)) {
      const hasShuttle = lineAlerts.some(alert => alert.shuttleService);
      const hasFreeBus = lineAlerts.some(alert => alert.alternativeTransport);

      if (hasShuttle) {
        recommendations.push(`${line}: Free shuttle service available`);
      }
      if (hasFreeBus) {
        recommendations.push(`${line}: Free bus service operating`);
      }
      
      // Suggest alternative lines
      const alternatives = this.getAlternativeLines(line);
      if (alternatives.length > 0) {
        recommendations.push(`${line}: Consider using ${alternatives.join(' or ')} as alternatives`);
      }
    }

    return recommendations;
  }

  private getAlternativeLines(affectedLine: string): string[] {
    const alternatives: Record<string, string[]> = {
      'EWL': ['NSL', 'CCL'],
      'NSL': ['EWL', 'NEL'],
      'CCL': ['EWL', 'NSL'],
      'DTL': ['NEL', 'CCL'],
      'NEL': ['NSL', 'DTL'],
      'TEL': ['NSL', 'CCL'],
    };

    return alternatives[affectedLine] || [];
  }
}
