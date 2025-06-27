/**
 * Instruction parsing service for OneMap routing responses
 */

export interface ParsedInstruction {
  step: number;
  type: 'direct' | 'transit' | 'transit_walk';
  mode: 'WALK' | 'BUS' | 'TRAIN' | 'SUBWAY' | 'TAXI';
  direction?: string;
  streetName?: string;
  distance: number;
  duration?: number;
  coordinates: { lat: number; lng: number } | null;
  instruction: string;
  
  // Additional details for different instruction types
  service?: string;
  operator?: string;
  from?: {
    name: string;
    stopCode?: string;
    coordinates: { lat: number; lng: number };
  };
  to?: {
    name: string;
    stopCode?: string;
    coordinates: { lat: number; lng: number };
  };
  intermediateStops?: Array<{
    name: string;
    stopCode?: string;
    coordinates: { lat: number; lng: number };
  }>;
  
  // Context enhancement
  estimatedContext?: {
    area: string;
    timeOfDay: string;
    weatherNote: string;
    landmark?: string;
    safetyNote?: string;
    accessibilityInfo?: string;
  };
}

export interface RouteSummary {
  responseType: 'PUBLIC_TRANSPORT' | 'DIRECT_ROUTING' | 'ERROR';
  totalTime?: number;
  totalDistance?: number;
  totalCost?: number;
  walkDistance?: number;
  transfers?: number;
  fare?: string;
  instructionCount: number;
  polylineCount: number;
}

export class InstructionParserService {
  /**
   * Parse instructions from OneMap response
   */
  parseInstructions(response: any): ParsedInstruction[] {
    const responseType = this.getResponseType(response);
    
    switch (responseType) {
      case 'DIRECT_ROUTING':
        return this.parseDirectInstructions(response);
      case 'PUBLIC_TRANSPORT':
        return this.parseTransitInstructions(response);
      default:
        return [];
    }
  }

  /**
   * Parse direct routing instructions (walk/drive/cycle)
   */
  private parseDirectInstructions(response: any): ParsedInstruction[] {
    if (!response.route_instructions) return [];
    
    return response.route_instructions.map((inst: any[], index: number) => ({
      step: index + 1,
      type: 'direct' as const,
      mode: this.mapDirectMode(inst[8]),
      direction: inst[0],
      streetName: inst[1],
      distance: inst[2],
      coordinates: this.parseCoordinates(inst[3]),
      duration: inst[4],
      instruction: inst[9] || `${inst[0]} for ${inst[5]}`,
      estimatedContext: this.generateBasicContext(this.parseCoordinates(inst[3]))
    }));
  }

