/**
 * OneMap Themes Service
 * Provides access to Singapore's thematic layers including landmarks, facilities, and points of interest
 */

import { OneMapService } from './onemap.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';

export interface ThemeInfo {
  themeName: string;
  queryName: string;
  icon?: string;
  expiryDate?: string;
  publishedDate?: string;
  category: string;
  themeOwner: string;
}

export interface ThemeFeature {
  name: string;
  description: string;
  hyperlink?: string;
  category: string;
  owner: string;
  coordinates: [number, number];
  properties: Record<string, any>;
  iconName?: string;
  distance?: number;
}

export interface ThemeSearchResult {
  theme: ThemeInfo;
  features: ThemeFeature[];
  totalCount: number;
  searchArea?: {
    center: [number, number];
    radius: number;
  };
}

export class ThemesService {
  private readonly CACHE_DURATION = {
    THEMES_LIST: 86400, // 24 hours - themes don't change often
    THEME_DATA: 3600,   // 1 hour - theme data can be updated
    THEME_STATUS: 300,  // 5 minutes - status checks
  };

  constructor(
    private oneMapService: OneMapService,
    private cacheService: CacheService
  ) {}

  /**
   * Get all available themes from OneMap
   */
  async getAllThemes(): Promise<ThemeInfo[]> {
    const cacheKey = 'onemap_all_themes';
    
    const cachedThemes = this.cacheService.get<ThemeInfo[]>(cacheKey);
    if (cachedThemes) {
      return cachedThemes;
    }

    try {
      const token = await this.oneMapService.ensureValidToken();
      const response = await this.oneMapService['client'].get('/api/public/themesvc/getAllThemesInfo', {
        params: { moreInfo: 'Y' },
        headers: { 'Authorization': token }
      });

      const themes: ThemeInfo[] = (response.data.Theme_Names || []).map((theme: any) => ({
        themeName: theme.THEMENAME,
        queryName: theme.QUERYNAME,
        icon: theme.ICON,
        expiryDate: theme.EXPIRY_DATE,
        publishedDate: theme.PUBLISHED_DATE,
        category: theme.CATEGORY,
        themeOwner: theme.THEME_OWNER
      }));

      this.cacheService.set(cacheKey, themes, this.CACHE_DURATION.THEMES_LIST);
      return themes;
    } catch (error) {
      logger.error('Failed to get all themes', error);
      throw error;
    }
  }

  /**
   * Search for landmarks and facilities near a location
   */
  async findLandmarksNear(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    categories?: string[]
  ): Promise<ThemeSearchResult[]> {
    try {
      // Get all available themes
      const allThemes = await this.getAllThemes();
      
      // Filter themes by category if specified
      const relevantThemes = categories 
        ? allThemes.filter(theme => 
            categories.some(cat => 
              theme.category.toLowerCase().includes(cat.toLowerCase())
            )
          )
        : allThemes.filter(theme => 
            // Focus on landmark and facility categories
            ['education', 'health', 'community', 'recreation', 'transport', 'shopping', 'tourism'].some(cat =>
              theme.category.toLowerCase().includes(cat)
            )
          );

      // Calculate search extents based on radius
      const extents = this.calculateExtents(latitude, longitude, radius);
      
      // Search each relevant theme
      const searchPromises = relevantThemes.slice(0, 10).map(theme => // Limit to prevent API overload
        this.searchThemeInArea(theme, extents, latitude, longitude, radius)
      );

      const results = await Promise.allSettled(searchPromises);
      
      return results
        .filter((result): result is PromiseFulfilledResult<ThemeSearchResult> => 
          result.status === 'fulfilled' && result.value.features.length > 0
        )
        .map(result => result.value)
        .sort((a, b) => b.features.length - a.features.length); // Sort by number of features

    } catch (error) {
      logger.error('Failed to find landmarks near location', error);
      throw error;
    }
  }

  /**
   * Search for specific types of facilities (e.g., schools, hospitals, parks)
   */
  async findFacilitiesByType(
    facilityType: string,
    latitude?: number,
    longitude?: number,
    radius: number = 2000
  ): Promise<ThemeSearchResult[]> {
    try {
      const allThemes = await this.getAllThemes();
      
      // Find themes that match the facility type
      const matchingThemes = allThemes.filter(theme =>
        theme.themeName.toLowerCase().includes(facilityType.toLowerCase()) ||
        theme.category.toLowerCase().includes(facilityType.toLowerCase()) ||
        theme.queryName.toLowerCase().includes(facilityType.toLowerCase())
      );

      if (matchingThemes.length === 0) {
        logger.warn(`No themes found for facility type: ${facilityType}`);
        return [];
      }

      let extents: string | undefined;
      if (latitude && longitude) {
        extents = this.calculateExtents(latitude, longitude, radius);
      }

      const searchPromises = matchingThemes.map(theme =>
        this.searchTheme(theme, extents, latitude, longitude, radius)
      );

      const results = await Promise.allSettled(searchPromises);
      
      return results
        .filter((result): result is PromiseFulfilledResult<ThemeSearchResult> => 
          result.status === 'fulfilled' && result.value.features.length > 0
        )
        .map(result => result.value);

    } catch (error) {
      logger.error(`Failed to find facilities of type: ${facilityType}`, error);
      throw error;
    }
  }

