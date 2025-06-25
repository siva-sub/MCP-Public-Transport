export interface BusStop {
  busStopCode: string;
  roadName: string;
  description: string;
  latitude: number;
  longitude: number;
}

export interface BusService {
  serviceNo: string;
  operator: string;
  nextBuses: BusArrivalInfo[];
}

export interface BusArrivalInfo {
  estimatedArrival: string;
  minutesAway: number;
  loadStatus: 'SEA' | 'SDA' | 'LSD';
  loadDescription: string;
  wheelchairAccessible: boolean;
  busType: 'SD' | 'DD' | 'BD';
  busTypeDescription: string;
  latitude: string;
  longitude: string;
  visitNumber: string;
}

export interface TrainStation {
  stationCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
  line: string;
}

export interface TrainServiceAlert {
  line: string;
  lineName: string;
  status: 'Normal' | 'Disrupted';
  message?: string;
  affectedStations?: string[];
  direction?: string;
  alternativeTransport?: boolean;
  shuttleService?: boolean;
  estimatedRecovery?: string;
}

export interface Location {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface RouteSegment {
  mode: 'WALK' | 'BUS' | 'TRAIN' | 'TAXI';
  duration: number;
  distance?: number;
  instructions: string[];
  startLocation: Location;
  endLocation: Location;
  cost?: number;
  service?: string;
  operator?: string;
  realTimeInfo?: unknown;
}

export interface JourneyPlan {
  segments: RouteSegment[];
  totalDuration: number;
  totalDistance: number;
  totalCost: number;
  totalWalkDistance: number;
  transfers: number;
  summary: string;
  alternatives?: JourneyPlan[];
  realTimeEnhanced?: boolean;
}

export interface TaxiAvailability {
  coordinates: [number, number];
  timestamp: string;
}

export interface TrafficIncident {
  type: string;
  message: string;
  coordinates?: [number, number];
}
