// Initialize map centered on Limassol
const map = L.map('map').setView([34.75, 32.95], 15);

// Create satellite and standard map layers
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© <a href="https://www.esri.com/">Esri</a>',
    maxZoom: 19
});

const standardLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
});

// Add satellite layer by default
satelliteLayer.addTo(map);
let currentLayer = satelliteLayer;

// Map type toggle switch
const mapTypeToggle = document.getElementById('mapTypeToggle');
if (mapTypeToggle) {
    mapTypeToggle.addEventListener('change', function() {
        map.removeLayer(currentLayer);
        
        if (mapTypeToggle.checked) {
            currentLayer = satelliteLayer;
        } else {
            currentLayer = standardLayer;
        }
        
        currentLayer.addTo(map);
    });
}


// Grid layer for fire risk visualization
let gridLayer = null;
let gridSquares = [];
let originalSquareColors = new Map();
let squareBounds = new Map();
let fireLinePoints = null; // Линия огня (нарисованная пользователем)
let squareFireState = new Map(); // Состояние каждого квадрата: null - не затронут, number - время начала горения
let squareCurrentColor = new Map(); // Текущий цвет каждого квадрата для кэширования
let currentTime = 0; // Текущее время в минутах
let fireSimulator = null; // Симулятор распространения огня
let gridDataWithBurnTime = null; // Данные с временем горения
const CELL_SIZE_M = 100; // Размер ячейки в метрах (100x100 метров)
const CELL_AREA_M2 = CELL_SIZE_M * CELL_SIZE_M; // Площадь одной ячейки в квадратных метрах (10000 м²)

function formatFireArea(areaM2) {
    if (areaM2 < 1000) {
        return areaM2.toLocaleString('ru-RU') + ' м²';
    } else {
        const areaKm2 = areaM2 / 1000000;
        return areaKm2.toFixed(2).replace('.', ',') + ' км²';
    }
}

// Function to check if a point is inside a polygon using ray casting algorithm
function isPointInPolygon(point, latlngs) {
    if (!latlngs || latlngs.length < 3) return false;
    
    let ring = latlngs;
    if (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
        ring = latlngs[0];
    }
    
    let inside = false;
    const x = point.lng;
    const y = point.lat;
    
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

function lineIntersectsRectangle(linePoints, bounds) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const nw = L.latLng(ne.lat, sw.lng);
    const se = L.latLng(sw.lat, ne.lng);
    
    const rectEdges = [
        [sw, nw],
        [nw, ne],
        [ne, se],
        [se, sw]
    ];
    
    for (let i = 0; i < linePoints.length; i++) {
        const p1 = linePoints[i];
        const p2 = linePoints[(i + 1) % linePoints.length];
        
        if (bounds.contains(p1) || bounds.contains(p2)) {
            return true;
        }
        
        for (let edge of rectEdges) {
            if (segmentsIntersect(p1, p2, edge[0], edge[1])) {
                return true;
            }
        }
    }
    
    return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);
    
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    
    return false;
}

function direction(pi, pj, pk) {
    return ((pk.lat - pi.lat) * (pj.lng - pi.lng)) - ((pj.lat - pi.lat) * (pk.lng - pi.lng));
}


// Deterministic random function for consistent results
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// Get cell value (0-1) for a given coordinate
// Uses fixed base size (100m) for consistent positioning regardless of zoom
// Returns 0 for 20% of cells (transparent), value 0-1 for 80% (pink to purple gradient)
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

// Function to load grid from file
function loadGridFromFile() {
    return fetch('grid_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Grid file not found');
            }
            return response.json();
        });
}

// Function to load grid with burn time from file (now same as grid_data.json)
function loadGridWithBurnTime() {
    return fetch('grid_data.json')
        .then(response => {
            if (!response.ok) {
                console.warn('grid_data.json not found');
                return null;
            }
            return response.json();
        });
}

