# Lowtide — design plan

**Subject:** electricity prices and grid carbon move like a tide through the day. Lowtide reads tonight's
half-hourly prices and the grid's carbon forecast, and tells a household (through Alexa+) when to run the
dishwasher, washing machine, dryer or EV charger: at low tide.

**Audience:** households on time-of-use tariffs (Octopus Agile in Britain, ComEd hourly pricing in
Illinois, dynamic spot tariffs in Germany) who talk to an Echo in the kitchen. Hands busy, standing two
metres from a screen.

**Primary job:** answer "when should I run it?" in one sentence, and show why on one chart.

## Identity: the tide table

Not a dashboard. The visual language comes from Admiralty tide tables and nautical charts:
- the price curve is drawn as a **tidal curve** (water level over time), shaded like charted water;
- the cheapest stretches are labelled like tide-table entries: **LW 02:30 · 6.1p** (low water), **HW 18:00 · 41.2p**;
- prices along the curve are written as **soundings**: small italic serif numerals, the way depths are printed on a chart;
- "now" is a **chart-magenta** line, the colour nautical charts reserve for lights and hazards;
- a planned appliance run sits on the curve as a **berth**: a bracket spanning its start and finish.

## Tokens

| Token | Hex | Role |
|---|---|---|
| chart | `#F3F7F8` | paper (cool white, never cream) |
| ink | `#13222D` | text, rules, the curve |
| shoal | `#CFE5EC` | shallow-water tint: the body of water under the curve |
| deep | `#2C6B89` | deep water: low-water windows, primary actions |
| magenta | `#B0186F` | now, the chosen start time, the one accent |
| sand | `#E6D9B8` | dry land: the most expensive hours (sparingly) |

Night palette (dark mode) follows ECDIS night charts: ground `#0B1822`, ink `#C9D8DF`, water `#173647`,
deep `#5FA9C9`, magenta `#E0559E`. Dim, low-glare: this sits in a kitchen at night.

**Type.** Barlow Semi Condensed (signage/tide-table face: tabular figures, legible at distance) for UI and
data; Newsreader italic for soundings and annotations only. Scale for a 2 m viewing distance on the Echo
view: 56 / 34 / 22 / 16. Sentence case everywhere; no all-caps labels.

## Layout

```
Echo Show view (landscape 1280x800, also inline in Claude/ChatGPT at ~640px):
┌──────────────────────────────────────────────────────────┐
│ Run the dishwasher at 01:30                              │  answer first (56)
│ 3 h · finishes 04:30 · £0.11 instead of £0.39 now        │  one line of proof (22)
│                                                          │
│   ~~~~~~╲__________/‾‾‾‾╲_____/‾‾‾‾‾‾‾‾‾‾‾‾╲___~~~~      │  the tidal curve, full width
│   |now      [==berth==]          HW 18:00 · 41.2p         │
│ 18:00   21:00   00:00   03:00   06:00   09:00   12:00    │
│ Grid tonight: wind 41% · gas 18% · carbon low at 03:00   │  quiet footer
└──────────────────────────────────────────────────────────┘
```

Left aligned, generous margins, the curve bleeds to both edges. The web site (lowtide landing) opens with
the live tidal curve for London across the full width, then the conversation, then the tide table for
every British region (a real table, because it is one).

## Principles

1. **The answer is a sentence, the chart is the proof.** Every view leads with the spoken answer.
2. **Live water only.** Every curve is drawn from today's published prices; nothing is a mock-up.
3. **One accent.** Magenta marks now and the chosen time; everything else is ink and water.
4. **Readable from across the kitchen.** Minimum 16px on the device view; contrast checked at night.
5. **Motion only for the tide coming in:** the curve draws once, left to right, on first render.
