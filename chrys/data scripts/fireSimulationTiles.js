/**
 * Fire Simulation Module (Tile-Based)
 * 
 * Implements fire spread simulation using GeoJSON tile data with pre-calculated
 * fire rates from the IgniteGuard ROS model.
 */

const FireSimulation = {
    // State
    active: false,
    ignitionPoint: null,
    currentTime: 0,
    maxTime: 72, // hours
    playing: false,
    animationInterval: null,
    fireMarker: null,
    fireLayer: null,
    burnedTiles: new Set(), // Store tile IDs that have burned
    fireFront: [], // Active fire front tiles
    mapMode: 'view',
    overlayVisible: true,
    
    // Scientific parameters from config
    get baseROS() { return IgniteGuardConfig.baseROS; },
    get calibrationFactor() { return IgniteGuardConfig.calibrationFactor; },
    get minSpreadThreshold() { return IgniteGuardConfig.minSpreadThreshold; },
    get timeStepHours() { return IgniteGuardConfig.timeStepHours; },
    averageROS: null, // calculated from tile data
    
    // Wind parameters
    windSpeed: 0, // km/h
    windDirection: 0, // degrees (0=N, 90=E, 180=S, 270=W)
    
    // Suppression
    firebreaks: [],
    waterdrops: [],
    suppressionLayer: null,
    suppressedTiles: new Set(),
    isDrawing: false,
    drawStart: null,
    firebreakWidth: 0.1, // km
    firebreakLength: 2.0, // km
    waterdropRadius: 0.3, // km

    /**
     * Initialize fire at a specific location
     */
    initializeFire(lat, lng, map) {
        this.clearFireSimulation(map);
        
        // Find tile at click location
        const tile = window.fireGrid.getTileAt(lat, lng);
        
        if (!tile) {
            alert('Please click within the Kouris Dam area');
            return false;
        }

        // Check if location has valid fire rate data
        if (tile.fireRate === null || tile.fireRate === undefined || 
            isNaN(tile.fireRate) || tile.fireRate <= 0) {
            alert('Cannot start fire on water or areas with no fuel. Please select a location with vegetation.');
            return false;
        }

        this.active = true;
        this.ignitionPoint = { 
            lat: tile.center.lat, 
            lng: tile.center.lng, 
            tileId: tile.id 
        };
        this.currentTime = 0;
        this.burnedTiles.clear();
        this.fireFront = [{ 
            tile: tile, 
            time: 0,
            lat: tile.center.lat,
            lng: tile.center.lng
        }];

        // Create fire layer
        if (this.fireLayer) {
            map.removeLayer(this.fireLayer);
        }
        this.fireLayer = L.layerGroup().addTo(map);

        // Add ignition marker
        const fireIcon = L.divIcon({
            className: 'fire-marker',
            html: '<div style="background: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px red;"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        
        this.fireMarker = L.marker([lat, lng], { icon: fireIcon }).addTo(this.fireLayer);

        // Mark initial tile as burned
        this.burnTile(tile, map);

        // Enable simulation controls
        document.getElementById('play-pause-btn').disabled = false;
        document.getElementById('reset-btn').disabled = false;
        document.getElementById('step-btn').disabled = false;

        this.updateDisplay();

        console.log('🔥 Fire ignited at tile:', tile.id);
        console.log('Initial fire rate:', tile.fireRate.toFixed(2), 'm/min');

        return true;
    },

    /**
     * Mark a tile as burned
     */
    burnTile(tile, map) {
        // Use tile ID if available, otherwise use rounded coordinates for consistency
        const tileKey = tile.id || `${tile.center.lat.toFixed(8)},${tile.center.lng.toFixed(8)}`;
        
        if (this.burnedTiles.has(tileKey)) {
            return; // Already burned
        }
        
        this.burnedTiles.add(tileKey);
        
        // Draw burned area
        const coords = tile.geometry.coordinates[0].map(c => [c[1], c[0]]);
        const polygon = L.polygon(coords, {
            color: '#ff4444',
            fillColor: '#ff0000',
            fillOpacity: 0.5,
            weight: 1,
            className: 'burned-tile'
        });
        
        polygon.addTo(this.fireLayer);
        
        // Log progress every 50 tiles
        if (this.burnedTiles.size % 50 === 0) {
            console.log(`🔥 ${this.burnedTiles.size} tiles burned`);
        }
    },

    /**
     * Calculate Rate of Spread for a tile (m/min)
     * Uses pre-calculated fire_rate from GeoJSON, adjusted by wind and config
     */
    calculateROS(tile) {
        if (!tile || tile.fireRate <= 0) return 0;
        
        // Base ROS from tile data (already in m/min, pre-calculated by GEE)
        let ros = tile.fireRate;
        
        // Wind adjustment
        if (this.windSpeed > 0) {
            const windFactor = 1 + (this.windSpeed / 50) * 0.5;
            ros *= windFactor;
        }
        
        return Math.max(ros, this.minSpreadThreshold);
    },

    /**
     * Simulate one time step
     */
    simulateFireStep(map) {
        if (!this.active || this.fireFront.length === 0) {
            console.log('⚠️ Simulation stopped: no active fire front');
            this.stopSimulation();
            return;
        }

        this.currentTime += this.timeStepHours;

        if (this.currentTime >= this.maxTime) {
            alert('Simulation completed: Maximum time reached (72 hours)');
            this.stopSimulation();
            return;
        }

        const newFront = [];
        const timeStepMinutes = this.timeStepHours * 60;

        console.log(`🔥 Fire step at ${this.currentTime.toFixed(1)}h, front size: ${this.fireFront.length}`);

        // Process current fire front
        for (const frontCell of this.fireFront) {
            const ros = this.calculateROS(frontCell.tile); // m/min
            const spreadDistance = ros * timeStepMinutes; // meters
            
            // Use larger search radius to ensure we find neighbors (150% of spread distance)
            const searchRadius = Math.max(spreadDistance * 1.5, 150); // minimum 150m radius

            // Find neighboring tiles within spread distance
            const neighbors = window.fireGrid.getNeighbors(
                frontCell.lat, 
                frontCell.lng, 
                searchRadius
            );

            console.log(`  Tile at (${frontCell.lat.toFixed(5)}, ${frontCell.lng.toFixed(5)}): ROS=${ros.toFixed(2)} m/min, spread=${spreadDistance.toFixed(0)}m, found ${neighbors.length} neighbors`);

            for (const neighbor of neighbors) {
                const neighborTile = neighbor.tile;
                const tileKey = `${neighborTile.center.lat},${neighborTile.center.lng}`;

                // Skip if already burned or suppressed
                if (this.burnedTiles.has(tileKey) || 
                    this.suppressedTiles.has(tileKey)) {
                    continue;
                }

                // Check if tile can burn
                if (!this.canTileBurn(neighborTile)) {
                    continue;
                }

                // Check if fire reaches this tile this timestep
                // Fire spreads if distance is within spread distance
                if (neighbor.distance <= spreadDistance) {
                    const arrivalTime = frontCell.time + (neighbor.distance / Math.max(ros, 0.1));
                    
                    // Burn this tile
                    this.burnTile(neighborTile, map);
                    
                    // Add to new front
                    newFront.push({
                        tile: neighborTile,
                        time: arrivalTime,
                        lat: neighborTile.center.lat,
                        lng: neighborTile.center.lng
                    });
                }
            }
        }

        // Update fire front
        this.fireFront = newFront;

        console.log(`  ✅ New front size: ${this.fireFront.length}, total burned: ${this.burnedTiles.size}`);

        this.updateDisplay();

        // Check if fire has stopped spreading
        if (this.fireFront.length === 0) {
            console.log('🛑 Fire stopped: no more tiles to burn');
            alert('Fire has stopped spreading (no more fuel or reached barriers)');
            this.stopSimulation();
        }
    },

    /**
     * Check if a tile can burn
     */
    canTileBurn(tile) {
        // Check for water or no fuel
        if (!tile || tile.fireRate <= 0) {
            return false;
        }

        // Check firebreaks
        for (const firebreak of this.firebreaks) {
            if (this.tileIntersectsFirebreak(tile, firebreak)) {
                return false;
            }
        }

        return true;
    },

    /**
     * Check if tile intersects with a firebreak
     */
    tileIntersectsFirebreak(tile, firebreak) {
        const tileLat = tile.center.lat;
        const tileLng = tile.center.lng;
        
        // Simple distance check to firebreak line
        const dist = this.pointToLineDistance(
            tileLat, tileLng,
            firebreak.start.lat, firebreak.start.lng,
            firebreak.end.lat, firebreak.end.lng
        );
        
        const firebreakWidthDegrees = this.firebreakWidth / 111;
        return dist < firebreakWidthDegrees;
    },

    /**
     * Calculate distance from point to line segment
     */
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Start/resume simulation
     */
    playSimulation(map) {
        if (!this.active) {
            alert('Please start a fire first by clicking on the map');
            return;
        }

        this.playing = true;
        document.getElementById('play-pause-btn').textContent = '⏸️ Pause';

        this.animationInterval = setInterval(() => {
            this.simulateFireStep(map);
        }, 1000); // 1 second per timestep
    },

    /**
     * Pause simulation
     */
    pauseSimulation() {
        this.playing = false;
        clearInterval(this.animationInterval);
        document.getElementById('play-pause-btn').textContent = '▶️ Play';
    },

    /**
     * Stop simulation
     */
    stopSimulation() {
        this.playing = false;
        clearInterval(this.animationInterval);
        document.getElementById('play-pause-btn').textContent = '▶️ Play';
    },

    /**
     * Reset simulation
     */
    resetSimulation(map) {
        this.stopSimulation();
        this.clearFireSimulation(map);
        this.updateDisplay();
    },

    /**
     * Clear fire simulation
     */
    clearFireSimulation(map) {
        this.active = false;
        this.currentTime = 0;
        this.burnedTiles.clear();
        this.fireFront = [];
        
        if (this.fireLayer) {
            map.removeLayer(this.fireLayer);
            this.fireLayer = null;
        }
        
        if (this.fireMarker) {
            this.fireMarker = null;
        }

        // Disable controls
        document.getElementById('play-pause-btn').disabled = true;
        document.getElementById('reset-btn').disabled = true;
        document.getElementById('step-btn').disabled = true;
        document.getElementById('play-pause-btn').textContent = '▶️ Play';
    },

    /**
     * Update display with current simulation state
     */
    updateDisplay() {
        document.getElementById('current-time').textContent = `${this.currentTime.toFixed(1)} hours`;
        
        // Calculate burned area in km²
        // 100m × 100m = 10,000 m² = 0.01 km² per tile
        const burnedAreaKm2 = this.burnedTiles.size * 0.01;
        
        if (burnedAreaKm2 >= 0.01) {
            document.getElementById('burned-area').textContent = `${burnedAreaKm2.toFixed(3)} km²`;
        } else {
            // Show in m² for very small areas
            const burnedAreaM2 = this.burnedTiles.size * 10000;
            document.getElementById('burned-area').textContent = `${burnedAreaM2.toFixed(0)} m²`;
        }
        
        // Calculate fire perimeter in km
        const perimeterM = this.fireFront.length * 100; // approximate: each front tile = 100m
        const perimeterKm = perimeterM / 1000;
        
        if (perimeterKm >= 1) {
            document.getElementById('fire-perimeter').textContent = `${perimeterKm.toFixed(2)} km`;
        } else {
            document.getElementById('fire-perimeter').textContent = `${perimeterM.toFixed(0)} m`;
        }
        
        // Update wind display
        document.getElementById('wind-speed-value').textContent = `${this.windSpeed} km/h`;
        document.getElementById('wind-direction-value').textContent = this.getWindDirectionName(this.windDirection);
    },

    /**
     * Get wind direction name
     */
    getWindDirectionName(degrees) {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(degrees / 45) % 8;
        return directions[index];
    },

    /**
     * Set wind parameters
     */
    setWind(speed, direction) {
        this.windSpeed = speed;
        this.windDirection = direction;
        this.updateDisplay();
        console.log(`Wind set to ${speed} km/h from ${this.getWindDirectionName(direction)}`);
    }
};
