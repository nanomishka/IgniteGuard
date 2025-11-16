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
let squareFireState = new Map(); // Состояние каждого квадрата: null - не затронут, number - время начала горения
let squareCurrentColor = new Map(); // Текущий цвет каждого квадрата для кэширования
let currentTime = 0; // Текущее время в минутах
let fireSimulator = null; // Симулятор распространения огня
let gridDataWithBurnTime = null; // Данные с временем горения
const CELL_SIZE_M = 10; // Размер ячейки в метрах (10x10 метров)
const CELL_AREA_M2 = CELL_SIZE_M * CELL_SIZE_M; // Площадь одной ячейки в квадратных метрах (100 м²)

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

// Function to load grid with burn time from file
function loadGridWithBurnTime() {
    return fetch('grid_data_with_burn_time.json')
        .then(response => {
            if (!response.ok) {
                console.warn('grid_data_with_burn_time.json not found, using grid_data.json');
                return null;
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
        const fireRate = item.fire_rate !== undefined ? item.fire_rate : 0;
        
        let r, g, b, opacity;
        if (fireRate === 0) {
            r = 255;
            g = 192;
            b = 203;
            opacity = 0;
        } else {
            const normalizedRate = fireRate / 30;
            r = Math.round(255 - normalizedRate * 117);
            g = Math.round(192 - normalizedRate * 149);
            b = Math.round(203 + normalizedRate * 23);
            opacity = normalizedRate * 0.5;
        }
        
        const square = L.rectangle(item.bounds, {
            color: 'transparent',
            fillColor: `rgb(${r}, ${g}, ${b})`,
            fillOpacity: opacity,
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
        
        if (opacity === 0 || (Math.abs(opacity) < 0.0001)) {
            transparentCount++;
        }
        
        originalSquareColors.set(square, {
            fillColor: `rgb(${r}, ${g}, ${b})`,
            fillOpacity: opacity
        });
    }
    
}

// Function to create grid squares for entire Limassol region (one time)
function createGridSquares() {
    if (!cyprusBorder || gridLayer) return;
    
    Promise.all([loadGridFromFile(), loadGridWithBurnTime()])
        .then(([gridData, burnTimeData]) => {
            createGridSquaresFromData(gridData);
            if (burnTimeData) {
                gridDataWithBurnTime = burnTimeData;
            }
        })
        .catch(error => {
            console.warn('Could not load grid data files. Please generate them using generate_grid.html', error);
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
    
    // Сохраняем линию огня
    fireLinePoints = linePoints;
    squareFireState.clear();
    squareCurrentColor.clear();
    currentTime = 0;
    
    // Инициализируем симулятор распространения огня
    if (gridDataWithBurnTime) {
        fireSimulator = new FireSpreadSimulator(gridDataWithBurnTime, linePoints);
    }
    
    // Показываем timeline
    if (timelineContainer && timelineSlider) {
        timelineContainer.style.display = 'block';
        timelineSlider.disabled = false;
        timelineContainer.classList.remove('disabled');
    }
    
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
            initialFireArea += CELL_AREA_M2;
        }
    }
    
    if (fireAreaDisplay) {
        fireAreaDisplay.textContent = formatFireArea(initialFireArea);
    }
    
    if (fireSimulator && gridDataWithBurnTime) {
        setTimeout(() => {
            updateFireVisualization(0);
        }, 200);
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
const fireAreaDisplay = document.getElementById('fireAreaDisplay');

// Инициализация timeline - скрываем до рисования области
if (timelineContainer) {
    timelineContainer.style.display = 'none';
}

if (timelineSlider && timeDisplay) {
    timelineSlider.addEventListener('input', function(e) {
        const time = parseInt(e.target.value);
        const minutes = time * 10;
        timeDisplay.textContent = minutes;
        currentTime = minutes;
        
        if (fireSimulator && fireLinePoints) {
            updateFireVisualization(minutes);
        }
    });
}

function updateFireVisualization(timeMinutes) {
    if (!fireSimulator || !fireLinePoints) return;
    
    const state = fireSimulator.getStateAt(timeMinutes);
    const closedPolygon = [...fireLinePoints];
    if (closedPolygon.length > 0 && 
        (closedPolygon[0].lat !== closedPolygon[closedPolygon.length - 1].lat || 
         closedPolygon[0].lng !== closedPolygon[closedPolygon.length - 1].lng)) {
        closedPolygon.push(closedPolygon[0]);
    }
    
    const squaresToUpdate = new Set();
    let currentFireArea = 0;
    
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
        
        const center = bounds.getCenter();
        const isInside = isPointInPolygon(center, closedPolygon);
        const isBurning = state.burningMask.get(i) || false;
        const isBurned = state.burnedMask.get(i) || false;
        
        if (isInside || isBurning || isBurned) {
            squaresToUpdate.add(i);
            currentFireArea += CELL_AREA_M2;
        }
    }
    
    if (fireAreaDisplay) {
        fireAreaDisplay.textContent = formatFireArea(currentFireArea);
    }
    
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
        const isInside = isPointInPolygon(center, closedPolygon);
        const isBurning = state.burningMask.get(i) || false;
        const isBurned = state.burnedMask.get(i) || false;
        const original = originalSquareColors.get(gridSquares[i]);
        
        let fillColor, fillOpacity;
        
        if (isInside) {
            fillColor = '#1a1a1a';
            fillOpacity = 0.6;
        } else if (isBurning) {
            fillColor = '#cc0000';
            fillOpacity = 0.8;
        } else if (isBurned) {
            fillColor = '#1a1a1a';
            fillOpacity = 0.6;
        } else {
            if (original) {
                try {
                    if (map.hasLayer(gridSquares[i])) {
                        gridLayer.removeLayer(gridSquares[i]);
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
            }
            continue;
        }
        
        const currentColorKey = `${fillColor}_${fillOpacity}`;
        const cachedColor = squareCurrentColor.get(i);
        
        if (cachedColor !== currentColorKey || isInside || isBurning || isBurned) {
            try {
                if (map.hasLayer(gridSquares[i])) {
                    gridLayer.removeLayer(gridSquares[i]);
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
    
    if (drawPolyline) {
        const closedPoints = [...fireLinePoints, fireLinePoints[0]];
        drawPolyline.setLatLngs(closedPoints);
        drawPolyline.bringToFront();
    }
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
