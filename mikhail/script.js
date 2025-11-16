// Initialize map centered on Limassol
const map = L.map('map').setView([34.75, 32.95], 12);

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

// Load Limassol region from GeoJSON file
let cyprusBorder = null;

// Function to load and display Limassol region
function loadCyprusBorder() {
    // Use XMLHttpRequest as more reliable alternative to fetch
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'cy_regions.json', true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    
                    // Find Limassol region
                    const limassolFeature = data.features.find(feature => 
                        feature.properties && feature.properties.name === 'Limassol'
                    );
                    
                    if (!limassolFeature) {
                        console.error('Limassol region not found in cy_regions.json');
                        return;
                    }
                    
                    // Create FeatureCollection with only Limassol
                    const limassolData = {
                        type: 'FeatureCollection',
                        features: [limassolFeature]
                    };
                    
                    // Remove existing border if any
                    if (cyprusBorder) {
                        map.removeLayer(cyprusBorder);
                    }
                    
                    // Create GeoJSON layer with dashed gray line, no fill
                    cyprusBorder = L.geoJSON(limassolData, {
                        style: {
                            color: '#888888',       // Gray color
                            weight: 2,              // Thin line
                            opacity: 0.8,
                            fill: false,            // No fill
                            dashArray: '10, 5'      // Dashed line
                        },
                        onEachFeature: function(feature, layer) {
                            layer.bindPopup('<b>Limassol Region</b><br>Boundary from GeoJSON');
                        }
                    });
                    
                    // Add to map
                    cyprusBorder.addTo(map);
                    
                } catch (e) {
                    console.error('Error parsing GeoJSON:', e);
                }
    } else {
                console.error('Failed to load cy_regions.json, status:', xhr.status);
            }
        }
    };
    xhr.send();
}

// Grid layer for fire risk visualization
let gridLayer = null;
let gridSquares = [];
let originalSquareColors = new Map();
let squareBounds = new Map();
let fireLinePoints = null; // Линия огня (нарисованная пользователем)
let squareFireState = new Map(); // Состояние каждого квадрата: null - не затронут, number - время начала горения (часы)
let squareCurrentColor = new Map(); // Текущий цвет каждого квадрата для кэширования
let currentTime = 0; // Текущее время в часах
let precalculatedFireStates = new Map(); // Предрасчитанные состояния огня для каждого часа: Map<time, Map<squareIndex, fireStartTime>>
let isPrecalculating = false; // Флаг предрасчета

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

