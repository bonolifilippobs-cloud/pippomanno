import Anthropic from "@anthropic-ai/sdk";
import * as store from "./db.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `You are a friendly nutrition and fitness coach built into a personal tracking app.
The user mostly talks to you by voice from their phone, so their messages are dictated and can be
informal, run-on, or contain transcription errors. Your main job is to keep their food, exercise,
water and body-weight log accurate, using the tools provided.

How to log:
- When the user mentions something they ate or drank, call log_food. Split meals into individual
  items (e.g. "pasta with tomato sauce and a glass of wine" = 2-3 items). Estimate realistic portion
  sizes when they are not given, and estimate calories, protein, carbs, fat, fiber, sugar and sodium
  from your nutrition knowledge (typical USDA / CREA values). Prefer a reasonable estimate over
  asking; only ask a follow-up when the amount is truly ambiguous and would change the total a lot.
- Infer the meal (breakfast, lunch, dinner, snack) from what they say or from the local time.
- Plain water goes to log_water, not log_food. Other drinks with calories go to log_food.
- Workouts and activities go to log_exercise with an estimated calories_burned based on the
  activity, duration and intensity (use their latest logged weight if known).
- Body weight goes to log_weight (convert lb to kg).
- If they correct something ("actually it was two eggs", "remove the beer"), call get_day to find
  the entry id, then update_entry or delete_entry. Never create duplicates for a correction.
- When they say "yesterday" or name a day, pass the matching date (YYYY-MM-DD).
- Use set_goals when they state targets ("I want to eat 2000 calories", "aim for 150g protein").

How to reply:
- Keep replies short: they may be read aloud by Siri. Confirm what you logged in one or two
  sentences with the key numbers, then the remaining calories / protein for the day.
