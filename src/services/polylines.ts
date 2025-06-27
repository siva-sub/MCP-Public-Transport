import polyline from '@mapbox/polyline';

/**
 * Polyline processing service for route geometry handling
 */

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

export interface DecodedPolyline {
  coordinates: Array<[number, number]>; // [lng, lat] format for GeoJSON
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface PolylineData {
  encoded: string;
  decoded: DecodedPolyline;
  geojson: GeoJSONLineString;
  coordinateCount: number;
}

export class PolylineService {
  /**
   * Decode a polyline string to coordinates
   */
  decode(encoded: string): DecodedPolyline {
    const decodedCoordinates: [number, number][] = polyline.decode(encoded);
    
    // Convert to [lng, lat] format for GeoJSON and calculate bounds
    const coordinates: Array<[number, number]> = decodedCoordinates.map(coord => [coord[1], coord[0]]);
    const bounds = this.calculateBounds(coordinates);
    
    return {
      coordinates,
      bounds
    };
  }

  /**
   * Process polyline data from OneMap response
   */
  processPolylines(response: any): PolylineData[] {
    const polylines: PolylineData[] = [];
    
    // Handle direct routing polyline
    if (response.route_geometry) {
      const decoded = this.decode(response.route_geometry);
      polylines.push({
        encoded: response.route_geometry,
        decoded,
        geojson: this.createGeoJSON(decoded.coordinates),
        coordinateCount: decoded.coordinates.length
      });
    }
    
    // Handle transit leg polylines
    if (response.plan?.itineraries?.[0]?.legs) {
      response.plan.itineraries[0].legs.forEach((leg: any, index: number) => {
        if (leg.legGeometry?.points) {
          const decoded = this.decode(leg.legGeometry.points);
          polylines.push({
            encoded: leg.legGeometry.points,
            decoded,
            geojson: this.createGeoJSON(decoded.coordinates),
            coordinateCount: decoded.coordinates.length
          });
        }
      });
    }
    
    return polylines;
  }

  /**
   * Create GeoJSON LineString from coordinates
   */
  private createGeoJSON(coordinates: Array<[number, number]>): GeoJSONLineString {
    return {
      type: 'LineString',
      coordinates
    };
  }

  /**
   * Calculate bounding box for coordinates
   */
  private calculateBounds(coordinates: Array<[number, number]>) {
    if (coordinates.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = coordinates[0][1];
    let south = coordinates[0][1];
    let east = coordinates[0][0];
    let west = coordinates[0][0];

    coordinates.forEach(([lng, lat]) => {
      north = Math.max(north, lat);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      west = Math.min(west, lng);
    });

    return { north, south, east, west };
  }

  /**
   * Estimate coordinate count from encoded polyline
   */
  estimateCoordinateCount(encoded: string): number {
    return Math.floor(encoded.length / 10);
  }

  /**
   * Create step markers for instructions
   */
  createStepMarkers(instructions: any[]): Array<{
    step: number;
    coordinates: [number, number];
    instruction: string;
  }> {
    return instructions
      .filter(inst => inst.coordinates)
      .map(inst => ({
        step: inst.step,
        coordinates: [inst.coordinates.lng, inst.coordinates.lat],
        instruction: inst.instruction
      }));
  }
}