// Function to check if point is inside Limassol border
function isPointInsideLimassol(lat, lng) {
    if (!cyprusBorder) return false;
    
    const point = L.latLng(lat, lng);
    const layers = cyprusBorder.getLayers();
    
    for (let layer of layers) {
        try {
            if (!layer.getBounds || !layer.getBounds().contains(point)) {
                continue;
            }
            
            const latlngs = layer.getLatLngs();
            if (!latlngs || latlngs.length === 0) continue;
            
            let outerRing = latlngs[0];
            if (Array.isArray(outerRing[0]) && !(outerRing[0] instanceof L.LatLng)) {
                outerRing = outerRing[0];
            }
            
            if (isPointInPolygon(point, outerRing)) {
                return true;
            }
        } catch (e) {
            console.warn('Error checking point in layer:', e);
        }
    }
    return false;
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

// Function to create grid squares from loaded data
function createGridSquaresFromData(gridData) {
    if (!gridLayer) {
        gridLayer = L.layerGroup().addTo(map);
    }
    
    let transparentCount = 0;
    
    for (let item of gridData) {
        const square = L.rectangle(item.bounds, {
            color: 'transparent',
            fillColor: `rgb(${item.color.r}, ${item.color.g}, ${item.color.b})`,
            fillOpacity: item.opacity,
            weight: 0,
            interactive: false
        });
        
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
        
        const opacityValue = typeof item.opacity === 'number' ? item.opacity : parseFloat(item.opacity);
        if (opacityValue === 0 || (Math.abs(opacityValue) < 0.0001)) {
            transparentCount++;
        }
        
        originalSquareColors.set(square, {
            fillColor: `rgb(${item.color.r}, ${item.color.g}, ${item.color.b})`,
            fillOpacity: opacityValue
        });
    }
    
}

// Function to create grid squares for entire Limassol region (one time)
function createGridSquares() {
    if (!cyprusBorder || gridLayer) return;
    
    loadGridFromFile()
        .then(gridData => {
            createGridSquaresFromData(gridData);
        })
        .catch(error => {
            console.warn('Could not load grid_data.json. Please generate it using generate_grid.html', error);
        });
}

// Function to generate and save grid (fallback if file doesn't exist)
function generateAndSaveGrid() {
    if (!cyprusBorder) return;
    
    gridLayer = L.layerGroup().addTo(map);
    
    const cyprusBounds = cyprusBorder.getBounds();
    
    const minLat = cyprusBounds.getSouth();
    const maxLat = cyprusBounds.getNorth();
    const minLng = cyprusBounds.getWest();
    const maxLng = cyprusBounds.getEast();
    
    const fixedGridStepM = 100;
    const avgLat = (minLat + maxLat) / 2;
    const fixedLatStep = fixedGridStepM / 111000;
    const fixedLngStep = fixedGridStepM / (111000 * Math.cos(avgLat * Math.PI / 180));
    
    const displaySizeM = 100;
    const displayLatStep = displaySizeM / 111000;
    const displayLngStep = displaySizeM / (111000 * Math.cos(avgLat * Math.PI / 180));
    
    const gridData = [];
    
    for (let lat = minLat; lat < maxLat; lat += fixedLatStep) {
        for (let lng = minLng; lng < maxLng; lng += fixedLngStep) {
            const latLngPoint = L.latLng(lat, lng);
            
            if (!cyprusBounds.contains(latLngPoint)) continue;
            
            if (!isPointInsideLimassol(lat, lng)) continue;
            
            const value = getCellValue(lat, lng);
            
            const halfDisplayLatStep = displayLatStep / 2;
            const halfDisplayLngStep = displayLngStep / 2;
            
            const squareBounds = [
                [lat - halfDisplayLatStep, lng - halfDisplayLngStep],
                [lat + halfDisplayLatStep, lng + halfDisplayLngStep]
            ];
            
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
            
            const square = L.rectangle(squareBounds, {
                color: 'transparent',
                fillColor: `rgb(${r}, ${g}, ${b})`,
                fillOpacity: opacity,
                weight: 0
            });
            
            square.addTo(gridLayer);
            gridSquares.push(square);
            
            const boundsObj = L.latLngBounds(squareBounds);
            squareBounds.set(square, boundsObj);
            
            originalSquareColors.set(square, {
                fillColor: `rgb(${r}, ${g}, ${b})`,
                fillOpacity: opacity
            });
            
            gridData.push({
                center: [lat, lng],
                bounds: squareBounds,
                color: { r, g, b },
                opacity: opacity
            });
        }
    }
    
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
    
    // Сохраняем линию огня для дальнейшего использования в timeline
    fireLinePoints = linePoints;
    squareFireState.clear();
    squareCurrentColor.clear(); // Очищаем кэш цветов
    precalculatedFireStates.clear(); // Очищаем предрасчет
    currentTime = 0;
    
    // Показываем timeline и делаем его неактивным для предрасчета
    if (timelineContainer && timelineSlider) {
        timelineContainer.style.display = 'block';
        timelineSlider.disabled = true;
        timelineContainer.classList.add('disabled');
    }
    
    // Предрасчет запустится асинхронно после закраски
    
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
        }
    }
    
    // Запускаем предрасчет асинхронно в фоне после закраски
    // Используем requestIdleCallback для выполнения в свободное время браузера
    if (window.requestIdleCallback) {
        requestIdleCallback(() => {
            precalculateFireSpread();
        }, { timeout: 1000 });
    } else {
        setTimeout(() => {
            precalculateFireSpread();
        }, 100);
    }
}

