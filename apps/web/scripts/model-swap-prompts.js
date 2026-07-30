"use strict";

const {
  normalizeModelSwapConfig,
  evaluateModelSwapSafety,
} = require("./model-swap-domain");

function describeSourceFacts(sourceFacts) {
  return JSON.stringify(sourceFacts && typeof sourceFacts === "object" ? sourceFacts : {});
}

function candidateSeedLabel(candidateIndex) {
  if (candidateIndex !== 1 && candidateIndex !== 2) {
    throw new RangeError("candidateIndex must be 1 or 2.");
  }
  return `candidate-${candidateIndex}-seed`;
}

function subjectInstruction(config) {
  if (config.subjectKind === "pet") {
    return `Subject: pet; species: ${config.petSpecies || "unspecified"}; breed: ${config.petBreed || "unspecified"}.`;
  }
  return `Subject: human; gender presentation: ${config.genderPresentation}; age group: ${config.ageGroup}; visible appearance request: ${config.humanAppearance || "unspecified"}.`;
}

function minorSafetyInstruction(config) {
  if (!new Set(["infant", "toddler", "child", "teen"]).has(config.ageGroup)) return "";
  return "Minor safety: show only normal children's clothing in family or commercial settings; no adultized, revealing, or sexually suggestive presentation.";
}

function buildModelSwapPrompt({ config, sourceFacts, hasTargetReference, candidateIndex }) {
  const safety = evaluateModelSwapSafety(config);
  if (!safety.allowed) {
    const error = new Error(safety.reason);
    error.name = "ModelSwapSafetyError";
    error.code = "MODEL_SWAP_UNSAFE";
    error.reason = safety.reason;
    throw error;
  }

  const normalized = normalizeModelSwapConfig(config);
  const instructions = [
    "Create a grounded model-swap image using only the visible source evidence.",
    `Stable variation label: ${candidateSeedLabel(candidateIndex)}.`,
    `Mode: ${normalized.mode}.`,
    subjectInstruction(normalized),
    `Garment type: ${normalized.garmentType || "unspecified"}.`,
    `Scene: ${normalized.scene || "unspecified"}.`,
    `Location request: country ${normalized.country || "unspecified"}; region ${normalized.region || "unspecified"}. Country and region provide geographic context only and must not determine or assign race or ethnicity.`,
    "Do not modify visible product color, logo, text, pattern, neckline, sleeve shape, buttons, shoe shape, or accessories.",
    "Do not fabricate unseen garment construction, hidden seams, closures, lining, back details, or any other structure not visible in the source.",
  ];

  if (normalized.mode === "replace_model") {
    instructions.push("Preserve the source pose, composition, lighting, and background while changing only the permitted model subject.");
  } else {
    instructions.push("Create a natural wearing relationship between the product and the selected subject.");
  }

  if (hasTargetReference) {
    instructions.push("A target reference is supplied: preserve its visible identity features without inventing hidden features.");
  }

  const minorSafety = minorSafetyInstruction(normalized);
  if (minorSafety) instructions.push(minorSafety);

  instructions.push(`Visible source facts: ${describeSourceFacts(sourceFacts)}.`);
  return instructions.join("\n");
}

function buildQualityPrompt({ sourceFacts, config }) {
  const normalized = normalizeModelSwapConfig(config);
  return [
    "Quality check the generated model-swap result against the visible source facts.",
    `Configuration: ${JSON.stringify(normalized)}.`,
    `Visible source facts: ${describeSourceFacts(sourceFacts)}.`,
    "Check human or pet match.",
    `Check age group and country/region against the request: ${normalized.ageGroup}; ${normalized.country || "unspecified"}/${normalized.region || "unspecified"}.`,
    "Check body, hands, feet, face, and hair or fur for visible defects and subject mismatch.",
    "Check wearing relationship and occlusion for natural construction.",
    "Check color, logo, text, pattern, texture, and silhouette for product fidelity.",
    "Confirm that neckline, sleeve shape, buttons, shoe shape, and accessories were preserved when visible.",
    "Check output aspect ratio and dimensions, including proportions, against the source facts.",
    "List every issue, including unsupported or fabricated unseen product structure; do not report a high-quality result when an issue is present.",
  ].join("\n");
}

module.exports = {
  buildModelSwapPrompt,
  buildQualityPrompt,
};
