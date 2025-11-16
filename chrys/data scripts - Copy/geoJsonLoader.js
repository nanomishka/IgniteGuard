/**
 * GeoJSON Tile Loader Module
 * 
 * Handles loading and processing tile-based GeoJSON data with fire_rate values.
 * Designed for Kouris Dam AOI from Google Earth Engine export.
 */

const GeoJSONLoader = {
    geoJsonData: null,
    tiles: [],
    bounds: null,
    stats: {
        min: null,
        max: null,
        mean: null,
        median: null,
        count: 0,
        absMin: null,
        absMax: null,
        threshold20: null,
        threshold40: null,
        threshold60: null,
        threshold80: null,
        ros20: null,
        ros40: null,
        ros60: null,
        ros80: null,
        rosMax: null
    },
    tileLayer: null,
    tileMap: new Map(), // Fast lookup: "x,y" -> tile

    /**
     * Load GeoJSON file
     */
    async loadGeoJSON(filename) {
        try {
            const response = await fetch(filename);
            this.geoJsonData = await response.json();
            
            console.log('GeoJSON loaded:', this.geoJsonData.type);
            console.log('Number of tiles:', this.geoJsonData.features.length);

            // Process features
            this.processTiles();
            
            // Calculate statistics
            this.calculateStatistics();
            
            return true;
        } catch (error) {
            console.error('Error loading GeoJSON:', error);
            throw error;
        }
    },

    /**
     * Process GeoJSON features into tiles
     */
    processTiles() {
        this.tiles = this.geoJsonData.features.map(feature => {
            const props = feature.properties;
            const coords = feature.geometry.coordinates[0]; // Polygon coordinates
            
            // Calculate bounds from polygon
            const lats = coords.map(c => c[1]);
            const lngs = coords.map(c => c[0]);
            
            const tile = {
                id: feature.id,
                center: {
                    lat: props.center_lat,
                    lng: props.center_lon
                },
                bounds: {
                    south: Math.min(...lats),
                    north: Math.max(...lats),
                    west: Math.min(...lngs),
                    east: Math.max(...lngs)
                },
                fireRate: props.fire_rate, // ROS in m/min
                tileScale: props.tile_scale_m,
                geometry: feature.geometry
            };
            
            // Build spatial index for fast lookup
            this.addToTileMap(tile);
            
            return tile;
        });

        // Calculate overall bounds
        this.calculateBounds();
    },

    /**
     * Add tile to spatial index
     */
    addToTileMap(tile) {
        // Create grid keys for this tile (coarse grid for fast lookup)
        const latKey = Math.floor(tile.center.lat * 1000);
        const lngKey = Math.floor(tile.center.lng * 1000);
        const key = `${latKey},${lngKey}`;
        
        if (!this.tileMap.has(key)) {
            this.tileMap.set(key, []);
        }
        this.tileMap.get(key).push(tile);
    },

    /**
     * Find tile at lat/lng coordinates
     */
    getTileAtPoint(lat, lng) {
        // Quick lookup using spatial index
        const latKey = Math.floor(lat * 1000);
        const lngKey = Math.floor(lng * 1000);
        const key = `${latKey},${lngKey}`;
        
        const candidates = this.tileMap.get(key) || [];
        
        // Check if point is within any candidate tile bounds
        for (const tile of candidates) {
            if (lat >= tile.bounds.south && lat <= tile.bounds.north &&
                lng >= tile.bounds.west && lng <= tile.bounds.east) {
                return tile;
            }
        }
        
        // Fallback: check all tiles (slower but comprehensive)
        for (const tile of this.tiles) {
            if (lat >= tile.bounds.south && lat <= tile.bounds.north &&
                lng >= tile.bounds.west && lng <= tile.bounds.east) {
                return tile;
            }
        }
        
        return null;
    },

    /**
     * Calculate overall bounds of all tiles
     */
    calculateBounds() {
        if (this.tiles.length === 0) return;
        
        let south = Infinity, north = -Infinity;
        let west = Infinity, east = -Infinity;
        
        for (const tile of this.tiles) {
            south = Math.min(south, tile.bounds.south);
            north = Math.max(north, tile.bounds.north);
            west = Math.min(west, tile.bounds.west);
            east = Math.max(east, tile.bounds.east);
        }
        
        this.bounds = { south, north, west, east };
    },

    /**
     * Calculate statistics from tile fire rates
     */
    calculateStatistics() {
        const fireRates = this.tiles
            .map(t => t.fireRate)
            .filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);
        
        if (fireRates.length === 0) {
            this.stats = {
                min: 0, max: 1, mean: 0, median: 0, count: 0,
                absMin: 0, absMax: 1
            };
            return;
        }

        const sorted = fireRates.slice().sort((a, b) => a - b);
        const p50Index = Math.floor(fireRates.length * 0.50);
        
        this.stats.min = sorted[0];
        this.stats.max = sorted[sorted.length - 1];
        this.stats.mean = fireRates.reduce((a, b) => a + b, 0) / fireRates.length;
        this.stats.median = sorted[p50Index];
        this.stats.count = fireRates.length;
        this.stats.absMin = this.stats.min;
        this.stats.absMax = this.stats.max;
        
        // Calculate value thresholds for color bands
        const range = this.stats.max - this.stats.min;
        this.stats.threshold20 = this.stats.min + range * 0.2;
        this.stats.threshold40 = this.stats.min + range * 0.4;
        this.stats.threshold60 = this.stats.min + range * 0.6;
        this.stats.threshold80 = this.stats.min + range * 0.8;
        
        // ROS values at thresholds (already in m/min)
        this.stats.ros20 = this.stats.threshold20.toFixed(2);
        this.stats.ros40 = this.stats.threshold40.toFixed(2);
        this.stats.ros60 = this.stats.threshold60.toFixed(2);
        this.stats.ros80 = this.stats.threshold80.toFixed(2);
        this.stats.rosMax = this.stats.max.toFixed(2);
        
        // Set average ROS for fire simulation (if FireSimulation exists)
        if (typeof FireSimulation !== 'undefined') {
            FireSimulation.averageROS = this.stats.mean;
        }
        
        console.log('=== Tile Statistics ===');
        console.log('Fire Rate Range:', this.stats.min.toFixed(4), '-', this.stats.max.toFixed(4), 'm/min');
        console.log('Mean:', this.stats.mean.toFixed(4), 'Median:', this.stats.median.toFixed(4));
        console.log('=== ROS Thresholds ===');
        console.log('Green (0-20%):', this.stats.min.toFixed(4), '-', this.stats.threshold20.toFixed(4), 'm/min');
        console.log('YellowGreen (20-40%):', this.stats.threshold20.toFixed(4), '-', this.stats.threshold40.toFixed(4), 'm/min');
        console.log('Yellow (40-60%):', this.stats.threshold40.toFixed(4), '-', this.stats.threshold60.toFixed(4), 'm/min');
        console.log('Orange (60-80%):', this.stats.threshold60.toFixed(4), '-', this.stats.threshold80.toFixed(4), 'm/min');
        console.log('Red (80-100%):', this.stats.threshold80.toFixed(4), '-', this.stats.max.toFixed(4), 'm/min');
        console.log('Average ROS:', FireSimulation.averageROS.toFixed(3), 'm/min');
    },

    /**
     * Get color for fire rate value
     */
    getColor(fireRate) {
        if (fireRate === null || fireRate === undefined || isNaN(fireRate)) {
            return 'rgba(128, 128, 128, 0.5)';
        }
        
        if (fireRate <= 0) return 'rgba(100, 150, 255, 0.3)'; // Water/no fuel
        
        // Normalize based on actual data range
        const minVal = this.stats.absMin > 0 ? this.stats.absMin : 0.001;
        const maxVal = this.stats.absMax || 1;
        const range = maxVal - minVal;
        
        const normalized = (fireRate - minVal) / range;
        const clampedNorm = Math.max(0, Math.min(1, normalized));

        // Color gradient (green → yellow-green → yellow → orange → red)
        if (clampedNorm < 0.2) return `rgba(0, 255, 0, 0.7)`;        // Very Low
        if (clampedNorm < 0.4) return `rgba(154, 205, 50, 0.7)`;     // Low
        if (clampedNorm < 0.6) return `rgba(255, 255, 0, 0.7)`;      // Medium
        if (clampedNorm < 0.8) return `rgba(255, 165, 0, 0.7)`;      // High
        return `rgba(255, 0, 0, 0.7)`;                                 // Very High
    },

    /**
     * Render tiles on Leaflet map
     */
    renderTiles(map) {
        if (this.tileLayer) {
            map.removeLayer(this.tileLayer);
        }
        
        this.tileLayer = L.layerGroup();
        
        for (const tile of this.tiles) {
            const color = this.getColor(tile.fireRate);
            
            // Convert GeoJSON geometry to Leaflet polygon
            const coords = tile.geometry.coordinates[0].map(c => [c[1], c[0]]); // [lat, lng]
            
            const polygon = L.polygon(coords, {
                color: color,
                fillColor: color,
                fillOpacity: IgniteGuardConfig.overlayOpacity,
                weight: 0,
                className: 'fire-risk-tile'
            });
            
            // Store tile reference for interaction
            polygon.tileData = tile;
            
            this.tileLayer.addLayer(polygon);
        }
        
        this.tileLayer.addTo(map);
        
        // Fit map to bounds
        const bounds = [
            [this.bounds.south, this.bounds.west],
            [this.bounds.north, this.bounds.east]
        ];
        map.fitBounds(bounds);
    },

    /**
     * Update statistics display in UI
     */
    updateStatisticsDisplay() {
        document.getElementById('stats').innerHTML = `
            <div class="data-row">
                <span class="data-label">Fire Rate Range:</span>
                <span class="data-value">${this.stats.min != null ? this.stats.min.toFixed(2) : 'N/A'} - ${this.stats.max != null ? this.stats.max.toFixed(2) : 'N/A'} m/min</span>
            </div>
            <div class="data-row">
                <span class="data-label">Mean Fire Rate:</span>
                <span class="data-value">${this.stats.mean != null ? this.stats.mean.toFixed(2) : 'N/A'} m/min</span>
            </div>
            <div class="data-row">
                <span class="data-label">Median Fire Rate:</span>
                <span class="data-value">${this.stats.median != null ? this.stats.median.toFixed(2) : 'N/A'} m/min</span>
            </div>
            <div class="data-row">
                <span class="data-label">Number of Tiles:</span>
                <span class="data-value">${this.stats.count.toLocaleString()}</span>
            </div>
            <div class="data-row">
                <span class="data-label">Tile Resolution:</span>
                <span class="data-value">${this.tiles.length > 0 ? this.tiles[0].tileScale : 0} m</span>
            </div>
            <div class="data-row">
                <span class="data-label">Area:</span>
                <span class="data-value">Kouris Dam AOI</span>
            </div>
        `;
    },

    /**
     * Create legend based on fire rate ranges
     */
    createLegend() {
        const legendItems = document.getElementById('legend-items');
        
        if (!this.stats.min || !this.stats.max || !this.stats.threshold20) {
            legendItems.innerHTML = '<div style="color: #6c757d;">Loading legend...</div>';
            return;
        }
        
        const ranges = [
            { 
                label: 'Water/No Fuel', 
                color: 'rgba(100, 150, 255, 0.3)', 
                range: '≤ 0 m/min',
                desc: 'Non-burnable'
            },
            { 
                label: 'Very Low', 
                color: 'rgba(0, 255, 0, 0.7)', 
                range: `${this.stats.min.toFixed(2)} - ${this.stats.threshold20.toFixed(2)} m/min`,
                desc: 'Slow spread'
            },
            { 
                label: 'Low', 
                color: 'rgba(154, 205, 50, 0.7)', 
                range: `${this.stats.threshold20.toFixed(2)} - ${this.stats.threshold40.toFixed(2)} m/min`,
                desc: 'Moderate spread'
            },
            { 
                label: 'Medium', 
                color: 'rgba(255, 255, 0, 0.7)', 
                range: `${this.stats.threshold40.toFixed(2)} - ${this.stats.threshold60.toFixed(2)} m/min`,
                desc: 'Average spread'
            },
            { 
                label: 'High', 
                color: 'rgba(255, 165, 0, 0.7)', 
                range: `${this.stats.threshold60.toFixed(2)} - ${this.stats.threshold80.toFixed(2)} m/min`,
                desc: 'Fast spread'
            },
            { 
                label: 'Very High', 
                color: 'rgba(255, 0, 0, 0.7)', 
                range: `${this.stats.threshold80.toFixed(2)} - ${this.stats.max.toFixed(2)} m/min`,
                desc: 'Extreme spread'
            }
        ];

        legendItems.innerHTML = ranges.map(item => `
            <div class="legend-item">
                <div class="legend-color" style="background: ${item.color};"></div>
                <div>
                    <strong>${item.label}</strong><br>
                    <small style="color: #6c757d; line-height: 1.4;">
                        ${item.range}<br>
                        ${item.desc}
                    </small>
                </div>
            </div>
        `).join('') + `<div style="margin-top: 10px; font-size: 11px; color: #6c757d;">
            *IgniteGuard ROS Model - Kouris Dam AOI<br>
            Data from Google Earth Engine (100m tiles)
        </div>`;
    },

    /**
     * Toggle overlay visibility
     */
    toggleOverlay(visible) {
        if (this.tileLayer) {
            this.tileLayer.eachLayer(layer => {
                layer.setStyle({
                    fillOpacity: visible ? IgniteGuardConfig.overlayOpacity : 0,
                    opacity: visible ? 1 : 0
                });
            });
        }
        FireSimulation.overlayVisible = visible;
    },

    /**
     * Convert tile-based data to grid-like structure for fire simulation
     * This creates a virtual "grid" from the tile centers
     */
    createVirtualGrid() {
        // Find tile resolution (assume uniform)
        const tileSizeMeters = this.tiles[0]?.tileScale || 100;
        const tileSizeDegrees = tileSizeMeters / 111000; // approximate
        
        // Create grid representation
        const grid = {
            tiles: this.tiles,
            tileSize: tileSizeMeters,
            tileSizeDegrees: tileSizeDegrees,
            bounds: this.bounds,
            
            // Get tile at coordinates
            getTileAt: (lat, lng) => this.getTileAtPoint(lat, lng),
            
            // Get fire rate at coordinates
            getFireRateAt: (lat, lng) => {
                const tile = this.getTileAtPoint(lat, lng);
                return tile ? tile.fireRate : 0;
            },
            
            // Get neighbors of a tile (within radius)
            getNeighbors: (centerLat, centerLng, radiusMeters) => {
                const radiusDegrees = radiusMeters / 111000;
                const neighbors = [];
                
                for (const tile of this.tiles) {
                    const dist = Math.sqrt(
                        Math.pow(tile.center.lat - centerLat, 2) +
                        Math.pow((tile.center.lng - centerLng) * Math.cos(centerLat * Math.PI / 180), 2)
                    );
                    
                    if (dist <= radiusDegrees && dist > 0) {
                        neighbors.push({
                            tile: tile,
                            distance: dist * 111000 // convert back to meters
                        });
                    }
                }
                
                return neighbors;
            }
        };
        
        return grid;
    }
};
