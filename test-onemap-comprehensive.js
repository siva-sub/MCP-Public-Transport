const axios = require('axios');
const fs = require('fs');

// Configuration
const ONEMAP_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiZjNkOTgzNjYzNWM4ZGQ2ZDNkODE2NjU1YWQ2MWUxNyIsImlzcyI6Imh0dHA6Ly9pbnRlcm5hbC1hbGItb20tcHJkZXppdC1pdC1uZXctMTYzMzc5OTU0Mi5hcC1zb3V0aGVhc3QtMS5lbGIuYW1hem9uYXdzLmNvbS9hcGkvdjIvdXNlci9wYXNzd29yZCIsImlhdCI6MTc1MDgyNjU1OSwiZXhwIjoxNzUxMDg1NzU5LCJuYmYiOjE3NTA4MjY1NTksImp0aSI6InhoYzJpSDVCejZ5cmg4eDgiLCJ1c2VyX2lkIjo3NjYxLCJmb3JldmVyIjpmYWxzZX0.n0cfY6CJLxypZ9qLbIegaPpiRYlfIdt4xycgRqwktPU';

// Test scenarios covering all OneMap routing modes
const testScenarios = [
  {
    name: "Public Transport - Complex Route (Punggol to Keong Saik)",
    description: "The previously failing route that we fixed",
    params: {
      start: "1.40276446041873,103.89737879547",  // Punggol
      end: "1.2811884163336,103.841657436594",    // Keong Saik
      routeType: "pt",
      mode: "TRANSIT",
      date: "06-27-2025",
      time: "15:00:00",
      maxWalkDistance: "1000",
      numItineraries: "3"
    }
  },
  {
    name: "Public Transport - Short Route (Novena to Toa Payoh)",
    description: "Shorter public transport route for comparison",
    params: {
      start: "1.320981,103.844150",  // Near Novena
      end: "1.326762,103.8559",     // Near Toa Payoh
      routeType: "pt",
      mode: "TRANSIT",
      date: "06-27-2025",
      time: "15:00:00",
      maxWalkDistance: "1000",
      numItineraries: "3"
    }
  },
  {
    name: "Walking - Short Distance",
    description: "Simple walking route",
    params: {
      start: "1.319728,103.8421",
      end: "1.319728905,103.8421581",
      routeType: "walk"
    }
  },
  {
    name: "Driving - Medium Distance (Thomson Road)",
    description: "Driving route with turn-by-turn instructions",
    params: {
      start: "1.32536064328127,103.841457941408",
      end: "1.3204583554775822,103.84384264546134",
      routeType: "drive"
    }
  },
  {
    name: "Cycling - Recreational Route",
    description: "Cycling from Jurong to Orchard",
    params: {
      start: "1.2966,103.7764",  // Jurong East
      end: "1.3521,103.8198",   // Orchard
      routeType: "cycle"
    }
  },
  {
    name: "Public Transport - BUS Mode Only",
    description: "Bus-only public transport",
    params: {
      start: "1.320981,103.844150",
      end: "1.326762,103.8559",
      routeType: "pt",
      mode: "BUS",
      date: "06-27-2025",
      time: "15:00:00",
      maxWalkDistance: "800",
      numItineraries: "2"
    }
  },
  {
    name: "Public Transport - RAIL Mode Only",
    description: "Rail-only public transport",
    params: {
      start: "1.320981,103.844150",
      end: "1.326762,103.8559",
      routeType: "pt",
      mode: "RAIL",
      date: "06-27-2025",
      time: "15:00:00",
      maxWalkDistance: "1200",
      numItineraries: "2"
    }
  }
];