- No markdown tables or headers. Plain sentences, at most a short list.
- Reply in the same language the user speaks.
- If they ask how they're doing, call get_day or get_history and give a brief, honest,
  encouraging read-out.`;

const MEALS = ["breakfast", "lunch", "dinner", "snack"];
const dateProp = {
  type: "string",
  description: "Day this belongs to, YYYY-MM-DD. Omit for today.",
};

const tools = [
  {
    name: "log_food",
    description:
      "Log one or more food or drink items the user consumed. Provide your best nutritional estimate for each item.",
    input_schema: {
      type: "object",
      properties: {
        date: dateProp,
        time: { type: "string", description: "Local time HH:MM it was eaten, if known." },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short food name, e.g. 'Greek yogurt 2%'" },
              quantity: { type: "string", description: "Portion, e.g. '170 g' or '2 slices'" },
              meal: { type: "string", enum: MEALS },
              calories: { type: "number" },
              protein_g: { type: "number" },
              carbs_g: { type: "number" },
              fat_g: { type: "number" },
              fiber_g: { type: "number" },
              sugar_g: { type: "number" },
              sodium_mg: { type: "number" },
              notes: { type: "string" },
            },
            required: ["name", "quantity", "meal", "calories", "protein_g", "carbs_g", "fat_g"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "log_exercise",
    description: "Log a workout or physical activity.",
    input_schema: {
      type: "object",
      properties: {
        date: dateProp,
        time: { type: "string", description: "Local time HH:MM, if known." },
        name: { type: "string", description: "e.g. 'Running', 'Upper-body weights'" },
        duration_min: { type: "number" },
        calories_burned: { type: "number", description: "Estimated active calories burned." },
        notes: { type: "string", description: "Distance, sets/reps, intensity, etc." },
      },
      required: ["name", "duration_min", "calories_burned"],
      additionalProperties: false,
    },
  },
  {
    name: "log_water",
    description: "Log plain water intake.",
    input_schema: {
      type: "object",
      properties: {
        date: dateProp,
        time: { type: "string" },
        amount_ml: { type: "number" },
      },
      required: ["amount_ml"],
      additionalProperties: false,
    },
  },
  {
    name: "log_weight",
    description: "Log a body-weight measurement in kilograms.",
    input_schema: {
      type: "object",
      properties: {
        date: dateProp,
        time: { type: "string" },
        weight_kg: { type: "number" },
      },
      required: ["weight_kg"],
      additionalProperties: false,
    },
  },
  {
    name: "get_day",
    description:
      "Get every logged entry (with ids) plus totals and goals for one day. Use before correcting or deleting entries.",
    input_schema: {
      type: "object",
      properties: { date: dateProp },
      additionalProperties: false,
    },
  },
  {
    name: "get_history",
    description: "Get per-day totals (calories, macros, exercise, water, weight) for the last N days.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "update_entry",
    description: "Change fields of an existing entry (found via get_day). Only pass the fields that change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        fields: {
          type: "object",
          properties: {
            date: { type: "string" },
            time: { type: "string" },
            meal: { type: "string", enum: MEALS },
            name: { type: "string" },
            quantity: { type: "string" },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
            fiber_g: { type: "number" },
            sugar_g: { type: "number" },
            sodium_mg: { type: "number" },
            duration_min: { type: "number" },
            calories_burned: { type: "number" },
            amount_ml: { type: "number" },
            weight_kg: { type: "number" },
            notes: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      required: ["id", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_entry",
    description: "Delete an entry by id (found via get_day).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_goals",
    description: "Update the user's daily targets. Only pass the fields that change.",
    input_schema: {
      type: "object",
      properties: {
        calories: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
        water_ml: { type: "number" },
        target_weight_kg: { type: "number" },
        notes: { type: "string", description: "Free-text context, e.g. 'cutting for summer'" },
      },
      additionalProperties: false,
    },
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function runTool(name, input, ctx) {
  const date = DATE_RE.test(input.date ?? "") ? input.date : ctx.date;
  const time = input.time ?? ctx.time;
  switch (name) {
    case "log_food": {
      if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("items is required");
      const logged = input.items.map((item) => store.addEntry({ ...item, kind: "food", date, time }));
      return { logged, day_totals: store.daySummary(date).totals };
    }
    case "log_exercise":
      return { logged: store.addEntry({ ...input, kind: "exercise", date, time }), day_totals: store.daySummary(date).totals };
    case "log_water":
      return { logged: store.addEntry({ amount_ml: input.amount_ml, kind: "water", date, time }), day_totals: store.daySummary(date).totals };
    case "log_weight":
      return { logged: store.addEntry({ weight_kg: input.weight_kg, kind: "weight", date, time }) };
    case "get_day":
      return store.daySummary(date);
    case "get_history":
      return store.history(ctx.date, Math.min(Math.max(Number(input.days) || 7, 1), 90));
    case "update_entry": {
      const updated = store.updateEntry(Number(input.id), input.fields ?? {});
      if (!updated) throw new Error(`No entry with id ${input.id}`);
      return { updated };
    }
    case "delete_entry":
      if (!store.deleteEntry(Number(input.id))) throw new Error(`No entry with id ${input.id}`);
      return { deleted: input.id };
    case "set_goals":
      return { goals: store.setGoals(input) };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/**
 * Handle one user message: run Claude with the logging tools until it is done,
 * persist the exchange, and return Claude's reply text.
 *
 * @param {object} args
 * @param {string} args.text      what the user said / typed
 * @param {string} args.date      user's local date, YYYY-MM-DD
 * @param {string} args.time      user's local time, HH:MM
 * @param {{media_type: string, data: string}} [args.image]  optional base64 meal photo
 */
export async function chat({ text, date, time, image }) {
  // Prior conversation for today, as plain text turns, so follow-ups like
  // "actually make that two" have context.
  const history = store.messagesForDate(date, 20).map((m) => ({ role: m.role, content: m.text }));
  while (history.length && history[0].role !== "user") history.shift();

  const userContent = [];
  if (image) userContent.push({ type: "image", source: { type: "base64", ...image } });
  userContent.push({
    type: "text",
    text: `[Local date ${date}, time ${time}]\n${text || "(photo of what I ate — please log it)"}`,
  });

  /** @type {Anthropic.Beta.BetaMessageParam[]} */
  const messages = [...history, { role: "user", content: userContent }];
  const ctx = { date, time };
  let changed = false;
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      output_config: { effort: "low" },
      // If a safety classifier declines, let the API retry on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      reply = "Sorry, I can't help with that one.";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim() || reply;

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const toolResults = response.content
      .filter((b) => b.type === "tool_use")
      .map((block) => {
        try {
          const result = runTool(block.name, block.input ?? {}, ctx);
          if (!block.name.startsWith("get_")) changed = true;
          return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: block.id, content: String(err.message ?? err), is_error: true };
        }
      });
    messages.push({ role: "user", content: toolResults });
  }

  reply ||= "Done.";
  store.addMessage(date, "user", image ? `📷 ${text || "(photo)"}` : text);
  store.addMessage(date, "assistant", reply);
  return { reply, changed };
}
