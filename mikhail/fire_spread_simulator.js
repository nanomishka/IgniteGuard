class FireSpreadSimulator {
    constructor(gridData, fireLinePoints) {
        this.gridData = gridData;
        this.fireLinePoints = fireLinePoints;
        this.cellSize = 100;
        
        this.cellIndexMap = new Map();
        this.indexToKeyMap = new Map(); // Обратное отображение: индекс -> ключ
        this.burnTimeMap = new Map();
        this.igniteTimeMap = new Map();
        this.neighborsMap = new Map(); // Кэш соседей для оптимизации
        
        // Флаг для управления логированием (можно изменить вручную для отладки)
        this.enableLogging = false; // По умолчанию выключено для производительности
        
        this.initializeGrid();
        // НЕ делаем предвычисление соседей - все будет находиться "на лету" во время расчета
    }
    
    // Вспомогательный метод для логирования (проверяет флаг enableLogging)
    log(...args) {
        if (this.enableLogging) {
            console.log(...args);
        }
        // Предвычисление соседей и расчет времени зажигания отключены при создании
        // Они будут вызваны только по требованию через методы precomputeNeighbors() и computeIgniteTimes()
        // this.precomputeNeighbors(); // Предвычисляем соседей один раз
        // this.computeIgniteTimes();
    }
    
    initializeGrid() {
        for (let i = 0; i < this.gridData.length; i++) {
            const cell = this.gridData[i];
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            const key = this.getCellKey([center.lat, center.lng]);
            
            this.cellIndexMap.set(key, i);
            this.indexToKeyMap.set(i, key); // Обратное отображение
            
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
        this.log('Предвычисление соседей...');
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
            
            // Сохраняем индексы соседей вместо ключей для быстрого доступа
            const neighborIndices = result.map(neighborKey => {
                const neighborIndex = this.cellIndexMap.get(neighborKey);
                return neighborIndex;
            }).filter(idx => idx !== undefined);
            
            this.neighborsMap.set(centerData.index, neighborIndices);
            processed++;
            if (processed % 10000 === 0) {
                this.log(`Обработано ${processed} ячеек...`);
            }
        }
        this.log('Предвычисление соседей завершено');
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
            
            // Используем глобальные функции из script.js для единообразия
            const intersectsLine = typeof lineIntersectsRectangle === 'function'
                ? lineIntersectsRectangle(this.fireLinePoints, bounds)
                : this.lineIntersectsRectangle(this.fireLinePoints, bounds);
            const isInside = typeof isPointInPolygon === 'function'
                ? isPointInPolygon(center, closedPolygon)
                : this.isPointInPolygon(center, closedPolygon);
            
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
    
    // Функция поиска соседей для конкретной ячейки (на лету, без предвычисления)
    // Ищет соседей, которые соприкасаются стороной (север, юг, восток, запад)
    findNeighborsForCell(cellIndex) {
        const cell = this.gridData[cellIndex];
        const bounds = L.latLngBounds(cell.bounds);
        const center = bounds.getCenter();
        const cellLat = center.lat;
        const cellLng = center.lng;
        
        // Ищем соседей в 4 направлениях (север, юг, восток, запад)
        // Расстояние примерно равно размеру ячейки (100м ≈ 0.001 градуса)
        const searchDistance = 0.0015; // Немного больше, чтобы найти соседей
        const neighbors = [];
        
        for (let [key, otherIndex] of this.cellIndexMap) {
            if (otherIndex === cellIndex) continue;
            
            const otherCell = this.gridData[otherIndex];
            const otherBounds = L.latLngBounds(otherCell.bounds);
            const otherCenter = otherBounds.getCenter();
            const otherLat = otherCenter.lat;
            const otherLng = otherCenter.lng;
            
            const latDiff = Math.abs(otherLat - cellLat);
            const lngDiff = Math.abs(otherLng - cellLng);
            
            // Проверяем, является ли ячейка соседом (в пределах searchDistance)
            if (latDiff < searchDistance && lngDiff < searchDistance) {
                const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
                if (distance < searchDistance && distance > 0.0001) {
                    // Определяем направление: сосед должен быть строго в одном из 4 направлений
                    // (север, юг, восток, запад), а не по диагонали
                    // Для этого проверяем, что разница в одном направлении значительно больше, чем в другом
                    const isNorth = otherLat > cellLat && latDiff > lngDiff * 1.2;
                    const isSouth = otherLat < cellLat && latDiff > lngDiff * 1.2;
                    const isEast = otherLng > cellLng && lngDiff > latDiff * 1.2;
                    const isWest = otherLng < cellLng && lngDiff > latDiff * 1.2;
                    
                    if (isNorth || isSouth || isEast || isWest) {
                        neighbors.push(otherIndex);
                    }
                }
            }
        }
        
        return neighbors;
    }
    
    // Новая функция прогноза распространения огня (упрощенный алгоритм)
    // Принимает: текущую карту (состояние), помеченную зону где пожар, время для прогноза, callback для обновления визуализации
    // Возвращает: область, которая будет под пожаром к этому времени
    async predictFireSpread(currentState, fireZone, targetTime, onIterationComplete = null) {
        // currentState - объект с полями: burnedCells (Set), burningCells (Set), remainingBurnTimes (Map)
        // fireZone - массив точек линии огня
        // targetTime - время для прогноза в минутах
        
        // НЕ делаем предвычисление - все соседи находятся "на лету" во время расчета
        
        const burnedCells = new Set(currentState.burnedCells || []);
        const burningCells = new Set(currentState.burningCells || []);
        const remainingBurnTimes = new Map(currentState.remainingBurnTimes || []);
        const closedPolygon = [...fireZone];
        if (closedPolygon.length > 0 && 
            (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
             closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
            closedPolygon.push(closedPolygon[0]);
        }
        
        let remainingTime = targetTime;
        
        // Инициализация: помечаем ячейки внутри области или на линии огня как горящие
        // Используем ту же структуру данных и логику, что и в highlightSquaresInArea
        let initializedBurning = 0;
        let skippedNoBurnTime = 0;
        let skippedAlreadyBurned = 0;
        let totalInArea = 0;
        let totalIntersectsLine = 0;
        let totalInside = 0;
        
        // Используем gridData напрямую (как в highlightSquaresInArea используется gridDataWithBurnTime)
        for (let i = 0; i < this.gridData.length; i++) {
            const cell = this.gridData[i];
            const bounds = L.latLngBounds(cell.bounds);
            const center = bounds.getCenter();
            const cellKey = this.getCellKey([center.lat, center.lng]);
            
            // Используем глобальные функции из script.js для единообразия
            const intersectsLine = typeof lineIntersectsRectangle === 'function' 
                ? lineIntersectsRectangle(fireZone, bounds)
                : this.lineIntersectsRectangle(fireZone, bounds);
            const isInside = typeof isPointInPolygon === 'function'
                ? isPointInPolygon(center, closedPolygon)
                : this.isPointInPolygon(center, closedPolygon);
            
            // Если ячейка внутри области или пересекает линию огня
            if (isInside || intersectsLine) {
                totalInArea++;
                if (intersectsLine) {
                    totalIntersectsLine++;
                }
                if (isInside && !intersectsLine) {
                    totalInside++;
                }
                
                // Получаем индекс ячейки из cellIndexMap
                const cellIndex = this.cellIndexMap.get(cellKey);
                if (cellIndex === undefined || cellIndex === null) {
                    continue; // Ячейка не найдена в cellIndexMap
                }
                
                if (burnedCells.has(cellIndex)) {
                    skippedAlreadyBurned++;
                    continue;
                }
                if (burningCells.has(cellIndex)) {
                    continue;
                }
                
                // Логика: только ячейки, пересекающие линию огня, помечаются как горящие
                // Ячейки внутри области (но не пересекающие линию) помечаются как сгоревшие
                if (intersectsLine) {
                    // Ячейка пересекает линию огня - помечаем как горящую
                    const burnTime = this.burnTimeMap.get(cellKey);
                    if (burnTime && burnTime > 0) {
                        burningCells.add(cellIndex);
                        remainingBurnTimes.set(cellIndex, burnTime);
                        initializedBurning++;
                    } else {
                        skippedNoBurnTime++;
                    }
                } else if (isInside) {
                    // Ячейка внутри области, но не пересекает линию - помечаем как сгоревшую
                    burnedCells.add(cellIndex);
                }
            }
        }
        
        // Логирование инициализации
        this.log(`Инициализация:`);
        this.log(`  Всего ячеек в gridData: ${this.gridData.length}`);
        this.log(`  Всего ячеек в cellIndexMap: ${this.cellIndexMap.size}`);
        this.log(`  Всего ячеек в области: ${totalInArea}`);
        this.log(`  - Пересекают линию огня: ${totalIntersectsLine}`);
        this.log(`  - Внутри области (не пересекают): ${totalInside}`);
        this.log(`  Помечено горящих ячеек: ${initializedBurning}`);
        this.log(`  Пропущено (уже сгоревшие): ${skippedAlreadyBurned}`);
        this.log(`  Пропущено (нет времени сгорания): ${skippedNoBurnTime}`);
        this.log(`  Всего горящих ячеек после инициализации: ${burningCells.size}`);
        
        // Основной цикл: новый алгоритм - выбираем одного соседа с минимальным временем
        let iteration = 0;
        // Сохраняем список несгоревших соседей между итерациями для оптимизации
        let unburnedNeighborsMap = new Map(); // neighborIndex -> {burnTime, sourceIndex}
        // Сохраняем значения с предыдущей итерации
        let prevBestNeighborIndex = null;
        let prevBestNeighborTime = Infinity;
        let prevNewBurningCellIndex = null; // Ячейка, которая была подожжена на предыдущей итерации
        
        // Продолжаем итерации, пока есть время и есть горящие ячейки
        // Алгоритм продолжает работать, даже если список соседей временно пуст
        while (remainingTime > 0.001 && burningCells.size > 0) { // Небольшой эпсилон для избежания бесконечного цикла
            iteration++;
            
            const burningCountStart = burningCells.size;
            const burnedCountStart = burnedCells.size;
            const remainingTimeStart = remainingTime;
            
            // Логирование состояния в начале итерации
            this.log(`\n=== Итерация ${iteration} ===`);
            this.log(`Горящих точек в начале: ${burningCountStart}`);
            this.log(`Сгоревших точек: ${burnedCountStart}`);
            this.log(`Осталось времени: ${remainingTimeStart.toFixed(3)} минут`);
            
            // Находим всех несгоревших соседей для всех горящих ячеек
            // Ищем соседа с минимальным временем горения
            let bestNeighborIndex = null;
            let bestNeighborTime = Infinity;
            let bestNeighborSourceIndex = null; // Ячейка, от которой нашли этого соседа
            
            // Если список соседей пуст, но есть горящие ячейки и осталось время,
            // ищем соседей для всех горящих ячеек заново
            if (unburnedNeighborsMap.size === 0 && burningCells.size > 0 && remainingTime > 0.001) {
                // Собираем всех соседей для всех горящих ячеек
                for (let burningCellIndex of burningCells) {
                    const neighbors = this.findNeighborsForCell(burningCellIndex);
                    
                    for (let neighborIndex of neighbors) {
                        // Пропускаем уже сгоревшие или горящие ячейки
                        if (burnedCells.has(neighborIndex) || burningCells.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Пропускаем, если уже добавили этого соседа
                        if (unburnedNeighborsMap.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Получаем время сгорания соседа
                        const neighborKey = this.indexToKeyMap.get(neighborIndex);
                        if (!neighborKey) {
                            continue;
                        }
                        
                        const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                        if (!neighborBurnTime || neighborBurnTime <= 0) {
                            continue;
                        }
                        
                        // Добавляем ВСЕХ несгоревших соседей в список
                        unburnedNeighborsMap.set(neighborIndex, {
                            burnTime: neighborBurnTime,
                            sourceIndex: burningCellIndex
                        });
                    }
                }
            }
            
            // Оптимизация: на первой итерации собираем всех соседей,
            // на последующих - только добавляем соседей новой горящей ячейки
            if (iteration === 1) {
                // Первая итерация: собираем всех соседей для всех горящих ячеек
                for (let burningCellIndex of burningCells) {
                    const neighbors = this.findNeighborsForCell(burningCellIndex);
                    
                    for (let neighborIndex of neighbors) {
                        // Пропускаем уже сгоревшие или горящие ячейки
                        if (burnedCells.has(neighborIndex) || burningCells.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Пропускаем, если уже добавили этого соседа
                        if (unburnedNeighborsMap.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Получаем время сгорания соседа
                        const neighborKey = this.indexToKeyMap.get(neighborIndex);
                        if (!neighborKey) {
                            continue;
                        }
                        
                        const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                        if (!neighborBurnTime || neighborBurnTime <= 0) {
                            continue;
                        }
                        
                        // Добавляем ВСЕХ несгоревших соседей в список
                        unburnedNeighborsMap.set(neighborIndex, {
                            burnTime: neighborBurnTime,
                            sourceIndex: burningCellIndex
                        });
                    }
                }
            } else {
                // Последующие итерации: 
                // 1. Удаляем только что подожженную ячейку из списка (если она была там)
                if (prevBestNeighborIndex !== null && unburnedNeighborsMap.has(prevBestNeighborIndex)) {
                    unburnedNeighborsMap.delete(prevBestNeighborIndex);
                }
                
                // 2. Время уже обновлено в конце предыдущей итерации, поэтому просто используем текущие значения
                
                // 3. Добавляем только соседей новой горящей ячейки (той, что была подожжена на предыдущей итерации)
                if (prevNewBurningCellIndex !== null) {
                    const neighbors = this.findNeighborsForCell(prevNewBurningCellIndex);
                    
                    for (let neighborIndex of neighbors) {
                        // Пропускаем уже сгоревшие или горящие ячейки
                        if (burnedCells.has(neighborIndex) || burningCells.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Пропускаем, если уже есть в списке
                        if (unburnedNeighborsMap.has(neighborIndex)) {
                            continue;
                        }
                        
                        // Получаем время сгорания соседа
                        const neighborKey = this.indexToKeyMap.get(neighborIndex);
                        if (!neighborKey) {
                            continue;
                        }
                        
                        const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                        if (!neighborBurnTime || neighborBurnTime <= 0) {
                            continue;
                        }
                        
                        // Добавляем нового соседа в список с актуальным временем из burnTimeMap
                        // (время уже могло быть уменьшено на предыдущих итерациях)
                        unburnedNeighborsMap.set(neighborIndex, {
                            burnTime: neighborBurnTime,
                            sourceIndex: prevNewBurningCellIndex
                        });
                    }
                }
            }
            
            // Преобразуем Map в массив для удобства
            const unburnedNeighborsList = [];
            for (let [neighborIndex, data] of unburnedNeighborsMap) {
                unburnedNeighborsList.push({
                    index: neighborIndex,
                    burnTime: data.burnTime,
                    sourceIndex: data.sourceIndex
                });
            }
            
            // Выводим список несгоревших соседей
            this.log(`Несгоревших соседей: ${unburnedNeighborsList.length}`);
            for (let neighbor of unburnedNeighborsList) {
                const cell = this.gridData[neighbor.index];
                const bounds = L.latLngBounds(cell.bounds);
                const center = bounds.getCenter();
                this.log(`  ID ${neighbor.index}, координаты (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}): ${neighbor.burnTime.toFixed(3)} минут`);
            }
            
            // Ищем лучшего соседа из обновленного списка
            // Сначала ищем соседей, которые успеют полностью сгореть за оставшееся время
            for (let neighbor of unburnedNeighborsList) {
                const neighborBurnTime = neighbor.burnTime;
                
                if (neighborBurnTime <= remainingTime) {
                    // Если этот сосед быстрее всех найденных - запоминаем его
                    if (neighborBurnTime < bestNeighborTime) {
                        bestNeighborTime = neighborBurnTime;
                        bestNeighborIndex = neighbor.index;
                        bestNeighborSourceIndex = neighbor.sourceIndex;
                    }
                }
            }
            
            // Если нет соседей, которые успеют полностью сгореть, но есть несгоревшие соседи,
            // выбираем самую быструю из всех несгоревших соседей (даже если она не успеет полностью сгореть)
            if (bestNeighborIndex === null && unburnedNeighborsList.length > 0) {
                // Находим самую быструю из всех несгоревших соседей
                let fastestUnburnedNeighbor = null;
                let fastestUnburnedTime = Infinity;
                let fastestUnburnedSourceIndex = null;
                
                for (let neighbor of unburnedNeighborsList) {
                    if (neighbor.burnTime < fastestUnburnedTime) {
                        fastestUnburnedTime = neighbor.burnTime;
                        fastestUnburnedNeighbor = neighbor.index;
                        fastestUnburnedSourceIndex = neighbor.sourceIndex;
                    }
                }
                
                if (fastestUnburnedNeighbor !== null) {
                    bestNeighborIndex = fastestUnburnedNeighbor;
                    bestNeighborTime = fastestUnburnedTime;
                    bestNeighborSourceIndex = fastestUnburnedSourceIndex;
                }
            }
            
            // Если не нашли соседа, но есть время и есть горящие ячейки, 
            // попробуем найти соседей для всех горящих ячеек заново
            if (bestNeighborSourceIndex === null || bestNeighborTime === Infinity) {
                // Проверяем, есть ли еще горящие ячейки и осталось ли время
                if (burningCells.size > 0 && remainingTime > 0.001) {
                    // Пытаемся найти соседей для всех горящих ячеек
                    for (let burningCellIndex of burningCells) {
                        const neighbors = this.findNeighborsForCell(burningCellIndex);
                        
                        for (let neighborIndex of neighbors) {
                            if (burnedCells.has(neighborIndex) || burningCells.has(neighborIndex)) {
                                continue;
                            }
                            
                            if (unburnedNeighborsMap.has(neighborIndex)) {
                                continue;
                            }
                            
                            const neighborKey = this.indexToKeyMap.get(neighborIndex);
                            if (!neighborKey) {
                                continue;
                            }
                            
                            const neighborBurnTime = this.burnTimeMap.get(neighborKey);
                            if (!neighborBurnTime || neighborBurnTime <= 0) {
                                continue;
                            }
                            
                            unburnedNeighborsMap.set(neighborIndex, {
                                burnTime: neighborBurnTime,
                                sourceIndex: burningCellIndex
                            });
                            
                            // Выбираем самого быстрого из найденных
                            if (neighborBurnTime < bestNeighborTime) {
                                bestNeighborTime = neighborBurnTime;
                                bestNeighborIndex = neighborIndex;
                                bestNeighborSourceIndex = burningCellIndex;
                            }
                        }
                    }
                }
                
                // Если все еще не нашли соседа, но есть время и есть горящие ячейки,
                // продолжаем вычитать время из горящих ячеек, пока они не сгорят или не закончится время
                if (bestNeighborSourceIndex === null || bestNeighborTime === Infinity) {
                    if (burningCells.size > 0 && remainingTime > 0.001) {
                        // Находим горящую ячейку с минимальным оставшимся временем горения
                        let minRemainingTime = Infinity;
                        let cellToBurn = null;
                        
                        for (let burningCellIndex of burningCells) {
                            const cellRemainingTime = remainingBurnTimes.get(burningCellIndex);
                            if (cellRemainingTime !== undefined && cellRemainingTime > 0 && cellRemainingTime < minRemainingTime) {
                                minRemainingTime = cellRemainingTime;
                                cellToBurn = burningCellIndex;
                            }
                        }
                        
                        if (cellToBurn !== null) {
                            // Вычитаем время из оставшегося времени
                            const timeToSubtract = Math.min(minRemainingTime, remainingTime);
                            remainingTime -= timeToSubtract;
                            
                            // Обновляем время горения ячейки
                            const newRemainingTime = Math.max(0, minRemainingTime - timeToSubtract);
                            remainingBurnTimes.set(cellToBurn, newRemainingTime);
                            
                            // Если ячейка полностью сгорела, помечаем её как сгоревшую
                            if (newRemainingTime <= 0.001) {
                                burningCells.delete(cellToBurn);
                                burnedCells.add(cellToBurn);
                                remainingBurnTimes.delete(cellToBurn);
                            }
                            
                            this.log(`Вычитаем время из горящей ячейки: ${timeToSubtract.toFixed(3)} минут, осталось времени: ${remainingTime.toFixed(3)} минут`);
                            
                            // Вызываем callback для обновления визуализации
                            if (onIterationComplete) {
                                onIterationComplete({
                                    burnedCells: new Set(burnedCells),
                                    burningCells: new Set(burningCells),
                                    remainingBurnTimes: new Map(remainingBurnTimes),
                                    remainingTime: remainingTime,
                                    iteration: iteration
                                });
                            }
                            
                            // Минимальная задержка для визуализации
                            await new Promise(resolve => setTimeout(resolve, 10));
                            
                            // Продолжаем итерацию
                            continue;
                        }
                    }
                    
                    this.log(`Не найдено ячеек для обработки. Завершение расчета.`);
                    break;
                }
            }
            
            if (bestNeighborIndex !== null) {
                // Найден новый сосед - поджигаем его
                const bestCell = this.gridData[bestNeighborIndex];
                const bestBounds = L.latLngBounds(bestCell.bounds);
                const bestCenter = bestBounds.getCenter();
                
                this.log(`Найден сосед с минимальным временем горения: ID ${bestNeighborIndex}, время: ${bestNeighborTime.toFixed(3)} минут`);
                
                // Шаг 1: Помечаем найденного соседа как горящего
                burningCells.add(bestNeighborIndex);
                remainingBurnTimes.set(bestNeighborIndex, bestNeighborTime);
                
                this.log(`Помечаю ID ${bestNeighborIndex} красным как горящим`);
                
                // Шаг 2: Вычитаем это время из остальных несгоревших соседей
                // Сначала определяем, сколько времени вычитать (может быть меньше, если оставшееся время меньше)
                const timeToSubtract = Math.min(bestNeighborTime, remainingTime);
                
                // Обновляем время в burnTimeMap и unburnedNeighborsMap для всех несгоревших соседей
                for (let [neighborIndex, data] of unburnedNeighborsMap) {
                    // Пропускаем только что подожженную ячейку
                    if (neighborIndex === bestNeighborIndex) {
                        continue;
                    }
                    
                    const neighborKey = this.indexToKeyMap.get(neighborIndex);
                    if (!neighborKey) {
                        continue;
                    }
                    const currentBurnTime = this.burnTimeMap.get(neighborKey);
                    if (currentBurnTime && currentBurnTime > 0) {
                        const newBurnTime = Math.max(0, currentBurnTime - timeToSubtract);
                        this.burnTimeMap.set(neighborKey, newBurnTime);
                        // Также обновляем в unburnedNeighborsMap для следующей итерации
                        unburnedNeighborsMap.set(neighborIndex, {
                            burnTime: newBurnTime,
                            sourceIndex: data.sourceIndex
                        });
                    }
                }
                
                // Выводим список соседей после вычета времени (для логирования)
                this.log(`Время соседей после вычета (${timeToSubtract.toFixed(3)} минут):`);
                const updatedNeighborsList = [];
                for (let [neighborIndex, data] of unburnedNeighborsMap) {
                    if (neighborIndex === bestNeighborIndex) {
                        continue;
                    }
                    const neighborKey = this.indexToKeyMap.get(neighborIndex);
                    if (neighborKey) {
                        const newBurnTime = this.burnTimeMap.get(neighborKey);
                        if (newBurnTime !== undefined) {
                            updatedNeighborsList.push({
                                index: neighborIndex,
                                burnTime: newBurnTime
                            });
                        }
                    }
                }
                for (let neighbor of updatedNeighborsList) {
                    const cell = this.gridData[neighbor.index];
                    const bounds = L.latLngBounds(cell.bounds);
                    const center = bounds.getCenter();
                    this.log(`  ID ${neighbor.index}, координаты (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}): ${neighbor.burnTime.toFixed(3)} минут`);
                }
                
                // Шаг 3: Вычитаем время из общего оставшегося времени
                // timeToSubtract уже определен в шаге 2
                remainingTime -= timeToSubtract;
                
                // Если сосед не успел полностью сгореть, обновляем его время горения
                if (bestNeighborTime > timeToSubtract) {
                    const bestNeighborKey = this.indexToKeyMap.get(bestNeighborIndex);
                    if (bestNeighborKey) {
                        const remainingBurnTime = bestNeighborTime - timeToSubtract;
                        this.burnTimeMap.set(bestNeighborKey, remainingBurnTime);
                        // Обновляем в unburnedNeighborsMap
                        unburnedNeighborsMap.set(bestNeighborIndex, {
                            burnTime: remainingBurnTime,
                            sourceIndex: bestNeighborSourceIndex
                        });
                    }
                }
            } else {
                // Этот блок не должен выполняться, так как мы всегда выбираем соседа из несгоревших
                // Но на всякий случай оставляем обработку
                this.log(`Ошибка: bestNeighborIndex === null, но bestNeighborSourceIndex !== null`);
                remainingTime -= bestNeighborTime;
            }
            
            // НЕ проверяем и не помечаем сгоревшие ячейки - это будет сделано позже
            
            // Итоговые значения в конце итерации
            const burningCountEnd = burningCells.size;
            const burnedCountEnd = burnedCells.size;
            const remainingTimeEnd = remainingTime;
            
            this.log(`Горящих точек в начале: ${burningCountStart}`);
            this.log(`Горящих точек в конце: ${burningCountEnd}`);
            this.log(`Сгоревших точек: ${burnedCountEnd}`);
            this.log(`Осталось времени: ${remainingTimeEnd.toFixed(3)} минут`);
            
            // Сохраняем значения для следующей итерации
            prevBestNeighborIndex = bestNeighborIndex;
            prevBestNeighborTime = bestNeighborTime;
            prevNewBurningCellIndex = bestNeighborIndex; // Ячейка, которая была подожжена на этой итерации
            
            // Вызываем callback для обновления визуализации после каждой итерации
            if (onIterationComplete) {
                onIterationComplete({
                    burnedCells: new Set(burnedCells),
                    burningCells: new Set(burningCells),
                    remainingBurnTimes: new Map(remainingBurnTimes),
                    remainingTime: remainingTime,
                    iteration: iteration
                });
            }
            
            // Минимальная задержка для визуализации постепенного закрашивания области
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Помечаем все горящие ячейки, которые еще не сгорели
        // (те, у которых remainingTime > 0, но они уже начали гореть)
        
        // Возвращаем результат: область под пожаром
        return {
            burnedCells: burnedCells,
            burningCells: burningCells,
            remainingBurnTimes: remainingBurnTimes,
            remainingTime: remainingTime
        };
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

