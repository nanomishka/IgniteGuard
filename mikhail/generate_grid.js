const fs = require('fs');

function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function getCellValue(lat, lng) {
    const baseCellSizeM = 100;
    const latStep = baseCellSizeM / 111000;
    const lngStep = baseCellSizeM / (111000 * Math.cos(lat * Math.PI / 180));
    
    const latIndex = Math.floor(lat / latStep);
    const lngIndex = Math.floor(lng / lngStep);
    
    const seed = latIndex * 374761393 + lngIndex * 668265263;
    let value = seededRandom(seed);
    
    const threshold = 0.2;
    if (value < threshold) {
        return 0;
    }
    
    return (value - threshold) / (1 - threshold);
}

function isPointInPolygon(point, latlngs) {
    if (!latlngs || latlngs.length < 3) return false;
    
    let ring = latlngs;
    if (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof Array)) {
        ring = latlngs;
    } else if (Array.isArray(latlngs[0])) {
        ring = latlngs[0];
    }
    
    let inside = false;
    const x = point[1];
    const y = point[0];
    
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const pi = ring[i];
        const pj = ring[j];
        const xi = Array.isArray(pi) ? pi[1] : pi.lng;
        const yi = Array.isArray(pi) ? pi[0] : pi.lat;
        const xj = Array.isArray(pj) ? pj[1] : pj.lng;
        const yj = Array.isArray(pj) ? pj[0] : pj.lat;
        
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    
    return inside;
}

const limassolData = JSON.parse(fs.readFileSync('cy_regions.json', 'utf8'));
const limassolFeature = limassolData.features.find(f => f.properties && f.properties.name === 'Limassol');

if (!limassolFeature) {
    console.error('Limassol not found');
    process.exit(1);
}

const coordinates = limassolFeature.geometry.coordinates;
const gridData = [];

const fixedGridStepM = 100;
const displaySizeM = 100;

let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

function extractBounds(coords) {
    for (let coord of coords) {
        if (Array.isArray(coord[0])) {
            extractBounds(coord);
        } else {
            const lat = coord[1];
            const lng = coord[0];
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
        }
    }
}

extractBounds(coordinates);

const avgLat = (minLat + maxLat) / 2;
const fixedLatStep = fixedGridStepM / 111000;
const fixedLngStep = fixedGridStepM / (111000 * Math.cos(avgLat * Math.PI / 180));
const displayLatStep = displaySizeM / 111000;
const displayLngStep = displaySizeM / (111000 * Math.cos(avgLat * Math.PI / 180));

let count = 0;

for (let lat = minLat; lat < maxLat; lat += fixedLatStep) {
    for (let lng = minLng; lng < maxLng; lng += fixedLngStep) {
        const point = [lat, lng];
        let inside = false;
        
        for (let ring of coordinates) {
            if (Array.isArray(ring[0][0])) {
                for (let subRing of ring) {
                    if (isPointInPolygon(point, subRing)) {
                        inside = true;
                        break;
                    }
                }
            } else {
                if (isPointInPolygon(point, ring)) {
                    inside = true;
                    break;
                }
            }
            if (inside) break;
        }
        
        if (!inside) continue;
        
        const value = getCellValue(lat, lng);
        
        const halfDisplayLatStep = displayLatStep / 2;
        const halfDisplayLngStep = displayLngStep / 2;
        
        let r, g, b, opacity;
        if (value === 0) {
            r = 255;
            g = 192;
            b = 203;
            opacity = 0;
        } else {
            r = Math.round(255 - value * 127);
            g = Math.round(192 - value * 192);
            b = Math.round(203 - value * 75);
            opacity = 0.2 + value * 0.6;
        }
        
        gridData.push({
            center: [lat, lng],
            bounds: [
                [lat - halfDisplayLatStep, lng - halfDisplayLngStep],
                [lat + halfDisplayLatStep, lng + halfDisplayLngStep]
            ],
            color: { r, g, b },
            opacity: opacity
        });
        
        count++;
        if (count % 1000 === 0) {
            console.log(`Generated ${count} squares...`);
        }
    }
}

fs.writeFileSync('grid_data.json', JSON.stringify(gridData, null, 2));
console.log(`Grid generated: ${count} squares saved to grid_data.json`);