  /**
   * Get landmarks near a postal code
   */
  async findLandmarksNearPostalCode(
    postalCode: string,
    radius: number = 1000,
    categories?: string[]
  ): Promise<ThemeSearchResult[]> {
    try {
      // Geocode the postal code first
      const location = await this.oneMapService.geocode(postalCode);
      if (!location) {
        throw new Error(`Could not find location for postal code: ${postalCode}`);
      }

      return this.findLandmarksNear(location.latitude, location.longitude, radius, categories);
    } catch (error) {
      logger.error(`Failed to find landmarks near postal code: ${postalCode}`, error);
      throw error;
    }
  }

  /**
   * Search a specific theme within an area
   */
  private async searchThemeInArea(
    theme: ThemeInfo,
    extents: string,
    centerLat: number,
    centerLng: number,
    radius: number
  ): Promise<ThemeSearchResult> {
    return this.searchTheme(theme, extents, centerLat, centerLng, radius);
  }

  /**
   * Search a specific theme
   */
  private async searchTheme(
    theme: ThemeInfo,
    extents?: string,
    centerLat?: number,
    centerLng?: number,
    radius?: number
  ): Promise<ThemeSearchResult> {
    const cacheKey = `theme_${theme.queryName}_${extents || 'all'}`;
    
    const cachedResult = this.cacheService.get<ThemeSearchResult>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const token = await this.oneMapService.ensureValidToken();
      const params: any = { queryName: theme.queryName };
      if (extents) {
        params.extents = extents;
      }

      const response = await this.oneMapService['client'].get('/api/public/themesvc/retrieveTheme', {
        params,
        headers: { 'Authorization': token }
      });

      const searchResults = response.data.SrchResults || [];
      const features: ThemeFeature[] = [];

      // Process search results
      for (const result of searchResults) {
        if (result.NAME || result.DESCRIPTION) {
          // Extract coordinates
          let coordinates: [number, number] = [0, 0];
          
          if (result.LatLng) {
            try {
              // Parse coordinates from LatLng string
              const coordsMatch = result.LatLng.match(/\[([\d.,\s]+)\]/);
              if (coordsMatch) {
                const coords = coordsMatch[1].split(',').map((c: string) => parseFloat(c.trim()));
                if (coords.length >= 2) {
                  coordinates = [coords[1], coords[0]]; // [lng, lat] -> [lat, lng]
                }
              }
            } catch (e) {
              logger.warn(`Failed to parse coordinates for ${result.NAME}`, e);
            }
          }

          // Calculate distance if center point provided
          let distance: number | undefined;
          if (centerLat && centerLng && coordinates[0] !== 0 && coordinates[1] !== 0) {
            distance = this.calculateDistance(centerLat, centerLng, coordinates[0], coordinates[1]);
          }

          const feature: ThemeFeature = {
            name: result.NAME || result.DESCRIPTION || 'Unknown',
            description: result.DESCRIPTION || result.NAME || '',
            hyperlink: result.HYPERLINK,
            category: theme.category,
            owner: theme.themeOwner,
            coordinates,
            properties: {
              ...result,
              theme: theme.themeName
            },
            iconName: result.ICON_NAME,
            distance
          };

          features.push(feature);
        }
      }

      // Sort by distance if available
      if (centerLat && centerLng) {
        features.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
      }

      const result: ThemeSearchResult = {
        theme,
        features,
        totalCount: features.length,
        searchArea: centerLat && centerLng && radius ? {
          center: [centerLat, centerLng],
          radius
        } : undefined
      };

      this.cacheService.set(cacheKey, result, this.CACHE_DURATION.THEME_DATA);
      return result;

    } catch (error) {
      logger.error(`Failed to search theme: ${theme.queryName}`, error);
      return {
        theme,
        features: [],
        totalCount: 0
      };
    }
  }

  /**
   * Calculate search extents based on center point and radius
   */
  private calculateExtents(lat: number, lng: number, radiusMeters: number): string {
    // Convert radius from meters to degrees (approximate)
    const radiusDegrees = radiusMeters / 111000; // Rough conversion
    
    const minLat = lat - radiusDegrees;
    const maxLat = lat + radiusDegrees;
    const minLng = lng - radiusDegrees;
    const maxLng = lng + radiusDegrees;
    
    return `${minLat},${minLng},${maxLat},${maxLng}`;
  }

  /**
   * Calculate distance between two points in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
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

  /**
   * Get popular landmark categories
   */
  getPopularCategories(): string[] {
    return [
      'education',
      'health', 
      'community',
      'recreation',
      'transport',
      'shopping',
      'tourism',
      'government',
      'religious',
      'sports'
    ];
  }

  /**
   * Get common facility types
   */
  getCommonFacilityTypes(): string[] {
    return [
      'schools',
      'hospitals',
      'clinics',
      'parks',
      'libraries',
      'community centers',
      'shopping malls',
      'mrt stations',
      'bus stops',
      'kindergartens',
      'hawker centres',
      'sports facilities',
      'places of worship'
    ];
  }
}
