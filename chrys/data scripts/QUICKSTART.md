# Quick Start Guide - Cyprus Fire Risk Visualization

## 🚀 Getting Started (5 minutes)

### Step 1: File Setup
Ensure all these files are in the same directory:
```
✅ index.html
✅ styles.css
✅ config.js
✅ mapUtils.js
✅ fireSimulation.js
✅ suppression.js
✅ uiControls.js
✅ cyprus_spread_rate_fuel_dryness_slope.tif
```

### Step 2: Open the Application
1. Open `index.html` in a modern web browser (Chrome, Firefox, Edge, Safari)
2. Wait for data to load (~2-3 seconds)
3. You should see the Cyprus map with colored risk overlay

### Step 3: Explore the Data (View Mode)
The application starts in **View Mode** by default.

**Try this:**
1. Click anywhere on the colored map area
2. Look at the right panel "Selected Location"
3. You'll see:
   - Coordinates
   - Raw value from GeoTIFF
   - Risk category (Very Low to Very High)
   - Rate of Spread (ROS) in meters/minute

**What the colors mean:**
- 🔵 Blue: Water / No fuel
- 🟢 Green: Very low risk (0-20%)
- 🟡 Yellow-Green: Low risk (20-40%)
- 🟡 Yellow: Medium risk (40-60%)
- 🟠 Orange: High risk (60-80%)
- 🔴 Red: Very high risk (80-100%)

---

## 🔥 Try a Fire Simulation (2 minutes)

### Step 1: Switch to Simulate Mode
1. In the right panel, find "Fire Simulation" section
2. Select the radio button: **"🔥 Start Fire (Click to ignite)"**

### Step 2: Set Wind Conditions (Optional)
1. Scroll down to "Wind Conditions"
2. Adjust **Wind Speed** (try 30 km/h for moderate wind)
3. Adjust **Wind Direction** (0° = North, 90° = East, 180° = South, 270° = West)

### Step 3: Start a Fire
1. Click on a **green, yellow, or red area** on the map
   - ❌ Don't click on water (blue areas)
2. A red dot appears = ignition point!
3. Timeline controls appear at the bottom

### Step 4: Watch the Fire Spread
1. Click **▶ Play** button
2. Watch fire spread from the ignition point
3. Notice:
   - Fire spreads faster in red areas (high risk)
   - Fire spreads slower in green areas (low risk)
   - Wind affects direction and speed
4. Use **⏸ Pause** to stop
5. Use **🗑 Clear** to remove the fire

### Step 5: Adjust Simulation
- **Simulation Duration**: Change from 3 days to longer/shorter
- **Timeline Slider**: Scrub through the simulation at any time

---

## 🚧 Try Fire Suppression (3 minutes)

### Step 1: Draw a Firebreak
1. Select mode: **"🚧 Draw Firebreak (Click & drag)"**
2. Adjust **Firebreak Width** (try 0.5 km)
3. Adjust **Firebreak Length** (try 5 km)
4. **Click and drag** on the map to draw a brown barrier
5. Release mouse to place it

### Step 2: Drop Water Bombs
1. Select mode: **"💧 Water Bomb (Click to drop)"**
2. Adjust **Water Bomb Radius** (try 0.5 km)
3. **Click** on the map to drop a blue water zone

### Step 3: Test Suppression Effectiveness
1. Place firebreaks and water drops **BEFORE** starting fire
2. Switch to **Simulate mode**
3. Start a fire near your suppression zones
4. Watch how fire is blocked by barriers!

### Step 4: Clear Suppression
- Click **"Clear All"** button in "Suppression Actions" section

---

## 📊 Understanding the Data

### What is ROS (Rate of Spread)?
**ROS = Speed of fire spread in meters per minute**

Examples:
- **0-1 m/min**: Very slow (low fuel, wet areas)
- **2-3 m/min**: Moderate spread (average conditions)
- **4-5 m/min**: Fast spread (dry fuel, slope, wind)
- **>5 m/min**: Extreme (with strong wind boost)

### What is the IgniteGuard Model?
A scientific formula that combines:
1. **Fuel**: Vegetation density (from NDVI satellite data)
2. **Dryness**: How dry the vegetation is
3. **Water Stress**: Lack of water content (from NDWI)
4. **Slope**: Terrain steepness (fire climbs hills faster)
5. **Wind**: Speed and direction

