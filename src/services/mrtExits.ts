/**
 * MRT Exit Service
 * Provides MRT station exit information for precise navigation
 */

import axios from 'axios';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { APIError } from '../utils/errors.js';

export interface MRTExit {
  stationName: string;
  exitCode: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  distance?: number;
}

export interface MRTExitRecommendation {
  stationName: string;
  recommendedExit: MRTExit;
  alternativeExits: MRTExit[];
  walkingDistance: number;
  walkingTime: number;
  reason: string;
}

export class MRTExitService {
  private mrtExitData: MRTExit[] = [];
  private dataLoaded = false;

  constructor(private cache: CacheService) {}

  /**
   * Load MRT exit data from Singapore's open data
   */
  async loadMRTExitData(): Promise<void> {
    if (this.dataLoaded) return;

    const cacheKey = 'mrt_exit_data';
    
    try {
      this.mrtExitData = await this.cache.getOrSet(cacheKey, async () => {
        logger.info('Loading MRT exit data from Singapore Open Data');
        
        const datasetId = 'd_b39d3a0871985372d7e1637193335da5';
        const pollUrl = `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`;
        
        // Get download URL
        const pollResponse = await axios.get(pollUrl);
        if (pollResponse.data.code !== 0) {
          throw new Error(pollResponse.data.errMsg || 'Failed to get MRT data URL');
        }
        
        const downloadUrl = pollResponse.data.data.url;
        
        // Download the actual data
        const dataResponse = await axios.get(downloadUrl);
        const geoJsonData = dataResponse.data;
        
        // Parse GeoJSON features into MRT exit data
        const exits: MRTExit[] = [];
        
        for (const feature of geoJsonData.features) {
          const description = feature.properties.Description;
          const coordinates = feature.geometry.coordinates;
          
          // Parse station name and exit code from description HTML
          const stationMatch = description.match(/<th>STATION_NA<\/th>\s*<td>([^<]+)<\/td>/);
          const exitMatch = description.match(/<th>EXIT_CODE<\/th>\s*<td>([^<]+)<\/td>/);
          
          if (stationMatch && exitMatch && coordinates) {
            exits.push({
              stationName: stationMatch[1].trim(),
              exitCode: exitMatch[1].trim(),
              coordinates: {
                latitude: coordinates[1],
                longitude: coordinates[0],
              },
            });
          }
        }
        
        logger.info(`Loaded ${exits.length} MRT exits`);
        return exits;
      }, 86400); // Cache for 24 hours
      
      this.dataLoaded = true;
    } catch (error) {
      logger.error('Failed to load MRT exit data', error);
      throw new APIError('Failed to load MRT exit data', 'MRT_DATA_ERROR', 500);
    }
  }

  /**
   * Find the best MRT exit for a destination
   */
  async findBestMRTExit(
    stationName: string,
    destinationLat: number,
    destinationLng: number
  ): Promise<MRTExitRecommendation | null> {
    await this.loadMRTExitData();
    
    // Normalize station name for matching
    const normalizedStationName = this.normalizeStationName(stationName);
    
    // Find all exits for this station
    const stationExits = this.mrtExitData.filter(exit => 
      this.normalizeStationName(exit.stationName) === normalizedStationName
    );
    
    if (stationExits.length === 0) {
      logger.warn(`No exits found for station: ${stationName}`);
      return null;
    }
    
    // Calculate distances to destination for each exit
    const exitsWithDistance = stationExits.map(exit => ({
      ...exit,
      distance: this.calculateDistance(
        exit.coordinates.latitude,
        exit.coordinates.longitude,
        destinationLat,
        destinationLng
      ),
    }));
    
    // Sort by distance (closest first)
    exitsWithDistance.sort((a, b) => a.distance - b.distance);
    
    const bestExit = exitsWithDistance[0];
    const alternativeExits = exitsWithDistance.slice(1, 4); // Up to 3 alternatives
    
    const walkingDistance = Math.round(bestExit.distance);
    const walkingTime = Math.ceil(walkingDistance / 80); // ~80m per minute walking speed
    
    return {
      stationName: bestExit.stationName,
      recommendedExit: bestExit,
      alternativeExits,
      walkingDistance,
      walkingTime,
      reason: this.generateExitReason(bestExit, alternativeExits),
    };
  }

  /**
   * Get all exits for a specific station
   */
  async getStationExits(stationName: string): Promise<MRTExit[]> {
    await this.loadMRTExitData();
    
    const normalizedStationName = this.normalizeStationName(stationName);
    
    return this.mrtExitData.filter(exit => 
      this.normalizeStationName(exit.stationName) === normalizedStationName
    );
  }

  /**
   * Find nearby MRT exits within a radius
   */
  async findNearbyMRTExits(
    latitude: number,
    longitude: number,
    radiusMeters: number = 500
  ): Promise<MRTExit[]> {
    await this.loadMRTExitData();
    
    const nearbyExits = this.mrtExitData
      .map(exit => ({
        ...exit,
        distance: this.calculateDistance(
          exit.coordinates.latitude,
          exit.coordinates.longitude,
          latitude,
          longitude
        ),
      }))
      .filter(exit => exit.distance <= radiusMeters)
      .sort((a, b) => a.distance - b.distance);
    
    return nearbyExits;
  }

  private normalizeStationName(stationName: string): string {
    return stationName
      .toUpperCase()
      .replace(/\s+MRT\s+STATION$/i, '')
      .replace(/\s+STATION$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  private generateExitReason(bestExit: MRTExit & { distance: number }, alternatives: (MRTExit & { distance: number })[]): string {
    if (alternatives.length === 0) {
      return `${bestExit.exitCode} is the only available exit`;
    }
    
    const distanceDiff = alternatives[0].distance - bestExit.distance;
    
    if (distanceDiff < 50) {
      return `${bestExit.exitCode} is marginally closer than other exits`;
    } else if (distanceDiff < 100) {
      return `${bestExit.exitCode} is the closest exit, saving about ${Math.round(distanceDiff)}m of walking`;
    } else {
      return `${bestExit.exitCode} is significantly closer, saving over ${Math.round(distanceDiff)}m compared to other exits`;
    }
  }
}
