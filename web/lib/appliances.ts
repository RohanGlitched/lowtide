/**
 * Typical shiftable loads. Energy and run time are typical modern figures (EU/UK energy-label eco cycles,
 * a 7.4 kW home EV charger); every one can be overridden per household.
 */
export interface Appliance {
  id: string;
  name: string; // "dishwasher"
  action: string; // "run the dishwasher"
  kwh: number; // energy per run
  minutes: number; // run time
  note: string;
}

export const APPLIANCES: Appliance[] = [
  { id: "dishwasher", name: "dishwasher", action: "run the dishwasher", kwh: 0.9, minutes: 180, note: "eco programme" },
  { id: "washing-machine", name: "washing machine", action: "start the washing machine", kwh: 0.8, minutes: 150, note: "40–60 eco wash" },
  { id: "tumble-dryer", name: "tumble dryer", action: "run the tumble dryer", kwh: 2.5, minutes: 120, note: "full load, condenser dryer" },
  { id: "ev", name: "car", action: "charge the car", kwh: 30, minutes: 245, note: "home charger at 7.4 kW" },
  { id: "hot-water", name: "hot water", action: "heat the hot water", kwh: 6, minutes: 120, note: "3 kW immersion heater" },
  { id: "battery", name: "home battery", action: "charge the home battery", kwh: 5, minutes: 120, note: "5 kWh at 2.5 kW" },
];

// Dryer first: "washer dryer" means the drying run.
const ALIASES: [RegExp, string][] = [
  [/tumble|\bdry(er|ing)?\b|drier/, "tumble-dryer"],
  [/dish/, "dishwasher"],
  [/wash(ing)?( machine)?|laundry|washer/, "washing-machine"],
  [/\bev\b|\bcars?\b|\bvehicle\b|\btesla\b|\bcharg(e|er|ing)\b/, "ev"],
  [/immersion|hot water|water heater|boiler/, "hot-water"],
  [/battery|powerwall/, "battery"],
];

export function findAppliance(name: string): Appliance | null {
  const n = name.trim().toLowerCase();
  const direct = APPLIANCES.find((a) => a.id === n || a.name === n);
  if (direct) return direct;
  for (const [re, id] of ALIASES) {
    if (re.test(n)) return APPLIANCES.find((a) => a.id === id) ?? null;
  }
  return null;
}
