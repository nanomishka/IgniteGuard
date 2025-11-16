/**
 * Suppression Module
 * 
 * Handles firebreaks and water drops for fire suppression
 */

const SuppressionUtils = {
    
    /**
     * Initialize suppression layer
     */
    initSuppressionLayer() {
        if (!FireSimulation.suppressionLayer) {
            FireSimulation.suppressionLayer = L.layerGroup().addTo(MapUtils.map);
        }
    },

    /**
     * Constrain line length to maximum distance
     */
    constrainLineLength(startLatLng, endLatLng, maxLengthKm) {
        const R = 6371; // Earth's radius in km
        
        const lat1 = startLatLng.lat * Math.PI / 180;
        const lat2 = endLatLng.lat * Math.PI / 180;
        const dLat = (endLatLng.lat - startLatLng.lat) * Math.PI / 180;
        const dLng = (endLatLng.lng - startLatLng.lng) * Math.PI / 180;
        
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        
        if (distance <= maxLengthKm) {
            return endLatLng;
        }
        
        const ratio = maxLengthKm / distance;
        const newLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ratio;
        const newLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ratio;
        
        return L.latLng(newLat, newLng);
    },

    /**
     * Get line pixels for firebreak
     */
    getLinePixels(startLatLng, endLatLng, widthMeters) {
        const georaster = MapUtils.georaster;
        if (!georaster) return [];
        
        const x1 = Math.floor((startLatLng.lng - georaster.xmin) / georaster.pixelWidth);
        const y1 = Math.floor((georaster.ymax - startLatLng.lat) / georaster.pixelHeight);
        const x2 = Math.floor((endLatLng.lng - georaster.xmin) / georaster.pixelWidth);
        const y2 = Math.floor((georaster.ymax - endLatLng.lat) / georaster.pixelHeight);

        const metersPerPixel = georaster.pixelWidth * 111000;
        const widthPixels = Math.ceil(widthMeters / metersPerPixel);

        const pixels = [];
        const pixelSet = new Set();
        
        // Bresenham's line algorithm with width
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const sx = x1 < x2 ? 1 : -1;
        const sy = y1 < y2 ? 1 : -1;
        let err = dx - dy;

        let x = x1, y = y1;

        const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const perpX = length > 0 ? -(y2 - y1) / length : 0;
        const perpY = length > 0 ? (x2 - x1) / length : 0;

        while (true) {
            for (let w = -widthPixels; w <= widthPixels; w++) {
                const px = Math.round(x + perpX * w);
                const py = Math.round(y + perpY * w);
                if (px >= 0 && px < georaster.width && py >= 0 && py < georaster.height) {
                    const key = `${px},${py}`;
                    if (!pixelSet.has(key)) {
                        pixelSet.add(key);
                        pixels.push({ x: px, y: py });
                    }
                }
            }

            if (x === x2 && y === y2) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }

        return pixels;
    },

    /**
     * Get circle pixels for water drop
     */
    getCirclePixels(centerLatLng, radiusKm) {
        const georaster = MapUtils.georaster;
        if (!georaster) return [];
        
        const centerX = Math.floor((centerLatLng.lng - georaster.xmin) / georaster.pixelWidth);
        const centerY = Math.floor((georaster.ymax - centerLatLng.lat) / georaster.pixelHeight);
        
        const metersPerPixel = georaster.pixelWidth * 111000;
        const radiusPixels = Math.ceil((radiusKm * 1000) / metersPerPixel);

        const pixels = [];
        for (let dx = -radiusPixels; dx <= radiusPixels; dx++) {
            for (let dy = -radiusPixels; dy <= radiusPixels; dy++) {
                if (dx * dx + dy * dy <= radiusPixels * radiusPixels) {
                    const px = centerX + dx;
                    const py = centerY + dy;
                    if (px >= 0 && px < georaster.width && py >= 0 && py < georaster.height) {
                        pixels.push({ x: px, y: py });
                    }
                }
            }
        }

        return pixels;
    },

    /**
     * Draw firebreak on map
     */
    drawFirebreak(startLatLng, endLatLng) {
        this.initSuppressionLayer();
        
        const widthKm = FireSimulation.firebreakWidth;
        const lengthKm = FireSimulation.firebreakLength;
        const widthMeters = widthKm * 1000;
        
        const constrainedEnd = this.constrainLineLength(startLatLng, endLatLng, lengthKm);
        
        // Calculate rectangle corners
        const dx = constrainedEnd.lng - startLatLng.lng;
        const dy = constrainedEnd.lat - startLatLng.lat;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        const widthDegrees = widthKm / 111;
        const perpX = length > 0 ? -(dy / length) * widthDegrees / 2 : 0;
        const perpY = length > 0 ? (dx / length) * widthDegrees / 2 : 0;
        
        const corner1 = L.latLng(startLatLng.lat + perpY, startLatLng.lng + perpX);
        const corner2 = L.latLng(startLatLng.lat - perpY, startLatLng.lng - perpX);
        const corner3 = L.latLng(constrainedEnd.lat - perpY, constrainedEnd.lng - perpX);
        const corner4 = L.latLng(constrainedEnd.lat + perpY, constrainedEnd.lng + perpX);
        
        const rectangle = L.polygon([corner1, corner2, corner3, corner4], {
            color: '#8B4513',
            fillColor: '#D2691E',
            fillOpacity: 0.6,
            weight: 2,
            className: 'firebreak-rectangle'
        }).addTo(FireSimulation.suppressionLayer);

        const affectedCells = this.getLinePixels(startLatLng, constrainedEnd, widthMeters);
        
        affectedCells.forEach(cell => {
            const key = `${cell.x},${cell.y}`;
            FireSimulation.suppressedCells.add(key);
        });

        FireSimulation.firebreaks.push({
            start: startLatLng,
            end: constrainedEnd,
            rectangle: rectangle,
            cells: affectedCells,
            width: widthKm,
            length: lengthKm
        });

        this.updateSuppressionStats();
    },

    /**
     * Add water drop on map
     */
    addWaterDrop(latLng) {
        this.initSuppressionLayer();
        
        const radiusKm = FireSimulation.waterdropRadius;
        const radiusMeters = radiusKm * 1000;
        
        const circle = L.circle(latLng, {
            radius: radiusMeters,
            color: '#0088ff',
            fillColor: '#00ccff',
            fillOpacity: 0.4,
            weight: 2
        }).addTo(FireSimulation.suppressionLayer);

        const affectedCells = this.getCirclePixels(latLng, radiusKm);
        
        affectedCells.forEach(cell => {
            const key = `${cell.x},${cell.y}`;
            FireSimulation.suppressedCells.add(key);
        });

        FireSimulation.waterdrops.push({
            center: latLng,
            radius: radiusKm,
            circle: circle,
            cells: affectedCells,
            timestamp: Date.now()
        });

        this.updateSuppressionStats();
    },

    /**
     * Update suppression statistics display
     */
    updateSuppressionStats() {
        const firebreakKm = FireSimulation.firebreaks.reduce((sum, fb) => sum + fb.length, 0).toFixed(2);
        const waterdropArea = FireSimulation.waterdrops.reduce((sum, wd) => sum + Math.PI * wd.radius * wd.radius, 0).toFixed(2);
        
        document.getElementById('firebreakCount').textContent = `${FireSimulation.firebreaks.length} (${firebreakKm} km)`;
        document.getElementById('waterdropCount').textContent = `${FireSimulation.waterdrops.length} (${waterdropArea} km²)`;
        document.getElementById('suppressionStats').style.display = 
            (FireSimulation.firebreaks.length > 0 || FireSimulation.waterdrops.length > 0) ? 'block' : 'none';
    },

    /**
     * Clear all suppression actions
     */
    clearSuppressionActions() {
        if (FireSimulation.suppressionLayer) {
            FireSimulation.suppressionLayer.clearLayers();
        }
        FireSimulation.firebreaks = [];
        FireSimulation.waterdrops = [];
        FireSimulation.suppressedCells.clear();
        this.updateSuppressionStats();
    }
};