// OneMap API caller
async function callOneMapAPI(params) {
  const baseUrl = 'https://www.onemap.gov.sg/api/public/routingsvc/route';
  
  try {
    console.log(`Making request to: ${baseUrl}`);
    console.log('Parameters:', params);
    
    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'Authorization': `Bearer ${ONEMAP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log(`Response status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error('API Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

// Response analysis functions
function getResponseType(response) {
  if (!response) return 'ERROR';
  if (response.plan?.itineraries) return 'PUBLIC_TRANSPORT';
  if (response.route_instructions) return 'DIRECT_ROUTING';
  if (response.status !== undefined) return 'STATUS_RESPONSE';
  return 'UNKNOWN';
}

function hasInstructions(response) {
  if (!response) return false;
  if (response.route_instructions?.length > 0) return true;
  if (response.plan?.itineraries?.[0]?.legs?.length > 0) return true;
  return false;
}

function hasPolylines(response) {
  if (!response) return false;
  if (response.route_geometry) return true;
  if (response.plan?.itineraries?.[0]?.legs?.some(leg => leg.legGeometry?.points)) return true;
  return false;
}

function getInstructionCount(response) {
  if (!response) return 0;
  if (response.route_instructions) return response.route_instructions.length;
  if (response.plan?.itineraries?.[0]?.legs) {
    return response.plan.itineraries[0].legs.reduce((count, leg) => {
      return count + (leg.steps?.length || 1);
    }, 0);
  }
  return 0;
}

// Instruction parsing functions
function parseInstructions(response) {
  const responseType = getResponseType(response);
  
  switch (responseType) {
    case 'DIRECT_ROUTING':
      return parseDirectInstructions(response);
    case 'PUBLIC_TRANSPORT':
      return parseTransitInstructions(response);
    default:
      return [];
  }
}

function parseDirectInstructions(response) {
  if (!response.route_instructions) return [];
  
  return response.route_instructions.map((inst, index) => ({
    step: index + 1,
    type: 'direct',
    direction: inst[0],
    streetName: inst[1],
    distance: inst[2],
    coordinates: parseCoordinates(inst[3]),
    timeSeconds: inst[4],
    distanceFormatted: inst[5],
    fromDirection: inst[6],
    toDirection: inst[7],
    mode: inst[8],
    instruction: inst[9]
  }));
}

function parseTransitInstructions(response) {
  if (!response.plan?.itineraries?.[0]?.legs) return [];
  
  const instructions = [];
  let stepCounter = 1;
  
  response.plan.itineraries[0].legs.forEach((leg, legIndex) => {
    if (leg.mode === 'WALK') {
      // Walking segment
      if (leg.steps && leg.steps.length > 0) {
        leg.steps.forEach(step => {
          instructions.push({
            step: stepCounter++,
            type: 'transit_walk',
            mode: 'WALK',
            direction: step.relativeDirection,
            streetName: step.streetName,
            distance: step.distance,
            coordinates: { lat: step.lat, lng: step.lon },
            instruction: `${step.relativeDirection} on ${step.streetName} for ${step.distance}m`,
            absoluteDirection: step.absoluteDirection
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
          destination: leg.to.name
        });
      }
    } else {
      // Transit segment (BUS, RAIL, etc.)
      instructions.push({
        step: stepCounter++,
        type: 'transit',
        mode: leg.mode,
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
        intermediateStops: leg.intermediateStops?.map(stop => ({
          name: stop.name,
          stopCode: stop.stopCode,
          coordinates: { lat: stop.lat, lng: stop.lon }
        }))
      });
    }
  });
  
  return instructions;
}

function parseCoordinates(coordString) {
  if (!coordString) return null;
  const [lat, lng] = coordString.split(',').map(parseFloat);
  return { lat, lng };
}

// Polyline processing functions
function processPolylines(response) {
  const polylines = [];
  
  if (response.route_geometry) {
    // Direct routing polyline
    polylines.push({
      type: 'route',
      encoded: response.route_geometry,
      // Note: We'd need a polyline decoder library for actual decoding
      // For now, just store the encoded version
      coordinateCount: estimateCoordinateCount(response.route_geometry)
    });
  }
  
  if (response.plan?.itineraries?.[0]?.legs) {
    // Transit leg polylines
    response.plan.itineraries[0].legs.forEach((leg, index) => {
      if (leg.legGeometry?.points) {
        polylines.push({
          type: 'leg',
          index: index,
          mode: leg.mode,
          encoded: leg.legGeometry.points,
          coordinateCount: estimateCoordinateCount(leg.legGeometry.points),
          from: leg.from.name,
          to: leg.to.name
        });
      }
    });
  }
  
  return polylines;
}

function estimateCoordinateCount(encodedPolyline) {
  // Rough estimate based on string length
  return Math.floor(encodedPolyline.length / 10);
}

// Context enhancement functions (basic implementation)
async function enhanceWithBasicContext(instructions) {
  // For now, just add some basic context based on coordinates
  return instructions.map(instruction => ({
    ...instruction,
    // Add basic context (in real implementation, these would be API calls)
    estimatedContext: {
      area: getAreaFromCoordinates(instruction.coordinates),
      timeOfDay: getCurrentTimeContext(),
      weatherNote: "Check weather conditions for outdoor segments"
    }
  }));
}

function getAreaFromCoordinates(coordinates) {
  if (!coordinates) return 'Unknown';
  
  // Basic area detection based on coordinate ranges
  const { lat, lng } = coordinates;
  
  if (lat >= 1.38 && lat <= 1.45 && lng >= 103.89 && lng <= 103.95) return 'Punggol/Sengkang';
  if (lat >= 1.31 && lat <= 1.33 && lng >= 103.84 && lng <= 103.86) return 'Novena/Toa Payoh';
  if (lat >= 1.27 && lat <= 1.29 && lng >= 103.84 && lng <= 103.86) return 'Chinatown/CBD';
  if (lat >= 1.29 && lat <= 1.31 && lng >= 103.77 && lng <= 103.79) return 'Jurong';
  if (lat >= 1.30 && lat <= 1.32 && lng >= 103.81 && lng <= 103.83) return 'Orchard/Somerset';
  
  return 'Singapore';
}

function getCurrentTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 7 && hour <= 9) return 'Morning Peak';
  if (hour >= 17 && hour <= 19) return 'Evening Peak';
  if (hour >= 23 || hour <= 5) return 'Late Night';
  return 'Off Peak';
}

// Summary generation
function generateSummary(response, instructions, polylines) {
  const summary = {
    responseType: getResponseType(response),
    hasInstructions: hasInstructions(response),
    hasPolylines: hasPolylines(response),
    instructionCount: instructions.length,
    polylineCount: polylines.length
  };
  
  if (response.route_summary) {
    summary.routeSummary = {
      totalTime: response.route_summary.total_time,
      totalDistance: response.route_summary.total_distance,
      startPoint: response.route_summary.start_point,
      endPoint: response.route_summary.end_point
    };
  }
  
  if (response.plan?.itineraries?.[0]) {
    const itinerary = response.plan.itineraries[0];
    summary.transitSummary = {
      duration: itinerary.duration,
      walkTime: itinerary.walkTime,
      transitTime: itinerary.transitTime,
      waitingTime: itinerary.waitingTime,
      walkDistance: itinerary.walkDistance,
      transfers: itinerary.transfers,
      fare: itinerary.fare
    };
  }
  
  return summary;
}

// Main testing function
async function runComprehensiveTest() {
  console.log('🚀 Starting Comprehensive OneMap API Testing\n');
  console.log('=' * 60);
  
  const results = [];
  
  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];
    console.log(`\n📍 Test ${i + 1}/${testScenarios.length}: ${scenario.name}`);
    console.log(`Description: ${scenario.description}`);
    console.log('-'.repeat(50));
    
    try {
      // Call OneMap API
      const response = await callOneMapAPI(scenario.params);
      
      if (!response) {
        console.log('❌ API call failed');
        results.push({
          scenario: scenario.name,
          success: false,
          error: 'API call failed'
        });
        continue;
      }
      
      // Analyze response
      const responseType = getResponseType(response);
      console.log(`✅ Response type: ${responseType}`);
      
      // Parse instructions
      const instructions = parseInstructions(response);
      console.log(`📋 Instructions parsed: ${instructions.length} steps`);
      
      // Process polylines
      const polylines = processPolylines(response);
      console.log(`🗺️  Polylines found: ${polylines.length}`);
      
      // Enhance with context
      const enhancedInstructions = await enhanceWithBasicContext(instructions);
      console.log(`🎯 Context enhanced: ${enhancedInstructions.length} enhanced steps`);
      
      // Generate summary
      const summary = generateSummary(response, instructions, polylines);
      
      // Display key results
      console.log('\n📊 Summary:');
      console.log(`   • Response Type: ${summary.responseType}`);
      console.log(`   • Instructions: ${summary.instructionCount}`);
      console.log(`   • Polylines: ${summary.polylineCount}`);
      
      if (summary.routeSummary) {
        console.log(`   • Total Time: ${summary.routeSummary.totalTime}s`);
        console.log(`   • Total Distance: ${summary.routeSummary.totalDistance}m`);
      }
      
      if (summary.transitSummary) {
        console.log(`   • Duration: ${Math.round(summary.transitSummary.duration / 60)}min`);
        console.log(`   • Walk Distance: ${Math.round(summary.transitSummary.walkDistance)}m`);
        console.log(`   • Transfers: ${summary.transitSummary.transfers}`);
        console.log(`   • Fare: $${summary.transitSummary.fare}`);
      }
      
      // Show first few instructions as examples
      if (enhancedInstructions.length > 0) {
        console.log('\n🧭 Sample Instructions:');
        enhancedInstructions.slice(0, 3).forEach(inst => {
          console.log(`   ${inst.step}. ${inst.instruction}`);
        });
        if (enhancedInstructions.length > 3) {
          console.log(`   ... and ${enhancedInstructions.length - 3} more steps`);
        }
      }
      
      results.push({
        scenario: scenario.name,
        success: true,
        summary,
        instructionCount: instructions.length,
        polylineCount: polylines.length,
        sampleInstructions: enhancedInstructions.slice(0, 3)
      });
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      results.push({
        scenario: scenario.name,
        success: false,
        error: error.message
      });
    }
    
    // Add delay between requests to be respectful to the API
    if (i < testScenarios.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('🎯 COMPREHENSIVE TEST RESULTS');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Successful tests: ${successful}/${results.length}`);
  console.log(`❌ Failed tests: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed scenarios:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   • ${r.scenario}: ${r.error}`);
    });
  }
  
  // Save detailed results to file
  const detailedResults = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      successful,
      failed
    },
    results
  };
  
  fs.writeFileSync('test-results.json', JSON.stringify(detailedResults, null, 2));
  console.log('\n💾 Detailed results saved to test-results.json');
  
  return results;
}

// Run the test
if (require.main === module) {
  runComprehensiveTest()
    .then(results => {
      console.log('\n🏁 Testing completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Testing failed:', error);
      process.exit(1);
    });
}

module.exports = {
  callOneMapAPI,
  parseInstructions,
  processPolylines,
  enhanceWithBasicContext,
  runComprehensiveTest
};
