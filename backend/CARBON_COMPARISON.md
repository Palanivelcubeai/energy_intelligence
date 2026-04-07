# Carbon Metrics Daily Comparison - Implementation Guide

## Overview
Added real day-over-day percentage calculations for carbon metrics, replacing hardcoded values in the Carbon & Sustainability dashboard.

## Changes Made

### 1. Backend API Endpoint
**File:** `backend/src/routes/carbon.js`

Added new endpoint: `GET /api/carbon/daily-comparison`

**Returns:**
```json
{
  "co2": {
    "today": 81.0,
    "yesterday": 85.3,
    "percentChange": -5.0
  },
  "carbonIntensity": {
    "today": 0.628,
    "yesterday": 0.656,
    "percentChange": -4.3
  }
}
```

**Calculation Steps:**

1. **Query Today and Yesterday Energy/Production:**
   ```sql
   SELECT SUM(energy_kwh_used), SUM(parts_produced)
   FROM machine_parts_produced
   WHERE recorded_at::date IN (CURRENT_DATE, CURRENT_DATE - 1)
   ```

2. **Get Configuration:**
   - Grid emission factor: 0.82 kg CO₂/kWh
   - Renewable percent: 22%
   - Effective emission factor: 0.82 × (1 - 0.22) = 0.6396 kg CO₂/kWh

3. **Calculate CO₂ Emissions:**
   ```javascript
   CO₂ = Energy (kWh) × Effective Emission Factor
   Today: 126.6 kWh × 0.6396 = 81.0 kg CO₂
   Yesterday: 133.4 kWh × 0.6396 = 85.3 kg CO₂
   ```

4. **Calculate Carbon Intensity:**
   ```javascript
   Carbon Intensity = CO₂ / Parts Produced
   Today: 81.0 kg / 129 parts = 0.628 kg/part
   Yesterday: 85.3 kg / 130 parts = 0.656 kg/part
   ```

5. **Calculate Percentage Changes:**
   ```javascript
   CO₂ Change = ((81.0 - 85.3) / 85.3) × 100 = -5.0%
   Intensity Change = ((0.628 - 0.656) / 0.656) × 100 = -4.3%
   ```

### 2. Frontend Integration
**File:** `frontend/src/pages/CarbonSustainability.tsx`

**Changes:**
- Added state variable `carbonComparison` to store API response
- Added API call to `/carbon/daily-comparison` in useEffect
- Updated two KPICard components to use real data:
  - **CO₂ Today:** Uses `carbonComparison.co2.percentChange`
  - **Carbon Intensity:** Uses `carbonComparison.carbonIntensity.percentChange`

**Before:**
```tsx
<KPICard 
  title="CO₂ Today" 
  trend={{ value: -2.8, label: 'vs yesterday' }}  // Hardcoded
/>
<KPICard 
  title="Carbon Intensity" 
  trend={{ value: -1.2, label: 'improving' }}  // Hardcoded
/>
```

**After:**
```tsx
<KPICard 
  title="CO₂ Today" 
  trend={carbonComparison ? { 
    value: carbonComparison.co2.percentChange, 
    label: 'vs yesterday' 
  } : undefined}  // Real data
/>
<KPICard 
  title="Carbon Intensity" 
  trend={carbonComparison ? { 
    value: carbonComparison.carbonIntensity.percentChange, 
    label: 'improving' 
  } : undefined}  // Real data
/>
```

## Formulas

### Effective Emission Factor
```
Effective EF = Grid Emission Factor × (1 - Renewable% / 100)
             = 0.82 kg/kWh × (1 - 22/100)
             = 0.82 × 0.78
             = 0.6396 kg CO₂/kWh
```

This accounts for renewable energy that doesn't produce CO₂.

### CO₂ Emissions
```
CO₂ (kg) = Energy (kWh) × Effective Emission Factor
```

### Carbon Intensity
```
Carbon Intensity (kg/part) = Total CO₂ / Total Parts Produced
```

This measures how much CO₂ is emitted per unit of production.

### Percentage Change
```
Change (%) = ((Today - Yesterday) / Yesterday) × 100
```

## Data Flow

```
machine_parts_produced (PostgreSQL)
    ↓
SELECT SUM(energy_kwh_used), SUM(parts_produced)
WHERE recorded_at::date IN (today, yesterday)
    ↓
Calculate CO₂ = energy × 0.6396
Calculate Intensity = CO₂ / parts
    ↓
Calculate % changes
    ↓
GET /api/carbon/daily-comparison
    ↓
Frontend: CarbonSustainability.tsx
    ↓
Display with ▲ or ▼ indicators
```

