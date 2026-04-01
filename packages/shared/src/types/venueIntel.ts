
export interface Stadium {
    id: string;
    slug: string;
    espn_id?: number;
    name: string;
    city: string;
    state: string;
    latitude?: number;
    longitude?: number;
    altitude_ft?: number;
    roof_type: 'outdoor' | 'indoor' | 'retractable';
    surface_type: 'grass' | 'turf_field' | 'turf_astro';
    surface_brand?: string;
    azimuth_degrees?: number;
    image_url?: string;
}

export interface GameEnvironment {
    stadium: Stadium | null;
    venue: {
        name: string;
        city: string;
        state: string;
        capacity?: number;
        indoor: boolean;
    };
    weather: {
        temp: number;
        condition: string;
        wind: string;
        humidity: number;
        pressure_in?: number;
        wind_direction_deg?: number;
    } | null;
    broadcast?: string;
}
