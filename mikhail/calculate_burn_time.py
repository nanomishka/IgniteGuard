#!/usr/bin/env python3
import json
import os

CELL_SIZE_M = 10

def calculate_burn_time(fire_rate):
    if fire_rate is None or fire_rate == 0:
        return None
    
    if fire_rate <= 0:
        return None
    
    burn_time_minutes = CELL_SIZE_M / fire_rate
    return round(burn_time_minutes, 2)

def process_grid_data():
    print('Loading grid_data.json...')
    with open('mikhail/grid_data.json', 'r', encoding='utf-8') as f:
        grid_data = json.load(f)
    
    print(f'Processing {len(grid_data)} cells...')
    
    processed_data = []
    for index, item in enumerate(grid_data):
        fire_rate = item.get('fire_rate', 0)
        burn_time_minutes = calculate_burn_time(fire_rate)
        
        processed_item = {
            'center': item['center'],
            'bounds': item['bounds'],
            'fire_rate': fire_rate,
            'burn_time_minutes': burn_time_minutes
        }
        
        processed_data.append(processed_item)
        
        if (index + 1) % 10000 == 0:
            print(f'Processed {index + 1} cells...')
    
    print('Saving to grid_data_with_burn_time.json...')
    with open('mikhail/grid_data_with_burn_time.json', 'w', encoding='utf-8') as f:
        json.dump(processed_data, f, indent=2, ensure_ascii=False)
    
    burn_times = [item['burn_time_minutes'] for item in processed_data if item['burn_time_minutes'] is not None]
    
    stats = {
        'total': len(processed_data),
        'with_fire_rate': len([item for item in processed_data if item['fire_rate'] > 0]),
        'without_fire_rate': len([item for item in processed_data if item['fire_rate'] == 0]),
        'min_burn_time': min(burn_times) if burn_times else None,
        'max_burn_time': max(burn_times) if burn_times else None
    }
    
    print('\nStatistics:')
    print(f'Total cells: {stats["total"]}')
    print(f'Cells with fire rate > 0: {stats["with_fire_rate"]}')
    print(f'Cells with fire rate = 0: {stats["without_fire_rate"]}')
    print(f'Min burn time: {stats["min_burn_time"]} minutes')
    print(f'Max burn time: {stats["max_burn_time"]} minutes')
    print('\nFile saved: mikhail/grid_data_with_burn_time.json')

if __name__ == '__main__':
    try:
        process_grid_data()
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()
        exit(1)

