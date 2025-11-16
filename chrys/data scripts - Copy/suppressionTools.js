/**
 * Suppression Tools Module
 * 
 * Handles firebreaks and water drops to control fire spread
 */

const SuppressionTools = {
    firebreaks: [],
    waterdrops: [],
    suppressionLayer: null,
    isDrawingFirebreak: false,
    firebreakStart: null,
    tempFirebreakLine: null,
    
    // Settings
    firebreakWidth: 100, // meters
    waterdropRadius: 300, // meters

    /**
     * Initialize suppression layer
     */
    init(map) {
        if (!this.suppressionLayer) {
            this.suppressionLayer = L.layerGroup().addTo(map);
        }
    },

    /**
     * Start drawing a firebreak
     */
    startFirebreak(latlng, map) {
        this.isDrawingFirebreak = true;
        this.firebreakStart = latlng;
        
        // Visual feedback
        map.getContainer().style.cursor = 'crosshair';
        
        // Add temporary marker
        const startMarker = L.circleMarker(latlng, {
            radius: 5,
            color: '#ff6b00',
            fillColor: '#ff6b00',
            fillOpacity: 1
        }).addTo(this.suppressionLayer);
        
        this.tempStartMarker = startMarker;
    },

    /**
     * Update firebreak preview while dragging
     */
    updateFirebreakPreview(latlng, map) {
        if (!this.isDrawingFirebreak || !this.firebreakStart) return;
        
        // Remove old preview line
        if (this.tempFirebreakLine) {
            this.suppressionLayer.removeLayer(this.tempFirebreakLine);
        }
        
        // Draw preview line
        this.tempFirebreakLine = L.polyline(
            [this.firebreakStart, latlng],
            {
                color: '#ff6b00',
                weight: 3,
                opacity: 0.7,
                dashArray: '5, 5'
            }
        ).addTo(this.suppressionLayer);
    },

    /**
     * Complete firebreak drawing
     */
    completeFirebreak(latlng, map) {
        if (!this.isDrawingFirebreak || !this.firebreakStart) return;
        
        // Remove temporary elements
        if (this.tempStartMarker) {
            this.suppressionLayer.removeLayer(this.tempStartMarker);
        }
        if (this.tempFirebreakLine) {
            this.suppressionLayer.removeLayer(this.tempFirebreakLine);
        }
        
        // Calculate distance
        const distance = map.distance(this.firebreakStart, latlng);
        
        if (distance < 50) {
            // Too short, cancel
            this.isDrawingFirebreak = false;
            this.firebreakStart = null;
            map.getContainer().style.cursor = '';
            return;
        }
        
        // Create firebreak
        const firebreak = {
            id: Date.now(),
            start: this.firebreakStart,
            end: latlng,
            width: this.firebreakWidth,
            distance: distance
        };
        
        this.firebreaks.push(firebreak);
        
        // Draw permanent firebreak
        const firebreakLine = L.polyline(
            [firebreak.start, firebreak.end],
            {
                color: '#8B4513',
                weight: Math.max(3, this.firebreakWidth / 30),
                opacity: 0.9,
                className: 'firebreak-line'
            }
        ).addTo(this.suppressionLayer);
        
        // Add tooltip
        firebreakLine.bindPopup(`
            <div style="font-size: 12px;">
                <strong>🚧 Firebreak</strong><br>
                Width: ${this.firebreakWidth}m<br>
                Length: ${distance.toFixed(0)}m
            </div>
        `);
        
        firebreak.layer = firebreakLine;
        
        // Reset
        this.isDrawingFirebreak = false;
        this.firebreakStart = null;
        map.getContainer().style.cursor = '';
        
        // Update count
        document.getElementById('firebreak-count').textContent = this.firebreaks.length;
        
        // Show suppression stats
        document.getElementById('suppression-controls').style.display = 'block';
    },

    /**
     * Cancel firebreak drawing
     */
    cancelFirebreak(map) {
        if (this.tempStartMarker) {
            this.suppressionLayer.removeLayer(this.tempStartMarker);
        }
        if (this.tempFirebreakLine) {
            this.suppressionLayer.removeLayer(this.tempFirebreakLine);
        }
        
        this.isDrawingFirebreak = false;
        this.firebreakStart = null;
        map.getContainer().style.cursor = '';
    },

    /**
     * Add a water drop
     */
    addWaterDrop(latlng, map) {
        const waterdrop = {
            id: Date.now(),
            center: latlng,
            radius: this.waterdropRadius
        };
        
        this.waterdrops.push(waterdrop);
        
        // Draw water drop circle
        const circle = L.circle(latlng, {
            radius: this.waterdropRadius,
            color: '#00bfff',
            fillColor: '#00bfff',
            fillOpacity: 0.4,
            weight: 2,
            className: 'waterdrop-circle'
        }).addTo(this.suppressionLayer);
        
        // Add tooltip
        circle.bindPopup(`
            <div style="font-size: 12px;">
                <strong>💧 Water Drop</strong><br>
                Radius: ${this.waterdropRadius}m<br>
                Area: ${((this.waterdropRadius * this.waterdropRadius * Math.PI) / 10000).toFixed(2)} ha
            </div>
        `);
        
        waterdrop.layer = circle;
        
        // Update count
        document.getElementById('waterdrop-count').textContent = this.waterdrops.length;
        
        // Show suppression stats
        document.getElementById('suppression-controls').style.display = 'block';
    },

    /**
     * Check if a point is blocked by firebreak
     */
    isBlockedByFirebreak(lat1, lng1, lat2, lng2) {
        for (const firebreak of this.firebreaks) {
            if (this.lineSegmentsIntersect(
                lat1, lng1, lat2, lng2,
                firebreak.start.lat, firebreak.start.lng,
                firebreak.end.lat, firebreak.end.lng
            )) {
                return true;
            }
        }
        return false;
    },

    /**
     * Check if line segments intersect
     */
    lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denominator = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
        
        if (denominator === 0) return false;
        
        const ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / denominator;
        const ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / denominator;
        
        return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
    },

    /**
     * Check if a point is in water drop zone
     */
    isInWaterDrop(lat, lng, map) {
        for (const waterdrop of this.waterdrops) {
            const distance = map.distance([lat, lng], waterdrop.center);
            if (distance <= waterdrop.radius) {
                return true;
            }
        }
        return false;
    },

    /**
     * Clear all suppression tools
     */
    clearAll(map) {
        // Remove all layers
        if (this.suppressionLayer) {
            this.suppressionLayer.clearLayers();
        }
        
        // Reset arrays
        this.firebreaks = [];
        this.waterdrops = [];
        
        // Update counts
        document.getElementById('firebreak-count').textContent = '0';
        document.getElementById('waterdrop-count').textContent = '0';
    },

    /**
     * Set firebreak width
     */
    setFirebreakWidth(width) {
        this.firebreakWidth = width;
        document.getElementById('firebreak-width-value').textContent = width;
    },

    /**
     * Set water drop radius
     */
    setWaterdropRadius(radius) {
        this.waterdropRadius = radius;
        document.getElementById('waterdrop-radius-value').textContent = radius;
    }
};
