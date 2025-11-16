class FireSpreadSimulator {
    constructor(gridData, fireLinePoints) {
        this.gridData = gridData;
        this.fireLinePoints = fireLinePoints;
        this.cellSize = 100;
        
        this.cellIndexMap = new Map();
        this.burnTimeMap = new Map();
        this.igniteTimeMap = new Map();
        this.neighborsMap = new Map(); // Кэш соседей для оптимизации
        
        this.initializeGrid();
        this.precomputeNeighbors(); // Предвычисляем соседей один раз
        this.computeIgniteTimes();
    }
    
    initializeGrid() {
        for (let i = 0; i < this.gridData.length; i++) {
            const cell = this.gridData[i];
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            const key = this.getCellKey([center.lat, center.lng]);
            
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
    
    precomputeNeighbors() {
        // Предвычисляем соседей для всех ячеек один раз
        console.log('Предвычисление соседей...');
        const cellCenters = new Map(); // Кэш центров ячеек
        
        // Сначала собираем все центры
        for (let [key, index] of this.cellIndexMap) {
            const cell = this.gridData[index];
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            cellCenters.set(key, { lat: center.lat, lng: center.lng, index: index });
        }
        
        const maxDistance = 0.002;
        let processed = 0;
        
        // Для каждой ячейки находим соседей
        for (let [key, centerData] of cellCenters) {
            const { lat, lng } = centerData;
            const candidates = [];
            
            // Ищем только в близких ячейках (оптимизация: проверяем только близкие координаты)
            for (let [otherKey, otherCenterData] of cellCenters) {
                if (otherKey === key) continue;
                
                const { lat: otherLat, lng: otherLng } = otherCenterData;
                const latDiff = Math.abs(otherLat - lat);
                const lngDiff = Math.abs(otherLng - lng);
                
                // Быстрая проверка без вычисления sqrt
                if (latDiff < maxDistance && lngDiff < maxDistance) {
                    const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
                    if (distance < maxDistance && distance > 0.0001) {
                        candidates.push({
                            key: otherKey,
                            latDiff: latDiff,
                            lngDiff: lngDiff,
                            distance: distance,
                            otherLat: otherLat,
                            otherLng: otherLng
                        });
                    }
                }
            }
            
            candidates.sort((a, b) => a.distance - b.distance);
            
            const result = [];
            const directions = { north: null, south: null, east: null, west: null };
            
            for (let candidate of candidates) {
                const { key: otherKey, latDiff, lngDiff, otherLat, otherLng } = candidate;
                
                if (latDiff > lngDiff * 1.5) {
                    if (otherLat > lat && !directions.north) {
                        directions.north = otherKey;
                        result.push(otherKey);
                    } else if (otherLat < lat && !directions.south) {
                        directions.south = otherKey;
                        result.push(otherKey);
                    }
                } else if (lngDiff > latDiff * 1.5) {
                    if (otherLng > lng && !directions.east) {
                        directions.east = otherKey;
                        result.push(otherKey);
                    } else if (otherLng < lng && !directions.west) {
                        directions.west = otherKey;
                        result.push(otherKey);
                    }
                }
                
                if (result.length >= 4) break;
            }
            
            this.neighborsMap.set(key, result);
            processed++;
            if (processed % 10000 === 0) {
                console.log(`Обработано ${processed} ячеек...`);
            }
        }
        console.log('Предвычисление соседей завершено');
    }
    
    getNeighbors(cellKey) {
        // Используем предвычисленных соседей
        return this.neighborsMap.get(cellKey) || [];
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
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            
            const intersectsLine = this.lineIntersectsRectangle(this.fireLinePoints, bounds);
            const isInside = this.isPointInPolygon(center, closedPolygon);
            
            if (intersectsLine) {
                this.igniteTimeMap.set(key, 0);
                priorityQueue.push({ key: key, igniteTime: 0 });
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
                continue;
            }
            
            const storedIgniteTime = this.igniteTimeMap.get(currentKey);
            if (currentIgniteTime > storedIgniteTime) {
                continue;
            }
            
            visited.add(currentKey);
            
            const burnTime = this.burnTimeMap.get(currentKey);
            if (burnTime === null || burnTime === undefined || burnTime <= 0) {
                continue;
            }
            
            const neighbors = this.getNeighbors(currentKey);
            
            for (let neighborKey of neighbors) {
                if (visited.has(neighborKey)) continue;
                
                const neighborIgniteTime = this.igniteTimeMap.get(neighborKey);
                if (neighborIgniteTime === -Infinity) continue;
                
                const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                if (neighborBurnTime === null || neighborBurnTime === undefined || neighborBurnTime <= 0) {
                    continue;
                }
                
                const newIgniteTime = currentIgniteTime + burnTime;
                
                if (newIgniteTime < neighborIgniteTime) {
                    this.igniteTimeMap.set(neighborKey, newIgniteTime);
                    
                    const existingIndex = priorityQueue.findIndex(item => item.key === neighborKey);
                    if (existingIndex >= 0) {
                        if (newIgniteTime < priorityQueue[existingIndex].igniteTime) {
                            priorityQueue[existingIndex].igniteTime = newIgniteTime;
                            priorityQueue.sort((a, b) => a.igniteTime - b.igniteTime);
                        }
                    } else {
                        priorityQueue.push({ key: neighborKey, igniteTime: newIgniteTime });
                        priorityQueue.sort((a, b) => a.igniteTime - b.igniteTime);
                    }
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
    
    // Новая функция для прогноза распространения огня
    // На вход: текущая карта (burnedCells - Set индексов сгоревших ячеек), зона пожара (fireLinePoints), время прогноза (timeMinutes)
    // На выход: Set индексов ячеек, которые будут под пожаром к этому времени
    predictFireSpread(burnedCells, fireLinePoints, timeMinutes) {
        const closedPolygon = [...fireLinePoints];
        if (closedPolygon.length > 0 && 
            (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
             closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
            closedPolygon.push(closedPolygon[0]);
        }
        
        // Инициализация: помечаем ячейки на линии огня как горящие
        const burningCells = new Set(); // Индексы горящих ячеек
        const remainingBurnTime = new Map(); // Оставшееся время горения для каждой ячейки
        let remainingTime = timeMinutes; // Оставшееся время прогноза
        
        // Находим ячейки на линии огня и внутри области
        for (let [key, cellIndex] of this.cellIndexMap) {
            const cell = this.gridData[cellIndex];
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            
            const intersectsLine = this.lineIntersectsRectangle(fireLinePoints, bounds);
            const isInside = this.isPointInPolygon(center, closedPolygon);
            
            if (intersectsLine || isInside) {
                if (!burnedCells.has(cellIndex)) {
                    const burnTime = this.burnTimeMap.get(key);
                    if (burnTime !== null && burnTime !== undefined && burnTime > 0) {
                        burningCells.add(cellIndex);
                        remainingBurnTime.set(cellIndex, burnTime);
                    }
                }
            }
        }
        
        // Основной цикл: находим ячейку, которая сгорит раньше всех, и распространяем огонь
        while (remainingTime > 0 && burningCells.size > 0) {
            // Находим ячейку с минимальным временем горения
            let minBurnTime = Infinity;
            let nextCellIndex = null;
            
            for (let cellIndex of burningCells) {
                const burnTime = remainingBurnTime.get(cellIndex);
                if (burnTime < minBurnTime) {
                    minBurnTime = burnTime;
                    nextCellIndex = cellIndex;
                }
            }
            
            // Если минимальное время горения больше оставшегося времени, останавливаемся
            if (minBurnTime > remainingTime || nextCellIndex === null) {
                break;
            }
            
            // Помечаем ячейку как сгоревшую
            burningCells.delete(nextCellIndex);
            burnedCells.add(nextCellIndex);
            remainingBurnTime.delete(nextCellIndex);
            
            // Вычитаем время горения этой ячейки из оставшегося времени
            remainingTime -= minBurnTime;
            
            // Вычитаем это время из всех остальных горящих ячеек
            for (let cellIndex of burningCells) {
                const currentTime = remainingBurnTime.get(cellIndex);
                remainingBurnTime.set(cellIndex, currentTime - minBurnTime);
            }
            
            // Находим соседей сгоревшей ячейки и добавляем их в горящие
            const cellKey = this.getCellKeyFromIndex(nextCellIndex);
            if (cellKey) {
                const neighbors = this.getNeighbors(cellKey);
                
                for (let neighborKey of neighbors) {
                    const neighborIndex = this.cellIndexMap.get(neighborKey);
                    if (neighborIndex !== undefined && 
                        !burnedCells.has(neighborIndex) && 
                        !burningCells.has(neighborIndex)) {
                        
                        const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                        if (neighborBurnTime !== null && 
                            neighborBurnTime !== undefined && 
                            neighborBurnTime > 0) {
                            
                            burningCells.add(neighborIndex);
                            remainingBurnTime.set(neighborIndex, neighborBurnTime);
                        }
                    }
                }
            }
        }
        
        // Возвращаем все сгоревшие ячейки (включая изначально горящие)
        return burnedCells;
    }
    
    // Вспомогательная функция для получения ключа ячейки по индексу
    getCellKeyFromIndex(cellIndex) {
        for (let [key, index] of this.cellIndexMap) {
            if (index === cellIndex) {
                return key;
            }
        }
        return null;
    }
}