// Function to create grid squares from loaded data
function createGridSquaresFromData(gridData) {
    // Удаляем старый слой, если он существует
    if (gridLayer) {
        map.removeLayer(gridLayer);
        gridSquares = [];
        originalSquareColors.clear();
        squareBounds.clear();
    }
    
    gridLayer = L.layerGroup().addTo(map);
    
    // Находим минимальное и максимальное значения burn_time_minutes
    let minBurnTime = Infinity;
    let maxBurnTime = -Infinity;
    
    for (let item of gridData) {
        const burnTimeMinutes = item.burn_time_minutes;
        if (burnTimeMinutes !== null && burnTimeMinutes !== undefined) {
            if (burnTimeMinutes < minBurnTime) {
                minBurnTime = burnTimeMinutes;
            }
            if (burnTimeMinutes > maxBurnTime) {
                maxBurnTime = burnTimeMinutes;
            }
        }
    }
    
    // Если все значения одинаковые или нет данных, используем дефолтные значения
    if (minBurnTime === Infinity || maxBurnTime === -Infinity || minBurnTime === maxBurnTime) {
        minBurnTime = 10.0;
        maxBurnTime = 20.0;
    }
    
    minBurnTime = 10.0;
    maxBurnTime = 30.0;
    const burnTimeRange = maxBurnTime - minBurnTime;
    
    let transparentCount = 0;
    
    for (let item of gridData) {
        const burnTimeMinutes = item.burn_time_minutes !== undefined ? item.burn_time_minutes : null;
        
        let r, g, b, opacity;
        if (burnTimeMinutes === null || burnTimeMinutes === undefined) {
            r = 255;
            g = 192;
            b = 203;
            opacity = 0;
        } else {
            // Нормализуем значение от минимального до максимального для плавного перехода
            // Минимальное burn_time → normalized = 0 (фиолетовый, 50% прозрачности)
            // Максимальное burn_time → normalized = 1 (розовый, 100% прозрачности)
            const normalized = (maxBurnTime - burnTimeMinutes) / burnTimeRange;
            
            // Фиолетовый (RGB: 148, 0, 211) для минимального burn_time
            // Розовый (RGB: 255, 192, 203) для максимального burn_time
            const purpleR = 0;
            const purpleG = 0;
            const purpleB = 255;
            const pinkR = 100;
            const pinkG = 0;
            const pinkB = 0;

            // Плавная интерполяция цвета от фиолетового к розовому
            r = Math.round(purpleR + (pinkR - purpleR) * normalized);
            g = Math.round(purpleG + (pinkG - purpleG) * normalized);
            b = Math.round(purpleB + (pinkB - purpleB) * normalized);
            
            // Плавная интерполяция прозрачности: 50% (0.5) для минимального, 100% (1.0) для максимального
            // Для burn_time_minutes > 50 прозрачность должна быть 100%
            // if (burnTimeMinutes > 30) {
            //     opacity = 0; // 100% прозрачности
            // } else {
            //     opacity = normalized * 0.8;
            // }
            opacity = normalized * 0.8;
        }
        
        const square = L.rectangle(item.bounds, {
            color: 'transparent',
            fillColor: `rgb(${r}, ${g}, ${b})`,
            fillOpacity: opacity,
            weight: 0,
            interactive: true
        });
        
        // Добавляем popup с информацией о burn_time_minutes
        const burnTime = item.burn_time_minutes !== undefined ? item.burn_time_minutes : null;
        if (burnTime !== null) {
            square.bindPopup(`burn_time_minutes: ${burnTime.toFixed(2)}`);
        }
        
        square.addTo(gridLayer);
        gridSquares.push(square);
        
        let bounds;
        try {
            bounds = square.getBounds();
            if (!bounds || !bounds.isValid()) {
                bounds = L.latLngBounds(item.bounds);
            }
        } catch (e) {
            bounds = L.latLngBounds(item.bounds);
        }
        
        squareBounds.set(square, bounds);
        
        if (opacity === 0 || (Math.abs(opacity) < 0.0001)) {
            transparentCount++;
        }
        
        originalSquareColors.set(square, {
            fillColor: `rgb(${r}, ${g}, ${b})`,
            fillOpacity: opacity
        });
    }
    
}

// Function to create grid squares from grid_data.json
function createGridSquares() {
    Promise.all([loadGridFromFile(), loadGridWithBurnTime()])
        .then(([gridData, burnTimeData]) => {
            createGridSquaresFromData(gridData);
            if (burnTimeData) {
                gridDataWithBurnTime = burnTimeData;
            } else {
                gridDataWithBurnTime = gridData;
            }
        })
        .catch(error => {
            console.warn('Could not load grid data files. Please generate them using generate_grid.html', error);
        });
}


