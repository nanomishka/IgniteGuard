/**
 * UI Controls Module
 * 
 * Handles all user interface event listeners and interactions
 */

const UIControls = {
    
    /**
     * Initialize all event listeners
     */
    init() {
        this.initPlaybackControls();
        this.initModeSelector();
        this.initWindControls();
        this.initSuppressionControls();
        this.initOverlayToggle();
        this.initMapEvents();
        this.initTimelineControls();
    },

    /**
     * Playback control buttons
     */
    initPlaybackControls() {
        document.getElementById('playBtn').addEventListener('click', () => {
            FireSimulation.playFireAnimation();
        });

        document.getElementById('pauseBtn').addEventListener('click', () => {
            FireSimulation.stopFireAnimation();
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            FireSimulation.clearFireSimulation(MapUtils.map);
            // Restore overlay
            MapUtils.toggleOverlay(true);
            document.getElementById('overlayCheckbox').checked = true;
        });
    },

    /**
     * Mode selector (view / simulate / firebreak / waterdrop)
     */
    initModeSelector() {
        document.querySelectorAll('input[name="mapMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                FireSimulation.mapMode = e.target.value;
                if (e.target.value === 'simulate') {
                    MapUtils.map.getContainer().style.cursor = 'crosshair';
                } else if (e.target.value === 'firebreak') {
                    MapUtils.map.getContainer().style.cursor = 'crosshair';
                } else if (e.target.value === 'waterdrop') {
                    MapUtils.map.getContainer().style.cursor = 'pointer';
                } else {
                    MapUtils.map.getContainer().style.cursor = '';
                }
            });
        });
    },

    /**
     * Wind control sliders
     */
    initWindControls() {
        document.getElementById('windSpeed').addEventListener('input', (e) => {
            const speed = e.target.value;
            document.getElementById('windSpeedValue').textContent = `${speed} km/h`;
            if (FireSimulation.active) {
                FireSimulation.windSpeed = parseFloat(speed);
            }
        });

        document.getElementById('windDirection').addEventListener('input', (e) => {
            const direction = parseFloat(e.target.value);
            const directionNames = {
                0: 'North', 45: 'NE', 90: 'East', 135: 'SE',
                180: 'South', 225: 'SW', 270: 'West', 315: 'NW', 360: 'North'
            };
            
            let closestName = 'North';
            let minDiff = 360;
            for (const [angle, name] of Object.entries(directionNames)) {
                const diff = Math.abs(direction - angle);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestName = name;
                }
            }
            
            document.getElementById('windDirectionValue').textContent = `${Math.round(direction)}° ${closestName}`;
            
            const arrow = document.getElementById('windDirectionDisplay');
            arrow.style.transform = `rotate(${direction}deg)`;
            
            if (FireSimulation.active) {
                FireSimulation.windDirection = direction;
            }
        });
    },

    /**
     * Suppression control sliders and buttons
     */
    initSuppressionControls() {
        document.getElementById('firebreakWidth').addEventListener('input', function(e) {
            FireSimulation.firebreakWidth = parseFloat(e.target.value);
            document.getElementById('firebreakWidthValue').textContent = e.target.value;
        });

        document.getElementById('firebreakLength').addEventListener('input', function(e) {
            FireSimulation.firebreakLength = parseFloat(e.target.value);
            document.getElementById('firebreakLengthValue').textContent = e.target.value;
        });

        document.getElementById('waterdropRadius').addEventListener('input', function(e) {
            FireSimulation.waterdropRadius = parseFloat(e.target.value);
            document.getElementById('waterdropRadiusValue').textContent = e.target.value;
        });

        document.getElementById('clearSuppressionBtn').addEventListener('click', () => {
            SuppressionUtils.clearSuppressionActions();
        });
    },

    /**
     * Overlay visibility toggle
     */
    initOverlayToggle() {
        document.getElementById('overlayCheckbox').addEventListener('change', (e) => {
            if (FireSimulation.active && e.target.checked) {
                e.target.checked = false;
                alert('Cannot show risk overlay during fire simulation. Clear the fire first.');
                return;
            }
            MapUtils.toggleOverlay(e.target.checked);
        });
    },

    /**
     * Timeline slider
     */
    initTimelineControls() {
        document.getElementById('timelineSlider').addEventListener('input', (e) => {
            const targetTime = parseInt(e.target.value);
            
            if (targetTime < FireSimulation.currentTime) {
                // Reset and replay to target time
                const ignition = FireSimulation.ignitionPoint;
                if (ignition) {
                    FireSimulation.initializeFire(
                        ignition.lat, 
                        ignition.lng, 
                        MapUtils.georaster, 
                        MapUtils.map, 
                        MapUtils.stats
                    );
                    for (let i = 0; i < targetTime; i++) {
                        FireSimulation.simulateFireStep(MapUtils.georaster, MapUtils.stats);
                    }
                    FireSimulation.updateFireVisualization(MapUtils.georaster);
                }
            } else {
                // Advance to target time
                while (FireSimulation.currentTime < targetTime && FireSimulation.fireFront.length > 0) {
                    FireSimulation.simulateFireStep(MapUtils.georaster, MapUtils.stats);
                }
                FireSimulation.updateFireVisualization(MapUtils.georaster);
            }
        });
    },

    /**
     * Map click and drawing events
     */
    initMapEvents() {
        // Firebreak drawing
        MapUtils.map.on('mousedown', function(e) {
            if (FireSimulation.mapMode === 'firebreak') {
                FireSimulation.isDrawing = true;
                FireSimulation.drawStart = e.latlng;
            }
        });

        MapUtils.map.on('mouseup', function(e) {
            if (FireSimulation.mapMode === 'firebreak' && FireSimulation.isDrawing) {
                FireSimulation.isDrawing = false;
                if (FireSimulation.drawStart) {
                    SuppressionUtils.drawFirebreak(FireSimulation.drawStart, e.latlng);
                    FireSimulation.drawStart = null;
                }
            }
        });

        // Main map click handler
        MapUtils.map.on('click', function(e) {
            const georaster = MapUtils.georaster;
            const stats = MapUtils.stats;
            
            if (!georaster) return;

            const { lat, lng } = e.latlng;

            // Handle different modes
            if (FireSimulation.mapMode === 'simulate') {
                if (FireSimulation.initializeFire(lat, lng, georaster, MapUtils.map, stats)) {
                    // Hide overlay
                    MapUtils.toggleOverlay(false);
                    document.getElementById('overlayCheckbox').checked = false;
                    
                    // Enable controls
                    document.getElementById('playBtn').disabled = false;
                    document.getElementById('clearBtn').disabled = false;
                    document.getElementById('timelineContainer').style.display = 'block';
                    document.getElementById('timelineSlider').max = FireSimulation.maxTime;
                    document.getElementById('timelineSlider').value = 0;
                    document.getElementById('currentTime').textContent = '0';
                    document.getElementById('totalTime').textContent = FireSimulation.maxTime;
                    
                    FireSimulation.updateFireVisualization(georaster);
                }
                return;
            }

            if (FireSimulation.mapMode === 'waterdrop') {
                SuppressionUtils.addWaterDrop(e.latlng);
                return;
            }

            // View mode - show pixel information
            const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
            const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

            if (x >= 0 && x < georaster.width && y >= 0 && y < georaster.height) {
                const value = georaster.values[0][y][x];
                
                if (value !== null && value !== georaster.noDataValue && !isNaN(value)) {
                    // Calculate spread factor (0-1)
                    const spreadFactor = stats.min !== stats.max 
                        ? (value - stats.min) / (stats.max - stats.min)
                        : 0.5;
                    
                    // Calculate ROS using IgniteGuard formula
                    const ros = FireSimulation.calculateROS(spreadFactor);
                    
                    // Risk level as percentage
                    const riskLevel = (spreadFactor * 100).toFixed(1);
                    
                    // Determine risk category
                    let riskCategory = 'Very Low';
                    let riskColor = '#00ff00';
                    if (spreadFactor >= 0.8) {
                        riskCategory = 'Very High';
                        riskColor = '#ff0000';
                    } else if (spreadFactor >= 0.6) {
                        riskCategory = 'High';
                        riskColor = '#ffa500';
                    } else if (spreadFactor >= 0.4) {
                        riskCategory = 'Medium';
                        riskColor = '#ffff00';
                    } else if (spreadFactor >= 0.2) {
                        riskCategory = 'Low';
                        riskColor = '#9acd32';
                    }

                    // Wind effect calculation
                    const windSpeed = parseFloat(document.getElementById('windSpeed').value) || 0;
                    const windInfo = windSpeed > 0 
                        ? `<div class="data-row">
                            <span class="data-label">Wind Influence:</span>
                            <span class="data-value">±${((windSpeed / 30) * 100).toFixed(0)}%</span>
                           </div>`
                        : '';

                    // Update location info panel
                    document.getElementById('location-info').innerHTML = `
                        <div class="data-row">
                            <span class="data-label">Coordinates:</span>
                            <span class="data-value">${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
                        </div>
                        <div class="data-row">
                            <span class="data-label">Raw Value:</span>
                            <span class="data-value">${value.toFixed(4)}</span>
                        </div>
                        <div class="data-row">
                            <span class="data-label">Risk Category:</span>
                            <span class="data-value" style="color: ${riskColor}; font-weight: bold;">${riskCategory}</span>
                        </div>
                        <div class="data-row">
                            <span class="data-label">Risk Level:</span>
                            <span class="data-value">${riskLevel}%</span>
                        </div>
                        <div class="data-row">
                            <span class="data-label">ROS (Rate of Spread):</span>
                            <span class="data-value">${ros.toFixed(2)} m/min</span>
                        </div>
                        ${windInfo}
                        <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px; font-size: 11px; color: #6c757d;">
                            <strong>IgniteGuard ROS Model:</strong><br>
                            This value represents the potential rate of fire spread based on fuel availability, 
                            dryness, water content, and terrain slope. Higher values indicate faster potential spread.
                        </div>
                    `;
                } else {
                    document.getElementById('location-info').innerHTML = `
                        <div class="data-row">
                            <span class="data-label">No data available at this location</span>
                        </div>
                    `;
                }
            }
        });
    }
};
