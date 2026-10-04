import type { Region, Slot, Tide } from "./types";
import { getJson, HOUR } from "./http";

const AWATTAR = "https://api.awattar.de/v1/marketdata";
const ENERGY_CHARTS = "https://api.energy-charts.info/co2eq_forecast?country=de";

interface Market {
  data: { start_timestamp: number; end_timestamp: number; marketprice: number; unit: string }[];
}

/** German day-ahead spot price (EPEX via aWATTar), in ct/kWh before taxes and grid fees. */
export async function deTide(place: string): Promise<Tide> {
  const from = Math.floor(Date.now() / HOUR) * HOUR;
  const [m, co2] = await Promise.all([
    getJson<Market>(`${AWATTAR}?start=${from}&end=${from + 48 * HOUR}`, 600),
    getJson<{ unix_seconds: number[]; co2eq_forecast: (number | null)[] }>(ENERGY_CHARTS, 1800, 5000).catch(() => null),
  ]);
  const carbonAt = new Map<number, number>();
  if (co2?.unix_seconds) {
    co2.unix_seconds.forEach((s, i) => {
      const v = co2.co2eq_forecast[i];
      if (v != null) carbonAt.set(Math.floor((s * 1000) / HOUR) * HOUR, Math.round(v));
    });
  }
  const slots: Slot[] = m.data
    .map((d) => ({
      start: d.start_timestamp,
      end: d.end_timestamp,
      price: Math.round(d.marketprice / 10 * 100) / 100, // EUR/MWh -> ct/kWh
      carbon: carbonAt.get(d.start_timestamp) ?? null,
    }))
    .sort((a, b) => a.start - b.start);
  const region: Region = {
    country: "DE",
    id: "DE",
    name: "Germany",
    place,
    timeZone: "Europe/Berlin",
    currency: "EUR",
    unit: "ct",
    tariff: "dynamic spot tariff",
    priceNote: "Day-ahead spot price before taxes and grid fees, which dynamic tariffs add as a fixed amount.",
    carbonSource: carbonAt.size ? "Fraunhofer ISE Energy-Charts forecast" : null,
  };
  return {
    region,
    slots,
    mix: null,
    fetchedAt: Date.now(),
    sources: ["api.awattar.de", ...(carbonAt.size ? ["energy-charts.info"] : [])],
  };
}