// Drawing functionality
let isDrawingMode = false;
let isMouseDown = false;
let drawPoints = [];
let drawPolyline = null;
let drawnArea = null;

function startDrawing() {
    restoreSquareColors();
    
    if (drawnArea) {
        map.removeLayer(drawnArea);
        drawnArea = null;
    }
    
    if (drawPolyline) {
        map.removeLayer(drawPolyline);
        drawPolyline = null;
    }
    
    isDrawingMode = true;
    drawPoints = [];
    isMouseDown = false;
    
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    
    document.getElementById('drawAreaBtn').style.display = 'none';
    document.getElementById('clearAreaBtn').style.display = 'inline-block';
    
    map.getContainer().style.cursor = 'crosshair';
}

function finishDrawing() {
    isDrawingMode = false;
    isMouseDown = false;
    
    // НЕ удаляем линию огня - она должна оставаться видимой
    // if (drawPolyline) {
    //     map.removeLayer(drawPolyline);
    //     drawPolyline = null;
    // }
    
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    
    map.getContainer().style.cursor = '';
    
    document.getElementById('drawAreaBtn').style.display = 'inline-block';
    document.getElementById('clearAreaBtn').style.display = 'none';
}


// Функция для закраски квадратов под линией огня
// linePoints - линия огня (нарисованная пользователем)
// Серые квадраты (#1a1a1a) - выгоревший участок (внутри замкнутой области)
// Красные квадраты (#cc0000) - огонь в текущий момент (пересекаются с линией огня)
function highlightSquaresInArea(linePoints) {
    if (linePoints.length < 3) {
        return;
    }
    
    // Сохраняем линию огня
    fireLinePoints = linePoints;
    squareFireState.clear();
    squareCurrentColor.clear();
    currentTime = 0;
    fireSimulator = null;
    
    const closedPolygon = [...linePoints];
    if (closedPolygon.length > 0 && 
        (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
         closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
        closedPolygon.push(closedPolygon[0]);
    }
    
    const lineBounds = L.latLngBounds(linePoints);
    const padding = 0.001;
    const expandedBounds = L.latLngBounds(
        [lineBounds.getSouth() - padding, lineBounds.getWest() - padding],
        [lineBounds.getNorth() + padding, lineBounds.getEast() + padding]
    );
    
    let highlightedCount = 0;
    let initialFireArea = 0;
    let burningCount = 0; // Горящие области (красные)
    let burnedCount = 0; // Сгоревшие области (серые)
    
    for (let i = 0; i < gridSquares.length; i++) {
        let square = gridSquares[i];
        let bounds = squareBounds.get(square);
        
        if (!bounds) {
            try {
                bounds = square.getBounds();
                if (bounds && bounds.isValid()) {
                    squareBounds.set(square, bounds);
                } else {
                    continue;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!bounds || !bounds.isValid()) {
            continue;
        }
        
        if (!expandedBounds.intersects(bounds)) {
            continue;
        }
        
        const center = bounds.getCenter();
        const intersectsLine = lineIntersectsRectangle(linePoints, bounds);
        
        // Проверяем, находится ли центр квадрата внутри области
        // Используем ту же логику, что и в updateFireSpread для согласованности
        const isInside = isPointInPolygon(center, closedPolygon);
        
        if (intersectsLine || isInside) {
            // Сохраняем состояние квадрата: время начала горения (0 для начальных красных квадратов)
            if (intersectsLine) {
                squareFireState.set(i, 0); // Красные квадраты - огонь с самого начала
                burningCount++;
            } else {
                burnedCount++;
            }
            
            const original = originalSquareColors.get(square);
            
            try {
                if (map.hasLayer(square)) {
                    gridLayer.removeLayer(square);
                }
            } catch (e) {
            }
            
            // Красные квадраты (#cc0000) - огонь в текущий момент (пересекаются с линией огня)
            // Серые квадраты (#1a1a1a) - выгоревший участок (внутри замкнутой области, но не пересекаются с линией)
            const fillColor = intersectsLine ? '#cc0000' : '#1a1a1a';
            const fillOpacity = intersectsLine ? 0.8 : 0.6;
            
            const newSquare = L.rectangle(bounds, {
                color: 'transparent',
                fillColor: fillColor,
                fillOpacity: fillOpacity,
                weight: 0,
                interactive: false
            });
            newSquare.addTo(gridLayer);
            squareBounds.set(newSquare, bounds);
            
            if (original) {
                originalSquareColors.set(newSquare, original);
            }
            gridSquares[i] = newSquare;
            newSquare.bringToFront();
            highlightedCount++;
            initialFireArea += CELL_AREA_M2;
        }
    }
    
    // Подсчет на основе gridData для сравнения с симулятором
    let gridDataBurningCount = 0;
    let gridDataBurnedCount = 0;
    let gridDataTotalCount = 0;
    
    if (gridDataWithBurnTime && gridDataWithBurnTime.length > 0) {
        for (let item of gridDataWithBurnTime) {
            const bounds = L.latLngBounds(item.bounds);
            const center = bounds.getCenter();
            const intersectsLine = lineIntersectsRectangle(linePoints, bounds);
            const isInside = isPointInPolygon(center, closedPolygon);
            
            if (intersectsLine || isInside) {
                gridDataTotalCount++;
                if (intersectsLine) {
                    gridDataBurningCount++;
                } else {
                    gridDataBurnedCount++;
                }
            }
        }
    }
    
    // Логирование информации о нарисованной области
    console.log(`=== Область пожара нарисована ===`);
    console.log(`Визуализация (gridSquares):`);
    console.log(`  Горящих областей: ${burningCount}`);
    console.log(`  Сгоревших областей: ${burnedCount}`);
    console.log(`  Всего областей: ${highlightedCount}`);
    console.log(`Данные для симулятора (gridData):`);
    console.log(`  Горящих ячеек: ${gridDataBurningCount}`);
    console.log(`  Сгоревших ячеек: ${gridDataBurnedCount}`);
    console.log(`  Всего ячеек: ${gridDataTotalCount}`);
    console.log(`Площадь пожара: ${formatFireArea(initialFireArea)}`);
    console.log(`================================`);
    
    if (fireAreaDisplay) {
        fireAreaDisplay.textContent = formatFireArea(initialFireArea);
    }
    
        // Симулятор распространения огня включен для первых 10 минут
        if (gridDataWithBurnTime && gridDataWithBurnTime.length > 0) {
            if (timelineContainer && timelineSlider) {
                timelineContainer.style.display = 'block';
                timelineSlider.disabled = true;
                timelineContainer.classList.add('disabled');
            }
            
            // Создаем симулятор асинхронно в фоне, чтобы не блокировать UI
            const createSimulator = () => {
                try {
                    fireSimulator = new FireSpreadSimulator(gridDataWithBurnTime, linePoints);
                    
                    // Для включения логирования раскомментируйте следующую строку:
                    // fireSimulator.enableLogging = true;
                    
                    // После создания симулятора активируем timeline и показываем кнопку расчета
                    if (timelineContainer && timelineSlider) {
                        timelineSlider.disabled = false;
                        timelineContainer.classList.remove('disabled');
                    }
                    
                } catch (e) {
                    console.error('Error creating fire simulator:', e);
                    fireSimulator = null;
                    if (timelineContainer && timelineSlider) {
                        timelineSlider.disabled = true;
                        timelineContainer.classList.add('disabled');
                    }
                }
            };
            
            // Используем requestIdleCallback для фоновых вычислений, если доступен
            if (window.requestIdleCallback) {
                requestIdleCallback(createSimulator, { timeout: 1000 });
            } else {
                // Fallback для браузеров без requestIdleCallback
                setTimeout(createSimulator, 100);
            }
        } else {
            // Если данных нет, просто показываем timeline (но он не будет работать)
            if (timelineContainer && timelineSlider) {
                timelineContainer.style.display = 'block';
                timelineSlider.disabled = true;
                timelineContainer.classList.add('disabled');
            }
        }
}

function restoreSquareColors() {
    for (let i = 0; i < gridSquares.length; i++) {
        let square = gridSquares[i];
        const original = originalSquareColors.get(square);
        if (original) {
            let bounds = squareBounds.get(square);
            if (!bounds) {
                try {
                    bounds = square.getBounds();
                    squareBounds.set(square, bounds);
                } catch (e) {
                    continue;
                }
            }
            
            const wasTransparent = original.fillOpacity === 0;
            
            if (wasTransparent) {
                if (map.hasLayer(square)) {
                    gridLayer.removeLayer(square);
                }
                const newSquare = L.rectangle(bounds, {
                    color: 'transparent',
                    fillColor: original.fillColor,
                    fillOpacity: original.fillOpacity,
                    weight: 0,
                    interactive: false
                });
                newSquare.addTo(gridLayer);
                squareBounds.set(newSquare, bounds);
                originalSquareColors.set(newSquare, original);
                gridSquares[i] = newSquare;
            } else {
                square.setStyle({
                    color: 'transparent',
                    fillColor: original.fillColor,
                    fillOpacity: original.fillOpacity,
                    weight: 0
                });
            }
        }
    }
}

function clearDrawing() {
    if (drawPolyline) {
        map.removeLayer(drawPolyline);
        drawPolyline = null;
    }
    
    if (drawnArea) {
        map.removeLayer(drawnArea);
        drawnArea = null;
    }
    
    restoreSquareColors();
    
    drawPoints = [];
    isDrawingMode = false;
    isMouseDown = false;
    
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    
    map.getContainer().style.cursor = '';
    
    // Скрываем timeline после очистки
    if (timelineContainer) {
        timelineContainer.style.display = 'none';
        timelineContainer.classList.remove('disabled');
        if (timelineSlider) {
            timelineSlider.value = 0;
            timelineSlider.disabled = false;
        }
        if (timeDisplay) {
            timeDisplay.textContent = 0;
        }
    }
    
    fireLinePoints = null;
    squareFireState.clear();
    squareCurrentColor.clear();
    currentTime = 0;
    fireSimulator = null;
    
    if (fireAreaDisplay) {
        fireAreaDisplay.textContent = '0';
    }
    
    document.getElementById('drawAreaBtn').style.display = 'inline-block';
    document.getElementById('clearAreaBtn').style.display = 'none';
}

map.on('mousedown', function(e) {
    if (isDrawingMode) {
        isMouseDown = true;
        lastMoveTime = Date.now();
        drawPoints = [e.latlng];
        
        if (drawPolyline) {
            map.removeLayer(drawPolyline);
            drawPolyline = null;
        }
        
        drawPolyline = L.polyline(drawPoints, {
            color: '#ff0000',
            weight: 3,
            opacity: 1,
            renderer: L.canvas({ padding: 0.5 })
        }).addTo(map);
        drawPolyline.bringToFront();
        
        L.DomEvent.stop(e);
    }
});

map.on('mousemove', function(e) {
    if (isDrawingMode && isMouseDown && drawPolyline) {
        const currentPoint = e.latlng;
        
        if (drawPoints.length === 0) {
            drawPoints.push(currentPoint);
            drawPolyline.setLatLngs(drawPoints);
        } else {
            const lastPoint = drawPoints[drawPoints.length - 1];
            if (lastPoint.lat !== currentPoint.lat || lastPoint.lng !== currentPoint.lng) {
                drawPoints.push(currentPoint);
                drawPolyline.setLatLngs(drawPoints);
            }
        }
        
        drawPolyline.bringToFront();
        
        L.DomEvent.stop(e);
    }
});

map.on('mouseup', function(e) {
    if (isDrawingMode && isMouseDown) {
        isMouseDown = false;
        if (drawPoints.length > 0) {
            const lastPoint = drawPoints[drawPoints.length - 1];
            if (lastPoint.lat !== e.latlng.lat || lastPoint.lng !== e.latlng.lng) {
                drawPoints.push(e.latlng);
            }
            
            if (drawPoints.length >= 3) {
                const closedPoints = [...drawPoints, drawPoints[0]];
                drawPolyline.setLatLngs(closedPoints);
                drawPolyline.bringToFront();
                
                if (drawnArea) {
                    map.removeLayer(drawnArea);
                    drawnArea = null;
                }
                
                highlightSquaresInArea(drawPoints);
            } else {
                const closedPoints = [...drawPoints, drawPoints[0]];
                drawPolyline.setLatLngs(closedPoints);
                drawPolyline.bringToFront();
            }
            
            finishDrawing();
        }
        L.DomEvent.stop(e);
    }
});

map.getContainer().addEventListener('mouseleave', function(e) {
    if (isDrawingMode && isMouseDown) {
        isMouseDown = false;
        if (drawPoints.length >= 2) {
            const closedPoints = [...drawPoints, drawPoints[0]];
            drawPolyline.setLatLngs(closedPoints);
            drawPolyline.bringToFront();
            
            if (drawnArea) {
                map.removeLayer(drawnArea);
                drawnArea = null;
            }
            
            if (drawPoints.length >= 3) {
                highlightSquaresInArea(drawPoints);
            }
            
            finishDrawing();
        }
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isDrawingMode) {
        finishDrawing();
    }
});

const drawAreaBtn = document.getElementById('drawAreaBtn');
const clearAreaBtn = document.getElementById('clearAreaBtn');
const toggleGridBtn = document.getElementById('toggleGridBtn');

let gridVisible = true;

if (drawAreaBtn) {
    drawAreaBtn.addEventListener('click', startDrawing);
}

if (clearAreaBtn) {
    clearAreaBtn.addEventListener('click', clearDrawing);
}

if (toggleGridBtn) {
    toggleGridBtn.addEventListener('click', function() {
        if (gridLayer) {
            if (gridVisible) {
                map.removeLayer(gridLayer);
                toggleGridBtn.textContent = 'Show Grid';
                gridVisible = false;
            } else {
                gridLayer.addTo(map);
                toggleGridBtn.textContent = 'Hide Grid';
                gridVisible = true;
            }
        }
    });
}

// Обработчик для timeline slider - распространение огня во времени
// При движении слайдера огонь распространяется на соседние квадраты
// Красные квадраты - огонь в текущий момент
// Серые квадраты - выгоревший участок
const timelineContainer = document.querySelector('.timeline-container');
const timelineSlider = document.getElementById('timelineSlider');
const timeDisplay = document.getElementById('timeDisplay');
const fireAreaDisplay = document.getElementById('fireAreaDisplay');
const progressContainer = document.querySelector('.progress-container');
const progressBar = document.getElementById('progressBar');
const progressTime = document.getElementById('progressTime');
const targetTimeDisplay = document.getElementById('targetTime');
const sliderProgress = document.getElementById('sliderProgress');

// Инициализация timeline - скрываем до рисования области
if (timelineContainer) {
    timelineContainer.style.display = 'none';
}

// Маппинг значений слайдера в минуты: 0, 1, 2, 3, 4, 5, 6 -> 0, 30, 60, 90, 120, 180, 300 минут
const sliderToMinutes = [0, 30, 60, 90, 120, 180, 300];

// Функция форматирования времени для прогресса
function formatTimeForProgress(minutes) {
    if (minutes === 0) {
        return '0';
    } else if (minutes < 60) {
        return `${minutes.toFixed(1)}min`;
    } else if (minutes === 60) {
        return '1h';
    } else if (minutes === 90) {
        return '1.5h';
    } else {
        const hours = minutes / 60;
        return `${hours.toFixed(1)}h`;
    }
}

// Timeline включен для 0-5 часов
if (timelineSlider && timeDisplay) {
    timelineSlider.addEventListener('input', function(e) {
        const sliderValue = parseInt(e.target.value); // Значение слайдера (0-6)
        const minutes = sliderToMinutes[sliderValue] || 0;
        
        // Форматируем отображение времени
        let timeText = '';
        if (minutes === 0) {
            timeText = '0';
        } else if (minutes < 60) {
            timeText = `${minutes}min`;
        } else if (minutes === 60) {
            timeText = '1h';
        } else if (minutes === 90) {
            timeText = '1.5h';
        } else {
            const hours = minutes / 60;
            timeText = `${hours}h`;
        }
        
        timeDisplay.textContent = timeText;
        currentTime = minutes;
        
        // Сбрасываем прогресс на слайдере при изменении значения
        if (sliderProgress) {
            sliderProgress.style.width = '0%';
        }
        
        // Запускаем расчет автоматически при движении слайдера
        if (fireSimulator && fireLinePoints && gridDataWithBurnTime) {
            updateFireVisualization(minutes);
        } else {
            console.warn('Cannot update visualization:', {
                hasSimulator: !!fireSimulator,
                hasFireLine: !!fireLinePoints,
                hasBurnTimeData: !!gridDataWithBurnTime
            });
        }
    });
}

async function updateFireVisualization(timeMinutes) {
    // Расчет для 0-300 минут (5 часов)
    if (timeMinutes > 300) {
        return;
    }
    
    if (!fireSimulator || !fireLinePoints || !gridDataWithBurnTime) {
        return;
    }
    
    // Инициализируем прогресс на слайдере
    if (sliderProgress) {
        sliderProgress.style.width = '0%';
    }
    
    // Предвычисление больше не нужно - соседи находятся на лету
    
    // Используем новую функцию прогноза распространения огня
    const currentState = {
        burnedCells: new Set(),
        burningCells: new Set(),
        remainingBurnTimes: new Map()
    };
    
    const startTime = timeMinutes;
    const maxTime = 300; // Максимальное время на слайдере (5 часов)
    
    // Вычисляем максимальную ширину прогресс-бара для выбранного времени
    // Например, если выбрано 90 минут, то максимальная ширина = 90/300 = 30%
    const maxProgressWidth = (startTime / maxTime) * 100;
    
    // Callback для обновления визуализации после каждой итерации
    const onIterationComplete = (iterationState) => {
        updateVisualizationFromState(iterationState);
        
        // Обновляем прогресс на слайдере
        // Прогресс заполняется только до выбранного времени, а не до конца шкалы
        if (sliderProgress && startTime > 0) {
            const processedTime = startTime - iterationState.remainingTime;
            const progressPercent = Math.min(100, (processedTime / startTime) * 100);
            // Применяем прогресс к максимальной ширине для выбранного времени
            const currentWidth = (progressPercent / 100) * maxProgressWidth;
            sliderProgress.style.width = `${currentWidth}%`;
        }
    };
    
    const result = await fireSimulator.predictFireSpread(currentState, fireLinePoints, timeMinutes, onIterationComplete);
    
    // Финальное обновление визуализации после завершения всех итераций
    updateVisualizationFromState(result);
    
    // Обновляем прогресс на слайдере до максимальной ширины для выбранного времени
    if (sliderProgress) {
        sliderProgress.style.width = `${maxProgressWidth}%`;
    }
}

// Функция для обновления визуализации на основе состояния
function updateVisualizationFromState(state) {
    // Преобразуем результат в формат для визуализации
    const visualizationState = {
        burningMask: new Map(),
        burnedMask: new Map(),
        unburnedMask: new Map()
    };
    
    for (let [key, cellIndex] of fireSimulator.cellIndexMap) {
        if (state.burnedCells.has(cellIndex)) {
            visualizationState.burnedMask.set(cellIndex, true);
            visualizationState.burningMask.set(cellIndex, false);
            visualizationState.unburnedMask.set(cellIndex, false);
        } else if (state.burningCells.has(cellIndex)) {
            visualizationState.burningMask.set(cellIndex, true);
            visualizationState.burnedMask.set(cellIndex, false);
            visualizationState.unburnedMask.set(cellIndex, false);
        } else {
            visualizationState.unburnedMask.set(cellIndex, true);
            visualizationState.burningMask.set(cellIndex, false);
            visualizationState.burnedMask.set(cellIndex, false);
        }
    }
    
    const stateToUse = visualizationState;
    
    const closedPolygon = [...fireLinePoints];
    if (closedPolygon.length > 0 && 
        (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
         closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
        closedPolygon.push(closedPolygon[0]);
    }
    
    // Оптимизация: обновляем квадраты за один проход
    let currentFireArea = 0;
    const updatedSquares = new Set(); // Отслеживаем обновленные квадраты для избежания дублирования
    
    // Ограничиваем обработку только квадратами в области огня и близлежащими
    const fireBounds = L.latLngBounds(fireLinePoints);
    const padding = 0.01; // Увеличиваем область поиска
    const expandedBounds = L.latLngBounds(
        [fireBounds.getSouth() - padding, fireBounds.getWest() - padding],
        [fireBounds.getNorth() + padding, fireBounds.getEast() + padding]
    );
    
    for (let i = 0; i < gridSquares.length; i++) {
        let square = gridSquares[i];
        let bounds = squareBounds.get(square);
        
        if (!bounds) {
            try {
                bounds = square.getBounds();
                if (bounds && bounds.isValid()) {
                    squareBounds.set(square, bounds);
                } else {
                    continue;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!bounds || !bounds.isValid()) {
            continue;
        }
        
        // Быстрая проверка: пропускаем квадраты далеко от области огня
        if (!expandedBounds.intersects(bounds)) {
            continue;
        }
        
        const center = bounds.getCenter();
        const isInside = isPointInPolygon(center, closedPolygon);
        
        let isBurning = false;
        let isBurned = false;
        
        // Ищем соответствующую ячейку в симуляторе по координатам центра
        const cellKey = `${center.lat.toFixed(6)}_${center.lng.toFixed(6)}`;
        const cellIndexInSimulator = fireSimulator.cellIndexMap.get(cellKey);
        if (cellIndexInSimulator !== undefined && cellIndexInSimulator !== null) {
            isBurning = stateToUse.burningMask.get(cellIndexInSimulator) === true;
            isBurned = stateToUse.burnedMask.get(cellIndexInSimulator) === true;
        }
        
        if (isInside || isBurning || isBurned) {
            currentFireArea += CELL_AREA_M2;
            
            // Обновляем квадрат сразу, без второго прохода
            if (!updatedSquares.has(i)) {
                updatedSquares.add(i);
                
                const original = originalSquareColors.get(square);
                
                let fillColor, fillOpacity;
                
                // Приоритет: горящие (красные) > сгоревшие (серые) > внутри области (серые)
                if (isBurning) {
                    fillColor = '#cc0000';
                    fillOpacity = 0.8;
                } else if (isBurned) {
                    fillColor = '#1a1a1a';
                    fillOpacity = 0.6;
                } else if (isInside) {
                    fillColor = '#1a1a1a';
                    fillOpacity = 0.6;
                } else {
                    continue;
                }
                
                const currentColorKey = `${fillColor}_${fillOpacity}`;
                const cachedColor = squareCurrentColor.get(i);
                
                if (cachedColor !== currentColorKey) {
                    try {
                        if (map.hasLayer(square)) {
                            gridLayer.removeLayer(square);
                        }
                    } catch (e) {
                    }
                    
                    const newSquare = L.rectangle(bounds, {
                        color: 'transparent',
                        fillColor: fillColor,
                        fillOpacity: fillOpacity,
                        weight: 0,
                        interactive: false
                    });
                    newSquare.addTo(gridLayer);
                    squareBounds.set(newSquare, bounds);
                    
                    if (original) {
                        originalSquareColors.set(newSquare, original);
                    }
                    gridSquares[i] = newSquare;
                    newSquare.bringToFront();
                    
                    squareCurrentColor.set(i, currentColorKey);
                }
            }
        } else {
            // Восстанавливаем оригинальный цвет, если квадрат больше не затронут
            const cachedColor = squareCurrentColor.get(i);
            if (cachedColor) {
                const original = originalSquareColors.get(square);
                if (original) {
                    try {
                        if (map.hasLayer(square)) {
                            gridLayer.removeLayer(square);
                        }
                    } catch (e) {
                    }
                    
                    const restoredSquare = L.rectangle(bounds, {
                        color: 'transparent',
                        fillColor: original.fillColor,
                        fillOpacity: original.fillOpacity,
                        weight: 0,
                        interactive: false
                    });
                    restoredSquare.addTo(gridLayer);
                    squareBounds.set(restoredSquare, bounds);
                    originalSquareColors.set(restoredSquare, original);
                    gridSquares[i] = restoredSquare;
                    
                    squareCurrentColor.delete(i);
                }
            }
        }
    }
    
    if (fireAreaDisplay) {
        fireAreaDisplay.textContent = formatFireArea(currentFireArea);
    }
    
    if (drawPolyline) {
        const closedPoints = [...fireLinePoints, fireLinePoints[0]];
        drawPolyline.setLatLngs(closedPoints);
        drawPolyline.bringToFront();
    }
}

// Load grid when map is ready
map.whenReady(() => {
    createGridSquares();
});
