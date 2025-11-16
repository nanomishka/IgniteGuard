/**
 * UI Controls Module (Tile-Based)
 * 
 * Handles all user interface event listeners and interactions for tile-based fire simulation
 */

const UIControls = {
    
    /**
     * Initialize all event listeners
     */
    init() {
        this.initPlaybackControls();
        this.initModeSelector();
        this.initWindControls();
        this.initOverlayToggle();
        this.initSuppressionControls();
        this.initMapEvents();
    },

    /**
     * Playback control buttons
     */
    initPlaybackControls() {
        // Play/Pause button
        document.getElementById('play-pause-btn').addEventListener('click', () => {
            if (FireSimulation.playing) {
                FireSimulation.pauseSimulation();
            } else {
                FireSimulation.playSimulation(window.myMap);
            }
        });

        // Step button
        document.getElementById('step-btn').addEventListener('click', () => {
            FireSimulation.simulateFireStep(window.myMap);
        });

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', () => {
            FireSimulation.resetSimulation(window.myMap);
            // Restore overlay
            GeoJSONLoader.toggleOverlay(true);
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
                
                // Update cursor based on mode
                if (e.target.value === 'simulate') {
                    window.myMap.getContainer().style.cursor = 'crosshair';
                } else if (e.target.value === 'firebreak') {
                    window.myMap.getContainer().style.cursor = 'crosshair';
                } else if (e.target.value === 'waterdrop') {
                    window.myMap.getContainer().style.cursor = 'pointer';
                } else {
                    window.myMap.getContainer().style.cursor = '';
                }
            });
        });
    },

    /**
     * Initialize suppression tool controls
     */
    initSuppressionControls() {
        // Only initialize if SuppressionTools is available
        if (typeof SuppressionTools === 'undefined') {
            console.warn('SuppressionTools not loaded');
            return;
        }

        // Firebreak width slider
        const firebreakWidth = document.getElementById('firebreak-width');
        if (firebreakWidth) {
            firebreakWidth.addEventListener('input', (e) => {
                SuppressionTools.setFirebreakWidth(parseInt(e.target.value));
            });
        }

        // Water drop radius slider
        const waterdropRadius = document.getElementById('waterdrop-radius');
        if (waterdropRadius) {
            waterdropRadius.addEventListener('input', (e) => {
                SuppressionTools.setWaterdropRadius(parseInt(e.target.value));
            });
        }

        // Clear suppression button
        const clearBtn = document.getElementById('clear-suppression-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                SuppressionTools.clearAll(window.myMap);
            });
        }
    },

    /**
     * Wind control sliders
     */
    initWindControls() {
        const windSpeedSlider = document.getElementById('wind-speed');
        const windDirectionSlider = document.getElementById('wind-direction');
        
        if (windSpeedSlider) {
            windSpeedSlider.addEventListener('input', (e) => {
                const speed = parseFloat(e.target.value);
                FireSimulation.setWind(speed, FireSimulation.windDirection);
            });
        }

        if (windDirectionSlider) {
            windDirectionSlider.addEventListener('input', (e) => {
                const direction = parseFloat(e.target.value);
                FireSimulation.setWind(FireSimulation.windSpeed, direction);
            });
        }
    },

    /**
     * Overlay toggle switch
     */
    initOverlayToggle() {
        const checkbox = document.getElementById('overlayCheckbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                GeoJSONLoader.toggleOverlay(e.target.checked);
            });
        }
    },

    /**
     * Map click events
     */
    initMapEvents() {
        window.myMap.on('click', (e) => {
            const { lat, lng } = e.latlng;

            // Handle different modes
            if (FireSimulation.mapMode === 'simulate') {
                if (FireSimulation.initializeFire(lat, lng, window.myMap)) {
                    // Hide overlay to see fire spread clearly
                    GeoJSONLoader.toggleOverlay(false);
                    document.getElementById('overlayCheckbox').checked = false;
                }
                return;
            }

            if (FireSimulation.mapMode === 'firebreak') {
                if (typeof SuppressionTools !== 'undefined') {
                    if (!SuppressionTools.isDrawingFirebreak) {
                        SuppressionTools.startFirebreak(e.latlng, window.myMap);
                    } else {
                        SuppressionTools.completeFirebreak(e.latlng, window.myMap);
                    }
                }
                return;
            }

            if (FireSimulation.mapMode === 'waterdrop') {
                if (typeof SuppressionTools !== 'undefined') {
                    SuppressionTools.addWaterDrop(e.latlng, window.myMap);
                }
                return;
            }

            // View mode - show tile information
            const tile = window.fireGrid.getTileAt(lat, lng);
            
            if (tile) {
                // Calculate risk category
                const normalized = (tile.fireRate - GeoJSONLoader.stats.min) / 
                                 (GeoJSONLoader.stats.max - GeoJSONLoader.stats.min);
                
                let riskCategory = 'Very Low';
                let riskColor = '#00ff00';
                if (normalized >= 0.8) {
                    riskCategory = 'Very High';
                    riskColor = '#ff0000';
                } else if (normalized >= 0.6) {
                    riskCategory = 'High';
                    riskColor = '#ffa500';
                } else if (normalized >= 0.4) {
                    riskCategory = 'Medium';
                    riskColor = '#ffff00';
                } else if (normalized >= 0.2) {
                    riskCategory = 'Low';
                    riskColor = '#9acd32';
                }

                // Wind effect calculation
                const windSpeed = FireSimulation.windSpeed;
                const windInfo = windSpeed > 0 
                    ? `<div class="data-row">
                        <span class="data-label">Wind Influence:</span>
                        <span class="data-value">+${((windSpeed / 50) * 50).toFixed(0)}%</span>
                       </div>`
                    : '';

                // Update location info panel
                document.getElementById('location-info').innerHTML = `
                    <div class="data-row">
                        <span class="data-label">Coordinates:</span>
                        <span class="data-value">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Tile Center:</span>
                        <span class="data-value">${tile.center.lat.toFixed(5)}, ${tile.center.lng.toFixed(5)}</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Tile Scale:</span>
                        <span class="data-value">${tile.tileScale} m</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Risk Category:</span>
                        <span class="data-value" style="color: ${riskColor}; font-weight: bold;">${riskCategory}</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Risk Level:</span>
                        <span class="data-value">${(normalized * 100).toFixed(1)}%</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Fire Rate (ROS):</span>
                        <span class="data-value">${tile.fireRate.toFixed(2)} m/min</span>
                    </div>
                    ${windInfo}
                    <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px; font-size: 11px; color: #6c757d;">
                        <strong>IgniteGuard ROS Model:</strong><br>
                        Fire rate calculated from fuel type, vegetation dryness (NDVI), water stress (NDWI), 
                        and terrain slope. Data sourced from Google Earth Engine for Kouris Dam AOI.
                    </div>
                `;
            } else {
                document.getElementById('location-info').innerHTML = `
                    <div class="data-row">
                        <span class="data-label" style="color: #6c757d;">No tile data at this location</span>
                    </div>
                    <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-radius: 5px; font-size: 11px; color: #856404;">
                        Click within the Kouris Dam area to see fire risk data.
                    </div>
                `;
            }
        });

        // Hover effect on tiles
        window.myMap.on('mousemove', (e) => {
            // Update firebreak preview while drawing
            if (typeof SuppressionTools !== 'undefined' && 
                FireSimulation.mapMode === 'firebreak' && 
                SuppressionTools.isDrawingFirebreak) {
                SuppressionTools.updateFirebreakPreview(e.latlng, window.myMap);
                return;
            }

            const tile = window.fireGrid.getTileAt(e.latlng.lat, e.latlng.lng);
            
            if (tile && FireSimulation.mapMode === 'view') {
                window.myMap.getContainer().style.cursor = 'pointer';
            } else if (FireSimulation.mapMode === 'simulate') {
                window.myMap.getContainer().style.cursor = 'crosshair';
            } else if (FireSimulation.mapMode === 'firebreak') {
                window.myMap.getContainer().style.cursor = 'crosshair';
            } else if (FireSimulation.mapMode === 'waterdrop') {
                window.myMap.getContainer().style.cursor = 'pointer';
            } else {
                window.myMap.getContainer().style.cursor = '';
            }
        });

        // Cancel firebreak on right-click
        window.myMap.on('contextmenu', (e) => {
            if (typeof SuppressionTools !== 'undefined' && 
                FireSimulation.mapMode === 'firebreak' && 
                SuppressionTools.isDrawingFirebreak) {
                e.originalEvent.preventDefault();
                SuppressionTools.cancelFirebreak(window.myMap);
            }
        });
    }
};
