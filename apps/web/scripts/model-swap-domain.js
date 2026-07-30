"use strict";

const MODES = new Set(["replace_model", "product_to_model"]);
const SUBJECT_KINDS = new Set(["human", "pet"]);
const GENDER_PRESENTATIONS = new Set(["male", "female", "nonbinary"]);
const AGE_GROUPS = new Set(["infant", "toddler", "child", "teen", "adult", "middle_aged", "senior"]);
const MINOR_AGE_GROUPS = new Set(["infant", "toddler", "child", "teen"]);
const MINOR_ALLOWED_GARMENTS = new Set([
  "accessory",
  "bottoms",
  "children_clothing",
  "dress",
  "hat",
  "outerwear",
  "pants",
  "set",
  "shoes",
  "skirt",
  "top",
]);
const MINOR_ALLOWED_SCENES = new Set([
  "commercial",
  "ecommerce",
  "ecommerce_white_background",
  "family_home",
  "home",
  "outdoor",
  "studio",
]);
const MINOR_APPEARANCE_VALUES = {
  hair: new Set(["black", "blonde", "brown", "gray", "red", "white"]),
  skin: new Set(["brown", "dark", "deep", "light", "medium", "tan"]),
  body: new Set(["athletic", "average", "petite", "plus_size", "slim", "tall"]),
};

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isAllowedMinorAppearance(value) {
  const text = cleanText(value).normalize("NFKC").toLowerCase();
  if (!text) return true;

  const seen = new Set();
  return text.split(",").every((entry) => {
    const match = entry.trim().match(/^([a-z]+):([a-z0-9_]+)$/);
    if (!match) return false;
    const [, field, option] = match;
    if (seen.has(field) || !MINOR_APPEARANCE_VALUES[field]?.has(option)) return false;
    seen.add(field);
    return true;
  });
}

function selectedValue(input, field, fallback) {
  if (!Object.prototype.hasOwnProperty.call(input, field) || input[field] === undefined) {
    return fallback;
  }
  return cleanText(input[field]).toLowerCase();
}

function normalizeModelSwapConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const subjectKind = selectedValue(source, "subjectKind", "human");

  return {
    mode: selectedValue(source, "mode", "replace_model"),
    subjectKind,
    genderPresentation: subjectKind === "human"
      ? selectedValue(source, "genderPresentation", "nonbinary")
      : "",
    ageGroup: selectedValue(source, "ageGroup", "adult"),
    country: cleanText(source.country),
    region: cleanText(source.region),
    humanAppearance: subjectKind === "human" ? cleanText(source.humanAppearance) : "",
    petSpecies: subjectKind === "pet" ? cleanText(source.petSpecies) : "",
    petBreed: subjectKind === "pet" ? cleanText(source.petBreed) : "",
    garmentType: cleanText(source.garmentType).toLowerCase(),
    scene: cleanText(source.scene).toLowerCase(),
    candidateCount: 2,
  };
}

function enumErrors(config) {
  const errors = [];
  if (!MODES.has(config.mode)) errors.push("Invalid mode.");
  if (!SUBJECT_KINDS.has(config.subjectKind)) errors.push("Invalid subjectKind.");
  if (!AGE_GROUPS.has(config.ageGroup)) errors.push("Invalid ageGroup.");
  if (config.subjectKind === "human" && !GENDER_PRESENTATIONS.has(config.genderPresentation)) {
    errors.push("Invalid genderPresentation.");
  }
  return errors;
}

function validateModelSwapBatch(files, config) {
  const errors = [];
  const count = Array.isArray(files) ? files.length : 0;
  const hasConfig = Boolean(config && typeof config === "object");

  if (count === 0) errors.push("At least one source image is required.");
  if (count > 15) errors.push("A model swap batch can contain at most 15 source images.");
  if (!hasConfig || (
    Object.prototype.hasOwnProperty.call(config, "candidateCount")
    && config.candidateCount !== 2
  )) {
    errors.push("Each source image must generate exactly two candidates.");
  }
  if (hasConfig) errors.push(...enumErrors(normalizeModelSwapConfig(config)));

  return { ok: errors.length === 0, errors };
}

function evaluateModelSwapSafety(config) {
  if (!config || typeof config !== "object") {
    return { allowed: false, reason: "A valid model swap safety configuration is required." };
  }
  const normalized = normalizeModelSwapConfig(config);
  const invalidEnums = enumErrors(normalized);
  if (invalidEnums.length > 0) {
    return { allowed: false, reason: invalidEnums.join(" ") };
  }
  if (!MINOR_AGE_GROUPS.has(normalized.ageGroup)) return { allowed: true, reason: "" };

  if (!MINOR_ALLOWED_GARMENTS.has(normalized.garmentType)) {
    return {
      allowed: false,
      reason: "Minors cannot be shown in adultized, revealing, or sexually suggestive clothing.",
    };
  }

  if (!MINOR_ALLOWED_SCENES.has(normalized.scene)) {
    return {
      allowed: false,
      reason: "Minors are limited to normal children’s clothing and family or commercial settings.",
    };
  }

  if (!isAllowedMinorAppearance(normalized.humanAppearance)) {
    return {
      allowed: false,
      reason: "Minors require an empty humanAppearance or approved structured appearance codes.",
    };
  }

  return { allowed: true, reason: "" };
}

module.exports = {
  normalizeModelSwapConfig,
  validateModelSwapBatch,
  evaluateModelSwapSafety,
};
