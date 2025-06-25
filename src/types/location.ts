export interface LocationResult {
  id: string;
  name: string;
  displayName: string;
  coordinates: {
    wgs84: { lat: number; lng: number; }
    svy21: { x: number; y: number; }
  }
  address: DetailedAddress;
  locationTypes: LocationType[];
  confidence: number;
  metadata: LocationMetadata;
  nearbyInfo?: NearbyInfo;
}

export interface DetailedAddress {
  buildingName?: string;
  blockNumber?: string;
  streetName: string;
  postalCode?: string;
  district?: string;
  region?: string;
  formattedAddress: string;
}

export interface LocationMetadata {
  source: 'onemap' | 'lta' | 'knowledge_base' | 'fuzzy_search';
  lastUpdated: string;
  amenities?: string[];
  nearbyTransport?: TransportAccess[];
  isLandmark: boolean;
  popularNames?: string[];
  searchStrategy?: SearchStrategy;
}

export interface NearbyInfo {
  transport: TransportAccess[];
  amenities: AreaAmenity[];
  landmarks: NearbyLandmark[];
  walkingDistance?: number;
}

export interface TransportAccess {
  type: 'MRT' | 'LRT' | 'BUS_STOP' | 'BUS_INTERCHANGE';
  name: string;
  code?: string;
  line?: string;
  walkingTimeMinutes: number;
  walkingDistance: number;
}

export interface AreaAmenity {
  type: 'SHOPPING' | 'DINING' | 'MEDICAL' | 'EDUCATION' | 'RECREATION';
  name: string;
  distance: number;
}

export interface NearbyLandmark {
  name: string;
  type: string;
  distance: number;
}

export type LocationType = 
  | 'MRT_STATION' | 'LRT_STATION' | 'BUS_STOP' | 'BUS_INTERCHANGE'
  | 'SHOPPING_MALL' | 'HOSPITAL' | 'SCHOOL' | 'GOVERNMENT'
  | 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | 'RECREATION'
  | 'POSTAL_CODE' | 'LANDMARK' | 'TOURIST_ATTRACTION'
  | 'BUILDING' | 'STREET' | 'GENERAL';

export type SearchStrategy = 
  | 'exact_match' | 'fuzzy_match' | 'postal_code' | 'mrt_station' 
  | 'landmark' | 'knowledge_base' | 'abbreviation_expansion'
  | 'onemap_geocoding' | 'fuzzy_search';

// OneMap API response types
export interface OneMapSearchResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  X: string;
  Y: string;
  LATITUDE: string;
  LONGITUDE: string;
  LONGTITUDE: string; // Note: OneMap API has this typo
}

export interface ReverseGeocodeResult {
  BUILDINGNAME: string;
  BLOCK: string;
  ROAD: string;
  POSTALCODE: string;
  XCOORD: string;
  YCOORD: string;
  LATITUDE: string;
  LONGITUDE: string;
  LONGTITUDE: string; // Note: OneMap API has this typo
}

export interface ReverseGeocodeOptions {
  radius?: number;
  addressType?: 'HDB' | 'All';
  includeOtherFeatures?: boolean;
}

// Coordinate types
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface SVY21Coordinates {
  x: number;
  y: number;
}

export type CoordinateSystem = 'WGS84' | 'SVY21' | 'EPSG3857';

// Knowledge base types
export interface MRTStationInfo {
  code: string;
  name: string;
  line: string;
  coordinates: Coordinates;
  exits: string[];
  nearbyLandmarks: string[];
  interchanges: string[];
}

export interface LandmarkInfo {
  name: string;
  aliases: string[];
  coordinates: Coordinates;
  type: LocationType;
  nearestMRT: string;
  description: string;
}

export interface DistrictInfo {
  name: string;
  region: string;
  postalCodeRange: [string, string];
  characteristics: string[];
  nearestMRT: string;
}
