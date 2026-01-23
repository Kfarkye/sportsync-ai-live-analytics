-- ═════════════════════════════════════════════════
-- BOOTSTRAP SEED: MAJOR VENUES (Physics Metadata)
-- ═════════════════════════════════════════════════

-- NBA Venues
INSERT INTO public.canonical_venues (id, display_name, city, state_province, capacity, is_indoor, surface_type, altitude_feet)
VALUES 
    ('crypto_com_arena_la', 'Crypto.com Arena', 'Los Angeles', 'CA', 19067, TRUE, 'hardwood', 267),
    ('madison_square_garden_ny', 'Madison Square Garden', 'New York', 'NY', 19812, TRUE, 'hardwood', 45),
    ('chase_center_sf', 'Chase Center', 'San Francisco', 'CA', 18064, TRUE, 'hardwood', 10),
    ('ball_arena_denver', 'Ball Arena', 'Denver', 'CO', 18000, TRUE, 'hardwood', 5280), -- High Altitude Warning
    ('td_garden_boston', 'TD Garden', 'Boston', 'MA', 19156, TRUE, 'hardwood', 15)
ON CONFLICT (id) DO UPDATE SET 
    altitude_feet = EXCLUDED.altitude_feet,
    surface_type = EXCLUDED.surface_type;

-- NFL Venues
INSERT INTO public.canonical_venues (id, display_name, city, state_province, capacity, is_indoor, surface_type, altitude_feet)
VALUES 
    ('lumen_field_seattle', 'Lumen Field', 'Seattle', 'WA', 68740, FALSE, 'turf', 15),
    ('lambeau_field_gb', 'Lambeau Field', 'Green Bay', 'WI', 81441, FALSE, 'grass', 640),
    ('arrowhead_stadium_kc', 'GEHA Field at Arrowhead Stadium', 'Kansas City', 'MO', 76416, FALSE, 'grass', 900),
    ('sofi_stadium_la', 'SoFi Stadium', 'Inglewood', 'CA', 70000, TRUE, 'turf', 160),
    ('mile_high_denver', 'Empower Field at Mile High', 'Denver', 'CO', 76125, FALSE, 'grass', 5280) -- High Altitude Warning
ON CONFLICT (id) DO UPDATE SET 
    altitude_feet = EXCLUDED.altitude_feet,
    surface_type = EXCLUDED.surface_type;

-- Alias Mapping (Ensuring resolution works for common names)
INSERT INTO public.venue_aliases (canonical_id, alias)
VALUES 
    ('crypto_com_arena_la', 'Staples Center'),
    ('ball_arena_denver', 'Pepsi Center'),
    ('mile_high_denver', 'Mile High Stadium'),
    ('mile_high_denver', 'Empower Field at Mile High')
ON CONFLICT (alias) DO NOTHING;
