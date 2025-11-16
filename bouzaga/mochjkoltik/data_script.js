/**** IGNITEGUARD – CYPRUS VEGETATION, RISK & SPREAD RATE DEMO ************
 * What this script does:
 * 1. Load Cyprus boundary
 * 2. Load Google Satellite Embedding V1 (2023) and display it
 * 3. Load Sentinel-2 (Aug 2023), compute NDVI & NDWI
 * 4. Create a Fuel / Vegetation Density index (NDVI-based)
 * 5. Create a Dryness-based Fire Risk Index
 * 6. Create a Spread Rate layer (0–30 m/min) using:
 *      fuel * dryness * lowWater * (1 + slope)
 *    -> Interpreted as RELATIVE potential rate of spread (ROS)
 * 7. Overlay example prevention actions and sample risk at these points
 * 8. Export the spread-rate layer as GeoTIFF (ROS_m_min)
 *************************************************************************/

// -----------------------------------------------------------------------
// 1. REGION: CYPRUS
// -----------------------------------------------------------------------
var countries = ee.FeatureCollection('FAO/GAUL/2015/level0');
var cyprus = countries
  .filter(ee.Filter.eq('ADM0_NAME', 'Cyprus'))
  .geometry();

Map.centerObject(cyprus, 8);
Map.addLayer(cyprus, {color: 'white'}, 'Cyprus boundary', false);

// -----------------------------------------------------------------------
// 2. SATELLITE EMBEDDING DATASET (INFO + VISUALIZATION)
// -----------------------------------------------------------------------
var embCol = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

// Annual product: take year 2023
var emb2023 = embCol
  .filterDate('2023-01-01', '2024-01-01')
  .filterBounds(cyprus)
  .mosaic()
  .clip(cyprus);

// Print metadata so you can inspect the "database"
print('Satellite Embedding 2023 image:', emb2023);
print('Embedding band names:', emb2023.bandNames());
print('Projection:', emb2023.projection());
print('Nominal scale (m):', emb2023.projection().nominalScale());

// Visualize 3 embedding axes as pseudo-RGB just to see structure
var embVis = {
  bands: ['A01', 'A16', 'A09'],
  min: -0.3,
  max:  0.3
};
Map.addLayer(emb2023, embVis, 'Satellite Embedding RGB (2023)', false);

// -----------------------------------------------------------------------
// 3. SENTINEL-2: NDVI + NDWI (DRYNESS & WATER CONTENT)
// -----------------------------------------------------------------------
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  // Use only August (peak dryness)
  .filterDate('2023-08-01', '2023-09-01')
  .filterBounds(cyprus)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(img) {
    // Apply scale factor 1e4 for S2 SR
    return img.divide(10000)
              .copyProperties(img, img.propertyNames());
  });

// Median composite for August
var s2Median = s2.median().clip(cyprus);

// NDVI = (NIR - RED) / (NIR + RED)  => B8, B4
var ndvi = s2Median.normalizedDifference(['B8', 'B4']).rename('NDVI');

// NDWI (vegetation water content style) = (GREEN - NIR) / (GREEN + NIR)
var ndwi = s2Median.normalizedDifference(['B3', 'B8']).rename('NDWI');

// Optional: visualize NDVI/NDWI
Map.addLayer(
  ndvi,
  {min: -0.2, max: 0.9, palette: ['brown', 'yellow', 'green']},
  'NDVI (Aug 2023)',
  false
);
Map.addLayer(
  ndwi,
  {min: -0.1, max: 0.3, palette: ['brown', 'yellow', 'blue']},
  'NDWI (Aug 2023)',
  false
);

// -----------------------------------------------------------------------
// 4. TOPOGRAPHY – SLOPE AS A FIRE-SPREAD FACTOR
// -----------------------------------------------------------------------
var dem = ee.Image('USGS/SRTMGL1_003').clip(cyprus);
var slope = ee.Terrain.slope(dem).rename('slope');

// -----------------------------------------------------------------------
// 5. INDICES: FUEL / VEGETATION + DRYNESS-BASED FIRE RISK
// -----------------------------------------------------------------------

// Helper: normalize an image band to 0–1 using fixed expected range
function normalize(img, minVal, maxVal) {
  var clipped = img.max(minVal).min(maxVal);
  return clipped.subtract(minVal).divide(maxVal - minVal);
}

// Normalize NDVI, NDWI, slope
// NDVI: typical range ~ [-0.2, 0.9]
var ndviNorm = normalize(ndvi, -0.2, 0.9);
// NDWI: tighter range for Cyprus ~ [-0.1, 0.3]
var ndwiNorm = normalize(ndwi, -0.1, 0.3);
// Slope: 0–60 degrees (cap)
var slopeNorm = normalize(slope, 0, 60);

// Dryness & water stress terms (with some amplification)
var dryness = ee.Image(1).subtract(ndviNorm)     // 1 - NDVI
  .multiply(1.5)                                // boost contrast
  .min(1)                                       // cap at 1
  .rename('dryness');                           // 0–1

var lowWater = ee.Image(1).subtract(ndwiNorm)   // 1 - NDWI
  .rename('lowWater');                          // 0–1

// -----------------------------------------------------------------------
// 5A. FUEL / VEGETATION DENSITY INDEX (MAIN LAYER)
//      0 = bare / urban / very low vegetation  -> green
//      1 = dense trees / forest                -> red
// -----------------------------------------------------------------------

