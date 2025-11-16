/**
 * Fire Simulation Module
 * 
 * Implements the IgniteGuard ROS (Rate of Spread) model for Cyprus fire behavior.
 * 
 * IgniteGuard Formula:
 * 1. Fuel = NDVI_norm (vegetation index)
 * 2. Dryness = 1 - NDVI_norm
 * 3. LowWater = 1 - NDWI_norm (water stress)
 * 4. Slope_norm = slope / 45 (normalized terrain slope)
 * 5. SF = Fuel × Dryness × LowWater × (1 + Slope_norm)
 * 6. SF_norm = min(SF, 1.5) / 1.5
 * 7. ROS (m/min) = SF_norm × 30 (0-30 m/min range)
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
    burnedCells: new Set(),
    fireFront: [],
    mapMode: 'view',
    overlayVisible: true,
    cellROSValues: new Map(),
    
    // Scientific parameters (IgniteGuard model) - from config
    get baseROS() { return IgniteGuardConfig.baseROS; },
    get calibrationFactor() { return IgniteGuardConfig.calibrationFactor; },
    get minSpreadThreshold() { return IgniteGuardConfig.minSpreadThreshold; },
    get timeStepHours() { return IgniteGuardConfig.timeStepHours; },
    averageROS: null, // calculated from data
    pixelSizeMeters: null,
    
    // Wind parameters
    windSpeed: 0, // km/h
    windDirection: 0, // degrees (0=N, 90=E, 180=S, 270=W)
    
    // Suppression
    firebreaks: [],
    waterdrops: [],
    suppressionLayer: null,
    suppressedCells: new Set(),
    isDrawing: false,
    drawStart: null,
    firebreakWidth: 0.1, // km
    firebreakLength: 2.0, // km
    waterdropRadius: 0.3, // km

    /**
     * Initialize fire at a specific location
     */
    initializeFire(lat, lng, georaster, map, stats) {
        this.clearFireSimulation(map);
        
        const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
        const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

        if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
            alert('Please click within the data bounds');
            return false;
        }

        // Check if location has valid data
        const value = georaster.values[0][y]?.[x];
        if (value === null || value === georaster.noDataValue || isNaN(value) || value <= 0) {
            alert('Cannot start fire on water or areas with no fuel. Please select a location with vegetation.');
            return false;
        }

        // Calculate pixel size in meters
        const latMetersPerDegree = 111000;
        const lngMetersPerDegree = 111000 * Math.cos(lat * Math.PI / 180);
        this.pixelSizeMeters = Math.sqrt(
            (georaster.pixelWidth * lngMetersPerDegree) ** 2 +
            (georaster.pixelHeight * latMetersPerDegree) ** 2
        );

        this.active = true;
        this.ignitionPoint = { lat, lng, x, y };
        this.currentTime = 0;
        this.burnedCells.clear();
        this.fireFront = [{ x, y, time: 0 }];
        this.cellROSValues.clear();

        // Create fire layer
        if (this.fireLayer) {
            map.removeLayer(this.fireLayer);
        }
        this.fireLayer = L.layerGroup().addTo(map);

        // Add ignition marker
        const fireIcon = L.divIcon({
            className: 'fire-marker',
            html: '<div style="background: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px red;"></div>',
            iconSize: [20, 20]
        });
        this.fireMarker = L.marker([lat, lng], { icon: fireIcon }).addTo(this.fireLayer);

        // Set simulation duration
        const simulationDays = parseInt(document.getElementById('simulationDays').value) || 3;
        this.maxTime = simulationDays * 24;
        
        // Capture wind parameters
        this.windSpeed = parseFloat(document.getElementById('windSpeed').value) || 0;
        this.windDirection = parseFloat(document.getElementById('windDirection').value) || 0;
        
        return true;
    },

    /**
     * Calculate Rate of Spread using IgniteGuard formula
     */
    calculateROS(spreadFactor, windMultiplier = 1.0) {
        const cappedSF = Math.min(spreadFactor, 1.0);
        
        // Base ROS with calibration
        let baseROS = cappedSF * this.baseROS * this.calibrationFactor;
        
        // Normalize relative to average
        if (this.averageROS && this.averageROS > 0) {
            const avgSpreadFactor = 0.5;
            const avgBaseROS = avgSpreadFactor * this.baseROS * this.calibrationFactor;
            const scaleFactor = this.averageROS / avgBaseROS;
            baseROS = baseROS * scaleFactor;
        }
        
        // Apply wind multiplier
        return baseROS * windMultiplier; // meters per minute
    },

    /**
     * Calculate wind influence on fire spread direction
     */
    calculateWindInfluence(fromX, fromY, toX, toY) {
        if (this.windSpeed === 0) return 1.0;

        // Calculate spread direction
        const dx = toX - fromX;
        const dy = fromY - toY;
        
        let spreadDirection = Math.atan2(dx, dy) * (180 / Math.PI);
        if (spreadDirection < 0) spreadDirection += 360;

        // Angle difference between wind and spread
        let angleDiff = Math.abs(spreadDirection - this.windDirection);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        const angleInfluence = Math.cos(angleDiff * Math.PI / 180);
        const windSpeedFactor = Math.min(this.windSpeed / IgniteGuardConfig.windSpeedNormalization, 2.0);

        if (angleInfluence > 0.7) {
            // With wind
            const multiplier = 1.0 + (angleInfluence * windSpeedFactor * 3.0);
            return Math.min(IgniteGuardConfig.maxWindMultiplier, multiplier);
        } else if (angleInfluence < -0.7) {
            // Against wind
            const multiplier = 1.0 + (angleInfluence * windSpeedFactor * 0.8);
            return Math.max(IgniteGuardConfig.minWindMultiplier, multiplier);
        } else {
            // Perpendicular
            const multiplier = 1.0 + (angleInfluence * windSpeedFactor * 1.5);
            return Math.max(0.5, Math.min(3.0, multiplier));
        }
    },

    /**
     * Calculate spread distance based on ROS and time
     */
    calculateSpreadDistance(ros, timeHours) {
        const timeMinutes = timeHours * 60;
        return ros * timeMinutes; // meters
    },

    /**
     * Check if a cell can burn
     */
    canCellBurn(x, y, georaster, stats) {
        if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
            return false;
        }
        
        if (this.burnedCells.has(`${x},${y}`)) {
            return false;
        }

        if (this.suppressedCells.has(`${x},${y}`)) {
            return false;
        }
        
        const value = georaster.values[0][y]?.[x];
        if (value === null || value === georaster.noDataValue || isNaN(value)) {
            return false;
        }
        
        if (value <= 0 || (stats.min && value < stats.min * 0.1)) {
            // Check if isolated zero (false positive)
            let neighborsWithFuel = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < georaster.width && ny >= 0 && ny < georaster.height) {
                        const nVal = georaster.values[0][ny]?.[nx];
                        if (nVal && nVal > 0) neighborsWithFuel++;
                    }
                }
            }
            return neighborsWithFuel >= 5;
        }
        
        return true;
    },

    /**
     * Get spread factor for a cell
     */
    getCellSpreadFactor(x, y, georaster, stats) {
        const value = georaster.values[0][y]?.[x];
        if (value === null || value === georaster.noDataValue || isNaN(value) || value <= 0) {
            return 0;
        }
        
        const spreadFactor = stats.min !== stats.max 
            ? (value - stats.min) / (stats.max - stats.min)
            : 0.5;
        
        return Math.max(0, spreadFactor);
    },

    /**
     * Check if there's a valid path between cells (no water barriers)
     */
    hasPathToCell(fromX, fromY, toX, toY, georaster) {
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        const sx = fromX < toX ? 1 : -1;
        const sy = fromY < toY ? 1 : -1;
        let err = dx - dy;
        
        let x = fromX;
        let y = fromY;
        let consecutiveZeros = 0;
        const maxConsecutiveZeros = 2;
        
        while (true) {
            const cellKey = `${x},${y}`;
            if (this.suppressedCells.has(cellKey)) {
                return false;
            }
            
            const value = georaster.values[0][y]?.[x];
            if (value === null || value === georaster.noDataValue || isNaN(value) || value <= 0) {
                consecutiveZeros++;
                if (consecutiveZeros > maxConsecutiveZeros) {
                    return false;
                }
            } else {
                consecutiveZeros = 0;
            }
            
            if (x === toX && y === toY) break;
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
        
        return true;
    },

    /**
     * Simulate one time step of fire spread
     */
    simulateFireStep(georaster, stats) {
        if (!this.active || this.fireFront.length === 0) {
            this.stopFireAnimation();
            return false;
        }

        this.currentTime += this.timeStepHours;
        const newFrontSet = new Map();

        for (const cell of this.fireFront) {
            const { x, y } = cell;
            const cellKey = `${x},${y}`;
            
            if (!this.burnedCells.has(cellKey)) {
                const value = georaster.values[0][y]?.[x];
                if (value && value !== georaster.noDataValue && !isNaN(value) && value > 0) {
                    this.burnedCells.add(cellKey);
                } else {
                    continue;
                }
            }

            const spreadFactor = this.getCellSpreadFactor(x, y, georaster, stats);
            
            if (spreadFactor < this.minSpreadThreshold) continue;

            const ros = this.calculateROS(spreadFactor);
            const spreadDistanceMeters = this.calculateSpreadDistance(ros, this.timeStepHours);
            const spreadRadiusCells = Math.ceil(spreadDistanceMeters / this.pixelSizeMeters);
            const maxSearchRadius = Math.min(spreadRadiusCells, IgniteGuardConfig.maxSearchRadius);

            for (let dx = -maxSearchRadius; dx <= maxSearchRadius; dx++) {
                for (let dy = -maxSearchRadius; dy <= maxSearchRadius; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    
                    const nx = x + dx;
                    const ny = y + dy;
                    const nKey = `${nx},${ny}`;

                    if (!this.canCellBurn(nx, ny, georaster, stats)) continue;

                    const cellDistance = Math.sqrt(dx * dx + dy * dy);
                    const distanceMeters = cellDistance * this.pixelSizeMeters;

                    if (distanceMeters <= spreadDistanceMeters) {
                        const neighborSF = this.getCellSpreadFactor(nx, ny, georaster, stats);
                        
                        if (neighborSF >= this.minSpreadThreshold) {
                            const isImmediateNeighbor = cellDistance <= 1.5;
                            
                            if (isImmediateNeighbor) {
                                const windInfluence = this.calculateWindInfluence(x, y, nx, ny);
                                const neighborROS = this.calculateROS(neighborSF, windInfluence);
                                
                                const windProbabilityFactor = 0.5 + (windInfluence - 1.0) * 0.3;
                                const baseSpreadChance = (IgniteGuardConfig.baseSpreadChance + neighborSF * 0.4) * windProbabilityFactor;
                                const finalSpreadChance = Math.max(0.2, Math.min(1.0, baseSpreadChance));
                                
                                if (Math.random() < finalSpreadChance) {
                                    if (!newFrontSet.has(nKey) || newFrontSet.get(nKey).ros < neighborROS) {
                                        newFrontSet.set(nKey, { 
                                            x: nx, 
                                            y: ny, 
                                            time: this.currentTime,
                                            ros: neighborROS
                                        });
                                    }
                                }
                            } else {
                                if (this.hasPathToCell(x, y, nx, ny, georaster)) {
                                    const windInfluence = this.calculateWindInfluence(x, y, nx, ny);
                                    const neighborROS = this.calculateROS(neighborSF, windInfluence);
                                    
                                    const distanceFactor = 1 - (distanceMeters / spreadDistanceMeters);
                                    const windProbabilityFactor = 0.5 + (windInfluence - 1.0) * 0.3;
                                    const spreadChance = (IgniteGuardConfig.longRangeSpreadChance + distanceFactor * 0.4) * (0.5 + neighborSF * 0.5) * windProbabilityFactor;
                                    const finalSpreadChance = Math.max(0.1, Math.min(1.0, spreadChance));
                                    
                                    if (Math.random() < finalSpreadChance) {
                                        if (!newFrontSet.has(nKey) || newFrontSet.get(nKey).ros < neighborROS) {
                                            newFrontSet.set(nKey, { 
                                                x: nx, 
                                                y: ny, 
                                                time: this.currentTime,
                                                ros: neighborROS
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        this.fireFront = Array.from(newFrontSet.values());
        
        if (this.currentTime >= this.maxTime || this.fireFront.length === 0) {
            this.stopFireAnimation();
        }
        
        return true;
    },

    /**
     * Update fire visualization on map
     */
    updateFireVisualization(georaster) {
        if (!this.fireLayer) return;

        // Clear previous visualization except marker
        this.fireLayer.eachLayer(layer => {
            if (layer !== this.fireMarker) {
                this.fireLayer.removeLayer(layer);
            }
        });

        // Draw burned area
        this.burnedCells.forEach(cellKey => {
            const [x, y] = cellKey.split(',').map(Number);
            
            const lng1 = georaster.xmin + x * georaster.pixelWidth;
            const lng2 = lng1 + georaster.pixelWidth;
            const lat1 = georaster.ymax - y * georaster.pixelHeight;
            const lat2 = lat1 - georaster.pixelHeight;

            const bounds = [[lat2, lng1], [lat1, lng2]];
            
            const intensity = IgniteGuardConfig.fireIntensityMin + 
                            Math.random() * (IgniteGuardConfig.fireIntensityMax - IgniteGuardConfig.fireIntensityMin);
            L.rectangle(bounds, {
                color: '#ff4500',
                weight: 0,
                fillColor: '#ff4500',
                fillOpacity: intensity
            }).addTo(this.fireLayer);
        });

        // Calculate statistics
        const pixelAreaDegrees = georaster.pixelWidth * georaster.pixelHeight;
        const degToKm = 111;
        const approxAreaKm2 = (this.burnedCells.size * pixelAreaDegrees * degToKm * degToKm).toFixed(2);
        
        let actualAvgROS = 0;
        if (this.cellROSValues.size > 0) {
            const rosValues = Array.from(this.cellROSValues.values());
            actualAvgROS = (rosValues.reduce((a, b) => a + b, 0) / rosValues.length).toFixed(3);
        }

        document.getElementById('currentTime').textContent = this.currentTime;
        document.getElementById('timelineSlider').value = this.currentTime;
        document.getElementById('burnedArea').textContent = approxAreaKm2;
        document.getElementById('spreadRate').textContent = actualAvgROS;
        
        const windConditions = this.windSpeed > 0 
            ? `${this.windSpeed} km/h @ ${Math.round(this.windDirection)}°`
            : 'No wind';
        document.getElementById('simWindConditions').textContent = windConditions;
    },

    /**
     * Start fire animation
     */
    playFireAnimation() {
        if (this.playing) return;
        
        this.playing = true;
        document.getElementById('playBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = false;

        this.animationInterval = setInterval(() => {
            const georaster = window.georaster;
            const stats = window.stats;
            if (georaster && stats) {
                if (!this.simulateFireStep(georaster, stats)) {
                    this.stopFireAnimation();
                }
                this.updateFireVisualization(georaster);
            }
        }, IgniteGuardConfig.animationSpeedMs);
    },

    /**
     * Stop fire animation
     */
    stopFireAnimation() {
        this.playing = false;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = true;
        
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    },

    /**
     * Clear fire simulation
     */
    clearFireSimulation(map) {
        this.stopFireAnimation();
        
        if (this.fireLayer) {
            map.removeLayer(this.fireLayer);
            this.fireLayer = null;
        }

        this.active = false;
        this.ignitionPoint = null;
        this.currentTime = 0;
        this.burnedCells.clear();
        this.fireFront = [];
        this.fireMarker = null;
        this.cellROSValues.clear();

        document.getElementById('playBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('clearBtn').disabled = true;
        document.getElementById('timelineContainer').style.display = 'none';
    }
};