// Функция для проверки, соприкасаются ли два квадрата (стороной или углом)
function squaresTouch(bounds1, bounds2) {
    const sw1 = bounds1.getSouthWest();
    const ne1 = bounds1.getNorthEast();
    const sw2 = bounds2.getSouthWest();
    const ne2 = bounds2.getNorthEast();
    
    const epsilon = 1e-6;
    
    const minLat1 = Math.min(sw1.lat, ne1.lat);
    const maxLat1 = Math.max(sw1.lat, ne1.lat);
    const minLng1 = Math.min(sw1.lng, ne1.lng);
    const maxLng1 = Math.max(sw1.lng, ne1.lng);
    
    const minLat2 = Math.min(sw2.lat, ne2.lat);
    const maxLat2 = Math.max(sw2.lat, ne2.lat);
    const minLng2 = Math.min(sw2.lng, ne2.lng);
    const maxLng2 = Math.max(sw2.lng, ne2.lng);
    
    const latOverlap = !(maxLat1 < minLat2 - epsilon || minLat1 > maxLat2 + epsilon);
    const lngOverlap = !(maxLng1 < minLng2 - epsilon || minLng1 > maxLng2 + epsilon);
    
    if (latOverlap && lngOverlap) {
        return true;
    }
    
    const latAdjacent = (
        (Math.abs(maxLat1 - minLat2) < epsilon || Math.abs(minLat1 - maxLat2) < epsilon)
    ) && lngOverlap;
    
    const lngAdjacent = (
        (Math.abs(maxLng1 - minLng2) < epsilon || Math.abs(minLng1 - maxLng2) < epsilon)
    ) && latOverlap;
    
    const cornerTouch = 
        (Math.abs(maxLat1 - minLat2) < epsilon && Math.abs(maxLng1 - minLng2) < epsilon) ||
        (Math.abs(maxLat1 - minLat2) < epsilon && Math.abs(minLng1 - maxLng2) < epsilon) ||
        (Math.abs(minLat1 - maxLat2) < epsilon && Math.abs(maxLng1 - minLng2) < epsilon) ||
        (Math.abs(minLat1 - maxLat2) < epsilon && Math.abs(minLng1 - maxLng2) < epsilon);
    
    return latAdjacent || lngAdjacent || cornerTouch;
}

