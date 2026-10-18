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
- Guest (no saved runs): `https://d1soo7510nfzf4.cloudfront.net/api/mcp`
- Household (saved runs and savings): make a link at `https://d1soo7510nfzf4.cloudfront.net/connect`

## Which tool

| The person says | Call |
|---|---|
| "When should I run the dishwasher?" / "Charge the car by 7" | `plan_appliance` (appliance, optional `finish_by`, `start_after`, `goal`). Pass times in the person's words ("seven", "7am", "in two hours"): with no a.m. or p.m. Lowtide picks the next seven the run can still make |
| "Yes, do that" (after a plan) | `schedule_run` with the `start` that `plan_appliance` returned |
| "Is now a good time to put the dryer on?" | `check_now` |
| "When is power cheap tonight?" | `get_tide` |
| "What have I got planned?" | `list_runs` |
| "Cancel the washing" | `cancel_run` |
| "How much have I saved?" | `get_savings` |
| "I've moved to Leeds" | `set_home` |
| "What's the plan for tonight?" | `get_tonight` (planned ahead once tomorrow's prices are out) |

On the guest endpoint, pass `place` (a UK postcode, "Chicago", or "Germany") with each question.

## How to answer

- Lead with the time and the saving in one sentence, as the tool words it: "Run the dishwasher tonight at 1:30 a.m., done by 4:30 a.m., in time for 7 a.m. tomorrow morning. It costs about 11 pence, 28 pence less than starting now." (The numbers change with each day's prices.)
- If the tool says the run can't be done by the deadline, say so and offer the earliest finish it gives; don't move the deadline yourself.
- Then offer to save the run for the household (it counts toward their savings). Only call `schedule_run` after the person agrees. Lowtide can't send reminders, so never promise one: suggest the machine's delay-start button instead.
- Say times the way people do ("one thirty a.m."), never ISO timestamps. Lines marked "Don't read this line aloud" are for you.
- The tools return an MCP App chart; if your client renders it, don't read numbers off it aloud.
- `goal: "greenest"` uses the carbon forecast (Britain, Germany); on a flat-rate tariff that is the useful question.
- If a tool says prices aren't published yet (each day's prices arrive in the afternoon), say when to ask again.
