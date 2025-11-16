# 🏗️ Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      index.html                           │  │
│  │                   (Entry Point)                           │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                            │
│         ┌───────────┴───────────┐                                │
│         ▼                       ▼                                │
│  ┌─────────────┐        ┌─────────────┐                         │
│  │ styles.css  │        │  config.js  │                         │
│  │  (UI Look)  │        │ (Settings)  │                         │
│  └─────────────┘        └──────┬──────┘                         │
│                                 │                                │
│                    ┌────────────┴────────────┐                  │
│                    ▼                         ▼                  │
│         ┌──────────────────┐      ┌──────────────────┐         │
│         │   mapUtils.js    │      │ fireSimulation.js│         │
│         │  - Map setup     │      │  - Fire logic    │         │
│         │  - Load GeoTIFF  │      │  - ROS calc      │         │
│         │  - Statistics    │      │  - Spread algo   │         │
│         │  - Visualization │      │  - Wind effects  │         │
│         └────────┬─────────┘      └─────────┬────────┘         │
│                  │                           │                  │
│                  │         ┌─────────────────┴────┐             │
│                  │         ▼                      ▼             │
│                  │  ┌──────────────┐    ┌──────────────┐       │
│                  │  │suppression.js│    │uiControls.js │       │
│                  │  │ - Firebreaks │    │ - Events     │       │
│                  │  │ - Water drops│    │ - Handlers   │       │
│                  │  └──────────────┘    └──────────────┘       │
│                  │                                              │
│                  ▼                                              │
│         ┌─────────────────┐                                     │
│         │   Leaflet Map   │                                     │
│         │  (with layers)  │                                     │
│         └─────────────────┘                                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │   GeoTIFF      │
                  │   Data File    │
                  └────────────────┘
```

---

## Module Dependencies

```
config.js (No dependencies)
    ↓
mapUtils.js (depends on: config.js)
    ↓
fireSimulation.js (depends on: config.js, mapUtils.js)
    ↓
suppression.js (depends on: config.js, fireSimulation.js, mapUtils.js)
    ↓
uiControls.js (depends on: all above)
    ↓
index.html (loads all)
```

---

## Data Flow Diagram

### 1. Application Initialization

```
User opens index.html
        ↓
Load external libraries
  - Leaflet
  - GeoRaster
        ↓
Load config.js
  → Set parameters
  → Validate settings
        ↓
Load mapUtils.js
  → Initialize map
  → Fetch GeoTIFF
  → Preprocess data
  → Calculate statistics
  → Create visualization
        ↓
Load fireSimulation.js
  → Setup fire engine
  → Configure ROS model
        ↓
Load suppression.js
  → Setup suppression tools
        ↓
Load uiControls.js
  → Attach event listeners
  → Enable interactions
        ↓
Application ready! ✅
```

### 2. Fire Simulation Flow

```
User clicks "Start Fire"
        ↓
uiControls.js captures click
        ↓
fireSimulation.js initializes fire
  → Validate location
  → Calculate pixel size
  → Set ignition point
  → Capture wind params
        ↓
User clicks "Play"
        ↓
fireSimulation.js starts animation
        ↓
Every 500ms (time step):
  ├─→ simulateFireStep()
  │    ├─→ For each fire front cell:
  │    │    ├─→ Get cell spread factor
  │    │    ├─→ Calculate ROS (IgniteGuard)
  │    │    ├─→ Calculate wind influence
  │    │    ├─→ Find spreadable neighbors
  │    │    └─→ Add to new fire front
  │    └─→ Update fire front
  │
  └─→ updateFireVisualization()
       ├─→ Draw burned cells
       ├─→ Calculate statistics
       └─→ Update UI
```

### 3. Suppression Flow

```
User selects "Draw Firebreak"
        ↓
User drags on map
        ↓
uiControls.js captures drag
        ↓
suppression.js draws firebreak
  ├─→ Constrain length
  ├─→ Calculate rectangle corners
  ├─→ Draw on map
  ├─→ Get affected cells
  ├─→ Mark as suppressed
  └─→ Update stats
        ↓
