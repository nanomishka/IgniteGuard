/**
 * IgniteGuard Configuration
 * 
 * Centralized configuration for the IgniteGuard ROS fire simulation model.
 * Adjust these parameters to calibrate the model for different regions or conditions.
 */

const IgniteGuardConfig = {
    
    // === ROS (Rate of Spread) Model Parameters ===
    
    /**
     * Base ROS: Maximum theoretical fire spread rate (m/min)
     * Mediterranean ecosystems: 30 m/min
     * Adjust based on fuel type and regional fire behavior
     */
    baseROS: 30,
    
    /**
     * Calibration Factor: Reduces theoretical ROS to match real-world observations
     * Cyprus calibration: 0.15 (matches ~130 km² burned in 3 days)
     * Range: 0.05 (slow spread) to 0.5 (fast spread)
     */
    calibrationFactor: 0.15,
    
    /**
     * Minimum Spread Threshold: Minimum spread factor for fire propagation
     * Prevents fire spread in very low fuel areas
     * Range: 0.001 to 0.1
     */
    minSpreadThreshold: 0.01,
    
    
    // === Simulation Parameters ===
    
    /**
     * Time Step: Hours per simulation step
     * Smaller = more accurate but slower
     * Larger = faster but less accurate
     * Range: 0.25 to 4 hours
     */
    timeStepHours: 1,
    
    /**
     * Maximum Search Radius: Cell search distance for fire spread
     * Higher = more accurate long-range spread but slower performance
     * Range: 3 to 15 cells
     */
    maxSearchRadius: 8,
    
    /**
     * Default Simulation Duration: Days
     */
    defaultSimulationDays: 3,
    
    
    // === Wind Parameters ===
    
    /**
     * Wind Speed Factor Normalization: km/h at which wind effect = 1.0
     * Cyprus: 30 km/h (moderate wind)
     * Adjust based on regional wind patterns
     */
    windSpeedNormalization: 30,
    
    /**
     * Maximum Wind Multiplier: Cap for wind boost
     * Prevents unrealistic spread rates in extreme winds
     * Range: 2.0 to 10.0
     */
    maxWindMultiplier: 5.0,
    
    /**
     * Minimum Wind Multiplier: Floor for against-wind spread
     * Fire can still spread against wind but very slowly
     * Range: 0.1 to 0.5
     */
    minWindMultiplier: 0.2,
    
    
    // === Spread Probability Parameters ===
    
    /**
     * Base Spread Chance: Probability for immediate neighbors (no wind)
     * Higher = more aggressive spread
     * Range: 0.3 to 0.9
     */
    baseSpreadChance: 0.6,
    
    /**
     * Long Range Spread Chance: Probability for distant cells
     * Controls "spotting" behavior
     * Range: 0.1 to 0.5
     */
    longRangeSpreadChance: 0.3,
    
    
    // === Data Normalization ===
    
    /**
     * NDVI Range: For normalization
     * Min: -0.2 (water, bare soil)
     * Max: 1.0 (dense vegetation)
     */
    ndviMin: -0.2,
    ndviMax: 1.0,
    
    /**
     * NDWI Range: For normalization
     * Min: -0.5 (very dry)
     * Max: 0.5 (water bodies)
     */
    ndwiMin: -0.5,
    ndwiMax: 1.0,
    
    /**
     * Slope Normalization: Maximum slope angle (degrees)
     * Slopes above this are clamped to 1.0
     */
    maxSlope: 45,
    
    
    // === Visualization ===
    
    /**
     * Overlay Opacity: Transparency of risk overlay
     * Range: 0.0 (transparent) to 1.0 (opaque)
     */
    overlayOpacity: 0.7,
    
    /**
     * Fire Visualization Intensity: Randomness in burn visualization
     * Range: 0.0 to 1.0
     */
    fireIntensityMin: 0.3,
    fireIntensityMax: 0.7,
    
    
    // === Suppression Parameters ===
    
    /**
     * Firebreak Defaults
     */
    firebreak: {
        defaultWidth: 0.1,  // km
        minWidth: 0.05,
        maxWidth: 1.0,
        defaultLength: 2.0, // km
        minLength: 0.5,
        maxLength: 15.0
    },
    
    /**
     * Water Drop Defaults
     */
    waterdrop: {
        defaultRadius: 0.3, // km
        minRadius: 0.1,
        maxRadius: 2.0
    },
    
    
    // === Data Preprocessing ===
    
    /**
     * Isolated Zero Threshold: Neighbors needed to fill isolated zeros
     * Higher = more aggressive gap filling
     */
    isolatedZeroNeighborThreshold: 5,
    highValueNeighborThreshold: 5,
    
    /**
     * Consecutive Zero Tolerance: Max consecutive zeros in fire path
     * Allows small data gaps but blocks large water bodies
     */
    maxConsecutiveZeros: 2,
    
    
    // === Color Thresholds ===
    
    /**
     * Risk Level Color Boundaries (percentiles)
     * Adjust to change color scale sensitivity
     */
    colorThresholds: {
        veryLow: 0.2,   // 0-20% = Green
        low: 0.4,       // 20-40% = Yellow-Green
        medium: 0.6,    // 40-60% = Yellow
        high: 0.8,      // 60-80% = Orange
        veryHigh: 1.0   // 80-100% = Red
    },
    
    
    // === Animation ===
    
    /**
     * Animation Speed: Milliseconds between time steps
     * Lower = faster animation
     */
    animationSpeedMs: 500,
    
    
    // === Regional Presets ===
    
    presets: {
        cyprus: {
            baseROS: 30,
            calibrationFactor: 0.15,
            description: 'Calibrated for Cyprus Mediterranean conditions'
        },
        greece: {
            baseROS: 35,
            calibrationFactor: 0.18,
            description: 'Higher spread rate for Greek islands'
        },
        portugal: {
            baseROS: 28,
            calibrationFactor: 0.14,
            description: 'Eucalyptus forests, moderate spread'
        },
        california: {
            baseROS: 40,
            calibrationFactor: 0.25,
            description: 'Chaparral, high wind, fast spread'
        },
        australia: {
            baseROS: 45,
            calibrationFactor: 0.30,
            description: 'Eucalyptus, extreme fire behavior'
        }
    },
    
    
    // === Apply Regional Preset ===
    
    /**
     * Load parameters from a regional preset
     */
    loadPreset(presetName) {
        const preset = this.presets[presetName];
        if (preset) {
            this.baseROS = preset.baseROS;
            this.calibrationFactor = preset.calibrationFactor;
            console.log(`✅ Loaded preset: ${presetName} - ${preset.description}`);
            return true;
        } else {
            console.error(`❌ Preset not found: ${presetName}`);
            return false;
        }
    },
    
    
    // === Validation ===
    
    /**
     * Validate configuration parameters
     */
    validate() {
        const errors = [];
        
        if (this.baseROS <= 0 || this.baseROS > 100) {
            errors.push('baseROS must be between 0 and 100');
        }
        if (this.calibrationFactor <= 0 || this.calibrationFactor > 1) {
            errors.push('calibrationFactor must be between 0 and 1');
        }
        if (this.timeStepHours <= 0 || this.timeStepHours > 24) {
            errors.push('timeStepHours must be between 0 and 24');
        }
        
        if (errors.length > 0) {
            console.error('❌ Configuration validation failed:', errors);
            return false;
        }
        
        console.log('✅ Configuration validated successfully');
        return true;
    },
    
    
    // === Export Configuration ===
    
    /**
     * Get current configuration as JSON
     */
    export() {
        return JSON.stringify({
            baseROS: this.baseROS,
            calibrationFactor: this.calibrationFactor,
            minSpreadThreshold: this.minSpreadThreshold,
            timeStepHours: this.timeStepHours,
            maxSearchRadius: this.maxSearchRadius
        }, null, 2);
    },
    
    
    // === Import Configuration ===
    
    /**
     * Load configuration from JSON
     */
    import(jsonString) {
        try {
            const config = JSON.parse(jsonString);
            Object.assign(this, config);
            console.log('✅ Configuration imported successfully');
            return this.validate();
        } catch (e) {
            console.error('❌ Failed to import configuration:', e);
            return false;
        }
    }
};

// Validate configuration on load
IgniteGuardConfig.validate();

console.log('🔥 IgniteGuard Configuration Loaded');
console.log('Current preset: Cyprus (Mediterranean)');
console.log(`Base ROS: ${IgniteGuardConfig.baseROS} m/min`);
console.log(`Calibration Factor: ${IgniteGuardConfig.calibrationFactor}`);
