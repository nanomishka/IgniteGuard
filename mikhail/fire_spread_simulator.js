class FireSpreadSimulator {
    constructor(gridData, fireLinePoints) {
        this.gridData = gridData;
        this.fireLinePoints = fireLinePoints;
        this.cellSize = 10;
        
        this.cellIndexMap = new Map();
        this.burnTimeMap = new Map();
        this.igniteTimeMap = new Map();
        
        this.initializeGrid();
        this.computeIgniteTimes();
    }
    
    initializeGrid() {
        for (let i = 0; i < this.gridData.length; i++) {
            const cell = this.gridData[i];
            const center = cell.center;
            const key = this.getCellKey(center);
            
            this.cellIndexMap.set(key, i);
            
            if (cell.burn_time_minutes !== null && cell.burn_time_minutes !== undefined) {
                this.burnTimeMap.set(key, cell.burn_time_minutes);
            }
        }
    }
    
    getCellKey(center) {
        return `${center[0].toFixed(6)}_${center[1].toFixed(6)}`;
    }
    
    isPointInPolygon(point, latlngs) {
        if (!latlngs || latlngs.length < 3) return false;
        
        let ring = latlngs;
        if (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
            ring = latlngs[0];
        }
        
        let inside = false;
        const x = point.lng !== undefined ? point.lng : point[1];
        const y = point.lat !== undefined ? point.lat : point[0];
        
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const pi = ring[i];
            const pj = ring[j];
            const xi = (pi.lng !== undefined) ? pi.lng : pi[1];
            const yi = (pi.lat !== undefined) ? pi.lat : pi[0];
            const xj = (pj.lng !== undefined) ? pj.lng : pj[1];
            const yj = (pj.lat !== undefined) ? pj.lat : pj[0];
            
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        
        return inside;
    }
    
    lineIntersectsRectangle(linePoints, bounds) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const corners = [
            sw,
            L.latLng(ne.lat, sw.lng),
            ne,
            L.latLng(sw.lat, ne.lng)
        ];
        
        const epsilon = 1e-6;
        
        for (let i = 0; i < linePoints.length; i++) {
            const p1 = linePoints[i];
            const p2 = linePoints[(i + 1) % linePoints.length];
            
            for (let j = 0; j < corners.length; j++) {
                const c1 = corners[j];
                const c2 = corners[(j + 1) % corners.length];
                
                if (this.segmentsIntersect(p1, p2, c1, c2, epsilon)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    segmentsIntersect(p1, p2, p3, p4, epsilon) {
        const d1 = this.direction(p3, p4, p1);
        const d2 = this.direction(p3, p4, p2);
        const d3 = this.direction(p1, p2, p3);
        const d4 = this.direction(p1, p2, p4);
        
        if (((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon)) &&
            ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon))) {
            return true;
        }
        
        if (Math.abs(d1) < epsilon && this.onSegment(p3, p4, p1, epsilon)) return true;
        if (Math.abs(d2) < epsilon && this.onSegment(p3, p4, p2, epsilon)) return true;
        if (Math.abs(d3) < epsilon && this.onSegment(p1, p2, p3, epsilon)) return true;
        if (Math.abs(d4) < epsilon && this.onSegment(p1, p2, p4, epsilon)) return true;
        
        return false;
    }
    
    direction(pi, pj, pk) {
        const xi = (pi.lng !== undefined) ? pi.lng : pi[1];
        const yi = (pi.lat !== undefined) ? pi.lat : pi[0];
        const xj = (pj.lng !== undefined) ? pj.lng : pj[1];
        const yj = (pj.lat !== undefined) ? pj.lat : pj[0];
        const xk = (pk.lng !== undefined) ? pk.lng : pk[1];
        const yk = (pk.lat !== undefined) ? pk.lat : pk[0];
        
        return (xk - xi) * (yj - yi) - (xj - xi) * (yk - yi);
    }
    
    onSegment(pi, pj, pk, epsilon) {
        const xi = (pi.lng !== undefined) ? pi.lng : pi[1];
        const yi = (pi.lat !== undefined) ? pi.lat : pi[0];
        const xj = (pj.lng !== undefined) ? pj.lng : pj[1];
        const yj = (pj.lat !== undefined) ? pj.lat : pj[0];
        const xk = (pk.lng !== undefined) ? pk.lng : pk[1];
        const yk = (pk.lat !== undefined) ? pk.lat : pk[0];
        
        return Math.min(xi, xj) - epsilon <= xk && xk <= Math.max(xi, xj) + epsilon &&
               Math.min(yi, yj) - epsilon <= yk && yk <= Math.max(yi, yj) + epsilon;
    }
    
    getNeighbors(cellKey) {
        const cellIndex = this.cellIndexMap.get(cellKey);
        if (cellIndex === undefined) return [];
        
        const cell = this.gridData[cellIndex];
        const [lat, lng] = cell.center;
        
        const maxDistance = 0.0002;
        const candidates = [];
        
        for (let [otherKey, otherIndex] of this.cellIndexMap) {
            if (otherKey === cellKey) continue;
            
            const otherCell = this.gridData[otherIndex];
            const [otherLat, otherLng] = otherCell.center;
            
            const latDiff = Math.abs(otherLat - lat);
            const lngDiff = Math.abs(otherLng - lng);
            const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
            
            if (distance < maxDistance && distance > 0.00001) {
                candidates.push({
                    key: otherKey,
                    latDiff: latDiff,
                    lngDiff: lngDiff,
                    distance: distance
                });
            }
        }
        
        candidates.sort((a, b) => a.distance - b.distance);
        
        const result = [];
        const directions = { north: null, south: null, east: null, west: null };
        
        for (let candidate of candidates) {
            const { key, latDiff, lngDiff } = candidate;
            const otherCell = this.gridData[this.cellIndexMap.get(key)];
            const [otherLat, otherLng] = otherCell.center;
            
            if (latDiff > lngDiff * 2) {
                if (otherLat > lat && !directions.north) {
                    directions.north = key;
                    result.push(key);
                } else if (otherLat < lat && !directions.south) {
                    directions.south = key;
                    result.push(key);
                }
            } else if (lngDiff > latDiff * 2) {
                if (otherLng > lng && !directions.east) {
                    directions.east = key;
                    result.push(key);
                } else if (otherLng < lng && !directions.west) {
                    directions.west = key;
                    result.push(key);
                }
            }
            
            if (result.length >= 4) break;
        }
        
        return result;
    }
    
    computeIgniteTimes() {
        const closedPolygon = [...this.fireLinePoints];
        if (closedPolygon.length > 0 && 
            (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
             closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
            closedPolygon.push(closedPolygon[0]);
        }
        
        const priorityQueue = [];
        const visited = new Set();
        
        for (let [key, cellIndex] of this.cellIndexMap) {
            const cell = this.gridData[cellIndex];
            const center = L.latLng(cell.center[0], cell.center[1]);
            const bounds = L.latLngBounds(cell.bounds);
            
            const intersectsLine = this.lineIntersectsRectangle(this.fireLinePoints, bounds);
            const isInside = this.isPointInPolygon(center, closedPolygon);
            
            if (intersectsLine) {
                this.igniteTimeMap.set(key, 0);
                priorityQueue.push({ key: key, igniteTime: 0 });
                visited.add(key);
            } else if (isInside) {
                this.igniteTimeMap.set(key, -Infinity);
            } else {
                this.igniteTimeMap.set(key, Infinity);
            }
        }
        
        priorityQueue.sort((a, b) => a.igniteTime - b.igniteTime);
        
        while (priorityQueue.length > 0) {
            const current = priorityQueue.shift();
            const currentKey = current.key;
            const currentIgniteTime = current.igniteTime;
            
            if (visited.has(currentKey)) {
                if (current.igniteTime > this.igniteTimeMap.get(currentKey)) {
                    continue;
                }
            }
            
            visited.add(currentKey);
            
            const burnTime = this.burnTimeMap.get(currentKey);
            if (burnTime === null || burnTime === undefined || burnTime <= 0) continue;
            
            const neighbors = this.getNeighbors(currentKey);
            
            for (let neighborKey of neighbors) {
                if (visited.has(neighborKey)) continue;
                
                const neighborIgniteTime = this.igniteTimeMap.get(neighborKey);
                if (neighborIgniteTime === -Infinity) continue;
                
                const newIgniteTime = currentIgniteTime + burnTime;
                
                if (newIgniteTime < neighborIgniteTime) {
                    this.igniteTimeMap.set(neighborKey, newIgniteTime);
                    
                    const existingIndex = priorityQueue.findIndex(item => item.key === neighborKey);
                    if (existingIndex >= 0) {
                        priorityQueue[existingIndex].igniteTime = newIgniteTime;
                    } else {
                        priorityQueue.push({ key: neighborKey, igniteTime: newIgniteTime });
                    }
                    priorityQueue.sort((a, b) => a.igniteTime - b.igniteTime);
                }
            }
        }
    }
    
    getStateAt(t) {
        const burningMask = new Map();
        const burnedMask = new Map();
        const unburnedMask = new Map();
        
        for (let [key, cellIndex] of this.cellIndexMap) {
            const igniteTime = this.igniteTimeMap.get(key);
            const burnTime = this.burnTimeMap.get(key);
            
            if (igniteTime === -Infinity) {
                burnedMask.set(cellIndex, true);
                burningMask.set(cellIndex, false);
                unburnedMask.set(cellIndex, false);
            } else if (igniteTime === Infinity || igniteTime === undefined) {
                unburnedMask.set(cellIndex, true);
                burningMask.set(cellIndex, false);
                burnedMask.set(cellIndex, false);
            } else if (burnTime === null || burnTime === undefined || burnTime <= 0) {
                unburnedMask.set(cellIndex, true);
                burningMask.set(cellIndex, false);
                burnedMask.set(cellIndex, false);
            } else {
                const burnEndTime = igniteTime + burnTime;
                
                if (t >= burnEndTime) {
                    burnedMask.set(cellIndex, true);
                    burningMask.set(cellIndex, false);
                    unburnedMask.set(cellIndex, false);
                } else if (t >= igniteTime) {
                    burningMask.set(cellIndex, true);
                    burnedMask.set(cellIndex, false);
                    unburnedMask.set(cellIndex, false);
                } else {
                    unburnedMask.set(cellIndex, true);
                    burningMask.set(cellIndex, false);
                    burnedMask.set(cellIndex, false);
                }
            }
        }
        
        return {
            burningMask: burningMask,
            burnedMask: burnedMask,
            unburnedMask: unburnedMask
        };
    }
}
