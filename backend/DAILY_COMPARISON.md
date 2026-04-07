# Day-Over-Day Percentage Calculations - Implementation Guide

## Overview
Converted hardcoded day-over-day percentage values in the Overview dashboard to real calculations based on actual database data.

## Changes Made

### 1. Backend API Endpoint
**File:** `backend/src/routes/metrics.js`

Added new endpoint: `GET /api/metrics/daily-comparison`

**Returns:**
```json
{
  "energy": {
    "today": 126.6,
    "yesterday": 133.4,
    "percentChange": -5.1
  },
  "parts": {
    "today": 129,
    "yesterday": 130,
    "percentChange": -0.8
  },
  "cost": {
    "today": 1076,
    "yesterday": 1134,
    "percentChange": -5.1
  },
  "energyPerPart": {
    "today": 0.98,
    "yesterday": 1.03,
    "percentChange": -4.3
  }
}
```

**Calculation Formula:**
```sql
Percentage Change = ((Today - Yesterday) / Yesterday) × 100
```

**SQL Query:**
- Sums `energy_kwh_used` and `parts_produced` from `machine_parts_produced` table
- Compares `CURRENT_DATE` vs `CURRENT_DATE - INTERVAL '1 day'`
- Calculates percentage changes with proper null handling
- Uses `tariff_per_kwh` from `system_config` for cost calculations

### 2. Frontend Integration
**File:** `frontend/src/pages/Overview.tsx`

**Changes:**
- Added state variable `dailyComparison` to store API response
- Added API call to `/metrics/daily-comparison` in useEffect
- Updated KPICard components to use real data instead of hardcoded values:
  - **Total Energy Today:** Uses `dailyComparison.energy.percentChange`
  - **Parts Produced:** Uses `dailyComparison.parts.percentChange`
  - **Avg Energy/Part:** Uses `dailyComparison.energyPerPart.percentChange`
  - **Energy Cost Today:** Uses `dailyComparison.cost.percentChange`

**Before:**
```tsx
<KPICard 
  title="Total Energy Today" 
  trend={{ value: -3.2, label: 'vs yesterday' }}  // Hardcoded
/>
```

**After:**
```tsx
<KPICard 
  title="Total Energy Today" 
  trend={dailyComparison ? { 
    value: dailyComparison.energy.percentChange, 
    label: 'vs yesterday' 
  } : undefined}  // Real data
/>
```

### 3. Database Requirements

**Primary Table:** `machine_parts_produced`
- Must have data for both today and yesterday
- Columns used: `energy_kwh_used`, `parts_produced`, `recorded_at`

**Sample Data Script:** `backend/database/seed_yesterday_data.sql`
- Adds test data for yesterday and today
- Run with: `psql -U postgres -d energy_db -f seed_yesterday_data.sql`

## Testing

### Manual Testing
1. **Run the test script:**
   ```bash
   cd backend
   node test-daily-comparison.js
   ```
   This shows expected calculations based on sample data.

2. **Seed yesterday's data:**
   ```bash
   psql -U postgres -d energy_db -f database/seed_yesterday_data.sql
   ```

3. **Test the API endpoint:**
   ```bash
   curl http://localhost:8000/api/metrics/daily-comparison
   ```

4. **View in frontend:**
   - Open the Overview dashboard
   - Check the KPI cards for "vs yesterday" trends
   - Values should now reflect real data differences

### Expected Behavior
- **Positive % (green ▲):** Today's value > Yesterday's value
- **Negative % (red ▼):** Today's value < Yesterday's value
- **Zero or no data:** Shows no trend indicator

### Edge Cases Handled
1. **No yesterday data:** Returns 0% change
2. **Division by zero:** Uses `NULLIF()` in SQL to prevent errors
3. **Missing data:** Returns 0 as fallback values
4. **API failure:** Frontend shows no trend indicator (graceful degradation)

## Data Flow

```
machine_parts_produced (PostgreSQL)
    ↓
SELECT SUM(energy_kwh_used), SUM(parts_produced)
WHERE recorded_at::date IN (CURRENT_DATE, CURRENT_DATE - 1)
    ↓
Calculate: (today - yesterday) / yesterday × 100
    ↓
GET /api/metrics/daily-comparison
    ↓
Frontend: Overview.tsx
    ↓
Display in KPICard with ▲ or ▼ indicator
```

## Calculation Examples

### Energy Change
```
Yesterday: 133.4 kWh
Today: 126.6 kWh
Change: ((126.6 - 133.4) / 133.4) × 100 = -5.1%
Display: "▼ 5.1% vs yesterday" (red)
```

### Parts Change
```
Yesterday: 130 parts
Today: 129 parts
Change: ((129 - 130) / 130) × 100 = -0.8%
Display: "▼ 0.8% vs yesterday" (red)
```

### Energy Per Part Improvement
```
Yesterday: 1.03 kWh/part
Today: 0.98 kWh/part
Change: ((0.98 - 1.03) / 1.03) × 100 = -4.3%
Display: "▼ 4.3% improvement" (red - which is good for this metric)
```

## Configuration

The cost calculation uses the `tariff_per_kwh` value from the `system_config` table:
```sql
SELECT tariff_per_kwh FROM system_config LIMIT 1;
```

Default: ₹8.5/kWh (configurable via Admin panel)

## Files Modified/Created

### Modified:
- `backend/src/routes/metrics.js` - Added `/daily-comparison` endpoint
- `frontend/src/pages/Overview.tsx` - Integrated real data

### Created:
- `backend/database/seed_yesterday_data.sql` - Sample data for testing
- `backend/test-daily-comparison.js` - Test calculation logic
- `backend/DAILY_COMPARISON.md` - This documentation file

## Maintenance Notes

- The endpoint queries `machine_parts_produced` table which is populated incrementally throughout the day
- Data is date-based (`recorded_at::date`) to ensure accurate day boundaries
- Calculations handle edge cases (null data, division by zero) gracefully
- Frontend gracefully degrades if API is unavailable (shows no trend)

## Future Enhancements

Potential improvements:
1. Add week-over-week comparisons
2. Add month-over-month comparisons  
3. Cache results for frequently accessed date ranges
4. Add more granular time comparisons (hourly, shift-based)
5. Add historical trend charts showing percentage changes over time
