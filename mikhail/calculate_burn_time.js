const fs = require('fs');

const CELL_SIZE_M = 10;

function calculateBurnTime(fireRate) {
    if (fireRate === 0 || fireRate === null || fireRate === undefined) {
        return null;
    }
    
    if (fireRate <= 0) {
        return null;
    }
    
    const burnTimeMinutes = CELL_SIZE_M / fireRate;
    return Math.round(burnTimeMinutes * 100) / 100;
}

async function processGridData() {
    console.log('Loading grid_data.json...');
    const gridData = JSON.parse(fs.readFileSync('mikhail/grid_data.json', 'utf8'));
    
    console.log(`Processing ${gridData.length} cells...`);
    
    const processedData = gridData.map((item, index) => {
        const fireRate = item.fire_rate !== undefined ? item.fire_rate : 0;
        const burnTimeMinutes = calculateBurnTime(fireRate);
        
        const processedItem = {
            center: item.center,
            bounds: item.bounds,
            fire_rate: fireRate,
            burn_time_minutes: burnTimeMinutes
        };
        
        if (index % 10000 === 0) {
            console.log(`Processed ${index} cells...`);
        }
        
        return processedItem;
    });
    
    console.log('Saving to grid_data_with_burn_time.json...');
    fs.writeFileSync(
        'mikhail/grid_data_with_burn_time.json',
        JSON.stringify(processedData, null, 2),
        'utf8'
    );
    
    const stats = {
        total: processedData.length,
        withFireRate: processedData.filter(item => item.fire_rate > 0).length,
        withoutFireRate: processedData.filter(item => item.fire_rate === 0).length,
        minBurnTime: Math.min(...processedData.filter(item => item.burn_time_minutes !== null).map(item => item.burn_time_minutes)),
        maxBurnTime: Math.max(...processedData.filter(item => item.burn_time_minutes !== null).map(item => item.burn_time_minutes))
    };
    
    console.log('\nStatistics:');
    console.log(`Total cells: ${stats.total}`);
    console.log(`Cells with fire rate > 0: ${stats.withFireRate}`);
    console.log(`Cells with fire rate = 0: ${stats.withoutFireRate}`);
    console.log(`Min burn time: ${stats.minBurnTime} minutes`);
    console.log(`Max burn time: ${stats.maxBurnTime} minutes`);
    console.log('\nFile saved: mikhail/grid_data_with_burn_time.json');
}

processGridData().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});

