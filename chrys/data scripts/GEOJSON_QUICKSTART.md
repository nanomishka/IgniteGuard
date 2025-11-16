# GeoJSON Tile-Based Fire Simulation - Quick Start

## Overview
The application has been successfully migrated from GeoTIFF raster format to GeoJSON tile-based format for improved performance and more localized analysis of the Kouris Dam Area of Interest (AOI).

## What Changed

### Data Format
- **Before**: GeoTIFF raster files (pixel-based)
- **After**: GeoJSON tiles (vector-based, 100m resolution)
- **Source**: Google Earth Engine IgniteGuard ROS model

### New Files
1. **geoJsonLoader.js** - Loads and processes GeoJSON tiles
2. **fireSimulationTiles.js** - Tile-based fire simulation
3. **uiControlsTiles.js** - Updated UI controls

### Data File
- **File**: `IgniteGuard_Kouris_ROS_tiles_100m_JSON.geojson`
- **Location**: Same folder as index.html
- **Format**: GeoJSON FeatureCollection with Polygon tiles

## How to Test

### 1. File Setup
Ensure these files are in the same directory:
```
index.html
config.js
geoJsonLoader.js
fireSimulationTiles.js
uiControlsTiles.js
styles.css
IgniteGuard_Kouris_ROS_tiles_100m_JSON.geojson
```

### 2. Launch Application
Open `index.html` in a web browser (preferably Chrome or Firefox).

**Important**: Due to browser security restrictions, you may need to:
- Use a local web server (recommended)
- Or open Chrome with: `chrome --allow-file-access-from-files`

#### Using Python Simple Server
```powershell
# Navigate to project folder
cd "d:\business\6_Hackthons_Seminars\Fire Hackathon\data scripts"

# Start server (Python 3)
python -m http.server 8000

# Open browser to: http://localhost:8000
```

#### Using VS Code Live Server
1. Install "Live Server" extension in VS Code
2. Right-click `index.html`
3. Select "Open with Live Server"

### 3. Test the Application

#### Check Data Loading
1. Open browser console (F12)
2. Look for these messages:
   ```
   🔥 IgniteGuard Kouris Dam Fire Risk Visualization
   GeoJSON loaded: FeatureCollection
   Number of tiles: [count]
   📍 Kouris Dam AOI loaded with [count] tiles
   ```

#### View Tile Data
1. Ensure "📊 View Data" mode is selected
2. Click anywhere on the colored tiles
3. Check the "Location Information" panel for:
   - Coordinates
   - Tile center
   - Fire rate (ROS in m/min)
   - Risk category
   - Risk level percentage

#### Test Fire Simulation
1. Switch to "🔥 Start Fire" mode
2. Click on a colored tile (avoid water/no-data areas)
3. A red marker should appear
4. Click "▶️ Play" to start simulation
5. Watch fire spread to neighboring tiles
6. Observe the "Simulation Status" panel updating

#### Test Wind Effects
1. Start a fire simulation
2. Adjust "Wind Speed" slider (0-100 km/h)
3. Adjust "Wind Direction" slider (0-360°)
4. Notice faster spread in wind direction

#### Test Controls
- **▶️ Play** - Start/resume simulation
- **⏸️ Pause** - Pause (button text changes)
- **⏭️ Step** - Advance one timestep manually
- **🔄 Reset** - Clear simulation and restart

## Expected Behavior

### Map Display
- **Colored tiles**: Fire risk zones (green = low, red = high)
- **Legend**: Shows 6 risk categories with ROS ranges
- **Statistics Panel**: Shows fire rate range, mean, median, tile count

### Fire Simulation
- Fire starts at clicked tile
- Spreads to neighboring tiles based on:
  - Pre-calculated fire rates from GeoJSON
  - Wind speed and direction
  - Time step configuration
- Red polygons show burned areas
- Simulation stops when:
  - No more fuel to burn
  - Maximum time reached (72 hours)
  - User clicks Reset

### Performance
- **Fast loading**: GeoJSON is more efficient than GeoTIFF
- **Smooth interaction**: Tile-based lookup is faster than pixel scanning
- **Smaller area**: Kouris Dam AOI is more focused than full Cyprus

## Troubleshooting

### Issue: GeoJSON not loading
**Solution**: 
- Check file path in console
- Ensure file is in correct directory
- Use a local web server (not file://)

### Issue: "Please click within the Kouris Dam area"
**Solution**:
- The tiles only cover Kouris Dam AOI
- Zoom in to see colored tiles
- Click on a colored area (not gray/water)

### Issue: Fire won't start
**Solution**:
- Ensure you're in "🔥 Start Fire" mode
- Click on a tile with fire_rate > 0 (colored, not water)
- Check console for error messages

### Issue: Map is blank
**Solution**:
- Check internet connection (OpenStreetMap tiles need internet)
- Wait for GeoJSON to load (may take a few seconds)
- Check browser console for errors

### Issue: Simulation doesn't advance
**Solution**:
- Check that fire has neighbors to spread to
- Increase wind speed to help spread
- Use Step button to advance manually
- Verify tiles have valid fire rates

## Technical Details

### Tile Structure
Each GeoJSON tile contains:
```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], ...]]
  },
  "properties": {
    "fire_rate": 4.74,        // m/min (pre-calculated ROS)
    "center_lat": 34.779,
    "center_lon": 32.922,
    "tile_scale_m": 100       // 100m × 100m
  }
}
```

### Fire Spread Algorithm
1. Start at ignition point
2. Find neighboring tiles within spread distance
   - Distance = ROS × time_step
   - ROS adjusted by wind and calibration factor
3. Burn reachable tiles
4. Add new tiles to fire front
5. Repeat until no more spread

### Spatial Indexing
- Tiles stored in hash map by lat/lng keys
- Fast O(1) lookup for tiles at coordinates
- Efficient neighbor finding within radius

## Next Steps

### Potential Enhancements
1. **Add firebreak tool** - Draw barriers to stop fire
2. **Add water drop tool** - Suppress fire in areas
3. **Export results** - Save burned area as GeoJSON
4. **Time series animation** - Show fire progression
5. **Statistics export** - Generate CSV report
6. **Compare scenarios** - Side-by-side simulations

### Data Improvements
1. Higher resolution tiles (50m or 25m)
2. Real-time weather integration
3. Historical fire validation
4. Multiple AOIs (different regions)

## Support

### Console Logging
Enable detailed logging by checking browser console (F12):
- Tile loading progress
- Fire simulation steps
- Statistics calculations
- Error messages

### Debugging Tips
1. Check `window.fireGrid` in console - should contain tiles
2. Check `GeoJSONLoader.tiles.length` - should be > 0
3. Check `FireSimulation.active` - should be true during simulation
4. Check `FireSimulation.fireFront.length` - should be > 0 while spreading

### Contact
For issues or questions, check the console output first, then review the code comments in the JavaScript modules.

---

**Last Updated**: Migration to GeoJSON tile-based format
**Area**: Kouris Dam AOI, Cyprus
**Data Source**: Google Earth Engine IgniteGuard ROS Model