Fire simulation respects barriers
  → canCellBurn() checks suppressed cells
  → Fire blocked! 🚧
```

---

## Component Interaction Matrix

| Component | mapUtils | fireSimulation | suppression | uiControls | config |
|-----------|----------|----------------|-------------|------------|--------|
| **mapUtils** | - | Provides georaster | Provides georaster | Provides map | Uses settings |
| **fireSimulation** | Reads stats | - | Checks suppressed cells | Called by events | Uses parameters |
| **suppression** | Uses map | Writes suppressed cells | - | Called by events | Uses settings |
| **uiControls** | Calls methods | Calls methods | Calls methods | - | Uses settings |
| **config** | Read by all | Read by all | Read by all | Read by all | - |

---

## State Management

```
Global State:
├── window.georaster (from mapUtils)
├── window.stats (from mapUtils)
└── MapUtils.map (Leaflet instance)

FireSimulation State:
├── active: boolean
├── ignitionPoint: {lat, lng, x, y}
├── currentTime: number
├── maxTime: number
├── burnedCells: Set<string>
├── fireFront: Array<{x, y, time, ros}>
├── windSpeed: number
├── windDirection: number
├── firebreaks: Array<object>
├── waterdrops: Array<object>
└── suppressedCells: Set<string>

MapUtils State:
├── map: L.Map
├── georasterLayer: GeoRasterLayer
├── georaster: GeoRaster
└── stats: object

SuppressionUtils State:
├── (mostly uses FireSimulation state)
└── suppressionLayer: L.LayerGroup
```

---

## Event Flow

```
User Interaction → uiControls.js → Appropriate Module → Update State → Update UI

Examples:

Click Map (View Mode):
  map.on('click') → uiControls.handleMapClick() → Display info in panel

Click Map (Simulate Mode):
  map.on('click') → uiControls.handleMapClick() → fireSimulation.initializeFire()
    → Enable controls → Update UI

Click Play:
  button.click → uiControls → fireSimulation.playFireAnimation()
    → setInterval() → simulateFireStep() → updateFireVisualization()

Drag Firebreak:
  map.on('mousedown') → Start drawing
  map.on('mouseup') → suppression.drawFirebreak() → Update map

Adjust Wind:
  slider.input → uiControls → Update fireSimulation.windSpeed
    → Affects next simulation step
```

---

## File Loading Sequence

```
1. index.html
    ↓
2. External CSS
   - Leaflet CSS
   - styles.css
    ↓
3. HTML rendered
    ↓
4. External JS libraries
   - Leaflet
   - GeoRaster
   - GeoRasterLayer
    ↓
5. Custom modules (in order)
   - config.js
   - mapUtils.js
   - fireSimulation.js
   - suppression.js
   - uiControls.js
    ↓
6. DOMContentLoaded event
    ↓
7. Initialize application
   - MapUtils.initializeMap()
   - MapUtils.loadGeoTIFF()
   - UIControls.init()
    ↓
8. Ready for user interaction ✅
```

---

## Memory Management

```
Static Data (loaded once):
└── GeoRaster (cyprus_spread_rate_fuel_dryness_slope.tif)
    - values: Float32Array
    - width × height pixels
    - ~10-50 MB depending on resolution

Dynamic Data (changes during simulation):
└── Fire Simulation
    - burnedCells: Set (grows over time)
    - fireFront: Array (typically 50-500 cells)
    - cellROSValues: Map (tracks ROS for burned cells)
    - ~1-5 MB during active simulation

Cached Data:
└── Statistics (calculated once)
    - min, max, mean, median
    - thresholds, ROS values
    - ~1 KB

Visualization Layers:
└── Leaflet Layers
    - Base map tiles (cached by browser)
    - GeoRaster overlay (rendered from data)
    - Fire layer (rectangles, ~100-10000 shapes)
    - Suppression layer (lines, circles)
```

---

## Performance Considerations

```
Bottlenecks:
1. GeoTIFF Loading: ~1-2 seconds
   → Solution: Show loading indicator