// Use NDVI as fuel, but only above a minimum vegetation threshold
var fuelIndex = ndviNorm.gt(0.4).multiply(ndviNorm).rename('Fuel_Index');

// Color palette: green (low fuel) → yellow → red (high fuel)
var fuelVis = {
  min: 0,
  max: 1,
  palette: [
    '00ff00', // low vegetation  -> green
    'ffff00', // medium          -> yellow
    'ff0000'  // high vegetation -> red
  ]
};

Map.addLayer(fuelIndex, fuelVis, 'Fuel / Vegetation Density (NDVI-based)', true);

// Also make a 0–10 integer fuel index for external use
var fuelIndex_0_10 = fuelIndex
  .multiply(10)
  .round()
  .toInt16()
  .rename('Fuel10');

// -----------------------------------------------------------------------
// 5B. DRYNESS-BASED FIRE RISK INDEX (OPTIONAL EXTRA LAYER)
//      Higher when: vegetation is dry + low water + steeper slope
// -----------------------------------------------------------------------
var riskIndex = dryness.multiply(0.6)
  .add(lowWater.multiply(0.3))
  .add(slopeNorm.pow(1.2).multiply(0.1))  // slight extra weight on steeper slopes
  .rename('Fire_Risk_Index')
  .clip(cyprus);

var riskVis = {
  min: 0,
  max: 1,
  palette: [
    '1a9850', // low (green)
    'fee08b', // medium
    'f46d43', // high
    'a50026'  // extreme (dark red)
  ]
};

Map.addLayer(riskIndex, riskVis, 'Dryness-based Fire Risk Index', false);

// -----------------------------------------------------------------------
// 5C. SPREAD RATE LAYER (FUEL * DRYNESS * LOW WATER * (1+SLOPE))
//      Output: 0–30 m/min (heuristic, relative spread potential)
// -----------------------------------------------------------------------

// Fuel term: use fuelIndex (already masked below NDVI 0.4)
var fuel = fuelIndex;

// Basic combined spread factor (0–something)
var spreadFactor = fuel
  .multiply(dryness)                        // high fuel AND dry
  .multiply(lowWater)                       // AND low water (dry NDWI)
  .multiply(ee.Image(1).add(slopeNorm.pow(1.2))); // slope boosts spread

// Normalize spreadFactor to 0–1 by capping (heuristic cap at 1.5)
spreadFactor = spreadFactor.min(1.5).divide(1.5);

// Map 0–1 -> 0–30 m/min
var spreadRate_m_min = spreadFactor
  .multiply(30)
  .rename('ROS_m_min')
  .clip(cyprus);

var rosPhysVis = {
  min: 0,
  max: 30,
  palette: [
    '00ff00', // 0     -> very low spread
    'ffff00', // ~15   -> medium
    'ff0000'  // 30    -> high potential spread
  ]
};

Map.addLayer(
  spreadRate_m_min,
  rosPhysVis,
  'Spread Rate (Fuel + Dryness + Slope, 0–30 m/min)',
  false
);

// -----------------------------------------------------------------------
// 6. EXAMPLE PREVENTION ACTION POINTS (MOCK DATA)
//    Replace these with real Firebreak / Water Tank / Tower data.
// -----------------------------------------------------------------------
var actions = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point(32.79, 34.95), {
    id: 'FB-01',
    type: 'Firebreak',
    status: 'Planned',
    priority: 'High'
  }),
  ee.Feature(ee.Geometry.Point(33.05, 35.02), {
    id: 'WT-03',
    type: 'Water_Tank',
    status: 'Completed',
    priority: 'Medium'
  }),
  ee.Feature(ee.Geometry.Point(33.27, 34.90), {
    id: 'TW-02',
    type: 'Watch_Tower',
    status: 'In_Progress',
    priority: 'High'
  })
]);

print('Example prevention actions:', actions);

var actionVis = {
  color: 'cyan',
  pointRadius: 6
};

Map.addLayer(actions, actionVis, 'Prevention Actions (example)', true);

// -----------------------------------------------------------------------
// 7. SAMPLE RISK VALUES AT ACTION POINTS
//    (Useful for your dashboard table: risk at each action location)
// -----------------------------------------------------------------------
var riskAtActions = riskIndex.sampleRegions({
  collection: actions,
  properties: ['id', 'type', 'status', 'priority'],
  scale: 30
});

print('Fire risk index at each action location:', riskAtActions);

// -----------------------------------------------------------------------
// 8. EXPORT SPREAD-RATE LAYER (0–30 m/min) TO DRIVE AS GEOTIFF
// -----------------------------------------------------------------------
Export.image.toDrive({
  image: spreadRate_m_min,
  description: 'Cyprus_SpreadRate_m_min_fuel_dryness_slope',
  folder: 'EarthEngineExports',  // change if you want another folder
  fileNamePrefix: 'cyprus_spread_rate_fuel_dryness_slope',
  region: cyprus,
  scale: 30,                     // Sentinel-2 resolution
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// (Optional) Export fuel index 0–10 if useful for your simulator
Export.image.toDrive({
  image: fuelIndex_0_10,
  description: 'Cyprus_FuelIndex_0_10',
  folder: 'EarthEngineExports',
  fileNamePrefix: 'cyprus_fuel_index_0_10',
  region: cyprus,
  scale: 30,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
