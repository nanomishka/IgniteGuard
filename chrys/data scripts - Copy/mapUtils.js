/**
 * Map Utilities Module
 * 
 * Handles map initialization, GeoTIFF loading, and visualization
 */

const MapUtils = {
    map: null,
    georasterLayer: null,
    georaster: null,
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

    /**
     * Initialize the Leaflet map
     */
    initializeMap() {
        // Initialize map centered on Cyprus
        this.map = L.map('map').setView([35.1264, 33.4299], 9);

        // Add OpenStreetMap base layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);

        return this.map;
    },

    /**
     * Color scale function based on IgniteGuard ROS values
     */
    getColor(value) {
        if (value === null || value === undefined || isNaN(value)) {
            return 'rgba(128, 128, 128, 0.5)';
        }
        
        // Water/no fuel - transparent blue
        if (value <= 0) return 'rgba(100, 150, 255, 0.3)';
        
        // Normalize based on actual data range
        const minVal = this.stats.absMin > 0 ? this.stats.absMin : 0.001;
        const maxVal = this.stats.absMax || 1;
        const range = maxVal - minVal;
        
        const normalized = (value - minVal) / range;
        const clampedNorm = Math.max(0, Math.min(1, normalized));

        // Color gradient (green -> yellow-green -> yellow -> orange -> red)
        if (clampedNorm < 0.2) return `rgba(0, 255, 0, 0.7)`;        // Very Low
        if (clampedNorm < 0.4) return `rgba(154, 205, 50, 0.7)`;     // Low
        if (clampedNorm < 0.6) return `rgba(255, 255, 0, 0.7)`;      // Medium
        if (clampedNorm < 0.8) return `rgba(255, 165, 0, 0.7)`;      // High
        return `rgba(255, 0, 0, 0.7)`;                                 // Very High
    },

    /**
     * Preprocess data: fill isolated zeros with interpolated values
     */
    preprocessData() {
        console.log('Preprocessing data: filling isolated zeros...');
        
        for (let y = 0; y < this.georaster.height; y++) {
            for (let x = 0; x < this.georaster.width; x++) {
                const value = this.georaster.values[0][y][x];
                
                if (value !== null && value !== this.georaster.noDataValue && !isNaN(value) && value <= 0) {
                    let neighborSum = 0;
                    let neighborCount = 0;
                    let highValueNeighbors = 0;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = x + dx;
                            const ny = y + dy;
                            
                            if (nx >= 0 && nx < this.georaster.width && ny >= 0 && ny < this.georaster.height) {
                                const nVal = this.georaster.values[0][ny][nx];
                                if (nVal !== null && nVal !== this.georaster.noDataValue && !isNaN(nVal) && nVal > 0) {
                                    neighborSum += nVal;
                                    neighborCount++;
                                    if (nVal > 1) highValueNeighbors++;
                                }
                            }
                        }
                    }
                    
                    // If surrounded by high-value pixels, interpolate
                    if (highValueNeighbors >= IgniteGuardConfig.highValueNeighborThreshold && 
                        neighborCount >= IgniteGuardConfig.isolatedZeroNeighborThreshold) {
                        this.georaster.values[0][y][x] = neighborSum / neighborCount;
                    }
                }
            }
        }
    },

    /**
     * Calculate statistics from georaster data
     */
    calculateStatistics() {
        const values = this.georaster.values[0].flat().filter(v => 
            v !== null && !isNaN(v) && v !== this.georaster.noDataValue && v > 0
        );
        
        if (values.length === 0) {
            this.stats = {
                min: 0, max: 1, mean: 0, median: 0, count: 0,
                absMin: 0, absMax: 1
            };
            return;
        }

        const sortedValues = values.slice().sort((a, b) => a - b);
        const p50Index = Math.floor(values.length * 0.50);
        
        this.stats.min = sortedValues[0];
        this.stats.max = sortedValues[sortedValues.length - 1];
        this.stats.mean = values.reduce((a, b) => a + b, 0) / values.length;
        this.stats.median = sortedValues[p50Index];
        this.stats.count = values.length;
        this.stats.absMin = this.stats.min;
        this.stats.absMax = this.stats.max;
        
        // Calculate value thresholds for color bands
        const range = this.stats.max - this.stats.min;
        this.stats.threshold20 = this.stats.min + range * 0.2;
        this.stats.threshold40 = this.stats.min + range * 0.4;
        this.stats.threshold60 = this.stats.min + range * 0.6;
        this.stats.threshold80 = this.stats.min + range * 0.8;
        
        // Calculate ROS for each threshold (using IgniteGuard formula)
        const calcROSForValue = (val) => {
            const sf = (val - this.stats.min) / (this.stats.max - this.stats.min);
            return (sf * 30 * 0.15).toFixed(2); // baseROS=30, calibration=0.15
        };
        
        this.stats.ros20 = calcROSForValue(this.stats.threshold20);
        this.stats.ros40 = calcROSForValue(this.stats.threshold40);
        this.stats.ros60 = calcROSForValue(this.stats.threshold60);
        this.stats.ros80 = calcROSForValue(this.stats.threshold80);
        this.stats.rosMax = calcROSForValue(this.stats.max);
        
        // Calculate average ROS
        const meanSpreadFactor = (this.stats.mean - this.stats.min) / (this.stats.max - this.stats.min);
        FireSimulation.averageROS = meanSpreadFactor * 30 * 0.15;
        
        console.log('=== Data Statistics ===');
        console.log('Value Range:', this.stats.min.toFixed(4), '-', this.stats.max.toFixed(4));
        console.log('Mean:', this.stats.mean.toFixed(4), 'Median:', this.stats.median.toFixed(4));
        console.log('=== IgniteGuard ROS Thresholds ===');
        console.log('Green (0-20%):', this.stats.min.toFixed(4), '-', this.stats.threshold20.toFixed(4), '→ ROS: 0-', this.stats.ros20, 'm/min');
        console.log('YellowGreen (20-40%):', this.stats.threshold20.toFixed(4), '-', this.stats.threshold40.toFixed(4), '→ ROS:', this.stats.ros20, '-', this.stats.ros40, 'm/min');
        console.log('Yellow (40-60%):', this.stats.threshold40.toFixed(4), '-', this.stats.threshold60.toFixed(4), '→ ROS:', this.stats.ros40, '-', this.stats.ros60, 'm/min');
        console.log('Orange (60-80%):', this.stats.threshold60.toFixed(4), '-', this.stats.threshold80.toFixed(4), '→ ROS:', this.stats.ros60, '-', this.stats.ros80, 'm/min');
        console.log('Red (80-100%):', this.stats.threshold80.toFixed(4), '-', this.stats.max.toFixed(4), '→ ROS:', this.stats.ros80, '-', this.stats.rosMax, 'm/min');
        console.log('Average ROS:', FireSimulation.averageROS.toFixed(3), 'm/min');
    },

    /**
     * Update statistics display in UI
     */
    updateStatisticsDisplay() {
        document.getElementById('stats').innerHTML = `
            <div class="data-row">
                <span class="data-label">Display Range (5-95%):</span>
                <span class="data-value">${this.stats.min != null ? this.stats.min.toFixed(4) : 'N/A'} - ${this.stats.max != null ? this.stats.max.toFixed(4) : 'N/A'}</span>
            </div>
            <div class="data-row">
                <span class="data-label">Absolute Range:</span>
                <span class="data-value">${this.stats.absMin != null ? this.stats.absMin.toFixed(4) : 'N/A'} - ${this.stats.absMax != null ? this.stats.absMax.toFixed(4) : 'N/A'}</span>
            </div>
            <div class="data-row">
                <span class="data-label">Mean Value:</span>
                <span class="data-value">${this.stats.mean != null ? this.stats.mean.toFixed(4) : 'N/A'}</span>
            </div>
            <div class="data-row">
                <span class="data-label">Data Points:</span>
                <span class="data-value">${this.stats.count.toLocaleString()}</span>
            </div>
            <div class="data-row">
                <span class="data-label">Resolution:</span>
                <span class="data-value">${this.georaster.width} × ${this.georaster.height}</span>
            </div>
        `;
    },

    /**
     * Create legend based on IgniteGuard ROS ranges
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
                range: '≤ 0',
                ros: '0 m/min'
            },
            { 
                label: 'Very Low', 
                color: 'rgba(0, 255, 0, 0.7)', 
                range: `${this.stats.min.toFixed(3)} - ${this.stats.threshold20.toFixed(3)}`,
                ros: `0 - ${this.stats.ros20} m/min`
            },
            { 
                label: 'Low', 
                color: 'rgba(154, 205, 50, 0.7)', 
                range: `${this.stats.threshold20.toFixed(3)} - ${this.stats.threshold40.toFixed(3)}`,
                ros: `${this.stats.ros20} - ${this.stats.ros40} m/min`
            },
            { 
                label: 'Medium', 
                color: 'rgba(255, 255, 0, 0.7)', 
                range: `${this.stats.threshold40.toFixed(3)} - ${this.stats.threshold60.toFixed(3)}`,
                ros: `${this.stats.ros40} - ${this.stats.ros60} m/min`
            },
            { 
                label: 'High', 
                color: 'rgba(255, 165, 0, 0.7)', 
                range: `${this.stats.threshold60.toFixed(3)} - ${this.stats.threshold80.toFixed(3)}`,
                ros: `${this.stats.ros60} - ${this.stats.ros80} m/min`
            },
            { 
                label: 'Very High', 
                color: 'rgba(255, 0, 0, 0.7)', 
                range: `${this.stats.threshold80.toFixed(3)} - ${this.stats.max.toFixed(3)}`,
                ros: `${this.stats.ros80} - ${this.stats.rosMax} m/min`
            }
        ];

        legendItems.innerHTML = ranges.map(item => `
            <div class="legend-item">
                <div class="legend-color" style="background: ${item.color};"></div>
                <div>
                    <strong>${item.label}</strong><br>
                    <small style="color: #6c757d; line-height: 1.4;">
                        Value: ${item.range}<br>
                        ROS: ${item.ros}
                    </small>
                </div>
            </div>
        `).join('') + `<div style="margin-top: 10px; font-size: 11px; color: #6c757d;">
            *IgniteGuard ROS Model: Linear scale (0-${this.stats.max.toFixed(2)})
        </div>`;
    },

    /**
     * Load and display GeoTIFF file
     */
    async loadGeoTIFF(filename = 'cyprus_spread_rate_fuel_dryness_slope.tif') {
        try {
            const response = await fetch(filename);
            const arrayBuffer = await response.arrayBuffer();
            
            this.georaster = await parseGeoraster(arrayBuffer);
            console.log('GeoRaster loaded:', this.georaster);

            // Preprocess data
            this.preprocessData();

            // Calculate statistics
            this.calculateStatistics();

            // Update UI
            this.updateStatisticsDisplay();

            // Create georaster layer
            this.georasterLayer = new GeoRasterLayer({
                georaster: this.georaster,
                opacity: IgniteGuardConfig.overlayOpacity,
                pixelValuesToColorFn: values => {
                    return this.getColor(values[0]);
                },
                resolution: 256
            });

            this.georasterLayer.addTo(this.map);

            // Create legend
            this.createLegend();

            // Fit map bounds
            const bounds = [
                [this.georaster.ymin, this.georaster.xmin],
                [this.georaster.ymax, this.georaster.xmax]
            ];
            this.map.fitBounds(bounds);

            // Expose to global scope for fire simulation
            window.georaster = this.georaster;
            window.stats = this.stats;

        } catch (error) {
            console.error('Error loading GeoTIFF:', error);
            document.getElementById('stats').innerHTML = `
                <div style="color: #dc3545; padding: 10px;">
                    Error loading data: ${error.message}
                </div>
            `;
        }
    },

    /**
     * Toggle overlay visibility
     */
    toggleOverlay(visible) {
        if (this.georasterLayer) {
            this.georasterLayer.setOpacity(visible ? IgniteGuardConfig.overlayOpacity : 0);
        }
        FireSimulation.overlayVisible = visible;
    }
};