2. Data Preprocessing: ~1-2 seconds
   → Solution: One-time on load, cached

3. Fire Simulation Step: ~50-200ms per step
   → Solution: Limit search radius (8 cells)
   → Solution: Use Set for fast lookups

4. Visualization Update: ~10-50ms
   → Solution: Batch updates, use requestAnimationFrame

Optimizations:
✅ Use Set for burned cells (O(1) lookup)
✅ Use Map for cell ROS values (O(1) access)
✅ Cap search radius (trade accuracy for speed)
✅ Cache statistics (calculate once)
✅ Throttle animation (500ms per step)
✅ Use efficient color calculation
```

---

## Error Handling Flow

```
Try to load GeoTIFF
    ↓
  Error?
    ├─ Yes → Display error message in stats panel
    │        → Log to console
    │        → Graceful degradation
    └─ No → Continue

Try to start fire
    ↓
  Valid location?
    ├─ No → Alert user ("Cannot start fire on water")
    │       → Return without starting
    └─ Yes → Initialize fire

Try to simulate step
    ↓
  Fire front empty?
    ├─ Yes → Stop simulation
    │        → Display final stats
    └─ No → Continue spreading
```

---

## Configuration System Flow

```
Application starts
    ↓
Load config.js
    ↓
Validate configuration
    ↓
Apply to modules:
  ├─→ fireSimulation.js uses ROS parameters
  ├─→ mapUtils.js uses visualization settings
  ├─→ suppression.js uses suppression defaults
  └─→ uiControls.js uses animation speed
    ↓
User can:
  ├─→ Change preset: IgniteGuardConfig.loadPreset('greece')
  ├─→ Modify values: IgniteGuardConfig.baseROS = 35
  ├─→ Export settings: IgniteGuardConfig.export()
  └─→ Import settings: IgniteGuardConfig.import(json)
```

---

## Module Responsibilities

```
┌──────────────┐
│  config.js   │ → Configuration management
├──────────────┤    - Store parameters
│  PROVIDES:   │    - Validate settings
│  - Settings  │    - Regional presets
│  - Presets   │    - Export/import
│  - Validate  │
└──────────────┘

┌──────────────┐
│ mapUtils.js  │ → Data & visualization
├──────────────┤    - Initialize map
│  PROVIDES:   │    - Load GeoTIFF
│  - Map       │    - Calculate stats
│  - GeoRaster │    - Color mapping
│  - Stats     │    - Legend
│  - Visualize │
└──────────────┘

┌─────────────────┐
│fireSimulation.js│ → Fire spread logic
├─────────────────┤   - IgniteGuard ROS
│  PROVIDES:      │   - Wind effects
│  - Fire engine  │   - Spread algorithm
│  - ROS calc     │   - Animation
│  - Wind logic   │   - Visualization
│  - Animation    │
└─────────────────┘

┌──────────────┐
│suppression.js│ → Suppression tools
├──────────────┤   - Draw firebreaks
│  PROVIDES:   │   - Water drops
│  - Firebreaks│   - Cell marking
│  - WaterDrops│   - Statistics
│  - Barriers  │
└──────────────┘

┌──────────────┐
│uiControls.js │ → User interaction
├──────────────┤   - Event handling
│  PROVIDES:   │   - Mode switching
│  - Events    │   - Control bindings
│  - Handlers  │   - UI updates
│  - Modes     │
└──────────────┘
```

---

## Future Architecture Considerations

### Possible Enhancements:

```
1. WebWorkers for heavy computation
   - Move fire simulation to background thread
   - Non-blocking UI during calculation

2. IndexedDB for caching
   - Cache GeoTIFF locally
   - Faster repeated loads

3. Service Worker for offline support
   - Work without internet
   - Cache all resources

4. WebSocket for real-time data
   - Live weather updates
   - Multiple users collaboration

5. Export/Import API
   - Save/load simulations
   - Share scenarios
```

---

**Understanding this architecture will help you:**
- 🔍 Debug issues faster
- 🛠️ Make modifications safely
- 🚀 Add features efficiently
- 📚 Maintain code quality