  /**
   * Parse public transport instructions
   */
  private parseTransitInstructions(response: any): ParsedInstruction[] {
    if (!response.plan?.itineraries?.[0]?.legs) return [];
    
    const instructions: ParsedInstruction[] = [];
    let stepCounter = 1;
    
    response.plan.itineraries[0].legs.forEach((leg: any) => {
      if (leg.mode === 'WALK') {
        // Walking segment
        if (leg.steps && leg.steps.length > 0) {
          leg.steps.forEach((step: any) => {
            instructions.push({
              step: stepCounter++,
              type: 'transit_walk',
              mode: 'WALK',
              direction: step.relativeDirection,
              streetName: step.streetName,
              distance: step.distance,
              coordinates: { lat: step.lat, lng: step.lon },
              instruction: `${step.relativeDirection} on ${step.streetName} for ${step.distance}m`,
              estimatedContext: this.generateBasicContext({ lat: step.lat, lng: step.lon })
            });
          });
        } else {
          instructions.push({
            step: stepCounter++,
            type: 'transit_walk',
            mode: 'WALK',
            distance: leg.distance,
            duration: leg.duration,
            coordinates: { lat: leg.from.lat, lng: leg.from.lon },
            instruction: `Walk ${Math.round(leg.distance)}m to ${leg.to.name}`,
            estimatedContext: this.generateBasicContext({ lat: leg.from.lat, lng: leg.from.lon })
          });
        }
      } else {
        // Transit segment (BUS, RAIL, etc.)
        instructions.push({
          step: stepCounter++,
          type: 'transit',
          mode: this.mapTransitMode(leg.mode),
          service: leg.routeShortName || leg.route,
          operator: leg.agencyName,
          distance: leg.distance,
          duration: leg.duration,
          coordinates: { lat: leg.from.lat, lng: leg.from.lon },
          instruction: `Take ${leg.routeShortName || leg.route} from ${leg.from.name} to ${leg.to.name}`,
          from: {
            name: leg.from.name,
            stopCode: leg.from.stopCode,
            coordinates: { lat: leg.from.lat, lng: leg.from.lon }
          },
          to: {
            name: leg.to.name,
            stopCode: leg.to.stopCode,
            coordinates: { lat: leg.to.lat, lng: leg.to.lon }
          },
          intermediateStops: leg.intermediateStops?.map((stop: any) => ({
            name: stop.name,
            stopCode: stop.stopCode,
            coordinates: { lat: stop.lat, lng: stop.lon }
          })),
          estimatedContext: this.generateBasicContext({ lat: leg.from.lat, lng: leg.from.lon })
        });
      }
    });
    
    return instructions;
  }

  /**
   * Generate route summary
   */
  generateSummary(response: any, instructions: ParsedInstruction[], polylineCount: number): RouteSummary {
    const summary: RouteSummary = {
      responseType: this.getResponseType(response),
      instructionCount: instructions.length,
      polylineCount
    };
    
    if (response.route_summary) {
      summary.totalTime = response.route_summary.total_time;
      summary.totalDistance = response.route_summary.total_distance;
    }
    
    if (response.plan?.itineraries?.[0]) {
      const itinerary = response.plan.itineraries[0];
      summary.totalTime = itinerary.duration;
      summary.walkDistance = itinerary.walkDistance;
      summary.transfers = itinerary.transfers;
      summary.fare = itinerary.fare;
      summary.totalCost = parseFloat(itinerary.fare) || 0;
    }
    
    return summary;
  }

  /**
   * Enhance instructions with contextual information
   */
  enhanceInstructions(instructions: ParsedInstruction[]): ParsedInstruction[] {
    return instructions.map(instruction => ({
      ...instruction,
      estimatedContext: {
        area: instruction.estimatedContext?.area || 'Unknown',
        timeOfDay: instruction.estimatedContext?.timeOfDay || this.getCurrentTimeContext(),
        weatherNote: instruction.estimatedContext?.weatherNote || 'Check weather conditions for outdoor segments',
        landmark: this.findNearbyLandmark(instruction.coordinates),
        safetyNote: this.getSafetyNote(instruction.coordinates),
        accessibilityInfo: this.getAccessibilityInfo(instruction.coordinates)
      }
    }));
  }

  /**
   * Format instructions for human reading
   */
  formatInstructionsForDisplay(instructions: ParsedInstruction[]): string[] {
    return instructions.map(inst => {
      let formatted = `Step ${inst.step}: ${inst.instruction}`;
      
      if (inst.duration) {
        const minutes = Math.round(inst.duration / 60);
        const seconds = inst.duration % 60;
        formatted += ` (${minutes > 0 ? `${minutes}min ` : ''}${seconds}s)`;
      }
      
      if (inst.service && inst.operator) {
        formatted += ` [${inst.service} - ${inst.operator}]`;
      }
      
      if (inst.estimatedContext?.area) {
        formatted += ` - ${inst.estimatedContext.area}`;
      }
      
      return formatted;
    });
  }

  /**
   * Helper methods
   */
  private getResponseType(response: any): 'PUBLIC_TRANSPORT' | 'DIRECT_ROUTING' | 'ERROR' {
    if (!response) return 'ERROR';
    if (response.plan?.itineraries) return 'PUBLIC_TRANSPORT';
    if (response.route_instructions) return 'DIRECT_ROUTING';
    return 'ERROR';
  }

