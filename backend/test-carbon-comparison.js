// Test the carbon daily comparison calculation logic
// Run with: node test-carbon-comparison.js

// Emission factor: 0.82 kg/kWh
// Renewable percent: 22%
// Effective emission factor: 0.82 * (1 - 0.22) = 0.6396 kg/kWh

const emissionFactor = 0.82;
const renewablePercent = 22;
const effectiveEmissionFactor = emissionFactor * (1 - renewablePercent / 100);

// Yesterday: 133.4 kWh, 130 parts
// Today: 126.6 kWh, 129 parts
const yesterdayKwh = 133.4;
const todayKwh = 126.6;
const yesterdayParts = 130;
const todayParts = 129;

// Calculate CO2 emissions
const yesterdayCO2 = Math.round(yesterdayKwh * effectiveEmissionFactor * 100) / 100;
const todayCO2 = Math.round(todayKwh * effectiveEmissionFactor * 100) / 100;

// Calculate carbon intensity (CO2 per part)
const yesterdayIntensity = Math.round((yesterdayCO2 / yesterdayParts) * 1000) / 1000;
const todayIntensity = Math.round((todayCO2 / todayParts) * 1000) / 1000;

// Calculate percentage changes
const co2Change = ((todayCO2 - yesterdayCO2) / yesterdayCO2 * 100).toFixed(1);
const intensityChange = ((todayIntensity - yesterdayIntensity) / yesterdayIntensity * 100).toFixed(1);

console.log('\n=== Carbon Daily Comparison Test ===\n');

console.log('Configuration:');
console.log(`  Grid Emission Factor: ${emissionFactor} kg CO₂/kWh`);
console.log(`  Renewable Percent: ${renewablePercent}%`);
console.log(`  Effective Emission Factor: ${effectiveEmissionFactor.toFixed(4)} kg CO₂/kWh`);

console.log('\nEnergy Consumption:');
console.log(`  Yesterday: ${yesterdayKwh} kWh`);
console.log(`  Today: ${todayKwh} kWh`);

console.log('\nCO₂ Emissions:');
console.log(`  Yesterday: ${yesterdayCO2} kg CO₂`);
console.log(`  Today: ${todayCO2} kg CO₂`);
console.log(`  Change: ${co2Change}%`);

console.log('\nProduction:');
console.log(`  Yesterday: ${yesterdayParts} parts`);
console.log(`  Today: ${todayParts} parts`);

console.log('\nCarbon Intensity (kg CO₂ per part):');
console.log(`  Yesterday: ${yesterdayIntensity} kg/part`);
console.log(`  Today: ${todayIntensity} kg/part`);
console.log(`  Change: ${intensityChange}%`);

console.log('\n=== Expected API Response ===\n');
console.log(JSON.stringify({
  co2: {
    today: todayCO2,
    yesterday: yesterdayCO2,
    percentChange: parseFloat(co2Change)
  },
  carbonIntensity: {
    today: todayIntensity,
    yesterday: yesterdayIntensity,
    percentChange: parseFloat(intensityChange)
  }
}, null, 2));

console.log('\n=== Display Examples ===\n');
console.log(`CO₂ Today: ${todayCO2} kg`);
console.log(`  Trend: ${co2Change > 0 ? '▲' : '▼'} ${Math.abs(co2Change)}% vs yesterday`);
console.log(`  Color: ${co2Change < 0 ? 'GREEN (reduction)' : 'RED (increase)'}\n`);

console.log(`Carbon Intensity: ${todayIntensity} kg/part`);
console.log(`  Trend: ${intensityChange > 0 ? '▲' : '▼'} ${Math.abs(intensityChange)}% improving`);
console.log(`  Color: ${intensityChange < 0 ? 'GREEN (improvement)' : 'RED (worsening)'}`);

console.log('\n=== Formula Summary ===\n');
console.log('Effective Emission Factor = Grid EF × (1 - Renewable%)');
console.log('CO₂ = Energy (kWh) × Effective Emission Factor');
console.log('Carbon Intensity = CO₂ / Parts Produced');
console.log('Percentage Change = ((Today - Yesterday) / Yesterday) × 100');
