// Test the daily comparison calculation logic
// Run with: node test-daily-comparison.js

// Yesterday: 133.4 kWh, 130 parts
// Today: 126.6 kWh, 129 parts

const yesterdayEnergy = 133.4;
const todayEnergy = 126.6;
const yesterdayParts = 130;
const todayParts = 129;

const energyPercentChange = ((todayEnergy - yesterdayEnergy) / yesterdayEnergy * 100).toFixed(1);
const partsPercentChange = ((todayParts - yesterdayParts) / yesterdayParts * 100).toFixed(1);

const yesterdayEnergyPerPart = (yesterdayEnergy / yesterdayParts).toFixed(2);
const todayEnergyPerPart = (todayEnergy / todayParts).toFixed(2);
const energyPerPartChange = ((todayEnergyPerPart - yesterdayEnergyPerPart) / yesterdayEnergyPerPart * 100).toFixed(1);

console.log('\n=== Daily Comparison Test ===\n');
console.log('Energy:');
console.log(`  Yesterday: ${yesterdayEnergy} kWh`);
console.log(`  Today: ${todayEnergy} kWh`);
console.log(`  Change: ${energyPercentChange}%`);

console.log('\nParts:');
console.log(`  Yesterday: ${yesterdayParts} parts`);
console.log(`  Today: ${todayParts} parts`);
console.log(`  Change: ${partsPercentChange}%`);

console.log('\nEnergy per Part:');
console.log(`  Yesterday: ${yesterdayEnergyPerPart} kWh/part`);
console.log(`  Today: ${todayEnergyPerPart} kWh/part`);
console.log(`  Change: ${energyPerPartChange}%`);

console.log('\nCost (assuming ₹8.5/kWh):');
const yesterdayCost = (yesterdayEnergy * 8.5).toFixed(0);
const todayCost = (todayEnergy * 8.5).toFixed(0);
const costChange = ((todayCost - yesterdayCost) / yesterdayCost * 100).toFixed(1);
console.log(`  Yesterday: ₹${yesterdayCost}`);
console.log(`  Today: ₹${todayCost}`);
console.log(`  Change: ${costChange}%`);

console.log('\n=== Expected API Response ===\n');
console.log(JSON.stringify({
  energy: {
    today: parseFloat(todayEnergy),
    yesterday: parseFloat(yesterdayEnergy),
    percentChange: parseFloat(energyPercentChange)
  },
  parts: {
    today: parseInt(todayParts),
    yesterday: parseInt(yesterdayParts),
    percentChange: parseFloat(partsPercentChange)
  },
  cost: {
    today: parseFloat(todayCost),
    yesterday: parseFloat(yesterdayCost),
    percentChange: parseFloat(costChange)
  },
  energyPerPart: {
    today: parseFloat(todayEnergyPerPart),
    yesterday: parseFloat(yesterdayEnergyPerPart),
    percentChange: parseFloat(energyPerPartChange)
  }
}, null, 2));
