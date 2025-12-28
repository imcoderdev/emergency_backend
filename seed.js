/**
 * Demo Data Seeder for EmergencyHub
 * 
 * This script populates the database with realistic demo incidents
 * for testing and demonstration purposes.
 * 
 * Usage: node seed.js [--clear]
 *   --clear: Deletes all existing incidents before seeding
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Incident = require('./models/Incident');

// Demo incident data with realistic scenarios
const demoIncidents = [
  // HIGH SEVERITY - Critical emergencies
  {
    type: 'fire',
    title: 'Apartment Complex Fire - Multiple Floors',
    description: 'Large fire reported at residential apartment complex. Flames visible from 3rd and 4th floors. Residents evacuating. Smoke spreading rapidly. Multiple families may be trapped.',
    location: {
      type: 'Point',
      coordinates: [-122.4194, 37.7749] // San Francisco
    },
    address: '1250 Market Street, San Francisco, CA 94102',
    severity: 5,
    upvotes: 47,
    verified: true,
    status: 'dispatched',
    aiAnalysis: {
      category: 'FIRE',
      priorityScore: 98,
      suggestedResponders: ['Fire Department', 'Ambulance', 'Police'],
      summary: 'Critical multi-story residential fire requiring immediate multi-agency response. High life safety risk.',
      estimatedResponseTime: '3-5 minutes',
      riskLevel: 'CRITICAL'
    },
    createdAt: new Date(Date.now() - 15 * 60 * 1000) // 15 mins ago
  },
  {
    type: 'medical',
    title: 'Cardiac Arrest at Shopping Mall',
    description: 'Adult male, approximately 55 years old, collapsed near food court. Bystander performing CPR. AED being brought. Patient unresponsive. Urgent medical assistance needed.',
    location: {
      type: 'Point',
      coordinates: [-122.4089, 37.7854]
    },
    address: 'Westfield San Francisco Centre, 865 Market St, San Francisco, CA 94103',
    severity: 5,
    upvotes: 23,
    verified: true,
    status: 'dispatched',
    aiAnalysis: {
      category: 'MEDICAL',
      priorityScore: 95,
      suggestedResponders: ['Ambulance', 'Paramedics'],
      summary: 'Time-critical cardiac emergency. CPR in progress. Every minute counts for survival.',
      estimatedResponseTime: '4-6 minutes',
      riskLevel: 'CRITICAL'
    },
    createdAt: new Date(Date.now() - 8 * 60 * 1000) // 8 mins ago
  },

  // HIGH SEVERITY - Serious incidents
  {
    type: 'accident',
    title: 'Multi-Vehicle Collision on Highway 101',
    description: '5-car pileup on Highway 101 Northbound near exit 429. At least 2 vehicles overturned. Multiple injuries reported. Traffic completely blocked. Fuel leak detected from one vehicle.',
    location: {
      type: 'Point',
      coordinates: [-122.4027, 37.7917]
    },
    address: 'Highway 101 N, near Exit 429, San Francisco, CA',
    severity: 4,
    upvotes: 35,
    verified: true,
    status: 'dispatched',
    aiAnalysis: {
      category: 'TRAFFIC',
      priorityScore: 88,
      suggestedResponders: ['Ambulance', 'Fire Department', 'Highway Patrol', 'Tow Services'],
      summary: 'Major highway accident with multiple casualties and hazmat concern. Road closure required.',
      estimatedResponseTime: '5-8 minutes',
      riskLevel: 'HIGH'
    },
    createdAt: new Date(Date.now() - 25 * 60 * 1000) // 25 mins ago
  },
  {
    type: 'crime',
    title: 'Armed Robbery in Progress - Jewelry Store',
    description: 'Two armed suspects in a jewelry store at Union Square. Store employees held at gunpoint. Suspects wearing masks. Customers hiding. Silent alarm triggered.',
    location: {
      type: 'Point',
      coordinates: [-122.4069, 37.7873]
    },
    address: '345 Stockton Street, San Francisco, CA 94108',
    severity: 5,
    upvotes: 19,
    verified: true,
    status: 'dispatched',
    aiAnalysis: {
      category: 'CRIME',
      priorityScore: 94,
      suggestedResponders: ['Police', 'SWAT if needed'],
      summary: 'Active armed robbery with hostage situation. Extreme caution required. Tactical response recommended.',
      estimatedResponseTime: '3-5 minutes',
      riskLevel: 'CRITICAL'
    },
    createdAt: new Date(Date.now() - 5 * 60 * 1000) // 5 mins ago
  },

  // MEDIUM SEVERITY - Moderate emergencies
  {
    type: 'fire',
    title: 'Kitchen Fire at Restaurant',
    description: 'Grease fire in commercial kitchen. Sprinkler system activated. Staff evacuated. Smoke visible from ventilation. Fire appears contained to kitchen area.',
    location: {
      type: 'Point',
      coordinates: [-122.4219, 37.7641]
    },
    address: '2800 Mission Street, San Francisco, CA 94110',
    severity: 3,
    upvotes: 12,
    verified: true,
    status: 'en-route',
    aiAnalysis: {
      category: 'FIRE',
      priorityScore: 72,
      suggestedResponders: ['Fire Department'],
      summary: 'Contained commercial kitchen fire. Sprinklers active. Standard fire response sufficient.',
      estimatedResponseTime: '6-8 minutes',
      riskLevel: 'MEDIUM'
    },
    createdAt: new Date(Date.now() - 35 * 60 * 1000) // 35 mins ago
  },
  {
    type: 'medical',
    title: 'Child with Severe Allergic Reaction',
    description: '8-year-old experiencing anaphylaxis after eating at school cafeteria. EpiPen administered by nurse. Child breathing but labored. Parents notified.',
    location: {
      type: 'Point',
      coordinates: [-122.4352, 37.7598]
    },
    address: 'Sanchez Elementary School, 325 Sanchez St, San Francisco, CA 94114',
    severity: 4,
    upvotes: 15,
    verified: true,
    status: 'en-route',
    aiAnalysis: {
      category: 'MEDICAL',
      priorityScore: 82,
      suggestedResponders: ['Ambulance', 'Paramedics'],
      summary: 'Pediatric allergic emergency. EpiPen given. Transport to hospital recommended for observation.',
      estimatedResponseTime: '5-7 minutes',
      riskLevel: 'HIGH'
    },
    createdAt: new Date(Date.now() - 12 * 60 * 1000) // 12 mins ago
  },
  {
    type: 'hazard',
    title: 'Gas Leak Reported in Residential Area',
    description: 'Strong smell of natural gas in neighborhood. Multiple residents reporting. Source appears to be from construction site. No ignition yet.',
    location: {
      type: 'Point',
      coordinates: [-122.4486, 37.7757]
    },
    address: 'Clement Street & 25th Avenue, San Francisco, CA 94121',
    severity: 4,
    upvotes: 28,
    verified: true,
    status: 'dispatched',
    aiAnalysis: {
      category: 'HAZMAT',
      priorityScore: 85,
      suggestedResponders: ['Fire Department', 'Gas Company', 'Police for evacuation'],
      summary: 'Potential gas leak requiring immediate area evacuation and source isolation.',
      estimatedResponseTime: '8-10 minutes',
      riskLevel: 'HIGH'
    },
    createdAt: new Date(Date.now() - 18 * 60 * 1000) // 18 mins ago
  },

  // MEDIUM-LOW SEVERITY - Standard incidents
  {
    type: 'accident',
    title: 'Bicycle vs Pedestrian Collision',
    description: 'Cyclist collided with pedestrian at crosswalk. Pedestrian has leg injury, conscious and alert. Cyclist has minor scrapes. Both refusing transport but requesting documentation.',
    location: {
      type: 'Point',
      coordinates: [-122.3992, 37.7945]
    },
    address: 'Embarcadero & Broadway, San Francisco, CA 94111',
    severity: 2,
    upvotes: 5,
    verified: true,
    status: 'en-route',
    aiAnalysis: {
      category: 'TRAFFIC',
      priorityScore: 45,
      suggestedResponders: ['Ambulance', 'Police'],
      summary: 'Minor collision with non-life-threatening injuries. Standard response appropriate.',
      estimatedResponseTime: '10-12 minutes',
      riskLevel: 'LOW'
    },
    createdAt: new Date(Date.now() - 45 * 60 * 1000) // 45 mins ago
  },
  {
    type: 'crime',
    title: 'Vehicle Break-in Witnessed',
    description: 'Just witnessed someone break into a parked car. Suspect fled on foot heading toward park. White male, dark hoodie, carrying backpack. Vehicle alarm still sounding.',
    location: {
      type: 'Point',
      coordinates: [-122.4556, 37.7694]
    },
    address: 'Fulton Street & 10th Avenue, San Francisco, CA 94118',
    severity: 2,
    upvotes: 8,
    verified: false,
    status: 'pending',
    aiAnalysis: {
      category: 'CRIME',
      priorityScore: 48,
      suggestedResponders: ['Police'],
      summary: 'Property crime with fleeing suspect. Non-violent. Standard patrol response.',
      estimatedResponseTime: '12-15 minutes',
      riskLevel: 'LOW'
    },
    createdAt: new Date(Date.now() - 55 * 60 * 1000) // 55 mins ago
  },
  {
    type: 'other',
    title: 'Aggressive Dog Running Loose',
    description: 'Large dog without collar acting aggressively toward pedestrians in park. Has charged at several people. No bites reported yet. Dog appears malnourished.',
    location: {
      type: 'Point',
      coordinates: [-122.4587, 37.7683]
    },
    address: 'Golden Gate Park, near Music Concourse, San Francisco, CA 94122',
    severity: 2,
    upvotes: 14,
    verified: true,
    status: 'pending',
    aiAnalysis: {
      category: 'ANIMAL',
      priorityScore: 52,
      suggestedResponders: ['Animal Control', 'Police'],
      summary: 'Loose aggressive animal in public area. Animal control primary responder.',
      estimatedResponseTime: '15-20 minutes',
      riskLevel: 'MEDIUM'
    },
    createdAt: new Date(Date.now() - 40 * 60 * 1000) // 40 mins ago
  },

  // LOW SEVERITY - Minor incidents
  {
    type: 'hazard',
    title: 'Fallen Tree Blocking Sidewalk',
    description: 'Large tree branch fell and is blocking sidewalk and partially blocking bike lane. No one injured. Creates hazard for pedestrians who have to walk in street.',
    location: {
      type: 'Point',
      coordinates: [-122.4312, 37.7565]
    },
    address: 'Dolores Street & 24th Street, San Francisco, CA 94114',
    severity: 1,
    upvotes: 6,
    verified: true,
    status: 'pending',
    aiAnalysis: {
      category: 'HAZARD',
      priorityScore: 35,
      suggestedResponders: ['Public Works', 'Traffic Control'],
      summary: 'Non-emergency infrastructure issue. No immediate danger. Standard public works response.',
      estimatedResponseTime: '30-45 minutes',
      riskLevel: 'LOW'
    },
    createdAt: new Date(Date.now() - 90 * 60 * 1000) // 90 mins ago
  },
  {
    type: 'other',
    title: 'Suspicious Package Near Bus Stop',
    description: 'Unattended backpack sitting at bus stop for over 2 hours. No one has claimed it. Appears to be abandoned but want to report just in case.',
    location: {
      type: 'Point',
      coordinates: [-122.4131, 37.7881]
    },
    address: 'Geary Street & Powell Street, San Francisco, CA 94102',
    severity: 2,
    upvotes: 11,
    verified: false,
    status: 'pending',
    aiAnalysis: {
      category: 'SUSPICIOUS',
      priorityScore: 55,
      suggestedResponders: ['Police'],
      summary: 'Unattended package requires investigation. Likely abandoned property but caution advised.',
      estimatedResponseTime: '10-15 minutes',
      riskLevel: 'MEDIUM'
    },
    createdAt: new Date(Date.now() - 65 * 60 * 1000) // 65 mins ago
  },

  // RESOLVED INCIDENTS - For history
  {
    type: 'fire',
    title: 'Trash Can Fire Extinguished',
    description: 'Small fire in public trash can. Likely caused by discarded cigarette. Fire department arrived and extinguished. No damage to surrounding area.',
    location: {
      type: 'Point',
      coordinates: [-122.4082, 37.7849]
    },
    address: 'Market Street & 5th Street, San Francisco, CA 94103',
    severity: 1,
    upvotes: 3,
    verified: true,
    status: 'resolved',
    aiAnalysis: {
      category: 'FIRE',
      priorityScore: 25,
      suggestedResponders: ['Fire Department'],
      summary: 'Minor fire incident. Successfully extinguished. No injuries or property damage.',
      estimatedResponseTime: 'N/A',
      riskLevel: 'LOW'
    },
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
    resolvedAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000)
  },
  {
    type: 'medical',
    title: 'Diabetic Emergency - Patient Stabilized',
    description: 'Diabetic patient found disoriented. Blood sugar critically low. Paramedics administered glucose. Patient stabilized and transported to hospital for observation.',
    location: {
      type: 'Point',
      coordinates: [-122.4366, 37.7515]
    },
    address: 'Glen Park BART Station, San Francisco, CA 94131',
    severity: 3,
    upvotes: 9,
    verified: true,
    status: 'resolved',
    aiAnalysis: {
      category: 'MEDICAL',
      priorityScore: 68,
      suggestedResponders: ['Ambulance', 'Paramedics'],
      summary: 'Resolved medical emergency. Patient received treatment and transported.',
      estimatedResponseTime: 'N/A',
      riskLevel: 'MEDIUM'
    },
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
    resolvedAt: new Date(Date.now() - 3.5 * 60 * 60 * 1000)
  },
  {
    type: 'accident',
    title: 'Minor Fender Bender - Cleared',
    description: 'Two-vehicle accident. Minor damage only. No injuries. Drivers exchanged information. Vehicles moved to side of road. Traffic flowing normally again.',
    location: {
      type: 'Point',
      coordinates: [-122.4629, 37.7649]
    },
    address: '19th Avenue & Irving Street, San Francisco, CA 94122',
    severity: 1,
    upvotes: 2,
    verified: true,
    status: 'resolved',
    aiAnalysis: {
      category: 'TRAFFIC',
      priorityScore: 20,
      suggestedResponders: ['Police for documentation'],
      summary: 'Minor traffic incident resolved. No emergency services required.',
      estimatedResponseTime: 'N/A',
      riskLevel: 'LOW'
    },
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    resolvedAt: new Date(Date.now() - 4.8 * 60 * 60 * 1000)
  }
];

async function seedDatabase() {
  const clearFlag = process.argv.includes('--clear');
  
  try {
    console.log('🌱 EmergencyHub Demo Data Seeder');
    console.log('================================\n');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    // Clear existing data if flag is set
    if (clearFlag) {
      console.log('🗑️  Clearing existing incidents...');
      const deleteResult = await Incident.deleteMany({});
      console.log(`   Deleted ${deleteResult.deletedCount} existing incidents\n`);
    }

    // Insert demo incidents
    console.log('📝 Inserting demo incidents...');
    const insertedIncidents = await Incident.insertMany(demoIncidents);
    console.log(`   ✅ Inserted ${insertedIncidents.length} demo incidents\n`);

    // Display summary
    console.log('📊 Summary:');
    console.log('   ─────────────────────────────');
    
    const stats = {
      total: insertedIncidents.length,
      bySeverity: {},
      byType: {},
      byStatus: {}
    };

    insertedIncidents.forEach(incident => {
      // By severity
      stats.bySeverity[incident.severity] = (stats.bySeverity[incident.severity] || 0) + 1;
      // By type
      stats.byType[incident.type] = (stats.byType[incident.type] || 0) + 1;
      // By status
      stats.byStatus[incident.status] = (stats.byStatus[incident.status] || 0) + 1;
    });

    console.log(`   Total incidents: ${stats.total}`);
    console.log('\n   By Severity:');
    Object.entries(stats.bySeverity).sort((a, b) => b[0] - a[0]).forEach(([sev, count]) => {
      const label = sev >= 4 ? '🔴 Critical' : sev >= 3 ? '🟠 High' : sev >= 2 ? '🟡 Medium' : '🟢 Low';
      console.log(`     ${label} (${sev}): ${count}`);
    });

    console.log('\n   By Type:');
    Object.entries(stats.byType).forEach(([type, count]) => {
      const emoji = { fire: '🔥', medical: '🏥', accident: '🚗', crime: '🚨', hazard: '⚠️', other: '📋' }[type] || '📋';
      console.log(`     ${emoji} ${type}: ${count}`);
    });

    console.log('\n   By Status:');
    Object.entries(stats.byStatus).forEach(([status, count]) => {
      const emoji = { pending: '⏳', dispatched: '🚀', 'en-route': '🚗', resolved: '✅' }[status] || '📋';
      console.log(`     ${emoji} ${status}: ${count}`);
    });

    console.log('\n================================');
    console.log('🎉 Seeding completed successfully!\n');
    console.log('👉 You can now run the app and see demo data on the dashboard.\n');

  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the seeder
seedDatabase();
