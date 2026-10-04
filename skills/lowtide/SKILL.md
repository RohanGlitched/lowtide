---
name: lowtide
description: Plan when to run household appliances (dishwasher, washing machine, tumble dryer, EV charger, immersion heater, home battery) at the cheapest or cleanest time, using live time-of-use electricity prices and grid carbon forecasts through the Lowtide MCP server. Use when someone asks when electricity is cheap, whether now is a good time to use power, or when to run an appliance.
---

# Lowtide

Lowtide tells a household when electricity is cheapest and cleanest, from live published prices:
- Britain: Octopus Agile half-hourly rates for any postcode (all 14 regions), plus the National Energy System Operator regional carbon forecast.
- Northern Illinois: ComEd Hourly Pricing (day-ahead).
- Germany: EPEX day-ahead spot price.

## Connect

Remote MCP server, Streamable HTTP:
- Guest (no saved runs): `https://lowtide-energy.vercel.app/api/mcp`
- Household (saved runs and savings): make a link at `https://lowtide-energy.vercel.app/connect`

## Which tool

| The person says | Call |
|---|---|
| "When should I run the dishwasher?" / "Charge the car by 7" | `plan_appliance` (appliance, optional `finish_by`, `start_after`, `goal`) |
| "Yes, do that" (after a plan) | `schedule_run` with the `start` that `plan_appliance` returned |
| "Is now a good time to put the dryer on?" | `check_now` |
| "When is power cheap tonight?" | `get_tide` |
| "What have I got planned?" | `list_runs` |
| "Cancel the washing" | `cancel_run` |
| "How much have I saved?" | `get_savings` |
| "I've moved to Leeds" | `set_home` |

On the guest endpoint, pass `place` (a UK postcode, "Chicago", or "Germany") with each question.

## How to answer

- Lead with the time and the saving in one sentence: "Run the dishwasher at 1:30 tonight. It costs 11p instead of 39p now."
- Then offer the reminder. Only call `schedule_run` after the person agrees.
- Say times the way people do ("one thirty a.m."), never ISO timestamps. Lines marked "Don't read this line aloud" are for you.
- The tools return an MCP App chart; if your client renders it, don't read numbers off it aloud.
- `goal: "greenest"` uses the carbon forecast (Britain, Germany); on a flat-rate tariff that is the useful question.
- If a tool says prices aren't published yet (each day's prices arrive in the afternoon), say when to ask again.
