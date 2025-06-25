import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { LTAService } from '../../services/lta.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';

const TrafficConditionsInputSchema = z.object({
  area: z.string().optional(),
  road: z.string().optional(),
  includeIncidents: z.boolean().default(true),
});

export class TrafficConditionsTool extends BaseTool {
  constructor(private ltaService: LTAService) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_traffic_conditions',
        description: 'Get current traffic conditions, incidents, and road speeds',
        inputSchema: this.createSchema({
          area: {
            type: 'string',
            description: 'Specific area (e.g., "CBD", "Orchard", "Airport")',
          },
          road: {
            type: 'string',
            description: 'Specific road/expressway (e.g., "PIE", "CTE", "ECP")',
          },
          includeIncidents: {
            type: 'boolean',
            default: true,
            description: 'Include traffic incidents in response',
          },
        }),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'get_traffic_conditions';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const { area, road, includeIncidents } = validateInput(TrafficConditionsInputSchema, args);
      
      logger.info('Getting traffic conditions', { area, road, includeIncidents });
      
      const incidents = includeIncidents ? await this.ltaService.getTrafficIncidents() : [];
      
      // Filter incidents by area or road if specified
      const filteredIncidents = incidents.filter(incident => {
        if (area && !incident.message.toLowerCase().includes(area.toLowerCase())) {
          return false;
        }
        if (road && !incident.message.toLowerCase().includes(road.toLowerCase())) {
          return false;
        }
        return true;
      });

      const overallCondition = this.assessOverallCondition(filteredIncidents);
      const majorIncidents = filteredIncidents.filter(incident => 
        this.isMajorIncident(incident)
      );

      return {
        overallCondition,
        area: area || 'Island-wide',
        road: road || 'All roads',
        summary: this.createTrafficSummary(overallCondition, filteredIncidents.length),
        majorIncidents: majorIncidents.map(incident => ({
          type: incident.type,
          message: incident.message,
          coordinates: incident.coordinates,
          severity: this.assessIncidentSeverity(incident),
          estimatedDelay: this.estimateDelay(incident),
          alternativeRoutes: this.suggestAlternativeRoutes(incident),
        })),
        allIncidents: filteredIncidents,
        recommendations: this.generateTrafficRecommendations(overallCondition, majorIncidents),
        expresswaySummary: this.getExpresswayStatus(filteredIncidents),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Traffic conditions tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private assessOverallCondition(incidents: any[]): string {
    if (incidents.length === 0) return 'smooth';
    if (incidents.length <= 2) return 'light';
    if (incidents.length <= 5) return 'moderate';
    return 'heavy';
  }

  private isMajorIncident(incident: any): boolean {
    const message = incident.message.toLowerCase();
    return message.includes('accident') || 
           message.includes('breakdown') || 
           message.includes('road closure') ||
           message.includes('flood');
  }

  private assessIncidentSeverity(incident: any): string {
    const message = incident.message.toLowerCase();
    
    if (message.includes('road closure') || message.includes('flood')) {
      return 'severe';
    }
    if (message.includes('accident') || message.includes('breakdown')) {
      return 'moderate';
    }
    return 'minor';
  }

  private estimateDelay(incident: any): string {
    const severity = this.assessIncidentSeverity(incident);
    const message = incident.message.toLowerCase();
    
    if (severity === 'severe') return '30+ minutes';
    if (severity === 'moderate') {
      if (message.includes('lane') && message.includes('blocked')) {
        return '15-30 minutes';
      }
      return '10-20 minutes';
    }
    return '5-10 minutes';
  }

  private suggestAlternativeRoutes(incident: any): string[] {
    const message = incident.message.toLowerCase();
    const alternatives: string[] = [];
    
    // Simple route suggestions based on common expressways
    if (message.includes('pie')) {
      alternatives.push('Consider ECP or CTE as alternatives');
    } else if (message.includes('ecp')) {
      alternatives.push('Consider PIE or Marine Parade Road');
    } else if (message.includes('cte')) {
      alternatives.push('Consider PIE or Thomson Road');
    } else if (message.includes('aye')) {
      alternatives.push('Consider West Coast Highway or Clementi Road');
    }
    
    if (alternatives.length === 0) {
      alternatives.push('Use alternative roads and local routes');
    }
    
    return alternatives;
  }

  private generateTrafficRecommendations(condition: string, majorIncidents: any[]): string[] {
    const recommendations: string[] = [];
    
    switch (condition) {
      case 'smooth':
        recommendations.push('Traffic is flowing smoothly across the network');
        break;
      case 'light':
        recommendations.push('Light traffic conditions - good time to travel');
        break;
      case 'moderate':
        recommendations.push('Moderate traffic with some congestion - allow extra time for your journey');
        recommendations.push('Consider using public transport for city center destinations');
        break;
      case 'heavy':
        recommendations.push('Heavy traffic conditions - significant delays expected');
        recommendations.push('Strongly consider public transport or delay non-essential trips');
        break;
    }
    
    if (majorIncidents.length > 0) {
      recommendations.push(`${majorIncidents.length} major incident${majorIncidents.length > 1 ? 's' : ''} affecting traffic`);
      recommendations.push('Check alternative routes before departing');
    }
    
    // Time-based recommendations
    const hour = new Date().getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20)) {
      recommendations.push('Peak hour traffic - expect longer journey times');
    } else if (hour >= 22 || hour <= 6) {
      recommendations.push('Off-peak hours - generally lighter traffic');
    }
    
    return recommendations;
  }

  private getExpresswayStatus(incidents: any[]): Record<string, any> {
    const expressways = ['PIE', 'ECP', 'CTE', 'AYE', 'BKE', 'KPE', 'SLE', 'TPE'];
    const status: Record<string, any> = {};
    
    expressways.forEach(expressway => {
      const expresswayIncidents = incidents.filter(incident =>
        incident.message.toLowerCase().includes(expressway.toLowerCase())
      );
      
      status[expressway] = {
        condition: expresswayIncidents.length === 0 ? 'clear' : 
                  expresswayIncidents.length <= 1 ? 'light' : 'congested',
        incidents: expresswayIncidents.length,
        majorIssues: expresswayIncidents.filter(incident => this.isMajorIncident(incident)).length,
      };
    });
    
    return status;
  }

  private createTrafficSummary(condition: string, incidentCount: number): string {
    const conditionMap: Record<string, string> = {
      smooth: 'Traffic is flowing smoothly',
      light: 'Light traffic conditions',
      moderate: 'Moderate traffic with some congestion',
      heavy: 'Heavy traffic with significant delays',
    };
    
    const base = conditionMap[condition] || 'Traffic conditions unknown';
    
    if (incidentCount === 0) {
      return `${base} - no incidents reported`;
    } else if (incidentCount === 1) {
      return `${base} - 1 incident reported`;
    } else {
      return `${base} - ${incidentCount} incidents reported`;
    }
  }
}
