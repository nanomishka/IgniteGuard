# Cyprus Fire Risk Visualization - IgniteGuard ROS Model

## Overview
This application visualizes fire risk data for Cyprus using the **IgniteGuard ROS (Rate of Spread) Model**. The system provides interactive fire simulation, suppression tools, and real-time risk analysis based on satellite imagery and terrain data.

## Project Structure

```
data scripts/
├── index.html              # Main HTML file (entry point)
├── styles.css              # All CSS styles
├── mapUtils.js            # Map initialization & GeoTIFF loading
├── fireSimulation.js      # Fire spread simulation (IgniteGuard ROS)
├── suppression.js         # Firebreak & water drop tools
├── uiControls.js          # Event handlers & UI interactions
└── cyprus_spread_rate_fuel_dryness_slope.tif  # GeoTIFF data file
```

## IgniteGuard ROS Model

### Formula
The Rate of Spread (ROS) is calculated using:

```
1. Fuel = NDVI_norm (vegetation index, 0-1)
2. Dryness = 1 - NDVI_norm
3. LowWater = 1 - NDWI_norm (water stress, 0-1)
4. Slope_norm = slope / 45° (normalized terrain slope, 0-1)

5. Spread Factor (SF) = Fuel × Dryness × LowWater × (1 + Slope_norm)
6. SF_norm = min(SF, 1.5) / 1.5
7. ROS (m/min) = SF_norm × 30 × calibration_factor
```

### Data Sources
- **Sentinel-2 (Aug 2023)**: NDVI & NDWI calculation
- **SRTM Elevation**: Terrain slope analysis
- **Calibration Factor**: 0.15 (tuned for Cyprus Mediterranean conditions)

### ROS Range
- **0-30 m/min** theoretical maximum for Mediterranean ecosystems
- **Average**: ~4.5 m/min based on Cyprus historical fire data
- **Calibration**: Matches real-world Cyprus fire behavior (~130 km² in 3 days)

## File Descriptions

### 1. `index.html`
- Main application structure
- Links all CSS and JavaScript modules
- Contains HTML layout (header, map, info panel)
- Initialization script

### 2. `styles.css`
- All application styling
- Responsive layout (map + side panel)
- Button styles, sliders, toggles
- Color schemes for UI elements

### 3. `mapUtils.js`
**Purpose**: Map and data management

**Key Functions**:
- `initializeMap()` - Creates Leaflet map centered on Cyprus
- `loadGeoTIFF()` - Loads and parses GeoTIFF file
- `preprocessData()` - Fills isolated zero values (data cleaning)
- `calculateStatistics()` - Computes min, max, mean, percentiles
- `getColor(value)` - Maps ROS values to color gradients
- `createLegend()` - Generates color legend with ROS ranges
- `toggleOverlay()` - Shows/hides risk overlay

**Color Scale**:
```
Green       (0-20%)  : Very Low Risk    (0-1.0 m/min)
Yellow-Green(20-40%) : Low Risk         (1.0-2.0 m/min)
Yellow      (40-60%) : Medium Risk      (2.0-3.0 m/min)
Orange      (60-80%) : High Risk        (3.0-4.0 m/min)
Red         (80-100%): Very High Risk   (4.0-4.5 m/min)
```

### 4. `fireSimulation.js`
**Purpose**: Fire spread simulation using IgniteGuard ROS

**Key Functions**:
- `initializeFire(lat, lng)` - Start fire at location
- `calculateROS(spreadFactor, windMultiplier)` - IgniteGuard formula
- `calculateWindInfluence(fromX, fromY, toX, toY)` - Wind effect on spread direction
- `calculateSpreadDistance(ros, timeHours)` - Distance traveled per time step
- `canCellBurn(x, y)` - Check if cell is burnable (has fuel, not water/suppressed)
- `hasPathToCell()` - Verify no barriers (water bodies, suppression zones)
- `simulateFireStep()` - Advance simulation by one time step
- `updateFireVisualization()` - Draw burned area on map
- `playFireAnimation()` / `stopFireAnimation()` - Control playback

**Parameters**:
- Base ROS: 30 m/min (Mediterranean maximum)
- Calibration Factor: 0.15
- Time Step: 1 hour
- Minimum Spread Threshold: 0.01

**Wind Effects**:
- With wind (0-45°): Multiplier up to 5x
- Perpendicular (45-135°): Multiplier 0.5-3x
- Against wind (135-180°): Multiplier down to 0.2x

### 5. `suppression.js`
**Purpose**: Fire suppression tools

**Key Functions**:
- `drawFirebreak(start, end)` - Create firebreak barrier
- `addWaterDrop(center)` - Drop water bomb (suppression zone)
- `constrainLineLength()` - Limit firebreak length
- `getLinePixels()` - Calculate affected cells for firebreak
- `getCirclePixels()` - Calculate affected cells for water drop
- `updateSuppressionStats()` - Update UI with suppression info
- `clearSuppressionActions()` - Remove all suppression