  private parseCoordinates(coordString: string): { lat: number; lng: number } | null {
    if (!coordString) return null;
    const [lat, lng] = coordString.split(',').map(parseFloat);
    return { lat, lng };
  }

  private mapDirectMode(apiMode: string): 'WALK' | 'TAXI' {
    switch (apiMode?.toLowerCase()) {
      case 'walking':
        return 'WALK';
      case 'driving':
        return 'TAXI';
      default:
        return 'WALK';
    }
  }

  private mapTransitMode(apiMode: string): 'WALK' | 'BUS' | 'TRAIN' | 'SUBWAY' {
    switch (apiMode.toUpperCase()) {
      case 'WALK':
        return 'WALK';
      case 'BUS':
        return 'BUS';
      case 'RAIL':
      case 'SUBWAY':
        return 'SUBWAY';
      default:
        return 'WALK';
    }
  }

  private generateBasicContext(coordinates: { lat: number; lng: number } | null) {
    if (!coordinates) {
      return {
        area: 'Unknown',
        timeOfDay: this.getCurrentTimeContext(),
        weatherNote: 'Check weather conditions for outdoor segments'
      };
    }

    return {
      area: this.getAreaFromCoordinates(coordinates),
      timeOfDay: this.getCurrentTimeContext(),
      weatherNote: 'Check weather conditions for outdoor segments'
    };
  }

  private getAreaFromCoordinates(coordinates: { lat: number; lng: number }): string {
    const { lat, lng } = coordinates;
    
    if (lat >= 1.38 && lat <= 1.45 && lng >= 103.89 && lng <= 103.95) return 'Punggol/Sengkang';
    if (lat >= 1.31 && lat <= 1.33 && lng >= 103.84 && lng <= 103.86) return 'Novena/Toa Payoh';
    if (lat >= 1.27 && lat <= 1.29 && lng >= 103.84 && lng <= 103.86) return 'Chinatown/CBD';
    if (lat >= 1.29 && lat <= 1.31 && lng >= 103.77 && lng <= 103.79) return 'Jurong';
    if (lat >= 1.30 && lat <= 1.32 && lng >= 103.81 && lng <= 103.83) return 'Orchard/Somerset';
    
    return 'Singapore';
  }

  private getCurrentTimeContext(): string {
    const hour = new Date().getHours();
    if (hour >= 7 && hour <= 9) return 'Morning Peak';
    if (hour >= 17 && hour <= 19) return 'Evening Peak';
    if (hour >= 23 || hour <= 5) return 'Late Night';
    return 'Off Peak';
  }

  private findNearbyLandmark(coordinates: { lat: number; lng: number } | null): string {
    if (!coordinates) return '';
    
    // This would be enhanced with actual landmark data
    const area = this.getAreaFromCoordinates(coordinates);
    switch (area) {
      case 'Punggol/Sengkang':
        return 'Near Punggol Waterway';
      case 'Novena/Toa Payoh':
        return 'Near Novena Medical Hub';
      case 'Chinatown/CBD':
        return 'Near Marina Bay';
      case 'Orchard/Somerset':
        return 'Near Orchard Road Shopping';
      default:
        return '';
    }
  }

  private getSafetyNote(coordinates: { lat: number; lng: number } | null): string {
    if (!coordinates) return '';
    
    const hour = new Date().getHours();
    if (hour >= 22 || hour <= 6) {
      return 'Well-lit area recommended for night travel';
    }
    
    return 'Safe area for travel';
  }

  private getAccessibilityInfo(coordinates: { lat: number; lng: number } | null): string {
    if (!coordinates) return '';
    
    // This would be enhanced with actual accessibility data
    return 'Check for wheelchair accessibility at transit stops';
  }
}