// Функция предрасчета распространения огня для всех часов (0-3)
// Вычисляет состояние огня заранее и сохраняет в памяти
function precalculateFireSpread() {
    if (!fireLinePoints || fireLinePoints.length < 3) {
        return;
    }
    
    isPrecalculating = true;
    precalculatedFireStates.clear();
    
    // Делаем timeline неактивным до завершения предрасчета
    const timelineContainer = document.querySelector('.timeline-container');
    const timelineSlider = document.getElementById('timelineSlider');
    if (timelineContainer && timelineSlider) {
        timelineSlider.disabled = true;
        timelineContainer.classList.add('disabled');
    }
    
    const closedPolygon = [...fireLinePoints];
    if (closedPolygon.length > 0 && 
        (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
         closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
        closedPolygon.push(closedPolygon[0]);
    }
    
    // Собираем все квадраты карты
    const allSquares = [];
    for (let i = 0; i < gridSquares.length; i++) {
        let square = gridSquares[i];
        let bounds = squareBounds.get(square);
        
        if (!bounds || !bounds.isValid()) {
            continue;
        }
        
        allSquares.push({ index: i, bounds: bounds });
    }
    
    // Инициализируем состояние для времени 0 (квадраты на линии огня)
    const initialState = new Map();
    for (let squareInfo of allSquares) {
        const i = squareInfo.index;
        const bounds = squareInfo.bounds;
        const intersectsLine = lineIntersectsRectangle(fireLinePoints, bounds);
        if (intersectsLine) {
            initialState.set(i, 0); // Квадраты на линии горят с начала
        }
    }
    precalculatedFireStates.set(0, new Map(initialState));
    
    // Предрасчитываем для каждого часа (1, 2, 3, 4, 5, 6) асинхронно
    // Разбиваем на части, чтобы не блокировать UI
    let currentTime = 1;
    
    function calculateNextHour() {
        if (currentTime > 6) {
            isPrecalculating = false;
            
            // Активируем timeline после завершения предрасчета
            const timelineContainer = document.querySelector('.timeline-container');
            const timelineSlider = document.getElementById('timelineSlider');
            if (timelineContainer && timelineSlider) {
                timelineSlider.disabled = false;
                timelineContainer.classList.remove('disabled');
            }
            return;
        }
        
        const time = currentTime;
        const previousState = precalculatedFireStates.get(time - 1);
        const currentState = new Map(previousState);
        
        // Собираем горящие квадраты из предыдущего состояния
        const burningSquares = [];
        for (let squareInfo of allSquares) {
            const i = squareInfo.index;
            const fireStartTime = previousState.get(i);
            if (fireStartTime !== undefined && fireStartTime < time) {
                burningSquares.push(squareInfo);
            }
        }
        
        // Для каждого горящего квадрата находим соседние и зажигаем их
        for (let burningSquare of burningSquares) {
            const burningIndex = burningSquare.index;
            const burningBounds = burningSquare.bounds;
            const burningFireStartTime = previousState.get(burningIndex);
            const burningCenter = burningBounds.getCenter();
            const burningIsInside = isPointInPolygon(burningCenter, closedPolygon);
            const burningIntersectsLine = lineIntersectsRectangle(fireLinePoints, burningBounds);
            
            if (!burningIntersectsLine && burningIsInside) {
                continue; // Пропускаем квадраты внутри области
            }
            
            const searchRadius = 0.002;
            
            for (let squareInfo of allSquares) {
                const i = squareInfo.index;
                const bounds = squareInfo.bounds;
                const center = bounds.getCenter();
                
                const latDiff = Math.abs(center.lat - burningCenter.lat);
                const lngDiff = Math.abs(center.lng - burningCenter.lng);
                if (latDiff > searchRadius || lngDiff > searchRadius) {
                    continue;
                }
                
                const isInside = isPointInPolygon(center, closedPolygon);
                const fireStartTime = currentState.get(i);
                
                if (fireStartTime === undefined && !isInside) {
                    if (squaresTouch(bounds, burningBounds)) {
                        const newFireStartTime = burningFireStartTime + 1;
                        if (newFireStartTime <= time) {
                            currentState.set(i, newFireStartTime);
                        }
                    }
                }
            }
        }
        
        precalculatedFireStates.set(time, currentState);
        currentTime++;
        
        // Продолжаем расчет следующего часа асинхронно
        if (window.requestIdleCallback) {
            requestIdleCallback(calculateNextHour, { timeout: 100 });
        } else {
            setTimeout(calculateNextHour, 10);
        }
    }
    
    // Начинаем расчет с первого часа
    if (window.requestIdleCallback) {
        requestIdleCallback(calculateNextHour, { timeout: 100 });
    } else {
        setTimeout(calculateNextHour, 10);
    }
}

// Функция для обновления визуализации на основе предрасчитанных данных
// Использует готовые данные из памяти, без вычислений
function updateFireSpread(time) {
    if (!fireLinePoints || fireLinePoints.length < 3) {
        return;
    }
    
    // Если еще идет предрасчет, ждем
    if (isPrecalculating) {
        return;
    }
    
    // Используем предрасчитанные данные
    const fireState = precalculatedFireStates.get(time);
    if (!fireState) {
        return;
    }
    
    currentTime = time;
    
    // Собираем все квадраты, которые когда-либо горели до текущего времени
    // Это нужно, чтобы выгоревшие квадраты оставались серыми во все последующие часы
    squareFireState = new Map();
    for (let t = 0; t <= time; t++) {
        const stateAtTime = precalculatedFireStates.get(t);
        if (stateAtTime) {
            // Добавляем все квадраты, которые горели в момент времени t
            for (let [squareIndex, fireStartTime] of stateAtTime) {
                // Если квадрат еще не добавлен или его время начала горения раньше, обновляем
                if (!squareFireState.has(squareIndex) || squareFireState.get(squareIndex) > fireStartTime) {
                    squareFireState.set(squareIndex, fireStartTime);
                }
            }
        }
    }
    
    // Убеждаемся, что красная линия огня видна и обновлена
    if (drawPolyline) {
        const closedPoints = [...fireLinePoints, fireLinePoints[0]];
        drawPolyline.setLatLngs(closedPoints);
        drawPolyline.bringToFront();
    } else if (fireLinePoints && fireLinePoints.length >= 3) {
        const closedPoints = [...fireLinePoints, fireLinePoints[0]];
        drawPolyline = L.polyline(closedPoints, {
            color: '#ff0000',
            weight: 3,
            opacity: 1,
            renderer: L.canvas({ padding: 0.5 })
        }).addTo(map);
        drawPolyline.bringToFront();
    }
    
    const closedPolygon = [...fireLinePoints];
    if (closedPolygon.length > 0 && 
        (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
         closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
        closedPolygon.push(closedPolygon[0]);
    }
    
    // Собираем все квадраты для обновления визуализации
    const allSquares = [];
    for (let i = 0; i < gridSquares.length; i++) {
        let square = gridSquares[i];
        let bounds = squareBounds.get(square);
        
        if (!bounds || !bounds.isValid()) {
            continue;
        }
        
        allSquares.push({ index: i, bounds: bounds });
    }
    
    // Обновляем визуализацию только тех квадратов, которые изменили состояние
    const squaresToUpdate = new Set();
    
    // Собираем все квадраты, которые нужно обновить
    // ВАЖНО: Включаем ВСЕ квадраты внутри области и все квадраты, которые горели когда-либо
    for (let squareInfo of allSquares) {
        const i = squareInfo.index;
        const bounds = squareInfo.bounds;
        const center = bounds.getCenter();
        
        // Проверяем, находится ли центр квадрата внутри области
        const isInside = isPointInPolygon(center, closedPolygon);
        
        const fireStartTime = squareFireState.get(i);
        
        // ВАЖНО: Включаем ВСЕ квадраты внутри области, независимо от состояния огня
        // Также включаем квадраты, которые горели когда-либо
        if (isInside) {
            // Квадрат внутри области - ВСЕГДА должен быть серым
            squaresToUpdate.add(i);
        }
        if (fireStartTime !== undefined) {
            // Квадрат горел когда-либо - включаем для обновления
            squaresToUpdate.add(i);
        }
    }
    
    // Обновляем только измененные квадраты
    for (let i of squaresToUpdate) {
        let bounds = squareBounds.get(gridSquares[i]);
        if (!bounds) {
            try {
                bounds = gridSquares[i].getBounds();
                if (bounds && bounds.isValid()) {
                    squareBounds.set(gridSquares[i], bounds);
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
        
        const center = bounds.getCenter();
        
        // ВАЖНО: Проверяем, находится ли центр квадрата внутри области
        // Проверяем каждый раз заново для каждого квадрата
        const isInside = isPointInPolygon(center, closedPolygon);
        
        const fireStartTime = squareFireState.get(i);
        const original = originalSquareColors.get(gridSquares[i]);
        
        try {
            if (map.hasLayer(gridSquares[i])) {
                gridLayer.removeLayer(gridSquares[i]);
            }
        } catch (e) {
        }
        
        let fillColor, fillOpacity;
        
        // ВАЖНО: Квадраты внутри области ВСЕГДА остаются серыми (выгоревшими)
        // Это проверяется ПЕРВОЙ, чтобы гарантировать правильный цвет
        if (isInside) {
            fillColor = '#1a1a1a';
            fillOpacity = 0.6;
        } else if (fireStartTime === undefined) {
            // Квадрат снаружи области и никогда не горел - восстанавливаем оригинальный цвет
            if (original) {
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
            }
            continue;
        } else if (fireStartTime !== undefined && fireStartTime <= time) {
            // Квадрат снаружи области горел или горит сейчас
            const burnTime = time - fireStartTime;
            if (fireStartTime < time) {
                // Горел в прошлом - серый цвет (выгоревший)
                // Квадрат остается серым во все последующие часы
                fillColor = '#1a1a1a';
                fillOpacity = 0.6;
            } else if (burnTime >= 1) {
                // Выгорел (горит больше 1 часа) - серый цвет (выгоревший)
                fillColor = '#1a1a1a';
                fillOpacity = 0.6;
            } else {
                // Горит сейчас (fireStartTime === time и burnTime === 0) - красный цвет
                fillColor = '#cc0000';
                fillOpacity = 0.8;
            }
        } else {
            // Еще не горит (fireStartTime > time)
            if (original) {
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
            }
            continue;
        }
        
        // ВАЖНО: Квадраты внутри области ВСЕГДА обновляем, независимо от кэша
        // Это гарантирует, что они всегда остаются серыми при движении timeline
        const currentColorKey = `${fillColor}_${fillOpacity}`;
        const cachedColor = squareCurrentColor.get(i);
        
        // ВАЖНО: Квадраты внутри области ВСЕГДА обновляем, независимо от кэша
        // Это гарантирует, что они всегда остаются серыми при движении timeline
        if (isInside) {
            // Квадрат внутри области - ВСЕГДА обновляем, чтобы гарантировать серый цвет
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
            
            // Сохраняем текущий цвет в кэш
            squareCurrentColor.set(i, currentColorKey);
        } else if (cachedColor !== currentColorKey) {
            // Квадрат снаружи области и цвет изменился - обновляем
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
            
            // Сохраняем текущий цвет в кэш
            squareCurrentColor.set(i, currentColorKey);
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
            drawPoints.push(e.latlng);
            
            if (drawPoints.length >= 3) {
                const closedPoints = [...drawPoints, drawPoints[0]];
                drawPolyline.setLatLngs(closedPoints);
                drawPolyline.bringToFront();
                
                if (drawnArea) {
                    map.removeLayer(drawnArea);
                    drawnArea = null;
                }
                
                highlightSquaresInArea(drawPoints);
            }
            
            finishDrawing();
        }
        L.DomEvent.stop(e);
    }
});

map.getContainer().addEventListener('mouseleave', function(e) {
    if (isDrawingMode && isMouseDown) {
        isMouseDown = false;
        if (drawPoints.length >= 3) {
            const closedPoints = [...drawPoints, drawPoints[0]];
            drawPolyline.setLatLngs(closedPoints);
            drawPolyline.bringToFront();
            
            if (drawnArea) {
                map.removeLayer(drawnArea);
                drawnArea = null;
            }
            
            highlightSquaresInArea(drawPoints);
            
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

// Инициализация timeline - скрываем до рисования области
if (timelineContainer) {
    timelineContainer.style.display = 'none';
}

if (timelineSlider && timeDisplay) {
    timelineSlider.addEventListener('input', function(e) {
        const time = parseInt(e.target.value);
        timeDisplay.textContent = time;
        
        // Используем предрасчитанные данные - вычислений нет, обновление мгновенное
        updateFireSpread(time);
    });
}

// Load border when map is ready
map.whenReady(() => {
    loadCyprusBorder();
    
    setTimeout(() => {
        if (cyprusBorder) {
            createGridSquares();
            
        }
    }, 500);
});