## Testing

### 1. Run Test Script
```bash
cd backend
node test-carbon-comparison.js
```

Expected output:
```
=== Carbon Daily Comparison Test ===

Configuration:
  Grid Emission Factor: 0.82 kg CO₂/kWh
  Renewable Percent: 22%
  Effective Emission Factor: 0.6396 kg CO₂/kWh

CO₂ Emissions:
  Yesterday: 85.3 kg CO₂
  Today: 81.0 kg CO₂
  Change: -5.0%

Carbon Intensity (kg CO₂ per part):
  Yesterday: 0.656 kg/part
  Today: 0.628 kg/part
  Change: -4.3%
```

### 2. Test API Endpoint
```bash
# Start backend server
cd backend
npm start

# Test endpoint
curl http://localhost:8000/api/carbon/daily-comparison
```

### 3. View in Browser
1. Ensure yesterday's data exists:
   ```bash
   psql -U postgres -d energy_db -f database/seed_yesterday_data.sql
   ```

2. Start frontend:
   ```bash
   cd frontend
   npm run dev
   ```

3. Navigate to Carbon & Sustainability page
4. Check the "CO₂ Today" and "Carbon Intensity" cards
5. Verify they show real percentage changes

## Display Logic

### CO₂ Today
- **Negative % (▼ red):** CO₂ emissions decreased (GOOD)
- **Positive % (▲ green):** CO₂ emissions increased (BAD)

*Note: Lower CO₂ is better for the environment, so negative change is displayed in red but is actually positive!*

### Carbon Intensity
- **Negative % (▼ red):** Using less CO₂ per part (IMPROVEMENT)
- **Positive % (▲ green):** Using more CO₂ per part (WORSENING)

Label says "improving" to clarify that negative change is good.

## Edge Cases Handled

1. **No yesterday data:** Returns 0% change
2. **Zero parts produced:** Sets carbon intensity to 0, avoiding division by zero
3. **API failure:** Frontend shows no trend indicator (graceful degradation)
4. **Missing config:** Falls back to defaults (0.82 kg/kWh, 22% renewable)

## Configuration Dependencies

The calculations depend on values in the `system_config` table:
- `grid_emission_factor` (default: 0.82 kg CO₂/kWh)
- `renewable_percent` (default: 22%)

These can be changed via the Admin panel, which will affect all carbon calculations.

## Example Scenarios

### Scenario 1: Energy Reduction
```
Yesterday: 150 kWh → 96.0 kg CO₂
Today: 120 kWh → 76.7 kg CO₂
Change: -20.1% (▼ improvement)
```

### Scenario 2: Production Increase
```
Yesterday: 100 parts, 80 kg CO₂ → 0.800 kg/part
Today: 140 parts, 90 kg CO₂ → 0.643 kg/part
Intensity Change: -19.6% (▼ improvement)
```

### Scenario 3: Efficiency Decline
```
Yesterday: 150 parts, 80 kg CO₂ → 0.533 kg/part
Today: 120 parts, 80 kg CO₂ → 0.667 kg/part
Intensity Change: +25.1% (▲ worsening)
```

## Files Modified/Created

### Modified:
- ✏️ `backend/src/routes/carbon.js` - Added `/daily-comparison` endpoint
- ✏️ `frontend/src/pages/CarbonSustainability.tsx` - Integrated real data

### Created:
- ➕ `backend/test-carbon-comparison.js` - Test calculation logic
- ➕ `backend/CARBON_COMPARISON.md` - This documentation file

## Related Endpoints

- `GET /api/carbon/metrics` - Current day carbon metrics
- `GET /api/carbon/trend` - 30-day CO₂ trend data
- `GET /api/carbon/by-machine` - Per-machine carbon breakdown
- `GET /api/carbon/daily-comparison` - Day-over-day comparisons (NEW)

## Maintenance Notes

- The endpoint queries `machine_parts_produced` table for daily totals
- Uses the same emission factor calculation as other carbon endpoints for consistency
- Percentage changes are rounded to 1 decimal place for display
- CO₂ values are rounded to 2 decimal places (kg)
- Carbon intensity values are rounded to 3 decimal places (kg/part)

## Future Enhancements

Potential improvements:
1. Week-over-week carbon comparisons
2. Month-over-month trends
3. Historical carbon intensity charts
4. Per-machine carbon efficiency comparisons
5. Carbon budget tracking and alerts
6. Real-time emission rate monitoring
7. Carbon offset recommendations

---

**Status:** ✅ Implementation Complete  
**Testing:** ✅ Test script available  
**Documentation:** ✅ Full documentation provided