**Formula:**
```
SF = Fuel × Dryness × LowWater × (1 + Slope)
ROS = SF_norm × 30 m/min × calibration_factor
```

---

## 🎮 Advanced Features

### Realistic Fire Scenarios

**Scenario 1: Mountain Fire with Wind**
1. Set Wind: 40 km/h, Direction: 90° (East)
2. Start fire on **western slope** of mountains
3. Watch fire race uphill and downwind!

**Scenario 2: Coastal Fire Barrier**
1. Notice blue water areas along coast
2. Start fire inland
3. Watch fire stop at coastline (natural barrier)

**Scenario 3: Firebreak Defense**
1. Draw a 10 km firebreak around a village/area
2. Make it 0.5 km wide
3. Start fires OUTSIDE the firebreak
4. See if your defense holds!

### Timeline Scrubbing
- **Drag the timeline slider** to jump to any point
- Watch how fire grew over time
- Plan suppression based on historical spread

### Multi-Day Simulations
- Default: 3 days (72 hours)
- Try 7 days for large-scale events
- Try 1 day for quick tests

---

## 🔧 Troubleshooting

### "Cannot start fire on water"
- You clicked a blue area (water/no fuel)
- Click on colored areas (green/yellow/red)

### Fire spreads too fast/slow
- Check Wind Speed (higher = faster)
- Check Risk Level (red areas = faster)
- Adjust in `config.js` if needed

### Map not loading
- Ensure `cyprus_spread_rate_fuel_dryness_slope.tif` is in same folder
- Check browser console (F12) for errors
- Try a different browser

### Controls not working
- Ensure JavaScript is enabled
- Refresh the page
- Check that all `.js` files are loaded

---

## 🎯 Tips & Tricks

### Best Practices
1. **Start fires in yellow/red zones** for interesting simulations
2. **Use moderate wind (20-40 km/h)** for realistic spread
3. **Test suppression BEFORE** starting large fires
4. **Pause frequently** to inspect fire behavior

### Interesting Locations in Cyprus
- **Troodos Mountains** (center): High elevation, varied risk
- **Akamas Peninsula** (northwest): Dense vegetation, high risk
- **Coastal areas**: Natural fire barriers

### Experiment with Wind
- **No wind (0 km/h)**: Circular spread pattern
- **Light wind (10-20 km/h)**: Slight elongation
- **Moderate wind (30-50 km/h)**: Clear directional spread
- **Strong wind (60+ km/h)**: Extreme directional spread

---

## 📚 Learn More

### Want to customize?
Edit `config.js` to change:
- Spread speed (calibrationFactor)
- Animation speed
- Color thresholds
- Regional presets (Greece, California, etc.)

### Want different data?
Replace the GeoTIFF file with your own:
```javascript
// In index.html, change filename:
await MapUtils.loadGeoTIFF('your_file.tif');
```

### Want to understand the science?
Read the full `README.md` for:
- IgniteGuard formula explanation
- Data sources (Sentinel-2, SRTM)
- Model calibration
- Regional variations

---

## 🆘 Need Help?

### Check these first:
1. Browser console (F12) for error messages
2. `README.md` for detailed documentation
3. `config.js` comments for parameter explanations

### Common questions:

**Q: How accurate is this simulation?**
A: Calibrated to Cyprus real-world fires (~130 km² in 3 days). Good for planning and education, not operational firefighting.

**Q: Can I use this for other regions?**
A: Yes! Change preset in `config.js` or generate new GeoTIFF data using the Google Earth Engine script.

**Q: Why does fire stop at some areas?**
A: Water bodies, suppressed zones, or areas with no fuel data.

**Q: Can I export results?**
A: Currently view-only. Future versions may include GeoJSON export.

---

## ✅ Checklist - Did it work?

- [ ] Map loaded with colored Cyprus overlay
- [ ] Can click and see location info
- [ ] Can start a fire simulation
- [ ] Fire spreads when clicking Play
- [ ] Can draw firebreaks
- [ ] Can drop water bombs
- [ ] Wind affects fire direction
- [ ] Statistics update during simulation

**All checked?** 🎉 You're ready to explore!

---

**Happy Fire Modeling! 🔥**

*IgniteGuard Team - Cyprus Fire Hackathon 2025*
