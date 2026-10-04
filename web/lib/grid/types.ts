export type Country = "GB" | "US" | "DE";

/** One priced stretch of time. `price` is in the region's minor unit per kWh (p, ¢ or ct). */
export interface Slot {
  start: number; // unix ms
  end: number; // unix ms
  price: number;
  carbon: number | null; // gCO2/kWh forecast, when the region publishes one
}

export interface Region {
  country: Country;
  id: string; // "GB-C", "US-COMED", "DE"
  name: string; // "London"
  place: string; // what the household told us: "SW1A", "Chicago", "Berlin"
  timeZone: string;
  currency: "GBP" | "USD" | "EUR";
  unit: "p" | "¢" | "ct";
  tariff: string; // "Octopus Agile"
  priceNote: string; // what the price includes, in one sentence
  carbonSource: string | null;
}

export interface FuelShare {
  fuel: string;
  perc: number;
}

export interface Tide {
  region: Region;
  slots: Slot[]; // from the current slot onwards, sorted, contiguous where published
  mix: FuelShare[] | null; // current generation mix, when published
  fetchedAt: number;
  sources: string[];
}

export interface Home {
  id: string;
  country: Country;
  place: string; // postcode / city as given
  name?: string; // "the Patels"
  createdAt: number;
}
