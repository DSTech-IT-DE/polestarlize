/**
 * Nominal usable battery capacities used as the 100 % reference for the
 * battery health estimate. Values are approximate public figures; users can
 * always enter their own.
 */
export interface VehicleOption {
  id: string;
  name: string;
  usableKwh: number;
}

export const VEHICLES: VehicleOption[] = [
  { id: 'ps2-sr-2021', name: 'Polestar 2 Standard range (2021–2023)', usableKwh: 67 },
  { id: 'ps2-lr-2021', name: 'Polestar 2 Long range (2020–2023)', usableKwh: 75 },
  { id: 'ps2-sr-2024', name: 'Polestar 2 Standard range (2024+)', usableKwh: 66 },
  { id: 'ps2-lr-2024', name: 'Polestar 2 Long range (2024+)', usableKwh: 79 },
  { id: 'ps3-lr', name: 'Polestar 3 Long range', usableKwh: 107 },
  { id: 'ps4-lr', name: 'Polestar 4 Long range', usableKwh: 94 },
  { id: 'ps4-sr', name: 'Polestar 4 Standard range', usableKwh: 70 },
  { id: 'ps5', name: 'Polestar 5', usableKwh: 103 },
];

export const CUSTOM_VEHICLE = 'custom';
