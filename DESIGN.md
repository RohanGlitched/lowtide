# Lowtide: design

**Subject:** electricity prices rise and fall through the night like a tide. Lowtide reads tonight's prices and the grid's carbon forecast and tells a household, through Alexa+, when to run the dishwasher, the washing, the hot water and the car: at low tide.

**Audience:** households on time-of-use tariffs (Octopus Agile in Britain, ComEd hourly pricing in Illinois, dynamic tariffs in Germany), standing in the kitchen with their hands full, and the judges and developers who meet it on the web first.

**Primary job:** answer "when should I run it?" in one sentence, and show why in one picture.

## Direction: Night Tide + Delay Start

Two ideas, one for the night and one for the machine.

- **Night Tide.** The page is the night sky: deep navy (`--night #05070e`) with a few stars and a crescent moon. Tonight's prices are drawn as a moonlit tide: the water stands high when power is dear and falls to low tide when it is cheap. The dishwasher's run is a column of moonlight on the water, with a glint at the lowest point. Before tomorrow's prices are published, the rest of the night is a dotted line from earlier today, never water.
- **Delay Start.** The answer looks the way an appliance would show it: an orange LCD readout (start time, cost against a typical time, the night's prices as bars with the run lit) and a delay-start knob for each of tonight's four loads. Orange belongs to the displays only.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--night` | `#05070e` | page background |
| `--moon` | `#f3f1e6` | primary buttons, the moon |
| `--moonlight` | `#8fd6ff` | cheap, low tide, links, focus |
| `--signal` | `#ff6a33` | LCD digits and lit bars only |
| `--signal-text` | `#d06a3c` | dim LCD text that must still be read (AA on the glass) |
| `--muted` / `--faint` | `#9aa6bf` / `#8692ac` | secondary text; both clear AA on every surface |

Type: **Newsreader** for headlines and figures (the hero headline tops out near 64 px, section heads near 38 px), **Inter** for text, **JetBrains Mono** for the LCDs. All self-hosted through `next/font`.

## Principles

- **One answer everywhere.** The headline, the LCD and the tide always name the same run; the Cheapest, Greenest and Start now keys re-plan all three from the same prices.
- **Fast first paint.** The tide, LCDs and knobs are SVG and HTML rendered on the server. No WebGL: a three.js object took 5 to 11 seconds to appear on ordinary laptops and was removed.
- **Readable by everyone.** The tide reads by mouse, by touch (a tap stays put) and with the arrow keys, with a spoken readout and a table of every price. Contrast clears WCAG AA everywhere; reduced motion is honoured.
- **Honest numbers.** Savings are against a typical start, never the evening peak; each figure on the page links to its evidence.

The MCP App view (`views/`) that Alexa+ and chat hosts render keeps a dial, which reads better at a glance on a small device screen, in the same fonts and moonlight accent.
