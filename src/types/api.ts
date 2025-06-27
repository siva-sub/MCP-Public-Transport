export interface LTABusArrivalResponse {
  BusStopCode: string;
  Services: Array<{
    ServiceNo: string;
    Operator: string;
    NextBus: LTABusInfo;
    NextBus2: LTABusInfo;
    NextBus3: LTABusInfo;
  }>;
}

export interface LTABusInfo {
  OriginCode: string;
  DestinationCode: string;
  EstimatedArrival: string;
  Latitude: string;
  Longitude: string;
  VisitNumber: string;
  Load: 'SEA' | 'SDA' | 'LSD';
  Feature: string;
  Type: 'SD' | 'DD' | 'BD';
  Monitored: string;
}

export interface LTABusStopsResponse {
  value: Array<{
    BusStopCode: string;
    RoadName: string;
    Description: string;
    Latitude: number;
    Longitude: number;
  }>;
}

export interface LTATrainServiceAlertsResponse {
  Status: number;
  AffectedSegments: Array<{
    Line: string;
    Direction: string;
    Stations: string;
    FreePublicBus: string;
    FreeMRTShuttle: string;
    MRTShuttleDirection: string;
  }>;
  Message: Array<{
    Content: string;
    CreatedDate: string;
  }>;
}