**Suppression Mechanics**:
- Firebreaks: Rectangular barriers (adjustable width 0.05-1.0 km, length 0.5-15 km)
- Water Drops: Circular zones (adjustable radius 0.1-2.0 km)
- Both create "suppressed cells" that fire cannot cross

### 6. `uiControls.js`
**Purpose**: User interface event handling

**Key Functions**:
- `init()` - Initialize all event listeners
- `initPlaybackControls()` - Play, pause, clear buttons
- `initModeSelector()` - View, simulate, firebreak, water drop modes
- `initWindControls()` - Wind speed & direction sliders
- `initSuppressionControls()` - Firebreak & water drop parameter sliders
- `initOverlayToggle()` - Risk overlay visibility
- `initTimelineControls()` - Simulation timeline scrubbing
- `initMapEvents()` - Map clicks, drawing, location inspection

## Usage

### Getting Started
1. Open `index.html` in a web browser
2. Ensure `cyprus_spread_rate_fuel_dryness_slope.tif` is in the same directory
3. Wait for data to load (shows loading indicator)

### Modes

#### 1. View Data Mode (Default)
- Click anywhere on the map to inspect:
  - Raw data value
  - Risk category (Very Low to Very High)
  - Rate of Spread (ROS) in m/min
  - Wind influence percentage

#### 2. Fire Simulation Mode
- Click on map to start a fire
- Configure:
  - Simulation duration (1-30 days)
  - Wind speed (0-100 km/h)
  - Wind direction (0-360°)
- Controls:
  - ▶ Play: Start simulation
  - ⏸ Pause: Pause simulation
  - 🗑 Clear: Remove fire
- Timeline: Scrub through simulation time

#### 3. Firebreak Mode
- Click and drag to draw firebreak
- Adjust width (0.05-1.0 km) and length (0.5-15 km)
- Firebreaks block fire spread

#### 4. Water Drop Mode
- Click to drop water bomb
- Adjust radius (0.1-2.0 km)
- Water drops suppress fire in circular zone

### Wind Effects
- **No Wind**: Fire spreads uniformly based on fuel/terrain
- **With Wind**: Fire spreads faster downwind, slower upwind
- **Strong Wind (>50 km/h)**: Dramatic directional spread

### Suppression Actions
- Firebreaks and water drops persist across simulations
- Use "Clear All" button to remove suppression
- Suppression stats show total coverage

## Technical Details

### Dependencies
- **Leaflet 1.9.4**: Interactive map library
- **georaster 1.6.0**: GeoTIFF parsing
- **georaster-layer-for-leaflet 3.10.0**: GeoTIFF visualization on Leaflet

### Data Format
- **Input**: GeoTIFF file with spread rate values
- **Projection**: EPSG:4326 (WGS84)
- **Resolution**: 30m (Sentinel-2 native)
- **NoData Handling**: Automatic detection and filtering

### Performance
- **Preprocessing**: Fills isolated zero values (1-2 seconds)
- **Statistics**: Calculates on load (~1 second)
- **Simulation**: 500ms per time step (1 hour simulated time)
- **Max Search Radius**: 8 cells (performance vs accuracy trade-off)

### Browser Compatibility
- Modern browsers (Chrome, Firefox, Edge, Safari)
- Requires JavaScript enabled
- Recommended: Desktop/laptop for best experience

## Customization

### Adjust Calibration Factor
In `fireSimulation.js`:
```javascript
calibrationFactor: 0.15  // Increase for faster spread, decrease for slower
```

### Change Color Scale
In `mapUtils.js`, modify `getColor()` function thresholds.

### Adjust Time Step
In `fireSimulation.js`:
```javascript
timeStepHours: 1  // Increase for faster simulation
```

### Different GeoTIFF File
In `index.html`:
```javascript
await MapUtils.loadGeoTIFF('your_file.tif');
```

## Google Earth Engine Script

The provided Earth Engine script generates the GeoTIFF data:

1. Load Cyprus boundary
2. Get Sentinel-2 imagery (Aug 2023)
3. Calculate NDVI and NDWI
4. Normalize indices to 0-1 range
5. Get SRTM slope
6. Calculate IgniteGuard ROS
7. Export as GeoTIFF

## Future Enhancements

- [ ] Real-time weather data integration
- [ ] Multiple ignition points
- [ ] Fire perimeter export (GeoJSON)
- [ ] Historical fire event comparison
- [ ] Mobile-responsive design
- [ ] 3D terrain visualization
- [ ] Smoke/plume modeling

## License
MIT License

## Contributors
IgniteGuard Team - Cyprus Fire Hackathon 2025

## References
- IgniteGuard ROS Model: Mediterranean fire behavior research
- Sentinel-2 Data: ESA Copernicus Program
- SRTM Elevation: NASA/USGS
- Cyprus Fire Statistics: Cyprus Department of Forests
